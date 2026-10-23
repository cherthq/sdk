import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRIDGE_POLL_MS, BRIDGE_WAIT_MS, devHandler, type DevEvent, type DispatchAPI } from '../../src/dev/dispatch-handler.js';
import { runDev, type DevDeps, type DevInput } from '../../src/dev/command.js';
import type { Control, Line } from '../../src/dev/claim.js';
import { sessionLine } from '../../src/cli/present.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

// The Mac ends a call whose agent sends no audible audio within 10 s of bridge_ready (remote_audio_timeout), and only
// chert dev can read bridge_ready from Chert. So for each answered call it reads the call until the Mac reports it, then
// writes it into the room's metadata, where any agent can see it and greet.

type Readiness = 'waiting' | 'ready' | 'terminal';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const open = () => ({ signal: new AbortController().signal, remaining_ms: 9_000 });
const live = { authoritative_terminal: false, acceptance: 'accept' as const, cancel_requested: false };
let sequence = 0;
function call(overrides: Partial<ApplicationCall> = {}): ApplicationCall {
  const now = Date.now(), n = ++sequence;
  return { operation_id: `operation_${n}`, project_id: 'project', line_id: 'line', call_id: `call_${n}`, request_id: `request_${n}`,
    deadline_at: now + 10_000, prepare_deadline_at: now + 9_000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: false }, ...overrides };
}

/** A LiveKit project whose rooms keep their metadata, with the agent in every room at once, and a scriptable call API. */
function rig(options: { prewarm?: boolean; readiness?: (n: number) => Readiness; pollMs?: number; waitMs?: number; refuseWrites?: number; callApi?: boolean; metadataApi?: boolean } = {}) {
  const rooms = new Map<string, string>();
  const writes: { room: string; metadata: string }[] = [], reads: { call: string; at: number }[] = [], events: DevEvent[] = [];
  let refuse = options.refuseWrites ?? 0;
  const api: DispatchAPI = {
    async createRoom(name, created) { rooms.set(name, created.metadata); return { name, sid: `RM_${name}` }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_1', kind: 'agent' as const }] : []; },
    async deleteRoom(room) { rooms.delete(room); },
  };
  if (options.metadataApi !== false) api.updateMetadata = async (room, metadata) => {
    if (refuse > 0) { refuse--; throw new Error('LiveKit refused the update'); }
    writes.push({ room, metadata }); rooms.set(room, metadata);
  };
  const readCall = async (incoming: ApplicationCall): Promise<Readiness> => {
    reads.push({ call: incoming.call_id, at: performance.now() });
    return (options.readiness ?? (() => 'ready'))(reads.filter(read => read.call === incoming.call_id).length);
  };
  const handler = devHandler({ livekitUrl: 'wss://agent-project.livekit.cloud', apiKey: 'APIdevkey000001', apiSecret: 'dev-secret-that-must-stay-on-this-machine-0123456789',
    agentName: 'support', api, pollMs: 2, prewarm: options.prewarm ?? false, mediaCheckMs: 60_000, ...(options.callApi === false ? {} : { readCall }),
    bridgePollMs: options.pollMs ?? 10, bridgeWaitMs: options.waitMs ?? 2_000, log: event => { events.push(event); } });
  const until = async (found: () => boolean, what: string) => { const end = Date.now() + 3000; while (!found()) { if (Date.now() > end) throw new Error(`timeout: ${what}`); await sleep(2); } };
  const signals = () => events.filter(event => event.event === 'bridge_ready');
  return { handler, rooms, writes, reads, events, signals, until };
}
async function answer(r: ReturnType<typeof rig>, incoming: ApplicationCall) {
  const decision = await r.handler.prepare(incoming, open());
  if (decision.action !== 'accept') throw new Error('declined');
  return decision;
}

test('bridge ready: a generic dev session writes the signal into the call\'s room exactly once', async () => {
  const r = rig({ readiness: n => n < 3 ? 'waiting' : 'ready' });
  const incoming = call();
  const decision = await answer(r, incoming);
  await r.until(() => r.writes.length > 0, 'the signal');
  const readsWhenWritten = r.reads.length;
  await sleep(120);
  assert.equal(r.writes.length, 1, 'written once, however long the call lasts');
  assert.equal(r.reads.length, readsWhenWritten, 'and Chert is not read again after it');
  assert.equal(readsWhenWritten, 3, 'two reads said waiting, the third said ready');
  const [write] = r.writes;
  assert.equal(write!.room, decision.session_ref, 'into the room the Mac joined');
  const metadata = JSON.parse(write!.metadata) as Record<string, unknown>;
  assert.deepEqual(Object.keys(metadata), ['chert_call', 'chert_bridge_ready', 'at']);
  assert.equal(metadata.chert_call, incoming.call_id, 'the existing chert_call key is kept');
  assert.equal(metadata.chert_bridge_ready, true);
  assert.equal(new Date(String(metadata.at)).toISOString(), metadata.at, 'at is an ISO 8601 time');
  assert.ok(Math.abs(Date.parse(String(metadata.at)) - Date.now()) < 5_000);
  assert.equal(r.signals().length, 1);
  assert.equal(r.signals()[0]!.call_id, incoming.call_id);
  assert.equal(r.signals()[0]!.room_signal, true);
  assert.equal(typeof r.signals()[0]!.ms, 'number');
  await r.handler.close();
});

test('bridge ready: a warm job never gets the signal; a call answered in the warm room gets it once', async () => {
  const r = rig({ prewarm: true });
  await r.handler.warm();
  const [warmRoom] = [...r.rooms.keys()];
  await sleep(80);
  assert.equal(r.reads.length, 0, 'no call, no read of Chert');
  assert.equal(r.writes.length, 0, 'and nothing written into the waiting room');
  assert.equal(r.rooms.get(warmRoom!), JSON.stringify({ chert_warm: true }));
  const incoming = call();
  const decision = await answer(r, incoming);
  assert.equal(decision.session_ref, warmRoom, 'answered in the warm room');
  await r.until(() => r.writes.length > 0, 'the signal');
  await r.until(() => r.rooms.size === 2, 'the next waiting room');
  await sleep(80);
  assert.deepEqual(r.writes.map(write => write.room), [warmRoom], 'only the room of the answered call, never the next waiting room');
  assert.equal(JSON.parse(r.writes[0]!.metadata).chert_call, incoming.call_id);
  const next = [...r.rooms.keys()].find(room => room !== warmRoom)!;
  assert.equal(r.rooms.get(next), JSON.stringify({ chert_warm: true }));
  await r.handler.close();
});

test('bridge ready: each call gets its own signal in its own room', async () => {
  const r = rig();
  const first = call(), second = call();
  const a = await answer(r, first), b = await answer(r, second);
  await r.until(() => r.writes.length === 2, 'two signals');
  await sleep(60);
  assert.equal(r.writes.length, 2);
  assert.deepEqual(r.writes.map(write => [write.room, JSON.parse(write.metadata).chert_call]).sort(), [[a.session_ref, first.call_id], [b.session_ref, second.call_id]].sort());
  assert.deepEqual(r.signals().map(event => event.call_id).sort(), [first.call_id, second.call_id].sort());
  await r.handler.close();
});

test('bridge ready: the reads stop when the call ends, or when recovery ends it, and nothing is written', async () => {
  const r = rig({ readiness: () => 'waiting' });
  const ended = call();
  const decision = await answer(r, ended);
  await r.until(() => r.reads.length >= 2, 'reads');
  await r.handler.lifecycle!(ended, { event_id: 'e1', transition: 'ended' }, { ...live, session_ref: decision.session_ref });
  const afterEnd = r.reads.length;
  await sleep(80);
  assert.ok(r.reads.length <= afterEnd + 1, `at most a read already under way: ${afterEnd} then ${r.reads.length}`);
  const recovered = call();
  const other = await answer(r, recovered);
  await r.until(() => r.reads.some(read => read.call === recovered.call_id), 'a read of the second call');
  await r.handler.recover!(recovered, { ...live, authoritative_terminal: true, session_ref: other.session_ref });
  const afterRecovery = r.reads.length;
  await sleep(80);
  assert.ok(r.reads.length <= afterRecovery + 1);
  assert.equal(r.writes.length, 0);
  assert.equal(r.signals().length, 0);
  await r.handler.close();
});

test('bridge ready: Chert reporting the call over stops the reads at once', async () => {
  const r = rig({ readiness: n => n < 2 ? 'waiting' : 'terminal' });
  await answer(r, call());
  await r.until(() => r.reads.length === 2, 'two reads');
  await sleep(80);
  assert.equal(r.reads.length, 2);
  assert.equal(r.writes.length, 0);
  assert.equal(r.signals().length, 0, 'a call that ended is not reported as ready');
  await r.handler.close();
});

test('bridge ready: a call never reported ready is read for the window only, and nothing is said', async () => {
  const r = rig({ readiness: () => 'waiting', pollMs: 10, waitMs: 60 });
  await answer(r, call());
  await sleep(150);
  const count = r.reads.length;
  assert.ok(count >= 3 && count <= 8, `about one read per 10 ms for 60 ms, was ${count}`);
  await sleep(60);
  assert.equal(r.reads.length, count, 'no read after the window');
  assert.equal(r.writes.length, 0);
  assert.equal(r.signals().length, 0);
  await r.handler.close();
});

test('bridge ready: Chert is read at most once per interval, and the next read is not late', async () => {
  const r = rig({ readiness: () => 'waiting', pollMs: 40, waitMs: 400 });
  await answer(r, call());
  await sleep(300);
  const gaps = r.reads.slice(1).map((read, i) => read.at - r.reads[i]!.at);
  assert.ok(gaps.length >= 4, `reads: ${r.reads.length}`);
  for (const gap of gaps) assert.ok(gap >= 38 && gap < 100, `gap ${gap.toFixed(1)} ms for a 40 ms interval`);
  await r.handler.close();
});

test('bridge ready: by default Chert is read every 500 ms for at most 30 s', () => {
  assert.equal(BRIDGE_POLL_MS, 500);
  assert.equal(BRIDGE_WAIT_MS, 30_000);
});

test('bridge ready: a failed read of Chert is tried again', async () => {
  const r = rig({ readiness: n => { if (n === 1) throw new Error('Chert unreachable'); return 'ready'; } });
  await answer(r, call());
  await r.until(() => r.writes.length > 0, 'the signal');
  assert.equal(r.reads.length, 2);
  assert.equal(r.signals().length, 1);
  await r.handler.close();
});

test('bridge ready: a refused room update is tried again after another read, and written once', async () => {
  const r = rig({ refuseWrites: 2 });
  await answer(r, call());
  await r.until(() => r.writes.length > 0, 'the signal');
  await sleep(60);
  assert.equal(r.writes.length, 1);
  assert.equal(r.reads.length, 3, 'the call is read again before each new attempt, so an ended call is not written to');
  assert.deepEqual(r.signals().map(event => event.room_signal), [true]);
  await r.handler.close();
});

test('bridge ready: a room that never takes the update is reported once, at the end of the window', async () => {
  const r = rig({ refuseWrites: 1_000, pollMs: 10, waitMs: 60 });
  await answer(r, call());
  await r.until(() => r.signals().length > 0, 'the report');
  await sleep(60);
  assert.equal(r.writes.length, 0);
  assert.deepEqual(r.signals().map(event => event.room_signal), [false]);
  await r.handler.close();
});

test('bridge ready: a declined call is never watched', async () => {
  const r = rig();
  const stopped = new AbortController(); stopped.abort();
  assert.deepEqual(await r.handler.prepare(call(), { signal: stopped.signal, remaining_ms: 9_000 }), { action: 'decline' });
  await sleep(60);
  assert.equal(r.reads.length, 0);
  assert.equal(r.writes.length, 0);
  await r.handler.close();
});

test('bridge ready: without the call API or room metadata nothing is read or written, and calls are still answered', async () => {
  for (const missing of [{ callApi: false }, { metadataApi: false }]) {
    const r = rig(missing);
    await answer(r, call());
    await sleep(60);
    assert.equal(r.reads.length, 0);
    assert.equal(r.writes.length, 0);
    assert.equal(r.signals().length, 0);
    await r.handler.close();
  }
});

test('bridge ready: stopping chert dev stops every watch without waiting for its window', async () => {
  const r = rig({ readiness: () => 'waiting', waitMs: 2_000 });
  await answer(r, call()); await answer(r, call());
  await r.until(() => r.reads.length >= 2, 'reads');
  const started = performance.now();
  await r.handler.close();
  assert.ok(performance.now() - started < 1_000, 'close does not wait out the 2 s window');
  const count = r.reads.length;
  await sleep(60);
  assert.equal(r.reads.length, count);
  assert.equal(r.writes.length, 0);
});

const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
const scope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' as const };
const line: Line = { id: L, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available', inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 3 };

test('run: chert dev reads each answered call with its own ids and prints bridge_ready as a call record', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chert-bridge-ready-'));
  const records: Record<string, unknown>[] = [], asked: string[][] = [], writes: string[] = [];
  const control: Control = {
    async callReadiness(project, lineId, callId) { asked.push([project, lineId, callId]); return 'ready'; },
    async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async lines() { return [line]; }, async bindings() { return []; },
    async enroll() { return { scope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } }; },
    async activate() {}, async drain() {}, async revoke() {},
  };
  const rooms = new Set<string>();
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : []; },
    async updateMetadata(_room, metadata) { writes.push(metadata); },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const controller = new AbortController();
  const incoming = call({ project_id: P, line_id: L, call_id: '77777777-7777-4777-8777-777777777777' });
  const deps: DevDeps = { control, api, home, env: {}, signal: controller.signal, emit: record => { records.push(record); },
    run: async (_config, _env, signal, emit, handler) => {
      emit({ code: 'runtime_observation', admission: 'available' });
      const decision = await handler.prepare(incoming, open());
      assert.equal(decision.action, 'accept');
      return new Promise(resolve => { if (signal.aborted) resolve(0); else signal.addEventListener('abort', () => resolve(0), { once: true }); });
    }, reconnectDelayMs: () => 1, maxReconnects: 0 };
  const input: DevInput = { agent: 'support', livekitUrl: 'wss://fixture.livekit.invalid', apiKey: 'APIfixture', apiSecret: 'SECRET_SENTINEL_at_least_32_characters_long',
    controlOrigin: 'https://control.example', relayOrigin: 'https://relay.example', takeover: false, prewarm: false };
  try {
    const running = runDev(input, deps);
    const end = Date.now() + 3000;
    while (!records.some(record => record.code === 'call_bridge_ready')) { if (Date.now() > end) throw new Error('no call_bridge_ready'); await sleep(5); }
    controller.abort(); await running;
    assert.deepEqual(asked, [[P, L, incoming.call_id]], 'the call\'s own project, line and id, read once because it was ready at once');
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0]!).chert_call, incoming.call_id);
    const record = records.find(entry => entry.code === 'call_bridge_ready')!;
    assert.equal(record.call_id, incoming.call_id);
    assert.equal(record.event, 'bridge_ready');
    assert.equal(record.room_signal, true);
    assert.equal(typeof record.at, 'string');
    assert.match(String(record.message), /FaceTime is ready\. The room now carries chert_bridge_ready: your agent should greet within 10 s, or the call ends\./);
    assert.match(sessionLine(record)!, /^✓ \d\d:\d\d:\d\d {2}FaceTime is ready/);
    const refused = sessionLine({ code: 'call_bridge_ready', room_signal: false, message: 'm', at: record.at })!;
    assert.match(refused, /^! /, 'a room that was not told is a warning');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
