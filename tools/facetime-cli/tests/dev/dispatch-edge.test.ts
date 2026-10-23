import test from 'node:test';
import assert from 'node:assert/strict';
import { devHandler, roomName, type DispatchAPI, type DevEvent } from '../../src/dev/dispatch-handler.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

const base = { livekitUrl: 'wss://agent-project.livekit.cloud', apiKey: 'APIdevkey000001', apiSecret: 'dev-secret-that-must-stay-on-this-machine-0123456789', agentName: 'support', pollMs: 5 };
const signal = () => new AbortController().signal;
let sequence = 0;
function call(overrides: Partial<ApplicationCall> = {}): ApplicationCall {
  const now = Date.now(); const n = ++sequence;
  return { operation_id: `operation_${n}`, project_id: 'project', line_id: 'line', call_id: `call_${n}`, request_id: `request_${n}`,
    deadline_at: now + 5_000, prepare_deadline_at: now + 4_000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: false }, ...overrides };
}
// Scriptable LiveKit: participants per room are set by the test.
function liveKit() {
  const rooms = new Map<string, { identity: string; kind: 'agent' | 'standard' }[]>();
  const created: string[] = []; const deleted: string[] = [];
  let join: ((room: string) => { identity: string; kind: 'agent' | 'standard' }[]) | undefined = () => [{ identity: 'agent-AJ_1', kind: 'agent' }];
  const fail = { create: false, list: false, remove: false };
  const api: DispatchAPI = {
    async createRoom(name) { if (fail.create) throw new Error('create failed'); created.push(name); rooms.set(name, join ? join(name) : []); return { name, sid: `RM_${name}` }; },
    async listParticipants(room) { if (fail.list) throw new Error('list failed'); return rooms.get(room) ?? []; },
    async deleteRoom(room) { if (fail.remove) throw new Error('delete failed'); deleted.push(room); rooms.delete(room); },
  };
  return { api, rooms, created, deleted, fail, set join(value: typeof join) { join = value; } };
}
const context = (session_ref?: string) => ({ ...(session_ref ? { session_ref } : {}), authoritative_terminal: true, acceptance: 'accept' as const, cancel_requested: false });

test('edge: only an agent participant counts; a standard participant in the room does not trigger accept', async () => {
  const lk = liveKit(); lk.join = () => [{ identity: 'someone-else', kind: 'standard' }];
  const decision = await devHandler({ ...base, api: lk.api }).prepare(call(), { signal: signal(), remaining_ms: 150 });
  assert.deepEqual(decision, { action: 'decline' });
});

test('edge: with a standard participant and an agent present, the agent identity is the one returned', async () => {
  const lk = liveKit(); lk.join = () => [{ identity: 'observer', kind: 'standard' }, { identity: 'agent-AJ_real', kind: 'agent' }];
  const decision = await devHandler({ ...base, api: lk.api }).prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action === 'accept' && decision.remote_participant_identity, 'agent-AJ_real');
});

test('edge: a call whose limit has already passed is declined and its room removed', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const decision = await handler.prepare(call({ maximum_session_expires_at: Date.now() - 1 }), { signal: signal(), remaining_ms: 2_000 });
  assert.deepEqual(decision, { action: 'decline' });
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('edge: a signal already aborted declines without leaving a room', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await handler.prepare(call(), { signal: controller.signal, remaining_ms: 2_000 }), { action: 'decline' });
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('edge: LiveKit failing while waiting for the agent declines and still removes the room', async () => {
  const lk = liveKit(); lk.join = undefined; const handler = devHandler({ ...base, api: lk.api });
  const pending = handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  lk.fail.list = true;
  assert.deepEqual(await pending, { action: 'decline' });
  await handler.close();
  assert.equal(lk.deleted.length, 1);
});

test('edge: zero remaining time declines immediately', async () => {
  const lk = liveKit(); lk.join = undefined;
  const started = performance.now();
  assert.deepEqual(await devHandler({ ...base, api: lk.api }).prepare(call(), { signal: signal(), remaining_ms: 0 }), { action: 'decline' });
  assert.ok(performance.now() - started < 100);
});

test('edge: a throwing log callback never changes the decision', async () => {
  const lk = liveKit();
  const decision = await devHandler({ ...base, api: lk.api, log: () => { throw new Error('logger broke'); } }).prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action, 'accept');
});

test('edge: events report each call once in order with its reason', async () => {
  const lk = liveKit(); const events: DevEvent[] = [];
  const handler = devHandler({ ...base, api: lk.api, log: event => events.push(event) });
  const first = call(); const accepted = await handler.prepare(first, { signal: signal(), remaining_ms: 2_000 });
  if (accepted.action !== 'accept') return assert.fail('expected accept');
  await handler.lifecycle!(first, { event_id: 'e1', transition: 'started' }, context(accepted.session_ref));
  await handler.lifecycle!(first, { event_id: 'e2', transition: 'ended' }, context(accepted.session_ref));
  lk.join = undefined;
  const second = call(); await handler.prepare(second, { signal: signal(), remaining_ms: 100 });
  assert.deepEqual(events.map(e => [e.call_id, e.event, e.reason]), [
    [first.call_id, 'incoming', undefined], [first.call_id, 'accepted', undefined], [first.call_id, 'ended', undefined],
    [second.call_id, 'incoming', undefined], [second.call_id, 'declined', 'agent_did_not_join']]);
});

test('edge: started does not remove the room; ended twice is harmless and still acknowledged', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const incoming = call(); const decision = await handler.prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  await handler.lifecycle!(incoming, { event_id: 'e1', transition: 'started' }, context(decision.session_ref));
  assert.equal(lk.rooms.size, 1);
  for (const id of ['e2', 'e3']) assert.deepEqual(await handler.lifecycle!(incoming, { event_id: id, transition: 'ended' }, context(decision.session_ref)), { acknowledged: true });
  assert.equal(lk.rooms.size, 0);
});

for (const transition of ['failed', 'cancelled', 'reconciled_terminal'] as const) {
  test(`edge: ${transition} removes the room`, async () => {
    const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
    const incoming = call(); const decision = await handler.prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
    if (decision.action !== 'accept') return assert.fail('expected accept');
    await handler.lifecycle!(incoming, { event_id: 'e', transition }, context(decision.session_ref));
    assert.equal(lk.rooms.size, 0);
  });
}

test('edge: recovery reports unknown, not clean, when the room cannot be removed', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const incoming = call(); const decision = await handler.prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  lk.fail.remove = true;
  assert.deepEqual(await handler.recover!(incoming, context(decision.session_ref)), { settled: true, cleanup: 'unknown', session_ref: decision.session_ref });
});

test('edge: recovery without a session reference removes the room derived from the operation', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const incoming = call(); await handler.prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
  const result = await handler.recover!(incoming, { authoritative_terminal: true, acceptance: 'unknown', cancel_requested: false });
  assert.equal(result.session_ref, roomName(incoming)); assert.equal(result.cleanup, 'clean'); assert.equal(lk.rooms.size, 0);
});

test('edge: room names and bridge identities stay within LiveKit and connector limits for long identifiers', async () => {
  const lk = liveKit(); const long = 'x'.repeat(100);
  const incoming = call({ operation_id: long, call_id: long });
  assert.ok(roomName(incoming).length <= 100);
  const decision = await devHandler({ ...base, api: lk.api }).prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  assert.match(decision.session_ref, /^[A-Za-z0-9_-]{1,100}$/);
  const claims = JSON.parse(Buffer.from(decision.participant_token.split('.')[1]!, 'base64url').toString());
  assert.ok(Buffer.byteLength(claims.sub) <= 240);
});

test('edge: two calls at once get two different rooms and two tokens scoped to their own room', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  const [a, b] = await Promise.all([handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 }), handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 })]);
  if (a.action !== 'accept' || b.action !== 'accept') return assert.fail('expected accept');
  assert.notEqual(a.session_ref, b.session_ref);
  const room = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).video.room;
  assert.equal(room(a.participant_token), a.session_ref); assert.equal(room(b.participant_token), b.session_ref);
});

// Pre-warm
test('prewarm edge: without prewarm, warm() and close() do nothing and create no room', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  await handler.warm(); await handler.close();
  assert.equal(lk.created.length, 0);
});

test('prewarm edge: concurrent warm() calls prepare exactly one room', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await Promise.all([handler.warm(), handler.warm(), handler.warm()]);
  assert.equal(lk.created.length, 1);
  await handler.warm();
  assert.equal(lk.created.length, 1, 'a ready warm room is not replaced');
  await handler.close();
});

test('prewarm edge: when the agent never joins, warming gives up, removes its room and health stays unknown', async () => {
  const lk = liveKit(); lk.join = undefined;
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmTimeoutMs: 60 });
  await handler.warm();
  assert.equal(await handler.health!(), 'unknown');
  assert.equal(lk.rooms.size, 0); assert.equal(lk.deleted.length, 1);
  await handler.close();
});

test('prewarm edge: LiveKit failing during warming leaves nothing behind and calls still use the cold path', async () => {
  const lk = liveKit(); lk.fail.create = true;
  const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm();
  assert.equal(await handler.health!(), 'unknown');
  lk.fail.create = false;
  const decision = await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action, 'accept');
  await handler.warm(); await handler.close();
  assert.equal(lk.rooms.size, 1, 'only the accepted call room remains');
});

test('prewarm edge: a call that arrives while the warm room is still being prepared uses its own room', async () => {
  const lk = liveKit(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const create = lk.api.createRoom.bind(lk.api); let first = true;
  lk.api.createRoom = async (name, options) => { if (first) { first = false; await gate; } return create(name, options); };
  const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  const warming = handler.warm();
  const incoming = call(); const decision = await handler.prepare(incoming, { signal: signal(), remaining_ms: 2_000 });
  if (decision.action !== 'accept') return assert.fail('expected accept');
  assert.equal(decision.session_ref, roomName(incoming));
  release(); await warming;
  assert.equal(await handler.health!(), 'available');
  await handler.close();
});

test('prewarm edge: close while warming removes the room that was being prepared', async () => {
  const lk = liveKit(); lk.join = undefined;
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmTimeoutMs: 5_000 });
  const warming = handler.warm();
  await new Promise(resolve => setTimeout(resolve, 20));
  await handler.close(); await warming;
  assert.equal(lk.rooms.size, 0);
  await handler.warm();
  assert.equal(lk.created.length, 1, 'nothing is prepared after close');
});

test('prewarm edge: a warm room older than the limit is replaced before it is used', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30 });
  await handler.warm(); const [old] = lk.created;
  await new Promise(resolve => setTimeout(resolve, 50));
  await handler.warm();
  assert.equal(lk.rooms.has(old!), false); assert.equal(lk.created.length, 2);
  assert.equal(await handler.health!(), 'available');
  await handler.close();
});

test('prewarm edge: the warm room identity is re-read at call time, so a restarted agent is bound correctly', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm(); const [warm] = lk.created;
  lk.rooms.set(warm!, [{ identity: 'agent-AJ_restarted', kind: 'agent' }]);
  const decision = await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action === 'accept' && decision.remote_participant_identity, 'agent-AJ_restarted');
  await handler.warm(); await handler.close();
});

test('prewarm edge: an aborted call does not consume or leak the warm room', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm();
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await handler.prepare(call(), { signal: controller.signal, remaining_ms: 2_000 }), { action: 'decline' });
  await handler.warm(); await handler.close();
  assert.equal(lk.rooms.size, 0);
});

// refresh(): what the periodic keeper calls
test('refresh: a warm room whose agent left is dropped and replaced, and health never stays falsely available', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  assert.equal(await handler.refresh(), 'warm');
  const [first] = lk.created;
  lk.rooms.set(first!, []);
  assert.equal(await handler.refresh(), 'warm');
  assert.equal(lk.created.length, 2);
  await handler.close();
  assert.equal(lk.rooms.size, 0, 'the abandoned room and the new warm room are both removed');
});

test('refresh: reports cold when the agent is not running, and warm once it is', async () => {
  const lk = liveKit(); lk.join = undefined;
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmTimeoutMs: 40 });
  assert.equal(await handler.refresh(), 'cold');
  assert.equal(await handler.health!(), 'unknown');
  lk.join = () => [{ identity: 'agent-AJ_2', kind: 'agent' }];
  assert.equal(await handler.refresh(), 'warm');
  await handler.close();
});

test('refresh: without prewarm it is cold and creates nothing', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api });
  assert.equal(await handler.refresh(), 'cold'); assert.equal(lk.created.length, 0);
});

test('refresh: a LiveKit error while checking keeps the warm room rather than discarding a good one', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.refresh(); lk.fail.list = true;
  assert.equal(await handler.refresh(), 'warm');
  assert.equal(lk.created.length, 1);
  lk.fail.list = false; await handler.close();
});

test('prewarm edge: a warm call whose limit already passed is declined, the warm room removed, and a new one prepared', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm(); const [first] = lk.created;
  assert.deepEqual(await handler.prepare(call({ maximum_session_expires_at: Date.now() - 1 }), { signal: signal(), remaining_ms: 2_000 }), { action: 'decline' });
  await handler.warm();
  assert.equal(lk.rooms.has(first!), false);
  assert.equal(await handler.health!(), 'available');
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('prewarm edge: the warm room is created to outlive its own maximum age, so LiveKit does not close it first', async () => {
  const lk = liveKit(); const seen: { name: string; emptyTimeout: number }[] = [];
  const create = lk.api.createRoom.bind(lk.api);
  lk.api.createRoom = async (name, options) => { seen.push({ name, emptyTimeout: options.emptyTimeout }); return create(name, options); };
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 300_000 });
  await handler.warm();
  assert.ok(seen[0]!.emptyTimeout >= 300 + 60, `warm room empty timeout ${seen[0]!.emptyTimeout}s must exceed its 300 s maximum age`);
  const decision = await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action, 'accept');
  await handler.warm(); await handler.close();
});

test('edge: the incoming event reports how much time the call left for preparation', async () => {
  const lk = liveKit(); const events: DevEvent[] = [];
  await devHandler({ ...base, api: lk.api, log: event => events.push(event) }).prepare(call(), { signal: signal(), remaining_ms: 3_210 });
  assert.equal(events[0]!.event, 'incoming'); assert.equal(events[0]!.remaining_ms, 3_210);
});

// Replacement of an aged warm room: the old room keeps serving until the new one is ready.
test('prewarm edge: an aged warm room is replaced before it is removed, so a call during replacement is still warm', async () => {
  const lk = liveKit(); const events: DevEvent[] = [];
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30, log: event => events.push(event) });
  await handler.warm(); const [old] = lk.created;
  await new Promise(resolve => setTimeout(resolve, 50));
  // The replacement's agent is slow to join: the old room must stay available meanwhile.
  lk.join = () => [];
  const replacing = handler.warm();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(lk.created.length, 2, 'a replacement room is being prepared');
  assert.equal(lk.rooms.has(old!), true, 'the old warm room is not removed before its replacement is ready');
  assert.equal(await handler.health!(), 'available');
  const decision = await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action === 'accept' && decision.session_ref, old, 'the call is answered from the old warm room');
  assert.equal(events.find(e => e.event === 'accepted')?.warm, true);
  const [, replacement] = lk.created;
  lk.rooms.set(replacement!, [{ identity: 'agent-AJ_new', kind: 'agent' }]);
  await replacing;
  assert.equal(await handler.health!(), 'available', 'the replacement is the new warm room');
  await handler.close();
  assert.equal(lk.rooms.has(old!), true, 'the room now carrying a call is left to the call lifecycle');
  assert.equal(lk.rooms.has(replacement!), false);
});

test('prewarm edge: when no call arrives during replacement, the old warm room is removed only after the new one is ready', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30 });
  await handler.warm(); const [old] = lk.created;
  await new Promise(resolve => setTimeout(resolve, 50));
  lk.join = () => [];
  const replacing = handler.warm();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(lk.rooms.has(old!), true);
  const [, replacement] = lk.created;
  lk.rooms.set(replacement!, [{ identity: 'agent-AJ_new', kind: 'agent' }]);
  await replacing;
  await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(lk.rooms.has(old!), false, 'the old room is removed once the replacement is ready');
  assert.equal(lk.rooms.has(replacement!), true);
  const decision = await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  assert.equal(decision.action === 'accept' && decision.session_ref, replacement);
  await handler.close();
});

test('prewarm edge: a warm room is never used once it is near the LiveKit empty-room closure', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30 });
  await handler.warm(); const [old] = lk.created;
  // Replacement never succeeds (LiveKit refuses every new room), so the old room ages past any usable bound.
  lk.fail.create = true;
  await new Promise(resolve => setTimeout(resolve, 50));
  await handler.warm().catch(() => {});
  lk.fail.create = false;
  // Simulate the old room reaching the age at which LiveKit closes an agent-only room (maxAge + 120 s).
  const decision = await (async () => {
    const original = Date.now; Date.now = () => original() + 30 + 120_000;
    try { return await handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 }); } finally { Date.now = original; }
  })();
  assert.notEqual(decision.action === 'accept' && decision.session_ref, old, 'a room this old is not trusted to stay open');
  await handler.close();
});

// A call cancelled while its warm room was being checked: the room is taken, then has to go somewhere.
// Holds the participant check of one room open, as a slow LiveKit would.
function hold(lk: ReturnType<typeof liveKit>, held: string) {
  const list = lk.api.listParticipants.bind(lk.api); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  lk.api.listParticipants = async room => { if (room === held) await gate; return list(room); };
  return release;
}

test('prewarm edge: an aged warm room taken by a cancelled call is removed when its replacement became ready meanwhile', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30 });
  await handler.warm(); const [old] = lk.created;
  await new Promise(resolve => setTimeout(resolve, 50));
  lk.join = () => [];
  const replacing = handler.warm();
  await new Promise(resolve => setTimeout(resolve, 20));
  const [, replacement] = lk.created;
  const release = hold(lk, old!); const controller = new AbortController();
  const pending = handler.prepare(call(), { signal: controller.signal, remaining_ms: 2_000 });
  // The replacement's agent joins while the old room's check is still in flight, then the caller hangs up.
  lk.rooms.set(replacement!, [{ identity: 'agent-AJ_new', kind: 'agent' }]);
  await replacing;
  controller.abort(); release();
  assert.deepEqual(await pending, { action: 'decline' });
  assert.equal(lk.rooms.has(old!), false, 'the taken room is not left open with the agent inside');
  assert.equal(lk.rooms.has(replacement!), true); assert.equal(await handler.health!(), 'available');
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('prewarm edge: a warm room handed back by a cancelled call keeps its real age, so it is still replaced on time', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30 });
  await handler.warm(); const [old] = lk.created;
  await new Promise(resolve => setTimeout(resolve, 50));
  const release = hold(lk, old!); const controller = new AbortController();
  const pending = handler.prepare(call(), { signal: controller.signal, remaining_ms: 2_000 });
  controller.abort(); release();
  assert.deepEqual(await pending, { action: 'decline' });
  assert.equal(lk.rooms.has(old!), true, 'with no replacement ready the same room serves the next call');
  assert.equal(await handler.health!(), 'available');
  await handler.warm();
  assert.equal(lk.created.length, 2, 'the room is as old as it was, so it is due for replacement');
  assert.equal(lk.rooms.has(old!), false);
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('prewarm edge: a warm room handed back after close is removed, not kept', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm(); const [warm] = lk.created;
  const release = hold(lk, warm!); const controller = new AbortController();
  const pending = handler.prepare(call(), { signal: controller.signal, remaining_ms: 2_000 });
  controller.abort(); await handler.close();
  release();
  assert.deepEqual(await pending, { action: 'decline' });
  assert.equal(lk.rooms.size, 0, 'nothing is left for LiveKit to time out');
});

// The usable bound applies wherever the warm room is offered, not only when a call takes it.
async function later<T>(ms: number, run: () => Promise<T>): Promise<T> {
  const original = Date.now; Date.now = () => original() + ms;
  try { return await run(); } finally { Date.now = original; }
}

test('refresh: a warm room past its usable age is reported cold even while the agent is still inside', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30, warmTimeoutMs: 40 });
  await handler.warm(); const [old] = lk.created;
  // The agent stays in the old room and joins no other, so every replacement fails.
  lk.join = () => [];
  await later(30_000, async () => {
    assert.equal(await handler.refresh(), 'warm', 'an aged room inside its usable bound keeps serving');
    assert.equal(await handler.health!(), 'available');
  });
  await later(30 + 60_000 + 1, async () => {
    assert.equal(await handler.health!(), 'unknown');
    assert.equal(await handler.refresh(), 'cold');
    assert.equal(await handler.health!(), 'unknown');
  });
  assert.equal(lk.rooms.has(old!), false, 'a room no call may use is removed, not left open');
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('refresh: once the aged room is given up, an agent that takes one job at a time joins the replacement and the next call is warm', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30, warmTimeoutMs: 40 });
  // One job at a time: the agent joins a room only while it is in no other.
  lk.join = () => [...lk.rooms.values()].some(participants => participants.length) ? [] : [{ identity: 'agent-AJ_1', kind: 'agent' }];
  await handler.warm(); const [old] = lk.created;
  const decision = await later(30 + 60_000 + 1, async () => {
    assert.equal(await handler.refresh(), 'warm');
    assert.equal(await handler.health!(), 'available');
    return handler.prepare(call(), { signal: signal(), remaining_ms: 2_000 });
  });
  assert.equal(lk.rooms.has(old!), false);
  assert.ok(decision.action === 'accept' && decision.session_ref !== old && /^chert-warm-/.test(decision.session_ref), `answered from ${decision.action === 'accept' ? decision.session_ref : 'nothing'}, not the new warm room`);
  await handler.close();
});

test('refresh: a warm room that passes its usable age while its replacement is being tried is reported cold', async () => {
  const lk = liveKit(); const handler = devHandler({ ...base, api: lk.api, prewarm: true, warmMaxAgeMs: 30, warmTimeoutMs: 40 });
  await handler.warm();
  lk.join = () => [];
  // The clock crosses the bound when the replacement room is created, after the old room's own check.
  const original = Date.now; let shift = 30_000; Date.now = () => original() + shift;
  const create = lk.api.createRoom.bind(lk.api);
  lk.api.createRoom = async (name, options) => { shift = 30 + 60_000 + 1; return create(name, options); };
  try { assert.equal(await handler.refresh(), 'cold'); assert.equal(await handler.health!(), 'unknown'); }
  finally { Date.now = original; }
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});
