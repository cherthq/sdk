import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnboarding, onboardingStore, type OnboardingResume, type OnboardingSession, type OnboardingStore } from '../../src/dev/onboard.js';
import type { DeviceLoginDeps } from '../../src/dev/device-login.js';
import { CLIError } from '../../src/cli/errors.js';

const origin = 'https://control.example', project = '11000000-0000-4000-8000-000000000001';
const id = '22000000-0000-4000-8000-000000000002', line = '33000000-0000-4000-8000-000000000003';
const requestKey = '44000000-0000-4000-8000-000000000004', call = '55000000-0000-4000-8000-000000000005';
const token = `ftu_${'x'.repeat(43)}`;
const session = (status: OnboardingSession['status'], extra: Partial<OnboardingSession> = {}): OnboardingSession => ({
  id, status, verification_url: `${origin}/cli/onboarding?session=${id}&project=${project}`, expires_at: '2027-01-15T09:00:00.000Z',
  line: { id: line, receiving_number: '+15555550100' }, ...extra,
});
type Reply = OnboardingSession | Error | { status: number; error: string };
function rig(replies: Reply[], initial?: OnboardingResume) {
  let held = initial, now = Date.parse('2027-01-15T08:00:00.000Z');
  const seen: { url: string; init: RequestInit; resume?: OnboardingResume }[] = [], records: Record<string, unknown>[] = [], opened: string[] = [];
  const controller = new AbortController();
  const store: OnboardingStore = { load: () => held, create: () => held ??= { request_key: requestKey }, save: value => { held = value; }, clear: () => { held = undefined; } };
  const deps: DeviceLoginDeps = {
    now: () => now, open: async url => { opened.push(url); return true; }, pause: async ms => { now += ms; },
    fetch: (async (url: unknown, init: RequestInit) => {
      seen.push({ url: String(url), init, resume: held && { ...held } });
      const reply = replies.shift();
      assert.ok(reply, 'unexpected additional request');
      if (reply instanceof Error) throw reply;
      return typeof reply.status === 'number'
        ? Response.json({ error: { code: reply.error } }, { status: reply.status })
        : Response.json({ data: reply });
    }) as typeof fetch,
  };
  const run = (overrides: Partial<Parameters<typeof runOnboarding>[0]> = {}) => runOnboarding({ origin, token, project,
    signal: controller.signal, openBrowser: true, emit: record => records.push(record), ...overrides }, store, deps);
  return { run, store, deps, seen, records, opened, controller, state: () => held };
}
async function errorCode(work: Promise<unknown>): Promise<string> {
  try { await work; assert.fail('expected failure'); } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error.code; }
}

test('onboard allocates once, opens the browser, waits for proof and requests one hosted demo without provider keys', async () => {
  const r = rig([session('awaiting_verification'), session('awaiting_verification'), session('ready'), session('demo_running', { demo_call_id: call })]);
  assert.equal(await r.run(), 0);
  assert.equal(r.seen[0]!.init.method, 'POST');
  assert.equal(r.seen[0]!.resume?.request_key, requestKey, 'save intent before first mutation');
  assert.deepEqual(JSON.parse(String(r.seen[0]!.init.body)), {}, 'server owns project allocation and recipient resolution');
  for (const request of r.seen) {
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get('authorization'), `Bearer ${token}`);
    assert.equal(headers.get('x-chert-project-id'), project);
    assert.equal(request.init.redirect, 'error');
  }
  assert.equal(r.seen.at(-1)!.url, `${origin}/api/v1/onboarding/${id}/demo`);
  assert.equal(new Headers(r.seen.at(-1)!.init.headers).get('idempotency-key'), requestKey);
  assert.deepEqual(r.opened, [session('ready').verification_url]);
  assert.deepEqual(r.state(), { request_key: requestKey, session_id: id });
  assert.equal(r.records.at(-1)?.code, 'onboarding_handoff');
  assert.equal(r.records.at(-1)?.demo_requested, true);
  assert.doesNotMatch(JSON.stringify(r.records), /ftu_|LIVEKIT_API_SECRET|verification_code/);
});

test('lost create response retains intent and retries the same allocation request', async () => {
  const r = rig([new TypeError('lost response'), session('ready')]);
  assert.equal(await errorCode(r.run()), 'backend_unreachable');
  assert.deepEqual(r.state(), { request_key: requestKey });
  assert.equal(await r.run({ skipDemo: true }), 0);
  assert.equal(r.seen.length, 2);
  assert.equal(new Headers(r.seen[0]!.init.headers).get('idempotency-key'), new Headers(r.seen[1]!.init.headers).get('idempotency-key'));
});

test('lost demo response resumes status and never launches a second call', async () => {
  const r = rig([session('ready'), new TypeError('lost demo'), session('demo_running', { demo_call_id: call })], { request_key: requestKey, session_id: id });
  assert.equal(await errorCode(r.run()), 'backend_unreachable');
  assert.equal(await r.run(), 0);
  assert.equal(r.seen.filter(x => x.init.method === 'POST').length, 1);
});

test('status is read-only and skip-demo does not request a call', async () => {
  for (const override of [{ statusOnly: true }, { skipDemo: true }]) {
    const r = rig([session('ready')], { request_key: requestKey, session_id: id });
    assert.equal(await r.run(override), 0);
    assert.deepEqual(r.seen.map(x => x.init.method), ['GET']);
    assert.deepEqual(r.opened, []);
  }
  const empty = rig([]);
  assert.equal(await errorCode(empty.run({ statusOnly: true })), 'onboarding_not_started');
  assert.deepEqual(empty.seen, []);
});

test('cancel ends only the saved session and preserves call cleanup; no new session on uncertain start', async () => {
  const r = rig([session('demo_running', { demo_call_id: call }), session('cancelled', { demo_call_id: call })], { request_key: requestKey, session_id: id });
  assert.equal(await r.run({ cancel: true }), 0);
  assert.deepEqual(r.seen.map(x => x.init.method), ['GET', 'DELETE']);
  assert.equal(r.state()?.session_id, id);
  const uncertain = rig([], { request_key: requestKey });
  assert.equal(await errorCode(uncertain.run({ cancel: true })), 'onboarding_start_uncertain');
  assert.deepEqual(uncertain.seen, []);
});

test('interruption and bounded waiting preserve the same session without demo or cleanup mutations', async () => {
  const r = rig([session('awaiting_verification')]);
  r.deps.pause = async () => { r.controller.abort(); };
  assert.equal(await errorCode(r.run()), 'onboarding_interrupted');
  assert.equal(r.state()?.session_id, id);
  assert.equal(r.seen.length, 1);
  const timed = rig([session('awaiting_verification')]);
  assert.equal(await errorCode(timed.run({ waitSeconds: 0, openBrowser: false })), 'onboarding_waiting');
  assert.equal(timed.seen.length, 1);
  assert.deepEqual(timed.opened, []);
});

test('cross-origin, cross-project and cross-session browser responses are rejected before opening', async () => {
  for (const verification_url of [`https://evil.example/cli/onboarding?session=${id}&project=${project}`, `${origin}/cli/onboarding?session=${line}&project=${project}`, `${origin}/cli/onboarding?session=${id}&project=${line}`, `${origin}/cli/onboarding?session=${id}&project=${project}#fragment`]) {
    const r = rig([session('awaiting_verification', { verification_url })]);
    assert.equal(await errorCode(r.run()), 'backend_response_invalid');
    assert.deepEqual(r.opened, []);
  }
  const wrong = rig([session('ready', { id: line, verification_url: `${origin}/cli/onboarding?session=${line}&project=${project}` })], { request_key: requestKey, session_id: id });
  assert.equal(await errorCode(wrong.run()), 'backend_response_invalid');
});

test('capacity, depleted credit, forbidden membership and expired sessions are explicit and do not discard intent', async () => {
  for (const [status, code, expected] of [[409, 'shared_no_capacity', 'shared_no_capacity'], [403, 'free_credit_required', 'free_credit_required'], [403, 'internal_detail', 'onboarding_forbidden'], [401, 'x', 'login_required']] as const) {
    const r = rig([{ status, error: code }]);
    assert.equal(await errorCode(r.run()), expected);
    assert.equal(r.state()?.request_key, requestKey);
    assert.equal(r.seen.length, 1);
  }
  const expired = rig([session('expired')], { request_key: requestKey, session_id: id });
  assert.equal(await errorCode(expired.run()), 'onboarding_expired');
  assert.equal(expired.seen.length, 1);
});

test('restart refuses live sessions and only replaces a terminal session on explicit request', async () => {
  const active = rig([session('ready')], { request_key: requestKey, session_id: id });
  assert.equal(await errorCode(active.run({ restart: true })), 'onboarding_active');
  assert.equal(active.seen.length, 1);
  const ended = rig([session('expired'), session('ready')], { request_key: requestKey, session_id: id });
  assert.equal(await ended.run({ restart: true, skipDemo: true }), 0);
  assert.deepEqual(ended.seen.map(x => x.init.method), ['GET', 'POST']);
});

test('resume files are owner-only, scope-separated and contain only stable IDs', () => {
  const home = mkdtempSync(join(tmpdir(), 'chert-onboard-'));
  try {
    const store = onboardingStore(home, origin, project);
    const created = store.create();
    assert.deepEqual(store.create(), created, 'concurrent/repeated starts share the saved key');
    store.save({ ...created, session_id: id });
    assert.equal(store.load()?.session_id, id);
    assert.equal(onboardingStore(home, 'https://other.example', project).load(), undefined);
    assert.equal(onboardingStore(home, origin, line).load(), undefined);
    const file = join(home, 'onboarding', readdirSync(join(home, 'onboarding'))[0]!);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort(), ['request_key', 'session_id']);
    chmodSync(file, 0o644);
    assert.throws(() => store.load(), /onboarding_state_unreadable/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('busy, unresolved cleanup and unavailable outbound preserve the same demo intent without queue promises', async () => {
  for (const code of ['line_busy', 'outbound_unavailable', 'shared_line_busy', 'shared_cleanup_pending', 'outbound_audio_unsupported', 'outbound_video_unsupported', 'outbound_disabled', 'shared_line_incompatible']) {
    const r = rig([session('ready'), { status: 409, error: code }, session('ready'), session('demo_running', { demo_call_id: call })], { request_key: requestKey, session_id: id });
    assert.equal(await errorCode(r.run()), code);
    assert.deepEqual(r.state(), { request_key: requestKey, session_id: id });
    assert.equal(await r.run(), 0);
    const demos = r.seen.filter(x => x.url.endsWith('/demo'));
    assert.equal(demos.length, 2);
    assert.ok(demos.every(x => new Headers(x.init.headers).get('idempotency-key') === requestKey));
    assert.equal(r.records.at(-1)?.demo_requested, true);
  }
});


test('expired trial recovery links to authenticated project billing without discarding the saved session', async () => {
  for (const code of ['shared_trial_exhausted', 'shared_entitlement_expired', 'credit_exhausted']) {
    const r = rig([{ status: 402, error: code }], { request_key: requestKey, session_id: id });
    await assert.rejects(r.run(), (error: unknown) => {
      assert.ok(error instanceof CLIError);
      assert.equal(error.code, code);
      assert.ok(error.action.includes(`${origin}/billing?project=${project}`));
      assert.ok(!error.action.includes(token));
      return true;
    });
    assert.deepEqual(r.state(), { request_key: requestKey, session_id: id });
  }
});
