import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVerifier } from 'livekit-server-sdk';
import { devHandler, type DispatchAPI } from '../../src/dev/dispatch-handler.js';
import { validateDecision } from '../../src/byor/handler.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

const url = 'wss://agent-project.livekit.cloud';
const apiKey = 'APIdevkey000001';
const apiSecret = 'dev-secret-that-must-stay-on-this-machine-0123456789';
const agentName = 'dental-receptionist';

function call(now: number, overrides: Partial<ApplicationCall> = {}): ApplicationCall {
  return { operation_id: 'operation_1', project_id: 'project', line_id: 'line', call_id: 'call_1', request_id: 'request_1',
    deadline_at: now + 10_000, prepare_deadline_at: now + 9_000, maximum_session_expires_at: now + 3 * 3600_000,
    media: { audio: true, video: true }, ...overrides };
}

// In-memory LiveKit project. The agent "joins" after joinAfterPolls participant polls.
function fakeLiveKit(options: { joinAfterPolls?: number; failCreate?: boolean; agentIdentity?: string } = {}) {
  const rooms = new Map<string, { metadata: string; maxParticipants: number; emptyTimeout: number; agentName: string; agentMetadata: string }>();
  const dispatches: { room: string; agentName: string }[] = [];
  const deleted: string[] = [];
  const sent: string[] = [];
  const gone = new Set<string>();
  let polls = 0;
  const api: DispatchAPI = {
    async createRoom(name, opts) {
      sent.push(JSON.stringify([name, opts]));
      if (options.failCreate) throw new Error('livekit unreachable');
      rooms.set(name, opts); dispatches.push({ room: name, agentName: opts.agentName }); return { name, sid: `RM_${name}` };
    },
    async listParticipants(room) {
      sent.push(room); polls++;
      const joined = options.joinAfterPolls !== undefined && polls > options.joinAfterPolls && rooms.has(room) && !gone.has(room);
      return joined ? [{ identity: options.agentIdentity ?? 'agent-AJ_job1', kind: 'agent' as const }] : [];
    },
    async deleteRoom(room) { sent.push(room); deleted.push(room); rooms.delete(room); },
  };
  return { api, rooms, dispatches, deleted, sent, gone };
}

function handlerFor(lk: ReturnType<typeof fakeLiveKit>) {
  return devHandler({ livekitUrl: url, apiKey, apiSecret, agentName, api: lk.api, pollMs: 5 });
}

test('dev: an incoming call creates one room, dispatches the named agent and accepts with a one-room token', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 2 });
  const now = Date.now();
  const decision = await handlerFor(lk).prepare(call(now), { signal: new AbortController().signal, remaining_ms: 9_000 });
  assert.equal(decision.action, 'accept');
  if (decision.action !== 'accept') return;
  assert.equal(lk.rooms.size, 1);
  const [room] = [...lk.rooms.keys()];
  assert.equal(lk.rooms.get(room!)!.maxParticipants, 2);
  assert.deepEqual(lk.dispatches, [{ room, agentName }]);
  assert.equal(decision.livekit_url, url);
  assert.equal(decision.remote_participant_identity, 'agent-AJ_job1');
  assert.equal(decision.session_ref, room);
  // The connector's own validator must accept the decision unchanged.
  assert.deepEqual(validateDecision(decision, Date.now(), call(now).maximum_session_expires_at), decision);
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(decision.participant_token);
  assert.equal(claims.video?.room, room);
  assert.equal(claims.video?.roomJoin, true);
  assert.notEqual(claims.sub, decision.remote_participant_identity);
});

test('dev: the token lasts at most two hours and never beyond the call limit', async () => {
  const now = Date.now();
  for (const maximum of [now + 3 * 3600_000, now + 600_000]) {
    const lk = fakeLiveKit({ joinAfterPolls: 0 });
    const decision = await handlerFor(lk).prepare(call(now, { maximum_session_expires_at: maximum }), { signal: new AbortController().signal, remaining_ms: 9_000 });
    assert.equal(decision.action, 'accept');
    if (decision.action !== 'accept') return;
    const claims = await new TokenVerifier(apiKey, apiSecret).verify(decision.participant_token);
    assert.ok(claims.exp! - claims.nbf! <= 7200);
    assert.ok(claims.exp! * 1000 <= maximum + 1000);
    assert.ok(decision.session_expires_at <= Math.min(maximum, claims.exp! * 1000));
  }
});

test('dev: the LiveKit API secret never appears in anything returned to Chert or sent to LiveKit', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = handlerFor(lk);
  const decision = await handler.prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 9_000 });
  const outbound = JSON.stringify(decision);
  assert.ok(!outbound.includes(apiSecret));
  assert.ok(!lk.sent.some(value => value.includes(apiSecret)));
  if (decision.action !== 'accept') return assert.fail('expected accept');
  const payload = JSON.parse(Buffer.from(decision.participant_token.split('.')[1]!, 'base64url').toString());
  assert.ok(!JSON.stringify(payload).includes(apiSecret));
  assert.notEqual(payload.video.roomAdmin, true);
  assert.notEqual(payload.video.roomCreate, true);
  assert.notEqual(payload.video.roomList, true);
});

test('dev: an agent that never joins is declined before the window ends, and its room is removed', async () => {
  const lk = fakeLiveKit();
  const started = performance.now();
  const decision = await handlerFor(lk).prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 300 });
  assert.deepEqual(decision, { action: 'decline' });
  assert.ok(performance.now() - started < 300, 'prepare must return inside remaining_ms');
  assert.equal(lk.rooms.size, 0);
  assert.equal(lk.deleted.length, 1);
});

test('dev: LiveKit unreachable declines without dispatching', async () => {
  const lk = fakeLiveKit({ failCreate: true });
  const decision = await handlerFor(lk).prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 9_000 });
  assert.deepEqual(decision, { action: 'decline' });
  assert.equal(lk.dispatches.length, 0);
});

test('dev: a cancelled call stops waiting and removes the room', async () => {
  const lk = fakeLiveKit();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const decision = await handlerFor(lk).prepare(call(Date.now()), { signal: controller.signal, remaining_ms: 9_000 });
  assert.deepEqual(decision, { action: 'decline' });
  assert.equal(lk.rooms.size, 0);
});

test('dev: the call ending removes the room; recovery reports clean once the room is gone', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = handlerFor(lk);
  const incoming = call(Date.now());
  const decision = await handler.prepare(incoming, { signal: new AbortController().signal, remaining_ms: 9_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  const context = { session_ref: decision.session_ref, authoritative_terminal: true, acceptance: 'accept' as const, cancel_requested: false };
  assert.deepEqual(await handler.lifecycle!(incoming, { event_id: 'event_1', transition: 'ended' }, context), { acknowledged: true });
  assert.equal(lk.rooms.size, 0);
  assert.deepEqual(await handler.recover!(incoming, context), { settled: true, cleanup: 'clean', session_ref: decision.session_ref });
});

test('dev: room names are derived from the operation, so a retried operation never creates a second room', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = handlerFor(lk);
  const first = await handler.prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 9_000 });
  const other = await handler.prepare(call(Date.now(), { operation_id: 'operation_2', call_id: 'call_2', request_id: 'request_2' }), { signal: new AbortController().signal, remaining_ms: 9_000 });
  if (first.action !== 'accept' || other.action !== 'accept') return assert.fail('expected accept');
  assert.notEqual(first.session_ref, other.session_ref);
  assert.match(first.session_ref, /operation_1/);
});

test('prewarm: a room with the agent already inside is accepted without any room creation during the call', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = devHandler({ livekitUrl: url, apiKey, apiSecret, agentName, api: lk.api, pollMs: 5, prewarm: true });
  await handler.warm();
  assert.equal(lk.rooms.size, 1);
  const [warm] = [...lk.rooms.keys()];
  const created = lk.dispatches.length;
  const now = Date.now();
  const decision = await handler.prepare(call(now), { signal: new AbortController().signal, remaining_ms: 4_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  assert.equal(decision.session_ref, warm);
  assert.equal(decision.remote_participant_identity, 'agent-AJ_job1');
  assert.deepEqual(validateDecision(decision, Date.now(), call(now).maximum_session_expires_at), decision);
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(decision.participant_token);
  assert.equal(claims.video?.room, warm);
  // The next room is prepared in the background, not inside the call.
  await handler.warm();
  assert.equal(lk.dispatches.length, created + 1);
  assert.equal(lk.rooms.size, 2);
  await handler.close();
});

test('prewarm: the call ending removes only that call\'s room; close removes the unused warm room', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = devHandler({ livekitUrl: url, apiKey, apiSecret, agentName, api: lk.api, pollMs: 5, prewarm: true });
  await handler.warm();
  const incoming = call(Date.now());
  const decision = await handler.prepare(incoming, { signal: new AbortController().signal, remaining_ms: 4_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  await handler.warm();
  const context = { session_ref: decision.session_ref, authoritative_terminal: true, acceptance: 'accept' as const, cancel_requested: false };
  await handler.lifecycle!(incoming, { event_id: 'event_1', transition: 'ended' }, context);
  assert.equal(lk.rooms.has(decision.session_ref), false);
  assert.equal(lk.rooms.size, 1);
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('prewarm: a warm room whose agent has left is replaced by the cold path', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = devHandler({ livekitUrl: url, apiKey, apiSecret, agentName, api: lk.api, pollMs: 5, prewarm: true });
  await handler.warm();
  const [warm] = [...lk.rooms.keys()];
  lk.gone.add(warm!);
  const decision = await handler.prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 4_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  assert.notEqual(decision.session_ref, warm);
  assert.equal(lk.rooms.has(warm!), false);
  await handler.close();
});

test('prewarm: health is available only while a warm room is ready', async () => {
  const lk = fakeLiveKit({ joinAfterPolls: 0 });
  const handler = devHandler({ livekitUrl: url, apiKey, apiSecret, agentName, api: lk.api, pollMs: 5, prewarm: true });
  assert.equal(await handler.health!(), 'unknown');
  await handler.warm();
  assert.equal(await handler.health!(), 'available');
  await handler.close();
});

test('dev: a decline is returned inside the window even when LiveKit is slow to delete the room', async () => {
  const lk = fakeLiveKit();
  const remove = lk.api.deleteRoom.bind(lk.api);
  lk.api.deleteRoom = async room => { await new Promise(resolve => setTimeout(resolve, 400)); await remove(room); };
  const handler = handlerFor(lk);
  const started = performance.now();
  const decision = await handler.prepare(call(Date.now()), { signal: new AbortController().signal, remaining_ms: 300 });
  assert.deepEqual(decision, { action: 'decline' });
  assert.ok(performance.now() - started < 300, 'decline must not wait for cleanup');
  await handler.close();
  assert.equal(lk.rooms.size, 0, 'cleanup still completes');
});
