import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLogin, type DeviceLoginDeps } from '../../src/dev/device-login.js';
import { CLIError } from '../../src/cli/errors.js';

const ORIGIN = 'https://control.example';
// The contract with the server: a Chert server puts the approval page on its own origin, the one this CLI asked.
const started = { device_code: `fdc_${'d'.repeat(43)}`, user_code: 'KDTF-2937', verification_url: `${ORIGIN}/cli`,
  verification_url_complete: `${ORIGIN}/cli?code=KDTF-2937`, expires_in: 600, interval: 2 };
const approved = { status: 'approved', access_token: `ftu_${'a'.repeat(43)}`, email: 'dev@example.test', project: { id: '11000000-0000-4000-8000-000000000001', name: 'Clinic' },
  device_name: 'Test MacBook', expires_in: 2_592_000 };
type Reply = { status: number; data?: unknown; error?: { code: string } } | Error | Response;
const pending: Reply = { status: 202, data: { status: 'pending' } };
/** A 200 whose headers arrive and whose body then stops; `then` runs when the body is asked for. */
const stalled = (then: () => void = () => {}) => new Response(new ReadableStream({ pull(controller) { then(); controller.error(new TypeError('terminated')); } }, { highWaterMark: 0 }), { status: 200 });

function rig(script: { start?: Reply; polls: Reply[] }) {
  const seen: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const records: Record<string, unknown>[] = []; const opened: string[] = []; const pauses: number[] = [];
  let clock = 1_800_000_000_000; const polls = [...script.polls];
  const controller = new AbortController();
  const deps: DeviceLoginDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      seen.push({ url, body, headers: Object.fromEntries(Object.entries(init?.headers ?? {})) });
      const reply = url.endsWith('/api/v1/cli/logins') ? script.start ?? { status: 201, data: started } : polls.shift() ?? { status: 202, data: { status: 'pending' } };
      if (reply instanceof Error) throw reply;
      if (reply instanceof Response) return reply;
      return new Response(JSON.stringify(reply.data !== undefined ? { data: reply.data } : { error: reply.error ?? { code: 'x' } }), { status: reply.status });
    }) as typeof fetch,
    pause: async ms => { pauses.push(ms); clock += ms; },
    open: async url => { opened.push(url); return true; },
    now: () => clock,
  };
  const run = (overrides: Partial<Parameters<typeof deviceLogin>[0]> = {}) =>
    deviceLogin({ origin: ORIGIN, deviceName: 'Test MacBook', openBrowser: true, signal: controller.signal, emit: record => records.push(record), ...overrides }, deps);
  return { run, seen, records, opened, pauses, deps, abort: () => controller.abort(), codes: () => records.map(r => String(r.code)) };
}
async function failure(promise: Promise<unknown>): Promise<CLIError> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error; }
  return assert.fail('expected a CLIError');
}

test('device login: shows the code and address, opens the browser, polls until approved and returns the credential', async () => {
  const r = rig({ polls: [{ status: 202, data: { status: 'pending' } }, { status: 202, data: { status: 'pending' } }, { status: 200, data: approved }] });
  const credential = await r.run();
  assert.equal(r.seen[0]!.url, `${ORIGIN}/api/v1/cli/logins`); assert.deepEqual(r.seen[0]!.body, { device_name: 'Test MacBook' });
  assert.equal(r.seen[0]!.headers.authorization, undefined, 'starting a login sends no credential');
  assert.deepEqual(r.opened, [started.verification_url_complete]);
  const shown = r.records.find(x => x.code === 'login_code')!;
  assert.equal(shown.user_code, 'KDTF-2937'); assert.equal(shown.verification_url, `${ORIGIN}/cli`);
  assert.equal(shown.verification_url_complete, started.verification_url_complete, 'the screen offers to copy the address with the code in it');
  assert.match(String(shown.message), /KDTF-2937/); assert.match(String(shown.message), /control\.example\/cli/);
  assert.equal(r.seen.filter(s => s.url.endsWith('/token')).length, 3);
  assert.deepEqual(r.seen.at(-1)!.body, { device_code: started.device_code });
  assert.deepEqual(r.pauses, [2000, 2000, 2000], 'waits the server interval before each poll');
  assert.deepEqual(credential, { access_token: approved.access_token, expires_at: r.deps.now() + 2_592_000_000, email: 'dev@example.test', kind: 'cli',
    project_id: approved.project.id, project_name: 'Clinic', device_name: 'Test MacBook', origin: ORIGIN });
  // The device code and the credential never appear in anything shown to the user.
  const text = JSON.stringify(r.records);
  assert.ok(!text.includes(started.device_code) && !text.includes(approved.access_token));
});

test('device login: without a browser it only prints the address and code', async () => {
  const r = rig({ polls: [{ status: 200, data: approved }] });
  await r.run({ openBrowser: false });
  assert.deepEqual(r.opened, []);
  assert.match(String(r.records.find(x => x.code === 'login_code')!.message), /open .*control\.example\/cli.* on any device/i);
});

test('device login: a browser that will not open falls back to the printed address', async () => {
  const r = rig({ polls: [{ status: 200, data: approved }] });
  r.deps.open = async () => false;
  await r.run();
  assert.equal(r.codes().includes('login_browser_unavailable'), true);
});

test('device login: a server without this feature is named, with the way forward', async () => {
  const error = await failure(rig({ start: { status: 404, error: { code: 'not_found' } }, polls: [] }).run());
  assert.equal(error.code, 'login_unsupported'); assert.match(error.action, /--with-token/);
});

test('device login: busy, unreachable and malformed starts are told apart', async () => {
  assert.equal((await failure(rig({ start: { status: 429, error: { code: 'cli_login_busy' } }, polls: [] }).run())).code, 'login_busy');
  assert.equal((await failure(rig({ start: new TypeError('fetch failed'), polls: [] }).run())).code, 'backend_unreachable');
  assert.equal((await failure(rig({ start: { status: 201, data: { user_code: 'nope' } }, polls: [] }).run())).code, 'backend_response_invalid');
});

test('device login: an approval page on any other address than the one asked is refused by name, before anything is shown or opened', async () => {
  const elsewhere = (host: string) => ({ ...started, verification_url: `https://${host}/cli`, verification_url_complete: `https://${host}/cli?code=KDTF-2937` });
  const cases: [Record<string, unknown>, string][] = [
    // What a server that pins the page to the production dashboard answers when asked on a preview or staging address.
    [elsewhere('facetime.trychert.com'), 'facetime.trychert.com'],
    [{ ...started, verification_url_complete: 'https://evil.example/cli?code=KDTF-2937' }, 'evil.example'],
    [{ ...started, verification_url: 'https://user:secret@evil.example/cli' }, 'evil.example'],
    [elsewhere('control.example:8443'), 'control.example:8443'],
  ];
  for (const [data, host] of cases) {
    const r = rig({ start: { status: 201, data }, polls: [] });
    const error = await failure(r.run());
    assert.equal(error.code, 'login_origin_mismatch', host); assert.equal(error.exit, 6);
    assert.equal(error.action, `This Chert server sent a sign-in page on a different address (${host}). Update the CLI or check --backend.`);
    assert.deepEqual(r.records, [], 'no code is shown'); assert.deepEqual(r.opened, [], 'no browser is opened'); assert.equal(r.seen.length, 1, 'and nothing is polled');
  }
  // An address that is not https is not a sign-in page at all.
  for (const data of [{ ...started, verification_url: 'http://control.example/cli' }, { ...started, verification_url_complete: 'javascript:alert(1)//cli?code=KDTF-2937' }])
    assert.equal((await failure(rig({ start: { status: 201, data }, polls: [] }).run())).code, 'backend_response_invalid');
});

test('device login: an expired or refused login stops with what to do next', async () => {
  for (const reply of [{ status: 410, error: { code: 'cli_login_expired' } }, { status: 404, error: { code: 'cli_login_not_found' } }]) {
    const error = await failure(rig({ polls: [{ status: 202, data: { status: 'pending' } }, reply] }).run());
    assert.equal(error.code, 'login_expired'); assert.match(error.action, /chert login/);
  }
});

test('device login: it gives up when the login lifetime has passed without approval', async () => {
  const r = rig({ polls: [] });
  const error = await failure(r.run());
  assert.equal(error.code, 'login_expired');
  assert.ok(r.pauses.reduce((a, b) => a + b, 0) <= 600_000 + 2000);
});

test('device login: a network blip while waiting is retried, not fatal', async () => {
  const r = rig({ polls: [new TypeError('fetch failed'), { status: 502, error: { code: 'bad_gateway' } }, { status: 200, data: approved }] });
  assert.equal((await r.run()).access_token, approved.access_token);
});

test('device login: Ctrl+C while waiting stops polling', async () => {
  const r = rig({ polls: [] });
  r.deps.pause = async () => { r.abort(); };
  assert.equal((await failure(r.run())).code, 'login_cancelled');
  assert.ok(r.seen.filter(s => s.url.endsWith('/token')).length <= 1);
});

test('device login: an approved answer that is not a command-line credential is refused', async () => {
  const error = await failure(rig({ polls: [{ status: 200, data: { ...approved, access_token: 'eyJ.session.token' } }] }).run());
  assert.equal(error.code, 'backend_response_invalid');
});

// ---- the answer that cannot be asked for twice ---------------------------------------------------------------------
// Chert marks a login redeemed before it replies, so the reply to the redeeming poll is the only copy of the credential.

test('device login: a poll is given longer to answer than the start request, because its answer may be the credential', async () => {
  const asked: number[] = [];
  const timeout = mock.method(AbortSignal, 'timeout', (ms: number) => { asked.push(ms); return new AbortController().signal; });
  try {
    const r = rig({ polls: [pending, { status: 200, data: approved }] });
    await r.run();
    assert.deepEqual(asked, [10_000, 60_000, 60_000], 'the start request, then each poll');
  } finally { timeout.mock.restore(); }
});

test('device login: an answer lost on the way, then a code that is gone, is an interrupted sign-in and not an expired code', async () => {
  const lost: [string, () => Reply][] = [['the request failed', () => new TypeError('fetch failed')], ['the body stopped', stalled], ['a gateway answered for Chert', () => ({ status: 504 })]];
  for (const [how, reply] of lost) for (const gone of [404, 410]) {
    const r = rig({ polls: [pending, reply(), { status: gone, error: { code: 'cli_login_not_found' } }] });
    const error = await failure(r.run());
    assert.equal(error.code, 'login_interrupted', `${how}, then ${gone}`); assert.equal(error.exit, 3);
    assert.match(error.action, /Run chert login again/); assert.match(error.action, /revoke it from the Chert dashboard/);
    assert.doesNotMatch(error.action, /expired/, 'nobody is told the code expired before it was approved');
    assert.equal(r.seen.filter(s => s.url.endsWith('/token')).length, 3, 'the poll after the loss is the one that tells');
  }
});

test('device login: the login lifetime running out right after a lost answer is an interrupted sign-in too', async () => {
  const r = rig({ start: { status: 201, data: { ...started, expires_in: 4 } }, polls: [pending, new TypeError('fetch failed')] });
  assert.equal((await failure(r.run())).code, 'login_interrupted');
});

test('device login: a lost answer is forgotten once Chert says the login is still waiting', async () => {
  for (const waiting of [pending, { status: 200, data: { status: 'pending' } }]) {
    const r = rig({ polls: [new TypeError('fetch failed'), stalled(), waiting, { status: 410, error: { code: 'cli_login_expired' } }] });
    assert.equal((await failure(r.run())).code, 'login_expired');
  }
  const approvedLater = rig({ polls: [stalled(), new TypeError('fetch failed'), { status: 200, data: approved }] });
  assert.equal((await approvedLater.run()).access_token, approved.access_token, 'and a later answer that does arrive is taken');
});

test('device login: a 200 that is not an answer at all is refused at once, and Ctrl+C while a body arrives is a cancel', async () => {
  for (const reply of [new Response(null, { status: 200 }), new Response('x'.repeat(20_000), { status: 200 }), new Response('not json', { status: 200 })]) {
    const r = rig({ polls: [reply] });
    assert.equal((await failure(r.run())).code, 'backend_response_invalid'); assert.equal(r.seen.filter(s => s.url.endsWith('/token')).length, 1);
  }
  const r = rig({ polls: [stalled(() => r.abort())] });
  assert.equal((await failure(r.run())).code, 'login_cancelled');
});


test('onboarding device login carries one setup key through browser URLs and stored credential', async () => {
  const onboardingRequestKey = '44000000-0000-4000-8000-000000000004';
  const r = rig({ polls: [{ status: 200, data: approved }] });
  const result = await r.run({ onboardingRequestKey });
  assert.equal(new URL(r.opened[0]!).searchParams.get('onboard'), onboardingRequestKey);
  const shown = r.records.find(record => record.code === 'login_code')!;
  assert.equal(new URL(String(shown.verification_url)).searchParams.get('onboard'), onboardingRequestKey);
  assert.equal(result.onboarding_request_key, onboardingRequestKey);
});

test('interrupted browser setup directs the user back to the saved onboarding intent', async () => {
  const r = rig({ polls: [new TypeError('lost credential response'), { status: 410 }] });
  const error = await failure(r.run({ onboardingRequestKey: '44000000-0000-4000-8000-000000000004' }));
  assert.equal(error.code, 'login_interrupted');
  assert.match(error.action, /Run chert onboard again/);
  assert.doesNotMatch(error.action, /Run chert login/);
  assert.match(error.action, /revoke it from the Chert dashboard/);
});


test('setup login prints the device consent code in human output locally and remotely', async () => {
  for (const openBrowser of [true, false]) {
    const r = rig({ polls: [{ status: 200, data: approved }] });
    await r.run({ openBrowser, onboardingRequestKey: '44000000-0000-4000-8000-000000000004' });
    const shown = r.records.find(record => record.code === 'login_code')!;
    assert.match(String(shown.message), /Confirm.*code[\s\S]*KDTF-2937/);
  }
});
