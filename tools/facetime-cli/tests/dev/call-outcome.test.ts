import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDev, type DevDeps, type DevInput } from '../../src/dev/command.js';
import type { Control, Line } from '../../src/dev/claim.js';
import type { DispatchAPI, DispatchParticipant } from '../../src/dev/dispatch-handler.js';
import type { ByorHandler } from '../../src/byor/contract.js';
import { ByorConnector } from '../../src/byor/connector.js';
import { ByorJournal } from '../../src/byor/journal.js';
import type { Decision, Incoming, Scope } from '../../src/protocol/v1.js';
import { ManualClock, deferred } from '../fixtures/clock.js';

// The terminal reports what Chert was told about each call: the connector's first decision decides between
// "Answered" and a decline, and the handler's own report supplies the detail (timing, or why it declined).

const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
const devScope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' as const };
const line: Line = { id: L, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available', inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 3 };
const scope: Scope = { project_id: 'project', line_id: 'line', binding_id: 'binding', binding_epoch: 1, instance_id: 'instance', connection_generation: 1, session_mode: 'byor' };
function incoming(clock: ManualClock): Incoming {
  return { ...scope, v: 1, type: 'call.incoming', message_id: 'message_1', call_id: 'call_1', request_id: 'request_1', integration_revision_id: 'revision',
    created_at: clock.wall(), sent_at: clock.wall(), deadline_at: clock.wall() + 5000, prepare_deadline_at: clock.wall() + 4000, remaining_ms: 5000,
    resource_expires_at: clock.wall() + 600_000, media: { audio: true, video: false } };
}
/** What run.ts reports for every decision the connector makes. */
const report = (emit: (r: Record<string, unknown>) => void, decision: Decision) =>
  emit({ code: 'call_decision', mode: 'byor', call_id: decision.call_id, action: decision.action, ...(decision.action === 'decline' ? { reason: decision.reason } : {}) });
type Step = (context: { emit: (r: Record<string, unknown>) => void; handler: ByorHandler; connector: () => { connector: ByorConnector; clock: ManualClock } }) => Promise<void>;

function rig(api: DispatchAPI, step: Step) {
  const home = mkdtempSync(join(tmpdir(), 'chert-call-outcome-'));
  const records: Record<string, unknown>[] = [];
  const control: Control = {
    async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async lines() { return [line]; }, async bindings() { return []; },
    async enroll() { return { scope: devScope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } }; },
    async activate() {}, async drain() {}, async revoke() {},
  };
  const controller = new AbortController();
  const deps: DevDeps = { control, api, home, env: {}, signal: controller.signal, emit: record => { records.push(record); },
    run: async (_config, _env, signal, emit, handler) => {
      const connector = () => {
        const clock = new ManualClock(); clock.time = Date.now();
        return { connector: new ByorConnector(scope, new ByorJournal(scope, { id: 'chert-dev-v1', module: '/builtin/dispatch-handler.js' }), handler, clock), clock };
      };
      emit({ code: 'runtime_observation', admission: 'available' });
      await step({ emit, handler, connector });
      return new Promise(resolve => { if (signal.aborted) resolve(0); else signal.addEventListener('abort', () => resolve(0), { once: true }); });
    }, reconnectDelayMs: () => 1, maxReconnects: 0 };
  const input: DevInput = { agent: 'support', livekitUrl: 'wss://fixture.livekit.invalid', apiKey: 'APIfixture', apiSecret: 'SECRET_SENTINEL_at_least_32_characters_long',
    controlOrigin: 'https://control.example', relayOrigin: 'https://relay.example', takeover: false, prewarm: false };
  const outcome = () => records.filter(r => r.call_id === 'call_1' && (r.code === 'call_accepted' || r.code === 'call_declined'));
  const shown = () => records.filter(r => r.call_id === 'call_1' && String(r.code).startsWith('call_') && r.code !== 'call_decision').map(r => `${String(r.code)}: ${String(r.message)}`).join('\n');
  const waitFor = async (predicate: () => boolean) => { const end = Date.now() + 5000; while (!predicate()) { if (Date.now() > end) throw new Error(`timeout:\n${shown()}`); await new Promise(r => setTimeout(r, 5)); } };
  const settleOutput = () => new Promise(resolve => setTimeout(resolve, 50));
  return { records, deps, input, outcome, shown, waitFor, settleOutput, stop: () => controller.abort(), close: () => rmSync(home, { recursive: true, force: true }) };
}
const agentRoom = (): DispatchAPI => {
  const rooms = new Set<string>();
  return { async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : []; },
    async deleteRoom(room) { rooms.delete(room); } };
};

test('call outcome: a call the connector declined at its deadline is shown as declined for that reason, never as answered', async () => {
  const listing = deferred<DispatchParticipant[]>(), asked = deferred(), deleted: string[] = [];
  const api: DispatchAPI = {
    async createRoom(name) { return { name, sid: 'RM' }; },
    // The agent read in flight when the prepare deadline passes answers late, with the agent in the room.
    async listParticipants() { asked.resolve(); return listing.promise; },
    async deleteRoom(room) { deleted.push(room); },
  };
  let decision: Decision | undefined;
  const r = rig(api, async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    const pending = c.incoming(incoming(clock));
    await asked.promise;
    clock.advance(4000);
    decision = await pending; report(emit, decision);
    listing.resolve([{ identity: 'agent-AJ_1', kind: 'agent' }]);
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.equal(decision?.action === 'decline' && decision.reason, 'deadline_exceeded');
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'deadline_exceeded']], r.shown());
    assert.match(String(r.outcome()[0]!.message), /deadline|in time/i);
    assert.doesNotMatch(String(r.outcome()[0]!.message), /before the agent was asked/);
    // The room of a call nobody will join is removed, not left with the agent in it.
    await r.waitFor(() => deleted.length > 0);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: a call declined because room creation outlasted the budget is not blamed on the caller', async () => {
  const creating = deferred<{ name: string; sid: string }>(), asked = deferred();
  const api: DispatchAPI = {
    async createRoom() { asked.resolve(); return creating.promise; },
    async listParticipants() { return [{ identity: 'agent-AJ_1', kind: 'agent' }]; },
    async deleteRoom() {},
  };
  const r = rig(api, async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    const pending = c.incoming(incoming(clock));
    await asked.promise;
    clock.advance(4000);
    report(emit, await pending);
    creating.resolve({ name: 'chert-room', sid: 'RM' });
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'deadline_exceeded']], r.shown());
    assert.doesNotMatch(r.shown(), /hung up|Answered/);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: a caller who hangs up while the agent is joining is reported once, as a hang-up', async () => {
  const listing = deferred<DispatchParticipant[]>(), asked = deferred();
  const api: DispatchAPI = { async createRoom(name) { return { name, sid: 'RM' }; }, async listParticipants() { asked.resolve(); return listing.promise; }, async deleteRoom() {} };
  const r = rig(api, async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    const frame = incoming(clock);
    const pending = c.incoming(frame);
    await asked.promise;
    c.cancel({ ...scope, v: 1, type: 'call.cancel', message_id: 'cancel_1', call_id: frame.call_id, request_id: frame.request_id, call_version: 1, terminal: true, reason: 'caller_cancelled' });
    report(emit, await pending);
    listing.resolve([]);
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'terminal']], r.shown());
    assert.match(String(r.outcome()[0]!.message), /hung up/);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: an answered call is shown once with its timing, however often its decision is reported', async () => {
  const r = rig(agentRoom(), async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    const frame = incoming(clock);
    const decision = await c.incoming(frame);
    report(emit, decision);
    // The relay redelivers the frame when it missed the answer; the connector returns the same decision.
    report(emit, await c.incoming(frame)); report(emit, decision);
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => x.code), ['call_accepted'], r.shown());
    assert.match(String(r.outcome()[0]!.message), /^Answered in \d+\.\d s/);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: a decline the agent caused is explained by the handler once, not again as a connector decline', async () => {
  const rooms = new Set<string>();
  const api: DispatchAPI = { async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; }, async listParticipants() { return []; }, async deleteRoom(room) { rooms.delete(room); } };
  const r = rig(api, async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    const frame = { ...incoming(clock), remaining_ms: 1500, deadline_at: clock.wall() + 1500, prepare_deadline_at: clock.wall() + 400 };
    // Sent at creation with 1.5 s left: the window is short enough that the agent cannot join in time.
    report(emit, await c.incoming({ ...frame, created_at: clock.wall() - 100, sent_at: clock.wall() - 100 }));
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'agent_did_not_join']], r.shown());
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: a decline the connector makes before the agent is asked is shown once when the relay redelivers the call', async () => {
  const r = rig(agentRoom(), async ({ emit }) => {
    for (let n = 0; n < 3; n++) emit({ code: 'call_decision', mode: 'byor', call_id: 'call_1', action: 'decline', reason: 'cleanup_pending' });
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'cleanup_pending']], r.shown());
    assert.match(String(r.outcome()[0]!.message), /before the agent was asked/);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});

test('call outcome: a clock behind Chert is named as the likely cause, not the CLI version', async () => {
  const r = rig(agentRoom(), async ({ emit, connector }) => {
    const { connector: c, clock } = connector();
    // Chert stamped the call 450 ms ahead of this computer's clock.
    report(emit, await c.incoming({ ...incoming(clock), created_at: clock.wall() + 450, sent_at: clock.wall() + 450, deadline_at: clock.wall() + 5450, prepare_deadline_at: clock.wall() + 4450 }));
  });
  const running = runDev(r.input, r.deps);
  try {
    await r.waitFor(() => r.outcome().length > 0); await r.settleOutput();
    assert.deepEqual(r.outcome().map(x => [x.code, x.reason]), [['call_declined', 'invalid_deadline']], r.shown());
    assert.match(String(r.outcome()[0]!.message), /clock/i);
    assert.match(String(r.outcome()[0]!.message), /date and time automatically/i);
  } finally { r.stop(); await running.catch(() => {}); r.close(); }
});
