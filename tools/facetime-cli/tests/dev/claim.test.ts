import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLine, releaseLine, type Control, type Line, type Binding } from '../../src/dev/claim.js';
import { CLIError } from '../../src/cli/errors.js';

const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333', B_OLD = '44444444-4444-4444-8444-444444444444', B_NEW = '55555555-5555-4555-8555-555555555555';
const line = (overrides: Partial<Line> = {}): Line => ({ id: L1, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available',
  inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 7, ...overrides });
const binding = (state: Binding['state'], connected: boolean, id = B_OLD): Binding => ({ name: 'other', state, connected, environment: 'production',
  scope: { project_id: P1, line_id: L1, binding_id: id, binding_epoch: 1, instance_id: id, connection_generation: 0, session_mode: 'byor' } });

function control(options: { projects?: { id: string; name: string; role: string }[]; lines?: Line[]; bindings?: Binding[] } = {}) {
  const calls: unknown[][] = [];
  const api: Control = {
    async projects() { return options.projects ?? [{ id: P1, name: 'Team one', role: 'owner' }]; },
    async lines(project) { calls.push(['lines', project]); return options.lines ?? [line()]; },
    async bindings(project) { calls.push(['bindings', project]); return options.bindings ?? []; },
    async enroll(project, lineId, name) {
      calls.push(['enroll', project, lineId, name]);
      return { scope: binding('standby', false, B_NEW).scope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } };
    },
    async activate(project, id, expected, generation) { calls.push(['activate', project, id, expected, generation]); },
    async drain(project, id) { calls.push(['drain', project, id]); },
    async revoke(project, id) { calls.push(['revoke', project, id]); },
  };
  return { api, calls };
}
async function code(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error.code; }
  return assert.fail('expected a CLIError');
}

test('claim: one project and one free line need no flags; the binding is enrolled then activated with fresh values', async () => {
  const c = control();
  const claim = await claimLine(c.api, { name: 'dev-agent' });
  assert.equal(claim.project.id, P1); assert.equal(claim.line.id, L1); assert.equal(claim.scope.binding_id, B_NEW);
  assert.deepEqual(c.calls.filter(x => x[0] === 'enroll' || x[0] === 'activate'), [['enroll', P1, L1, 'dev-agent'], ['activate', P1, B_NEW, null, 7]]);
});

test('claim: several projects require an explicit choice and nothing is enrolled', async () => {
  const c = control({ projects: [{ id: P1, name: 'One', role: 'owner' }, { id: P2, name: 'Two', role: 'admin' }] });
  assert.equal(await code(claimLine(c.api, { name: 'dev-agent' })), 'project_selection_required');
  assert.equal(c.calls.some(x => x[0] === 'enroll'), false);
  const chosen = await claimLine(c.api, { name: 'dev-agent', project: P1 });
  assert.equal(chosen.project.id, P1);
});

test('claim: a member without owner or admin rights is told so before any change', async () => {
  const c = control({ projects: [{ id: P1, name: 'One', role: 'member' }] });
  assert.equal(await code(claimLine(c.api, { name: 'dev-agent' })), 'project_role_insufficient');
  assert.equal(c.calls.length, 0);
});

test('claim: a line in use by another connected session is refused unless takeover is requested', async () => {
  const c = control({ bindings: [binding('active', true)] });
  assert.equal(await code(claimLine(c.api, { name: 'dev-agent' })), 'line_in_use');
  assert.equal(c.calls.some(x => x[0] === 'enroll'), false);
  const taken = await claimLine(c.api, { name: 'dev-agent', takeover: true });
  assert.equal(taken.replaced, B_OLD);
  assert.deepEqual(c.calls.at(-1), ['activate', P1, B_NEW, B_OLD, 7]);
});

test('claim: an active binding whose session is gone is replaced without takeover', async () => {
  const c = control({ bindings: [binding('active', false)] });
  const claim = await claimLine(c.api, { name: 'dev-agent' });
  assert.equal(claim.replaced, B_OLD);
  assert.deepEqual(c.calls.at(-1), ['activate', P1, B_NEW, B_OLD, 7]);
});

test('claim: a line with a call in progress is refused, with or without takeover and whoever holds it, and nothing is enrolled', async () => {
  for (const takeover of [false, true]) for (const bindings of [[], [binding('active', true)], [binding('active', false)]]) {
    const c = control({ lines: [line({ current_call_id: 'call_live' })], bindings });
    let refused: CLIError | undefined;
    try { await claimLine(c.api, { name: 'dev-agent', takeover }); } catch (error) { if (error instanceof CLIError) refused = error; else throw error; }
    const where = `takeover ${takeover}, bindings ${JSON.stringify(bindings.map(b => [b.state, b.connected]))}`;
    assert.ok(refused, where);
    assert.equal(refused.code, 'line_in_call', where); assert.equal(refused.exit, 3, where);
    assert.equal(refused.action, 'A call is in progress on this line. Wait for it to end, then run chert dev again.', where);
    assert.equal(c.calls.some(x => x[0] === 'enroll' || x[0] === 'activate' || x[0] === 'revoke' || x[0] === 'drain'), false, where);
  }
});

test('claim: once the call has ended the same line is taken as before', async () => {
  const c = control({ lines: [line({ current_call_id: null })], bindings: [binding('active', false)] });
  const claim = await claimLine(c.api, { name: 'dev-agent' });
  assert.equal(claim.replaced, B_OLD);
});

test('claim: a line that cannot route to a connector is refused with the reason', async () => {
  assert.equal(await code(claimLine(control({ lines: [line({ inbound_policy: 'assistant' })] }).api, { name: 'dev-agent' })), 'line_not_customer_decides');
  assert.equal(await code(claimLine(control({ lines: [line({ default_assistant_id: 'assistant' })] }).api, { name: 'dev-agent' })), 'line_not_customer_decides');
  assert.equal(await code(claimLine(control({ lines: [] }).api, { name: 'dev-agent' })), 'line_required');
  assert.equal(await code(claimLine(control({ lines: [line(), line({ id: P2 })] }).api, { name: 'dev-agent' })), 'project_requires_one_line');
});

test('claim: a failed activation revokes the binding it just enrolled', async () => {
  const c = control();
  c.api.activate = async () => { throw new CLIError('backend_request_rejected', 6, 'rejected'); };
  assert.equal(await code(claimLine(c.api, { name: 'dev-agent' })), 'backend_request_rejected');
  assert.deepEqual(c.calls.at(-1), ['revoke', P1, B_NEW]);
});

test('release: drains always, revokes only when no call work is retained', async () => {
  const clean = control();
  await releaseLine(clean.api, P1, B_NEW, 0);
  assert.deepEqual(clean.calls, [['drain', P1, B_NEW], ['revoke', P1, B_NEW]]);
  const debt = control();
  await releaseLine(debt.api, P1, B_NEW, 1);
  assert.deepEqual(debt.calls, [['drain', P1, B_NEW]]);
});

// Pre-flight: a line Chert says cannot take calls is refused with the reason and who fixes it, before anything is enrolled.
const WORKER = '66666666-6666-4666-8666-666666666666';
const ready = (overrides: Partial<Line> = {}): Line => line({ worker_id: WORKER, routing_status: 'configured', activation_intent: 'enabled', ...overrides });

test('preflight: a paused line is refused as line_paused, naming Enable calls, and nothing is enrolled', async () => {
  const c = control({ lines: [ready({ status: 'offline', routing_status: 'paused', activation_intent: 'paused' })] });
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'line_paused'); assert.match(error.action, /Enable calls/);
  assert.equal(c.calls.some(x => x[0] === 'enroll'), false);
});

test('preflight: a line the Mac has not acknowledged is refused as line_unacknowledged', async () => {
  const c = control({ lines: [ready({ status: 'offline', routing_status: 'awaiting_worker' })] });
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'line_unacknowledged'); assert.match(error.action, /identity|acknowledg/i);
});

test('preflight: an offline line with routing configured is refused as line_offline, pointing at the Mac', async () => {
  const c = control({ lines: [ready({ status: 'offline' })] });
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'line_offline'); assert.match(error.action, /Mac/);
});

test('preflight: a line whose routing is auto_reject names the console settings a project admin changes', async () => {
  const c = control({ lines: [ready({ inbound_policy: 'auto_reject' })] });
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'line_not_customer_decides'); assert.match(error.action, /Your webhook/); assert.match(error.action, /auto_reject/);
});

test('preflight: a Mac that is offline or stale refuses the claim as worker_unavailable; --force takes the line and keeps the reason', async () => {
  const workers = [{ id: WORKER, status: 'offline', enabled: true, last_heartbeat_at: new Date().toISOString() }];
  const c = control({ lines: [ready()] });
  c.api.workers = async () => workers;
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'worker_unavailable'); assert.match(error.action, /offline/);
  assert.equal(c.calls.some(x => x[0] === 'enroll'), false);
  const forced = await claimLine(c.api, { name: 'dev-agent', force: true });
  assert.equal(forced.readiness.ok, false); assert.equal(forced.readiness.code, 'worker_unavailable');
  assert.equal(c.calls.some(x => x[0] === 'enroll'), true);
});

test('preflight: a healthy line reports ok with the Mac checked in, and an unreadable worker list does not block the claim', async () => {
  const c = control({ lines: [ready()] });
  c.api.workers = async () => [{ id: WORKER, status: 'accepting', enabled: true, last_heartbeat_at: new Date(Date.now() - 5_000).toISOString() }];
  const claim = await claimLine(c.api, { name: 'dev-agent' });
  assert.equal(claim.readiness.ok, true); assert.match(claim.readiness.summary, /available/); assert.match(claim.readiness.summary, /checked in/);
  const d = control({ lines: [ready()] });
  d.api.workers = async () => { throw new CLIError('backend_request_rejected', 6, 'no'); };
  const second = await claimLine(d.api, { name: 'dev-agent' });
  assert.equal(second.readiness.ok, true); assert.match(second.readiness.summary, /not listed|unknown/i);
});

test('preflight: the unassigned-line message says who assigns it', async () => {
  const c = control({ lines: [] });
  const error = await claimLine(c.api, { name: 'dev-agent' }).catch(e => e);
  assert.ok(error instanceof CLIError); assert.equal(error.code, 'line_required'); assert.match(error.action, /Admin panel|assign/i);
});

// Shared lines (Gary's pilot, facetime branch shared-lines-copy-prompt-draft): a project onboarded with `chert onboard` reaches a
// pool line through an allocation. GET /api/v1/lines lists that line under the subscriber's project only while the allocation
// is current (view facetime_accessible_lines, migration 20261022165905_shared_line_messaging.sql:11-19): no Apple ID, no
// assistant, the pool's receiving number as masked_identity, and the line's own status, worker and switch (line-availability.ts).
// A hold for cleanup after a call does not change that answer; it refuses the next call at admission.
// The fixture binding is enrolled for L1, so the pool line keeps that id; its shape is what differs.
const W = '77777777-7777-4777-8777-777777777777';
const pool = (overrides: Partial<Line> = {}): Line => line({ display_name: 'Shared line 1', masked_identity: '+1 415 555 0100', worker_id: W,
  routing_status: 'configured', activation_intent: 'enabled', assignment_generation: 12, ...overrides });

test('shared: a live allocation on an enabled pool line is claimed like any other line', async () => {
  const c = control({ lines: [pool()] });
  const claim = await claimLine(c.api, { name: 'dev-agent', shared: () => true });
  assert.equal(claim.line.id, L1);
  assert.equal(claim.readiness.ok, true);
  assert.deepEqual(c.calls.map(call => call[0]), ['lines', 'bindings', 'enroll', 'activate']);
  assert.equal(c.calls[3]![4], 12);
});

test('shared: a line held for cleanup is listed like a live one, so it is claimed and the first call waits for cleanup', async () => {
  const claim = await claimLine(control({ lines: [pool()] }).api, { name: 'dev-agent', shared: () => true });
  assert.equal(claim.readiness.ok, true);
});

test('shared: no line listed means the allocation is not active, and says what to run, not "ask a Chert admin"', async () => {
  const c = control({ lines: [] });
  const error = await claimLine(c.api, { name: 'dev-agent', shared: () => true }).catch(e => e);
  assert.ok(error instanceof CLIError);
  assert.equal(error.code, 'shared_allocation_inactive');
  assert.match(error.action, /chert onboard --status/);
  assert.doesNotMatch(error.action, /Chert admin assigns/);
  assert.deepEqual(c.calls.map(call => call[0]), ['lines']);
  // An own-line project keeps today's answer.
  assert.equal(await code(claimLine(control({ lines: [] }).api, { name: 'dev-agent', shared: () => false })), 'line_required');
  assert.equal(await code(claimLine(control({ lines: [] }).api, { name: 'dev-agent' })), 'line_required');
});

test('shared: a pool line Chert keeps centrally paused is refused with Chert as the fixer, never the console\'s Enable calls', async () => {
  const paused = pool({ status: 'offline', routing_status: 'paused', activation_intent: 'paused' });
  const c = control({ lines: [paused] });
  const error = await claimLine(c.api, { name: 'dev-agent', shared: () => true }).catch(e => e);
  assert.ok(error instanceof CLIError);
  assert.equal(error.code, 'shared_line_paused');
  assert.match(error.action, /Chert/);
  assert.match(error.action, /chert onboard --status/);
  assert.doesNotMatch(error.action, /Enable calls/);
  assert.deepEqual(c.calls.map(call => call[0]), ['lines']);
  // The same answer for an own line is still line_paused with the console's fix.
  const own = await claimLine(control({ lines: [paused] }).api, { name: 'dev-agent' }).catch(e => e);
  assert.equal(own.code, 'line_paused');
  assert.match(own.action, /Enable calls/);
});

test('shared: every other refusal keeps its code and words for a shared line', async () => {
  const shared = { name: 'dev-agent', shared: () => true };
  assert.equal(await code(claimLine(control({ lines: [pool({ routing_status: 'awaiting_worker', status: 'offline' })] }).api, shared)), 'line_unacknowledged');
  assert.equal(await code(claimLine(control({ lines: [pool({ status: 'draining' })] }).api, shared)), 'line_draining');
  assert.equal(await code(claimLine(control({ lines: [pool({ status: 'offline' })] }).api, shared)), 'line_offline');
  assert.equal(await code(claimLine(control({ lines: [pool({ current_call_id: 'call' })] }).api, shared)), 'line_in_call');
  assert.equal(await code(claimLine(control({ lines: [pool(), pool({ id: P2 })] }).api, shared)), 'project_requires_one_line');
});
