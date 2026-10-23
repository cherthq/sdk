import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmSession, developerCommand, homeScreen, login, signedIn, terminalFor, type LoginDeps } from '../../src/dev/command.js';
import type { Control } from '../../src/dev/claim.js';
import { deviceLogin, deviceName, revokeCredential, type DeviceLoginDeps } from '../../src/dev/device-login.js';
import { credentialStore, logout } from '../../src/cli/login.js';
import type { Terminal } from '../../src/dev/welcome.js';
import { CLIError } from '../../src/cli/errors.js';

const ORIGIN = 'https://control.example', DEFAULT = 'https://facetime.trychert.com';
const P = '11000000-0000-4000-8000-000000000001', OTHER = '11000000-0000-4000-8000-000000000002';
const token = (letter: string) => `ftu_${letter.repeat(43)}`;
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sessionToken = `${part({ alg: 'HS256' })}.${part({ sub: 'user', email: 'dev@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
// The contract with the server: the approval page is on the origin that was asked, so the fixtures build it from the request.
const started = (origin = ORIGIN) => ({ device_code: `fdc_${'d'.repeat(43)}`, user_code: 'KDTF-2937', verification_url: `${origin}/cli`,
  verification_url_complete: `${origin}/cli?code=KDTF-2937`, expires_in: 600, interval: 2 });
const approved = (extra: Record<string, unknown> = {}) => ({ status: 'approved', access_token: token('a'), email: 'dev@example.test', project: { id: P, name: 'Clinic' },
  device_name: 'Test MacBook', expires_in: 2_592_000, ...extra });
type Reply = { status: number; data?: unknown } | Error;
async function failure(promise: Promise<unknown>): Promise<CLIError> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error; }
  return assert.fail('expected a CLIError');
}
function device(script: { start?: Reply; polls: Reply[] }) {
  const urls: string[] = []; const records: Record<string, unknown>[] = []; const order: string[] = []; const polls = [...script.polls];
  const controller = new AbortController();
  const deps: DeviceLoginDeps = {
    fetch: (async (input: string | URL | Request) => {
      const url = String(input); urls.push(url); order.push(url.endsWith('/token') ? 'poll' : 'start');
      const reply = url.endsWith('/logins') ? script.start ?? { status: 201, data: started(new URL(url).origin) } : polls.shift() ?? { status: 202, data: { status: 'pending' } };
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.data !== undefined ? { data: reply.data } : { error: { code: 'x' } }), { status: reply.status });
    }) as typeof fetch,
    pause: async () => { order.push('pause'); }, open: async () => true, now: () => 1_800_000_000_000,
  };
  const run = () => deviceLogin({ origin: ORIGIN, deviceName: 'Test MacBook', openBrowser: false, signal: controller.signal, emit: record => { records.push(record); order.push(String(record.code)); } }, deps);
  return { run, urls, records, order, deps, controller };
}

// ---- device login: what the server may answer ------------------------------------------------------------------

test('device login: the code is on screen before the first wait, so the developer is never left looking at nothing', async () => {
  const d = device({ polls: [{ status: 200, data: approved() }] });
  await d.run();
  assert.deepEqual(d.order, ['start', 'login_code', 'pause', 'poll']);
});

test('device login: an address with a control character in it is refused, however well its origin and code check out', async () => {
  for (const field of ['verification_url', 'verification_url_complete'] as const) {
    const bad = { ...started(), [field]: `${started()[field]}${field === 'verification_url' ? '?' : '&'}x=\x1b[31m` };
    const d = device({ start: { status: 201, data: bad }, polls: [] });
    assert.equal((await failure(d.run())).code, 'backend_response_invalid', field);
    assert.deepEqual(d.records, [], 'nothing was shown');
  }
});

test('home screen: a bare chert when signed in shows the project, the device, the expiry and the version from the stored credential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-home-'));
  try {
    credentialStore(directory).save({ access_token: token('a'), expires_at: Date.now() + 30 * 86_400_000, kind: 'cli', project_id: P, project_name: 'Clinic', device_name: 'Test MacBook', email: 'dev@example.test', origin: ORIGIN });
    const text = homeScreen({ CHERT_HOME: directory }, { color: false, truecolor: false, unicode: true, output: { columns: 80, rows: 30 } } as unknown as Terminal);
    assert.match(text, /✓ Signed in as dev@example\.test/); assert.match(text, /Project\s+Clinic/); assert.match(text, /Device\s+Test MacBook/); assert.match(text, /Expires\s+\w+ \d+, \d{4} \(30 days\)/);
    assert.match(text, /v\d+\.\d+\.\d+/); assert.match(text, /chert whoami/);
    for (const line of text.split('\n')) assert.ok(line.length <= 80, line);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('device login: a 200 that still says pending, a 429 and a 503 keep waiting', async () => {
  const d = device({ polls: [{ status: 200, data: { status: 'pending' } }, { status: 429 }, { status: 503 }, { status: 200, data: approved() }] });
  assert.equal((await d.run()).access_token, token('a'));
  assert.equal(d.urls.filter(url => url.endsWith('/token')).length, 4);
});

test('device login: a poll that Chert rejects outright stops at once instead of waiting ten minutes', async () => {
  for (const status of [400, 401, 403, 422]) {
    const d = device({ polls: [{ status }] });
    const error = await failure(d.run());
    assert.equal(error.code, 'login_unavailable', String(status)); assert.equal(d.urls.filter(url => url.endsWith('/token')).length, 1);
  }
});

test('device login: Ctrl+C while the first request is in flight is a cancel, not a network error', async () => {
  const d = device({ start: new Error('aborted'), polls: [] });
  d.controller.abort();
  assert.equal((await failure(d.run())).code, 'login_cancelled');
});

test('device login: the address that carries the code must carry the code that is shown', async () => {
  const d = device({ start: { status: 201, data: { ...started(), verification_url_complete: `${ORIGIN}/cli?code=ZZZZ-9999` } }, polls: [] });
  assert.equal((await failure(d.run())).code, 'backend_response_invalid');
  const elsewhere = device({ start: { status: 201, data: { ...started(), verification_url: `${ORIGIN}/somewhere-else` } }, polls: [] });
  assert.equal((await failure(elsewhere.run())).code, 'backend_response_invalid');
});

test('device login: names from the server cannot draw on the terminal, and an over-long name does not waste the credential', async () => {
  const d = device({ polls: [{ status: 200, data: approved({ email: 'dev@example.test\x1b[2J', project: { id: P, name: `\x1b]0;owned\x07Clinic\r\n${'x'.repeat(400)}` }, device_name: 'Mac\x1b[31m' }) }] });
  const credential = await d.run();
  for (const value of [credential.email, credential.project_name, credential.device_name]) assert.doesNotMatch(String(value), /[\x00-\x1f\x7f-\x9f]/);
  assert.ok(credential.project_name!.startsWith(']0;ownedClinic')); assert.ok(credential.project_name!.length <= 200);
  assert.equal(credential.access_token, token('a'));
});

test('device login: a missing email or project name is fine; a missing project is not', async () => {
  const bare = device({ polls: [{ status: 200, data: approved({ email: null, project: { id: P, name: null } }) }] });
  const credential = await bare.run();
  assert.equal(credential.email, undefined); assert.equal(credential.project_name, undefined); assert.equal(credential.project_id, P);
  assert.equal((await failure(device({ polls: [{ status: 200, data: approved({ project: { id: 'nope' } }) }] }).run())).code, 'backend_response_invalid');
  assert.equal((await failure(device({ polls: [{ status: 200, data: approved({ expires_in: 0 }) }] }).run())).code, 'backend_response_invalid');
});

test('device name: a recognisable, printable, bounded name for the approval page', () => {
  const name = deviceName();
  assert.ok(name.length >= 1 && name.length <= 80); assert.match(name, /^[\x20-\x7e]+$/); assert.doesNotMatch(name, /\.local$/);
});

// ---- the sign-in command ------------------------------------------------------------------------------------------

function rig(options: { terminal?: boolean; go?: boolean; next?: string; revokeFails?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'chert-sign-in-edge-'));
  const records: Record<string, unknown>[] = []; const revoked: { origin: string; token: string }[] = []; const urls: string[] = [];
  const deps: LoginDeps = { ...(options.terminal ? { terminal: { color: false, truecolor: false, unicode: true } as Terminal } : {}), keyboard: Boolean(options.terminal), remote: false, readPipe: () => sessionToken,
    device: { fetch: (async (input: string | URL | Request) => { const url = String(input); urls.push(url);
      return url.endsWith('/logins') ? new Response(JSON.stringify({ data: started(new URL(url).origin) }), { status: 201 })
        : new Response(JSON.stringify({ data: approved({ access_token: options.next ?? token('a') }) }), { status: 200 }); }) as typeof fetch,
    pause: async () => {}, open: async () => true, now: () => Date.now() },
    welcome: async () => (options.go ?? true) ? 'browser' : null,
    readHidden: async () => null,
    waiting: () => ({ stop() {} }),
    revoke: async (origin, value) => { revoked.push({ origin, token: value }); if (options.revokeFails) throw new Error('offline'); } };
  const env = { CHERT_HOME: directory };
  const run = (args: string[] = [], extra: NodeJS.ProcessEnv = {}) => login(args, { ...env, ...extra }, new AbortController().signal, record => records.push(record), deps);
  return { run, records, revoked, urls, env, directory, store: credentialStore(directory), close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('sign in: the credential remembers which Chert it came from', async () => {
  const usual = rig(); const staging = rig();
  try {
    await usual.run(); assert.equal(usual.store.load()!.origin, DEFAULT);
    await staging.run(['--backend', `${ORIGIN}/`]); assert.equal(staging.store.load()!.origin, ORIGIN);
  } finally { usual.close(); staging.close(); }
});

test('sign in: signing in again revokes the credential it replaces, at the Chert that issued it', async () => {
  const r = rig({ next: token('b') });
  try {
    r.store.save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, origin: ORIGIN });
    assert.equal(await r.run(), 0);
    assert.equal(r.store.load()!.access_token, token('b'));
    assert.deepEqual(r.revoked, [{ origin: ORIGIN, token: token('a') }]);
  } finally { r.close(); }
});

test('sign in: a failed revoke of the old credential does not fail the new sign-in; a pasted session is never sent to revoke', async () => {
  const failing = rig({ next: token('b'), revokeFails: true }); const session = rig({ next: token('b') });
  try {
    failing.store.save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P });
    assert.equal(await failing.run(), 0); assert.equal(failing.store.load()!.access_token, token('b'));
    session.store.save({ access_token: sessionToken, expires_at: Date.now() + 60_000 });
    assert.equal(await session.run(), 0); assert.deepEqual(session.revoked, []);
  } finally { failing.close(); session.close(); }
});

test('sign in: when the credential it replaces could not be revoked, the person is told and given the day it stops working', async () => {
  const until = Date.now() + 29 * 86_400_000, day = new Date(until).toISOString().slice(0, 10);
  const old = { access_token: token('a'), expires_at: until, kind: 'cli' as const, project_id: P, origin: ORIGIN };
  const said = (r: ReturnType<typeof rig>) => { const done = r.records.find(x => x.code === 'signed_in')!; return { done, text: String(done.message).replace(/\s+/g, ' ') }; };
  for (const [options, args] of [[{}, []], [{}, ['--json']], [{ terminal: true }, []], [{}, ['--with-token']]] as const) {
    const r = rig({ next: token('b'), revokeFails: true, ...options });
    try {
      r.store.save(old);
      assert.equal(await r.run([...args]), 0); assert.notEqual(r.store.load()!.access_token, token('a'), 'the new sign-in still stands');
      const { done, text } = said(r);
      assert.equal(done.previous_revoked, false, JSON.stringify(args));
      assert.ok(text.includes(`The earlier command-line credential on this computer could not be revoked at Chert: it stops working on ${day}.`), text);
      assert.match(text, /A project owner or admin can revoke it sooner from the Chert dashboard\./);
      if (!args.length) assert.match(text, /chert dev\b/, 'the next step is still shown');
      assert.ok(!JSON.stringify(r.records).includes(token('a')), 'the earlier credential is never printed');
    } finally { r.close(); }
  }
  const fine = rig({ next: token('b') }); const first = rig({ next: token('b') }); const stale = rig({ next: token('b'), revokeFails: true });
  try {
    fine.store.save(old); await fine.run();
    assert.equal(said(fine).done.previous_revoked, true); assert.doesNotMatch(said(fine).text, /could not be revoked/);
    await first.run();
    assert.equal('previous_revoked' in said(first).done, false, 'nothing was replaced'); assert.doesNotMatch(said(first).text, /could not be revoked/);
    stale.store.save({ ...old, expires_at: Date.now() - 1000 }); await stale.run();
    assert.doesNotMatch(said(stale).text, /could not be revoked/, 'an earlier credential that had already run out needs no warning');
  } finally { fine.close(); first.close(); stale.close(); }
});

test('sign in: a cancelled or failed attempt never revokes the credential that still works', async () => {
  const r = rig({ terminal: true, go: false });
  try {
    r.store.save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P });
    await failure(r.run());
    assert.deepEqual(r.revoked, []); assert.equal(r.store.load()!.access_token, token('a'));
  } finally { r.close(); }
});

test('sign in: replacing a command-line credential with a pasted session token also revokes it', async () => {
  const r = rig();
  try {
    r.store.save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, origin: ORIGIN });
    assert.equal(await r.run(['--with-token']), 0);
    assert.equal(r.store.load()!.access_token, sessionToken); assert.equal(r.store.load()!.project_id, undefined);
    assert.deepEqual(r.revoked, [{ origin: ORIGIN, token: token('a') }]);
  } finally { r.close(); }
});

test('first run: an environment token counts as signed in, so a bare chert shows help rather than the welcome screen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-signed-in-'));
  try {
    assert.equal(signedIn({ CHERT_HOME: directory }), false);
    assert.equal(signedIn({ CHERT_HOME: directory, CHERT_USER_ACCESS_TOKEN: sessionToken }), true);
    credentialStore(directory).save({ access_token: token('a'), expires_at: Date.now() - 1, kind: 'cli', project_id: P });
    assert.equal(signedIn({ CHERT_HOME: directory }), false, 'an expired credential is not signed in');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('first run: the screen needs two terminals, no --json and a terminal that understands it', () => {
  const tty = { isTTY: true } as NodeJS.ReadStream & NodeJS.WriteStream; const pipe = { isTTY: false } as NodeJS.ReadStream & NodeJS.WriteStream;
  assert.ok(terminalFor({ TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }, false, tty, tty));
  assert.equal(terminalFor({}, false, pipe, tty), undefined); assert.equal(terminalFor({}, false, tty, pipe), undefined);
  assert.equal(terminalFor({}, true, tty, tty), undefined); assert.equal(terminalFor({ TERM: 'dumb' }, false, tty, tty), undefined);
  assert.equal(terminalFor({ NO_COLOR: '1' }, false, tty, tty)!.color, false); assert.equal(terminalFor({ TERM: 'xterm' }, false, tty, tty)!.color, true);
  // Braille needs a UTF-8 terminal. With no locale set at all, modern terminals are UTF-8.
  assert.equal(terminalFor({ COLORTERM: 'truecolor' }, false, tty, tty)!.truecolor, true); assert.equal(terminalFor({ TERM: 'xterm-256color' }, false, tty, tty)!.truecolor, false);
  assert.equal(terminalFor({ LANG: 'en_US.UTF-8' }, false, tty, tty)!.unicode, true); assert.equal(terminalFor({}, false, tty, tty)!.unicode, true);
  assert.equal(terminalFor({ LANG: 'C' }, false, tty, tty)!.unicode, false); assert.equal(terminalFor({ LANG: 'en_US.UTF-8', LC_ALL: 'POSIX' }, false, tty, tty)!.unicode, false);
});

// ---- sign out and the commands that use the credential ---------------------------------------------------------

async function withFetch<T>(respond: (url: string) => Response, run: (seen: string[]) => Promise<T>): Promise<T> {
  const previous = globalThis.fetch; const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => { seen.push(String(input)); return respond(String(input)); }) as typeof fetch;
  try { return await run(seen); } finally { globalThis.fetch = previous; }
}
async function command(name: string, env: NodeJS.ProcessEnv) {
  const records: Record<string, unknown>[] = [];
  const exit = await developerCommand(name, [], env, new AbortController().signal, record => records.push(record));
  return { exit, records };
}

test('sign out: the credential is revoked at the Chert that issued it, and the message says whether that worked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-sign-out-edge-')); const store = credentialStore(directory);
  try {
    await withFetch(() => Response.json({ data: { revoked: true } }), async seen => {
      store.save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, origin: ORIGIN });
      const out = await command('logout', { CHERT_HOME: directory });
      assert.deepEqual(seen, [`${ORIGIN}/api/v1/cli/logout`]); assert.match(String(out.records[0]!.message), /revoked/i);
    });
    await withFetch(() => new Response('{}', { status: 503 }), async () => {
      store.save({ access_token: token('a'), expires_at: Date.now() + 86_400_000, kind: 'cli', project_id: P });
      const out = await command('logout', { CHERT_HOME: directory });
      assert.equal(out.exit, 0); assert.equal(store.load(), undefined, 'this computer is signed out either way');
      assert.match(String(out.records[0]!.message), /could not .*revoke/i); assert.ok(!JSON.stringify(out.records).includes(token('a')));
    });
    await withFetch(() => assert.fail('no request expected'), async () => {
      assert.equal((await command('logout', { CHERT_HOME: directory })).records[0]!.message, 'Signed out on this machine.', 'nothing stored');
      store.save({ access_token: sessionToken, expires_at: Date.now() + 60_000 });
      assert.equal((await command('logout', { CHERT_HOME: directory })).records[0]!.message, 'Signed out on this machine.', 'a pasted session');
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('sign out: a credential Chert says it did not revoke now, because it had already ended, is not reported as revoked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-sign-out-ended-')); const store = credentialStore(directory);
  const held = () => store.save({ access_token: token('a'), expires_at: Date.now() + 86_400_000, kind: 'cli', project_id: P, origin: ORIGIN });
  try {
    // An owner revoked it from the dashboard, or the membership was removed: Chert answers 200 with revoked false.
    await withFetch(() => Response.json({ data: { revoked: false } }), async () => {
      held(); const out = await command('logout', { CHERT_HOME: directory });
      assert.equal(out.exit, 0); assert.equal(store.load(), undefined);
      assert.equal(out.records[0]!.message, 'Signed out. Chert had already ended this login.');
      assert.equal(out.records[0]!.revoked, false); assert.equal(out.records[0]!.already_ended, true);
      assert.equal(await revokeCredential(ORIGIN, token('a')), false);
      held(); assert.deepEqual(await logout(store, value => revokeCredential(ORIGIN, value)), { signed_out: true, revoked: false, already_ended: true });
    });
    await withFetch(() => Response.json({ data: { revoked: true } }), async () => {
      assert.equal(await revokeCredential(ORIGIN, token('a')), true);
      held(); const out = await command('logout', { CHERT_HOME: directory });
      assert.equal(out.records[0]!.revoked, true); assert.equal(out.records[0]!.already_ended, undefined); assert.equal(out.records[0]!.message, 'Signed out. The credential was revoked at Chert.');
    });
    // A 2xx that does not say either way confirms nothing.
    for (const body of ['{}', 'ok', '{"data":{"revoked":"yes"}}']) await withFetch(() => new Response(body, { status: 200 }), async () => {
      await assert.rejects(revokeCredential(ORIGIN, token('a')));
      held(); const out = await command('logout', { CHERT_HOME: directory });
      assert.equal(out.records[0]!.revoked, false); assert.equal(out.records[0]!.already_ended, undefined); assert.match(String(out.records[0]!.message), /could not .*revoke/i);
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const LIVEKIT = { LIVEKIT_URL: 'wss://fixture.livekit.invalid', LIVEKIT_API_KEY: 'APIfixture', LIVEKIT_API_SECRET: 'SECRET_SENTINEL_at_least_32_characters_long' };
function chert(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [executable, ...args, '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...LIVEKIT, ...env }, timeout: 20000 });
}

test('dev and doctor: a different --project than the signed-in one is refused before any network call', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-dev-project-'));
  try {
    credentialStore(directory).save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, project_name: 'Clinic', origin: 'https://127.0.0.1:9' });
    for (const name of ['dev', 'doctor']) {
      const result = chert([name, '--agent', 'a', '--project', OTHER], { CHERT_HOME: directory });
      assert.equal(result.status, 3, result.stderr); const error = JSON.parse(result.stderr);
      assert.equal(error.code, 'project_not_signed_in'); assert.match(error.action, /Clinic/); assert.ok(!result.stderr.includes(token('a')));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('dev: it talks to the Chert the credential came from unless told otherwise', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-dev-origin-'));
  try {
    credentialStore(directory).save({ access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, origin: 'http://not-https.example' });
    // The stored address is used (and rejected as not https) rather than silently falling back to production.
    const stored = chert(['dev', '--agent', 'a'], { CHERT_HOME: directory });
    assert.equal(stored.status, 2, stored.stderr); assert.equal(JSON.parse(stored.stderr).code, 'invalid_origin');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('dev: a command-line credential in the environment needs --project, and says so', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-dev-env-'));
  try {
    const result = chert(['dev', '--agent', 'a'], { CHERT_HOME: directory, CHERT_USER_ACCESS_TOKEN: token('a') });
    assert.equal(result.status, 2, result.stderr); const error = JSON.parse(result.stderr);
    assert.equal(error.code, 'project_required'); assert.match(error.action, /--project/); assert.ok(!result.stderr.includes(token('a')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('doctor: a command-line credential in the environment is a sign-in, as it is for dev, and needs --project the same way', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-doctor-env-'));
  try {
    // Nothing listens on the control address, and the LiveKit address is malformed, so no request leaves this computer.
    const env = { CHERT_HOME: directory, CHERT_USER_ACCESS_TOKEN: token('a'), CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9', LIVEKIT_URL: 'https://wrong.example' };
    const result = chert(['doctor', '--project', P], env);
    const checks = JSON.parse(result.stdout).checks as { name: string; status: string; detail: string }[];
    const named = (name: string) => checks.find(check => check.name === name)!;
    assert.equal(named('session').status, 'pass', result.stdout); assert.equal(named('session').detail, 'Signed in.');
    assert.equal(named('chert').detail, 'Could not reach Chert.', 'the credential was taken to Chert, not skipped for want of a session');
    assert.ok(!(result.stdout + result.stderr).includes(token('a')));
    const bare = chert(['doctor'], env);
    assert.equal(bare.status, 2, bare.stderr); const error = JSON.parse(bare.stderr);
    assert.equal(error.code, 'project_required'); assert.match(error.action, /--project/); assert.ok(!bare.stderr.includes(token('a')));
    // A value that is neither kind of credential is still not a sign-in.
    const junk = JSON.parse(chert(['doctor', '--project', P], { ...env, CHERT_USER_ACCESS_TOKEN: 'not-a-credential' }).stdout).checks as { name: string; status: string }[];
    assert.equal(junk.find(check => check.name === 'session')!.status, 'fail'); assert.equal(junk.find(check => check.name === 'chert')!.status, 'skip');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// ---- whoami ------------------------------------------------------------------------------------------------------

function session(saved: Parameters<ReturnType<typeof credentialStore>['save']>[0] | undefined, projects: () => Promise<{ id: string; name: string; role: string }[]>) {
  const directory = mkdtempSync(join(tmpdir(), 'chert-whoami-')); const store = credentialStore(directory); const asked: unknown[][] = [];
  if (saved) store.save(saved);
  const connect = ((...args: unknown[]) => { asked.push(args); return { projects } as unknown as Control; }) as unknown as Parameters<typeof confirmSession>[2];
  return { run: (env: NodeJS.ProcessEnv = {}) => confirmSession(store, { CHERT_HOME: directory, ...env }, connect), asked, close: () => rmSync(directory, { recursive: true, force: true }) };
}
const cli = { access_token: token('a'), expires_at: Date.now() + 60_000, kind: 'cli' as const, project_id: P, project_name: 'Old name', email: 'dev@example.test', origin: ORIGIN };

test('whoami: it asks the Chert that issued the credential and reports the current project name and role', async () => {
  const s = session(cli, async () => [{ id: P, name: 'Clinic', role: 'admin' }]);
  try {
    const out = await s.run({ CHERT_CONTROL_ORIGIN: 'https://ignored.example' });
    assert.deepEqual(s.asked, [[ORIGIN, token('a'), P]]);
    assert.equal(out.message, 'Signed in as dev@example.test · project Clinic (admin).'); assert.equal(out.confirmed, true); assert.equal(out.role, 'admin');
    assert.ok(!JSON.stringify(out).includes(token('a')));
  } finally { s.close(); }
});

test('whoami: a credential Chert no longer accepts is reported as signed out, not as signed in', async () => {
  const s = session(cli, async () => { throw new CLIError('login_required', 3, 'x'); });
  try { const out = await s.run(); assert.equal(out.signed_in, false); assert.equal(out.confirmed, true); assert.match(String(out.message), /no longer accepts.*chert login/i); } finally { s.close(); }
});

test('whoami: offline, or when Chert misbehaves, it gives the local answer and says it is unconfirmed', async () => {
  for (const error of [new CLIError('backend_unreachable', 6, 'x'), new CLIError('backend_response_invalid', 6, 'x'), new Error('boom')]) {
    const s = session(cli, async () => { throw error; });
    try { const out = await s.run(); assert.equal(out.signed_in, true); assert.equal(out.confirmed, false); assert.equal(out.message, 'Signed in as dev@example.test · project Old name. Chert could not be reached to confirm it.'); } finally { s.close(); }
  }
});

test('whoami: nobody signed in, or an expired credential, asks nothing; a pasted session is confirmed without a project', async () => {
  const none = session(undefined, async () => assert.fail('no request expected'));
  const expired = session({ ...cli, expires_at: Date.now() - 1 }, async () => assert.fail('no request expected'));
  const pasted = session({ access_token: sessionToken, expires_at: Date.now() + 60_000, email: 'dev@example.test' }, async () => [{ id: P, name: 'Clinic', role: 'owner' }, { id: OTHER, name: 'Other', role: 'member' }]);
  try {
    for (const s of [none, expired]) { const out = await s.run(); assert.equal(out.signed_in, false); assert.equal(out.message, 'Not signed in. Run chert login.'); assert.deepEqual(s.asked, []); }
    const out = await pasted.run({ CHERT_CONTROL_ORIGIN: ORIGIN });
    assert.equal(out.message, 'Signed in as dev@example.test.'); assert.equal(out.projects, 2); assert.deepEqual(pasted.asked, [[ORIGIN, sessionToken, undefined]]);
  } finally { none.close(); expired.close(); pasted.close(); }
});
