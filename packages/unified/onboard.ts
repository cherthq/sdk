import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const DOCS = 'https://github.com/cherthq/sdk/blob/main';
const DEFAULT_ORIGIN = 'https://facetime.trychert.com';
const AGENT_CLI = '@trychert/facetime';
const E164 = /^\+[1-9][0-9]{6,14}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CREDENTIAL = /^ftu_[A-Za-z0-9_-]{43}$/;
const DEVICE_CODE = /^[\x21-\x7e]{16,200}$/;
const OUTGOING_MESSAGE = /^[!-,.-~][ -~]{0,159}$/;
const SEND_SCRIPT = ['on run argv', 'tell application "Messages"', 'set targetService to 1st account whose service type = iMessage',
  'send (item 1 of argv) to participant (item 2 of argv) of targetService', 'end tell', 'end run'];
const FINISH_AFTER_MS = 60_000;
const STALLED_AFTER_MS = 15_000;
const LOGIN_WAIT_MS = 120_000;
const SESSION_WAIT_MS = 600_000;

export interface ExecResult { stdout: string }
export interface OnboardDeps {
  exec(file: string, args: string[], timeoutMs: number): Promise<ExecResult>;
  fetch: typeof fetch;
  prompt(question: string): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<void>;
  out(line: string): void;
  err(line: string): void;
  platform: string;
  interactive: boolean;
  home: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  deviceName: string;
}

export function defaultDeps(): OnboardDeps {
  return {
    exec: (file, args, timeout) => new Promise((resolve, reject) => {
      execFile(file, args, { timeout, maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr: String(stderr) })); else resolve({ stdout: String(stdout) });
      });
    }),
    fetch: globalThis.fetch,
    async prompt(question) {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      try { return await reader.question(question); } finally { reader.close(); }
    },
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    out: line => console.log(line),
    err: line => console.error(line),
    platform: process.platform,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    home: homedir(),
    cwd: process.cwd(),
    env: process.env,
    deviceName: hostname(),
  };
}

export class OnboardError extends Error {
  constructor(readonly code: string, message: string, readonly detail: Record<string, unknown> = {}) { super(message); }
}

export const maskNumber = (number: string) => `•••${number.slice(-4)}`;

export function e164(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return E164.test(text) ? text : null;
}

export function parseMessagesAliases(json: string): string[] {
  let value: unknown;
  try { value = JSON.parse(json); } catch { return []; }
  const aliases = (value as { allAliases?: unknown } | null)?.allAliases;
  if (!Array.isArray(aliases)) return [];
  return [...new Set(aliases.flatMap(alias => e164(alias) ?? []))];
}

async function detectNumbers(deps: OnboardDeps): Promise<string[]> {
  const plist = join(deps.home, 'Library', 'Preferences', 'com.apple.madrid.plist');
  let numbers: string[] = [];
  try { numbers = parseMessagesAliases((await deps.exec('plutil', ['-extract', 'IMD-IDS-Aliases', 'json', '-o', '-', plist], 15_000)).stdout); } catch {}
  return numbers;
}
function noNumbers(): OnboardError {
  return new OnboardError('no_phone_numbers', 'No phone number is signed in to Messages on this Mac. Turn on your number in Messages > Settings > iMessage, or on your iPhone under Settings > Apps > Messages > Text Message Forwarding, then run this again.');
}

function parseSelection(raw: string, detected: string[]): string[] {
  const text = raw.trim().toLowerCase();
  if (text === 'all' || text === 'both') return detected;
  const picks = raw.split(',').map(part => part.trim()).filter(Boolean);
  if (!picks.length) throw new OnboardError('invalid_numbers', 'Choose at least one number.');
  const chosen = picks.map(pick => {
    if (/^[0-9]{1,2}$/.test(pick)) {
      const number = detected[Number(pick) - 1];
      if (!number) throw new OnboardError('number_not_on_this_mac', `There is no number ${pick} on this Mac. Nothing was sent.`);
      return number;
    }
    const number = e164(pick);
    if (!number) throw new OnboardError('invalid_numbers', 'Use numbers with their + country code, or their position in the list. Nothing was sent.');
    if (!detected.includes(number)) throw new OnboardError('number_not_on_this_mac', `${maskNumber(number)} is not signed in to Messages on this Mac. Nothing was sent.`);
    return number;
  });
  return [...new Set(chosen)];
}

function chertHome(deps: OnboardDeps): string { return deps.env.CHERT_HOME?.trim() || join(deps.home, '.chert'); }

function ownerOnly(path: string, max = 16384) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > max)
    throw new OnboardError('unsafe_file', `${path} must be a regular file only you can read. Fix it, or remove it, then run this again.`);
}
function writeOwnerOnly(dir: string, name: string, contents: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const file = join(dir, name), temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
}
function readOwnerOnly(path: string): unknown {
  if (!existsSync(path)) return undefined;
  ownerOnly(path);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new OnboardError('unsafe_file', `${path} is unreadable. Remove it, then run this again.`); }
}

interface SavedCredential { access_token: string; expires_at: number; kind: 'cli'; project_id: string; device_name?: string; origin: string }
function loadCredential(deps: OnboardDeps, origin: string): SavedCredential | undefined {
  const value = readOwnerOnly(join(chertHome(deps), 'credentials.json')) as Partial<SavedCredential> | undefined;
  if (!value || typeof value.expires_at !== 'number' || value.expires_at <= deps.now()) return undefined;
  if (value.kind === 'cli' && typeof value.access_token === 'string' && CREDENTIAL.test(value.access_token) && typeof value.project_id === 'string' && UUID.test(value.project_id) && (value.origin ?? DEFAULT_ORIGIN) === origin)
    return { ...value, origin } as SavedCredential;
  throw new OnboardError('existing_signin_conflict', 'This computer is already signed in to Chert another way. Run chert logout, or set CHERT_HOME to another folder, then run this again.');
}

interface PendingLogin { device_code: string; expires_at: number; interval: number; numbers: string[] }
const pendingFile = (deps: OnboardDeps, origin: string) => join(chertHome(deps), 'onboarding', `phone-login-${digest([origin])}.json`);
function loadPending(deps: OnboardDeps, origin: string): PendingLogin | undefined {
  const value = readOwnerOnly(pendingFile(deps, origin)) as Partial<PendingLogin> | undefined;
  if (!value || typeof value.device_code !== 'string' || typeof value.expires_at !== 'number' || typeof value.interval !== 'number' || !Array.isArray(value.numbers)) return undefined;
  return value.expires_at > deps.now() ? value as PendingLogin : undefined;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

interface OnboardingResume { request_key: string; session_id?: string }
const resumeName = (origin: string, project: string) => `${digest([origin, project])}.json`;
function loadResume(deps: OnboardDeps, origin: string, project: string): OnboardingResume {
  const dir = join(chertHome(deps), 'onboarding'), value = readOwnerOnly(join(dir, resumeName(origin, project))) as Partial<OnboardingResume> | undefined;
  if (value && typeof value.request_key === 'string' && UUID.test(value.request_key)) return value as OnboardingResume;
  const created = { request_key: randomUUID() };
  saveResume(deps, origin, project, created);
  return created;
}
function saveResume(deps: OnboardDeps, origin: string, project: string, value: OnboardingResume) {
  writeOwnerOnly(join(chertHome(deps), 'onboarding'), resumeName(origin, project), JSON.stringify(value) + '\n');
}

const actions: Record<string, string> = {
  phone_login_expired: 'This sign-in expired. Run chert-sdk onboard again.',
  phone_login_not_found: 'This sign-in is no longer valid. Run chert-sdk onboard again.',
  phone_login_rate_limited: 'Too many sign-ins from here. Wait a few minutes and run chert-sdk onboard again.',
  phone_login_unavailable: 'This number cannot sign in this way. Sign in with chert login --browser, or try again later.',
  shared_worker_upgrade_required: 'This line has not passed shared-call qualification. Your onboarding state is saved; retry later.',
  line_busy: 'The line is serving a call or awaiting cleanup. Run chert-sdk onboard again shortly.',
  outbound_unavailable: 'The assigned line cannot place the hosted demo yet. Your verification is saved; contact Chert support.',
  shared_line_incompatible: 'This line has not passed shared-call qualification. Your onboarding state is saved; contact Chert support.',
  shared_cleanup_pending: 'The line is waiting for cleanup of its previous call. Run chert-sdk onboard again shortly.',
  outbound_audio_unsupported: 'The assigned line cannot place the audio demo right now. Your verification is saved; contact Chert support.',
  outbound_video_unsupported: 'The assigned line cannot place the video demo right now. Your verification is saved; contact Chert support.',
  outbound_disabled: 'The hosted demo is temporarily unavailable. Your verification is saved; run chert-sdk onboard again later.',
  trial_exhausted: 'This account has already used its trial. Restarting does not reset it.',
  shared_trial_exhausted: 'This account has already used its trial. Your project is saved; restarting does not reset the trial.',
  shared_trial_unconfigured: 'Trial onboarding is not open yet. Your request is saved; retry later.',
  shared_entitlement_expired: 'This project\'s access expired. Your project is saved; review billing to reactivate it.',
  shared_allocation_draining: 'The previous allocation still has cleanup or usage to settle. Your project is saved; retry later.',
  trial_auth_required: 'This account cannot request a trial yet. Contact Chert support.',
  shared_trial_auth_required: 'This account cannot request a trial yet. Contact Chert support.',
  shared_no_capacity: 'Every shared slot is in use. Your request is saved; run chert-sdk onboard again later.',
  shared_allocation_unavailable: 'The shared allocation is no longer available. Run chert-sdk onboard again.',
  shared_project_has_dedicated_line: 'This project already has a dedicated line. Use chert dev for it.',
  shared_session_expired: 'This onboarding expired or was cancelled. Run chert-sdk onboard again.',
  shared_pool_unavailable: 'Shared onboarding is not enabled for this project yet.',
  shared_recipient_conflict: 'This number already routes to another project on the assigned line. Choose another number or contact Chert support.',
  recipient_verification_required: 'Your number is not verified yet. Run chert-sdk onboard again.',
  recipient_not_verified: 'Your number is not verified yet. Run chert-sdk onboard again.',
  recipient_confirmation_pending: 'Verification is finishing. Run chert-sdk onboard again shortly.',
  free_credit_required: 'This project needs FaceTime credit before the demo can run.',
  credit_exhausted: 'This project is out of FaceTime credit. Your verification is saved.',
  shared_minutes_limit: 'This project has used today\'s FaceTime allowance. Retry after the next UTC day starts.',
  shared_contact_limit: 'This project has reached its contact limit.',
  shared_quota_exceeded: 'This project has reached its shared usage allowance. Retry after it resets.',
  shared_line_busy: 'The line is serving a call or awaiting cleanup. Run chert-sdk onboard again shortly.',
  onboarding_expired: 'This onboarding expired. Run chert-sdk onboard again.',
  demo_unavailable: 'The hosted demo is not available on this line yet. Your verification is saved; retry later.',
  verification_rate_limited: 'Wait a moment, then run chert-sdk onboard again.',
};

interface Session {
  id: string; status: string; expires_at?: string;
  line: { id: string; receiving_number: string };
  demo_call_id?: string | null;
  demo_queue?: { state?: string; position?: number | null; message?: string };
}

class Api {
  constructor(private readonly deps: OnboardDeps, private readonly origin: string) {}
  async call(path: string, options: { method?: string; body?: unknown; token?: string; project?: string; key?: string } = {}): Promise<{ status: number; data: unknown; code?: string }> {
    let response: Response;
    try {
      response = await this.deps.fetch(new URL(path, this.origin), {
        method: options.method ?? 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.project ? { 'x-chert-project-id': options.project } : {}),
          ...(options.key ? { 'idempotency-key': options.key } : {}) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch { throw new OnboardError('backend_unreachable', 'Could not reach Chert. Run chert-sdk onboard again to continue.'); }
    let body: { data?: unknown; error?: { code?: unknown } } | null = null;
    try { body = JSON.parse((await response.text()).slice(0, 65536)); } catch {}
    const code = typeof body?.error?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(body.error.code) ? body.error.code : undefined;
    return { status: response.status, data: body?.data, ...(code ? { code } : {}) };
  }
  async require(path: string, options: Parameters<Api['call']>[1] = {}): Promise<unknown> {
    const result = await this.call(path, options);
    if (result.status >= 200 && result.status < 300 && result.data !== undefined) return result.data;
    throw failure(result);
  }
}
function failure(result: { status: number; code?: string }): OnboardError {
  if (result.code && Object.hasOwn(actions, result.code)) return new OnboardError(result.code, actions[result.code]!);
  if (result.status === 401) return new OnboardError('login_required', 'Your Chert sign-in expired or was revoked. Run chert-sdk onboard again.');
  if (result.status === 404 || result.status === 405) return new OnboardError('onboarding_unavailable', 'This Chert server does not offer automated onboarding yet. Nothing more was sent.');
  return new OnboardError('onboarding_not_ready', 'Chert could not continue onboarding. Run chert-sdk onboard again to continue the same request.');
}
const invalid = () => new OnboardError('backend_response_invalid', 'Chert returned an unexpected response. Nothing further was sent.');

function parseSession(value: unknown): Session {
  const session = value as Partial<Session> | null;
  if (!session || typeof session.id !== 'string' || !UUID.test(session.id) || typeof session.status !== 'string' || typeof session.line?.receiving_number !== 'string' || !E164.test(session.line.receiving_number)) throw invalid();
  return session as Session;
}

async function sendFromMessages(deps: OnboardDeps, text: string, to: string) {
  if (!OUTGOING_MESSAGE.test(text) || !E164.test(to)) throw invalid();
  const args = [...SEND_SCRIPT.flatMap(line => ['-e', line]), text, to];
  try { await deps.exec('osascript', args, 30_000); }
  catch (error) {
    const detail = `${(error as { stderr?: unknown }).stderr ?? ''}`;
    if (/-1743|not authori[sz]ed/i.test(detail)) throw new OnboardError('messages_permission_denied', 'macOS blocked access to Messages. Allow it in System Settings > Privacy & Security > Automation, under your terminal app, then run this again.');
    throw new OnboardError('messages_send_failed', 'Messages could not send the code. Open Messages, check you are signed in to iMessage, then run this again.');
  }
}

async function login(deps: OnboardDeps, api: Api, origin: string, emit: Emit, selected: string[], manual: boolean): Promise<{ credential: SavedCredential; verified: string[] }> {
  let pending = loadPending(deps, origin);
  const file = pendingFile(deps, origin);
  if (pending && (pending.numbers.length !== selected.length || pending.numbers.some(number => !selected.includes(number)))) { rmSync(file, { force: true }); pending = undefined; }
  if (!pending) {
    const started = await api.require('/api/v1/phone-logins', { body: { device_name: deviceName(deps), numbers: selected, ...(manual ? { manual: true } : {}) } }) as
      { device_code?: unknown; receiving_number?: unknown; challenges?: unknown; expires_in?: unknown; interval?: unknown };
    const challenges = started.challenges as { number?: unknown; message?: unknown }[];
    if (typeof started.device_code !== 'string' || !DEVICE_CODE.test(started.device_code) || typeof started.receiving_number !== 'string' || !E164.test(started.receiving_number)
      || !Array.isArray(challenges) || typeof started.expires_in !== 'number' || typeof started.interval !== 'number'
      || challenges.length !== selected.length || selected.some(number => !challenges.some(c => c.number === number))
      || challenges.some(c => typeof c.message !== 'string' || !OUTGOING_MESSAGE.test(c.message))) throw invalid();
    for (const challenge of challenges) {
      if (manual) { emit({ code: 'login_code_to_send', number: maskNumber(challenge.number as string), login_code: challenge.message, send_to: started.receiving_number, message: `Text ${challenge.message as string} to ${started.receiving_number} from ${challenge.number as string}. Chert continues as soon as it arrives.` }); continue; }
      await sendFromMessages(deps, challenge.message as string, started.receiving_number);
      emit({ code: 'login_code_sent', number: maskNumber(challenge.number as string), message: `Sent a sign-in code to Chert from Messages for ${maskNumber(challenge.number as string)}.` });
    }
    pending = { device_code: started.device_code, expires_at: deps.now() + started.expires_in * 1000, interval: started.interval, numbers: selected };
    writeOwnerOnly(join(chertHome(deps), 'onboarding'), `phone-login-${digest([origin])}.json`, JSON.stringify(pending) + '\n');
  } else emit({ code: 'login_resumed', message: 'Continuing the sign-in already in progress.' });

  const begun = deps.now(), deadline = manual ? pending.expires_at : Math.min(pending.expires_at, begun + LOGIN_WAIT_MS);
  let interval = Math.max(pending.interval, 1) * 1000, lastCount = 0, changedAt = begun;
  for (;;) {
    const stalled = lastCount > 0 && deps.now() - changedAt >= STALLED_AFTER_MS;
    const finish = stalled || deps.now() - begun >= FINISH_AFTER_MS;
    const result = await api.call('/api/v1/phone-logins/token', { body: { device_code: pending.device_code, ...(finish ? { finish: true } : {}) } })
      .catch((error: unknown) => { if (error instanceof OnboardError && error.code === 'backend_unreachable') return null; throw error; });
    if (result) {
      if (result.code === 'slow_down') interval += 1000;
      else if (result.status >= 400) { if (['phone_login_expired', 'phone_login_not_found'].includes(result.code ?? '')) rmSync(file, { force: true }); throw failure(result); }
      else {
        const answer = result.data as { status?: unknown; verified_count?: unknown; access_token?: unknown; project_id?: unknown; verified_numbers?: unknown; unlinked_numbers?: unknown; device_name?: unknown; expires_in?: unknown } | undefined;
        if (answer?.status === 'approved') return finishLogin(deps, origin, file, emit, pending, answer);
        if (answer?.status !== 'pending') throw invalid();
        const count = typeof answer.verified_count === 'number' ? answer.verified_count : 0;
        if (count !== lastCount) { lastCount = count; changedAt = deps.now(); }
      }
    }
    if (deps.now() >= deadline) {
      rmSync(file, { force: true });
      throw new OnboardError('verification_timeout', 'Chert did not receive a code from your number. Messages sends from the number under Messages > Settings > iMessage > Start New Conversations From, and a script cannot choose it. Set it to the number you picked, then run this again.');
    }
    await deps.sleep(interval);
  }
}

function finishLogin(deps: OnboardDeps, origin: string, file: string, emit: Emit, pending: PendingLogin, answer: { access_token?: unknown; project_id?: unknown; verified_numbers?: unknown; unlinked_numbers?: unknown; device_name?: unknown; expires_in?: unknown }) {
  if (typeof answer.access_token !== 'string' || !CREDENTIAL.test(answer.access_token) || typeof answer.project_id !== 'string' || !UUID.test(answer.project_id)
    || typeof answer.expires_in !== 'number' || !Array.isArray(answer.verified_numbers) || !answer.verified_numbers.length || answer.verified_numbers.some(number => !pending.numbers.includes(number as string))) throw invalid();
  const credential: SavedCredential = { access_token: answer.access_token, expires_at: deps.now() + answer.expires_in * 1000, kind: 'cli', project_id: answer.project_id, device_name: typeof answer.device_name === 'string' ? answer.device_name.slice(0, 200) : deviceName(deps), origin };
  writeOwnerOnly(chertHome(deps), 'credentials.json', JSON.stringify(credential) + '\n');
  rmSync(file, { force: true });
  const verified = answer.verified_numbers as string[];
  const unverified = pending.numbers.filter(number => !verified.includes(number));
  const unlinked = Array.isArray(answer.unlinked_numbers) ? answer.unlinked_numbers.filter((n): n is string => typeof n === 'string') : [];
  emit({ code: 'signed_in', project_id: answer.project_id, verified: verified.map(maskNumber), unverified: unverified.map(maskNumber), unlinked: unlinked.map(maskNumber),
    message: `Signed in with ${verified.map(maskNumber).join(' and ')}.`
      + (unverified.length ? ` ${unverified.map(maskNumber).join(' and ')} did not verify: Messages sends from one number at a time, set under Messages > Settings > iMessage > Start New Conversations From. Change it and run this again to add the other number.` : '')
      + (unlinked.length ? ` ${unlinked.map(maskNumber).join(' and ')} already belongs to another Chert account, so it was not added.` : '') });
  const linked = verified.filter(number => !unlinked.includes(number));
  if (!linked.length) throw invalid();
  return { credential, verified: linked };
}

function deviceName(deps: OnboardDeps): string {
  const printable = deps.deviceName.replace(/[^ -~]/g, '').trim().slice(0, 80);
  return printable || 'Mac';
}

async function onboarding(deps: OnboardDeps, api: Api, origin: string, emit: Emit, credential: SavedCredential, recipient: string, others: number, skipDemo: boolean) {
  const auth = { token: credential.access_token, project: credential.project_id };
  const resume = loadResume(deps, origin, credential.project_id);
  const started = async () => {
    const session = parseSession(await api.require('/api/v1/onboarding', { ...auth, body: {}, key: resume.request_key }));
    resume.session_id = session.id;
    saveResume(deps, origin, credential.project_id, resume);
    return session;
  };
  let session = resume.session_id ? parseSession(await api.require(`/api/v1/onboarding/${resume.session_id}`, { ...auth, method: 'GET' })) : await started();
  if (session.id !== (resume.session_id ?? session.id)) throw invalid();
  if (session.status === 'expired' || session.status === 'cancelled') {
    rmSync(join(chertHome(deps), 'onboarding', resumeName(origin, credential.project_id)), { force: true });
    throw new OnboardError(`onboarding_${session.status}`, 'This onboarding has ended. Run chert-sdk onboard again to start a new one.');
  }
  const allowance = await api.call('/api/v1/allowance', { ...auth, method: 'GET' }).catch(() => null);
  const trial = Object.fromEntries(Object.entries((allowance?.status === 200 && allowance.data) || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)));
  emit({ code: 'trial_status', session_id: session.id, status: session.status, allowance: trial, message: 'Shared access and your trial allowance are set up.' });

  if (session.status === 'awaiting_verification') {
    const challenge = await api.require(`/api/v1/onboarding/${session.id}/verify`, { ...auth, body: { recipient }, key: `${resume.request_key}:verify` }) as { code?: unknown; verified?: unknown };
    // A number that just proved itself at sign-in needs no second message.
    let wait = challenge.verified === true ? 0 : 2000;
    if (challenge.verified !== true) {
      if (typeof challenge.code !== 'string' || !/^\d{6}$/.test(challenge.code)) throw invalid();
      await sendFromMessages(deps, challenge.code, session.line.receiving_number);
      emit({ code: 'verification_sent', number: maskNumber(recipient), message: `Sent the call verification code from Messages for ${maskNumber(recipient)}.` });
    }
    const deadline = deps.now() + SESSION_WAIT_MS;
    while (session.status === 'awaiting_verification') {
      if (deps.now() >= deadline) throw new OnboardError('verification_timeout', 'Chert did not confirm the code. Check that Messages sends from the number you picked, then run this again.');
      await deps.sleep(wait);
      wait = 2000;
      session = parseSession(await api.require(`/api/v1/onboarding/${session.id}`, { ...auth, method: 'GET' }));
    }
  }
  if (skipDemo) { emit({ code: 'demo_skipped', status: session.status, message: 'Skipped the demo call.' }); return; }
  if (session.status === 'ready') session = parseSession(await api.require(`/api/v1/onboarding/${session.id}/demo`, { ...auth, body: { when_busy: 'queue' }, key: resume.request_key }));
  const deadline = deps.now() + SESSION_WAIT_MS;
  let reported: number | null | undefined;
  while (session.status === 'ready' && session.demo_queue && deps.now() < deadline) {
    if (session.demo_queue.position !== reported) {
      reported = session.demo_queue.position;
      emit({ code: 'demo_queued', position: reported ?? null, message: `The shared line is busy. Waiting in line${typeof reported === 'number' ? ` at position ${reported}` : ''}.` });
    }
    if (!['waiting', 'ready', 'placing'].includes(session.demo_queue.state ?? '')) break;
    await deps.sleep(3000);
    session = parseSession(await api.require(`/api/v1/onboarding/${session.id}`, { ...auth, method: 'GET' }));
  }
  const also = others > 0 ? ' Chert calls one number, so this goes to the first one verified.' : '';
  if (session.status === 'demo_running') emit({ code: 'demo_requested', call_id: session.demo_call_id ?? null, number: maskNumber(recipient), message: `Chert is calling ${maskNumber(recipient)}. Answer the FaceTime call to try the demo; the request being accepted does not confirm that audio or video worked.${also}` });
  else if (session.status === 'complete') emit({ code: 'demo_finished', call_id: session.demo_call_id ?? null, message: 'The demo call for this onboarding has already ended.' });
  else throw new OnboardError('demo_not_started', 'The demo call did not start yet. Run chert-sdk onboard again to continue.', session.demo_queue?.state ? { queue_state: session.demo_queue.state } : {});
}

export function detectProject(cwd: string): { stack: string; install_command: string | null; install_note?: string } | null {
  const names = readdirSync(cwd);
  const has = (name: string) => names.includes(name);
  if (has('package.json')) {
    const command = has('bun.lock') || has('bun.lockb') ? 'bun add @trychert/sdk' : has('pnpm-lock.yaml') ? 'pnpm add @trychert/sdk' : has('yarn.lock') ? 'yarn add @trychert/sdk' : 'npm install @trychert/sdk';
    return { stack: 'javascript', install_command: command };
  }
  if (has('pyproject.toml') || has('requirements.txt')) return { stack: 'python', install_command: has('uv.lock') ? 'uv add chert-sdk' : 'python -m pip install chert-sdk' };
  const preview = (stack: string) => ({ stack, install_command: null, install_note: `The ${stack} client is a source preview, not a published package. Build it from https://github.com/cherthq/sdk by following its language guide.` });
  if (has('Cargo.toml')) return preview('rust');
  if (has('go.mod')) return preview('go');
  if (names.some(name => name.endsWith('.csproj'))) return preview('dotnet');
  if (has('CMakeLists.txt')) return preview('cpp');
  if (has('.git')) return { stack: 'unknown', install_command: null, install_note: 'No supported language manifest was found. Pick a client from the setup guide.' };
  return null;
}

async function writeLocalEnv(deps: OnboardDeps, credential: SavedCredential): Promise<{ written: boolean; reason?: string }> {
  try { await deps.exec('git', ['-C', deps.cwd, 'check-ignore', '-q', '--', '.env.local'], 10_000); }
  catch { return { written: false, reason: 'git does not ignore .env.local here, so the credential was not written. Add .env.local to .gitignore and run this again, or set the variables another way.' }; }
  const file = join(deps.cwd, '.env.local');
  const wanted: Record<string, string> = { CHERT_FACETIME_TOKEN: credential.access_token, CHERT_PROJECT_ID: credential.project_id };
  let lines: string[] = [];
  if (existsSync(file)) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { written: false, reason: '.env.local is not a regular file, so it was left alone.' };
    lines = readFileSync(file, 'utf8').split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const line of lines) {
      const match = /^\s*(?:export\s+)?(CHERT_FACETIME_TOKEN|CHERT_PROJECT_ID)=(.*)$/.exec(line);
      if (match && match[2]!.trim().replace(/^["']|["']$/g, '') !== wanted[match[1]!]) return { written: false, reason: `.env.local already sets ${match[1]} to something else, so it was left alone.` };
      if (match) delete wanted[match[1]!];
    }
  }
  const added = Object.entries(wanted).map(([name, value]) => `${name}=${value}`);
  if (!added.length) return { written: true };
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, [...lines, ...added].join('\n') + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
  chmodSync(file, 0o600);
  return { written: true };
}

async function wireIn(deps: OnboardDeps, emit: Emit, credential: SavedCredential, project: NonNullable<ReturnType<typeof detectProject>>) {
  const env = await writeLocalEnv(deps, credential);
  const docs = { setup: `${DOCS}/docs/SETUP.md`, llms: `${DOCS}/llms.txt`, readme: `${DOCS}/README.md` };
  const prompt = `Wire Chert FaceTime into this ${project.stack === 'unknown' ? '' : `${project.stack} `}project. ${project.install_command ? `Install the SDK with \`${project.install_command}\`.` : project.install_note ?? ''} Read ${docs.llms} and ${docs.setup} first, and run \`chert-sdk context\` to see the account. Read CHERT_FACETIME_TOKEN and CHERT_PROJECT_ID from the environment${env.written ? ' (they are in .env.local)' : ''}; never commit them or print them. Follow this project's existing conventions, and test against a real call before saying it works.`;
  emit({ code: 'wire_in', stack: project.stack, install_command: project.install_command, ...(project.install_note ? { install_note: project.install_note } : {}),
    env_vars: ['CHERT_FACETIME_TOKEN', 'CHERT_PROJECT_ID'], env_local_written: env.written, ...(env.reason ? { env_local_reason: env.reason } : {}), docs, prompt,
    message: `Project found (${project.stack}). ${env.written ? 'The credential is in .env.local.' : env.reason}\nPaste this to your coding agent:\n\n${prompt}` });
}

async function setupAgentCli(deps: OnboardDeps, emit: Emit): Promise<boolean> {
  const next = ['chert doctor', 'chert dev'];
  const ready = () => emit({ code: 'personal_agent_ready', next_commands: next, message: `No project here, so the personal agent CLI is what you need. Next: ${next.join(', then ')}.` });
  try { await deps.exec('chert', ['--version'], 15_000); ready(); return true; } catch {}
  const command = `npm install -g ${AGENT_CLI}@beta`;
  try { await deps.exec('npm', ['view', AGENT_CLI, 'version'], 30_000); }
  catch {
    emit({ code: 'personal_agent_cli_unavailable', message: `Could not find ${AGENT_CLI} with npm. Your Chert sign-in is saved. Install Node, then run: ${command}` });
    return false;
  }
  try { await deps.exec('npm', ['install', '-g', `${AGENT_CLI}@beta`], 300_000); ready(); return true; }
  catch {
    emit({ code: 'personal_agent_cli_unavailable', install_command: command, message: `The install failed. Your Chert sign-in is saved. Run it yourself: ${command}` });
    return false;
  }
}

type Emit = (record: { code: string; message: string; [key: string]: unknown }) => void;

function hostedOrigin(value: string | undefined): string {
  const text = value?.trim();
  if (!text) return DEFAULT_ORIGIN;
  let url: URL;
  try { url = new URL(text); } catch { throw new OnboardError('invalid_origin', 'CHERT_FACETIME_URL must be https://HOST.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new OnboardError('invalid_origin', 'CHERT_FACETIME_URL must be https://HOST.');
  return url.origin;
}

/** A number Messages cannot send for: the person says which and texts the code themselves. */
async function askForNumber(deps: OnboardDeps, flags: { numbers?: string; json: boolean }): Promise<string[]> {
  const answer = flags.numbers ?? (!flags.json && deps.interactive ? await deps.prompt('No number found in Messages. What is your phone number? ') : undefined);
  if (answer === undefined) throw noNumbers();
  const number = e164(answer.trim());
  if (!number) throw new OnboardError('invalid_numbers', 'Use your number with its + country code. Nothing was sent.');
  return [number];
}

// Running the command is the agreement. Only a real choice between numbers stops to ask.
async function choose(deps: OnboardDeps, detected: string[], flags: { numbers?: string; yes: boolean; json: boolean }): Promise<string[]> {
  if (flags.numbers !== undefined) return parseSelection(flags.numbers, detected);
  if (flags.yes || detected.length === 1) return detected;
  if (flags.json || !deps.interactive) throw new OnboardError('numbers_required', 'Ask the user which to use, then rerun with --numbers 1,2 (positions or +numbers), --numbers all, or --yes for all. A message is sent from their Messages app for each.', { numbers: detected.map((number, index) => ({ index: index + 1, number: maskNumber(number) })) });
  deps.out('This Mac has these numbers:');
  detected.forEach((number, index) => deps.out(`  ${index + 1}) ${number}`));
  return parseSelection(await deps.prompt(`Which should Chert use? Enter ${detected.map((_, index) => index + 1).join(', ')} or all: `), detected);
}

export async function runOnboard(args: string[], deps: OnboardDeps = defaultDeps()): Promise<number> {
  let json = args.includes('--json');
  const emit: Emit = record => { deps.out(json ? JSON.stringify(record) : record.message); };
  try {
    let values;
    try { ({ values } = parseArgs({ args, options: { numbers: { type: 'string' }, yes: { type: 'boolean' }, json: { type: 'boolean' }, 'skip-demo': { type: 'boolean' }, 'no-wire': { type: 'boolean' } } })); }
    catch { throw new OnboardError('invalid_request', 'Use --numbers +A,+B, --yes, --json, --skip-demo and --no-wire.'); }
    json = Boolean(values.json);
    if (deps.platform !== 'darwin') throw new OnboardError('macos_required', 'Automated onboarding reads your number from Messages, so it needs a Mac. On another computer use chert login from @trychert/facetime.');
    const origin = hostedOrigin(deps.env.CHERT_FACETIME_URL);
    const detected = await detectNumbers(deps);
    emit({ code: 'numbers_detected', numbers: detected.map(maskNumber), message: `Found ${detected.length} number${detected.length === 1 ? '' : 's'} in Messages.` });
    const chosen = values.numbers !== undefined ? { numbers: values.numbers } : {};
    const manual = !detected.length;
    const selected = manual ? await askForNumber(deps, { ...chosen, json }) : await choose(deps, detected, { ...chosen, yes: Boolean(values.yes), json });
    const api = new Api(deps, origin);
    const saved = loadCredential(deps, origin);
    const signedIn = saved ? { credential: saved, verified: selected } : await login(deps, api, origin, emit, selected, manual);
    if (saved) emit({ code: 'signed_in', project_id: saved.project_id, message: 'Using this computer\'s existing Chert sign-in.' });
    const recipient = signedIn.verified[0]!;
    let stopped: unknown;
    try { await onboarding(deps, api, origin, emit, signedIn.credential, recipient, signedIn.verified.length - 1, Boolean(values['skip-demo'])); }
    catch (error) {
      if (error instanceof OnboardError && error.code === 'login_required') { rmSync(join(chertHome(deps), 'credentials.json'), { force: true }); throw error; }
      stopped = error;
    }
    let wired = true;
    if (!values['no-wire']) {
      const project = detectProject(deps.cwd);
      if (project) await wireIn(deps, emit, signedIn.credential, project);
      else wired = await setupAgentCli(deps, emit);
    }
    if (stopped) throw stopped;
    return wired ? 0 : 1;
  } catch (error) {
    const known = error instanceof OnboardError ? error : new OnboardError('onboarding_failed', 'Onboarding stopped. Nothing further was sent. Run chert-sdk onboard again to continue.');
    deps.err(json ? JSON.stringify({ code: known.code, error: known.message, ...known.detail }) : known.message);
    return 1;
  }
}
