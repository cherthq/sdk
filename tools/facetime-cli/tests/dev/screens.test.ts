import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorLine, sessionLine, styleFor } from '../../src/cli/present.js';
import { renderSession } from '../../src/dev/session-screen.js';
import { visible } from '../../src/dev/frame.js';
import { commands, commandHelp, mainHelp, exitCodes } from '../../src/cli/help.js';
import { renderChecks } from '../../src/dev/doctor.js';
import { runDev, type DevDeps, type DevInput } from '../../src/dev/command.js';
import type { Control, Line } from '../../src/dev/claim.js';
import type { DispatchAPI } from '../../src/dev/dispatch-handler.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
// A home that can be created, in a folder with no env file: the commands here stop before anything is saved.
const emptyFolder = mkdtempSync(join(tmpdir(), 'chert-screens-cwd-'));
const chert = (args: string[]) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', cwd: emptyFolder, env: { PATH: process.env.PATH, CHERT_HOME: join(emptyFolder, 'home') } });
test.after(() => rmSync(emptyFolder, { recursive: true, force: true }));

test('session screen: a mark in the first column, and the time of day on each call line', () => {
  assert.equal(sessionLine({ code: 'dev_connected', message: 'Connected to Chert.' }), '✓ Connected to Chert.');
  assert.equal(sessionLine({ code: 'livekit_env_file', message: 'Using the LiveKit keys in .env.local from this folder.' }), '  Using the LiveKit keys in .env.local from this folder.');
  assert.equal(sessionLine({ code: 'agent_not_warm', message: 'No agent.' }), '✗ No agent.');
  assert.match(sessionLine({ code: 'call_incoming', at: '2026-10-09T16:12:04.000Z', message: 'Incoming call.' })!, /^ {2}\d\d:\d\d:\d\d {2}Incoming call\.$/);
  assert.match(sessionLine({ code: 'call_accepted', at: '2026-10-09T16:12:04.000Z', message: 'Answered in 0.1 s.' })!, /^✓ \d\d:\d\d:\d\d {2}Answered in 0\.1 s\.$/);
  assert.match(sessionLine({ code: 'call_declined', at: '2026-10-09T16:12:04.000Z', message: 'Call declined: the caller hung up.' })!, /^✗ \d\d:\d\d:\d\d {2}Call declined/);
  assert.equal(sessionLine({ code: 'dev_stopped', retained: 0, message: 'Stopped.' }), '✓ Stopped.');
  assert.equal(sessionLine({ code: 'dev_stopped', retained: 2, message: 'Stopped with 2.' }), '! Stopped with 2.');
  assert.equal(sessionLine({ code: 'call_ended', at: 'not a date', message: 'Call ended.' }), '  Call ended.', 'a time that cannot be read is left out, not printed as Invalid Date');
  assert.equal(sessionLine({ code: 'runtime_observation' }), undefined, 'a record with no sentence prints nothing');
});

test('errors: the sentence comes first and the code follows it, so the line reads as an instruction', () => {
  const noAgent = chert(['dev']);
  assert.equal(noAgent.status, 2);
  assert.equal(noAgent.stderr, 'Name your agent: chert dev --agent my-agent, or set AGENT_NAME in .env.local. It is the agent_name your LiveKit agent registers with. (missing_input)\n');
  assert.equal(chert(['docter']).stderr, 'Unknown command "docter". Did you mean chert doctor? Run chert --help. (invalid_command)\n');
  const record = JSON.parse(chert(['dev', '--json']).stderr);
  assert.equal(record.code, 'missing_input', 'the --json record is unchanged');
});

test('help: setup and the operator flags are behind --all; the short help is what a developer needs', () => {
  assert.doesNotMatch(mainHelp(), /^ {2}setup /m);
  assert.match(chert(['--help', '--all']).stdout, /^ {2}setup +Save a project/m);
  const short = commandHelp('dev')!, full = commandHelp('dev', true)!;
  for (const hidden of ['--muse', '--relay-origin', '--backend', 'CHERT_RELAY_ORIGIN', 'Exit codes']) { assert.ok(!short.includes(hidden), hidden); assert.ok(full.includes(hidden), hidden); }
  for (const kept of ['--agent NAME', '--takeover', '--env-file PATH', 'LIVEKIT_URL']) assert.ok(short.includes(kept), kept);
  assert.match(short, /More flags and exit codes: chert dev --help --all$/);
  assert.equal(chert(['dev', '--help', '--all']).stdout, full + '\n');
  assert.equal(chert(['setup', '--help']).stdout, commandHelp('setup') + '\n', 'a hidden command still explains itself');
  assert.ok(commandHelp('login', true)!.includes(exitCodes.slice(0, 30)));
  assert.ok(commands.find(command => command.name === 'setup')!.advanced);
  for (const command of commands) for (const help of [commandHelp(command.name)!, commandHelp(command.name, true)!]) for (const line of help.split('\n')) assert.ok(line.length <= 80, line);
});

test('doctor: one problem is "1 problem", two are "2 problems"', () => {
  const fail = { name: 'agent', status: 'fail' as const, detail: 'No.' };
  assert.match(renderChecks([fail]), /\n1 problem to fix before chert dev will work\.$/);
  assert.match(renderChecks([fail, { ...fail, name: 'line' }]), /\n2 problems to fix before chert dev will work\.$/);
});

const P = '11111111-1111-4111-8111-111111111111', L = '33333333-3333-4333-8333-333333333333', B = '55555555-5555-4555-8555-555555555555';
function rig(display: string | null, prewarm = true) {
  const home = mkdtempSync(join(tmpdir(), 'chert-screens-'));
  const scope = { project_id: P, line_id: L, binding_id: B, binding_epoch: 1, instance_id: B, connection_generation: 0, session_mode: 'byor' as const };
  const line: Line = { id: L, display_name: display, masked_identity: 'd***@example.test', status: 'available', inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 3 };
  const records: Record<string, unknown>[] = []; const state = { agent: true };
  const control: Control = { async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async lines() { return [line]; }, async bindings() { return []; },
    async enroll() { return { scope, credentials: { connection: `ftc_${'a'.repeat(43)}`, recovery: `ftc_${'b'.repeat(43)}` } }; }, async activate() {}, async drain() {}, async revoke() {} };
  const rooms = new Set<string>();
  const api: DispatchAPI = { async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) && state.agent ? [{ identity: 'agent-AJ_1', kind: 'agent' }] : []; }, async deleteRoom(room) { rooms.delete(room); } };
  const controller = new AbortController();
  const deps: DevDeps = { control, api, home, env: {}, signal: controller.signal, emit: record => { records.push(record); },
    run: async (_config, _env, signal, emit) => { emit({ code: 'runtime_observation', phase: 'connected', admission: 'available' }); return new Promise(resolve => signal.addEventListener('abort', () => resolve(0), { once: true })); },
    warmIntervalMs: 5, warmBackoffMs: 5, warmTimeoutMs: 30 };
  const input: DevInput = { agent: 'support', livekitUrl: 'wss://fixture.livekit.invalid', apiKey: 'APIfixture', apiSecret: 'SECRET_SENTINEL_at_least_32_characters_long',
    controlOrigin: 'https://control.example', relayOrigin: 'https://relay.example', takeover: false, prewarm };
  const message = (code: string, nth = 0) => records.filter(record => record.code === code).map(record => String(record.message))[nth];
  const waitFor = async (found: () => unknown) => { const end = Date.now() + 5000; while (!found()) { if (Date.now() > end) throw new Error(`timeout: ${records.map(r => r.code).join(',')}`); await new Promise(r => setTimeout(r, 5)); } };
  return { deps, input, state, records, message, waitFor, stop: () => controller.abort(), close: () => { controller.abort(); rmSync(home, { recursive: true, force: true }); } };
}

test('dev screen: says which line, says when the agent is waiting and what to call, and has no internal caveats', async () => {
  const r = rig('+1 317-555-0100');
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor(() => r.message('agent_warm'));
    assert.equal(r.message('dev_ready'), 'Connecting "support" to +1 317-555-0100 (Team)…');
    assert.equal(r.message('dev_connected'), 'Connected to Chert.');
    assert.equal(r.message('agent_warm'), '"support" is in a waiting room. Call your line (+1 317-555-0100) on FaceTime to talk to it. Ctrl+C to stop.');
    r.stop(); assert.equal(await running, 0);
    for (const record of r.records) assert.doesNotMatch(String(record.message ?? ''), /reported separately|not verified|agent preparation/);
  } finally { r.close(); }
});

test('dev screen: a line with no name is still described, and without a waiting room the connected line carries the instruction', async () => {
  const r = rig(null, false);
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor(() => r.message('dev_connected'));
    assert.equal(r.message('dev_ready'), 'Connecting "support" to d***@example.test (Team)…', 'a line with no label is told apart by its masked address');
    assert.equal(r.message('dev_connected'), 'Connected to Chert. Call your line (d***@example.test) on FaceTime to talk to "support". Ctrl+C to stop.');
    r.stop(); assert.equal(await running, 0);
  } finally { r.close(); }
});

test('dev screen: an agent that was waiting and then stops is said to have left, not to have never joined', async () => {
  const r = rig('Dev line');
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor(() => r.message('agent_warm'));
    r.state.agent = false;
    await r.waitFor(() => r.message('agent_not_warm'));
    assert.equal(r.message('agent_not_warm'), '"support" is NOT in the waiting room, so every call is declined. It left; is it still running? Start it in another terminal (npm start) and check it registers as "support" on the same LiveKit project. Checking again every 10 s.');
    assert.equal(r.records.find(record => record.code === 'agent_not_warm')!.left, true);
    r.state.agent = true;
    await r.waitFor(() => r.message('agent_warm', 1));
    r.stop(); assert.equal(await running, 0);
  } finally { r.close(); }
});

test('dev screen: an agent that never joined is told how to check its name', async () => {
  const r = rig('Dev line'); r.state.agent = false;
  try {
    const running = runDev(r.input, r.deps);
    await r.waitFor(() => r.message('agent_not_warm'));
    assert.equal(r.message('agent_not_warm'), '"support" is NOT in the waiting room, so every call is declined. Is it running? Start it in another terminal (npm start) and check it registers as "support" on the same LiveKit project. Checking again every 10 s.');
    assert.equal(r.records.find(record => record.code === 'agent_not_warm')!.left, undefined);
    r.stop(); assert.equal(await running, 0);
  } finally { r.close(); }
});

test('session screen in a terminal: colour on the marks, a margin like the other screens, and none of it in a pipe', () => {
  assert.equal(styleFor({ isTTY: false }, {}), undefined); assert.equal(styleFor({ isTTY: true }, { TERM: 'dumb' }), undefined);
  assert.deepEqual(styleFor({ isTTY: true }, {}), { color: true }); assert.deepEqual(styleFor({ isTTY: true }, { NO_COLOR: '1' }), { color: false });
  assert.equal(sessionLine({ code: 'dev_connected', message: 'Connected to Chert.' }, { color: true }), '  \x1b[38;5;67m✓\x1b[0m Connected to Chert.');
  assert.equal(sessionLine({ code: 'call_declined', message: 'Call declined.' }, { color: true }), '  \x1b[31m✗\x1b[0m Call declined.');
  assert.equal(sessionLine({ code: 'livekit_env_file', message: 'Using keys.' }, { color: true }), '    Using keys.', 'a line with no mark carries no colour codes');
  assert.equal(sessionLine({ code: 'dev_connected', message: 'Connected to Chert.' }, { color: false }), '  ✓ Connected to Chert.');
  assert.equal(sessionLine({ code: 'dev_ready', screen: true, message: 'DRAWN' }, { color: true }), 'DRAWN', 'a drawn screen is printed as it is');
  assert.equal(errorLine('login_required', 'Sign in first: chert login.', { color: true }), '  \x1b[31m✗\x1b[0m Sign in first: chert login. \x1b[2m(login_required)\x1b[0m');
  assert.equal(errorLine('login_required', 'Sign in first: chert login.'), 'Sign in first: chert login. (login_required)');
});

test('session screen: the header and an ON THE LINE box with agent, line and project', () => {
  const view = { columns: 100, color: false, unicode: true, version: '0.1.0', agent: 'support', line: '+1 317-555-0100', address: 'd***@example.test', project: 'Team' };
  const text = renderSession(view);
  assert.match(text, /CHERT {2}· {2}dev +v0\.1\.0/); assert.match(text, /ON THE LINE/);
  assert.match(text, /Agent +support/); assert.match(text, /Line +\+1 317-555-0100/); assert.match(text, /Address +d\*\*\*@example\.test/); assert.match(text, /Project +Team/); assert.match(text, /Ctrl\+C releases the line\./);
  for (const line of text.split('\n')) assert.ok(visible(line) <= 100, line);
  const narrow = renderSession({ ...view, columns: 28, line: '\x1b[2Jevil' });
  assert.doesNotMatch(narrow, /\x1b/, 'a line name cannot draw on the terminal'); for (const line of narrow.split('\n')) assert.ok(visible(line) <= 28, line);
  assert.doesNotMatch(renderSession({ ...view, unicode: false }), /[─│]/);
});

test('dev screen in a terminal: the opening record is the drawn screen, and Ctrl+C is said once, on it', async () => {
  const r = rig('+1 317-555-0100');
  try {
    const running = runDev(r.input, { ...r.deps, banner: facts => `BANNER ${facts.agent} ${facts.line} ${facts.address} ${facts.project}` });
    await r.waitFor(() => r.message('agent_warm'));
    const ready = r.records.find(record => record.code === 'dev_ready')!;
    assert.equal(ready.message, 'BANNER support +1 317-555-0100 d***@example.test Team'); assert.equal(ready.screen, true);
    assert.equal(r.message('agent_warm'), '"support" is in a waiting room. Call your line (+1 317-555-0100) on FaceTime to talk to it.');
    r.stop(); assert.equal(await running, 0);
  } finally { r.close(); }
});

test('doctor: the line row shows the label and the masked address, and server text cannot draw on the terminal', async () => {
  const { runDoctor } = await import('../../src/dev/doctor.js');
  const row = async (name: string | null, status = 'available') => (await runDoctor({}, { control: {
    async projects() { return [{ id: P, name: 'Team', role: 'owner' }]; }, async bindings() { return []; }, async workers() { return []; },
    async lines() { return [{ id: L, display_name: name, masked_identity: 'd***@example.test\x1b[2J', status, inbound_policy: 'customer_decides', default_assistant_id: null, current_call_id: null, assignment_generation: 1 }]; },
    async enroll() { throw new Error('no'); }, async activate() {}, async drain() {}, async revoke() {} }, session: { signed_in: true }, livekit: { missing: ['LIVEKIT_URL'] } })).find(check => check.name === 'line')!.detail;
  assert.equal(await row('+1 317-555-0100'), '+1 317-555-0100 (d***@example.test[2J) is available.');
  assert.equal(await row('Evil\x1b]0;title\x07 line'), 'Evil]0;title line (d***@example.test[2J) is available.');
  assert.equal(await row('Dev', 'busy\x1b[31m'), 'Dev is busy[31m: the Mac behind it is not accepting calls, or has not confirmed the receiving identity.');
  assert.equal(await row(null), 'Line (d***@example.test[2J) is available.');
});
