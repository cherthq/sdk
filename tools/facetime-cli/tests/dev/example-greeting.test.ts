import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devHandler, type DispatchAPI } from '../../src/dev/dispatch-handler.js';
import type { ApplicationCall } from '../../src/byor/contract.js';

// Both starters greet once on chert dev's bridge_ready signal in the room metadata, never on participant arrival alone,
// and say nothing when the signal never comes. The agents themselves need LiveKit and a model, so the guard they share
// is tested here, and the agents are read for how they use it.

const EXAMPLES = ['student-agent', 'video-agent'] as const;
const folder = (example: string) => fileURLToPath(new URL(`../../../examples/${example}/`, import.meta.url));
const source = (example: string, file: string) => readFileSync(`${folder(example)}${file}`, 'utf8');
interface Room { metadata?: string; on(event: string, listener: () => void): unknown; off(event: string, listener: () => void): unknown }
interface Greeting { bridgeReady(metadata: string | undefined): boolean; greetOnBridgeReady(room: Room, greet: () => void): () => void }
const load = async (example: string) => await import(new URL(`../../../examples/${example}/greet.mjs`, import.meta.url).href) as Greeting;

/** A LiveKit room as @livekit/rtc-node shows it: metadata is updated, then RoomEvent.RoomMetadataChanged fires. */
class FakeRoom extends EventEmitter {
  metadata: string | undefined;
  constructor(metadata?: string) { super(); this.metadata = metadata; }
  set(metadata: string) { this.metadata = metadata; this.emit('roomMetadataChanged', metadata); }
  get listening() { return this.listenerCount('roomMetadataChanged'); }
}
const SIGNAL = JSON.stringify({ chert_call: 'call_1', chert_bridge_ready: true, at: '2026-10-23T17:00:00.000Z' });

for (const example of EXAMPLES) {
  test(`${example}: greets once when the bridge_ready signal arrives, and stops listening`, async () => {
    const { greetOnBridgeReady } = await load(example);
    const room = new FakeRoom(JSON.stringify({ chert_warm: true }));
    let greetings = 0;
    greetOnBridgeReady(room, () => { greetings++; });
    assert.equal(greetings, 0, 'a waiting room is not a call');
    room.set(JSON.stringify({ chert_call: 'call_1' }));
    assert.equal(greetings, 0, 'a call room before bridge_ready');
    room.set(SIGNAL);
    assert.equal(greetings, 1);
    room.set(SIGNAL); room.set(JSON.stringify({ chert_call: 'call_1', chert_bridge_ready: true, at: '2026-10-23T17:00:01.000Z' }));
    assert.equal(greetings, 1, 'never twice');
    assert.equal(room.listening, 0);
  });

  test(`${example}: greets at once when the signal was in the room before the agent looked`, async () => {
    const { greetOnBridgeReady } = await load(example);
    const room = new FakeRoom(SIGNAL);
    let greetings = 0;
    greetOnBridgeReady(room, () => { greetings++; });
    assert.equal(greetings, 1);
    room.set(SIGNAL);
    assert.equal(greetings, 1);
    assert.equal(room.listening, 0);
  });

  test(`${example}: never greets on participant arrival or any other room event`, async () => {
    const { greetOnBridgeReady } = await load(example);
    const room = new FakeRoom(JSON.stringify({ chert_call: 'call_1' }));
    let greetings = 0;
    greetOnBridgeReady(room, () => { greetings++; });
    for (const event of ['participantConnected', 'trackSubscribed', 'trackPublished', 'activeSpeakersChanged', 'participantMetadataChanged']) room.emit(event, SIGNAL);
    assert.equal(greetings, 0);
    assert.equal(room.listening, 1, 'still waiting for the signal');
  });

  test(`${example}: only chert_bridge_ready true is the signal`, async () => {
    const { bridgeReady, greetOnBridgeReady } = await load(example);
    for (const metadata of [undefined, '', 'null', '[]', '5', '"chert_bridge_ready"', 'not json', '{"chert_bridge_ready":"true"}', '{"chert_bridge_ready":1}',
      '{"chert_bridge_ready":false}', '{"chert_warm":true}', '{"chert_call":"call_1"}', '{"chert_muse":{"state":"active"}}']) {
      assert.equal(bridgeReady(metadata), false, String(metadata));
      const room = new FakeRoom();
      let greetings = 0;
      greetOnBridgeReady(room, () => { greetings++; });
      if (metadata !== undefined) room.set(metadata);
      assert.equal(greetings, 0, String(metadata));
    }
    assert.equal(bridgeReady(SIGNAL), true);
    assert.equal(bridgeReady('{"chert_bridge_ready":true}'), true);
  });

  test(`${example}: without the signal there is no greeting, so the caller speaks first`, async () => {
    const { greetOnBridgeReady } = await load(example);
    const room = new FakeRoom(JSON.stringify({ chert_call: 'call_1' }));
    let greetings = 0;
    const stop = greetOnBridgeReady(room, () => { greetings++; });
    stop();
    room.set(SIGNAL);
    assert.equal(greetings, 0, 'a job that ended stops waiting');
    assert.equal(room.listening, 0);
  });

  test(`${example}: a greeting that fails because the call ended is not retried and breaks nothing`, async () => {
    const { greetOnBridgeReady } = await load(example);
    const room = new FakeRoom();
    let attempts = 0;
    greetOnBridgeReady(room, () => { attempts++; throw new Error('AgentSession is not running'); });
    assert.doesNotThrow(() => room.set(SIGNAL));
    room.set(SIGNAL);
    assert.equal(attempts, 1);
  });

  test(`${example}: the agent greets through the guard only, after its session starts, and opens no model session before a participant`, () => {
    const agent = source(example, 'agent.mjs');
    assert.match(agent, /import \{ greetOnBridgeReady \} from '\.\/greet\.mjs';/);
    assert.equal(agent.match(/generateReply\(/g)?.length, 1, 'one greeting, in one place');
    assert.match(agent, /greetOnBridgeReady\(ctx\.room, \(\) => session\.generateReply\(\{ instructions: greeting \}\)\)/);
    const at = (text: string) => { const index = agent.indexOf(text); assert.ok(index >= 0, text); return index; };
    assert.ok(at('await ctx.waitForParticipant()') < at('new voice.AgentSession('), 'no model session before a participant');
    assert.ok(at('await session.start(') < at('greetOnBridgeReady(ctx.room'), 'greets only once the session runs');
    assert.match(agent, /addShutdownCallback\(async \(\) => stopGreeting\(\)\)/, 'stops waiting when the job ends');
    assert.doesNotMatch(agent, /speak first|caller says hello/i, 'the instructions no longer tell the model to wait');
    assert.doesNotMatch(agent, /participantConnected/);
    const greeting = /const greeting = '([^']+)';/.exec(agent)?.[1];
    assert.ok(greeting && greeting.length <= 160 && /one short sentence/.test(greeting), 'a brief greeting instruction');
  });

  test(`${example}: its check script covers the guard, and the files parse`, () => {
    const scripts = (JSON.parse(source(example, 'package.json')) as { scripts: Record<string, string> }).scripts;
    assert.match(scripts.check!, /node --check greet\.mjs/);
    for (const file of ['agent.mjs', 'greet.mjs']) {
      const checked = spawnSync(process.execPath, ['--check', `${folder(example)}${file}`], { encoding: 'utf8' });
      assert.equal(checked.status, 0, `${file}: ${checked.stderr}`);
    }
    assert.doesNotMatch(source(example, 'README.md'), /Say hello first|sends no automatic greeting/);
  });
}

test('examples: both starters carry the same guard', () => {
  assert.equal(source('video-agent', 'greet.mjs'), source('student-agent', 'greet.mjs'));
});

test('examples: the guard greets on exactly what chert dev writes into the room', async () => {
  const rooms = new Map<string, FakeRoom>();
  const api: DispatchAPI = {
    async createRoom(name, created) { rooms.set(name, new FakeRoom(created.metadata)); return { name, sid: `RM_${name}` }; },
    async listParticipants(room) { return rooms.has(room) ? [{ identity: 'agent-AJ_1', kind: 'agent' as const }] : []; },
    async updateMetadata(room, metadata) { rooms.get(room)!.set(metadata); },
    async deleteRoom(room) { rooms.delete(room); },
  };
  const handler = devHandler({ livekitUrl: 'wss://agent-project.livekit.cloud', apiKey: 'APIdevkey000001', apiSecret: 'dev-secret-that-must-stay-on-this-machine-0123456789',
    agentName: 'support', api, pollMs: 2, prewarm: true, mediaCheckMs: 60_000, bridgePollMs: 10, readCall: async () => 'ready' });
  await handler.warm();
  const [warm] = [...rooms.values()];
  const greeted: string[] = [];
  for (const example of EXAMPLES) (await load(example)).greetOnBridgeReady(warm!, () => { greeted.push(example); });
  assert.deepEqual(greeted, [], 'a warm job is not greeted');
  const now = Date.now();
  const incoming: ApplicationCall = { operation_id: 'operation_g', project_id: 'project', line_id: 'line', call_id: 'call_g', request_id: 'request_g',
    deadline_at: now + 10_000, prepare_deadline_at: now + 9_000, maximum_session_expires_at: now + 3600_000, media: { audio: true, video: true } };
  assert.equal((await handler.prepare(incoming, { signal: new AbortController().signal, remaining_ms: 9_000 })).action, 'accept');
  const end = Date.now() + 3000;
  while (greeted.length < EXAMPLES.length) { if (Date.now() > end) throw new Error(`greeted: ${greeted.join(',')}`); await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.deepEqual(greeted, [...EXAMPLES], 'each starter greets once on the signal in its warm room');
  await handler.close();
});
