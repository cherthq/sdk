import test from 'node:test';
import assert from 'node:assert/strict';
import { liveKitAPI } from '../../src/adapters/livekit.js';

test('pinned SDK accepts fractional remaining budget without a pre-network timeout error', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify({ id: 'dispatch', room: 'room', agentName: 'test' }), { status: 200 }); });
  const api = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters');
  await api.dispatch('room', 'test', 'test', '{}', 3588.123);
  assert.equal(requests, 1);
});

test('subsecond budget fails before any SDK request rather than extending deadline', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error(); });
  const api = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters');
  assert.throws(() => api.dispatch('room', 'test', 'test', '{}', 999.99), /deadline_exceeded/);
  assert.equal(requests, 0);
});

// Invoke the pinned SDK directly to reproduce the pre-fix adapter's path.
// Every fetch is replaced, so these probes cannot contact LiveKit.
import { AgentDispatchClient } from 'livekit-server-sdk';
import { Budget } from '../../src/runtime/deadline.js';

test('original fractional timeout throws before fetch; integer budget reaches fetch', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ id: 'dispatch', room: 'room', agentName: 'test' }), { status: 200 });
  });
  const client = (ms: number) => new AgentDispatchClient('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters', { failover: false, requestTimeout: ms / 1000 });
  await assert.rejects(client(3588.123).createDispatch('room', 'test'), { name: 'RangeError', code: 'ERR_OUT_OF_RANGE' });
  assert.equal(calls, 0);
  await client(3588).createDispatch('room', 'test'); assert.equal(calls, 1);
});

test('same rounded elapsed time can leave integer or fractional original Budget values', () => {
  let mono = 0, wall = 10000;
  const clock = { mono: () => mono, wall: () => wall };
  const budget = new Budget(clock, { created_at: wall, sent_at: wall, deadline_at: wall+5000, prepare_deadline_at: wall+4000, remaining_ms: 5000 });
  wall += 411; mono = 410.9;
  const integer = budget.remaining(true);
  mono = 411.1; const fractional = budget.remaining(true);
  assert.equal(Math.round(410.9), Math.round(411.1));
  assert.equal(integer, 3589); assert.equal(Number.isInteger(fractional), false);
});

test('integer original timeout can be followed by service rejection or lost response', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ code: 'invalid_argument', msg: 'SENSITIVE_MESSAGE_SENTINEL' }), { status: 400, headers: { 'content-type': 'application/json' } });
  });
  const client = new AgentDispatchClient('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters', { failover: false, requestTimeout: 3 });
  await assert.rejects(client.createDispatch('room', 'test'), { code: 'invalid_argument' }); assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('SENSITIVE_NETWORK_SENTINEL'); });
  await assert.rejects(client.createDispatch('room', 'test'), TypeError); assert.equal(calls, 2);
});

test('runtime/config validation and timeout conversion precede SDK effects', async t => {
  const { assertSupportedRuntime, sdkTimeoutSeconds } = await import('../../src/adapters/livekit-operation.js');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error(); });
  for (const version of ['20.19.6', '25.0.0', '22.0.0']) assert.throws(() => assertSupportedRuntime(version), /unsupported_test_runtime/);
  for (const version of ['22.12.0', '22.23.2', '22.23.3', '24.0.0', '24.14.0', '24.21.0', '26.0.0', '26.11.0']) assert.doesNotThrow(() => assertSupportedRuntime(version));
  for (const url of ['bad', 'http://example.invalid', 'https://user:secret@example.invalid', 'https://example.invalid/?secret=value']) {
    assert.throws(() => liveKitAPI(url, 'key', 'secret'), /invalid_config/);
  }
  for (const ms of [1000, 1000.001, 1999.99, 3588.123, 4000]) assert.ok(sdkTimeoutSeconds(ms) * 1000 <= ms);
  for (const ms of [0, 999.99, NaN, Infinity, -1]) assert.throws(() => sdkTimeoutSeconds(ms), /deadline_exceeded/);
  assert.equal(calls, 0);
});

test('pre-send proof binds operation, room and exact input; error codes alone confer nothing', async () => {
  const { validateBeforeSDK, preSendProof } = await import('../../src/adapters/livekit-operation.js');
  let failure: unknown;
  try { validateBeforeSDK('dispatch', 'room', 500); } catch (error) { failure = error; }
  assert.deepEqual(preSendProof(failure, 'dispatch', 'room', 500), { reason: 'timeout' });
  assert.equal(preSendProof(failure, 'room', 'room', 500), undefined);
  assert.equal(preSendProof(failure, 'dispatch', 'other-room', 500), undefined);
  assert.equal(preSendProof(failure, 'dispatch', 'room', 501), undefined);
  assert.equal(preSendProof(Object.assign(new Error('deadline_exceeded'), { code: 'deadline_exceeded' }), 'dispatch', 'room', 500), undefined);
});

test('CreateRoom explicitly configures the only intended dispatch, including deployment and no restart', async t => {
  let body: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ name: 'room', sid: 'sid', metadata: '{}' }), { status: 200 });
  });
  const api = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters');
  await Reflect.apply(api.create, api, ['room', '{}', 3500, { name: 'intended', deployment: 'isolated', metadata: 'signed-spec' }]);
  assert.deepEqual(body?.agents, [{ agentName: 'intended', deployment: 'isolated', metadata: 'signed-spec', restartPolicy: 'JRP_NEVER' }]);
});
