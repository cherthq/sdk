import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { startOnboarding, pollOnboarding, watchOnboarding, cancelOnboarding, cleanupOnboarding } from './onboard.js';
import { ChertControlPlane } from '@cherthq/control-plane';
import { assertOutsideProject, credentialDirectory, readCredential, saveCredential, type Credential } from './storage.js';

export class SetupError extends Error {}
export const HELP = `Chert — connect your existing agent or project
  chert setup --backend https://HOST [--target project|personal] [--plan shared|dedicated]
  chert login --backend https://HOST
  chert status | doctor [--backend https://HOST] [--env-file PATH]
  chert onboard --base-url https://HOST --phone +COUNTRYNUMBER --consent-contact [--agent codex] [--target auto] [--detach]
  chert onboard-status | onboard-watch | onboard-cancel | onboard-cleanup --state /tmp/.../state.json
  --json produces structured output. --help shows this page.
Shared: US$25/month. Dedicated: US$250/month/line. No free plan.
This preview prepares setup and checks existing access; it does not run a media connector.`;
type Flags = Record<string, string | boolean>;
export interface Dependencies {
  cwd?: string;
  credentialDir?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
  emit?: (value: Record<string, unknown>) => void;
}
function parse(argv: string[]): { command: string; flags: Flags } {
  const words = [...argv], command = words[0]?.startsWith('--') ? 'help' : words.shift() ?? 'help';
  const flags: Flags = {};
  const valued = new Set(['backend', 'target', 'plan', 'env-file', 'base-url', 'phone', 'agent', 'state']);
  for (let index = 0; index < words.length; index++) {
    const name = words[index].replace(/^--/, '');
    if (!words[index].startsWith('--') || !['json', 'help', 'consent-contact', 'detach', ...valued].includes(name) || name in flags) throw new SetupError('Unknown or repeated option. Run chert --help.');
    if (valued.has(name)) {
      if (!words[index + 1] || words[index + 1].startsWith('--')) throw new SetupError(`--${name} needs a value.`);
      flags[name] = words[++index];
    } else flags[name] = true;
  }
  return { command, flags };
}
async function environment(cwd: string, flags: Flags, shell: NodeJS.ProcessEnv): Promise<{ ready: boolean; missing: string[]; agentName?: string; envFile?: string }> {
  const keys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
  let values: NodeJS.ProcessEnv = { ...shell }, envFile: string | undefined;
  for (const candidate of typeof flags['env-file'] === 'string' ? [flags['env-file']] : ['.env.local', '.env']) {
    const path = resolve(cwd, candidate);
    try {
      if ((await stat(path)).size > 1024 * 1024) throw new SetupError('Environment file exceeds 1 MiB.');
      const parsed = parseEnv(await readFile(path, 'utf8'));
      for (const key of [...keys, 'AGENT_NAME']) if (values[key] === undefined) values[key] = parsed[key];
      envFile = path; break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !flags['env-file']) continue;
      throw new SetupError('Cannot read the selected environment file. No file was changed.');
    }
  }
  const missing = keys.filter(key => !values[key] || /YOUR_|PLACEHOLDER/i.test(values[key]!));
  if (values.LIVEKIT_URL && !/^wss:\/\/[^/?#@]+\/?$/.test(values.LIVEKIT_URL)) throw new SetupError('LIVEKIT_URL must be a wss:// host without credentials or a path.');
  const name = values.AGENT_NAME;
  return { ready: !missing.length, missing, ...(envFile ? { envFile } : {}), ...(name && /^[\w .-]{1,100}$/.test(name) ? { agentName: name } : {}) };
}
async function detectTarget(cwd: string): Promise<'project' | 'personal'> {
  for (const marker of ['package.json', 'pyproject.toml', 'Cargo.toml', '.git']) {
    try { await stat(join(cwd, marker)); return 'project'; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return 'personal';
}
const capabilities = {
  signup: 'Use the Chert account website; automatic signup is not implemented by this CLI.',
  passkey: 'Passkeys require a product-supported browser/OS enrollment flow; a CLI token is not a passkey.',
  verification: 'Recipient phone verification is not implemented by this CLI; do not assume a number is verified.',
  allocation: 'A project owner/admin must supply an existing assigned FaceTime line.',
  billing: 'No checkout is created automatically. Confirm current plan availability and approve payment through Chert.',
  runtime: 'This package does not relay media. Keep your agent and a compatible connector running separately.'
};
/** No checkout, connector enrollment, calls or messages are performed by setup/status/doctor. */
export async function run(argv: string[], dependencies: Dependencies = {}): Promise<Record<string, unknown>> {
  const { command, flags } = parse(argv);
  if (command === 'help' || flags.help) return { status: 'help', text: HELP };
  if (command.startsWith('onboard')) {
    const common = { ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}), ...(dependencies.now ? { now: dependencies.now } : {}), ...(dependencies.pause ? { pause: dependencies.pause } : {}), ...(dependencies.emit ? { emit: dependencies.emit } : {}) };
    if (command !== 'onboard') {
      if (typeof flags.state !== 'string') throw new SetupError('Supply --state with the helper state.json path.');
      if (command === 'onboard-status') return pollOnboarding(flags.state, common);
      if (command === 'onboard-watch') return watchOnboarding(flags.state, common);
      if (command === 'onboard-cancel') return cancelOnboarding(flags.state);
      if (command === 'onboard-cleanup') return cleanupOnboarding(flags.state);
      throw new SetupError('Unknown onboarding command.');
    }
    if (typeof flags['base-url'] !== 'string' || typeof flags.phone !== 'string') throw new SetupError('Supply --base-url https://TRUSTED_HOST and --phone +COUNTRYNUMBER, with user contact consent.');
    const cwd = dependencies.cwd ?? process.cwd(), env = dependencies.env ?? process.env;
    const target = flags.target === undefined || flags.target === 'auto' ? await detectTarget(cwd) : flags.target;
    if (target !== 'project' && target !== 'personal') throw new SetupError('--target must be auto, project or personal.');
    const agent = typeof flags.agent === 'string' ? flags.agent : env.CHERT_ORIGIN_AGENT ?? (env.CODEX_THREAD_ID ? 'codex' : env.CLAUDECODE ? 'claude-code' : 'coding-agent');
    const result = await startOnboarding({ baseUrl: flags['base-url'], phone: flags.phone, consent: flags['consent-contact'] === true, agent, target, ...(target === 'project' ? { projectLabel: basename(cwd) } : {}), detached: flags.detach === true }, common);
    return flags.detach === true ? result : watchOnboarding(String(result.helperFile), common);
  }
  if (!['setup', 'login', 'status', 'doctor'].includes(command)) throw new SetupError('Unknown command. Run chert --help.');
  const cwd = dependencies.cwd ?? process.cwd(), directory = dependencies.credentialDir ?? credentialDirectory();
  const now = dependencies.now ?? Date.now;
  const saved = await readCredential(directory);
  const backend = typeof flags.backend === 'string' ? flags.backend : saved?.origin;
  if (!backend) throw new SetupError('Specify --backend https://HOST for your Chert control plane.');
  const url = new URL(backend);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new SetupError('Backend must be an HTTPS origin without credentials or a path.');
  const origin = url.origin;
  const active = saved?.origin === origin && saved.expiresAt > now() ? saved : undefined;
  const client = new ChertControlPlane({ baseUrl: origin, ...(active ? { token: active.token, projectId: active.projectId } : {}), ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}) });
  if (command === 'login') {
    assertOutsideProject(directory, cwd);
    if (active) return { status: 'signed_in', message: 'Existing local credential is still valid. Use status to check server access.', projectId: active.projectId };
    const pending = await client.beginLogin({ device_name: hostname().replace(/[^a-zA-Z0-9 ._-]/g, '').slice(0, 80) || 'This computer' });
    if (!pending || !/^fdc_[A-Za-z0-9_-]{43}$/.test(pending.device_code) || !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(pending.user_code) || !Number.isInteger(pending.expires_in) || pending.expires_in < 1 || pending.expires_in > 3600 || !Number.isInteger(pending.interval) || pending.interval < 1 || pending.interval > 60) throw new SetupError('Server returned invalid sign-in details.');
    const approval = new URL(pending.verification_url_complete);
    const approvalBase = new URL(pending.verification_url);
    if (approval.origin !== origin || approvalBase.origin !== origin || approval.pathname !== approvalBase.pathname || approval.searchParams.get('code') !== pending.user_code || approval.protocol !== 'https:' || approval.username || approval.password || /[^\x21-\x7e]/.test(pending.verification_url_complete)) throw new SetupError('Server returned an unexpected approval address.');
    dependencies.emit?.({ status: 'awaiting_approval', verificationUrl: pending.verification_url_complete, userCode: pending.user_code, message: 'Open this address, check the code, and approve this computer for your project. No secret needs to be pasted into the terminal.' });
    const deadline = now() + Math.min(pending.expires_in, 900) * 1000;
    const pause = dependencies.pause ?? (milliseconds => delay(milliseconds));
    // A finite poll count also bounds fake clocks and malformed test/server timing.
    const interval = Math.max(1, Math.min(pending.interval, 60));
    for (let attempt = 0; attempt < Math.ceil(900 / interval) && now() < deadline; attempt++) {
      await pause(interval * 1000);
      if (now() >= deadline) break;
      const answer = await client.pollLogin({ device_code: pending.device_code });
      if (answer.status === 'pending') continue;
      if (answer.status !== 'approved') throw new SetupError('Sign-in was not approved. Nothing was saved.');
      if (!/^ftu_[A-Za-z0-9_-]{43}$/.test(answer.access_token) || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(answer.project?.id) || !Number.isInteger(answer.expires_in) || answer.expires_in < 1 || answer.expires_in > 31 * 86400) throw new SetupError('Server returned an invalid credential. Nothing was saved.');
      const credential: Credential = { origin, token: answer.access_token, projectId: answer.project.id, expiresAt: now() + answer.expires_in * 1000 };
      try { await saveCredential(directory, credential); }
      catch { throw new SetupError('Chert approved this login but the credential could not be saved. A project owner should revoke that CLI credential in the dashboard before trying again.'); }
      return { status: 'signed_in', projectId: credential.projectId, message: 'Project-scoped credential saved outside your project with owner-only permissions. This is not a passkey. Run chert doctor next.' };
    }
    throw new SetupError('Sign-in expired. Nothing was saved; run login again.');
  }
  const target = flags.target ?? await detectTarget(cwd);
  if (!['project', 'personal'].includes(String(target))) throw new SetupError('--target must be project or personal.');
  if (flags.plan && !['shared', 'dedicated'].includes(String(flags.plan))) throw new SetupError('--plan must be shared or dedicated.');
  const local = await environment(cwd, flags, dependencies.env ?? process.env);
  const common = { target, plan: flags.plan ?? null, planOptions: [{ plan: 'shared', usdMonthly: 25 }, { plan: 'dedicated', usdMonthlyPerLine: 250 }], prerequisites: capabilities, local };
  if (!active) return { ...common, status: 'blocked', blockers: ['Sign in with chert login --backend ' + origin, ...(!flags.plan ? ['Ask the user which paid plan they want.'] : [])], message: target === 'project' ? 'Integrate Chert into this project; the coding agent is not the hosted runtime.' : 'Connect the existing persistent agent runtime; do not replace its provider.' };
  const identity = await client.whoami();
  const lines = await client.listLines();
  const workers = await client.listWorkers();
  if (!identity || identity.project?.id !== active.projectId || typeof identity.role !== 'string' || !Array.isArray(lines?.items) || !Array.isArray(workers?.items) || !Number.isInteger(lines.total) || lines.total !== lines.items.length || !Number.isInteger(workers.total) || workers.total !== workers.items.length) throw new SetupError('Server access data is invalid or paginated; cannot assess this project safely.');
  const blockers: string[] = [];
  if (command === 'setup' && !flags.plan) blockers.push('Ask the user which paid plan they want before provisioning or checkout.');
  if (!['owner', 'admin'].includes(identity.role)) blockers.push('A project owner or admin must connect the agent.');
  if (!local.ready) blockers.push('Provide ' + local.missing.join(', ') + ' through a local secret environment file.');
  if (!local.agentName) blockers.push('Set AGENT_NAME to the agent registered in your LiveKit project.');
  if (lines.items.length !== 1) blockers.push('A compatible connector requires exactly one assigned line in this project.');
  for (const line of lines.items) {
    if (!line || typeof line.id !== 'string') throw new SetupError('Server returned invalid line information.');
    if (line.inbound_policy !== 'customer_decides' || line.default_assistant_id !== null) blockers.push('Set the line to customer decides with no default hosted assistant.');
    if (line.status !== 'available') blockers.push('The assigned line is not currently available.');
    const worker = workers.items.find(item => item?.id === line.worker_id);
    const heartbeat = typeof worker?.last_heartbeat_at === 'string' ? Date.parse(worker.last_heartbeat_at) : NaN;
    if (!worker || worker.status !== 'accepting' || worker.enabled !== true || !Number.isFinite(heartbeat) || Math.abs(now() - heartbeat) >= 60000) blockers.push('The assigned line needs an accepting worker with a fresh heartbeat; request a Chert readiness check.');
  }
  // Access and configuration readiness never imply connector or media readiness.
  return { ...common, status: blockers.length ? 'blocked' : 'configuration_ready', projectId: active.projectId, role: identity.role, lineCount: lines.items.length, workerCount: workers.items.length, blockers, next: 'Run your registered LiveKit agent and a compatible media connector separately. This CLI does not implement chert dev or place a test call.', verification: 'No real calls, messages, checkout or phone verification were performed.' };
}
