import test from 'node:test';
import assert from 'node:assert/strict';
import { museHandler } from '../../src/dev/muse-handler.js';
import type { DevEvent, DispatchAPI, DispatchParticipant } from '../../src/dev/dispatch-handler.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

// Warm-up needs two polls. The window is generous so a busy machine cannot starve it; a test that needs warm-up to fail asks for a short one.
function fixture(options: { log?: (event: DevEvent) => void; warmTimeoutMs?: number } = {}) {
  let time = Date.now(), spec: Record<string, unknown>;
  const rooms = new Set<string>(), writes: Record<string, unknown>[] = [], reports: string[] = [], receipts: Record<string, unknown>[] = [], events: DevEvent[] = [];
  let frames = 0, media = true, cleanup = false, removeFails = false, read: 'waiting' | 'ready' | 'terminal' | 'error' = 'waiting';
  const api: DispatchAPI = {
    async createRoom(name, options) { rooms.add(name); spec = JSON.parse(options.agentMetadata); return { name, sid: 'RM_fixture' }; },
    async listParticipants() {
      frames++;
      const p: DispatchParticipant = { identity: 'actual-agent', kind: 'agent', attributes: {
        'chert.muse.preparation': String(spec.preparation_id), 'chert.muse.profile': 'muse', 'chert.muse.ready': media ? '1' : '0',
        'chert.muse.heartbeat': String(time), 'chert.muse.video': String(frames), 'chert.muse.audio': String(frames),
        'chert.muse.cleanup': cleanup ? 'clean' : 'pending',
      }, tracks: [{ source: 1, muted: false }, { source: 2, muted: false }] };
      return [p];
    },
    async deleteRoom(room) { if (removeFails) throw new Error('offline'); rooms.delete(room); },
    async updateMetadata(_room, metadata) { writes.push(JSON.parse(metadata).chert_muse); },
  };
  const handler = museHandler({ api, agentName: 'demo-agent-0', livekitUrl: 'wss://fixture.invalid', apiKey: 'fixture',
    apiSecret: 'fixture-secret-long-enough-for-tests', now: () => time, pollMs: 1, warmTimeoutMs: options.warmTimeoutMs ?? 5_000,
    report: code => reports.push(code), save: receipt => receipts.push(receipt), log: options.log ?? (event => events.push(event)),
    readCall: async () => { if (read === 'error') throw new Error('offline'); return read; } });
  const call: ApplicationCall = { operation_id: 'operation', call_id: 'real_call', project_id: 'project', line_id: 'line', request_id: 'request',
    deadline_at: time + 5000, prepare_deadline_at: time + 4000, maximum_session_expires_at: time + 600000, media: { audio: true, video: true } };
  return { handler, rooms, writes, reports, receipts, events, call, api, advance: (ms: number) => { time += ms; },
    get spec() { return spec; }, set media(value: boolean) { media = value; }, set cleaned(value: boolean) { cleanup = value; },
    set removeFails(value: boolean) { removeFails = value; }, set read(value: typeof read) { read = value; } };
}
const context = { authoritative_terminal: false, acceptance: 'accept' as const, cancel_requested: false };

test('Muse preparation requires actual fresh media, never just agent membership; no automatic paid refill', async () => {
  const f = fixture({ warmTimeoutMs: 30 }); f.media = false;
  await f.handler.warm();
  assert.equal(await f.handler.health!(), 'unavailable');
  assert.ok(!f.reports.includes('muse_ready'));
  assert.equal(f.spec.mode, 'chert-muse-v1');
  assert.equal(f.spec.worker_identity, undefined);
  assert.equal(f.spec.call_id, undefined);
  f.media = true; f.cleaned = true;
  await f.handler.refresh(); await f.handler.warm();
  assert.equal(f.reports.filter(x => x === 'muse_warming').length, 1);
  assert.equal(f.rooms.size, 0);
  await f.handler.close();
});

test('Muse binds only the actual call and opens speech only after authoritative bridge readiness', async () => {
  const f = fixture(); await f.handler.warm();
  assert.equal(await f.handler.health!(), 'available');
  const result = await f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 });
  assert.equal(result.action, 'accept');
  assert.equal(f.writes.at(-1)!.call_id, 'real_call');
  assert.equal(f.writes.at(-1)!.bridge_identity, 'chert-bridge-real_call');
  await f.handler.lifecycle!(f.call, { event_id: 'started', transition: 'started' }, context);
  assert.ok(!f.reports.includes('muse_connected'), 'started alone is too early');
  for (const read of ['waiting', 'error'] as const) {
    f.read = read; f.advance(1000);
    const proof = await f.handler.recover!(f.call, context);
    assert.equal(proof.cleanup, 'pending'); assert.equal(f.rooms.size, 1);
    assert.ok(!f.writes.some(w => w.state === 'active'));
  }
  f.read = 'ready'; f.advance(1000); await f.handler.recover!(f.call, context);
  assert.equal(f.writes.at(-1)!.state, 'active');
  assert.equal(f.reports.filter(x => x === 'muse_connected').length, 1);
  f.read = 'error'; f.advance(3000);
  const writes = f.writes.length;
  await f.handler.refresh(); await f.handler.recover!(f.call, context);
  assert.equal(f.writes.length, writes, 'failed authority reads cannot renew active speech');
  f.cleaned = true;
  await f.handler.close();
});

test('Muse terminal cleanup waits for provider acknowledgment and retries deletion without another preparation', async () => {
  const f = fixture(); await f.handler.warm();
  await f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 });
  const terminal = { ...context, authoritative_terminal: true };
  assert.equal((await f.handler.recover!(f.call, terminal)).cleanup, 'unknown');
  assert.equal(f.rooms.size, 1);
  f.cleaned = true; f.removeFails = true;
  assert.equal((await f.handler.recover!(f.call, terminal)).cleanup, 'unknown');
  f.removeFails = false;
  assert.equal((await f.handler.recover!(f.call, terminal)).cleanup, 'clean');
  assert.equal(f.rooms.size, 0);
  await f.handler.refresh(); await f.handler.warm();
  assert.equal(f.reports.filter(x => x === 'muse_warming').length, 1);
  assert.equal((await f.handler.prepare({ ...f.call, call_id: 'second' }, { signal: new AbortController().signal, remaining_ms: 4000 })).action, 'decline');
  await f.handler.close();
  const next = fixture(); await next.handler.warm();
  assert.notEqual(next.spec.preparation_id, f.spec.preparation_id);
  assert.equal((await next.handler.prepare({ ...next.call, call_id: 'second' }, { signal: new AbortController().signal, remaining_ms: 4000 })).action, 'accept');
  next.cleaned = true; await next.handler.close();
});

test('unused Muse session expires without refill, and cancellation during warm-up retains cleanup debt', async () => {
  const f = fixture(); await f.handler.warm(); f.advance(120001);
  await f.handler.refresh();
  assert.equal(await f.handler.health!(), 'unavailable');
  assert.equal(f.writes.at(-1)!.state, 'terminal');
  f.cleaned = true; await f.handler.close();
  const next = fixture();
  const original = next.api.listParticipants;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  next.api.listParticipants = async room => { await held; return original(room); };
  const warming = next.handler.warm();
  const closing = next.handler.close();
  next.cleaned = true; release();
  await warming; await closing;
  assert.equal(next.rooms.size, 0);
  assert.ok(!next.reports.includes('muse_ready'));
});

test('Muse remembers cleanup proof when room deletion succeeds but its response is lost', async () => {
  const f = fixture(); await f.handler.warm(); f.cleaned = true;
  const original = f.api.deleteRoom; let first = true;
  f.api.deleteRoom = async room => {
    await original(room);
    if (first) { first = false; throw new Error('lost response'); }
  };
  f.advance(120001); await f.handler.refresh();
  assert.equal(f.rooms.size, 0);
  assert.equal(f.receipts.at(-1)!.agent_clean, true);
  assert.equal(f.receipts.at(-1)!.clean, false);
  f.api.listParticipants = async () => { throw new Error('room is gone'); };
  await f.handler.close();
  assert.equal(f.receipts.at(-1)!.clean, true);
});

test('an idle health read finishing after call binding cannot tear down that active room', async () => {
  const f = fixture(); await f.handler.warm();
  const original = f.api.listParticipants;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  f.api.listParticipants = async room => {
    if (reads++ === 0) {
      await held;
      const participants = await original(room);
      participants[0]!.attributes!['chert.muse.video'] = '1';
      participants[0]!.attributes!['chert.muse.audio'] = '1';
      return participants;
    }
    return original(room);
  };
  const refreshing = f.handler.refresh();
  assert.equal((await f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 })).action, 'accept');
  f.advance(4000); f.cleaned = true; release(); await refreshing;
  assert.equal(f.rooms.size, 1);
  assert.ok(!f.writes.some(w => w.state === 'terminal'));
  await f.handler.close();
});

test('Muse reports each call it was asked about and why it declined; an accepted call is reported by its own Muse records', async () => {
  const f = fixture(); await f.handler.warm();
  f.advance(5000);
  assert.deepEqual(await f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 }), { action: 'decline' });
  const gone = new AbortController(); gone.abort();
  assert.deepEqual(await f.handler.prepare({ ...f.call, call_id: 'hung_up' }, { signal: gone.signal, remaining_ms: 3210 }), { action: 'decline' });
  assert.deepEqual(f.events.map(e => [e.call_id, e.event, e.reason, e.remaining_ms]), [
    ['real_call', 'incoming', undefined, 4000], ['real_call', 'declined', 'muse_not_ready', undefined],
    ['hung_up', 'incoming', undefined, 3210], ['hung_up', 'declined', 'cancelled', undefined]]);
  f.cleaned = true; await f.handler.close();
  const next = fixture(); await next.handler.warm();
  assert.equal((await next.handler.prepare(next.call, { signal: new AbortController().signal, remaining_ms: 4000 })).action, 'accept');
  assert.deepEqual(next.events.map(e => e.event), ['incoming']); assert.ok(next.reports.includes('muse_bound'));
  next.cleaned = true; await next.handler.close();
});

test('a throwing log callback never changes a Muse decision', async () => {
  const f = fixture({ log: () => { throw new Error('logger broke'); } }); await f.handler.warm();
  assert.equal((await f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 })).action, 'accept');
  f.cleaned = true; await f.handler.close();
});

test('a Muse preparation that fails outright is still reported as a decline, since the connector declines the call', async () => {
  const f = fixture(); await f.handler.warm();
  const list = f.api.listParticipants;
  f.api.listParticipants = async () => { throw new Error('offline'); };
  await assert.rejects(f.handler.prepare(f.call, { signal: new AbortController().signal, remaining_ms: 4000 }), /offline/);
  assert.deepEqual(f.events.map(e => [e.event, e.reason]), [['incoming', undefined], ['declined', 'muse_not_ready']]);
  f.api.listParticipants = list; f.cleaned = true; await f.handler.close();
});
