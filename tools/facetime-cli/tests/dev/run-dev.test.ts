import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentCheckEveryMs, runDev, type DevDeps, type DevInput } from '../../src/dev/command.js';
import type { Control, Binding, Line } from '../../src/dev/claim.js';
import type { DevHandler, DispatchAPI } from '../../src/dev/dispatch-handler.js';
import { CLIError } from '../../src/cli/errors.js';

const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
const scope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' as const };
const line: Line = { id: L, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available', inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 3 };
type Step = (context: { signal: AbortSignal; emit: (record: Record<string, unknown>) => void; stateDir: string; handler: DevHandler }) => Promise<number>;
const untilStopped: Step = ({ signal }) => new Promise(resolve => { if (signal.aborted) resolve(0); else signal.addEventListener('abort', () => resolve(0), { once: true }); });

function rig(options: { steps?: Step[]; agentRunning?: boolean; bindings?: Binding[]; failRelease?: CLIError } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'chert-run-dev-'));
  const calls: unknown[][] = []; const records: Record<string, unknown>[] = [];
  const control: Control = {
    async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; },
    async lines() { return [line]; },
    async bindings() { return options.bindings ?? []; },
    async enroll() { calls.push(['enroll']); return { scope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } }; },
    async activate() { calls.push(['activate']); },
    async drain(_project, binding) { if (options.failRelease) throw options.failRelease; calls.push(['drain', binding]); },
    async revoke(_project, binding) { calls.push(['revoke', binding]); },
  };
  const rooms = new Set<string>();
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) && options.agentRunning !== false ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : []; },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const controller = new AbortController();
  const steps = [...(options.steps ?? [untilStopped])]; let runs = 0;
  const deps: DevDeps = { control, api, home, env: {}, signal: controller.signal, emit: record => { records.push(record); },
    run: async (config, _env, signal, emit, handler) => { runs++; const step = steps.shift() ?? untilStopped; return step({ signal, emit, stateDir: config.state_dir, handler: handler as DevHandler }); },
    warmIntervalMs: 10, warmBackoffMs: 10, warmTimeoutMs: 30, reconnectDelayMs: () => 1, maxReconnects: 3 };
  const input: DevInput = { agent: 'support', livekitUrl: 'wss://fixture.livekit.invalid', apiKey: 'APIfixture', apiSecret: 'SECRET_SENTINEL_at_least_32_characters_long',
    controlOrigin: 'https://control.example', relayOrigin: 'https://relay.example', takeover: false, prewarm: true };
  const codes = () => records.map(r => String(r.code));
  const waitFor = async (code: string) => { const end = Date.now() + 5000; while (!codes().includes(code)) { if (Date.now() > end) throw new Error(`no ${code}: ${codes().join(',')}`); await new Promise(r => setTimeout(r, 5)); } };
  return { home, calls, records, rooms, deps, input, codes, waitFor, stop: () => controller.abort(), get runs() { return runs; }, close: () => rmSync(home, { recursive: true, force: true }) };
}
const files = (home: string) => existsSync(join(home, 'dev')) ? readdirSync(join(home, 'dev')) : [];

test('run: a clean stop drains and revokes, removes the warm room, and leaves no credentials or state on disk', async () => {
  const r = rig();
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('agent_warm');
    assert.equal(statSync(join(r.home, 'dev', `${B}.credentials.json`)).mode & 0o777, 0o600);
    r.stop();
    assert.equal(await running, 0);
    assert.deepEqual(r.calls, [['enroll'], ['activate'], ['drain', B], ['revoke', B]]);
    assert.equal(r.rooms.size, 0);
    assert.deepEqual(files(r.home), []);
    assert.equal(r.records.at(-1)!.code, 'dev_stopped'); assert.equal(r.records.at(-1)!.retained, 0);
    assert.ok(!JSON.stringify(r.records).includes('SECRET_SENTINEL'));
    assert.ok(!JSON.stringify(r.records).includes('ftc_'));
  } finally { r.close(); }
});

test('run: when the agent is not running, the developer is told once at startup, not on every check', async () => {
  const r = rig({ agentRunning: false });
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('agent_not_warm');
    await new Promise(resolve => setTimeout(resolve, 150));
    r.stop(); await running;
    assert.equal(r.codes().filter(code => code === 'agent_not_warm').length, 1);
    assert.equal(r.codes().includes('agent_warm'), false);
    assert.equal(r.rooms.size, 0);
  } finally { r.close(); }
});

test('run: --no-prewarm prepares no room and says nothing about warmth', async () => {
  const r = rig();
  try {
    const running = runDev({ ...r.input, prewarm: false }, r.deps);
    await r.waitFor('dev_ready'); await new Promise(resolve => setTimeout(resolve, 40));
    r.stop(); await running;
    assert.equal(r.codes().some(code => code.startsWith('agent_')), false);
  } finally { r.close(); }
});

test('run: a failed first connection is retried like a dropped one', async () => {
  const r = rig({ steps: [async () => { throw new CLIError('transport_unavailable', 6, 'x'); }, async () => 6, untilStopped] });
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('reconnecting');
    while (r.runs < 3) await new Promise(resolve => setTimeout(resolve, 5));
    r.stop();
    assert.equal(await running, 0);
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
  } finally { r.close(); }
});

test('run: giving up after repeated connection loss still releases and revokes when no call work exists', async () => {
  const r = rig({ steps: [async () => 6, async () => 6, async () => 6, async () => 6, async () => 6] });
  try {
    await assert.rejects(runDev(r.input, r.deps), (error: unknown) => error instanceof CLIError && error.code === 'transport_unavailable');
    assert.equal(r.runs, 4, 'one run plus three reconnects');
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
    assert.deepEqual(files(r.home), []);
  } finally { r.close(); }
});

test('run: an unexpected failure releases the line, revokes, and does not claim unfinished work', async () => {
  const r = rig({ steps: [async () => { throw new CLIError('writer_locked', 4, 'x'); }] });
  try {
    await assert.rejects(runDev(r.input, r.deps), (error: unknown) => error instanceof CLIError && error.code === 'writer_locked');
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
    assert.equal(r.records.find(x => x.code === 'dev_stopped')!.retained, 0);
  } finally { r.close(); }
});

test('run: unfinished call work is drained but not revoked, and its state and credentials are kept', async () => {
  const r = rig({ steps: [async ({ emit }) => { emit({ code: 'runtime_stopped', retained: 2 }); return 3; }] });
  try {
    assert.equal(await runDev(r.input, r.deps), 3);
    assert.deepEqual(r.calls.slice(-1), [['drain', B]]);
    assert.deepEqual(files(r.home), [`${B}.credentials.json`]);
    const stopped = r.records.find(x => x.code === 'dev_stopped')!;
    assert.equal(stopped.retained, 2); assert.match(String(stopped.message), /unfinished/);
  } finally { r.close(); }
});

test('run: being displaced by another session is said out loud and the command stops', async () => {
  const r = rig({ steps: [async ({ emit, signal, handler }) => { emit({ code: 'runtime_observation', admission: 'available' }); emit({ code: 'runtime_observation', admission: 'binding_standby' });
    return untilStopped({ signal, emit, stateDir: '', handler }); }] });
  try {
    const exit = await runDev(r.input, r.deps);
    assert.equal(exit, 6);
    assert.equal(r.codes().includes('displaced'), true);
    assert.match(String(r.records.find(x => x.code === 'displaced')!.message), /another session/i);
  } finally { r.close(); }
});

test('run: draining during our own shutdown is not reported as displacement', async () => {
  const r = rig({ steps: [async ({ emit, signal }) => new Promise<number>(resolve => signal.addEventListener('abort', () => { emit({ code: 'runtime_observation', admission: 'binding_draining' }); resolve(0); }, { once: true }))] });
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('dev_ready'); r.stop();
    assert.equal(await running, 0);
    assert.equal(r.codes().includes('displaced'), false);
  } finally { r.close(); }
});

test('run: a stop requested while the line is being claimed releases it without connecting', async () => {
  const r = rig();
  try {
    const activate = r.deps.control.activate.bind(r.deps.control);
    r.deps.control.activate = async (...args) => { await activate(...args); r.stop(); };
    assert.equal(await runDev(r.input, r.deps), 0);
    assert.equal(r.runs, 0);
    assert.deepEqual(r.calls, [['enroll'], ['activate'], ['drain', B], ['revoke', B]]);
  } finally { r.close(); }
});

test('run: an expired session at release is explained, and the exit code is preserved', async () => {
  const r = rig({ failRelease: new CLIError('login_required', 3, 'x') });
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('dev_ready'); r.stop();
    assert.equal(await running, 0);
    const failed = r.records.find(x => x.code === 'release_failed')!;
    assert.match(String(failed.message), /session expired/i);
  } finally { r.close(); }
});

test('run: a session about to expire is flagged at startup', async () => {
  const r = rig();
  try {
    const running = runDev({ ...r.input, sessionExpiresAt: Date.now() + 5 * 60_000 }, r.deps);
    await r.waitFor('session_expiring'); r.stop(); await running;
  } finally { r.close(); }
});

test('run: a leftover state directory from an earlier run with the same binding is not silently reused', async () => {
  const r = rig();
  try {
    mkdirSync(join(r.home, 'dev'), { recursive: true, mode: 0o700 });
    writeFileSync(join(r.home, 'dev', `${B}.credentials.json`), '{}', { mode: 0o600 });
    await assert.rejects(runDev(r.input, r.deps));
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]], 'the binding it just activated is released');
  } finally { r.close(); }
});

test('run: unresolved Muse receipt blocks a new paid preparation before claiming the line', async () => {
  const r = rig();
  try {
    const dir = join(r.home, 'dev', 'previous'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'muse-session.json'), JSON.stringify({ clean: false }));
    await assert.rejects(runDev({ ...r.input, muse: true }, r.deps),
      (error: unknown) => error instanceof CLIError && error.code === 'muse_cleanup_pending');
    assert.deepEqual(r.calls, []); assert.equal(r.rooms.size, 0);
  } finally { r.close(); }
});

test('run: failed Muse cleanup retains its receipt and credentials and blocks the next run', async () => {
  const r = rig({ steps: [untilStopped] });
  r.deps.api.updateMetadata = async () => {};
  try {
    const running = runDev({ ...r.input, muse: true }, r.deps);
    await r.waitFor('muse_warming'); r.stop();
    assert.equal(await running, 3);
    assert.ok(r.codes().includes('cleanup_pending'));
    assert.ok(existsSync(join(r.home, 'dev', B, 'muse-session.json')));
    assert.ok(existsSync(join(r.home, 'dev', `${B}.credentials.json`)));
    assert.ok(!r.calls.some(call => call[0] === 'revoke'));
    await assert.rejects(runDev({ ...r.input, muse: true }, r.deps),
      (error: unknown) => error instanceof CLIError && error.code === 'muse_cleanup_pending');
  } finally { r.close(); }
});

test('run: a decline the connector makes before preparation is reported with its reason, and handler declines are not reported twice', async () => {
  const r = rig({ steps: [async ({ emit, signal, handler }) => {
    emit({ code: 'runtime_observation', admission: 'available' });
    // Declined by the connector's own gate: the handler never saw this call.
    emit({ code: 'call_decision', call_id: 'call_gate', action: 'decline', reason: 'cleanup_pending' });
    // A call the handler answered: the connector's accept prints the handler's report once, and a repeat adds nothing.
    const now = Date.now();
    await handler.prepare({ operation_id: 'op_seen', project_id: P, line_id: L, call_id: 'call_seen', request_id: 'req_seen', deadline_at: now + 5000,
      prepare_deadline_at: now + 4000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: false } }, { signal: new AbortController().signal, remaining_ms: 2000 });
    emit({ code: 'call_decision', call_id: 'call_seen', action: 'accept' });
    emit({ code: 'call_decision', call_id: 'call_seen', action: 'accept' });
    // An accept for a call the handler never reported prints nothing.
    emit({ code: 'call_decision', call_id: 'call_ok', action: 'accept' });
    emit({ code: 'call_decision', call_id: 'call_late', action: 'decline', reason: 'deadline_exceeded' });
    // A reason this version has no words for still prints, with its code.
    emit({ code: 'call_decision', call_id: 'call_odd', action: 'decline', reason: 'frame_too_large' });
    return untilStopped({ signal, emit, stateDir: '', handler });
  }] });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor('call_accepted'); await new Promise(resolve => setTimeout(resolve, 30));
    r.stop(); await running;
    const declined = r.records.filter(x => x.code === 'call_declined');
    assert.deepEqual(declined.map(x => [x.call_id, x.reason]), [['call_gate', 'cleanup_pending'], ['call_late', 'deadline_exceeded'], ['call_odd', 'frame_too_large']]);
    assert.match(String(declined[0]!.message), /clean/i);
    assert.match(String(declined[1]!.message), /too late|time/i);
    assert.match(String(declined[2]!.message), /reason: frame_too_large/);
    assert.deepEqual(r.records.filter(x => x.code === 'call_accepted').map(x => x.call_id), ['call_seen']);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: the memory of calls the handler reported is bounded, and an evicted call is reported if the connector declines it again', async () => {
  const r = rig({ steps: [async ({ emit, signal, handler }) => {
    emit({ code: 'runtime_observation', admission: 'available' });
    const now = Date.now();
    for (let n = 0; n < 300; n++) {
      await handler.prepare({ operation_id: `op_${n}`, project_id: P, line_id: L, call_id: `call_${n}`, request_id: `req_${n}`, deadline_at: now + 5000,
        prepare_deadline_at: now + 4000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: false } }, { signal: new AbortController().signal, remaining_ms: 2000 });
      emit({ code: 'call_decision', call_id: `call_${n}`, action: 'accept' });
    }
    // A redelivered frame for a call already decided is declined as terminal: only a call no longer remembered is reported.
    emit({ code: 'call_decision', call_id: 'call_0', action: 'decline', reason: 'terminal' });
    emit({ code: 'call_decision', call_id: 'call_299', action: 'decline', reason: 'terminal' });
    return untilStopped({ signal, emit, stateDir: '', handler });
  }] });
  const running = runDev({ ...r.input, prewarm: false }, r.deps);
  try {
    await r.waitFor('call_declined'); await new Promise(resolve => setTimeout(resolve, 30));
    r.stop(); await running;
    const declined = r.records.filter(x => x.code === 'call_declined');
    assert.deepEqual(declined.map(x => x.call_id), ['call_0'], 'only the evicted call is reported again; the recent one is not');
    assert.equal(r.records.filter(x => x.code === 'call_accepted').length, 300);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: under --muse a decline the handler made is reported by the handler, not as made before the agent was asked', async () => {
  let preparation = '', frames = 0, stale = false, cleaned = false, prepared: string | undefined;
  const r = rig({ steps: [async ({ emit, signal, handler }) => {
    emit({ code: 'runtime_observation', admission: 'available' });
    await r.waitFor('muse_ready');
    // The agent stops reporting, and a call arrives before the next health sample notices.
    stale = true;
    const now = Date.now();
    prepared = (await handler.prepare({ operation_id: 'op_muse', project_id: P, line_id: L, call_id: 'call_muse', request_id: 'req_muse', deadline_at: now + 5000,
      prepare_deadline_at: now + 4000, maximum_session_expires_at: now + 600_000, media: { audio: true, video: true } }, { signal: new AbortController().signal, remaining_ms: 4000 })).action;
    // The connector reports every handler decline as agent_unavailable.
    emit({ code: 'call_decision', call_id: 'call_muse', action: 'decline', reason: 'agent_unavailable' });
    // A call the gate turned away on Muse health alone never reached the handler, and still says so.
    emit({ code: 'call_decision', call_id: 'call_gate', action: 'decline', reason: 'agent_unavailable' });
    return untilStopped({ signal, emit, stateDir: '', handler });
  }] });
  r.deps.warmTimeoutMs = 5_000;
  r.deps.api.createRoom = async (name, options) => { r.rooms.add(name); preparation = String(JSON.parse(options.agentMetadata).preparation_id); return { name, sid: 'RM' }; };
  r.deps.api.updateMetadata = async () => {};
  r.deps.api.listParticipants = async () => [{ identity: 'muse-agent', kind: 'agent', attributes: { 'chert.muse.preparation': preparation, 'chert.muse.profile': 'muse', 'chert.muse.ready': '1',
    'chert.muse.heartbeat': String(Date.now() - (stale ? 5_000 : 0)), 'chert.muse.video': String(++frames), 'chert.muse.audio': String(frames), 'chert.muse.cleanup': cleaned ? 'clean' : 'pending' },
  tracks: [{ source: 1, muted: false }, { source: 2, muted: false }] }];
  const running = runDev({ ...r.input, muse: true }, r.deps);
  try {
    const seen = (call: string) => r.records.some(x => x.code === 'call_declined' && x.call_id === call);
    const end = Date.now() + 5000; while (!seen('call_gate')) { if (Date.now() > end) throw new Error(`no gate decline: ${r.codes().join(',')}`); await new Promise(resolve => setTimeout(resolve, 5)); }
    cleaned = true; r.stop();
    assert.equal(await running, 0);
    assert.equal(prepared, 'decline');
    const declined = r.records.filter(x => x.code === 'call_declined');
    assert.deepEqual(declined.map(x => [x.call_id, x.reason]), [['call_muse', 'muse_not_ready'], ['call_gate', 'agent_unavailable']]);
    assert.match(String(declined[0]!.message), /Muse/); assert.doesNotMatch(String(declined[0]!.message), /before the agent was asked/);
    assert.match(String(declined[1]!.message), /before the agent was asked/);
    assert.equal(r.records.filter(x => x.code === 'call_incoming' && x.call_id === 'call_muse').length, 1);
  } finally { cleaned = true; r.stop(); await running.catch(() => {}); r.close(); }
});

// A step that reaches Chert, stays connected for `ms`, then loses the relay.
const connectedFor = (ms: number): Step => async ({ emit }) => { emit({ code: 'runtime_observation', phase: 'connected', admission: 'available' }); await new Promise(resolve => setTimeout(resolve, ms)); return 6; };
const lost: Step = async () => 6;

test('run: drops after connections that held do not use up the reconnect limit or grow the wait', async () => {
  const r = rig({ steps: [connectedFor(30), connectedFor(30), connectedFor(30), connectedFor(30), connectedFor(30), connectedFor(30)] });
  const waits: number[] = []; r.deps.reconnectDelayMs = attempt => { waits.push(attempt); return 1; };
  r.deps.stableConnectionMs = 20;
  const running = runDev(r.input, r.deps);
  try {
    const end = Date.now() + 5000; while (r.runs < 7) { if (Date.now() > end) throw new Error(`runs: ${r.runs}, ${r.codes().join(',')}`); await new Promise(resolve => setTimeout(resolve, 5)); }
    r.stop();
    assert.equal(await running, 0, 'six drops with a limit of three: still serving until stopped');
    assert.deepEqual(waits, [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: connections that drop at once still count as failures, so a relay that accepts and closes is given up on', async () => {
  const r = rig({ steps: [connectedFor(0), connectedFor(0), connectedFor(0), connectedFor(0), connectedFor(0)] });
  const waits: number[] = []; r.deps.reconnectDelayMs = attempt => { waits.push(attempt); return 1; };
  try {
    await assert.rejects(runDev(r.input, r.deps), (error: unknown) => error instanceof CLIError && error.code === 'transport_unavailable');
    assert.equal(r.runs, 4);
    assert.deepEqual(waits, [0, 1, 2]);
  } finally { r.close(); }
});

test('run: a connection that held ends a run of failures: only failures in a row count toward the limit', async () => {
  const r = rig({ steps: [lost, lost, connectedFor(30), lost, lost, lost, lost] });
  const waits: number[] = []; r.deps.reconnectDelayMs = attempt => { waits.push(attempt); return 1; };
  r.deps.stableConnectionMs = 20;
  try {
    await assert.rejects(runDev(r.input, r.deps), (error: unknown) => error instanceof CLIError && error.code === 'transport_unavailable');
    assert.deepEqual(waits, [0, 1, 0, 1, 2]);
    assert.equal(r.runs, 6, 'two failures, one connection that held, then a limit of three failures in a row');
  } finally { r.close(); }
});

test('run: a stop during the wait between reconnects releases the line', async () => {
  const r = rig({ steps: [lost, lost] });
  r.deps.reconnectDelayMs = () => 60_000;
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor('reconnecting'); r.stop();
    await running;
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
    assert.equal(r.runs, 1);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('slot: with no call at the end, chert dev warns once a minute before, then stops and releases the line as Ctrl+C does', async () => {
  const r = rig(); let clock = Date.now(); r.deps.now = () => clock; r.deps.slotCheckMs = 2;
  const enrolled: string[] = []; const enroll = r.deps.control.enroll.bind(r.deps.control);
  r.deps.control.enroll = async (project, lineId, name) => { enrolled.push(name); return enroll(project, lineId, name); };
  const running = runDev({ ...r.input, holder: 'ana@example.com', slot: { endsAt: clock + 120_000, label: '14:02' } }, r.deps);
  try {
    await r.waitFor('agent_warm');
    assert.deepEqual(enrolled, ['dev-support by ana@example.com until 14:02'], 'the line says who holds it and until when');
    const set = r.records.find(x => x.code === 'slot_set')!;
    assert.equal(set.message, 'Your slot ends at 14:02. chert dev then stops and releases the line, after any call in progress ends.');
    await sleep(20); assert.equal(r.codes().includes('slot_ending'), false, 'no warning two minutes out');
    clock += 61_000; await r.waitFor('slot_ending');
    clock += 20_000; await sleep(20);
    assert.equal(r.codes().filter(code => code === 'slot_ending').length, 1);
    assert.equal(r.codes().includes('dev_stopped'), false, 'still serving until the end');
    clock += 40_000;
    assert.equal(await running, 0);
    assert.ok(r.codes().indexOf('slot_over') < r.codes().indexOf('dev_stopped'));
    assert.equal(r.codes().includes('slot_waiting_for_call'), false);
    assert.deepEqual(r.calls, [['enroll'], ['activate'], ['drain', B], ['revoke', B]]);
    assert.equal(r.rooms.size, 0); assert.deepEqual(files(r.home), []);
    assert.equal(r.records.at(-1)!.message, 'Stopped. The line no longer routes to this agent.');
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('slot: a call in progress at the end is allowed to finish, this is said once, then the line is released', async () => {
  let clock = Date.now(); let hangUp!: () => void; const hungUp = new Promise<void>(resolve => { hangUp = resolve; });
  const call = { operation_id: 'op_slot', project_id: P, line_id: L, call_id: 'call_slot', request_id: 'req_slot', deadline_at: clock + 10_000,
    prepare_deadline_at: clock + 8_000, maximum_session_expires_at: clock + 3_600_000, media: { audio: true as const, video: false } };
  const r = rig({ steps: [async ({ emit, signal, handler }) => {
    emit({ code: 'runtime_observation', admission: 'available' });
    const decision = await handler.prepare(call, { signal: new AbortController().signal, remaining_ms: 5000 });
    emit({ code: 'call_decision', call_id: 'call_slot', action: decision.action });
    await hungUp;
    await handler.lifecycle!(call, { event_id: 'ev_ended', transition: 'ended' }, { authoritative_terminal: true, acceptance: 'accept', cancel_requested: true });
    await handler.recover!(call, { authoritative_terminal: true, acceptance: 'accept', cancel_requested: true });
    return untilStopped({ signal, emit, stateDir: '', handler });
  }] });
  r.deps.now = () => clock; r.deps.slotCheckMs = 2;
  const running = runDev({ ...r.input, prewarm: false, slot: { endsAt: clock + 120_000, label: '14:02' } }, r.deps);
  try {
    await r.waitFor('call_accepted');
    clock += 61_000; await r.waitFor('slot_ending');
    clock += 60_000; await r.waitFor('slot_waiting_for_call');
    await sleep(30);
    assert.equal(r.codes().includes('slot_over'), false); assert.equal(r.codes().includes('dev_stopped'), false);
    assert.equal(r.calls.some(c => c[0] === 'drain'), false, 'the line is not released under the call');
    assert.equal(r.codes().filter(code => code === 'slot_waiting_for_call').length, 1);
    hangUp();
    assert.equal(await running, 0);
    const codes = r.codes();
    assert.ok(codes.indexOf('call_ended') < codes.indexOf('slot_over') && codes.indexOf('slot_over') < codes.indexOf('dev_stopped'), codes.join(','));
    assert.equal(r.records.find(x => x.code === 'slot_over')!.message, 'The call ended and your slot is over. Stopping: releasing the line…');
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
    assert.equal(r.records.at(-1)!.retained, 0);
  } finally { hangUp(); r.stop(); await running.catch(() => {}); r.close(); }
});

test('slot: Ctrl+C before the end stops as always and the slot says nothing more', async () => {
  const r = rig(); const clock = Date.now(); r.deps.now = () => clock; r.deps.slotCheckMs = 2;
  const running = runDev({ ...r.input, slot: { endsAt: clock + 600_000, label: '14:10' } }, r.deps);
  try {
    await r.waitFor('slot_set'); r.stop();
    assert.equal(await running, 0);
    for (const code of ['slot_ending', 'slot_waiting_for_call', 'slot_over']) assert.equal(r.codes().includes(code), false, code);
    assert.deepEqual(r.calls.slice(-2), [['drain', B], ['revoke', B]]);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('slot: without one nothing about a slot is said and the session name is as before', async () => {
  const r = rig(); const names: string[] = []; const enroll = r.deps.control.enroll.bind(r.deps.control);
  r.deps.control.enroll = async (project, lineId, name) => { names.push(name); return enroll(project, lineId, name); };
  const running = runDev({ ...r.input, holder: 'ana@example.com' }, r.deps);
  try {
    await r.waitFor('agent_warm'); r.stop(); await running;
    assert.deepEqual(names, ['dev-support by ana@example.com']);
    assert.equal(r.codes().some(code => code.startsWith('slot_')), false);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: an absent agent is checked again every 10 s, so a restarted agent is back on the line within about 30 s', () => {
  assert.equal(agentCheckEveryMs('cold', false), 10_000, 'absent agent: 10 s, not 60 s');
  assert.equal(agentCheckEveryMs('warm', false), 5_000, 'agent in its waiting room: unchanged');
  assert.equal(agentCheckEveryMs('cold', true), 1_000, 'Muse: unchanged'); assert.equal(agentCheckEveryMs('warm', true), 1_000);
});

test('run: the opening records state the line, its routing, calls and the Mac before the session starts', async () => {
  const r = rig();
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor('agent_warm');
    const state = r.records.find(x => x.code === 'line_state');
    assert.ok(state, r.codes().join(','));
    assert.match(String(state!.message), /available/);
    assert.ok(r.codes().indexOf('line_state') < r.codes().indexOf('dev_ready'));
    r.stop(); await running;
  } finally { r.close(); }
});

test('run: while the agent stays absent, the warning repeats on the reminder interval and reads as a failure with the fix', async () => {
  const r = rig({ agentRunning: false });
  try {
    const running = runDev(r.input, { ...r.deps, absentReminderMs: 40 });
    await r.waitFor('agent_not_warm');
    await new Promise(resolve => setTimeout(resolve, 200));
    const warnings = r.records.filter(x => x.code === 'agent_not_warm');
    assert.ok(warnings.length >= 2, `${warnings.length} warnings: ${r.codes().join(',')}`);
    assert.match(String(warnings[0]!.message), /NOT in the waiting room/); assert.match(String(warnings[0]!.message), /npm start|registers/);
    r.stop(); await running;
  } finally { r.close(); }
});

test('run: --no-prewarm is allowed but warns that calls are answered cold against a 5 s deadline', async () => {
  const r = rig();
  try {
    const running = runDev({ ...r.input, prewarm: false }, r.deps);
    await r.waitFor('prewarm_off');
    assert.match(String(r.records.find(x => x.code === 'prewarm_off')!.message), /5 s/);
    r.stop(); await running;
  } finally { r.close(); }
});

// A step that reaches Chert, stays connected for `ms`, reports why the relay went away, then loses it.
const lostAfter = (ms: number, reason: string): Step => async ({ emit }) => {
  emit({ code: 'runtime_observation', phase: 'connected', admission: 'available' });
  await new Promise(resolve => setTimeout(resolve, ms));
  emit({ code: 'transport_closed', mode: 'byor', reason });
  return 6;
};
// A step that never reaches Chert and only ends when its own signal is aborted (a relay that accepts the socket and says nothing).
const hangs: Step = ({ signal }) => new Promise(resolve => { signal.addEventListener('abort', () => resolve(0), { once: true }); });

test('run: a reconnect that succeeds is reported, and the lost line names the cause and the attempt', async () => {
  const r = rig({ steps: [lostAfter(30, 'transport_failure'), connectedFor(30), untilStopped] });
  r.deps.stableConnectionMs = 20;
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor('dev_reconnected');
    const lost = r.records.find(record => record.code === 'reconnecting')!;
    assert.equal(lost.reason, 'transport_failure');
    assert.equal(lost.attempt, 1);
    assert.match(String(lost.message), /no heartbeat from the relay/);
    assert.match(String(lost.message), /attempt 1 of 3/);
    const back = r.records.find(record => record.code === 'dev_reconnected')!;
    assert.equal(back.attempt, 1);
    assert.match(String(back.message), /Reconnected to Chert/);
    assert.match(String(back.message), /waiting room is kept/);
    assert.equal(r.records.filter(record => record.code === 'dev_connected').length, 1, 'the first connection is announced once; later ones say reconnected');
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: a reconnect attempt that never reaches Chert is cut off, counted and reported, and the next attempt follows', { timeout: 10_000 }, async () => {
  const r = rig({ steps: [connectedFor(30), hangs, connectedFor(30), untilStopped] });
  r.deps.stableConnectionMs = 20; r.deps.connectTimeoutMs = 40;
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor('dev_reconnected');
    const lost = r.records.filter(record => record.code === 'reconnecting');
    assert.equal(lost.length, 2, 'the drop and the cut-off attempt');
    assert.equal(lost[1]!.reason, 'connect_timeout');
    assert.match(String(lost[1]!.message), /no answer from the relay within/);
    const end = Date.now() + 5000; while (r.runs < 4) { if (Date.now() > end) throw new Error(`runs: ${r.runs}, ${r.codes().join(',')}`); await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.equal(r.runs, 4, 'the first connection, the cut-off attempt, the reconnect and the run that serves until stopped');
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('run: giving up says how many attempts it made, how long it tried and what to do', async () => {
  const r = rig({ steps: [lost, lost, lost, lost] });
  r.deps.reconnectDelayMs = () => 1;
  try {
    await assert.rejects(runDev(r.input, r.deps), (error: unknown) => error instanceof CLIError && error.code === 'transport_unavailable'
      && /3 attempts in a row/.test(error.action) && /over \d+ s/.test(error.action) && /chert dev again/.test(error.action) && /chert doctor/.test(error.action));
  } finally { r.close(); }
});
