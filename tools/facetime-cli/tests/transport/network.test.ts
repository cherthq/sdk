import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { MAX_FRAME, parseFrame, type Frame } from '../../src/protocol/v1.js';
import { deferred, ManualClock } from '../fixtures/clock.js';
import { network, waitEvent } from '../fixtures/network.js';
import { INTERNAL, localUrl, post, sign } from '../fixtures/http.js';
import { RECOVERY, TOKEN } from '../fixtures/rig.js';

async function rawSocket(origin: string, token = TOKEN): Promise<WebSocket> {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/connect', { headers: { authorization: `Bearer ${token}` }, perMessageDeflate: false });
  socket.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => { socket.once('message', () => resolve()); socket.once('error', reject); });
  return socket;
}
test('real HTTP → WS → HTTP plus separate committed receipt and lifecycle ack', async t => {
  const n = await network(); t.after(() => n.close());
  const committed = n.frame('decision.committed'); const result = await n.call(); await committed;
  assert.equal(result.action, 'accept'); assert.equal(n.authority.commitCount, 1);
  assert.equal(n.agent.counts.rooms, 1); assert.equal(n.agent.counts.jobs, 1);
  assert.equal(n.journal.get(result.owner)?.state, 'accepted');
  assert.equal(readFileSync(`${n.directory}/commits.jsonl`, 'utf8').split('\n').filter(Boolean).length, 1);
  await n.end(result.owner); assert.equal(n.agent.resources.size, 0); assert.equal(n.authority.acks.size, 1);
});
test('loopback destination policy rejects external addresses, credentials and schemes', () => {
  for (const url of ['http://example.com:80', 'http://localhost:1', 'https://127.0.0.1:1', 'http://user:password@127.0.0.1:1', 'http://[::1]:1']) assert.throws(() => localUrl(url), /forbidden/);
});
test('HTTP verifies exact signed bytes, not parsed/reserialized JSON', async t => {
  const n = await network(); t.after(() => n.close()); const incoming = n.authority.register(TOKEN);
  const original = JSON.stringify(incoming); const modified = JSON.stringify(incoming, null, 2);
  const response = await fetch(`${n.relay.origin}/incoming`, { method: 'POST', body: modified, headers: { authorization: `Bearer ${INTERNAL}`, 'x-signature': sign(original) } });
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { code: 'invalid_signature' });
  assert.equal(n.agent.counts.rooms, 0);
  const result = await post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  const frame = parseFrame(await result.text()); assert.equal(frame.type, 'call.decision');
  if (frame.type === 'call.decision') assert.equal(frame.action, 'accept');
});
test('handshake requires mapped credentials and denies query-token authorization', async t => {
  const n = await network(); t.after(() => n.close());
  const socket = new WebSocket(n.relay.origin.replace('http:', 'ws:') + '/connect?token=secret', { headers: { authorization: 'Bearer unknown' } });
  const status = await new Promise<number>(resolve => {
    socket.on('error', () => undefined);
    socket.once('unexpected-response', (_req, res) => { resolve(res.statusCode!); res.resume(); socket.terminate(); });
  });
  assert.equal(status, 401); assert.equal(n.agent.counts.rooms, 0);
});
for (const [label, payload, expected] of [
  ['malformed', '{SYNTHETIC_REJECTED_SECRET', 'invalid_frame'],
  ['version', '{"v":99,"secret":"SYNTHETIC_REJECTED_SECRET"}', 'unsupported_protocol'],
  ['oversized', 'x'.repeat(MAX_FRAME + 1), 'frame_too_large'],
] as const) test(`bounded HTTP and WebSocket rejection: ${label}`, async t => {
  const n = await network(); t.after(() => n.close());
  const response = await fetch(`${n.relay.origin}/incoming`, { method: 'POST', headers: { authorization: `Bearer ${INTERNAL}`, 'x-signature': sign(payload) }, body: payload });
  assert.equal(response.ok, false);
  const text = await response.text(); assert.ok(text.includes(expected)); assert.ok(!text.includes('SYNTHETIC_REJECTED_SECRET'));
  const socket = await rawSocket(n.relay.origin);
  const closed = new Promise<[number, string]>(resolve => socket.once('close', (code, reason) => resolve([code, reason.toString()])));
  socket.send(payload); const [code, reason] = await closed;
  assert.equal(code, label === 'oversized' ? 1009 : 1008); assert.ok(!reason.includes('SECRET'));
  assert.equal(n.agent.counts.rooms, 0);
});
test('HTTP cancellation records authoritative terminality and cleans late readiness', async t => {
  const n = await network(); t.after(() => n.close());
  const readyEntered = deferred(); const release = deferred();
  n.agent.beforeReady = () => { readyEntered.resolve(); return release.promise; };
  const incoming = n.authority.register(TOKEN); const controller = new AbortController();
  const cancelled = n.frame('call.cancel');
  const pending = post(`${n.relay.origin}/incoming`, incoming, INTERNAL, controller.signal);
  await readyEntered.promise; controller.abort(); await assert.rejects(pending);
  await cancelled; release.resolve(); await n.connector.flushCleanup();
  // Reconciliation settles any cleanup continuation that was still queued.
  await n.connector.reconcile(n.reconcile);
  assert.equal(n.agent.resources.size, 0);
  const status = await n.authority.reconcile(RECOVERY, incoming);
  assert.equal(status.status, 'known'); if (status.status === 'known') assert.equal(status.terminal, true);
});
test('dropped commit receipt preserves resources, socket closure and reconnect reconcile without dispatch', async t => {
  const n = await network(); t.after(() => n.close()); n.relay.dropReceipts = true;
  const result = await n.call(); assert.equal(n.journal.get(result.owner)?.state, 'decision_sent');
  const closed = waitEvent(n.wire.events, 'closed'); n.relay.closeSockets(); await closed;
  assert.equal(n.agent.resources.size, 1); assert.equal(n.connector.check(), 'relay_unavailable');
  await n.reconnect(); assert.equal(n.journal.get(result.owner)?.state, 'accepted');
  assert.equal(n.agent.counts.jobs, 1); await n.end(result.owner);
});
test('socket closure during preparation stops new work, reconnect declines interrupted request', async t => {
  const n = await network(); t.after(() => n.close());
  const entered = deferred(); const release = deferred(); n.agent.beforeReady = () => { entered.resolve(); return release.promise; };
  const incoming = n.authority.register(TOKEN);
  const pending = post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  await entered.promise; const closed = waitEvent(n.wire.events, 'closed'); n.relay.closeSockets(); await closed;
  assert.equal((await pending).status, 503); release.resolve(); await n.reconnect();
  await n.connector.flushCleanup(); assert.equal(n.agent.resources.size, 0); assert.equal(n.agent.counts.jobs, 1);
});
test('lost lifecycle delivery and lost ack converge through reconcile and replay', async t => {
  const n = await network(); t.after(() => n.close());
  const committed = n.frame('decision.committed'); const result = await n.call(); await committed;
  n.relay.dropLifecycle = true;
  const event = n.authority.lifecycle(RECOVERY, result.owner, 'ended');
  await post(`${n.relay.origin}/event`, event, INTERNAL); assert.equal(n.agent.resources.size, 1);
  await n.connector.reconcile(n.reconcile); assert.equal(n.agent.resources.size, 0);
  n.relay.dropLifecycle = false; n.relay.dropAcks = true;
  let ack = waitEvent(n.relay.events, 'ack'); n.relay.replay(TOKEN, 0); await ack;
  assert.equal(n.journal.snapshot().cursor, 1); assert.equal(n.authority.acks.size, 0);
  n.relay.dropAcks = false; ack = waitEvent(n.relay.events, 'ack');
  n.relay.replay(TOKEN, n.journal.snapshot().cursor); await ack;
  assert.equal(n.authority.acks.size, 1); assert.equal(n.agent.counts.deleted, 1);
});
test('tenant routing never forwards a call to another authenticated tenant', async t => {
  const n = await network(); t.after(() => n.close());
  const otherScope = { ...n.connector.scope, project_id: 'other_project', line_id: 'other_line', binding_id: 'other_binding', instance_id: 'other_instance', connection_generation: 0 };
  const otherToken = 'SYNTHETIC_OTHER_TENANT'; n.authority.enroll(otherToken, otherScope); n.authority.activate(otherToken, 0);
  const socket = await rawSocket(n.relay.origin, otherToken); t.after(() => socket.terminate());
  const frames: Frame[] = []; socket.on('message', data => frames.push(parseFrame(data.toString())));
  const receipt = n.frame('decision.committed'); const call = await n.call(); await receipt;
  assert.equal(frames.length, 0);
  const response = await post(`${n.origin}/reconcile`, call.owner, otherToken);
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { code: 'forbidden' });
  const closed = new Promise<string>(resolve => socket.once('close', (_code, reason) => resolve(reason.toString())));
  socket.send(JSON.stringify({ ...call.owner, v: 1, type: 'call.decision', message_id: 'forged', action: 'decline', reason: 'terminal' }));
  assert.equal(await closed, 'forbidden'); assert.equal(n.agent.resources.size, 1);
});
test('transient bridge secret is absent from durable files and diagnostics', async t => {
  const n = await network(); t.after(() => n.close()); await n.call();
  const captured = readFileSync(`${n.directory}/journal.json`, 'utf8') + readFileSync(`${n.directory}/commits.jsonl`, 'utf8') + JSON.stringify([n.relay.diagnostics, n.wire.diagnostics, n.connector.diagnostics]);
  for (const sentinel of ['SYNTHETIC_BRIDGE_SECRET_SENTINEL', TOKEN, RECOVERY, INTERNAL]) assert.ok(!captured.includes(sentinel));
});
test('signed HTTP tenant/request substitution and revoked owner fail before allocation', async t => {
  const n = await network(); t.after(() => n.close()); const incoming = n.authority.register(TOKEN);
  for (const field of ['project_id', 'line_id', 'instance_id', 'call_id', 'request_id'] as const) {
    const response = await post(`${n.relay.origin}/incoming`, { ...incoming, [field]: 'foreign' }, INTERNAL);
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { code: 'forbidden' });
  }
  n.authority.revoke(TOKEN);
  const response = await post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  assert.equal(response.status, 403); assert.deepEqual(await response.json(), { code: 'forbidden' });
  assert.equal(n.agent.counts.rooms, 0);
});

// A pong is ordered after all earlier client frames. It proves the relay has
// processed duplicate decisions without relying on sleeps or an early OPEN check.
async function socketBarrier(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('socket_barrier_timeout')), 3000);
    const closed = () => done(new Error('connector_closed_before_barrier'));
    const pong = () => done();
    const done = (error?: Error) => {
      clearTimeout(timer); socket.off('close', closed); socket.off('pong', pong);
      if (error) reject(error); else resolve();
    };
    socket.once('close', closed); socket.once('pong', pong);
    if (socket.readyState !== WebSocket.OPEN) done(new Error('connector_not_open'));
    else socket.ping();
  });
}

test('concurrent identical incoming HTTP requests keep the connector usable after both decisions', async t => {
  const n = await network(); t.after(() => n.close());
  const entered = deferred(); const release = deferred(); const bothDelivered = deferred();
  n.agent.beforeReady = () => { entered.resolve(); return release.promise; };
  const receive = n.connector.incoming.bind(n.connector); let deliveries = 0;
  n.connector.incoming = frame => {
    const response = receive(frame); if (++deliveries === 2) bothDelivered.resolve(); return response;
  };
  const incoming = n.authority.register(TOKEN);
  const first = post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  await entered.promise;
  const second = post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  await bothDelivered.promise; release.resolve();
  const replies = await Promise.all([first, second]);
  assert.ok(replies.every(response => response.ok));
  const [one, two] = await Promise.all(replies.map(async response => parseFrame(await response.text())));
  assert.ok(one?.type === 'call.decision' && two?.type === 'call.decision');
  assert.equal(one.action, 'accept'); assert.deepEqual(one, two);
  assert.equal(n.agent.counts.rooms, 1); assert.equal(n.agent.counts.jobs, 1);
  await socketBarrier(n.wire.socket!);
  assert.equal(n.connector.connected, true);

  // A delivery ID is not immutable decision content.
  n.wire.socket!.send(JSON.stringify({ ...one, message_id: 'matching_repeat' }));
  await socketBarrier(n.wire.socket!);
  const [receipt, duplicateReceipt] = await Promise.all([n.authority.commit(TOKEN, one), n.authority.commit(TOKEN, two)]);
  assert.deepEqual(receipt, duplicateReceipt); assert.equal(n.authority.commitCount, 1);
  const committed = n.frame('decision.committed');
  assert.ok((await post(`${n.relay.origin}/event`, receipt, INTERNAL)).ok); await committed;
  assert.equal(n.journal.get(incoming)?.state, 'accepted');
  await n.end(incoming);
  assert.equal(n.authority.acks.size, 1); assert.equal(n.agent.resources.size, 0);
  assert.equal(n.connector.debt(), 0); assert.equal(n.wire.socket!.readyState, WebSocket.OPEN);
});

async function firstDecision(n: Awaited<ReturnType<typeof network>>) {
  const incoming = n.authority.register(TOKEN);
  const response = await post(`${n.relay.origin}/incoming`, incoming, INTERNAL);
  assert.ok(response.ok);
  const decision = parseFrame(await response.text());
  assert.ok(decision.type === 'call.decision' && decision.action === 'accept');
  return { incoming, decision };
}

for (const field of ['action', 'participant_token', 'remote_participant_identity'] as const) {
  test(`conflicting duplicate decision ${field} is rejected without another commit`, async t => {
    const n = await network(); t.after(() => n.close()); const { incoming, decision } = await firstDecision(n);
    const committed = n.frame('decision.committed');
    const receipt = await n.authority.commit(TOKEN, decision);
    await post(`${n.relay.origin}/event`, receipt, INTERNAL); await committed;
    const { livekit_url: _url, participant_token: _token, remote_participant_identity: _identity, ...envelope } = decision;
    const payload = field === 'action'
      ? { ...envelope, action: 'decline', reason: 'terminal' }
      : { ...decision, [field]: 'conflicting_value' };
    const closed = waitEvent(n.wire.events, 'closed'); n.wire.socket!.send(JSON.stringify(payload)); await closed;
    assert.equal(n.relay.diagnostics.at(-1), 'request_conflict');
    assert.equal(n.authority.commitCount, 1); assert.equal(n.agent.counts.jobs, 1); assert.equal(n.agent.resources.size, 1);
    await n.reconnect(); await n.end(incoming); assert.equal(n.agent.resources.size, 0);
  });
}

test('conflicting incoming duplicate does not alter the legitimate pending request', async t => {
  const n = await network(); t.after(() => n.close());
  const entered = deferred(); const release = deferred(); n.agent.beforeReady = () => { entered.resolve(); return release.promise; };
  const incoming = n.authority.register(TOKEN);
  const pending = post(`${n.relay.origin}/incoming`, incoming, INTERNAL); await entered.promise;
  const conflict = await post(`${n.relay.origin}/incoming`, { ...incoming, resource_expires_at: incoming.resource_expires_at + 1 }, INTERNAL);
  assert.equal(conflict.status, 403); assert.deepEqual(await conflict.json(), { code: 'forbidden' });
  release.resolve(); const response = await pending; assert.ok(response.ok);
  const decision = parseFrame(await response.text()); assert.ok(decision.type === 'call.decision' && decision.action === 'accept');
  await socketBarrier(n.wire.socket!);
  const receipt = await n.authority.commit(TOKEN, decision); const committed = n.frame('decision.committed');
  await post(`${n.relay.origin}/event`, receipt, INTERNAL); await committed;
  assert.equal(n.agent.counts.jobs, 1); assert.equal(n.authority.commitCount, 1);
  await n.end(incoming); assert.equal(n.agent.resources.size, 0);
});

test('late HTTP retry reconciles instead of resending an acceptance or disconnecting', async t => {
  const n = await network(); t.after(() => n.close()); const { incoming, decision } = await firstDecision(n);
  const retry = await post(`${n.relay.origin}/incoming`, { ...incoming, message_id: 'late_retry' }, INTERNAL);
  assert.equal(retry.status, 409); assert.deepEqual(await retry.json(), { code: 'acceptance_uncertain' });
  await socketBarrier(n.wire.socket!); assert.equal(n.agent.counts.jobs, 1);
  await n.authority.commit(TOKEN, decision); await n.connector.reconcile(n.reconcile);
  assert.equal(n.journal.get(incoming)?.state, 'accepted'); await n.end(incoming);
});

for (const field of ['project_id', 'line_id', 'instance_id', 'request_id'] as const) {
  test(`foreign duplicate decision ${field} cannot use a completed request`, async t => {
    const n = await network(); t.after(() => n.close()); const { decision } = await firstDecision(n);
    const closed = waitEvent(n.wire.events, 'closed');
    n.wire.socket!.send(JSON.stringify({ ...decision, [field]: 'foreign' })); await closed;
    assert.equal(n.relay.diagnostics.at(-1), 'forbidden');
    assert.equal(n.authority.commitCount, 0); assert.equal(n.agent.counts.jobs, 1);
  });
}

test('stale duplicate decision cannot cross a connection generation', async t => {
  const n = await network(); t.after(() => n.close()); const { incoming, decision } = await firstDecision(n);
  await n.authority.commit(TOKEN, decision);
  await n.reconnect(); assert.equal(n.journal.get(incoming)?.state, 'accepted');
  // The replaced socket may close after reconnect; await this generation only.
  const closed = waitEvent(n.wire.socket!, 'close'); n.wire.socket!.send(JSON.stringify(decision)); await closed;
  assert.equal(n.relay.diagnostics.at(-1), 'forbidden');
  assert.equal(n.authority.commitCount, 1); assert.equal(n.agent.counts.jobs, 1); assert.equal(n.agent.resources.size, 1);
  await n.reconnect(); await n.end(incoming);
});

test('revoked credential cannot bypass authentication with a matching duplicate decision', async t => {
  const n = await network(); t.after(() => n.close()); const { decision } = await firstDecision(n);
  n.authority.revoke(TOKEN);
  const closed = waitEvent(n.wire.events, 'closed'); n.wire.socket!.send(JSON.stringify(decision)); await closed;
  assert.equal(n.relay.diagnostics.at(-1), 'forbidden'); assert.equal(n.authority.commitCount, 0);
});

test('matching duplicate decision never renews the original deadline under rollback', async t => {
  const clock = new ManualClock(); const n = await network(clock); t.after(() => n.close());
  const { incoming, decision } = await firstDecision(n);
  clock.advance(4000, -1000);
  n.wire.socket!.send(JSON.stringify({ ...decision, message_id: 'repeat_before_expiry' }));
  await socketBarrier(n.wire.socket!);
  clock.advance(1000, 0);
  const closed = waitEvent(n.wire.events, 'closed'); n.wire.socket!.send(JSON.stringify(decision)); await closed;
  assert.equal(n.relay.diagnostics.at(-1), 'forbidden');
  await assert.rejects(n.authority.commit(TOKEN, decision), /deadline_exceeded/);
  assert.equal(n.authority.commitCount, 0); assert.equal(n.agent.counts.jobs, 1);
  await n.connector.reconcile(n.reconcile); assert.equal(n.agent.resources.size, 0);
  assert.equal(n.journal.get(incoming)?.cleanup_debt, false);
});
