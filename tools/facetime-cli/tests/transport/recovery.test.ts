import test from 'node:test';
import assert from 'node:assert/strict';
import { Connector } from '../../src/runtime/connector.js';
import { Fault } from '../../src/protocol/v1.js';
import { rig, healthy, HEALTH, TOKEN, RECOVERY } from '../fixtures/rig.js';
import { deferred, settle } from '../fixtures/clock.js';

async function accepted() {
  const r = rig(); const incoming = r.request(); const decision = await r.connector.incoming(incoming);
  const receipt = await r.authority.commit(TOKEN, decision); r.connector.committed(receipt);
  return { ...r, incoming, decision, receipt };
}
test('health stale/replay/mismatch and unauthenticated signals never refresh admission', async () => {
  const r = rig(); r.clock.advance(5000);
  assert.equal(r.connector.check(), 'agent_availability_stale');
  assert.equal((await r.connector.incoming(r.request())).action, 'decline');
  const observation = healthy(r); assert.equal(r.connector.check(), 'available');
  assert.throws(() => r.availability.observe(HEALTH, observation), /health_replay/);
  assert.equal(r.connector.check(), 'agent_availability_stale');
  for (const patch of [{ project: 'wrong' }, { name: 'wrong' }, { deployment: 'wrong' }]) {
    assert.throws(() => healthy(r, patch), /forbidden/);
    assert.equal(r.connector.check(), 'agent_availability_unknown');
  }
  healthy(r);
  assert.throws(() => r.availability.observe('bad_credential', observation), /forbidden/);
  assert.equal(r.connector.check(), 'agent_availability_unknown');
  assert.deepEqual(r.agent.counts, { rooms: 0, jobs: 0, providers: 0, deleted: 0 });
});
test('availability recovery respects activation and local standby cannot replace production', async () => {
  const r = rig(); r.connector.role = 'standby'; healthy(r);
  assert.equal((await r.connector.incoming(r.request())).action, 'decline');
  const standby = { ...r.scope, binding_id: 'standby', instance_id: 'local', binding_epoch: 2, connection_generation: 0 };
  r.authority.enroll('standby_token', standby); r.authority.connect('standby_token');
  assert.throws(() => r.authority.register('standby_token'), /binding_conflict/);
  assert.throws(() => r.authority.activate('standby_token', 0), /binding_conflict/);
  assert.throws(() => r.authority.activate('standby_token', 1), /binding_conflict/);
  assert.equal(r.authority.role(r.scope), 'active'); assert.equal(r.agent.counts.rooms, 0);
});
test('deadline transit and retry cannot prepare past the original boundary', async () => {
  const r = rig(); const incoming = r.request(); r.clock.advance(4000);
  const response = await r.connector.incoming({ ...incoming, message_id: 'retry', sent_at: r.clock.wall(), remaining_ms: 1000 });
  assert.equal(response.action, 'decline'); if (response.action === 'decline') assert.equal(response.reason, 'deadline_exceeded');
  assert.equal(r.agent.counts.rooms, 0);
  const s = await accepted(); s.clock.advance(5000);
  // A committed decision may be read idempotently after expiry; a new acceptance may not.
  assert.equal((await s.authority.commit(TOKEN, s.decision)).action, 'accept');
  const fresh = rig(); const decision = await fresh.connector.incoming(fresh.request()); fresh.clock.advance(5000);
  await assert.rejects(fresh.authority.commit(TOKEN, decision), /deadline_exceeded/);
});
test('reconnect rejects old generation without dispatching or resending acceptance', async () => {
  const r = rig(); const incoming = r.request(); const response = await r.connector.incoming(incoming);
  const next = r.authority.connect(TOKEN); r.connector.reconnect(next, 'active');
  await assert.rejects(r.authority.commit(TOKEN, response), /stale_generation/);
  await assert.rejects(r.connector.incoming(incoming), /stale_generation/);
  const duplicate = await r.connector.incoming({ ...incoming, connection_generation: next.connection_generation });
  assert.equal(duplicate.action, 'decline');
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.agent.resources.size, 0); assert.equal(r.agent.counts.jobs, 1);
});
test('accepted calls survive relay loss, stale health and revocation, recovery scope is read-only', async () => {
  const r = await accepted(); r.connector.disconnect(); r.clock.advance(6000); r.authority.revoke(TOKEN);
  await assert.rejects(r.authority.commit(TOKEN, r.decision), /forbidden/);
  assert.throws(() => r.authority.connect(RECOVERY), /forbidden/);
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.agent.resources.size, 1); assert.equal(r.journal.get(r.incoming)?.state, 'accepted');
});
test('ambiguous create never retries and unknown management retains debt', async () => {
  const r = rig(); r.agent.ambiguous = true; r.agent.inspectionUnknown = true;
  const incoming = r.request(); assert.equal((await r.connector.incoming(incoming)).action, 'decline');
  await r.connector.flushCleanup(); assert.equal(r.journal.get(incoming)?.cleanup_debt, true);
  assert.equal(r.connector.check(), 'cleanup_pending'); assert.equal(r.agent.resources.size, 1);
  await r.connector.incoming(incoming); assert.equal(r.agent.counts.jobs, 1);
  r.agent.inspectionUnknown = false; await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 0); assert.equal(r.journal.get(incoming)?.cleanup_debt, false);
});
test('cleanup debt survives deletion failure and exact marker protects unrelated objects', async () => {
  const r = await accepted(); r.agent.deleteFails = true;
  const event = r.authority.lifecycle(RECOVERY, r.incoming, 'ended'); const ack = r.connector.lifecycle(event); r.authority.acknowledge(TOKEN, ack);
  await r.connector.flushCleanup(); assert.equal(r.authority.acks.size, 1);
  assert.equal(r.journal.get(r.incoming)?.cleanup_debt, true); assert.equal(r.agent.resources.size, 1);
  const entry = r.journal.get(r.incoming)!;
  r.agent.resources.set('unrelated_room', { entry: { ...entry, room: 'unrelated_room', marker: 'foreign' }, job: true, expiresMono: Infinity });
  r.agent.deleteFails = false; await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 1); assert.ok(r.agent.resources.has('unrelated_room'));
  assert.equal(r.journal.get(r.incoming)?.cleanup_debt, false);
  const s = await accepted(); const own = s.journal.get(s.incoming)!;
  s.agent.resources.get(own.room)!.entry.marker = 'foreign';
  s.connector.lifecycle(s.authority.lifecycle(RECOVERY, s.incoming, 'ended')); await s.connector.flushCleanup();
  assert.equal(s.agent.resources.size, 1); assert.equal(s.journal.get(s.incoming)?.cleanup_debt, true);
});
test('lifecycle duplicates, cursor gaps and delayed starts cannot resurrect terminal work', async () => {
  const r = await accepted();
  const started = r.authority.lifecycle(RECOVERY, r.incoming, 'started');
  const ended = r.authority.lifecycle(RECOVERY, r.incoming, 'ended');
  r.connector.lifecycle(ended); assert.equal(r.journal.snapshot().cursor, 0);
  r.connector.lifecycle(started); r.connector.lifecycle(ended); await r.connector.flushCleanup();
  assert.equal(r.journal.snapshot().cursor, 2); assert.equal(r.journal.get(r.incoming)?.terminal, true);
  assert.equal((await r.connector.incoming(r.incoming)).action, 'decline');
  assert.equal(r.agent.counts.deleted, 1); assert.equal(r.agent.counts.jobs, 1);
});
test('initial bridge absence is harmless, verified departure after presence cleans exact resources', async () => {
  const r = await accepted(); const identity = `bridge_${r.incoming.request_id}`;
  r.connector.bridge(r.incoming, identity, 'absent'); await r.connector.flushCleanup(); assert.equal(r.agent.resources.size, 1);
  assert.throws(() => r.connector.bridge(r.incoming, 'wrong', 'present'), /forbidden/);
  r.connector.bridge(r.incoming, identity, 'present'); r.connector.bridge(r.incoming, identity, 'absent');
  r.clock.advance(300); r.connector.bridge(r.incoming, identity, 'unknown');
  r.connector.bridge(r.incoming, identity, 'absent'); await r.connector.flushCleanup(); assert.equal(r.agent.resources.size, 1);
  r.clock.advance(250); r.connector.bridge(r.incoming, identity, 'absent'); await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 0); assert.equal(r.journal.get(r.incoming)?.reconcile_debt, true);
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.journal.get(r.incoming)?.reconcile_debt, true);
});
test('independent hard expiry and connector expiry preserve debt during authority outage', async () => {
  const r = await accepted(); r.clock.advance(60_000, -1000);
  assert.equal(r.agent.resources.size, 0); // Agent's own monotonic expiry, before connector tick.
  await r.connector.tick(async () => { throw new Fault('transport_failure'); });
  assert.equal(r.journal.get(r.incoming)?.terminal, true); assert.equal(r.journal.get(r.incoming)?.reconcile_debt, true);
  const s = await accepted(); s.agent.close(); // Disable agent timers: connector independently enforces expiry.
  s.clock.advance(60_000); await s.connector.tick(async () => ({ status: 'unknown' }));
  assert.equal(s.agent.resources.size, 0); assert.equal(s.journal.get(s.incoming)?.reconcile_debt, true);
});
test('periodic reconciliation recovers a missing terminal event', async () => {
  const r = await accepted(); r.authority.lifecycle(RECOVERY, r.incoming, 'ended');
  r.connector.startPeriodic(owner => r.authority.reconcile(RECOVERY, owner));
  r.clock.advance(1000); await settle(); await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 0); r.connector.close();
});
test('drain holds old ownership until both active calls and cleanup debt reach zero', async () => {
  const r = await accepted(); r.connector.drain(); r.authority.drain(TOKEN);
  assert.throws(() => r.authority.register(TOKEN), /binding_conflict/);
  assert.throws(() => r.authority.finishDrain(TOKEN, r.connector.debt()), /binding_conflict/);
  r.agent.deleteFails = true; r.connector.lifecycle(r.authority.lifecycle(RECOVERY, r.incoming, 'ended')); await r.connector.flushCleanup();
  assert.throws(() => r.authority.finishDrain(TOKEN, r.connector.debt()), /binding_conflict/);
  r.agent.deleteFails = false; await r.connector.flushCleanup(); assert.equal(r.connector.debt(), 0);
  r.authority.finishDrain(TOKEN, 0);
  const next = { ...r.scope, binding_id: 'replacement', instance_id: 'next', binding_epoch: 2 };
  r.authority.enroll('replacement_token', next);
  assert.throws(() => r.authority.activate('replacement_token', 0), /binding_conflict/);
  r.authority.activate('replacement_token', 1);
  assert.equal(r.authority.register('replacement_token').binding_id, 'replacement');
  assert.equal(r.incoming.binding_id, r.scope.binding_id);
});
test('decline response is not held hostage by slow deletion', async () => {
  const r = rig(); const blocked = deferred(); r.agent.beforeDelete = () => blocked.promise;
  r.agent.readinessPatch = { prepared: false };
  const incoming = r.request(); const response = await r.connector.incoming(incoming);
  assert.equal(response.action, 'decline'); assert.equal(r.journal.get(incoming)?.cleanup_debt, true);
  blocked.resolve(); await r.connector.flushCleanup(); assert.equal(r.agent.resources.size, 0);
});
test('reopened connector never treats in-flight external create absence as settled deletion', async () => {
  const r = rig(); const blocked = deferred(); r.agent.beforeCreate = () => blocked.promise;
  const incoming = r.request(); const pending = r.connector.incoming(incoming); await settle();
  // A new runtime has the durable intent but not the original promise.
  const recovered = new Connector(r.scope, r.journal, r.agent, r.availability, r.clock);
  r.authority.cancel(TOKEN, incoming);
  await recovered.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.journal.get(incoming)?.cleanup_debt, true);
  blocked.resolve(); await pending; await settle(); await recovered.flushCleanup();
  assert.equal(r.agent.resources.size, 0); assert.equal(r.agent.counts.rooms, 1);
});
test('failed intent persistence allocates nothing; failed fake commit cannot report acceptance', async () => {
  const r = rig(); r.journal.healthy = false;
  assert.equal((await r.connector.incoming(r.request())).action, 'decline'); assert.equal(r.agent.counts.rooms, 0);
  const s = rig(); const decision = await s.connector.incoming(s.request());
  s.authority.persistReceipt = () => { throw new Error('SYNTHETIC_STORAGE_ERROR_SECRET'); };
  await assert.rejects(s.authority.commit(TOKEN, decision)); assert.equal(s.authority.commitCount, 0);
  assert.equal(s.agent.resources.size, 1); assert.equal(s.journal.get(decision)?.state, 'decision_sent');
});
test('create collision never adopts or overwrites a foreign resource', async () => {
  const r = rig(); const release = deferred(); r.agent.beforeCreate = () => release.promise;
  const incoming = r.request(); const pending = r.connector.incoming(incoming); await settle();
  const entry = r.journal.get(incoming)!;
  r.agent.resources.set(entry.room, { entry: { ...entry, marker: 'foreign' }, job: true, expiresMono: Infinity });
  release.resolve(); assert.equal((await pending).action, 'decline'); await r.connector.flushCleanup();
  assert.equal(r.agent.resources.get(entry.room)?.entry.marker, 'foreign');
  assert.equal(r.agent.counts.rooms, 0); assert.equal(r.agent.counts.deleted, 0);
  assert.equal(r.journal.get(incoming)?.cleanup_debt, true);
});
test('terminal cancellation delivered before incoming persists a no-allocation tombstone', async () => {
  const r = rig(); const incoming = r.request();
  r.connector.cancel(r.authority.cancel(TOKEN, incoming));
  const recovered = new Connector(r.scope, r.journal, r.agent, r.availability, r.clock);
  const response = await recovered.incoming(incoming);
  assert.equal(response.action, 'decline'); assert.equal(r.agent.counts.rooms, 0);
});
test('terminal lifecycle before incoming is acknowledged durably and prevents late preparation', async () => {
  const r = rig(); const incoming = r.request();
  const event = r.authority.lifecycle(RECOVERY, incoming, 'ended');
  const ack = r.connector.lifecycle(event); r.authority.acknowledge(TOKEN, ack);
  assert.equal(r.journal.snapshot().cursor, event.cursor);
  assert.equal((await r.connector.incoming(incoming)).action, 'decline'); assert.equal(r.agent.counts.jobs, 0);
});
