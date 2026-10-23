import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileJournal, type Entry } from '../../src/runtime/journal.js';
import { Connector } from '../../src/runtime/connector.js';
import type { Ready } from '../../src/runtime/agent.js';
import { deferred, settle } from '../fixtures/clock.js';
import { rig, RECOVERY, TOKEN } from '../fixtures/rig.js';
import { Fault, type Scope, key } from '../../src/protocol/v1.js';

const handles = new Map<string, FileJournal[]>();
function openJournal(path: string, scope: Scope): FileJournal {
  const journal = new FileJournal(path, scope);
  handles.set(path, [...(handles.get(path) ?? []), journal]); return journal;
}
function temp(t: import('node:test').TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'chert-journal-')); t.after(() => { for (const journal of handles.get(join(directory, 'journal.json')) ?? []) journal.close(); handles.delete(join(directory, 'journal.json')); rmSync(directory, { recursive: true, force: true }); });
  return join(directory, 'journal.json');
}
test('exclusive writer and live-lock recovery fail closed without touching data', t => {
  const r = rig(); const path = temp(t); const first = openJournal(path, r.scope); t.after(() => first.close());
  const before = readFileSync(path, 'utf8');
  assert.throws(() => openJournal(path, r.scope), /journal_unavailable/);
  assert.throws(() => FileJournal.recoverDeadWriter(path), /journal_unavailable/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
for (const point of ['before_rename', 'after_rename'] as const) test(`atomic journal ${point} leaves a complete old or new snapshot`, async t => {
  const r = rig(); const incoming = r.request(); await r.connector.incoming(incoming);
  const path = temp(t); const first = openJournal(path, r.scope); first.failAt = point;
  assert.throws(() => first.write(r.journal.get(incoming)!), /journal_unavailable/);
  assert.equal(first.healthy, false); first.close();
  const next = openJournal(path, r.scope); t.after(() => next.close());
  assert.equal(Boolean(next.get(incoming)), point === 'after_rename');
  assert.ok(!readFileSync(path, 'utf8').includes('SECRET_SENTINEL'));
});
test('corrupt, wrong-scope and extra secret-bearing journal fields fail closed', async t => {
  const r = rig(); const path = temp(t);
  writeFileSync(path, '{BROKEN_SECRET_SENTINEL');
  assert.throws(() => openJournal(path, r.scope), error => error instanceof Error && error.message === 'journal_unavailable');
  assert.equal(readFileSync(path, 'utf8'), '{BROKEN_SECRET_SENTINEL');
  writeFileSync(path, JSON.stringify(r.journal.snapshot()));
  assert.throws(() => openJournal(path, { ...r.scope, project_id: 'other' }), /journal_unavailable/);
  const journal = openJournal(path, r.scope); t.after(() => journal.close());
  const incoming = r.request(); await r.connector.incoming(incoming);
  const injected = { ...r.journal.get(incoming)!, token: 'SYNTHETIC_BRIDGE_SECRET_SENTINEL' };
  assert.throws(() => journal.write(injected), /journal_unavailable/);
  assert.ok(!readFileSync(path, 'utf8').includes('SYNTHETIC_BRIDGE_SECRET_SENTINEL'));
  const connector = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
  assert.equal(connector.check(), 'journal_unavailable');
});
for (const stage of ['intent', 'prepared', 'decision_sent'] as const) test(`SIGKILL after ${stage}: reopen without retry or delete-all`, async t => {
  const r = rig(); const incoming = r.request(); const decision = await r.connector.incoming(incoming);
  const entry = r.journal.get(incoming)!;
  if (stage === 'decision_sent') await r.authority.commit(TOKEN, decision);
  else if (stage === 'intent') r.agent.resources.clear();
  const snapshot = r.journal.snapshot();
  snapshot.entries[key(incoming)] = { ...entry, state: stage, create_pending: stage === 'intent', reconcile_debt: stage === 'decision_sent' };
  const path = temp(t); const input = `${path}.input`; writeFileSync(input, JSON.stringify(snapshot));
  const child = fork(fileURLToPath(new URL('../fixtures/journal-crash.js', import.meta.url)), [path, input], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('child_exited_before_receipt'))); });
  const killed = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGKILL'); await killed;
  assert.throws(() => openJournal(path, r.scope), /journal_unavailable/);
  FileJournal.recoverDeadWriter(path);
  const journal = openJournal(path, r.scope); t.after(() => journal.close());
  const recovered = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
  const jobsBefore = r.agent.counts.jobs;
  const replay = await recovered.incoming(incoming); assert.equal(replay.action, 'decline');
  assert.equal(r.agent.counts.jobs, jobsBefore);
  await recovered.reconcile(async () => ({ status: 'not_found' }));
  assert.equal(r.agent.resources.size, stage === 'intent' ? 0 : 1);
  if (stage === 'decision_sent') {
    await recovered.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
    assert.equal(journal.get(incoming)?.state, 'accepted'); assert.equal(r.agent.resources.size, 1);
  } else {
    r.authority.cancel(TOKEN, incoming);
    await recovered.reconcile(owner => r.authority.reconcile(RECOVERY, owner));
    assert.equal(r.agent.resources.size, 0); assert.equal(journal.get(incoming)?.cleanup_debt, false);
  }
  assert.equal(r.agent.counts.jobs, jobsBefore);
});
test('lifecycle is durable before ack; failed write cannot acknowledge or delete', async t => {
  const r = rig(); const incoming = r.request(); const decision = await r.connector.incoming(incoming);
  await r.authority.commit(TOKEN, decision);
  const path = temp(t); const journal = openJournal(path, r.scope);
  journal.write(r.journal.get(incoming)!);
  const connector = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
  const event = r.authority.lifecycle(RECOVERY, incoming, 'ended'); journal.failAt = 'before_rename';
  assert.throws(() => connector.lifecycle(event), /journal_unavailable/);
  assert.equal(r.agent.resources.size, 1); assert.equal(r.authority.acks.size, 0); journal.close();
  const reopened = openJournal(path, r.scope); t.after(() => reopened.close());
  const recovered = new Connector(r.scope, reopened, r.agent, r.availability, r.clock);
  const ack = recovered.lifecycle(event);
  const disk = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, Entry>; cursor: number };
  assert.equal(disk.entries[key(incoming)]?.terminal, true); assert.equal(disk.cursor, event.cursor);
  r.authority.acknowledge(TOKEN, ack); await recovered.flushCleanup(); assert.equal(r.agent.resources.size, 0);
});
test('pre-incoming terminal tombstone survives file close and reopen', async t => {
  const r = rig(); const path = temp(t); const incoming = r.request();
  const journal = openJournal(path, r.scope);
  const connector = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
  const terminal = r.authority.lifecycle(RECOVERY, incoming, 'ended');
  connector.lifecycle(terminal); journal.close();
  const reopened = openJournal(path, r.scope);
  const recovered = new Connector(r.scope, reopened, r.agent, r.availability, r.clock);
  assert.equal(reopened.snapshot().cursor, terminal.cursor);
  assert.equal((await recovered.incoming(incoming)).action, 'decline');
  assert.equal(r.agent.counts.rooms, 0);
});
for (const reopen of [false, true]) test(`rejected local preparation retains remote create debt${reopen ? ' after journal reopen' : ''}`, async t => {
  const r = rig(); const path = temp(t); const incoming = r.request();
  let journal = openJournal(path, r.scope);
  let connector = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
  const localRequest = deferred<Ready>(); const lateCreate = deferred(); const remoteDone = deferred();
  let remoteSettled = false; let preparations = 0;
  r.agent.prepare = () => { preparations++; return localRequest.promise; };
  r.agent.settled = async () => remoteSettled;
  const response = connector.incoming(incoming);
  const entry = journal.get(incoming)!;
  const external = lateCreate.promise.then(async () => {
    r.agent.resources.set(entry.room, { entry, job: false, expiresMono: Infinity }); r.agent.counts.rooms++;
    await remoteDone.promise; remoteSettled = true;
  });
  // The HTTP/SDK request times out while its remote operation remains in flight.
  localRequest.reject(new Fault('deadline_exceeded'));
  assert.equal((await response).action, 'decline'); await settle(); await connector.flushCleanup();
  if (reopen) {
    connector.close(); journal.close(); journal = openJournal(path, r.scope);
    connector = new Connector(r.scope, journal, r.agent, r.availability, r.clock);
    await connector.flushCleanup();
  }
  assert.equal(await r.agent.inspect(entry), 'absent');
  assert.equal(journal.get(incoming)?.cleanup_debt, true, 'absence before remote settlement must retain debt');
  assert.equal(journal.get(incoming)?.create_pending, true);
  assert.equal(connector.check(), 'cleanup_pending');
  await connector.incoming(incoming); assert.equal(preparations, 1);

  const foreign = { ...entry, room: 'foreign_room', marker: 'foreign_marker' };
  r.agent.resources.set(foreign.room, { entry: foreign, job: true, expiresMono: Infinity });
  lateCreate.resolve(); await settle(); await connector.flushCleanup();
  assert.equal(r.agent.resources.has(entry.room), true);
  assert.equal(journal.get(incoming)?.cleanup_debt, true);
  assert.equal(connector.check(), 'cleanup_pending');
  remoteDone.resolve(); await external;
  r.agent.deleteFails = true; await connector.flushCleanup();
  assert.equal(journal.get(incoming)?.cleanup_debt, true, 'settlement alone does not prove deletion');
  r.agent.deleteFails = false; await connector.flushCleanup();
  assert.equal(r.agent.resources.has(entry.room), false);
  assert.equal(r.agent.resources.has(foreign.room), true);
  assert.equal(r.agent.counts.rooms, 1); assert.equal(r.agent.counts.deleted, 1);
  assert.equal(journal.get(incoming)?.cleanup_debt, false);
  assert.equal(connector.check(), 'available'); assert.equal(preparations, 1);
});
