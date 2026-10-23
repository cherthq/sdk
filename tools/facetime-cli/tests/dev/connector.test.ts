import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliHarness, SECRETS, until } from '../fixtures/cli-harness.js';
import { parseConfig, type ByorConfig } from '../../src/cli/config.js';
import { runByor } from '../../src/byor/run.js';
import { devHandler, type DispatchAPI, type DevEvent } from '../../src/dev/dispatch-handler.js';
import { ByorConnector } from '../../src/byor/connector.js';
import { ByorJournal } from '../../src/byor/journal.js';
import { ownerOf, type Incoming, type Receipt, type Scope } from '../../src/protocol/v1.js';
import { ManualClock, deferred, settle } from '../fixtures/clock.js';

const scope: Scope = { project_id: 'project', line_id: 'line', binding_id: 'binding', binding_epoch: 1,
  instance_id: 'instance', connection_generation: 1, session_mode: 'byor' };
function incoming(clock: ManualClock, id = '1'): Incoming {
  return { ...scope, v: 1, type: 'call.incoming', message_id: `message_${id}`, call_id: `call_${id}`, request_id: `request_${id}`,
    integration_revision_id: 'revision', created_at: clock.wall(), sent_at: clock.wall(), deadline_at: clock.wall() + 5000,
    prepare_deadline_at: clock.wall() + 4000, remaining_ms: 5000, resource_expires_at: clock.wall() + 600_000,
    media: { audio: true, video: true } };
}
function receipt(call: Incoming): Receipt {
  return { ...ownerOf(call), v: 1, type: 'decision.committed', message_id: `receipt_${call.call_id}`, action: 'accept',
    call_version: 1, resource_expires_at: call.resource_expires_at };
}
function recoveryFixture(prewarm: boolean) {
  // The handler mints its token with the real clock (not-before is the current whole second) and the connector
  // validates it against this frozen one. The frozen clock leads, so real time passing mid-test never makes a token premature.
  const clock = new ManualClock(); clock.time = Date.now() + 60_000;
  const rooms = new Set<string>(); const deleted: string[] = [];
  const fail = { remove: false };
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: `RM_${name}` }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_fixture', kind: 'agent' }] : []; },
    async deleteRoom(room) { deleted.push(room); if (fail.remove) throw new Error('delete failed'); rooms.delete(room); },
  };
  const handler = devHandler({ livekitUrl: 'wss://fixture.livekit.invalid', apiKey: SECRETS.LIVEKIT_API_KEY,
    apiSecret: SECRETS.LIVEKIT_API_SECRET, agentName: 'fixture-agent', api, prewarm });
  const journal = new ByorJournal(scope, { id: 'chert-dev-v1', module: '/builtin/dispatch-handler.js' });
  const connector = new ByorConnector(scope, journal, handler, clock);
  return { clock, rooms, deleted, fail, api, handler, journal, connector,
    async close() { connector.close(); journal.close(); await handler.close(); } };
}

for (const prewarm of [false, true]) {
  test(`dev recovery: repeated nonterminal reconciliation preserves the active room (prewarm=${prewarm})`, async () => {
    const f = recoveryFixture(prewarm);
    try {
      await f.handler.warm();
      const call = incoming(f.clock);
      assert.equal((await f.connector.incoming(call)).action, 'accept');
      await settle(); await f.handler.warm();
      const room = f.journal.get(call)!.session_ref!;
      const originalRooms = new Set(f.rooms);
      assert.ok(f.rooms.has(room));
      f.connector.committed(receipt(call));
      for (let n = 0; n < 3; n++) {
        f.clock.advance(250);
        await f.connector.tick(async () => ({ status: 'known', receipt: receipt(call), terminal: false }));
        const entry = f.journal.get(call)!;
        assert.equal(entry.authoritative_terminal, false);
        assert.equal(entry.cancel_requested, false);
        assert.ok(f.rooms.has(room), 'nonterminal reconciliation must preserve the active room');
        assert.deepEqual(f.rooms, originalRooms);
        assert.deepEqual(f.deleted, []);
        assert.equal(entry.settled, true);
        assert.equal(entry.cleanup, 'pending', 'an active room has not been cleaned');
        assert.equal(f.connector.debt(), 1);
      }

      // Terminal authority permits cleanup, but failed deletion must retain debt.
      f.fail.remove = true;
      await f.connector.tick(async () => ({ status: 'known', receipt: receipt(call), terminal: true }));
      assert.ok(f.rooms.has(room));
      assert.equal(f.journal.get(call)!.cleanup, 'unknown');
      assert.equal(f.connector.debt(), 1);
      assert.ok(f.deleted.every(name => name === room));
      f.fail.remove = false;
      await f.connector.tick(async () => ({ status: 'unknown' }));
      assert.equal(f.rooms.has(room), false);
      assert.equal(f.journal.get(call)!.cleanup, 'clean');
      assert.equal(f.connector.debt(), 0);
      const deletes = f.deleted.length;
      await f.connector.tick(async () => { throw new Error('offline'); });
      assert.equal(f.deleted.length, deletes, 'completed calls are not cleaned again');

      const next = incoming(f.clock, '2');
      const nextWarm = [...f.rooms][0];
      const a = f.connector.incoming(next), b = f.connector.incoming({ ...next, message_id: 'duplicate' });
      assert.deepEqual(await a, await b);
      assert.equal((await a).action, 'accept');
      await settle(); await f.handler.warm();
      const nextRoom = f.journal.get(next)!.session_ref!;
      assert.notEqual(nextRoom, room);
      if (prewarm) assert.equal(nextRoom, nextWarm, 'the next call uses the untouched replacement warm room');
      await f.connector.tick(async () => ({ status: 'known', receipt: receipt(next), terminal: false }));
      assert.ok(f.rooms.has(nextRoom));
      assert.equal(f.deleted.length, deletes);
      await f.connector.tick(async () => ({ status: 'known', receipt: receipt(next), terminal: true }));
      assert.equal(f.connector.debt(), 0);
      assert.equal(f.rooms.has(nextRoom), false);
    } finally { await f.close(); }
  });

  test(`dev recovery: uncertain acceptance and failed reads preserve the room until expiry (prewarm=${prewarm})`, async () => {
    const f = recoveryFixture(prewarm);
    try {
      await f.handler.warm();
      const call = incoming(f.clock);
      assert.equal((await f.connector.incoming(call)).action, 'accept');
      await settle(); await f.handler.warm();
      const originalRooms = new Set(f.rooms);
      const room = f.journal.get(call)!.session_ref!;
      for (const status of ['unknown', 'not_found', 'forbidden', 'failed'] as const) {
        await f.connector.tick(async () => { if (status === 'failed') throw new Error('offline'); return { status }; });
        assert.deepEqual(f.rooms, originalRooms);
        assert.deepEqual(f.deleted, []);
        const entry = f.journal.get(call)!;
        assert.equal(entry.acceptance, 'unknown');
        assert.equal(entry.authoritative_terminal, false);
        assert.equal(entry.cancel_requested, false);
        assert.equal(entry.cleanup, 'pending');
      }
      // Expiry uses the accepted session's actual bound, not a failed authority read.
      f.clock.advance(f.journal.get(call)!.session_expires_at! - f.clock.wall());
      await f.connector.tick(async () => { throw new Error('offline'); });
      assert.equal(f.rooms.has(room), false);
      assert.equal(f.journal.get(call)!.cancel_requested, true);
      assert.equal(f.journal.get(call)!.authoritative_terminal, false);
      assert.equal(f.journal.get(call)!.cleanup, 'clean');
      assert.equal(f.connector.debt(), 1, 'cleanup cannot invent authoritative termination');
      assert.ok(f.deleted.every(name => name === room));
      await f.connector.tick(async () => ({ status: 'known', receipt: receipt(call), terminal: true }));
      assert.equal(f.connector.debt(), 0);
    } finally { await f.close(); }
  });

  test(`dev recovery: reconciliation during preparation does not pin the wrong room (prewarm=${prewarm})`, async () => {
    const f = recoveryFixture(prewarm);
    const release = deferred(); const prepared = deferred();
    const prepare = f.handler.prepare.bind(f.handler);
    f.handler.prepare = async (call, context) => {
      const decision = await prepare(call, context);
      prepared.resolve(); await release.promise;
      return decision;
    };
    try {
      await f.handler.warm();
      const call = incoming(f.clock);
      const pending = f.connector.incoming(call);
      await prepared.promise;
      const originalRooms = new Set(f.rooms);
      await f.connector.tick(async () => ({ status: 'unknown' }));
      assert.deepEqual(f.rooms, originalRooms);
      assert.deepEqual(f.deleted, []);
      assert.equal(f.journal.get(call)!.session_ref, undefined);
      assert.equal(f.journal.get(call)!.settled, false);
      assert.equal(f.journal.get(call)!.cleanup, 'unknown');
      release.resolve();
      assert.equal((await pending).action, 'accept');
      await settle();
      const room = f.journal.get(call)!.session_ref!;
      assert.ok(originalRooms.has(room));
      if (prewarm) assert.match(room, /^chert-warm-/);
      await f.connector.tick(async () => ({ status: 'known', receipt: receipt(call), terminal: false }));
      assert.ok(f.rooms.has(room));
      assert.ok(!f.connector.diagnostics.includes('request_conflict'));
    } finally { release.resolve(); await f.close(); }
  });

  test(`dev recovery: cancelled late preparation retains debt and cleans its actual room (prewarm=${prewarm})`, async () => {
    const f = recoveryFixture(prewarm);
    const release = deferred(); const prepared = deferred<string>();
    const prepare = f.handler.prepare.bind(f.handler);
    f.handler.prepare = async (call, context) => {
      const decision = await prepare(call, context);
      assert.equal(decision.action, 'accept');
      if (decision.action === 'accept') prepared.resolve(decision.session_ref);
      await release.promise;
      return decision;
    };
    try {
      await f.handler.warm();
      const call = incoming(f.clock);
      const pending = f.connector.incoming(call);
      const room = await prepared.promise;
      await f.handler.warm();
      f.clock.advance(4000);
      assert.equal((await pending).action, 'decline');
      await f.connector.tick(async () => ({ status: 'unknown' }));
      assert.equal(f.journal.get(call)!.cancel_requested, true);
      assert.equal(f.journal.get(call)!.settled, false);
      assert.equal(f.journal.get(call)!.cleanup, 'unknown');
      assert.equal(f.connector.debt(), 1);
      release.resolve(); await settle();
      assert.equal(f.journal.get(call)!.session_ref, room);
      await f.connector.tick(async () => ({ status: 'known', receipt: { ...receipt(call), action: 'decline' }, terminal: true }));
      assert.equal(f.connector.debt(), 0);
      assert.equal(f.rooms.has(room), false);
      assert.equal(f.rooms.size, prewarm ? 1 : 0, 'only the unused warm room survives cleanup');
    } finally { release.resolve(); await f.close(); }
  });

  test(`dev recovery: a wall-clock second passing between the fixture and the accept does not invalidate the token (prewarm=${prewarm})`, async t => {
    const second = Math.ceil(Date.now() / 1000) * 1000;
    t.mock.timers.enable({ apis: ['Date'], now: second - 1 });
    const f = recoveryFixture(prewarm);
    try {
      await f.handler.warm();
      t.mock.timers.setTime(second);
      const decision = await f.connector.incoming(incoming(f.clock));
      assert.equal(decision.action, 'accept', JSON.stringify(decision));
    } finally { await f.close(); }
  });
}

test('dev: a call delivered through the connector is accepted by the built-in handler with the agent identity', { timeout: 30000 }, async () => {
  const h = await cliHarness('byor');
  const controller = new AbortController();
  const rooms = new Set<string>(); const events: DevEvent['event'][] = [];
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: 'RM_fixture' }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_fixture', kind: 'agent' }] : []; },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const development = JSON.parse(readFileSync(h.devPath, 'utf8')); delete development.livekit_api_origin;
  const config = parseConfig({ schema_version: 2, mode: 'byor', state_dir: join(h.directory, 'dev-state'),
    handler: { id: 'chert-dev-v1', module: '/builtin/dispatch-handler.js' }, transport: development }) as ByorConfig;
  const env = { CHERT_CONNECTOR_TOKEN: SECRETS.CHERT_CONNECTOR_TOKEN, CHERT_RECOVERY_TOKEN: SECRETS.CHERT_RECOVERY_TOKEN };
  const observed: string[] = [];
  const handler = devHandler({ livekitUrl: 'wss://fixture.livekit.invalid', apiKey: SECRETS.LIVEKIT_API_KEY, apiSecret: SECRETS.LIVEKIT_API_SECRET,
    agentName: 'fixture-agent', api, pollMs: 5, log: event => events.push(event.event) });
  let recoveries = 0;
  const recover = handler.recover!.bind(handler);
  handler.recover = async (call, context) => { const proof = await recover(call, context); recoveries++; return proof; };
  const running = runByor(config, env, controller.signal, record => observed.push(String(record.code)), false, handler);
  try {
    await until(() => observed.includes('runtime_observation'));
    const { decision } = await h.incoming();
    assert.equal(decision.action, 'accept', JSON.stringify(decision));
    if (decision.action !== 'accept') return;
    assert.equal(decision.remote_participant_identity, 'agent-AJ_fixture');
    assert.equal(decision.livekit_url, 'wss://fixture.livekit.invalid');
    assert.ok(!JSON.stringify(decision).includes(SECRETS.LIVEKIT_API_SECRET));
    await until(() => recoveries >= 3);
    assert.equal(rooms.size, 1);
    assert.deepEqual(events, ['incoming', 'accepted']);
  } finally { controller.abort(); await running.catch(() => {}); await h.close(); }
});

test('dev: a decline the connector makes before preparation reaches the output as a decision record', { timeout: 30000 }, async () => {
  const h = await cliHarness('byor');
  const controller = new AbortController();
  const rooms = new Set<string>(); const events: DevEvent['event'][] = [];
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: 'RM_fixture' }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_fixture', kind: 'agent' }] : []; },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const development = JSON.parse(readFileSync(h.devPath, 'utf8')); delete development.livekit_api_origin;
  const config = parseConfig({ schema_version: 2, mode: 'byor', state_dir: join(h.directory, 'dev-state-decline'),
    handler: { id: 'chert-dev-v1', module: '/builtin/dispatch-handler.js' }, transport: development }) as ByorConfig;
  const env = { CHERT_CONNECTOR_TOKEN: SECRETS.CHERT_CONNECTOR_TOKEN, CHERT_RECOVERY_TOKEN: SECRETS.CHERT_RECOVERY_TOKEN };
  const records: Record<string, unknown>[] = [];
  const handler = devHandler({ livekitUrl: 'wss://fixture.livekit.invalid', apiKey: SECRETS.LIVEKIT_API_KEY, apiSecret: SECRETS.LIVEKIT_API_SECRET,
    agentName: 'fixture-agent', api, pollMs: 5, log: event => events.push(event.event) });
  // The application reports itself unavailable, so the connector declines at its gate without calling prepare.
  handler.health = async () => 'unavailable';
  const running = runByor(config, env, controller.signal, record => records.push(record), false, handler);
  try {
    await until(() => records.some(r => r.code === 'runtime_observation'));
    const { request, decision } = await h.incoming();
    assert.equal(decision.action, 'decline');
    assert.equal(decision.action === 'decline' && decision.reason, 'agent_unavailable');
    await until(() => records.some(r => r.code === 'call_decision'));
    const record = records.find(r => r.code === 'call_decision')!;
    assert.equal(record.call_id, request.call_id); assert.equal(record.action, 'decline'); assert.equal(record.reason, 'agent_unavailable');
    assert.ok(!JSON.stringify(record).includes('participant_token'));
    assert.deepEqual(events, [], 'the handler was never asked to prepare');
  } finally { controller.abort(); await running.catch(() => {}); await h.close(); }
});
