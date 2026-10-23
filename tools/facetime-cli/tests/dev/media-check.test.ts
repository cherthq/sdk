import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMedia, devHandler, type DevEvent, type DispatchAPI, type DispatchParticipant } from '../../src/dev/dispatch-handler.js';
import { mediaMessage } from '../../src/dev/command.js';
import { sessionLine } from '../../src/cli/present.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

const AUDIO = 0, VIDEO = 1;
const track = (type: number, muted = false) => ({ source: type === AUDIO ? 2 : 1, type, muted });
const bridge: DispatchParticipant = { identity: 'chert-bridge-call_1', kind: 'standard', tracks: [track(AUDIO)] };
const agent = (tracks: ReturnType<typeof track>[], identity = 'agent-AJ_1'): DispatchParticipant => ({ identity, kind: 'agent', tracks });

test('media: what the Mac will take from the room, judged the way its bridge judges it', () => {
  // The Mac takes audio from the one participant that publishes it, and video only from that same participant.
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO), track(VIDEO)])], true), { state: 'ok', publisher: 'agent-AJ_1' });
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO)])], false), { state: 'ok', publisher: 'agent-AJ_1' });
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO)])], true), { state: 'no_video', publisher: 'agent-AJ_1' });
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO), track(VIDEO)])], false), { state: 'video_unused', publisher: 'agent-AJ_1' });
  assert.deepEqual(assessMedia([bridge, agent([])], true), { state: 'no_audio' });
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO, true)])], true), { state: 'no_audio' }, 'a muted track is not audio');
  assert.deepEqual(assessMedia([bridge], true), { state: 'no_audio' }, 'the bridge itself is never the agent');
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO), track(AUDIO)])], true), { state: 'several_tracks', publisher: 'agent-AJ_1' });
});

test('media: an avatar service is a third participant that speaks and shows for the agent, and that is accepted', () => {
  const avatar = agent([track(AUDIO), track(VIDEO)], 'tavus-avatar-agent');
  assert.deepEqual(assessMedia([bridge, agent([]), avatar], true), { state: 'ok', publisher: 'tavus-avatar-agent' });
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO)]), avatar], true), { state: 'several_audio', publishers: ['agent-AJ_1', 'tavus-avatar-agent'] },
    'the agent must hand its voice to the avatar, not speak beside it');
  assert.deepEqual(assessMedia([bridge, agent([track(AUDIO)]), agent([track(VIDEO)], 'camera-bot')], true), { state: 'video_elsewhere', publisher: 'agent-AJ_1', from: 'camera-bot' });
});

test('media: each verdict is a sentence that says what the caller gets and what to change', () => {
  const said = (event: Partial<DevEvent>) => mediaMessage({ call_id: 'c', event: 'media', ...event } as DevEvent);
  assert.equal(said({ state: 'ok', video: true, publisher: 'agent-AJ_1' }), 'Video and audio are coming from "agent-AJ_1".');
  assert.equal(said({ state: 'ok', video: false, publisher: 'agent-AJ_1' }), 'Audio is coming from "agent-AJ_1".');
  assert.match(said({ state: 'no_video', video: true, publisher: 'a' }), /FaceTime Video call and your agent publishes no video, so the caller sees the line's default picture\. To show your agent, publish a camera track/);
  assert.match(said({ state: 'video_unused', video: false, publisher: 'a' }), /FaceTime Audio call.*Call with FaceTime Video to see it\./);
  assert.match(said({ state: 'no_audio', video: true }), /not publishing audio/);
  assert.match(said({ state: 'several_audio', video: true, publishers: ['a', 'b'] }), /2 participants publish audio \("a", "b"\)\. The Mac needs exactly one/);
  assert.match(said({ state: 'video_elsewhere', video: true, publisher: 'a', from: 'b' }), /Video comes from "b" but audio from "a"/);
  assert.equal(sessionLine({ code: 'call_media', state: 'ok', message: 'm' }), '✓ m');
  assert.equal(sessionLine({ code: 'call_media', state: 'several_audio', message: 'm' }), '✗ m');
  assert.equal(sessionLine({ code: 'call_media', state: 'no_video', message: 'm' }), '! m');
});

function rig(roster: () => DispatchParticipant[]) {
  const events: DevEvent[] = []; const rooms = new Set<string>();
  const api: DispatchAPI = {
    async createRoom(name) { rooms.add(name); return { name, sid: 'RM' }; },
    async listParticipants(room) { return rooms.has(room) ? roster() : []; },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const handler = devHandler({ livekitUrl: 'wss://x.livekit.cloud', apiKey: 'APIkey', apiSecret: 'secret-secret-secret-secret-secret-1234', agentName: 'support', api, pollMs: 2,
    mediaCheckMs: 15, log: event => { events.push(event); } });
  const now = Date.now();
  const call = (video: boolean): ApplicationCall => ({ operation_id: 'op1', project_id: 'p', line_id: 'l', call_id: 'call_1', request_id: 'r',
    deadline_at: now + 10_000, prepare_deadline_at: now + 9_000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video } });
  const until = async (found: () => unknown) => { const end = Date.now() + 3000; while (!found()) { if (Date.now() > end) throw new Error(`timeout ${JSON.stringify(events)}`); await new Promise(r => setTimeout(r, 3)); } };
  return { handler, events, call, until };
}
const context = { authoritative_terminal: false, acceptance: 'accept' as const, cancel_requested: false };

test('dev: the incoming line says whether it is FaceTime Video or Audio, and once the call starts the tracks are checked once', async () => {
  let live = [agent([])];
  const r = rig(() => live);
  const call = r.call(true);
  const decision = await r.handler.prepare(call, { signal: new AbortController().signal, remaining_ms: 9000 });
  assert.equal(r.events.find(event => event.event === 'incoming')!.video, true);
  if (decision.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(call, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: decision.session_ref });
  // Not yet speaking: the check waits and looks again before it says anything.
  await new Promise(resolve => setTimeout(resolve, 20));
  live = [bridge, agent([track(AUDIO), track(VIDEO)])];
  await r.until(() => r.events.some(event => event.event === 'media'));
  assert.deepEqual(r.events.filter(event => event.event === 'media'), [{ call_id: 'call_1', event: 'media', state: 'ok', video: true, publisher: 'agent-AJ_1' }]);
  await r.handler.lifecycle!(call, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: decision.session_ref });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(r.events.filter(event => event.event === 'media').length, 1, 'a repeated started event does not check again');
  await r.handler.lifecycle!(call, { event_id: 'e2', transition: 'ended' }, { ...context, session_ref: decision.session_ref });
  await r.handler.close();
});

test('dev: a call that ends before the check says nothing about media, and a failed read never touches the call', async () => {
  const r = rig(() => [agent([])]);
  const call = r.call(false);
  const decision = await r.handler.prepare(call, { signal: new AbortController().signal, remaining_ms: 9000 });
  if (decision.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(call, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: decision.session_ref });
  await r.handler.lifecycle!(call, { event_id: 'e2', transition: 'ended' }, { ...context, session_ref: decision.session_ref });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(r.events.map(event => event.event), ['incoming', 'accepted', 'ended']);
  await r.handler.close();
});

test('dev: an agent that never publishes audio is reported after the second look', async () => {
  const r = rig(() => [bridge, agent([])]);
  const call = r.call(true);
  const decision = await r.handler.prepare(call, { signal: new AbortController().signal, remaining_ms: 9000 });
  if (decision.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(call, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: decision.session_ref });
  await r.until(() => r.events.some(event => event.event === 'media'));
  assert.equal(r.events.find(event => event.event === 'media')!.state, 'no_audio');
  await r.handler.close();
});

test('dev: video that arrives a moment after the voice is waited for, and one line is said', async () => {
  let live = [bridge, agent([track(AUDIO)])];
  const r = rig(() => live);
  const call = r.call(true);
  const decision = await r.handler.prepare(call, { signal: new AbortController().signal, remaining_ms: 9000 });
  if (decision.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(call, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: decision.session_ref });
  await new Promise(resolve => setTimeout(resolve, 20));
  live = [bridge, agent([track(AUDIO), track(VIDEO)])];
  await r.until(() => r.events.some(event => event.event === 'media'));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(r.events.filter(event => event.event === 'media').map(event => event.state), ['ok']);
  await r.handler.close();
});

test('dev: a room that is already gone says nothing about audio, and recovery of an ended call stops the check', async () => {
  let live: DispatchParticipant[] = [agent([])];
  const r = rig(() => live);
  const call = r.call(true);
  const second = { ...call, call_id: 'call_2', operation_id: 'op2' };
  const accepted = await r.handler.prepare(second, { signal: new AbortController().signal, remaining_ms: 9000 });
  if (accepted.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(second, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: accepted.session_ref });
  live = [];
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(r.events.some(event => event.event === 'media'), false, 'an empty room is a finished call, not a silent agent');
  const third = { ...call, call_id: 'call_3', operation_id: 'op3' };
  live = [bridge, agent([])];
  const again = await r.handler.prepare(third, { signal: new AbortController().signal, remaining_ms: 9000 });
  if (again.action !== 'accept') throw new Error('declined');
  await r.handler.lifecycle!(third, { event_id: 'e1', transition: 'started' }, { ...context, session_ref: again.session_ref });
  await r.handler.recover!(third, { ...context, authoritative_terminal: true, session_ref: again.session_ref });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(r.events.some(event => event.event === 'media'), false, 'a call that recovery ended is not judged afterwards');
  await r.handler.close();
});
