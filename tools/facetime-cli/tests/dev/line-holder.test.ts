import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLine, controlClient, describeSession, sessionName, type Binding, type Control, type Line } from '../../src/dev/claim.js';
import { runDoctor } from '../../src/dev/doctor.js';
import { CLIError } from '../../src/cli/errors.js';

const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
const scope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' as const };
const line: Line = { id: L, display_name: 'Dev line', masked_identity: 'd***@example.test', status: 'available', inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 3 };
const held = (name: string): Binding => ({ name, scope, state: 'active', connected: true, environment: 'production' });
const control = (bindings: Binding[]): Control => ({
  async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async lines() { return [line]; }, async bindings() { return bindings; },
  async enroll() { throw new Error('must not enroll'); }, async activate() {}, async drain() {}, async revoke() {} });
const failure = async (run: Promise<unknown>) => { try { await run; } catch (error) { if (error instanceof CLIError) return error; throw error; } throw new Error('did not fail'); };

test('session name: carries who holds the line and with which agent, within the server limit', () => {
  assert.equal(sessionName('otter-1a2b', 'ana@example.com'), 'dev-otter-1a2b by ana@example.com');
  assert.equal(sessionName('otter-1a2b'), 'dev-otter-1a2b');
  // The address is never cut: the agent part gives way, and an address that cannot fit is left out.
  const long = sessionName('a'.repeat(80), 'firstname.lastname@university.example');
  assert.ok(long.length <= 100); assert.equal(describeSession(long), `firstname.lastname@university.example (agent "${'a'.repeat(96 - ' by firstname.lastname@university.example'.length)}")`);
  const huge = sessionName('otter', `${'x'.repeat(200)}@example.com`);
  assert.equal(huge, 'dev-otter'); assert.equal(describeSession(huge), 'a session for agent "otter"');
  assert.equal(sessionName('otter', 'not an address'), 'dev-otter');
  assert.equal(sessionName('otter', 'evil\x1b[2J@example.com'), 'dev-otter by evil[2J@example.com', 'control characters never reach the server or another terminal');
});

test('session name: read back as a person and an agent; an older or foreign name is shown as it is', () => {
  assert.equal(describeSession('dev-otter-1a2b by ana@example.com'), 'ana@example.com (agent "otter-1a2b")');
  assert.equal(describeSession('dev-otter-1a2b'), 'a session for agent "otter-1a2b"');
  assert.equal(describeSession('laptop connector'), 'a session named "laptop connector"');
  // Only the shapes this tool writes are read as a person. Free text someone put in a name is shown as a name.
  assert.equal(describeSession('dev-x by \x1b[31mred'), 'a session named "dev-x by [31mred"');
  assert.equal(describeSession('dev-x by the boss, trust me'), 'a session named "dev-x by the boss, trust me"');
  assert.equal(describeSession('dev-x by a@b.com by boss@corp.com'), 'a session named "dev-x by a@b.com by boss@corp.com"');
  assert.equal(describeSession('dev-x by boss\u202e@corp.com'), 'boss@corp.com (agent "x")', 'direction marks are removed before the name is read');
  assert.equal(describeSession('team \u{1F468}\u200d\u{1F469}\u200d\u{1F467} line'), 'a session named "team \u{1F468}\u200d\u{1F469}\u200d\u{1F467} line"', 'a joined emoji stays joined');
});

test('line in use: the message names the person to ask, then the way to take the line', async () => {
  const error = await failure(claimLine(control([held('dev-otter-1a2b by ana@example.com')]), { name: sessionName('heron-9f', 'ben@example.com') }));
  assert.equal(error.code, 'line_in_use');
  assert.equal(error.action, 'ana@example.com (agent "otter-1a2b") is on this line now. Ask them to stop with Ctrl+C, or run chert dev --takeover to replace them.');
  const old = await failure(claimLine(control([held('dev-otter-1a2b')]), { name: 'dev-heron' }));
  assert.match(old.action, /^A session for agent "otter-1a2b" is on this line now\./);
});

test('line in use: a holder with a slot is shown with the time it ends', async () => {
  const error = await failure(claimLine(control([held('dev-otter-1a2b by ana@example.com until 14:10')]), { name: sessionName('heron-9f', 'ben@example.com', '14:20') }));
  assert.equal(error.code, 'line_in_use');
  assert.equal(error.action, 'ana@example.com (agent "otter-1a2b") is on this line until 14:10. Try again then, or ask them to stop with Ctrl+C, or run chert dev --takeover to replace them.');
  const anonymous = await failure(claimLine(control([held('dev-otter until 09:05')]), { name: 'dev-heron' }));
  assert.match(anonymous.action, /^A session for agent "otter" is on this line until 09:05\. Try again then,/);
});

test('doctor: a held line with a slot says who holds it and until when', async () => {
  const checks = await runDoctor({}, { control: { ...control([held('dev-otter-1a2b by ana@example.com until 14:10')]), async workers() { return []; } },
    session: { signed_in: true }, livekit: { missing: ['LIVEKIT_URL'] } });
  const free = checks.find(check => check.name === 'line_free')!;
  assert.equal(free.status, 'fail'); assert.equal(free.detail, 'ana@example.com (agent "otter-1a2b") is on the line until 14:10.');
});

test('doctor: a held line says who holds it', async () => {
  const checks = await runDoctor({}, { control: { ...control([held('dev-otter-1a2b by ana@example.com')]), async workers() { return []; } },
    session: { signed_in: true }, livekit: { missing: ['LIVEKIT_URL'] } });
  const free = checks.find(check => check.name === 'line_free')!;
  assert.equal(free.status, 'fail'); assert.equal(free.detail, 'ana@example.com (agent "otter-1a2b") is on the line now.');
  assert.match(free.fix!, /Ask them to stop, or start chert dev with --takeover/);
});

test('a refusal from Chert says whether it is about permission or about the state of the line', async () => {
  const original = globalThis.fetch;
  const reply = (status: number) => { globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 'connector_request_rejected' } }), { status })) as typeof fetch; };
  try {
    const client = controlClient('https://control.example', 'token');
    reply(403); const forbidden = await failure(client.bindings(P));
    assert.equal(forbidden.code, 'backend_request_forbidden'); assert.match(forbidden.action, /owner or admin/);
    reply(409); const conflict = await failure(client.bindings(P));
    assert.equal(conflict.code, 'backend_request_conflict'); assert.match(conflict.action, /changed while this command ran.*chert doctor/);
    reply(500); assert.equal((await failure(client.bindings(P))).code, 'backend_request_rejected');
  } finally { globalThis.fetch = original; }
});

test('displaced: the session that was replaced stops once, says how to see who holds the line, and does not reconnect', async () => {
  const { runDev } = await import('../../src/dev/command.js');
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'chert-holder-'));
  const records: Record<string, unknown>[] = []; const enrolled: string[] = [];
  const api: Control = { async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async lines() { return [line]; }, async bindings() { return []; },
    async enroll(_project, _line, name) { enrolled.push(name); return { scope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } }; }, async activate() {}, async drain() {}, async revoke() {} };
  try {
    const exit = await runDev({ agent: 'otter-1a2b', holder: 'ana@example.com', livekitUrl: 'wss://x.livekit.invalid', apiKey: 'k', apiSecret: 's'.repeat(40), controlOrigin: 'https://c.example', relayOrigin: 'https://r.example', takeover: false, prewarm: false },
      { control: api, api: { async createRoom(name) { return { name, sid: 'RM' }; }, async listParticipants() { return []; }, async deleteRoom() {} }, home, env: {}, signal: new AbortController().signal, emit: record => { records.push(record); },
        run: async (_config, _env, signal, emit) => {
          emit({ code: 'runtime_observation', phase: 'connected', admission: 'available' });
          emit({ code: 'runtime_observation', phase: 'connected', admission: 'binding_standby' });
          emit({ code: 'runtime_observation', phase: 'connected', admission: 'binding_draining' });
          // The session stops as soon as it is replaced, so the stop may already have happened here.
          return signal.aborted ? 0 : new Promise(resolve => signal.addEventListener('abort', () => resolve(0), { once: true }));
        } });
    assert.equal(exit, 6); assert.deepEqual(enrolled, ['dev-otter-1a2b by ana@example.com']);
    const displaced = records.find(record => record.code === 'displaced')!;
    assert.equal(displaced.message, 'Another session took over this line, so calls no longer reach this agent. Run chert doctor to see who holds it. Stopping.');
    assert.equal(records.filter(record => record.code === 'displaced').length, 1, 'said once, however many times the state is reported');
    assert.ok(records.findIndex(record => record.code === 'displaced') < records.findIndex(record => record.code === 'dev_stopped'), 'and before the session says it stopped');
    assert.equal(records.some(record => record.code === 'reconnecting'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
