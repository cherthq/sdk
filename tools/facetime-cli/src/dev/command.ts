import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { parseConfig, type ByorConfig } from '../cli/config.js';
import { CLIError } from '../cli/errors.js';
import { credentialStore, logout, whoami, type Credential } from '../cli/login.js';
import { byorJournalSchema, complete } from '../byor/journal.js';
import type { ByorHandler } from '../byor/contract.js';
import { hostedOrigin } from '../transport/http.js';
import { claimLine, controlClient, releaseLine, sessionName, type Control } from './claim.js';
import { onboardingSaved } from './onboard.js';
import { slotFrom, trackCalls, watchSlot, type Slot } from './slot.js';
import { renderChecks, runDoctor } from './doctor.js';
import { clearDevSetup, devSettings, placeholders, saveDevSetup, unfilledSentence } from './setup.js';
import { deviceLogin, deviceLoginDeps, deviceName, revokeCredential, type DeviceLoginDeps } from './device-login.js';
import { readHidden, renderHome, showWelcome, type SignInChoice, type Terminal } from './welcome.js';
import { renderConnected, showWaiting, type WaitingScreen } from './sign-in-screen.js';
import { renderSession } from './session-screen.js';
import { CLEAR_SCREEN, glyphs, header, INDENT, innerWidth, lookOf, palette, printable, sizeOf, wrap, type Look } from './frame.js';
import { cliVersion } from '../cli/version.js';
import type { DevEvent, DevHandler, DispatchAPI } from './dispatch-handler.js';

export { developerCommands } from '../cli/names.js';
const CONTROL_ORIGIN = 'https://facetime.trychert.com';
const RELAY_ORIGIN = 'https://connector-relay-production.up.railway.app';
type Emit = (data: Record<string, unknown>) => void;
/** The agent_name a LiveKit agent registers with, as chert dev and chert doctor accept it. */
const AGENT_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;
const checkAgent = (name: string) => { if (!AGENT_PATTERN.test(name)) throw new CLIError('invalid_agent_name', 2, 'Agent names use letters, digits, dot, dash and underscore (at most 80).'); };

function flags(args: string[], valued: string[], booleans: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!.startsWith('--') ? args[i]!.slice(2) : '';
    if (!key || key in values || !(valued.includes(key) || booleans.includes(key) || key === 'json')) throw new CLIError('invalid_usage', 2, 'Unknown or duplicate flag. Use chert --help.');
    if (valued.includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new CLIError('missing_input', 2, `Provide a value for --${key}.`);
      values[key] = value;
    } else values[key] = 'true';
  }
  return values;
}
function chertHome(env: NodeJS.ProcessEnv): string {
  const home = env.CHERT_HOME ?? join(homedir(), '.chert');
  mkdirSync(home, { recursive: true, mode: 0o700 }); chmodSync(home, 0o700);
  return home;
}
/** A Supabase session token: three JWT parts with a future expiry. The signature is checked by Chert, not here. */
function sessionClaims(token: string): { exp: number; email?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !p) || /\s/.test(token)) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { exp?: unknown; email?: unknown };
    if (!Number.isInteger(claims.exp) || (claims.exp as number) * 1000 <= Date.now()) throw new Error();
    // The token is not verified here, so what it says about the person is treated as untrusted text before it is shown or stored.
    const email = typeof claims.email === 'string' ? printable(claims.email, 320) : undefined;
    return { exp: claims.exp as number, ...(email ? { email } : {}) };
  } catch { throw new CLIError('invalid_token', 2, 'That is not a current Chert session token. Copy a fresh one and try again.'); }
}

/** What `chert login` needs from the outside world; tests replace it. */
export interface LoginDeps {
  /** Present only when both ends are a terminal: the welcome screen and the hidden prompt need one. */
  terminal?: Terminal;
  /** True when standard input is the keyboard, whether or not the screens can be drawn. A token is never read from it. */
  keyboard: boolean;
  readPipe(): string;
  remote: boolean;
  device: DeviceLoginDeps;
  welcome: typeof showWelcome;
  /** The hidden prompt a pasted session token is read at. */
  readHidden: typeof readHidden;
  /** The screen shown while Chert waits for the approval. */
  waiting: typeof showWaiting;
  /** Revoke a command-line credential at the Chert address that issued it. Resolves once Chert confirms it is no longer live. */
  revoke(origin: string, token: string): Promise<unknown>;
}
/** The terminal the welcome screen may take over, or nothing when the output is piped, machine-read or too simple. */
export function terminalFor(env: NodeJS.ProcessEnv, json: boolean, input: NodeJS.ReadStream, output: NodeJS.WriteStream): Terminal | undefined {
  if (json || input.isTTY !== true || output.isTTY !== true || env.TERM === 'dumb') return undefined;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  // Chinese, Japanese and Korean terminals often draw box drawing two cells wide; those get ASCII rules and keep the braille.
  return { input, output, color: !env.NO_COLOR, truecolor: /truecolor|24bit/i.test(env.COLORTERM ?? ''), unicode: !locale || /utf-?8/i.test(locale), ...(/^(zh|ja|ko)/i.test(locale ?? '') ? { ambiguous: true } : {}) };
}
function loginDeps(env: NodeJS.ProcessEnv, json: boolean): LoginDeps {
  const terminal = terminalFor(env, json, process.stdin, process.stdout);
  return { ...(terminal ? { terminal } : {}), keyboard: process.stdin.isTTY === true, readPipe: () => readFileSync(0, 'utf8'), remote: Boolean(env.SSH_CONNECTION || env.SSH_TTY),
    device: deviceLoginDeps, welcome: showWelcome, readHidden, waiting: showWaiting, revoke: revokeCredential };
}
const nextStep = 'Next: chert dev in your agent\'s folder   (chert doctor checks your setup first; chert guide explains it)';
/** What a developer does after signing in, in the order they will need it. */
const afterSignIn = [
  ['chert dev', 'In your agent\'s folder: put it on the line'],
  ['chert doctor', 'Check sign-in, LiveKit keys, the line and your agent'],
  ['chert guide', 'How it works, video agents, sharing a line'],
  ['chert logout', 'Disconnect this computer'],
] as const;
/** The hidden prompt for a pasted session token, on a cleared screen in the same dress as the other screens. */
function tokenPrompt(look: Look, version: string | undefined): string {
  const p = palette(look), g = glyphs(look), width = innerWidth(look);
  return CLEAR_SCREEN + ['', ...header('Sign in', version, look), '',
    ...wrap('Paste your Chert session token. It stays hidden. Enter saves it, escape cancels.', width).map(line => INDENT + line),
    ...wrap('It is the bearer token of your signed-in dashboard session and lasts about an hour.', width).map(line => INDENT + p.dim(line)),
    '', `${INDENT}${p.accent(g.pointer)} `].join('\n');
}

export async function login(args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, emit: Emit, deps: LoginDeps = loginDeps(env, args.includes('--json'))): Promise<number> {
  const values = flags(args, ['backend'], ['with-token', 'device']);
  const store = credentialStore(chertHome(env));
  const version = cliVersion();
  // In a terminal the result is the signed-in screen, drawn for the window as it is then; a pipe or --json gets one line.
  const lookNow = () => deps.terminal ? lookOf(deps.terminal) : undefined;
  const connected = (fields: { email?: string; project?: string; device?: string; expiresAt: number; note?: string; warning?: string }, fallback: string) => {
    const look = lookNow();
    return look ? renderConnected({ ...look, subtitle: 'Sign in', ...(version ? { version } : {}), ...fields, commands: afterSignIn }) : fallback;
  };
  /**
   * Save the new credential, then revoke the command-line credential it replaces so it does not live on for 30 days.
   * A revoke that did not go through never fails the sign-in, but it is said: nothing else ends that credential early.
   */
  const replace = async (next: Credential): Promise<{ previous_revoked?: boolean; warning?: string }> => {
    const previous = store.load();
    store.save(next);
    if (previous?.kind !== 'cli' || previous.access_token === next.access_token) return {};
    const revoked = await deps.revoke(previous.origin ?? CONTROL_ORIGIN, previous.access_token).then(() => true, () => false);
    return { previous_revoked: revoked, ...(revoked || previous.expires_at <= Date.now() ? {} : { warning: 'The earlier command-line credential on this computer could not be revoked at Chert: '
      + `it stops working on ${new Date(previous.expires_at).toISOString().slice(0, 10)}. A project owner or admin can revoke it sooner from the Chert dashboard.` }) };
  };
  const saveToken = async (raw: string) => {
    const token = raw.trim();
    const claims = sessionClaims(token);
    const { warning, ...replaced } = await replace({ access_token: token, expires_at: claims.exp * 1000, ...(claims.email ? { email: claims.email } : {}) });
    emit({ code: 'signed_in', ...(claims.email ? { email: claims.email } : {}), expires_at: claims.exp * 1000, ...replaced,
      message: connected({ ...(claims.email ? { email: claims.email } : {}), expiresAt: claims.exp * 1000, ...(warning ? { warning } : {}),
        note: 'A dashboard session token: it lasts about an hour and is not bound to a project, so chert dev takes --project or the project saved by chert setup.' },
      `Signed in${claims.email ? ` as ${claims.email}` : ''}.${warning ? `\n${warning}` : ''}`) });
    return 0;
  };
  if (values['with-token']) {
    if (values.device || values.backend) throw new CLIError('invalid_usage', 2, 'Use --with-token alone: chert login --with-token < token.txt');
    // Judged on the input alone: --json, TERM=dumb or a piped output take the screens away, not the keyboard.
    if (deps.keyboard) throw new CLIError('login_input_required', 2, 'Pipe the token in: chert login --with-token < token.txt (it is not read from the keyboard).');
    return await saveToken(deps.readPipe());
  }
  const origin = values.backend ?? env.CHERT_CONTROL_ORIGIN ?? CONTROL_ORIGIN;
  // The screens are for a terminal without --device. With --device only the code is printed, for a shell that cannot show more.
  const screen = deps.terminal && !values.device ? deps.terminal : undefined;
  // While Chert waits for the approval the screen shows the code, the address and a countdown, and escape cancels.
  // Without the screen the records are printed as before, and --json still gets every one of them.
  const local = new AbortController();
  let waiting: WaitingScreen | undefined, note: string | undefined;
  const relay: Emit = record => {
    if (!screen) { emit(record); return; }
    if (record.code === 'login_browser_unavailable') { note = String(record.message); return; }
    if (record.code === 'login_code') {
      waiting = deps.waiting(screen, { code: String(record.user_code), url: String(record.verification_url), urlComplete: String(record.verification_url_complete),
        expiresIn: Number(record.expires_in), opened: Boolean(record.browser_opened), remote: deps.remote, ...(note ? { note } : {}) }, () => local.abort());
      return;
    }
    emit(record);
  };
  let credential: Credential | undefined, back: { note: string; selected: number } | undefined;
  while (!credential) {
    let choice: SignInChoice = 'browser';
    if (screen) {
      const chosen = await deps.welcome(screen, deps.remote, version, signal, back);
      if (!chosen) throw new CLIError('login_cancelled', 130, 'Sign-in cancelled. Nothing was saved.');
      choice = chosen;
    }
    if (choice === 'token') {
      const pasted = await deps.readHidden(screen!, tokenPrompt(lookNow()!, version), signal);
      if (pasted === null) throw new CLIError('login_cancelled', 130, 'Sign-in cancelled. Nothing was saved.');
      // The prompt has done its work: the result, or the error, gets a clean screen.
      screen!.output?.write(CLEAR_SCREEN);
      return await saveToken(pasted);
    }
    // Over SSH a browser would open on the wrong computer: the address and code are shown instead.
    try { credential = await deviceLogin({ origin, deviceName: deviceName(), openBrowser: Boolean(screen) && !deps.remote, signal: AbortSignal.any([signal, local.signal]), emit: relay }, deps.device); }
    catch (error) {
      if (!screen) throw error;
      // The menu is still on screen and the other choice still works: go back to it rather than end on advice about a pipe.
      if (error instanceof CLIError && error.code === 'login_unsupported') { back = { note: 'This Chert server does not offer browser sign-in yet. Press 2 to paste a token.', selected: 1 }; continue; }
      // Taking the waiting screen down clears it. Before a code was shown only the menu is up, and the error line gets a clean screen too.
      if (!waiting) screen.output?.write(CLEAR_SCREEN);
      throw error;
    }
    finally { waiting?.stop(); }
  }
  const { warning, ...replaced } = await replace(credential);
  const who = credential.email ? ` as ${credential.email}` : ''; const where = credential.project_name ? ` · project ${credential.project_name}` : '';
  emit({ code: 'signed_in', ...(credential.email ? { email: credential.email } : {}), expires_at: credential.expires_at, project_id: credential.project_id,
    ...(credential.project_name ? { project: credential.project_name } : {}), ...replaced,
    message: connected({ ...(credential.email ? { email: credential.email } : {}), ...(credential.project_name ? { project: credential.project_name } : {}),
      ...(credential.device_name ? { device: credential.device_name } : {}), expiresAt: credential.expires_at, ...(warning ? { warning } : {}) },
    `\nSigned in${who}${where}.\n${warning ? `${warning}\n` : ''}${nextStep}`) });
  return 0;
}
/** True when a current credential is stored. Used to decide whether a bare `chert` shows the welcome screen. */
export function signedIn(env: NodeJS.ProcessEnv): boolean { return Boolean(env.CHERT_USER_ACCESS_TOKEN) || whoami(credentialStore(chertHome(env))).signed_in; }

/** LiveKit, the socket library and the handlers are loaded where a command first needs them: sign-in commands never do. */
const liveKit = () => import('./dispatch-handler.js');

async function check(url: string, key: string, secret: string): Promise<void> {
  const [{ liveKitDispatchAPI }, { ServerError }] = await Promise.all([liveKit(), import('livekit-server-sdk')]);
  try { await liveKitDispatchAPI(url, key, secret).listParticipants('chert-dev-preflight'); }
  catch (error) {
    if (error instanceof ServerError && error.status === 404) return;
    if (error instanceof ServerError && [401, 403].includes(error.status)) throw new CLIError('livekit_credentials_invalid', 3, 'LiveKit rejected LIVEKIT_API_KEY / LIVEKIT_API_SECRET for LIVEKIT_URL. Check they belong to the same project.');
    throw new CLIError('livekit_unreachable', 6, 'Could not reach LIVEKIT_URL. Check the address and the network.');
  }
}

const callMessages: Record<DevEvent['event'], (event: DevEvent) => string> = {
  incoming: event => event.video === undefined ? 'Incoming call.' : `Incoming FaceTime ${event.video ? 'Video' : 'Audio'} call.`,
  accepted: event => `Answered in ${((event.ms ?? 0) / 1000).toFixed(1)} s${event.warm ? '' : ' (the agent joined when the call arrived)'}.`,
  declined: event => `Call declined: ${event.reason === 'agent_did_not_join' ? 'the agent did not join in time. Is it running and registered under this name?' : event.reason === 'livekit_unreachable' ? 'LiveKit could not create the room.'
    : event.reason === 'muse_not_ready' ? 'Muse media was not confirmed ready for it (still preparing, already used by a call, its heartbeat or tracks stale, or LiveKit could not be read).' : 'the caller hung up.'}`,
  ended: () => 'Call ended.',
  media: event => mediaMessage(event),
  bridge_ready: event => event.room_signal ? 'FaceTime is ready. The room now carries chert_bridge_ready: your agent should greet within 10 s, or the call ends.'
    : 'FaceTime is ready, but LiveKit did not take the room update, so your agent was not told to greet. Check the LiveKit project and the network.',
};
const quoted = (names: string[] | undefined) => (names ?? []).map(name => `"${printable(name, 80) ?? '?'}"`).join(', ');
/** What the Mac will take from the call's room, as a sentence: what the caller gets, and what to change when it is not what was meant. */
export function mediaMessage(event: DevEvent): string {
  const who = `"${printable(event.publisher, 80) ?? '?'}"`;
  switch (event.state) {
    case 'ok': return event.video ? `Video and audio are coming from ${who}.` : `Audio is coming from ${who}.`;
    case 'no_video': return 'This is a FaceTime Video call and your agent publishes no video, so the caller sees the line\'s default picture. To show your agent, publish a camera track from the participant that speaks.';
    case 'video_unused': return 'Your agent publishes video, but this is a FaceTime Audio call, so the caller only hears it. Call with FaceTime Video to see it.';
    case 'no_audio': return 'Your agent is not publishing audio. The caller hears nothing until one participant publishes an unmuted audio track.';
    case 'several_audio': return `${event.publishers?.length ?? 2} participants publish audio (${quoted(event.publishers)}). The Mac needs exactly one, so it ends the call. With an avatar, let only the avatar speak.`;
    case 'several_tracks': return `${who} publishes more than one audio track. The Mac needs exactly one, so it ends the call.`;
    case 'video_elsewhere': return `Video comes from "${printable(event.from, 80) ?? '?'}" but audio from ${who}. The Mac shows video only from the participant that speaks, so the caller sees the line's default picture.`;
    default: return 'The call media could not be read.';
  }
}
/** Declines the connector makes on its own, before the handler is asked. Keys are protocol decline codes. */
const connectorDeclines: Record<string, string> = {
  cleanup_pending: 'unfinished work from an earlier call is still being cleaned up. It clears on its own; if it keeps happening, stop and run chert dev again.',
  agent_unavailable: 'the agent reported itself unavailable.',
  binding_standby: 'this session is not the active one for the line.',
  binding_draining: 'this session is draining and no longer answers calls.',
  relay_unavailable: 'the connection to Chert was lost while the call rang.',
  journal_unavailable: 'the call journal under the Chert home directory could not be written. Check disk space and permissions.',
  deadline_exceeded: 'the call reached this computer too late to answer. Check the network path to Chert, and that this computer sets its date and time automatically.',
  invalid_deadline: 'the call\'s timing did not fit this computer\'s clock, which is most likely behind Chert\'s. Set the date and time automatically (on a Linux virtual machine or WSL, resync the clock), then run chert dev again. If the clock is right, update the CLI.',
  terminal: 'Chert had already ended this call.',
  acceptance_uncertain: 'an earlier decision for this call is still unresolved.',
};
/** Declines the connector makes after the agent was asked: the handler was stopped, or its answer came too late. */
const preparationDeclines: Record<string, string> = {
  terminal: 'the caller hung up.',
  deadline_exceeded: 'the answer was not ready before Chert\'s deadline: LiveKit or the agent took too long.',
  relay_unavailable: 'the connection to Chert was lost while the call rang.',
};
/** What the terminal knows about one call. The connector's first decision is what Chert was told, so it decides between
 * "Answered" and a decline; the handler supplies the detail. A later decision for the same call (a redelivered frame) adds nothing.
 * The bound keeps memory flat over a long session. */
interface CallView { asked: boolean; accepted?: DevEvent; decided: boolean; told: boolean }
const CALLS_LIMIT = 256;

export interface DevInput {
  agent: string; livekitUrl: string; apiKey: string; apiSecret: string; controlOrigin: string; relayOrigin: string;
  project?: string; muse?: boolean; takeover: boolean; prewarm: boolean; sessionExpiresAt?: number;
  /** Take a line Chert says cannot take calls yet; the opening screen then carries the reason. */
  force?: boolean;
  /** The signed-in email, put in the session's name so a team sharing the line can see who holds it. */
  holder?: string;
  /** The end of the team's time slot: the session stops by itself then, once no call is in progress. */
  slot?: Slot;
}
export interface DevDeps {
  control: Control; api: DispatchAPI; home: string; env: NodeJS.ProcessEnv; signal: AbortSignal; emit: Emit;
  run(config: ByorConfig, env: NodeJS.ProcessEnv, signal: AbortSignal, emit: Emit, handler: ByorHandler): Promise<number>;
  /** Draws the opening screen of a session in a terminal. Absent in a pipe and with --json: the plain sentence is printed. */
  banner?(facts: { agent: string; line?: string; address?: string; project?: string }): string;
  warmIntervalMs?: number; warmBackoffMs?: number; warmTimeoutMs?: number; maxReconnects?: number; reconnectDelayMs?(attempt: number): number;
  /** How long one reconnect attempt may take to reach Chert before it is cut off and counted as a failure. */
  connectTimeoutMs?: number;
  /** How often the absent-agent warning repeats while the waiting room stays empty. */
  absentReminderMs?: number;
  /** How long a connection must hold before its loss stops counting as a failed attempt. */
  stableConnectionMs?: number;
  /** The wall clock a slot is measured on, and how often it is read. */
  now?(): number; slotCheckMs?: number;
}
/**
 * How long the waiting room is left before it is checked again. While the agent is absent the check is every 10 s: each
 * check opens a waiting room and waits up to 20 s for the agent, so an agent restarted between calls (to load new code,
 * say) is back on the line within about 30 s. The checks go to the team's own LiveKit project, not to Chert.
 * Muse checks every second throughout.
 */
export const agentCheckEveryMs = (state: 'warm' | 'cold', muse: boolean): number => muse ? 1000 : state === 'warm' ? 5_000 : 10_000;
/** Incomplete calls left in a state directory: 0 when there is no journal, 1 when it cannot be read. */
function retainedIn(stateDir: string): number {
  const path = join(stateDir, 'journal.json');
  if (!existsSync(path)) return 0;
  try { return Object.values(byorJournalSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).entries).filter(entry => !complete(entry)).length; }
  catch { return 1; }
}

/** Claim the line, serve calls until stopped, then release it. Every exit path releases the line. */
export async function runDev(input: DevInput, deps: DevDeps): Promise<number> {
  const { control, home } = deps; const agent = input.agent;
  const emit: Emit = record => deps.emit({ at: new Date().toISOString(), ...record });
  if (input.muse) {
    const root = join(home, 'dev');
    if (existsSync(root)) for (const name of readdirSync(root)) {
      const receipt = join(root, name, 'muse-session.json');
      if (existsSync(receipt)) {
        let clean = false;
        try { clean = JSON.parse(readFileSync(receipt, 'utf8')).clean === true; } catch { /* preserve uncertain ownership */ }
        if (!clean) throw new CLIError('muse_cleanup_pending', 3, `Previous Muse cleanup is unverified. Preserve and inspect ${receipt} before another paid preparation.`);
      }
    }
  }
  const claim = await claimLine(control, { name: sessionName(agent, input.holder, input.slot?.label), ...(input.project ? { project: input.project } : {}), takeover: input.takeover, ...(input.force ? { force: true } : {}), shared: id => onboardingSaved(home, input.controlOrigin, id) });
  // Chert's view of the line, before the session starts: status, route, the switch and the Mac. With --force, why it may not ring.
  emit({ code: 'line_state', ok: claim.readiness.ok, line_status: claim.line.status, routing_status: claim.line.routing_status ?? null, activation_intent: claim.line.activation_intent ?? null,
    message: claim.readiness.ok ? claim.readiness.summary : `Taking the line anyway (--force): ${claim.readiness.detail} ${claim.readiness.fix ?? ''}`.trim() });
  const root = join(home, 'dev');
  const stateDir = join(root, claim.scope.binding_id);
  const credentialsFile = join(root, `${claim.scope.binding_id}.credentials.json`);
  const local = new AbortController(); const stop = () => local.abort();
  if (deps.signal.aborted) stop(); else deps.signal.addEventListener('abort', stop, { once: true });
  let exit = 0; let failure: unknown; let reported: number | undefined; let displaced = false; let wrote = false;
  let handler: DevHandler | undefined; let keeper: Promise<void> | undefined; let watcher: Promise<void> | undefined;
  const now = deps.now ?? Date.now;
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const fd = openSync(credentialsFile, 'wx', 0o600); wrote = true;
    try { writeFileSync(fd, JSON.stringify(claim.credentials) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const config = parseConfig({ schema_version: 2, mode: 'byor', state_dir: stateDir,
      handler: { id: input.muse ? 'chert-muse-v1' : 'chert-dev-v1', module: fileURLToPath(new URL(input.muse ? './muse-handler.js' : './dispatch-handler.js', import.meta.url)) },
      transport: { mode: 'hosted-v1', control_origin: new URL(input.controlOrigin).origin, relay_origin: new URL(input.relayOrigin).origin, reconcile_origin: new URL(input.relayOrigin).origin,
        scope: claim.scope, credential_env: 'CHERT_CONNECTOR_TOKEN', recovery_env: 'CHERT_RECOVERY_TOKEN', credentials_file: credentialsFile } }) as ByorConfig;
    const calls = new Map<string, CallView>();
    const view = (callId: string) => {
      let known = calls.get(callId);
      if (!known) { known = { asked: false, decided: false, told: false }; calls.set(callId, known); if (calls.size > CALLS_LIMIT) calls.delete(calls.keys().next().value!); }
      return known;
    };
    const tell = (known: CallView, event: DevEvent) => { known.told = true; emit({ code: `call_${event.event}`, ...event, message: callMessages[event.event](event) }); };
    const handlerOptions = { livekitUrl: input.livekitUrl.replace(/\/$/, ''), apiKey: input.apiKey, apiSecret: input.apiSecret, agentName: agent, api: deps.api,
      prewarm: input.prewarm, ...(deps.warmTimeoutMs ? { warmTimeoutMs: deps.warmTimeoutMs } : {}),
      log: (event: DevEvent) => {
        const known = view(event.call_id);
        if (event.event === 'incoming') known.asked = true;
        // An answer is reported once Chert was told it: the connector still turns an answer that came too late into a decline.
        if (event.event === 'accepted') { if (!known.told) known.accepted = event; return; }
        if (event.event === 'declined') {
          // A stopped handler cannot tell why it was stopped (hang-up, deadline, lost connection); the connector's decision says.
          if (event.reason === 'cancelled' || known.told) return;
          tell(known, event); return;
        }
        emit({ code: `call_${event.event}`, ...event, message: callMessages[event.event](event) });
      } };
    const serving = handler = input.muse ? (await import('./muse-handler.js')).museHandler({ ...handlerOptions,
      readCall: call => { if (!control.callReadiness) throw new Error('Call readiness unavailable'); return control.callReadiness(call.project_id, call.line_id, call.call_id); },
      report: (code, message) => emit({ code, message }),
      save: receipt => {
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        const path = join(stateDir, 'muse-session.json');
        const fd = openSync(`${path}.tmp`, 'w', 0o600);
        try { writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(`${path}.tmp`, path);
        const dir = openSync(stateDir, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
      },
    }) : (await liveKit()).devHandler({ ...handlerOptions,
      // bridge_ready comes from Chert's call API; chert dev writes it into the room so the agent can greet in time.
      ...(control.callReadiness ? { readCall: call => control.callReadiness!(call.project_id, call.line_id, call.call_id) } : {}) });
    // With a slot, the session sees each call through to its end, so the end of the slot never cuts one off.
    const tracker = input.slot ? trackCalls(serving, input.slot, now, callId => emit({ code: 'slot_call_declined', call_id: callId,
      message: 'A call rang after your slot ended. It was declined so the line can go to the next team.' })) : undefined;
    // The line's name is a label a person chose: often the number, but not always. It is cleaned before it is shown,
    // and the sentence asks for a call to the line and gives the label beside it, without calling the label a number.
    // Without a label the masked address is what tells one line from another.
    const named = printable(claim.line.display_name, 80), masked = printable(claim.line.masked_identity, 80), label = named ?? masked;
    const address = masked ?? named ?? 'your line';
    // The opening screen of a terminal says how to stop; a pipe gets it on the line that asks for the call.
    const invite = `Call ${label ? `your line (${label})` : 'your line'} on FaceTime to talk to`, stopHint = deps.banner ? '' : ' Ctrl+C to stop.';
    emit({ code: 'dev_ready', project: claim.project.name, line: claim.line.display_name ?? null, address, agent, binding_id: claim.scope.binding_id, state_dir: stateDir,
      ...(claim.replaced ? { replaced_binding: claim.replaced } : {}),
      ...(deps.banner ? { screen: true, message: deps.banner({ agent, ...(named ? { line: named } : {}), ...(masked ? { address: masked } : {}), project: claim.project.name }) }
        : { message: `Connecting "${agent}" to ${label ?? 'your line'} (${claim.project.name})…` }) });
    if (input.sessionExpiresAt !== undefined && input.sessionExpiresAt - Date.now() < 15 * 60_000)
      emit({ code: 'session_expiring', expires_at: input.sessionExpiresAt, message: input.muse
        ? 'Your Chert session expires within 15 minutes. Muse needs it for bridge readiness throughout the call; sign in again before the next run.'
        : 'Your Chert session expires within 15 minutes. Calls keep working, but stopping cleanly needs a fresh chert login.' });
    if (input.slot && tracker) {
      emit({ code: 'slot_set', ends_at: input.slot.endsAt, until: input.slot.label,
        message: `Your slot ends at ${input.slot.label}. chert dev then stops and releases the line, after any call in progress ends.` });
      watcher = watchSlot(input.slot, { busy: tracker.busy, emit, stop, signal: local.signal, now, checkMs: deps.slotCheckMs ?? 1000 });
    }
    if (!input.prewarm) emit({ code: 'prewarm_off', message: 'No waiting room (--no-prewarm): each call is answered cold, and Chert gives about 5 s to answer, so calls can be declined. Teams: run chert dev without --no-prewarm.' });
    if (input.prewarm) {
      // Keep one room ready with the agent inside. Report each change once, and repeat the warning while the agent stays
      // absent, because an empty waiting room means every call is declined; slow down the checks meanwhile.
      keeper = (async () => {
        let last: 'warm' | 'cold' | undefined; let warnedAt: number | undefined;
        const absent = (left: boolean) => ({ code: 'agent_not_warm', ...(left ? { left: true } : {}), message: `"${agent}" is NOT in the waiting room, so every call is declined. ${left ? 'It left; is it still running?' : 'Is it running?'} Start it in another terminal (npm start) and check it registers as "${agent}" on the same LiveKit project. Checking again every ${Math.round(agentCheckEveryMs('cold', input.muse === true) / 1000)} s.` });
        while (!local.signal.aborted) {
          const state = await serving.refresh().catch(() => 'cold' as const);
          if (local.signal.aborted) break;
          if (!input.muse && state !== last) {
            if (state === 'warm') emit({ code: 'agent_warm', message: `"${agent}" is in a waiting room. ${invite} it.${stopHint}` });
            else { emit(absent(last === 'warm')); warnedAt = now(); }
          } else if (!input.muse && state === 'cold' && warnedAt !== undefined && now() - warnedAt >= (deps.absentReminderMs ?? 60_000)) { emit(absent(false)); warnedAt = now(); }
          last = state;
          await pause((state === 'warm' ? deps.warmIntervalMs : deps.warmBackoffMs) ?? agentCheckEveryMs(state, input.muse === true), undefined, { signal: local.signal }).catch(() => {});
        }
      })();
    }
    let active = false, connectedReported = false, connectedAt: number | undefined;
    // Why the last connection ended, when it ended, and which attempt is under way, so every reconnect outcome is reported.
    let lostReason: string | undefined, lostAt: number | undefined, attempt = 0;
    const observe: Emit = record => {
      if (record.code === 'runtime_stopped' && typeof record.retained === 'number') reported = record.retained;
      if (record.code === 'transport_closed') lostReason = String(record.reason);
      if (record.code === 'transport_closed' && record.reason !== 'transport_failure' && record.reason !== 'closed_by_relay')
        emit({ code: 'frame_rejected', reason: record.reason, message: `Chert sent a message this CLI version could not handle (${String(record.reason)}). Update the CLI; calls may go unanswered until then.` });
      if (record.code === 'call_decision') {
        const callId = String(record.call_id), known = view(callId);
        tracker?.decided(callId, record.action);
        if (known.decided || known.told) return;
        known.decided = true;
        if (record.action === 'accept') { if (known.accepted) tell(known, known.accepted); return; }
        const reason = String(record.reason);
        known.told = true;
        if (!known.asked) emit({ code: 'call_declined', call_id: callId, reason, message: reason in connectorDeclines
          ? `Call declined before the agent was asked: ${connectorDeclines[reason]}` : `Call declined before the agent was asked (reason: ${reason}).` });
        else emit({ code: 'call_declined', call_id: callId, reason, message: reason in preparationDeclines
          ? `Call declined: ${preparationDeclines[reason]}` : `Call declined (reason: ${reason}).` });
        return;
      }
      if (record.code !== 'runtime_observation') return;
      if (connectedAt === undefined && lostAt !== undefined) {
        // Back after a drop: say so, with how long calls could not reach the agent. The waiting room was never touched by the drop.
        const downMs = Math.round(performance.now() - lostAt); lostAt = undefined;
        emit({ code: 'dev_reconnected', attempt, down_ms: downMs, message: `Reconnected to Chert after ${(downMs / 1000).toFixed(1)} s${input.prewarm ? '; the waiting room is kept' : ''}. Calls reach "${agent}" again.` });
      }
      connectedAt ??= performance.now();
      // With a waiting room the next line says when the agent is in it. Muse reports its own readiness. Otherwise this is the last word before a call.
      if (!connectedReported) { emit({ code: 'dev_connected', message: input.muse ? 'Connected to Chert. Call readiness is reported separately.'
        : input.prewarm ? 'Connected to Chert.' : `Connected to Chert. ${invite} "${agent}".${stopHint}` }); connectedReported = true; }
      emit({ ...record, binding_id: claim.scope.binding_id });
      if (record.admission === 'available') active = true;
      else if (active && !local.signal.aborted && (record.admission === 'binding_standby' || record.admission === 'binding_draining')) {
        displaced = true;
        emit({ code: 'displaced', message: 'Another session took over this line, so calls no longer reach this agent. Run chert doctor to see who holds it. Stopping.' });
        stop();
      }
    };
    // The relay may refuse or close a connection; reconnect until stopped. The limit and the wait count failures in a row:
    // a connection that held (longer than the relay's five-second freshness window) ends the run of failures,
    // so a long session survives occasional drops, while a relay that accepts and closes at once is still given up on.
    const limit = deps.maxReconnects ?? 30, stable = deps.stableConnectionMs ?? 10_000, connectTimeout = deps.connectTimeoutMs ?? 20_000;
    // Every attempt is bounded: one that has not reached Chert within connectTimeout is cut off and counted as a failure,
    // so a relay that accepts the socket and says nothing cannot hold the session in silence.
    let firstFailureAt: number | undefined;
    const causes: Record<string, string> = { transport_failure: 'no heartbeat from the relay for 5 s', closed_by_relay: 'the relay closed the connection',
      connect_timeout: `no answer from the relay within ${Math.round(connectTimeout / 1000)} s` };
    for (let failures = 0; !local.signal.aborted; failures++) {
      connectedAt = undefined; lostReason = undefined;
      const one = new AbortController(); const onStop = () => one.abort(); local.signal.addEventListener('abort', onStop, { once: true });
      let cutOff = false;
      const watchdog = setTimeout(() => { if (connectedAt === undefined) { cutOff = true; one.abort(); } }, connectTimeout);
      try { exit = await deps.run(config, deps.env, one.signal, observe, tracker?.handler ?? serving); }
      catch (error) { if (!(error instanceof CLIError && error.code === 'transport_unavailable')) throw error; exit = 6; }
      finally { clearTimeout(watchdog); local.signal.removeEventListener('abort', onStop); }
      if (cutOff && !local.signal.aborted) { exit = 6; lostReason = 'connect_timeout'; }
      if (exit !== 6 || local.signal.aborted) break;
      if (connectedAt !== undefined && performance.now() - connectedAt >= stable) { failures = 0; firstFailureAt = undefined; }
      firstFailureAt ??= performance.now(); lostAt ??= performance.now();
      if (failures >= limit) throw new CLIError('transport_unavailable', 6,
        `Lost the connection to Chert and could not reconnect: ${limit} attempts in a row over ${Math.round((performance.now() - firstFailureAt) / 1000)} s. Run chert dev again; if it keeps failing, run chert doctor.`);
      attempt = failures + 1;
      const waitMs = deps.reconnectDelayMs?.(failures) ?? Math.min(5000, 500 * 2 ** Math.min(failures, 4));
      const reason = lostReason ?? 'unknown';
      emit({ code: 'reconnecting', reason, attempt, limit, wait_ms: waitMs,
        message: `Connection to Chert lost (${causes[reason] ?? reason}): reconnecting, attempt ${attempt} of ${limit} in ${(waitMs / 1000).toFixed(1)} s…` });
      await pause(waitMs, undefined, { signal: local.signal }).catch(() => {});
    }
    if (displaced) exit = 6;
  } catch (error) { failure = error; }
  finally {
    stop(); deps.signal.removeEventListener('abort', stop);
    let cleanupPending = false;
    await handler?.close().catch(() => { cleanupPending = true; exit = 3; emit({ code: 'cleanup_pending', message: 'Muse cleanup is unverified. State and credentials are retained; do not start another paid session.' }); });
    await keeper?.catch(() => {}); await watcher?.catch(() => {});
    const retained = Math.max(cleanupPending ? 1 : 0, reported ?? retainedIn(stateDir));
    try {
      await releaseLine(control, claim.project.id, claim.scope.binding_id, retained);
      if (retained === 0) { if (wrote) rmSync(credentialsFile, { force: true }); rmSync(stateDir, { recursive: true, force: true }); }
      emit({ code: 'dev_stopped', retained, ...(retained ? { state_dir: stateDir } : {}),
        message: retained ? `Stopped with ${retained} unfinished call(s). Their state is kept in ${stateDir}.` : 'Stopped. The line no longer routes to this agent.' });
    } catch (error) {
      const expired = error instanceof CLIError && error.code === 'login_required';
      emit({ code: 'release_failed', binding_id: claim.scope.binding_id, message: expired
        ? 'Stopped, but your Chert session expired so the line was not released. Run chert login, then chert dev again to take it back.'
        : 'Stopped, but could not release the line. Run chert dev again and stop it with Ctrl+C; if that fails, a project owner or admin revokes this session\'s binding (the console or POST /api/v1/connectors).' });
    }
  }
  if (failure) throw failure;
  return exit;
}

/** A browser sign-in is for one project. Use it when none was named; refuse a different one before any network call. */
function signedInTo(stored: Credential | undefined, fromEnv: string | undefined, values: Record<string, string>): string | undefined {
  if (fromEnv) {
    if (fromEnv.startsWith('ftu_') && !values.project) throw new CLIError('project_required', 2, 'CHERT_USER_ACCESS_TOKEN holds a command-line credential. Pass --project UUID for the project it was approved for.');
    return fromEnv.startsWith('ftu_') ? values.project : undefined;
  }
  if (stored?.kind !== 'cli' || !stored.project_id) return undefined;
  if (values.project && values.project !== stored.project_id) throw new CLIError('project_not_signed_in', 3,
    `This computer is signed in to ${stored.project_name ?? stored.project_id}, not project ${values.project}. Run chert login and choose that project, or drop --project (chert setup --clear removes a saved one).`);
  values.project = stored.project_id;
  return stored.project_id;
}

async function dev(args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, emit: Emit): Promise<number> {
  const values = flags(args, ['agent', 'project', 'env-file', 'backend', 'relay-origin', 'until', 'minutes'], ['takeover', 'no-prewarm', 'muse', 'force']);
  if (values.muse && values['no-prewarm']) throw new CLIError('invalid_usage', 2, '--muse requires explicit bounded preparation; omit --no-prewarm.');
  const slot = slotFrom({ ...(values.until !== undefined ? { until: values.until } : {}), ...(values.minutes !== undefined ? { minutes: values.minutes } : {}) });
  const home = chertHome(env);
  const settings = devSettings(home, values, env);
  // The name is typed once: --agent, else AGENT_NAME from the shell or from the env file the agent itself reads.
  const agent = values.agent ?? settings.agent;
  if (!agent) throw new CLIError('missing_input', 2, 'Name your agent: chert dev --agent my-agent, or set AGENT_NAME in .env.local. It is the agent_name your LiveKit agent registers with.');
  checkAgent(agent);
  env = settings.env;
  if (settings.project) values.project = settings.project;
  // In a terminal the opening screen says where the keys came from; a pipe gets the sentence at once.
  const terminal = terminalFor(env, args.includes('--json'), process.stdin, process.stdout);
  if (settings.envFile && !terminal) emit(folderFileNotice(settings.envFile));
  const stored = credentialStore(home).load();
  const fromEnv = env.CHERT_USER_ACCESS_TOKEN;
  const token = fromEnv ?? (stored && stored.expires_at > Date.now() ? stored.access_token : undefined);
  if (!token || /[\r\n]/.test(token)) throw new CLIError('login_required', 3, stored && !fromEnv ? 'Your Chert session expired. Run chert login again.' : 'Sign in first: chert login.');
  const signedInProject = signedInTo(stored, fromEnv, values);
  const missing = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(name => !env[name]);
  if (missing.length) throw new CLIError('livekit_credentials_missing', 3, `${missing.join(', ')} not found. Run this from your agent's folder, where .env.local holds them, or export them. They stay on this machine.`);
  const unfilled = placeholders(env);
  if (unfilled.length) throw new CLIError('livekit_credentials_placeholder', 3, `Put your LiveKit values in .env.local: ${unfilledSentence(unfilled)}.`);
  const url = env.LIVEKIT_URL!, key = env.LIVEKIT_API_KEY!, secret = env.LIVEKIT_API_SECRET!;
  if (!/^wss:\/\/[^/?#@]+\/?$/.test(url)) throw new CLIError('livekit_url_invalid', 2, 'LIVEKIT_URL must look like wss://your-project.livekit.cloud');
  const controlOrigin = values.backend ?? env.CHERT_CONTROL_ORIGIN ?? (fromEnv ? undefined : stored?.origin) ?? CONTROL_ORIGIN;
  const relayOrigin = values['relay-origin'] ?? env.CHERT_RELAY_ORIGIN ?? RELAY_ORIGIN;
  // Everything that can be judged locally is judged before the first network call.
  try { hostedOrigin(relayOrigin); } catch { throw new CLIError('invalid_origin', 2, 'The relay address must be https://HOST with no path or credentials.'); }
  const control = controlClient(controlOrigin, token, signedInProject);
  await check(url, key, secret);
  let sessionExpiresAt: number | undefined;
  try { sessionExpiresAt = fromEnv ? sessionClaims(fromEnv).exp * 1000 : stored?.expires_at; } catch { sessionExpiresAt = undefined; }
  return runDev({ agent, livekitUrl: url, apiKey: key, apiSecret: secret, controlOrigin, relayOrigin, ...(values.project ? { project: values.project } : {}),
    ...(!fromEnv && stored?.email ? { holder: stored.email } : {}), ...(slot ? { slot } : {}),
    muse: values.muse === 'true', takeover: values.takeover === 'true', prewarm: values['no-prewarm'] !== 'true', ...(values.force === 'true' ? { force: true } : {}), ...(sessionExpiresAt !== undefined ? { sessionExpiresAt } : {}) },
    { control, api: (await liveKit()).liveKitDispatchAPI(url, key, secret), home, env, signal, emit,
      ...(terminal ? { banner: facts => { const version = cliVersion(); return renderSession({ ...lookOf(terminal), ...(version ? { version } : {}), ...facts,
        ...(settings.envFile ? { keys: `${basename(settings.envFile)} in this folder` } : {}) }); } } : {}),
      run: async (config, runEnv, runSignal, runEmit, handler) => (await import('../byor/run.js')).runByor(config, runEnv, runSignal, runEmit, false, handler) });
}

/** Said once when the keys came from a file in the current folder, so a wrong folder is noticed at once. */
const folderFileNotice = (file: string) => ({ code: 'livekit_env_file', path: file, message: `Using the LiveKit keys in ${basename(file)} from this folder.` });

/** Connectivity checks; --agent briefly dispatches a job in an owned test room. */
async function doctor(args: string[], env: NodeJS.ProcessEnv, emit: Emit): Promise<number> {
  const values = flags(args, ['agent', 'project', 'env-file', 'backend'], []);
  if (values.agent) checkAgent(values.agent);
  const settings = devSettings(chertHome(env), values, env);
  env = settings.env; const known = settings.agent;
  if (settings.project) values.project = settings.project;
  if (settings.envFile) emit(folderFileNotice(settings.envFile));
  const store = credentialStore(chertHome(env));
  let session = whoami(store); const stored = session.signed_in ? store.load() : undefined; let token = stored?.access_token;
  const fromEnv = env.CHERT_USER_ACCESS_TOKEN;
  const signedInProject = signedInTo(stored, fromEnv, values);
  if (fromEnv) {
    // The same two kinds dev accepts: a command-line credential, whose validity only Chert can tell, or a session token.
    if (fromEnv.startsWith('ftu_') && !/[\r\n]/.test(fromEnv)) { session = { signed_in: true }; token = fromEnv; }
    else try { const claims = sessionClaims(fromEnv); session = { signed_in: true, expires_at: claims.exp * 1000, ...(claims.email ? { email: claims.email } : {}) }; token = fromEnv; }
    catch { session = { signed_in: false }; token = undefined; }
  }
  const missing = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(name => !env[name]);
  const unfilled = placeholders(env);
  const invalid = !missing.length && !/^wss:\/\/[^/?#@]+\/?$/.test(env.LIVEKIT_URL!);
  const checks = await runDoctor({ ...(values.agent ? { agent: values.agent } : {}), ...(values.project ? { project: values.project } : {}),
    ...(known && AGENT_PATTERN.test(known) ? { known } : {}) }, {
    ...(token ? { control: controlClient(values.backend ?? env.CHERT_CONTROL_ORIGIN ?? (fromEnv ? undefined : stored?.origin) ?? CONTROL_ORIGIN, token, signedInProject) } : {}),
    ...(!missing.length && !invalid && !unfilled.length ? { api: (await liveKit()).liveKitDispatchAPI(env.LIVEKIT_URL!, env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!) } : {}),
    session, livekit: { missing, invalid, unfilled },
    // A project with a saved onboarding session reaches a pool line through a shared allocation: the line check says so.
    shared: id => onboardingSaved(chertHome(env), values.backend ?? env.CHERT_CONTROL_ORIGIN ?? (fromEnv ? undefined : stored?.origin) ?? CONTROL_ORIGIN, id) });
  const ok = !checks.some(check => check.status === 'fail');
  emit({ code: 'doctor', ok, checks, message: renderChecks(checks) });
  return ok ? 0 : 3;
}

/**
 * Who is signed in, checked with Chert when it can be reached: the file on this computer cannot know that a
 * credential was revoked or a membership removed. Offline, the local answer is given and marked unconfirmed.
 */
export async function confirmSession(store: ReturnType<typeof credentialStore>, env: NodeJS.ProcessEnv, connect: typeof controlClient = controlClient): Promise<Record<string, unknown>> {
  const status = whoami(store); const held = status.signed_in ? store.load() : undefined;
  if (!held) return { code: 'whoami', ...status, message: 'Not signed in. Run chert login.' };
  const said = `Signed in${status.email ? ` as ${status.email}` : ''}${status.project_name ? ` · project ${status.project_name}` : ''}`;
  try {
    const projects = await connect(held.origin ?? env.CHERT_CONTROL_ORIGIN ?? CONTROL_ORIGIN, held.access_token, held.project_id).projects();
    const mine = held.kind === 'cli' ? projects[0] : undefined;
    return { code: 'whoami', ...status, confirmed: true, ...(mine ? { project_name: mine.name, role: mine.role } : { projects: projects.length }),
      message: mine ? `Signed in${status.email ? ` as ${status.email}` : ''} · project ${mine.name} (${mine.role}).` : `${said}.` };
  } catch (error) {
    if (error instanceof CLIError && error.code === 'login_required')
      return { code: 'whoami', signed_in: false, confirmed: true, message: 'Chert no longer accepts the sign-in saved on this computer. Run chert login.' };
    return { code: 'whoami', ...status, confirmed: false, message: `${said}. Chert could not be reached to confirm it.` };
  }
}
/** The screen a signed-in developer gets for a bare `chert` in a terminal. */
export function homeScreen(env: NodeJS.ProcessEnv, terminal: Terminal): string {
  const store = credentialStore(chertHome(env)), status = whoami(store), held = status.signed_in ? store.load() : undefined, version = cliVersion();
  return renderHome({ ...lookOf(terminal), rows: sizeOf(terminal.output).rows, ...(version ? { version } : {}),
    ...(status.email ? { email: status.email } : {}), ...(status.project_name ? { project: status.project_name } : {}),
    ...(held?.device_name ? { device: held.device_name } : {}), ...(status.expires_at ? { expiresAt: status.expires_at } : {}) });
}

/** Browser setup and the CLI share one durable request key; explicit project workflows remain available. */
export async function onboard(args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, emit: Emit, deps: DeviceLoginDeps = deviceLoginDeps): Promise<number> {
  const values = flags(args, ['backend', 'project', 'wait'], ['no-browser', 'status', 'cancel', 'restart', 'skip-demo']);
  if ([values.status, values.cancel, values.restart].filter(Boolean).length > 1) throw new CLIError('invalid_usage', 2, 'Use only one of --status, --cancel or --restart.');
  const waitSeconds = values.wait === undefined ? 600 : Number(values.wait);
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 3600) throw new CLIError('invalid_usage', 2, '--wait must be a whole number of seconds between 0 and 3600.');
  const { onboardingStore, runOnboarding } = await import('./onboard.js');
  const home = chertHome(env), credentials = credentialStore(home);
  let stored = credentials.load();
  const origin = values.backend ?? env.CHERT_CONTROL_ORIGIN ?? stored?.origin ?? CONTROL_ORIGIN;
  if (!env.CHERT_USER_ACCESS_TOKEN && stored?.origin && new URL(origin).origin !== new URL(stored.origin).origin) {
    throw new CLIError('login_origin_mismatch', 3, 'This credential belongs to a different Chert server. Run chert login --backend with the intended server first.');
  }
  const openBrowser = !values['no-browser'] && !env.SSH_CONNECTION && !env.SSH_TTY;
  const explicit = Boolean(values.project || env.CHERT_USER_ACCESS_TOKEN);
  const readOnly = Boolean(values.status || values.cancel);
  const initialProject = signedInTo(stored, env.CHERT_USER_ACCESS_TOKEN, { ...values }) ?? values.project;
  const existing = initialProject ? onboardingStore(home, origin, initialProject).load() : undefined;
  let setup = !explicit && !readOnly && !existing && !stored?.onboarding_request_key;
  let browserAlreadyOpen = false;
  async function signIn(forSetup: boolean) {
    const pending = onboardingStore(home, origin, 'browser-setup');
    const requestKey = forSetup ? (pending.load() ?? pending.create()).request_key : undefined;
    const credential = await deviceLogin({ origin, deviceName: deviceName(), openBrowser, signal, emit,
      ...(requestKey ? { onboardingRequestKey: requestKey } : {}) }, deps);
    const revoke = async (value: Credential, description: string) => {
      if (value.kind !== 'cli') return;
      try { await revokeCredential(value.origin ?? origin, value.access_token, deps.fetch); }
      catch {
        if (value.expires_at > deps.now()) emit({ code: 'credential_revocation_warning',
          message: `${description} could not be revoked at Chert: it stops working on ${new Date(value.expires_at).toISOString().slice(0, 10)}. A project owner or admin can revoke it sooner from the Chert dashboard.` });
      }
    };
    const previous = stored;
    try {
      if (!forSetup && existing && initialProject && credential.project_id !== initialProject) {
        throw new CLIError('onboarding_project_mismatch', 3, 'Your saved onboarding belongs to another project. Sign in to that project to resume it; the original state was retained.');
      }
      if (!forSetup && stored?.onboarding_request_key && credential.project_id === stored.project_id) {
        credential.onboarding_request_key = stored.onboarding_request_key;
      }
      // Persist intent before replacing credentials, so either surviving file can resume after interruption.
      if (requestKey && credential.project_id) {
        const target = onboardingStore(home, origin, credential.project_id);
        const saved = target.load();
        if (saved && saved.request_key !== requestKey) throw new CLIError('onboarding_active', 3, 'This project already has saved onboarding. Resume it before replacing its request.');
        target.save(saved ?? { request_key: requestKey });
      }
      credentials.save(credential);
    } catch (error) {
      // A token is redeemed only once. If it cannot be retained, end that authorization explicitly.
      if (credential.access_token !== previous?.access_token) await revoke(credential, 'The new command-line credential that could not be saved');
      throw error;
    }
    stored = credential;
    if (previous && previous.access_token !== credential.access_token) await revoke(previous, 'The earlier command-line credential on this computer');
    if (forSetup) { pending.clear(); browserAlreadyOpen = openBrowser; }
  }
  if (!env.CHERT_USER_ACCESS_TOKEN && (setup || !stored || stored.expires_at <= deps.now())) {
    if (readOnly) throw new CLIError('login_required', 3, 'Sign in with chert login before inspecting or cancelling onboarding.');
    await signIn(setup);
  }
  for (;;) {
    const project = signedInTo(stored, env.CHERT_USER_ACCESS_TOKEN, { ...values }) ?? values.project;
    if (!project) throw new CLIError('project_required', 2, 'Approve a project using chert login, or supply --project with a user session credential.');
    const state = onboardingStore(home, origin, project);
    if (!state.load() && stored?.onboarding_request_key && !explicit) state.save({ request_key: stored.onboarding_request_key });
    try {
      return await runOnboarding({ origin, token: env.CHERT_USER_ACCESS_TOKEN ?? stored!.access_token, project, signal,
        openBrowser: openBrowser && !browserAlreadyOpen, statusOnly: Boolean(values.status), cancel: Boolean(values.cancel),
        restart: Boolean(values.restart), skipDemo: Boolean(values['skip-demo']), waitSeconds, emit }, state, deps);
    } catch (error) {
      // This specific refusal proves no shared allocation was created. Preserve all other uncertain starts.
      if (!setup && !explicit && !readOnly && !values.restart && error instanceof CLIError && error.code === 'shared_project_has_dedicated_line') {
        setup = true;
        emit({ code: 'onboarding_setup_required', message: 'Your saved project uses an existing line. Opening browser setup for your demo project.' });
        await signIn(true);
        continue;
      }
      throw error;
    }
  }
}

export async function developerCommand(command: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, emit: Emit): Promise<number> {
  if (command === 'new') return (await import('../cli/new.js')).newCommand(args, emit);
  if (command === 'onboard') return onboard(args, env, signal, emit);
  if (command === 'setup') {
    const values = flags(args, ['project', 'env-file'], ['clear']);
    if (values.clear && (values.project || values['env-file'])) throw new CLIError('invalid_usage', 2, 'Use --clear alone to remove saved dev defaults.');
    if (!values.clear && (!values.project || !values['env-file'])) throw new CLIError('missing_input', 2, 'Use chert setup --env-file PATH --project UUID, or chert setup --clear.');
    const home = chertHome(env);
    if (values.clear) clearDevSetup(home);
    else saveDevSetup(home, values.project!, values['env-file']!, env);
    emit({ code: values.clear ? 'setup_cleared' : 'setup_saved', message: values.clear
      ? 'Saved dev defaults removed. Login and call state are unchanged.'
      : `Saved project ${values.project} and the env-file path for dev and doctor. No line was activated. Credential values were not saved.` });
    return 0;
  }
  if (command === 'guide') {
    // The topic is the one argument that is not a flag.
    flags(args.filter(arg => arg.startsWith('--')), [], []);
    const named = args.filter(arg => !arg.startsWith('--'));
    const { guide, topics } = await import('../cli/guide.js');
    const text = named.length <= 1 ? guide(named[0]) : undefined;
    if (!text) throw new CLIError('invalid_usage', 2, `Choose one topic: chert guide, or chert guide ${topics.filter(topic => topic.name !== 'start').map(topic => topic.name).join(', ')}.`);
    emit({ code: 'guide', topic: named[0] ?? 'start', message: text });
    return 0;
  }
  if (command === 'login') return login(args, env, signal, emit);
  if (command === 'dev') return dev(args, env, signal, emit);
  if (command === 'doctor') return doctor(args, env, emit);
  flags(args, [], []);
  const store = credentialStore(chertHome(env));
  if (command === 'whoami') { emit(await confirmSession(store, env)); return 0; }
  // A command-line credential is revoked at Chert. A pasted browser session cannot be; it simply expires.
  const held = store.load();
  const result = await logout(store, token => revokeCredential(held?.origin ?? env.CHERT_CONTROL_ORIGIN ?? CONTROL_ORIGIN, token));
  emit({ code: 'signed_out', ...result, message: result.revoked ? 'Signed out. The credential was revoked at Chert.'
    : result.already_ended ? 'Signed out. Chert had already ended this login.'
    : held?.kind === 'cli' ? `Signed out on this machine, but Chert could not be reached to revoke the credential. It stops working on ${new Date(held.expires_at).toISOString().slice(0, 10)}.`
      : 'Signed out on this machine.' });
  return 0;
}
