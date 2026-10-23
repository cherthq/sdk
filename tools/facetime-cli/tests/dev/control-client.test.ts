import test from 'node:test';
import assert from 'node:assert/strict';
import { controlClient } from '../../src/dev/claim.js';
import { CLIError } from '../../src/cli/errors.js';

const TOKEN = 'eyJ.session.TOKEN_SENTINEL';
const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
const W = '66666666-6666-4666-8666-666666666666', W2 = '77777777-7777-4777-8777-777777777777';
const scope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' };
type Seen = { url: string; method: string; headers: Record<string, string>; body?: unknown; redirect?: string };
async function withFetch<T>(respond: (seen: Seen) => Response | Promise<Response>, run: (seen: Seen[]) => Promise<T>): Promise<T> {
  const previous = globalThis.fetch; const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const record: Seen = { url: String(input), method: init?.method ?? 'GET', headers: Object.fromEntries(Object.entries(init?.headers ?? {})), redirect: init?.redirect,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) };
    seen.push(record); return respond(record);
  }) as typeof fetch;
  try { return await run(seen); } finally { globalThis.fetch = previous; }
}
const ok = (data: unknown) => Response.json({ data });
async function failure(promise: Promise<unknown>): Promise<CLIError> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error; }
  return assert.fail('expected a CLIError');
}

test('control: requests carry the bearer token, never follow redirects, and add the project header only when scoped', async () => {
  await withFetch(seen => ok(seen.url.endsWith('/api/v1/projects') ? [] : { items: [] }), async seen => {
    const control = controlClient('https://control.example', TOKEN);
    await control.projects(); await control.lines(P);
    assert.equal(seen[0]!.url, 'https://control.example/api/v1/projects');
    assert.equal(seen[0]!.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(seen[0]!.headers['x-chert-project-id'], undefined);
    assert.equal(seen[1]!.headers['x-chert-project-id'], P);
    assert.ok(seen.every(s => s.redirect === 'error'));
  });
});

test('control: projects and lines are mapped from the control plane shapes', async () => {
  await withFetch(seen => ok(seen.url.includes('/projects')
    ? [{ role: 'owner', facetime_projects: { id: P, slug: 'team', name: 'Team', created_at: 'x' } }]
    : { items: [{ id: L, line_key: 'k', display_name: 'Dev line', masked_identity: 'd***', status: 'available', worker_id: 'w', current_call_id: null,
        default_assistant_id: null, inbound_policy: 'customer_decides', integration_id: 'i', assignment_generation: 4, supports_audio: true }], total: 1 }), async () => {
    const control = controlClient('https://control.example', TOKEN);
    assert.deepEqual(await control.projects(), [{ id: P, name: 'Team', role: 'owner' }]);
    const [line] = await control.lines(P);
    assert.equal(line!.assignment_generation, 4); assert.equal(line!.inbound_policy, 'customer_decides');
  });
});

test('control: workers are read for the project and mapped from the control plane shape', async () => {
  // PostgREST timestamps carry microseconds and an offset; a worker that never checked in has none.
  const at = '2026-10-07T12:34:56.789123+00:00';
  await withFetch(() => ok({ items: [
    { id: W, worker_key: 'k', display_name: 'Mac', status: 'accepting', enabled: true, automatic_readiness_enabled: true, last_heartbeat_at: at, readiness: 'ready', current_call_id: null, occupied: false },
    { id: W2, worker_key: 'k2', display_name: 'Spare', status: 'offline', enabled: false, automatic_readiness_enabled: false, last_heartbeat_at: null, readiness: 'not_ready', current_call_id: null, occupied: false },
  ], total: 2, limit: 100, offset: 0 }), async seen => {
    assert.deepEqual(await controlClient('https://control.example', TOKEN).workers!(P), [
      { id: W, status: 'accepting', enabled: true, last_heartbeat_at: at }, { id: W2, status: 'offline', enabled: false, last_heartbeat_at: null }]);
    assert.equal(seen.length, 1); assert.equal(seen[0]!.url, 'https://control.example/api/v1/workers?limit=100');
    assert.equal(seen[0]!.method, 'GET'); assert.equal(seen[0]!.headers['x-chert-project-id'], P);
  });
});

test('control: enroll asks for a production BYOR binding and returns its credentials; activate, drain and revoke send exact values', async () => {
  await withFetch(seen => ok((seen.body as { action?: string } | undefined)?.action === 'enroll'
    ? { scope, state: 'standby', credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } } : { scope, state: 'active' }), async seen => {
    const control = controlClient('https://control.example', TOKEN);
    const enrollment = await control.enroll(P, L, 'dev-agent');
    assert.equal(enrollment.scope.binding_id, B);
    await control.activate(P, B, null, 4); await control.drain(P, B); await control.revoke(P, B);
    assert.deepEqual(seen.map(s => s.body), [
      { action: 'enroll', line_id: L, name: 'dev-agent', environment: 'production', session_mode: 'byor' },
      { action: 'activate', binding_id: B, expected_binding_id: null, assignment_generation: 4 },
      { action: 'drain', binding_id: B }, { action: 'revoke', binding_id: B }]);
    assert.ok(seen.every(s => s.method === 'POST' && s.url === 'https://control.example/api/v1/connectors'));
  });
});

test('control: an expired session is reported as login_required', async () => {
  await withFetch(() => new Response('{"error":"unauthorized"}', { status: 401 }), async () => {
    const error = await failure(controlClient('https://control.example', TOKEN).projects());
    assert.equal(error.code, 'login_required'); assert.equal(error.exit, 3);
  });
});

for (const status of [403, 404, 409, 500]) {
  test(`control: HTTP ${status} is a rejected request without the response body or the token`, async () => {
    await withFetch(() => new Response(`SERVER_BODY_SENTINEL ${TOKEN}`, { status }), async () => {
      const error = await failure(controlClient('https://control.example', TOKEN).lines(P));
      assert.equal(error.code, status === 403 ? 'backend_request_forbidden' : status === 409 ? 'backend_request_conflict' : 'backend_request_rejected');
      assert.ok(!`${error.message} ${error.action}`.includes('SENTINEL'));
    });
  });
}

test('control: a network failure is reported as unreachable, without the token', async () => {
  await withFetch(() => { throw new TypeError(`fetch failed ${TOKEN}`); }, async () => {
    const error = await failure(controlClient('https://control.example', TOKEN).projects());
    assert.equal(error.code, 'backend_unreachable'); assert.equal(error.exit, 6);
    assert.ok(!`${error.message} ${error.action}`.includes('SENTINEL'));
  });
});

test('control: a malformed success body is a named error, not silently empty data', async () => {
  await withFetch(() => ok({ items: [{ id: 'not-a-uuid' }] }), async () => {
    assert.equal((await failure(controlClient('https://control.example', TOKEN).lines(P))).code, 'backend_response_invalid');
  });
  await withFetch(() => ok({ scope, state: 'active', credentials: { connection: 'x', recovery: 'y' } }), async () => {
    assert.equal((await failure(controlClient('https://control.example', TOKEN).enroll(P, L, 'dev-agent'))).code, 'backend_response_invalid');
  });
  await withFetch(() => new Response('<html>gateway</html>', { status: 200 }), async () => {
    assert.equal((await failure(controlClient('https://control.example', TOKEN).projects())).code, 'backend_response_invalid');
  });
  for (const body of [[{ id: W, status: 'accepting' }], { items: [{ id: W, enabled: true, last_heartbeat_at: null }] }, { items: [{ id: W, status: 'accepting', enabled: 'yes' }] }])
    await withFetch(() => ok(body), async () => {
      assert.equal((await failure(controlClient('https://control.example', TOKEN).workers!(P))).code, 'backend_response_invalid', JSON.stringify(body));
    });
});

test('control: only an encrypted origin without credentials or a path is accepted', () => {
  for (const origin of ['http://control.example', 'https://user:pass@control.example', 'https://control.example/path', 'not a url'])
    assert.throws(() => controlClient(origin, TOKEN), (error: unknown) => error instanceof CLIError && error.code === 'invalid_origin', origin);
});

test('control: Muse bridge readiness requires the same active call and worker bridge_ready, not started', async () => {
  let data: Record<string, unknown> = { id: B, project_id: P, line_id: L, status: 'active', facetime_call_events: [{ event_type: 'call.started', source: 'worker' }] };
  await withFetch(() => ok(data), async seen => {
    const control = controlClient('https://control.example', TOKEN);
    assert.equal(await control.callReadiness!(P, L, B), 'waiting');
    data.facetime_call_events = [{ event_type: 'bridge_ready', source: 'customer' }];
    assert.equal(await control.callReadiness!(P, L, B), 'waiting');
    data.facetime_call_events = [{ event_type: 'bridge_ready', source: 'worker' }];
    assert.equal(await control.callReadiness!(P, L, B), 'ready');
    data.status = 'ended';
    assert.equal(await control.callReadiness!(P, L, B), 'terminal');
    data = { ...data, id: L };
    await assert.rejects(control.callReadiness!(P, L, B), /backend_response_invalid/);
    assert.ok(seen.every(s => s.method === 'GET' && s.headers['x-chert-project-id'] === P && s.redirect === 'error'));
  });
});
