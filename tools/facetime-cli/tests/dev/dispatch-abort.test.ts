import test from 'node:test';
import assert from 'node:assert/strict';
import { devHandler, type DispatchAPI, type DevEvent } from '../../src/dev/dispatch-handler.js';
import type { ApplicationCall } from '../../src/byor/contract.js';
import { deferred } from '../fixtures/clock.js';

// A handler the connector has stopped (deadline, hang-up, lost connection) must not report the call as answered,
// and must not leave the call's room behind with the agent in it.

const base = { livekitUrl: 'wss://agent-project.livekit.cloud', apiKey: 'APIdevkey000001', apiSecret: 'dev-secret-that-must-stay-on-this-machine-0123456789', agentName: 'support', pollMs: 5 };
let sequence = 0;
function call(): ApplicationCall {
  const now = Date.now(); const n = ++sequence;
  return { operation_id: `operation_${n}`, project_id: 'project', line_id: 'line', call_id: `call_${n}`, request_id: `request_${n}`,
    deadline_at: now + 5_000, prepare_deadline_at: now + 4_000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: false } };
}
/** A signal that reads as not aborted for its first `reads` checks, then as aborted: places the stop between two steps exactly. */
function abortedAfter(reads: number): AbortSignal { let seen = 0; return { get aborted() { return ++seen > reads; } } as unknown as AbortSignal; }
function liveKit() {
  const rooms = new Set<string>(), created: string[] = [], deleted: string[] = [];
  const api: DispatchAPI = {
    async createRoom(name) { created.push(name); rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : []; },
    async deleteRoom(room) { deleted.push(room); rooms.delete(room); },
  };
  return { api, rooms, created, deleted };
}

test('abort: an agent read that returns after the stop does not answer the call, and the room is removed', async () => {
  const lk = liveKit(), events: DevEvent[] = [], reading = deferred<{ identity: string; kind: 'agent' }[]>(), asked = deferred();
  lk.api.listParticipants = async () => { asked.resolve(); return reading.promise; };
  const handler = devHandler({ ...base, api: lk.api, log: event => events.push(event) });
  const controller = new AbortController();
  const pending = handler.prepare(call(), { signal: controller.signal, remaining_ms: 4_000 });
  await asked.promise; controller.abort(); reading.resolve([{ identity: 'agent-AJ_1', kind: 'agent' }]);
  assert.deepEqual(await pending, { action: 'decline' });
  assert.deepEqual(events.map(e => [e.event, e.reason]), [['incoming', undefined], ['declined', 'cancelled']]);
  await handler.close();
  assert.deepEqual(lk.deleted, lk.created);
});

test('abort: a stop that lands while a cold answer is being made declines it and removes the room', async () => {
  const lk = liveKit(), events: DevEvent[] = [];
  const handler = devHandler({ ...base, api: lk.api, log: event => events.push(event) });
  // Checks: top of prepare, loop condition, after the agent read; the fourth (after the answer is made) sees the stop.
  assert.deepEqual(await handler.prepare(call(), { signal: abortedAfter(3), remaining_ms: 4_000 }), { action: 'decline' });
  assert.ok(!events.some(e => e.event === 'accepted'));
  assert.equal(events.at(-1)?.reason, 'cancelled');
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('abort: a stop that lands while a warm answer is being made keeps the warm room for the next call', async () => {
  const lk = liveKit(), events: DevEvent[] = [];
  const handler = devHandler({ ...base, api: lk.api, prewarm: true, log: event => events.push(event) });
  await handler.warm();
  assert.equal(lk.created.length, 1);
  // Checks: top of prepare, after the warm room was confirmed; the third (after the answer is made) sees the stop.
  assert.deepEqual(await handler.prepare(call(), { signal: abortedAfter(2), remaining_ms: 4_000 }), { action: 'decline' });
  assert.ok(!events.some(e => e.event === 'accepted'));
  // The next call is answered from the same warm room: nothing was created for it and nothing removed.
  const next = await handler.prepare(call(), { signal: new AbortController().signal, remaining_ms: 4_000 });
  assert.equal(next.action, 'accept');
  assert.equal(next.action === 'accept' && next.session_ref, lk.created[0]);
  assert.deepEqual(lk.deleted, []);
  await handler.close();
});

test('abort: a stop during a warm answer after close() removes the room instead of keeping it', async () => {
  const lk = liveKit();
  const handler = devHandler({ ...base, api: lk.api, prewarm: true });
  await handler.warm();
  let reads = 0;
  // close() runs between the warm room check and the stop: nobody else will remove the room.
  const signal = { get aborted() { reads++; if (reads === 3) void handler.close(); return reads > 2; } } as unknown as AbortSignal;
  assert.deepEqual(await handler.prepare(call(), { signal, remaining_ms: 4_000 }), { action: 'decline' });
  await handler.close();
  assert.equal(lk.rooms.size, 0);
});

test('abort: an answer made before any stop is still reported and returned', async () => {
  const lk = liveKit(), events: DevEvent[] = [];
  const handler = devHandler({ ...base, api: lk.api, log: event => events.push(event) });
  const decision = await handler.prepare(call(), { signal: new AbortController().signal, remaining_ms: 4_000 });
  assert.equal(decision.action, 'accept');
  assert.deepEqual(events.map(e => e.event), ['incoming', 'accepted']);
  await handler.close();
});
