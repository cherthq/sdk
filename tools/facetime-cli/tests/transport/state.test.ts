import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, healthy, TOKEN, RECOVERY } from '../fixtures/rig.js';
import { deferred, settle } from '../fixtures/clock.js';
import { Fault, digest } from '../../src/protocol/v1.js';

for (const [name, patch, code] of [
  ['unknown', { capacity: null }, 'agent_availability_unknown'],
  ['unavailable', { connected: false }, 'agent_unavailable'],
  ['full', { capacity: 0 }, 'agent_capacity_exhausted'],
  ['draining', { draining: true }, 'agent_draining'],
] as const) test(`idle ${name} health allocates nothing`, async () => {
  const r = rig(); healthy(r, patch);
  assert.equal(r.connector.check(), code);
  assert.equal((await r.connector.incoming(r.request())).action, 'decline');
  assert.deepEqual(r.agent.counts, { rooms: 0, jobs: 0, providers: 0, deleted: 0 });
});
test('fast available agent prepares once and only receipt settles acceptance', async () => {
  const r = rig(); const incoming = r.request();
  const decision = await r.connector.incoming(incoming);
  assert.equal(decision.action, 'accept');
  assert.equal(r.journal.get(incoming)?.state, 'decision_sent');
  assert.equal(r.agent.counts.rooms, 1); assert.equal(r.agent.counts.jobs, 1);
  const receipt = await r.authority.commit(TOKEN, decision);
  r.connector.committed(receipt);
  assert.equal(r.journal.get(incoming)?.state, 'accepted');
  assert.equal(r.authority.commitCount, 1); assert.equal(r.agent.resources.size, 1);
});
test('duplicates share preparation and semantic conflicts cannot allocate', async () => {
  const r = rig(); const hold = deferred(); r.agent.beforeReady = () => hold.promise;
  const incoming = r.request(); const first = r.connector.incoming(incoming);
  await settle();
  const duplicate = { ...incoming, message_id: 'retry', remaining_ms: 4900 };
  assert.equal(digest(incoming), digest(duplicate));
  const second = r.connector.incoming(duplicate);
  await assert.rejects(r.connector.incoming({ ...incoming, resource_expires_at: incoming.resource_expires_at + 1 }), /request_conflict/);
  hold.resolve(); assert.deepEqual(await first, await second);
  assert.equal(r.agent.counts.jobs, 1);
});
test('uncancellable late allocation after preparation timeout is deleted exactly', async () => {
  const r = rig(); const hold = deferred(); r.agent.beforeCreate = () => hold.promise;
  const incoming = r.request(); const response = r.connector.incoming(incoming);
  await settle(); r.clock.advance(4000); await settle();
  assert.equal((await response).action, 'decline');
  assert.equal(r.journal.get(incoming)?.terminal, true);
  hold.resolve(); await settle(); await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 0); assert.equal(r.agent.counts.deleted, 1);
});
test('commit rechecks clock and revocation after waiting on serialized lock', async () => {
  const r = rig(); const decision = await r.connector.incoming(r.request());
  const hold = deferred(); r.authority.beforeCommit = () => hold.promise;
  const pending = r.authority.commit(TOKEN, decision); await settle();
  r.clock.advance(5000, -1000); hold.resolve();
  await assert.rejects(pending, /deadline_exceeded/); assert.equal(r.authority.commitCount, 0);
  const s = rig(); const accept = await s.connector.incoming(s.request());
  const gate = deferred(); s.authority.beforeCommit = () => gate.promise;
  const revoked = s.authority.commit(TOKEN, accept); await settle();
  s.authority.revoke(TOKEN); gate.resolve(); await assert.rejects(revoked, /forbidden/);
});
test('concurrent identical replies commit one decision', async () => {
  const r = rig(); const response = await r.connector.incoming(r.request());
  const results = await Promise.all([r.authority.commit(TOKEN, response), r.authority.commit(TOKEN, response)]);
  assert.deepEqual(results[0], results[1]); assert.equal(r.authority.commitCount, 1);
});
for (const field of ['project_id', 'line_id', 'binding_id', 'binding_epoch', 'instance_id', 'connection_generation', 'call_id', 'request_id'] as const) {
  test(`fence ${field} before disclosure or commit`, async () => {
    const r = rig(); const incoming = r.request();
    const response = await r.connector.incoming(incoming);
    const forged = { ...response, [field]: typeof response[field] === 'number' ? 999 : 'foreign' };
    await assert.rejects(r.authority.commit(TOKEN, forged), /forbidden|stale_generation/);
    assert.equal(r.authority.commitCount, 0);
  });
}
for (const field of ['participant', 'job', 'nonce', 'room', 'publishers'] as const) test(`readiness rejects mismatched ${field}`, async () => {
  const r = rig(); r.agent.readinessPatch = { [field]: field === 'publishers' ? ['other', 'second'] : 'wrong' };
  assert.equal((await r.connector.incoming(r.request())).action, 'decline');
  await r.connector.flushCleanup(); assert.equal(r.agent.resources.size, 0);
});
test('lost receipt and unavailable reconciliation preserve uncertain media', async () => {
  const r = rig(); const incoming = r.request(); const response = await r.connector.incoming(incoming);
  await r.authority.commit(TOKEN, response); r.connector.disconnect(); r.clock.advance(6000);
  for (const status of ['unknown', 'forbidden', 'not_found'] as const) {
    await r.connector.reconcile(async () => ({ status }));
    assert.equal(r.agent.resources.size, 1); assert.equal(r.journal.get(incoming)?.state, 'decision_sent');
  }
  await r.connector.reconcile(async () => { throw new Fault('transport_failure'); });
  assert.equal(r.agent.resources.size, 1);
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.journal.get(incoming)?.state, 'accepted'); assert.equal(r.agent.counts.jobs, 1);
});
test('terminal cancellation aborts readiness, late completion cannot resurrect', async () => {
  const r = rig(); const gate = deferred(); r.agent.beforeReady = () => gate.promise;
  const incoming = r.request(); const pending = r.connector.incoming(incoming); await settle();
  r.connector.cancel(r.authority.cancel(TOKEN, incoming));
  assert.equal((await pending).action, 'decline');
  gate.resolve(); await settle(); await r.connector.flushCleanup();
  assert.equal(r.agent.resources.size, 0);
  assert.equal((await r.connector.incoming(incoming)).action, 'decline');
  assert.equal(r.agent.counts.jobs, 1);
});
for (const field of ['project_id', 'line_id', 'binding_id', 'binding_epoch', 'instance_id', 'connection_generation'] as const) {
  test(`incoming ${field} injection has zero allocation effects`, async () => {
    const r = rig(); const incoming = r.request();
    const forged = { ...incoming, [field]: typeof incoming[field] === 'number' ? 999 : 'foreign' };
    await assert.rejects(r.connector.incoming(forged), /forbidden|stale_generation/);
    assert.deepEqual(r.agent.counts, { rooms: 0, jobs: 0, providers: 0, deleted: 0 });
  });
}
test('immutable deadlines remain conflicting even with fresh transport metadata', async () => {
  const r = rig(); const incoming = r.request(); await r.connector.incoming(incoming);
  await assert.rejects(r.connector.incoming({ ...incoming, message_id: 'retry', deadline_at: incoming.deadline_at + 1 }), /request_conflict/);
  assert.equal(r.agent.counts.jobs, 1);
});

test('authoritative decline for a non-allocating health rejection records a tombstone without disconnecting', async () => {
  const r = rig(); healthy(r, { connected: false });
  const incoming = r.request(); const decision = await r.connector.incoming(incoming);
  const receipt = await r.authority.commit(TOKEN, decision);
  assert.doesNotThrow(() => r.connector.committed(receipt));
  assert.equal(r.connector.debt(), 0);
  assert.equal(r.agent.counts.rooms, 0);
  assert.equal((await r.connector.incoming(incoming)).action, 'decline');
  assert.throws(() => r.connector.committed({ ...receipt, project_id: 'foreign' }), /forbidden/);
});
