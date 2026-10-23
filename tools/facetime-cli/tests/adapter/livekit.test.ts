import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentDispatch, JobRestartPolicy, ParticipantInfo, Room, ServerError, TrackType } from 'livekit-server-sdk';
import { LiveKitAdapter, readinessChecks, validateReady, type LiveKitAPI } from '../../src/adapters/livekit.js';
import { AdapterReceipts } from '../../src/adapters/livekit-receipts.js';
import type { HookSnapshot } from '../../src/adapters/livekit-hook.js';
import { Connector } from '../../src/runtime/connector.js';
import { rig, healthy, TOKEN, RECOVERY } from '../fixtures/rig.js';
import { Fault, type Cancel } from '../../src/protocol/v1.js';

function fixture(receipts = new AdapterReceipts()) {
  const r = rig();
  const rooms = new Map<string, Room>(); let dispatch: AgentDispatch | undefined;
  let participants: ParticipantInfo[] = [];
  const h: HookSnapshot = { project: 'test', name: 'chert-connector-test-unit', deployment: 'chert-test-unit', boot: 'test', worker: 'worker',
    sequence: 1, observed_at: Date.now(), challenge: 'test', connected: true, draining: false, capacity: 1, session: null };
  const config = { url: 'wss://unit.invalid', project: 'test', name: h.name, deployment: h.deployment, boot: h.boot, hookSecret: 'unit-secret' };
  const effects = { rooms: 0, dispatches: 0, deleted: 0 };
  const api: LiveKitAPI = {
    rooms: async names => [...rooms.values()].filter(room => names.includes(room.name)),
    async create(name, metadata, timeout, agent) { effects.rooms++; const room = new Room({ name, sid: 'room-sid', metadata }); rooms.set(name, room); await api.dispatch(name, agent.name, agent.deployment, agent.metadata, timeout); return room; },
    async dispatch(room, name, deployment, metadata) {
      effects.dispatches++;
      const s = JSON.parse(JSON.parse(metadata).spec);
      h.session = { operation: s.operation, room, marker: s.marker, nonce: s.nonce, participant: s.participant,
        job: 'actual-job', dispatch: 'dispatch-id', worker: 'worker', status: 'ready', cancelled: false, track: 'audio-sid' };
      dispatch = new AgentDispatch({ id: 'dispatch-id', room, agentName: name, deployment, metadata, restartPolicy: JobRestartPolicy.JRP_NEVER, state: { jobs: [
        { id: 'actual-job', dispatchId: 'dispatch-id', room: { name: room }, state: { status: 1, participantIdentity: s.participant, workerId: 'worker' } },
      ] } });
      participants = [new ParticipantInfo({ identity: s.participant, attributes: { 'chert.job': 'actual-job', 'chert.nonce': s.nonce },
        tracks: [{ sid: 'audio-sid', type: TrackType.AUDIO, muted: false }] })];
      return dispatch;
    },
    dispatches: async () => dispatch ? [dispatch] : [], participants: async () => participants,
    async removeDispatch() { dispatch = undefined; h.session!.status = 'ended'; },
    async removeRoom(room) { rooms.delete(room); effects.deleted++; }, token: async () => 'CALL_SCOPED_SENTINEL',
  };
  const hook = { async call(path: string, payload?: Record<string, string>) { if (path === '/cancel') { if (h.session) h.session.cancelled = true; h.cancelled_operation = payload?.operation; } return structuredClone(h); } };
  let cleanupTime = 0;
  const cleanupClock = { now: () => cleanupTime, wait: async () => { cleanupTime += 1000; }, budget: 8000 };
  const adapter = new LiveKitAdapter(api, hook, receipts, config, cleanupClock);
  const connector = new Connector(r.scope, r.journal, adapter, r.availability, r.clock);
  return { ...r, connector, adapter, api, hook, h, rooms, effects, config, receipts, cleanupClock, get participants() { return participants; }, get dispatch() { return dispatch; } };
}
function cancel(r: ReturnType<typeof fixture>, incoming: ReturnType<ReturnType<typeof rig>['request']>) {
  r.connector.cancel({ ...incoming, type: 'call.cancel', terminal: true, reason: 'terminal', call_version: 2 } as Cancel);
}
for (const state of ['missing', 'stale', 'disconnected', 'full', 'draining'] as const) {
  test(`${state} health creates zero real-adapter effects`, async () => {
    const r = fixture();
    if (state === 'missing') { try { r.availability.observe('wrong', null); } catch { /* expected */ } }
    if (state === 'stale') r.clock.advance(5000);
    if (state === 'disconnected') healthy(r, { connected: false });
    if (state === 'full') healthy(r, { capacity: 0 });
    if (state === 'draining') healthy(r, { draining: true });
    assert.equal((await r.connector.incoming(r.request())).action, 'decline');
    assert.deepEqual(r.effects, { rooms: 0, dispatches: 0, deleted: 0 });
  });
}
test('one correlated real-adapter dispatch, duplicate replay and uncertain reconnect preserve room', async () => {
  const r = fixture(); const call = r.request();
  const [a, b] = await Promise.all([r.connector.incoming(call), r.connector.incoming(call)]);
  assert.equal(a.action, 'accept'); assert.deepEqual(a, b);
  assert.equal(r.effects.dispatches, 1);
  const entry = r.journal.get(call)!;
  assert.equal(r.receipts.get(entry)?.actualJob, 'actual-job');
  assert.notEqual(entry.job, 'actual-job');
  assert.ok(!JSON.stringify(r.journal.snapshot()).includes('CALL_SCOPED_SENTINEL'));
  r.connector.disconnect(); r.connector.reconnect({ ...r.scope, connection_generation: r.scope.connection_generation + 1 }, 'active');
  await r.connector.reconcile(async () => ({ status: 'unknown' }));
  assert.equal(r.rooms.size, 1); assert.equal(r.effects.dispatches, 1);
  cancel(r, call); await r.connector.flushCleanup();
  assert.equal(r.connector.debt(), 0); assert.equal(r.rooms.size, 0);
});
for (const field of ['job', 'nonce', 'participant', 'track', 'muted', 'extra_audio', 'room', 'worker', 'dispatch', 'ended', 'disconnected'] as const) {
  test(`wrong readiness ${field} cannot accept`, async () => {
    const r = fixture(); const dispatch = r.api.dispatch;
    r.api.dispatch = async (...args) => {
      const d = await dispatch(...args);
      if (field === 'dispatch') d.state!.jobs[0]!.dispatchId = 'other';
      else if (field === 'ended') d.state!.jobs[0]!.state!.status = 2;
      else if (field === 'disconnected') r.h.connected = false;
      else if (field === 'muted') r.participants[0]!.tracks[0]!.muted = true;
      else if (field === 'extra_audio') r.participants.push(new ParticipantInfo({ identity: 'foreign', tracks: [{ type: TrackType.AUDIO }] }));
      else r.h.session![field] = 'wrong';
      return d;
    };
    // Test the actual readiness predicate independently of timeout behavior.
    // A successful control session supplies service-assigned identifiers first.
    const original = r.api.dispatch;
    r.api.dispatch = dispatch;
    const call = r.request();
    assert.equal((await r.connector.incoming(call)).action, 'accept');
    const entry = r.journal.get(call)!;
    assert.equal(validateReady(entry, r.dispatch!, r.h, r.participants), true);
    await original(entry.room, r.config.name, r.config.deployment, r.dispatch!.metadata, 1000);
    assert.equal(validateReady(entry, r.dispatch!, r.h, r.participants), false);
  });
}
test('rejected room create remains debt through receipt reopen and initially absent inspection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'adapter-receipt-'));
  try {
    const path = join(directory, 'receipts.json'); const r = fixture(new AdapterReceipts(path));
    r.api.create = async () => { throw new Error('local timeout'); };
    const call = r.request(); assert.equal((await r.connector.incoming(call)).action, 'decline');
    await r.connector.flushCleanup();
    const entry = r.journal.get(call)!;
    assert.equal(entry.create_pending, true); assert.equal(entry.cleanup_debt, true);
    assert.equal(await r.adapter.inspect(entry), 'unknown');
    const reopened = new LiveKitAdapter(r.api, r.hook, new AdapterReceipts(path), r.config);
    assert.equal(await reopened.settled(entry), false);
    assert.equal(r.connector.check(), 'cleanup_pending');
  } finally { rmSync(directory, { recursive: true }); }
});
test('uncertain dispatch rejection and absent room never settle the operation', async () => {
  const r = fixture(); r.api.dispatch = async () => { throw new Error('lost ack'); };
  const call = r.request(); await r.connector.incoming(call); r.rooms.clear(); await r.connector.flushCleanup();
  assert.equal(await r.adapter.settled(r.journal.get(call)!), false);
  assert.equal(r.connector.check(), 'cleanup_pending');
});
test('cancel while combined room/dispatch creation is in flight cleans the late acknowledged job', async () => {
  const r = fixture(); const create = r.api.create;
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  r.api.create = async (...args) => { started(); await wait; return create(...args); };
  const call = r.request(); const decision = r.connector.incoming(call); await entered;
  cancel(r, call); assert.equal((await decision).action, 'decline');
  await r.connector.flushCleanup(); assert.equal(r.connector.check(), 'cleanup_pending');
  release(); await new Promise(resolve => setImmediate(resolve)); await r.connector.flushCleanup();
  assert.equal(r.effects.dispatches, 1); assert.equal(r.rooms.size, 0); assert.equal(r.connector.debt(), 0);
});
test('foreign room replacement is never deleted', async () => {
  const r = fixture(); const call = r.request(); await r.connector.incoming(call);
  const entry = r.journal.get(call)!;
  r.rooms.set(entry.room, new Room({ name: entry.room, sid: 'foreign', metadata: 'foreign' }));
  cancel(r, call); await r.connector.flushCleanup();
  assert.equal(r.effects.deleted, 0); assert.equal(r.connector.check(), 'cleanup_pending');
});
test('delete failure and vanished room with running job retain cleanup debt', async () => {
  const r = fixture(); const call = r.request(); await r.connector.incoming(call);
  r.api.removeDispatch = async () => { throw new Fault('cleanup_pending'); };
  cancel(r, call); await r.connector.flushCleanup(); assert.equal(r.connector.check(), 'cleanup_pending');
  r.rooms.clear(); await r.connector.flushCleanup(); assert.equal(r.connector.check(), 'cleanup_pending');
});

test('unverifiable connected state disables admission without effects', async () => {
  const r = fixture(); healthy(r, { connected: null });
  assert.equal(r.connector.check(), 'agent_availability_unknown');
  assert.equal((await r.connector.incoming(r.request())).action, 'decline');
  assert.equal(r.effects.rooms, 0);
});
test('receipt from another deployment or instance never authorizes cleanup', async () => {
  const r = fixture(); const call = r.request(); await r.connector.incoming(call);
  const entry = r.journal.get(call)!;
  const foreign = new LiveKitAdapter(r.api, r.hook, r.receipts, { ...r.config, boot: 'other-boot' });
  assert.equal(await foreign.settled(entry), false);
  assert.equal(await foreign.inspect(entry), 'unknown');
  await assert.rejects(foreign.delete(entry), /cleanup_pending/);
  assert.equal(r.effects.deleted, 0);
});

test('proven pre-send room validation settles both unsent effects after reopen', async () => {
  const { liveKitAPI } = await import('../../src/adapters/livekit.js');
  const directory = mkdtempSync(join(tmpdir(), 'adapter-presend-'));
  try {
    const path = join(directory, 'receipts.json'); const r = fixture(new AdapterReceipts(path));
    const sdk = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters');
    const rooms = r.api.rooms;
    r.api.rooms = async names => { const value = await rooms(names); r.clock.advance(3500); return value; };
    r.api.create = sdk.create;
    const call = r.request(); assert.equal((await r.connector.incoming(call)).action, 'decline'); await r.connector.flushCleanup();
    const entry = r.journal.get(call)!;
    assert.equal(await r.adapter.settled(entry), true);
    assert.equal(r.receipts.get(entry)?.phase, 'room_not_sent');
    assert.equal(r.receipts.get(entry)?.audit?.at(-1)?.input_timeout_ms, 500);
    const reopened = new LiveKitAdapter(r.api, r.hook, new AdapterReceipts(path), r.config);
    const recovered = new Connector(r.scope, r.journal, reopened, r.availability, r.clock);
    await recovered.flushCleanup();
    assert.equal(recovered.debt(), 0); assert.equal(r.effects.deleted, 0); assert.equal(r.effects.dispatches, 0);
    const audit = new AdapterReceipts(path).get(entry)!.audit!;
    assert.deepEqual(audit.map(event => event.phase), ['pending', 'not_sent']);
    assert.throws(() => new AdapterReceipts(path).put({ ...new AdapterReceipts(path).get(entry)!, audit: [] }), /adapter_audit_conflict|Missing pre-send evidence/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('proven unsent room clears debt without invoking fetch or inventing an acknowledgment', async t => {
  const { liveKitAPI } = await import('../../src/adapters/livekit.js');
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('must not fetch'); });
  const r = fixture();
  const read = r.api.rooms; r.api.rooms = async names => { r.clock.advance(3500); return read(names); };
  r.api.create = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters').create;
  const call = r.request(); await r.connector.incoming(call); await r.connector.flushCleanup();
  const receipt = r.receipts.get(r.journal.get(call)!)!;
  assert.equal(fetches, 0); assert.equal(r.connector.debt(), 0);
  assert.equal(receipt.phase, 'room_not_sent'); assert.equal(receipt.roomSid, undefined);
  assert.deepEqual(receipt.audit!.map(e => e.phase), ['pending', 'not_sent']);
});

test('lookalike RangeError after fetch retains debt and sanitized uncertain diagnostics', async t => {
  const { liveKitAPI } = await import('../../src/adapters/livekit.js');
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw Object.assign(new RangeError('TOKEN_HEADER_BODY_SENTINEL'), { code: 'ERR_OUT_OF_RANGE' }); });
  const r = fixture();
  r.api.dispatch = liveKitAPI('https://example.invalid', 'fake-key', 'fake-secret-at-least-32-characters').dispatch;
  const call = r.request(); await r.connector.incoming(call); await r.connector.flushCleanup();
  const entry = r.journal.get(call)!; const receipt = r.receipts.get(entry)!;
  assert.equal(fetches, 1); assert.equal(await r.adapter.settled(entry), false);
  assert.equal(receipt.phase, 'room_pending'); assert.equal(r.connector.check(), 'cleanup_pending');
  assert.equal(receipt.audit!.at(-1)!.phase, 'uncertain');
  assert.deepEqual(receipt.audit!.at(-1)!.diagnostic, { error_class: 'RangeError', error_code: 'ERR_OUT_OF_RANGE' });
  assert.ok(!JSON.stringify(receipt).includes('TOKEN_HEADER_BODY_SENTINEL'));
});

test('not-sent phase requires evidence; historical ambiguous receipts cannot be reclassified', async () => {
  const r = fixture(); r.api.dispatch = async () => { throw new Error('unknown'); };
  const call = r.request(); await r.connector.incoming(call); await r.connector.flushCleanup();
  const entry = r.journal.get(call)!, receipt = r.receipts.get(entry)!;
  assert.throws(() => r.receipts.put({ ...receipt, phase: 'dispatch_not_sent' }), /Missing pre-send evidence/);
  // Model the original format: no target, timeout, error code or send evidence.
  const old = new AdapterReceipts();
  old.put({ entry, phase: 'dispatch_pending', roomSid: 'room-sid' });
  const adapter = new LiveKitAdapter(r.api, r.hook, old, r.config);
  r.rooms.clear(); assert.equal(await adapter.settled(entry), false);
});

test('failed evidence persistence cannot advance the in-memory receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'adapter-persist-'));
  try {
    const path = join(directory, 'receipt.json'); const r = fixture(new AdapterReceipts(path));
    const call = r.request(); await r.connector.incoming(call);
    const entry = r.journal.get(call)!, original = r.receipts.get(entry)!;
    const bytes = readFileSync(path);
    mkdirSync(path + '.tmp');
    assert.throws(() => r.receipts.put({ ...original, phase: 'clean' }));
    assert.deepEqual(r.receipts.get(entry), original);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(r.receipts.healthy, false);
    assert.equal(await r.adapter.settled(entry), false);
    rmSync(path + '.tmp', { recursive: true });
    assert.throws(() => r.receipts.put(original), /adapter_receipts_unavailable/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('extra unnamed service dispatch blocks readiness even with a fully matching isolated publication', async () => {
  const r = fixture(); const list = r.api.dispatches;
  r.api.dispatches = async room => {
    const owned = await list(room);
    const entry = Object.values(r.journal.snapshot().entries)[0]!;
    // This is the service shape observed in the diagnostic run. The named
    // candidate meets the exact predicate, but inventory cardinality must fail.
    assert.equal(validateReady(entry, owned[0]!, r.h, r.participants), true);
    r.clock.advance(500);
    return [new AgentDispatch({ id: 'service-default', agentName: '', room, state: { jobs: [] } }), ...owned];
  };
  const call = r.request(); const decision = await r.connector.incoming(call);
  assert.equal(decision.action, 'decline');
  if (decision.action === 'decline') assert.equal(decision.reason, 'readiness_invalid');
  assert.equal(r.effects.dispatches, 1);
  assert.equal(r.receipts.get(r.journal.get(call)!)?.actualJob, undefined);
  await r.connector.flushCleanup(); r.connector.close();
});

test('room delete acknowledgment followed by stale inventory and dispatch 404 verifies cleanup', async () => {
  const r = fixture(); const call = r.request(); await r.connector.incoming(call);
  const entry = r.journal.get(call)!;
  const remove = r.api.removeRoom, list = r.api.rooms;
  let acknowledged = false, staleOnce = false;
  const oldRoom = r.rooms.get(entry.room)!;
  r.api.removeRoom = async room => { await remove(room); acknowledged = true; staleOnce = true; };
  r.api.rooms = async names => {
    if (staleOnce) { staleOnce = false; return [oldRoom]; }
    return list(names);
  };
  const dispatches = r.api.dispatches;
  r.api.dispatches = async room => {
    if (acknowledged) throw new ServerError('Not Found', 'room not found', 404, 'not_found');
    return dispatches(room);
  };
  cancel(r, call); await r.connector.flushCleanup();
  assert.equal(r.effects.deleted, 1); assert.equal(r.rooms.size, 0);
  assert.equal(r.h.session?.status, 'ended');
  assert.equal(r.receipts.get(entry)?.phase, 'clean');
  assert.equal(await r.adapter.inspect(entry), 'absent');
  assert.equal(r.connector.debt(), 0); r.connector.close();
});

test('combined creation journals dispatch intent before sending and never explicitly redispatches', async () => {
  const r = fixture(), create = r.api.create;
  r.api.create = async (...args) => {
    const entry = Object.values(r.journal.snapshot().entries)[0]!;
    const receipt = r.receipts.get(entry)!;
    assert.equal(receipt.phase, 'room_pending'); assert.equal(receipt.topology, 'room_agent');
    assert.match(receipt.dispatchDigest!, /^[a-f0-9]{64}$/);
    const value = await create(...args);
    r.api.dispatch = async () => { assert.fail('second explicit dispatch'); };
    return value;
  };
  const call = r.request(); assert.equal((await r.connector.incoming(call)).action, 'accept');
  assert.equal(r.effects.rooms, 1); assert.equal(r.effects.dispatches, 1);
  cancel(r, call); await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0);
});

for (const mutation of ['extra_job', 'video_publisher', 'deployment', 'restart'] as const) {
  test(`configured topology rejects unexpected ${mutation}`, async () => {
    const r = fixture(), create = r.api.create;
    r.api.create = async (...args) => {
      const room = await create(...args);
      if (mutation === 'extra_job') r.dispatch!.state!.jobs.push(r.dispatch!.state!.jobs[0]!.clone());
      if (mutation === 'video_publisher') r.participants.push(new ParticipantInfo({ identity: 'foreign', tracks: [{ type: TrackType.VIDEO }] }));
      if (mutation === 'restart') r.dispatch!.restartPolicy = JobRestartPolicy.JRP_ON_FAILURE;
      if (mutation === 'deployment') r.dispatch!.deployment = 'foreign';
      return room;
    };
    const participants = r.api.participants;
    r.api.participants = async room => { r.clock.advance(1000); return participants(room); };
    const call = r.request(); assert.equal((await r.connector.incoming(call)).action, 'decline');
    assert.equal(r.effects.dispatches, 1); r.connector.close();
  });
}

test('late assignment after cancellation is correlated, stopped and never accepted', async () => {
  const r = fixture(), create = r.api.create;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  r.api.create = async (...args) => { entered(); await held; return create(...args); };
  const call = r.request(), decision = r.connector.incoming(call); await started;
  cancel(r, call); assert.equal((await decision).action, 'decline');
  release(); await new Promise(resolve => setImmediate(resolve)); await r.connector.flushCleanup();
  assert.equal(r.connector.debt(), 0); assert.equal(r.effects.dispatches, 1);
  assert.equal(r.h.session?.status, 'ended'); assert.equal(r.h.session?.cancelled, true);
  assert.ok(r.receipts.get(r.journal.get(call)!)?.cleanup?.some(e => e.kind === 'ended'));
});

for (const failure of ['stale_inventory', 'delete_unavailable'] as const) {
  test(`durable terminal receipts survive reopen and worker shutdown after ${failure}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'adapter-cleanup-reopen-'));
    try {
      const path = join(directory, 'adapter.json'), r = fixture(new AdapterReceipts(path));
      const call = r.request(); await r.connector.incoming(call); const entry = r.journal.get(call)!;
      const list = r.api.rooms, remove = r.api.removeRoom, old = r.rooms.get(entry.room)!;
      let unavailable = true;
      if (failure === 'stale_inventory') r.api.rooms = async names => r.effects.deleted && unavailable ? [old] : list(names);
      else r.api.removeRoom = async room => { if (unavailable) throw new Error('unavailable'); await remove(room); };
      cancel(r, call); await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 1);
      const persisted = new AdapterReceipts(path);
      assert.ok(persisted.get(entry)?.cleanup?.some(e => e.kind === 'ended'));
      assert.ok(persisted.get(entry)?.cleanup?.some(e => e.kind === 'dispatch_deleted'));
      if (failure === 'stale_inventory') assert.ok(persisted.get(entry)?.cleanup?.some(e => e.kind === 'room_deleted'));
      r.hook.call = async () => { throw new Error('worker retired'); }; unavailable = false;
      const reopened = new LiveKitAdapter(r.api, r.hook, persisted, r.config, r.cleanupClock);
      const recovered = new Connector(r.scope, r.journal, reopened, r.availability, r.clock);
      await recovered.flushCleanup(); assert.equal(recovered.debt(), 0); assert.equal(r.effects.deleted, 1);
      assert.throws(() => persisted.put({ ...persisted.get(entry)!, cleanup: [] }), /adapter_cleanup_conflict/);
    } finally { rmSync(directory, { recursive: true }); }
  });
}

for (const failure of ['plain404', 'auth', 'timeout', 'management_unavailable', 'replacement'] as const) {
  test(`acknowledged deletion does not clear debt on ${failure}`, async () => {
    const r = fixture(), call = r.request(); await r.connector.incoming(call); const entry = r.journal.get(call)!;
    const remove = r.api.removeRoom, list = r.api.rooms, dispatches = r.api.dispatches;
    let deleted = false;
    r.api.removeRoom = async room => { await remove(room); deleted = true;
      if (failure === 'replacement') r.rooms.set(room, new Room({ name: room, sid: 'replacement', metadata: entry.marker }));
    };
    r.api.rooms = async names => { if (deleted && failure === 'management_unavailable') throw new Error('unavailable'); return list(names); };
    r.api.dispatches = async room => {
      if (deleted && failure === 'plain404') throw Object.assign(new Error(), { status: 404, code: 'not_found' });
      if (deleted && failure === 'auth') throw new ServerError('Forbidden', 'forbidden', 403, 'permission_denied');
      if (deleted && failure === 'timeout') throw new Error('timeout');
      return dispatches(room);
    };
    cancel(r, call); await r.connector.flushCleanup();
    assert.equal(r.connector.debt(), 1); assert.equal(r.effects.deleted, 1);
    r.api.rooms = list; r.api.dispatches = dispatches;
    if (failure !== 'replacement') { await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0); }
    else { assert.equal(await r.adapter.inspect(entry), 'foreign'); assert.equal(r.rooms.size, 1); }
  });
}

test('terminal observation is durable before a management failure and needs no retired hook on retry', async () => {
  const r = fixture(), call = r.request(); await r.connector.incoming(call);
  r.h.session!.status = 'ended';
  const list = r.api.dispatches;
  r.api.dispatches = async () => { throw new Error('management unavailable'); };
  cancel(r, call); await r.connector.flushCleanup();
  assert.ok(r.receipts.get(r.journal.get(call)!)?.cleanup?.some(e => e.kind === 'ended'));
  r.hook.call = async () => { throw new Error('retired worker'); }; r.api.dispatches = list;
  await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0);
});

test('cancellation of a not-yet-assigned dispatch persists tombstone and verified deletion', async () => {
  const r = fixture(), create = r.api.create;
  r.api.create = async (...args) => {
    const room = await create(...args);
    r.dispatch!.state!.jobs = []; r.h.session = null;
    r.clock.advance(4000); return room;
  };
  r.api.removeDispatch = async () => { r.api.dispatches = async () => []; };
  const call = r.request(); assert.equal((await r.connector.incoming(call)).action, 'decline');
  await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0);
  const receipt = r.receipts.get(r.journal.get(call)!)!;
  assert.ok(receipt.cleanup?.some(e => e.kind === 'unassigned'));
  assert.equal(receipt.actualJob, undefined); assert.equal(r.effects.dispatches, 1);
});

test('readiness diagnostics retain nonce rejection when listed job room is omitted', async () => {
  const r = fixture(), call = r.request(); await r.connector.incoming(call); const entry = r.journal.get(call)!;
  assert.ok(Object.values(readinessChecks(entry, r.dispatch!, r.h, r.participants)).every(Boolean));
  r.dispatch!.state!.jobs[0]!.room = undefined;
  r.participants[0]!.attributes['chert.nonce'] = 'SECRET_SENTINEL';
  const checks = readinessChecks(entry, r.dispatch!, r.h, r.participants);
  assert.equal(checks.job_room_matches, true); assert.equal(checks.nonce_matches, false);
  assert.equal(checks.track_matches, true); assert.equal(validateReady(entry, r.dispatch!, r.h, r.participants), false);
  assert.ok(Object.values(checks).every(v => typeof v === 'boolean'));
  assert.ok(!JSON.stringify(checks).includes('SECRET_SENTINEL')); r.connector.close();
});

test('SDK dispatch decoding preserves omission versus contradiction under the room correlation contract', async () => {
  const r = fixture(), call = r.request();
  await r.connector.incoming(call); const entry = r.journal.get(call)!;
  for (const room of [undefined, new Room({ name: 'other-room' })]) {
    const dispatch = r.dispatch!.clone(); dispatch.state!.jobs[0]!.room = room;
    const decoded = AgentDispatch.fromJson(dispatch.toJson());
    assert.equal(decoded.room, entry.room);
    assert.equal(decoded.state!.jobs[0]!.room?.name, room?.name);
    const checks = readinessChecks(entry, decoded, r.h, r.participants);
    assert.deepEqual(Object.entries(checks).filter(([, passes]) => !passes).map(([name]) => name), room ? ['job_room_matches'] : []);
    assert.equal(validateReady(entry, decoded, r.h, r.participants), room === undefined);
  }
  r.connector.close();
});

test('omitted listed job room accepts only a correlated owned dispatch and persists assignment before token', async () => {
  const r = fixture(), call = r.request(), list = r.api.dispatches;
  let tokenCalls = 0;
  r.api.dispatches = async room => {
    r.clock.advance(500);
    return (await list(room)).map(d => {
      const copy = d.clone(); copy.state!.jobs[0]!.room = undefined;
      return AgentDispatch.fromJson(copy.toJson());
    });
  };
  r.api.token = async entry => {
    tokenCalls++;
    assert.equal(r.receipts.get(entry)?.actualJob, 'actual-job');
    assert.equal(r.receipts.get(entry)?.actualWorker, 'worker');
    return 'CALL_SCOPED_SENTINEL';
  };
  const [a, b] = await Promise.all([r.connector.incoming(call), r.connector.incoming(call)]);
  assert.equal(a.action, 'accept'); assert.deepEqual(a, b);
  assert.equal(tokenCalls, 1); assert.equal(r.effects.dispatches, 1);
  const [committed, duplicate] = await Promise.all([r.authority.commit(TOKEN, a), r.authority.commit(TOKEN, b)]);
  assert.deepEqual(committed, duplicate); assert.equal(r.authority.commitCount, 1);
  r.connector.committed(committed); assert.equal(r.journal.get(call)?.state, 'accepted');
  r.connector.lifecycle(r.authority.lifecycle(RECOVERY, call, 'ended'));
  await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0); assert.equal(r.rooms.size, 0);
});

for (const contradiction of ['nested_wrong', 'nested_empty', 'parent_room', 'hook_dispatch_missing', 'hook_dispatch_wrong', 'job_dispatch', 'job_id', 'hook_room', 'hook_marker', 'hook_nonce'] as const) {
  test(`room correlation refuses ${contradiction} even when the listed job omits room`, async () => {
    const r = fixture(), call = r.request(); await r.connector.incoming(call); const entry = r.journal.get(call)!;
    const d = r.dispatch!.clone(), h = structuredClone(r.h);
    d.state!.jobs[0]!.room = undefined;
    if (contradiction === 'nested_wrong') d.state!.jobs[0]!.room = new Room({ name: 'foreign' });
    if (contradiction === 'nested_empty') d.state!.jobs[0]!.room = new Room();
    if (contradiction === 'parent_room') d.room = 'foreign';
    if (contradiction === 'hook_dispatch_missing') delete h.session!.dispatch;
    if (contradiction === 'hook_dispatch_wrong') h.session!.dispatch = 'foreign';
    if (contradiction === 'job_dispatch') d.state!.jobs[0]!.dispatchId = 'foreign';
    if (contradiction === 'job_id') d.state!.jobs[0]!.id = 'foreign';
    if (contradiction === 'hook_room') h.session!.room = 'foreign';
    if (contradiction === 'hook_marker') h.session!.marker = 'foreign';
    if (contradiction === 'hook_nonce') h.session!.nonce = 'foreign';
    assert.equal(readinessChecks(entry, d, h, r.participants).job_room_matches, false);
    assert.equal(validateReady(entry, d, h, r.participants), false);
    r.connector.close();
  });
}

for (const failure of ['deadline', 'room_sid', 'room_marker', 'nested_wrong', 'hook_dispatch'] as const) {
  test(`omitted job room cannot bypass ${failure} during actual preparation`, async () => {
    const r = fixture(), call = r.request(), create = r.api.create;
    let tokenCalls = 0;
    r.api.create = async (...args) => {
      const room = await create(...args);
      r.dispatch!.state!.jobs[0]!.room = failure === 'nested_wrong' ? new Room({ name: 'foreign' }) : undefined;
      if (failure === 'room_sid') r.rooms.set(room.name, new Room({ name: room.name, sid: 'foreign', metadata: room.metadata }));
      if (failure === 'room_marker') room.metadata = 'foreign';
      if (failure === 'hook_dispatch') r.h.session!.dispatch = 'foreign';
      return room;
    };
    const participants = r.api.participants;
    r.api.participants = async room => { r.clock.advance(failure === 'deadline' ? 4000 : 1000); return participants(room); };
    r.api.token = async () => { tokenCalls++; return 'MUST_NOT_BE_MINTED'; };
    assert.equal((await r.connector.incoming(call)).action, 'decline');
    assert.equal(tokenCalls, 0); assert.equal(r.effects.dispatches, 1);
    const receipt = r.receipts.get(r.journal.get(call)!)!;
    // Readiness must not mark a contradictory or expired assignment ready.
    assert.notEqual(receipt.phase, 'ready'); r.connector.close();
  });
}
