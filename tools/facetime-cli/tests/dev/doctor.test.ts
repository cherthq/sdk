import test from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor, workerCheck, type DoctorDeps, type Check } from '../../src/dev/doctor.js';
import type { Control, Binding, Line, Project, Worker } from '../../src/dev/claim.js';
import type { DispatchAPI } from '../../src/dev/dispatch-handler.js';
import { CLIError } from '../../src/cli/errors.js';

const P = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', L = '33333333-3333-4333-8333-333333333333', B = '44444444-4444-4444-8444-444444444444';
const W = '66666666-6666-4666-8666-666666666666';
const line = (overrides: Partial<Line> = {}): Line => ({ id: L, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available',
  inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 7, worker_id: W, ...overrides });
const binding = (connected: boolean): Binding => ({ name: 'dev-other', state: 'active', connected, environment: 'production',
  scope: { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' } });
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const worker = (overrides: Partial<Worker> = {}): Worker => ({ id: W, status: 'accepting', enabled: true, last_heartbeat_at: ago(10_000), ...overrides });

function rig(options: { projects?: Project[]; lines?: Line[] | 'error'; bindings?: Binding[]; workers?: Worker[] | 'error' | 'absent'; controlError?: CLIError; joinAfterMs?: number | null; livekitError?: 'auth' | 'network' } = {}) {
  const changes: string[] = []; const rooms = new Set<string>(); const created: number[] = [];
  const control: Control = {
    async projects() { if (options.controlError) throw options.controlError; return options.projects ?? [{ id: P, name: 'Team', role: 'owner' }]; },
    async lines() { if (options.lines === 'error') throw new CLIError('backend_request_rejected', 6, 'Chert rejected the request.'); return options.lines ?? [line()]; },
    async bindings() { return options.bindings ?? []; },
    ...(options.workers === 'absent' ? {} : { async workers() {
      if (options.workers === 'error') throw new CLIError('backend_request_rejected', 6, 'Chert rejected the request.');
      return Array.isArray(options.workers) ? options.workers : [worker()];
    } }),
    async enroll() { changes.push('enroll'); throw new Error('doctor must not enroll'); },
    async activate() { changes.push('activate'); }, async drain() { changes.push('drain'); }, async revoke() { changes.push('revoke'); },
  };
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); created.push(Date.now()); return { name, sid: 'RM' }; },
    async listParticipants(room) {
      if (options.livekitError === 'auth') throw Object.assign(new Error('unauthenticated'), { status: 401 });
      if (options.livekitError === 'network') throw new Error('fetch failed');
      const joined = rooms.has(room) && options.joinAfterMs !== null && Date.now() - created.at(-1)! >= (options.joinAfterMs ?? 0);
      return joined ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : [];
    },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const deps: DoctorDeps = { control, api, session: { signed_in: true, expires_at: Date.now() + 50 * 60_000, email: 'dev@example.test' },
    livekit: { url: 'wss://project.livekit.cloud', missing: [] }, agentTimeoutMs: 300, pollMs: 5 };
  return { deps, changes, rooms };
}
const by = (checks: Check[]) => Object.fromEntries(checks.map(c => [c.name, c]));

test('doctor: everything healthy passes every check, measures the agent join, and changes nothing', async () => {
  const r = rig({ joinAfterMs: 20 });
  const checks = by(await runDoctor({ agent: 'support' }, r.deps));
  for (const name of ['session', 'chert', 'project', 'line', 'worker', 'line_free', 'livekit', 'agent']) assert.equal(checks[name]!.status, 'pass', `${name}: ${checks[name]!.detail}`);
  assert.match(checks.agent!.detail, /joined in \d+(\.\d+)? s/);
  assert.deepEqual(r.changes, []); assert.equal(r.rooms.size, 0, 'the test room is removed');
});

test('doctor: a member role fails the project check with the fix, and later checks still run', async () => {
  const r = rig({ projects: [{ id: P, name: 'Dev Project', role: 'member' }] });
  const checks = by(await runDoctor({ agent: 'support' }, r.deps));
  assert.equal(checks.project!.status, 'fail'); assert.match(checks.project!.detail, /member/); assert.match(checks.project!.fix!, /owner or admin/);
  assert.equal(checks.line!.status, 'pass'); assert.equal(checks.livekit!.status, 'pass'); assert.equal(checks.agent!.status, 'pass');
});

test('doctor: reports several problems at once', async () => {
  const r = rig({ projects: [{ id: P, name: 'Dev Project', role: 'member' }], lines: [line({ inbound_policy: 'assistant' })], bindings: [binding(true)], joinAfterMs: null });
  const failed = (await runDoctor({ agent: 'support' }, r.deps)).filter(c => c.status === 'fail').map(c => c.name);
  assert.deepEqual(failed, ['project', 'line', 'line_free', 'agent']);
});

test('doctor: not signed in fails the session check and skips the checks that need Chert, but still checks LiveKit and the agent', async () => {
  const r = rig();
  const checks = by(await runDoctor({ agent: 'support' }, { ...r.deps, session: { signed_in: false }, control: undefined }));
  assert.equal(checks.session!.status, 'fail'); assert.match(checks.session!.fix!, /chert login/);
  for (const name of ['chert', 'project', 'line', 'worker', 'line_free']) assert.equal(checks[name]!.status, 'skip');
  assert.equal(checks.livekit!.status, 'pass'); assert.equal(checks.agent!.status, 'pass');
});

test('doctor: a session about to expire is a warning, not a failure', async () => {
  const r = rig();
  const checks = by(await runDoctor({}, { ...r.deps, session: { signed_in: true, expires_at: Date.now() + 5 * 60_000 } }));
  assert.equal(checks.session!.status, 'warn'); assert.match(checks.session!.detail, /5 min/);
});

test('doctor: the time left is said in days, hours or minutes, whichever a person would use', async () => {
  const r = rig(), minute = 60_000, hour = 60 * minute, day = 24 * hour;
  const left = async (ms: number) => by(await runDoctor({}, { ...r.deps, session: { signed_in: true, expires_at: Date.now() + ms } })).session!;
  assert.match((await left(30 * day)).detail, /^Signed in; 30 days left\.$/, 'a browser sign-in, not 43200 min');
  assert.match((await left(day + hour)).detail, /; 1 day left\.$/); assert.match((await left(23 * hour + 5 * minute)).detail, /; 23 hours left\.$/);
  assert.match((await left(hour + 5 * minute)).detail, /; 1 hour left\.$/); assert.match((await left(50 * minute)).detail, /; 50 min left\.$/);
  const soon = await left(14 * minute); assert.equal(soon.status, 'warn'); assert.match(soon.detail, /expires in 14 min\./);
  assert.equal((await left(16 * minute)).status, 'pass');
});

test('doctor: an expired or rejected session and an unreachable Chert are told apart', async () => {
  const rejected = by(await runDoctor({}, rig({ controlError: new CLIError('login_required', 3, 'x') }).deps));
  assert.equal(rejected.chert!.status, 'fail'); assert.match(rejected.chert!.fix!, /chert login/);
  const offline = by(await runDoctor({}, rig({ controlError: new CLIError('backend_unreachable', 6, 'x') }).deps));
  assert.equal(offline.chert!.status, 'fail'); assert.match(offline.chert!.detail, /reach/i);
  assert.equal(offline.project!.status, 'skip'); assert.equal(offline.worker!.status, 'skip');
});

test('doctor: several projects without --project lists them; the chosen one is checked', async () => {
  const projects = [{ id: P, name: 'One', role: 'owner' }, { id: P2, name: 'Two', role: 'admin' }];
  const ambiguous = by(await runDoctor({}, rig({ projects }).deps));
  assert.equal(ambiguous.project!.status, 'fail'); assert.match(ambiguous.project!.fix!, new RegExp(P2)); assert.equal(ambiguous.line!.status, 'skip');
  const chosen = by(await runDoctor({ project: P2 }, rig({ projects }).deps));
  assert.equal(chosen.project!.status, 'pass'); assert.match(chosen.project!.detail, /Two/);
});

for (const [name, lines, pattern] of [['no line', [], /no FaceTime line/i], ['two lines', [line(), line({ id: P2 })], /exactly one/i],
  ['a hosted assistant', [line({ default_assistant_id: 'a' })], /customer decides/i], ['an offline worker', [line({ status: 'offline' })], /offline/i]] as const) {
  test(`doctor: a project with ${name} fails or warns on the line check with the reason`, async () => {
    const checks = by(await runDoctor({}, rig({ lines: [...lines] }).deps));
    assert.notEqual(checks.line!.status, 'pass'); assert.match(`${checks.line!.detail} ${checks.line!.fix ?? ''}`, pattern);
  });
}

test('doctor: a line held by a connected session fails; one whose session is gone passes with a note', async () => {
  const held = by(await runDoctor({}, rig({ bindings: [binding(true)] }).deps));
  assert.equal(held.line_free!.status, 'fail'); assert.match(held.line_free!.detail, /^A session for agent "other" is on the line now\.$/); assert.match(held.line_free!.fix!, /--takeover/);
  const stale = by(await runDoctor({}, rig({ bindings: [binding(false)] }).deps));
  assert.equal(stale.line_free!.status, 'pass'); assert.match(stale.line_free!.detail, /replaced/);
});

test('doctor: a line with a call in progress is a warning', async () => {
  const checks = by(await runDoctor({}, rig({ lines: [line({ current_call_id: 'call', status: 'busy' })] }).deps));
  assert.equal(checks.line!.status, 'warn'); assert.match(checks.line!.detail, /call in progress/i);
});

test('doctor: missing LiveKit variables are named and the agent check is skipped', async () => {
  const r = rig();
  const checks = by(await runDoctor({ agent: 'support' }, { ...r.deps, api: undefined, livekit: { missing: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] } }));
  assert.equal(checks.livekit!.status, 'fail'); assert.match(checks.livekit!.fix!, /LIVEKIT_API_KEY, LIVEKIT_API_SECRET/);
  assert.equal(checks.agent!.status, 'skip');
});

test('doctor: rejected LiveKit credentials and an unreachable project are told apart', async () => {
  const auth = by(await runDoctor({ agent: 'support' }, rig({ livekitError: 'auth' }).deps));
  assert.equal(auth.livekit!.status, 'fail'); assert.match(auth.livekit!.detail, /rejected/i); assert.equal(auth.agent!.status, 'skip');
  const network = by(await runDoctor({}, rig({ livekitError: 'network' }).deps));
  assert.equal(network.livekit!.status, 'fail'); assert.match(network.livekit!.detail, /reach/i);
});

test('doctor: an agent that never joins fails with the likely causes and leaves no room behind', async () => {
  const r = rig({ joinAfterMs: null });
  const checks = by(await runDoctor({ agent: 'support' }, r.deps));
  assert.equal(checks.agent!.status, 'fail'); assert.match(checks.agent!.fix!, /agent_name/); assert.equal(r.rooms.size, 0);
});

test('doctor: without --agent the agent check is skipped with a hint, and no room is created', async () => {
  const r = rig();
  const checks = by(await runDoctor({}, r.deps));
  assert.equal(checks.agent!.status, 'skip'); assert.match(checks.agent!.detail, /--agent/);
});

test('doctor: a slow join is a warning that explains the decision window', async () => {
  const r = rig({ joinAfterMs: 120 });
  const checks = by(await runDoctor({ agent: 'support' }, { ...r.deps, slowJoinMs: 100 }));
  assert.equal(checks.agent!.status, 'warn'); assert.match(checks.agent!.detail, /warm room/i);
});

test('doctor: no check ever contains a secret or token', async () => {
  const r = rig();
  const text = JSON.stringify(await runDoctor({ agent: 'support' }, r.deps));
  assert.ok(!/eyJ|ftc_|secret/i.test(text), text);
});

for (const [name, lines] of [['no line', []], ['two lines', [line(), line({ id: P2 })]]] as const) {
  test(`doctor: with ${name} the line_free check is skipped, not passed`, async () => {
    const checks = by(await runDoctor({}, rig({ lines: [...lines] }).deps));
    assert.equal(checks.line!.status, 'fail');
    assert.equal(checks.line_free!.status, 'skip'); assert.match(checks.line_free!.detail, /one line/i);
  });
}

// The Mac behind the line: the server can show a line "available" while its worker is offline.
test('doctor: a Mac that checked in recently passes the worker check', async () => {
  const checks = by(await runDoctor({}, rig().deps));
  assert.equal(checks.worker!.status, 'pass'); assert.match(checks.worker!.detail, /checked in/i);
});

test('doctor: a Mac that has not checked in for over a minute warns that calls will not be answered', async () => {
  const checks = by(await runDoctor({}, rig({ workers: [worker({ last_heartbeat_at: ago(5 * 60_000) })] }).deps));
  assert.equal(checks.worker!.status, 'warn');
  assert.match(checks.worker!.detail, /5 min/); assert.match(checks.worker!.fix!, /Mac|worker/i);
  assert.equal(checks.line!.status, 'pass', 'the line check still reflects the server view');
});

for (const [name, overrides] of [['never checked in', { last_heartbeat_at: null }], ['is offline', { status: 'offline' }], ['is draining', { status: 'draining' }], ['is disabled', { enabled: false }]] as const) {
  test(`doctor: a Mac that ${name} warns on the worker check`, async () => {
    const checks = by(await runDoctor({}, rig({ workers: [worker(overrides)] }).deps));
    assert.equal(checks.worker!.status, 'warn', checks.worker!.detail);
  });
}

test('doctor: a heartbeat within the last minute passes even when the worker is briefly late', async () => {
  const checks = by(await runDoctor({}, rig({ workers: [worker({ last_heartbeat_at: ago(45_000) })] }).deps));
  assert.equal(checks.worker!.status, 'pass');
});

// Chert stamps the heartbeat and this computer supplies the present, so a slow clock here puts a fresh heartbeat ahead of it.
test('doctor: a heartbeat stamped slightly ahead of this computer\'s clock is fresh, not missing', async () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  for (const ahead of [1, 500, 2_000, 59_000]) {
    const check = workerCheck(worker({ last_heartbeat_at: new Date(now + ahead).toISOString() }), now);
    assert.equal(check.status, 'pass', `${ahead} ms ahead: ${check.detail}`); assert.match(check.detail, /checked in 0 s ago/);
  }
  const checks = by(await runDoctor({}, rig({ workers: [worker({ last_heartbeat_at: ago(-2_000) })] }).deps));
  assert.equal(checks.worker!.status, 'pass', checks.worker!.detail);
});

test('doctor: a heartbeat stamped a minute or more ahead warns about this computer\'s clock, not about the Mac', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z');
  const check = workerCheck(worker({ last_heartbeat_at: new Date(now + 5 * 60_000).toISOString() }), now);
  assert.equal(check.status, 'warn');
  assert.doesNotMatch(check.detail, /never checked in/i); assert.match(check.detail, /5 min ahead/); assert.match(check.fix!, /date and time/i);
});

test('doctor: when the workers cannot be read or the line has no worker, the worker check is skipped, not failed', async () => {
  const unreadable = by(await runDoctor({}, rig({ workers: 'error' }).deps));
  assert.equal(unreadable.worker!.status, 'skip');
  const unsupported = by(await runDoctor({}, rig({ workers: 'absent' }).deps));
  assert.equal(unsupported.worker!.status, 'skip');
  const unknown = by(await runDoctor({}, rig({ workers: [worker({ id: P2 })] }).deps));
  assert.equal(unknown.worker!.status, 'skip');
  const noLine = by(await runDoctor({}, rig({ lines: [] }).deps));
  assert.equal(noLine.worker!.status, 'skip');
});

test('doctor: a skipped worker check says why: the line could not be read, there is not exactly one, or it names no Mac', async () => {
  const unread = by(await runDoctor({}, rig({ lines: 'error' }).deps));
  assert.equal(unread.line!.status, 'fail'); assert.match(unread.line!.detail, /could not read/i);
  assert.equal(unread.worker!.status, 'skip'); assert.equal(unread.worker!.detail, 'Needs the project\'s line.');
  for (const lines of [[], [line(), line({ id: P2 })]]) assert.match(by(await runDoctor({}, rig({ lines }).deps)).worker!.detail, /exactly one line/i);
  const unnamed = by(await runDoctor({}, rig({ lines: [line({ worker_id: null })] }).deps));
  assert.equal(unnamed.line!.status, 'pass');
  assert.equal(unnamed.worker!.status, 'skip'); assert.match(unnamed.worker!.detail, /does not name the Mac/i);
});

test('doctor: a paused line says so and names Enable calls; an unacknowledged line points at the Mac; an offline line points at Chert MAU', async () => {
  const paused = by(await runDoctor({}, rig({ lines: [line({ status: 'offline', routing_status: 'paused', activation_intent: 'paused' })] }).deps));
  assert.equal(paused.line!.status, 'warn'); assert.match(paused.line!.detail, /paused/); assert.match(paused.line!.fix!, /Enable calls/);
  const waiting = by(await runDoctor({}, rig({ lines: [line({ status: 'offline', routing_status: 'awaiting_worker', activation_intent: 'enabled' })] }).deps));
  assert.equal(waiting.line!.status, 'warn'); assert.match(waiting.line!.detail, /acknowledg|identity/i);
  const offline = by(await runDoctor({}, rig({ lines: [line({ status: 'offline', routing_status: 'configured', activation_intent: 'enabled' })] }).deps));
  assert.equal(offline.line!.status, 'warn'); assert.match(offline.line!.fix!, /Chert MAU|Mac/);
  const rejecting = by(await runDoctor({}, rig({ lines: [line({ inbound_policy: 'auto_reject' })] }).deps));
  assert.equal(rejecting.line!.status, 'fail'); assert.match(rejecting.line!.fix!, /Your webhook/);
});

test('doctor: the clock check compares this computer with Chert, warns when ahead by a second or more, and skips when Chert gives no time', async () => {
  const now = Date.now();
  const ahead = rig(); ahead.deps.control!.serverTime = async () => now - 3_000;
  const c1 = by(await runDoctor({}, ahead.deps));
  assert.equal(c1.clock!.status, 'warn'); assert.match(c1.clock!.detail, /ahead/); assert.match(c1.clock!.fix!, /automatically/);
  const behind = rig(); behind.deps.control!.serverTime = async () => now + 20_000;
  const c2 = by(await runDoctor({}, behind.deps));
  assert.equal(c2.clock!.status, 'warn'); assert.match(c2.clock!.detail, /behind/);
  const fine = rig(); fine.deps.control!.serverTime = async () => Date.now() + 200;
  const c3 = by(await runDoctor({}, fine.deps));
  assert.equal(c3.clock!.status, 'pass');
  const none = by(await runDoctor({}, rig().deps));
  assert.equal(none.clock!.status, 'skip');
});

// Shared lines: a project onboarded with `chert onboard` reaches a pool line through an allocation; the line is listed only
// while the allocation is current, and the pool line's own switch is Chert's, not the project's.
const POOL_LINE = '66666666-6666-4666-8666-666666666666';
const poolLine = (overrides: Partial<Line> = {}): Line => line({ id: POOL_LINE, display_name: 'Shared line 1', masked_identity: '+1 415 555 0100',
  routing_status: 'configured', activation_intent: 'enabled', assignment_generation: 12, ...overrides });

test('doctor: a shared project with a live allocation passes the line check like an own line', async () => {
  const r = rig({ lines: [poolLine()] });
  const checks = by(await runDoctor({}, { ...r.deps, shared: () => true }));
  assert.equal(checks.line!.status, 'pass');
  assert.equal(checks.worker!.status, 'pass');
  assert.deepEqual(r.changes, []);
});

test('doctor: a shared project with no line listed names the allocation, not a missing assignment', async () => {
  const r = rig({ lines: [] });
  const checks = by(await runDoctor({}, { ...r.deps, shared: () => true }));
  assert.equal(checks.line!.status, 'fail');
  assert.match(checks.line!.detail, /allocation/);
  assert.match(checks.line!.fix ?? '', /chert onboard --status/);
  assert.doesNotMatch(checks.line!.fix ?? '', /assign/);
  const own = by(await runDoctor({}, rig({ lines: [] }).deps));
  assert.match(own.line!.fix ?? '', /assign/);
});

test('doctor: a centrally paused pool line warns with Chert as the fixer', async () => {
  const r = rig({ lines: [poolLine({ status: 'offline', routing_status: 'paused', activation_intent: 'paused' })] });
  const checks = by(await runDoctor({}, { ...r.deps, shared: () => true }));
  assert.equal(checks.line!.status, 'warn');
  assert.match(checks.line!.detail + (checks.line!.fix ?? ''), /Chert/);
  assert.doesNotMatch(checks.line!.fix ?? '', /Enable calls/);
});
