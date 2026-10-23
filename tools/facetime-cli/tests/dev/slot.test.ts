import test from 'node:test';
import assert from 'node:assert/strict';
import { slotFrom, trackCalls, watchSlot, type Slot } from '../../src/dev/slot.js';
import { describeSession, heldUntil, sessionName } from '../../src/dev/claim.js';
import { sessionLine } from '../../src/cli/present.js';
import type { DevHandler } from '../../src/dev/dispatch-handler.js';
import type { ApplicationCall, RecoveryContext } from '../../src/byor/contract.js';
import { CLIError } from '../../src/cli/errors.js';

// Local times: the slot is read on this computer's clock, whatever its time zone.
const at = (hours: number, minutes: number, seconds = 0) => new Date(2026, 9, 24, hours, minutes, seconds);
const refused = (run: () => unknown): CLIError => {
  try { run(); } catch (error) { if (error instanceof CLIError) return error; throw error; }
  return assert.fail('expected a CLIError');
};

test('slot: --until HH:MM ends today at that minute, on this computer\'s clock', () => {
  assert.deepEqual(slotFrom({ until: '14:10' }, at(14, 0)), { endsAt: at(14, 10).getTime(), label: '14:10' });
  assert.deepEqual(slotFrom({ until: '9:05' }, at(8, 59, 30)), { endsAt: at(9, 5).getTime(), label: '09:05' });
  assert.deepEqual(slotFrom({ until: '23:59' }, at(23, 58)), { endsAt: at(23, 59).getTime(), label: '23:59' });
  assert.equal(slotFrom({}, at(14, 0)), undefined, 'no flag, no slot');
});

test('slot: an --until time that has already passed today is refused, saying the time now', () => {
  for (const [until, now] of [['14:10', at(14, 10)], ['14:10', at(14, 10, 1)], ['09:00', at(14, 0)], ['00:00', at(0, 0, 5)]] as const) {
    const error = refused(() => slotFrom({ until }, now));
    assert.equal(error.code, 'slot_time_passed', until); assert.equal(error.exit, 2);
    assert.match(error.action, new RegExp(`${until.padStart(5, '0')} has already passed today`));
    assert.match(error.action, /--until HH:MM/); assert.match(error.action, /--minutes N/);
  }
});

test('slot: an --until that is not a time of day is refused before anything else', () => {
  for (const until of ['24:00', '14:60', '1410', '14:1', '14:10pm', 'x', ' 14:10', '14:10:00', '-1:00']) {
    const error = refused(() => slotFrom({ until }, at(8, 0)));
    assert.equal(error.code, 'invalid_usage', until); assert.equal(error.exit, 2);
    assert.match(error.action, /--until .*HH:MM.*24-hour/, until);
  }
});

test('slot: --minutes N ends N minutes from now, shown as the minute it ends in', () => {
  // Rounded down to the minute it names, so 'until 14:13' is true and the next team can start at 14:13:00.
  assert.deepEqual(slotFrom({ minutes: '10' }, at(14, 3, 27)), { endsAt: at(14, 13).getTime(), label: '14:13' });
  assert.equal(slotFrom({ minutes: '1' }, at(14, 0))!.endsAt, at(14, 1).getTime());
  assert.equal(slotFrom({ minutes: '240' }, at(14, 0))!.label, '18:00');
  assert.equal(slotFrom({ minutes: '30' }, at(23, 45))!.label, '00:15', 'a slot may run past midnight');
  for (const minutes of ['0', '241', '1.5', '-5', 'x', '', '1e2', '10 ']) {
    const error = refused(() => slotFrom({ minutes }, at(14, 0)));
    assert.equal(error.code, 'invalid_usage', minutes); assert.match(error.action, /--minutes a whole number from 1 to 240/);
  }
});

test('slot: --until and --minutes together are refused', () => {
  const error = refused(() => slotFrom({ until: '15:00', minutes: '10' }, at(14, 0)));
  assert.equal(error.code, 'invalid_usage'); assert.match(error.action, /--until or --minutes, not both/);
});

test('session name: carries the end of the slot, so others see who holds the line and until when', () => {
  assert.equal(sessionName('otter-1a2b', 'ana@example.com', '14:10'), 'dev-otter-1a2b by ana@example.com until 14:10');
  assert.equal(sessionName('otter-1a2b', undefined, '14:10'), 'dev-otter-1a2b until 14:10');
  assert.equal(sessionName('otter-1a2b', 'ana@example.com'), 'dev-otter-1a2b by ana@example.com', 'no slot, the name is as before');
  assert.equal(sessionName('otter', 'ana@example.com', 'soon'), 'dev-otter by ana@example.com', 'only a time this tool wrote is added');
  // The limit stays 100 characters: the agent part gives way first, the address is kept whole, and the time is always kept.
  const long = sessionName('a'.repeat(80), 'firstname.lastname@university.example', '14:10');
  assert.equal(long.length, 100); assert.ok(long.endsWith(' by firstname.lastname@university.example until 14:10'), long);
  assert.equal(describeSession(long), `firstname.lastname@university.example (agent "${'a'.repeat(100 - 'dev-'.length - ' by firstname.lastname@university.example until 14:10'.length)}")`);
  const huge = sessionName('otter', `${'x'.repeat(78)}@example.com`, '14:10');
  assert.equal(huge, 'dev-otter until 14:10', 'an address that no longer fits beside the time is left out, never cut');
  assert.equal(sessionName('a'.repeat(96), undefined, '14:10').length, 100);
});

test('session name: read back as a person, an agent and the end of their slot', () => {
  assert.equal(describeSession('dev-otter-1a2b by ana@example.com until 14:10'), 'ana@example.com (agent "otter-1a2b")');
  assert.equal(heldUntil('dev-otter-1a2b by ana@example.com until 14:10'), '14:10');
  assert.equal(describeSession('dev-otter until 09:05'), 'a session for agent "otter"'); assert.equal(heldUntil('dev-otter until 09:05'), '09:05');
  assert.equal(heldUntil('dev-otter by ana@example.com'), undefined, 'a session started without a slot');
  assert.equal(heldUntil('laptop connector until 14:10'), undefined, 'a name this tool did not write says nothing about a slot');
  assert.equal(describeSession('dev-x by a@b.com until 99:99'), 'a session named "dev-x by a@b.com until 99:99"');
  assert.equal(heldUntil('dev-x by a@b.com until 99:99'), undefined);
  assert.equal(describeSession('dev-x until 14:10 by a@b.com'), 'a session named "dev-x until 14:10 by a@b.com"', 'only the order this tool writes is read');
});

const T = Date.parse('2026-10-24T21:00:00Z');
const call = (id: string, deadline = T + 10_000): ApplicationCall => ({ operation_id: `op_${id}`, project_id: 'p', line_id: 'l', call_id: id, request_id: `req_${id}`,
  deadline_at: deadline, prepare_deadline_at: deadline - 2000, maximum_session_expires_at: T + 3_600_000, media: { audio: true, video: false } });
const context = { signal: new AbortController().signal, remaining_ms: 5000 };
const terminal: RecoveryContext = { authoritative_terminal: true, acceptance: 'accept', cancel_requested: true };
const live: RecoveryContext = { authoritative_terminal: false, acceptance: 'accept', cancel_requested: false };
function handler(seen: string[] = []): DevHandler {
  return { version: 1,
    async prepare(incoming) { seen.push(`prepare ${incoming.call_id}`); return incoming.call_id.startsWith('no')
      ? { action: 'decline' } : { action: 'accept', ready: true, session_ref: 'room', session_expires_at: T + 600_000, livekit_url: 'wss://x', participant_token: 't', remote_participant_identity: 'agent' }; },
    async lifecycle(incoming, event) { seen.push(`lifecycle ${incoming.call_id} ${event.transition}`); return { acknowledged: true }; },
    async recover(incoming) { seen.push(`recover ${incoming.call_id}`); return { settled: true, cleanup: 'clean' }; },
    async warm() {}, async refresh() { return 'warm'; }, async close() {} };
}
const slot: Slot = { endsAt: T + 120_000, label: '14:02' };

test('calls: a call is in progress from its ring until Chert says it ended and its cleanup is done', async () => {
  const seen: string[] = [];
  let ringing!: () => void; const rings = new Promise<void>(resolve => { ringing = resolve; });
  const slow: DevHandler = { ...handler(seen), async prepare(incoming, ctx) { await rings; return handler(seen).prepare(incoming, ctx); } };
  const tracker = trackCalls(slow, slot, () => T);
  assert.equal(tracker.busy(), false);
  const answer = tracker.handler.prepare(call('c1'), context);
  assert.equal(tracker.busy(), true, 'a ringing call counts: stopping now would decline it');
  ringing(); assert.equal((await answer).action, 'accept');
  assert.equal(tracker.busy(), true, 'an answered call counts');
  await tracker.handler.lifecycle!(call('c1'), { event_id: 'e1', transition: 'started' }, live);
  await tracker.handler.recover!(call('c1'), live);
  assert.equal(tracker.busy(), true, 'routine reconciliation of a live call changes nothing');
  await tracker.handler.lifecycle!(call('c1'), { event_id: 'e2', transition: 'ended' }, terminal);
  assert.equal(tracker.busy(), true, 'its cleanup is still to come');
  await tracker.handler.recover!(call('c1'), terminal);
  assert.equal(tracker.busy(), false);
  assert.deepEqual(seen, ['prepare c1', 'lifecycle c1 started', 'recover c1', 'lifecycle c1 ended', 'recover c1'], 'the handler still does all its own work');
  assert.equal(await tracker.handler.refresh(), 'warm', 'and keeps its waiting room');
});

test('calls: a declined call is not in progress, whether the agent declined it or Chert was told no', async () => {
  const tracker = trackCalls(handler(), slot, () => T);
  assert.equal((await tracker.handler.prepare(call('no-agent'), context)).action, 'decline');
  assert.equal(tracker.busy(), false);
  await tracker.handler.prepare(call('late'), context);
  assert.equal(tracker.busy(), true);
  tracker.decided('late', 'decline');
  assert.equal(tracker.busy(), false, 'an answer that came too late was sent to Chert as a decline');
  await tracker.handler.prepare(call('ok'), context); tracker.decided('ok', 'accept');
  assert.equal(tracker.busy(), true);
});

test('calls: a call that rings after the slot ended is declined at once and never reaches the agent', async () => {
  const seen: string[] = [], late: string[] = [];
  const tracker = trackCalls(handler(seen), slot, () => slot.endsAt + 200, callId => late.push(callId));
  assert.equal((await tracker.handler.prepare(call('after'), context)).action, 'decline');
  assert.deepEqual(seen, [], 'answering it now would drop it when the line is released a moment later');
  assert.deepEqual(late, ['after']);
  assert.equal(tracker.busy(), false);
});

test('calls: only the first decision Chert was sent counts, so a redelivered decline never forgets a live call', async () => {
  const tracker = trackCalls(handler(), slot, () => T);
  await tracker.handler.prepare(call('c1'), context);
  tracker.decided('c1', 'accept');
  // After a relay reconnect the call can be offered again and a fresh connector answers no; the call is still up.
  tracker.decided('c1', 'decline');
  assert.equal(tracker.busy(), true);
});

test('calls: a handler that fails to prepare leaves no call in progress', async () => {
  const failing: DevHandler = { ...handler(), async prepare() { throw new Error('boom'); } };
  const tracker = trackCalls(failing, slot, () => T);
  await assert.rejects(tracker.handler.prepare(call('c'), context), /boom/);
  assert.equal(tracker.busy(), false);
});

test('calls: a call that rings after the slot ended is not waited for', async () => {
  const tracker = trackCalls(handler(), slot, () => slot.endsAt);
  await tracker.handler.prepare(call('after'), context);
  assert.equal(tracker.busy(), false);
});

test('calls: a call whose end never arrives stops counting when its session can no longer last', async () => {
  let now = T;
  const tracker = trackCalls(handler(), slot, () => now);
  await tracker.handler.prepare(call('lost'), context);
  now = T + 599_999; assert.equal(tracker.busy(), true);
  now = T + 600_000; assert.equal(tracker.busy(), false, 'the room token the Mac was given has expired');
  const ringing = trackCalls({ ...handler(), prepare: () => new Promise<never>(() => {}) }, slot, () => now);
  now = T; void ringing.handler.prepare(call('stuck', T + 10_000), context);
  assert.equal(ringing.busy(), true); now = T + 10_000; assert.equal(ringing.busy(), false, 'past the answer deadline a ringing call is over');
});

test('calls: a handler without recovery ends a call on its terminal lifecycle event', async () => {
  const { recover: _drop, ...rest } = handler();
  const tracker = trackCalls(rest as DevHandler, slot, () => T);
  assert.equal(tracker.handler.recover, undefined, 'the wrapper offers only what the handler has');
  await tracker.handler.prepare(call('c'), context);
  await tracker.handler.lifecycle!(call('c'), { event_id: 'e', transition: 'failed' }, terminal);
  assert.equal(tracker.busy(), false);
});

function watcher(busy = () => false) {
  let now = T; const records: Record<string, unknown>[] = []; const controller = new AbortController(); let stops = 0;
  const done = watchSlot(slot, { busy: () => busy(), emit: record => { records.push(record); }, stop: () => { stops++; controller.abort(); }, signal: controller.signal, now: () => now, checkMs: 1 });
  const codes = () => records.map(record => String(record.code));
  const settle = () => new Promise(resolve => setTimeout(resolve, 15));
  return { records, codes, settle, done, controller, set: (ms: number) => { now = T + ms; }, get stops() { return stops; } };
}

test('slot watch: one warning a minute before the end, then a stop as Ctrl+C makes', async () => {
  const w = watcher();
  await w.settle(); assert.deepEqual(w.codes(), []);
  w.set(61_000); await w.settle();
  assert.deepEqual(w.codes(), ['slot_ending']);
  assert.equal(w.records[0]!.message, 'One minute left: your slot ends at 14:02. A call still in progress then can finish first.');
  w.set(119_999); await w.settle(); assert.deepEqual(w.codes(), ['slot_ending'], 'said once');
  w.set(120_000); await w.done;
  assert.deepEqual(w.codes(), ['slot_ending', 'slot_over']); assert.equal(w.stops, 1);
  assert.equal(w.records[1]!.message, 'Your slot ended at 14:02. Stopping: releasing the line…');
  assert.equal(w.records[1]!.ends_at, slot.endsAt);
});

test('slot watch: a session started inside the last minute is warned at once, with the right words', async () => {
  const w = watcher();
  w.set(90_000); await w.settle();
  assert.equal(w.records[0]!.message, 'Less than a minute left: your slot ends at 14:02. A call still in progress then can finish first.');
  w.controller.abort(); await w.done;
});

test('slot watch: a call in progress at the end is allowed to finish, said once, then the stop follows', async () => {
  let calling = true;
  const w = watcher(() => calling);
  w.set(61_000); await w.settle();
  w.set(120_000); await w.settle(); await w.settle();
  assert.deepEqual(w.codes(), ['slot_ending', 'slot_waiting_for_call']); assert.equal(w.stops, 0);
  assert.equal(w.records[1]!.message, 'Your slot ended at 14:02 during a call. The call can finish; chert dev then stops and releases the line.');
  w.set(400_000); await w.settle(); assert.equal(w.codes().filter(code => code === 'slot_waiting_for_call').length, 1);
  calling = false; await w.done;
  assert.deepEqual(w.codes(), ['slot_ending', 'slot_waiting_for_call', 'slot_over']); assert.equal(w.stops, 1);
  assert.equal(w.records[2]!.message, 'The call ended and your slot is over. Stopping: releasing the line…');
});

test('slot watch: a stop before the end says nothing and returns', async () => {
  const w = watcher();
  w.controller.abort(); await w.done;
  assert.deepEqual(w.codes(), []); assert.equal(w.stops, 0);
});

test('slot lines: the warning and the wait for a call are marked for attention in a terminal', () => {
  assert.equal(sessionLine({ code: 'slot_ending', message: 'm' }), '! m');
  assert.equal(sessionLine({ code: 'slot_waiting_for_call', message: 'm' }), '! m');
  assert.equal(sessionLine({ code: 'slot_over', message: 'm' }), '  m');
});
