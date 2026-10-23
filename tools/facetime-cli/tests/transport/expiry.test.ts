import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connector } from '../../src/runtime/connector.js';
import { FileJournal } from '../../src/runtime/journal.js';
import type { Reconciliation } from '../../src/runtime/reconciliation.js';
import { Fault, ownerOf } from '../../src/protocol/v1.js';
import { rig, healthy, TOKEN, RECOVERY } from '../fixtures/rig.js';
import { deferred, settle } from '../fixtures/clock.js';

async function accepted() {
  const r = rig(); const incoming = r.request();
  const decision = await r.connector.incoming(incoming);
  r.connector.committed(await r.authority.commit(TOKEN, decision));
  return { ...r, incoming };
}
for (const clock of ['wall', 'monotonic'] as const) {
  for (const outage of ['throw', 'unknown', 'forbidden', 'not_found'] as const) {
    test(`completed terminal call stays debt-free at ${clock} expiry during ${outage} reconciliation`, async () => {
      const r = await accepted();
      r.connector.lifecycle(r.authority.lifecycle(RECOVERY, r.incoming, 'ended'));
      await r.connector.settleLocalWork();
      const completed = r.journal.snapshot(); assert.equal(r.connector.debt(), 0);
      let reads = 0, inspections = 0;
      r.agent.inspect = async () => { inspections++; return 'unknown'; };
      const read = async (): Promise<Reconciliation> => {
        reads++; if (outage === 'throw') throw new Fault('transport_failure');
        return { status: outage };
      };
      r.clock.advance(clock === 'wall' ? 0 : 60_000, clock === 'wall' ? 60_000 : -1000);
      healthy(r);
      await r.connector.tick(read); await r.connector.tick(read);
      assert.deepEqual(r.journal.snapshot(), completed);
      assert.equal(r.connector.debt(), 0); assert.equal(r.connector.check(), 'available');
      assert.equal(reads, 0); assert.equal(inspections, 0); assert.equal(r.agent.counts.deleted, 1);
      assert.equal(r.agent.counts.rooms, 1);
    });
  }
}
test('completed terminal journal reopens after expiry without writes or dependency on authority/management', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'chert-expiry-'));
  const r = rig(); const path = join(directory, 'journal.json');
  const first = new FileJournal(path, r.scope);
  const connector = new Connector(r.scope, first, r.agent, r.availability, r.clock);
  t.after(() => { connector.close(); first.close(); r.agent.close(); rmSync(directory, { recursive: true, force: true }); });
  const incoming = r.request(); const decision = await connector.incoming(incoming);
  connector.committed(await r.authority.commit(TOKEN, decision));
  connector.lifecycle(r.authority.lifecycle(RECOVERY, incoming, 'ended'));
  await connector.settleLocalWork(); const completed = readFileSync(path, 'utf8');
  connector.close(); first.close(); r.clock.advance(60_000); healthy(r);
  const reopened = new FileJournal(path, r.scope);
  const next = new Connector(r.scope, reopened, r.agent, r.availability, r.clock);
  try {
    r.agent.inspect = async () => { throw new Error('management_unavailable'); };
    let reads = 0;
    await next.tick(async () => { reads++; throw new Fault('transport_failure'); });
    assert.equal(readFileSync(path, 'utf8'), completed);
    assert.equal(next.debt(), 0); assert.equal(next.check(), 'available'); assert.equal(reads, 0);
  } finally { next.close(); reopened.close(); }
});
test('authoritative decline with verified cleanup also stays complete after expiry', async () => {
  const r = rig(); const incoming = r.request(); await r.connector.incoming(incoming);
  const receipt = await r.authority.commit(TOKEN, { ...ownerOf(incoming), v: 1, message_id: 'decline', type: 'call.decision', action: 'decline', reason: 'terminal' });
  r.connector.committed(receipt); await r.connector.settleLocalWork();
  assert.equal(r.journal.get(incoming)?.state, 'declined');
  const completed = r.journal.snapshot(); r.clock.advance(60_000);
  await r.connector.tick(async () => { throw new Fault('transport_failure'); });
  assert.deepEqual(r.journal.snapshot(), completed); assert.equal(r.connector.debt(), 0);
});
for (const state of ['accepted', 'uncertain', 'local_departure'] as const) {
  test(`${state} still reconciles and retains debt across failed expiry reconciliation`, async () => {
    const r = rig(); const incoming = r.request(); const decision = await r.connector.incoming(incoming);
    if (state !== 'uncertain') r.connector.committed(await r.authority.commit(TOKEN, decision));
    if (state === 'local_departure') {
      const identity = `bridge_${incoming.request_id}`;
      r.connector.bridge(incoming, identity, 'present'); r.connector.bridge(incoming, identity, 'absent');
      r.clock.advance(250); r.connector.bridge(incoming, identity, 'absent'); await r.connector.flushCleanup();
      assert.equal(r.journal.get(incoming)?.terminal, true); assert.equal(r.journal.get(incoming)?.cleanup_debt, false);
    }
    let reads = 0;
    await r.connector.tick(async () => { reads++; return { status: 'unknown' }; });
    assert.equal(reads, 1); assert.equal(r.connector.debt(), 1);
    r.agent.close(); r.clock.advance(60_000);
    await r.connector.tick(async () => { reads++; throw new Fault('transport_failure'); });
    assert.equal(reads, 2); assert.equal(r.agent.resources.size, 0);
    assert.equal(r.journal.get(incoming)?.reconcile_debt, true); assert.equal(r.connector.check(), 'cleanup_pending');
    // Only a subsequent authoritative terminal result settles this debt.
    r.authority.lifecycle(RECOVERY, incoming, 'ended');
    await r.connector.tick(owner => r.authority.reconcile(RECOVERY, owner));
    assert.equal(r.connector.debt(), 0);
    await r.connector.tick(async () => { throw new Fault('transport_failure'); });
    assert.equal(r.connector.debt(), 0); assert.equal(r.agent.counts.rooms, 1);
  });
}
test('terminal but unsettled creation retains debt and reconciliation through expiry', async () => {
  const r = rig(); const blocked = deferred(); r.agent.beforeCreate = () => blocked.promise;
  const incoming = r.request(); const preparing = r.connector.incoming(incoming); await settle();
  r.connector.cancel(r.authority.cancel(TOKEN, incoming)); await preparing; await r.connector.flushCleanup();
  assert.equal(r.journal.get(incoming)?.create_pending, true);
  r.clock.advance(60_000); let reads = 0;
  await r.connector.tick(async () => { reads++; return { status: 'unknown' }; });
  assert.equal(reads, 1); assert.equal(r.journal.get(incoming)?.create_pending, true);
  assert.equal(r.journal.get(incoming)?.cleanup_debt, true); assert.equal(r.connector.debt(), 1);
  blocked.resolve(); await r.connector.settleLocalWork();
  assert.equal(r.agent.resources.size, 0); assert.equal(r.journal.get(incoming)?.reconcile_debt, true);
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.connector.debt(), 0); assert.equal(r.agent.counts.rooms, 1);
});
test('terminal but unverified cleanup is never treated as completed at expiry', async () => {
  const r = await accepted(); r.agent.inspectionUnknown = true;
  r.connector.lifecycle(r.authority.lifecycle(RECOVERY, r.incoming, 'ended')); await r.connector.flushCleanup();
  r.agent.close(); r.clock.advance(60_000); let reads = 0;
  await r.connector.tick(async () => { reads++; return { status: 'forbidden' }; });
  assert.equal(reads, 1); assert.equal(r.connector.debt(), 1); assert.equal(r.agent.resources.size, 1);
  assert.equal(r.journal.get(r.incoming)?.cleanup_debt, true);
  r.agent.inspectionUnknown = false;
  await r.connector.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
  assert.equal(r.connector.debt(), 0); assert.equal(r.agent.resources.size, 0);
});
test('reconciliation started before terminal cleanup cannot reopen completed debt when its read returns', async () => {
  const r = await accepted(); const response = deferred<Reconciliation>();
  let reads = 0;
  const reconciling = r.connector.tick(async () => { reads++; return response.promise; });
  assert.equal(reads, 1);
  r.connector.lifecycle(r.authority.lifecycle(RECOVERY, r.incoming, 'ended'));
  await r.connector.settleLocalWork();
  const completed = r.journal.snapshot(); assert.equal(r.connector.debt(), 0);
  r.agent.inspectionUnknown = true; // A later management outage cannot undo verified cleanup.
  response.resolve(await r.authority.reconcile(RECOVERY, r.incoming));
  await reconciling;
  assert.deepEqual(r.journal.snapshot(), completed);
  assert.equal(r.connector.debt(), 0); assert.equal(r.connector.check(), 'available');
  assert.equal(r.agent.counts.deleted, 1);
});
