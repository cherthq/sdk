import { expect, test } from 'bun:test';
import { connectLivingPage, parseHostMessage, PROTOCOL, startLivingPreview, type Json, type LivingInput } from './index';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
/** A same-realm window stand-in: the preview posts `connect` to it and the page listens on it. */
const ORIGIN = 'https://page.example';
interface FakeWindow { addEventListener: EventTarget['addEventListener']; removeEventListener: EventTarget['removeEventListener']; postMessage(data: unknown, targetOrigin: string, ports?: MessagePort[], source?: unknown): void }
function fakeWindow(senderOrigin = ORIGIN): FakeWindow {
  const target = new EventTarget();
  const win: FakeWindow = {
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target),
    postMessage(data: unknown, targetOrigin: string, ports: MessagePort[] = [], source: unknown = win) {
      if (targetOrigin !== '*' && targetOrigin !== ORIGIN) return;   // browsers drop mismatched targetOrigin
      queueMicrotask(() => { const e = new MessageEvent('message', { data, ports, origin: senderOrigin });
        Object.defineProperty(e, 'source', { value: source }); target.dispatchEvent(e); });
    },
  };
  return win;
}
const trustedFor = (win: object) => ({ source: win, origin: ORIGIN });

test('protocol: strict host message parsing rejects malformed, oversized and unknown messages', () => {
  expect(parseHostMessage({ type: 'start', session_id: 's', viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer'], state: { a: 1 }, revision: 0 }))
    .toEqual({ type: 'start', session_id: 's', viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer'], state: { a: 1 }, revision: 0 });
  for (const bad of [null, 'start', { type: 'nope' },
    { type: 'start', session_id: 's', viewport: { width: 1281, height: 720 }, fps: 30, input: [], state: null, revision: 0 },
    { type: 'start', session_id: 's', viewport: { width: 1280, height: 720 }, fps: 31, input: [], state: null, revision: 0 },
    { type: 'start', session_id: 's', viewport: { width: 1280, height: 720 }, fps: 30, input: ['mouse'], state: null, revision: 0 },
    { type: 'state', revision: 1, state: { big: 'x'.repeat(64 * 1024) } },
    { type: 'state', revision: -1, state: null }, { type: 'state', revision: 1, state: { d: new Date() } },
    { type: 'event', event: 'Bad Name', data: null }, { type: 'event', event: 'ok', data: 'x'.repeat(16 * 1024) },
    { type: 'input', input: { kind: 'pointer', action: 'move', x: 1.5, y: 0 } }, { type: 'input', input: { kind: 'keyboard', action: 'down', key: '' } }])
    expect(parseHostMessage(bad)).toBeNull();
});

test('page + preview: full lifecycle over a real MessageChannel with ordered state, events, gated input and messages', async () => {
  const win = fakeWindow();
  const seen: unknown[] = [];
  let stopReleased = false;
  const page = connectLivingPage<{ count: number }>({
    async onStart(start) { seen.push(['start', start.viewport, start.state, start.revision, start.input]); await tick(5); },
    onState: (state, revision) => seen.push(['state', state.count, revision]),
    onEvent: (event, data) => seen.push(['event', event, data]),
    onCallEvent: e => seen.push(['call', e.type]),
    onInput: (i: LivingInput) => seen.push(['input', i.kind]),
    async onStop(reason) { seen.push(['stop', reason]); await tick(5); stopReleased = true; },
  }, { target: win, trusted: trustedFor(win), heartbeatMs: 10 });
  expect(page.state).toBe('connecting');
  const preview = startLivingPreview(win, { origin: ORIGIN, viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer'], state: { count: 0 } });
  const events: unknown[] = [];
  preview.on('message', (m, d) => events.push(['message', m, d]));
  preview.on('health', (s, c) => events.push(['health', s, c]));
  let heartbeats = 0; preview.on('heartbeat', () => heartbeats++);
  await new Promise<void>(r => preview.on('ready', r));
  expect(page.state).toBe('live');
  expect(() => preview.sendInput({ kind: 'text', text: 'x' })).toThrow('not enabled');
  preview.setState({ count: 1 }); preview.setState({ count: 2 });
  preview.sendEvent('order.updated', { id: 7 });
  preview.sendCallEvent({ type: 'remote_video_ready', at: '2026-10-25T00:00:00Z' });
  preview.sendInput({ kind: 'pointer', action: 'down', x: 0.25, y: 0.75 });
  page.send('customer.choice', { option: 'b' }); page.health('degraded', 'slow_frame');
  expect(() => page.send('Bad', null)).toThrow();
  expect(() => page.send('ok', { secret: 'x'.repeat(16 * 1024) })).toThrow('exceeds');
  await tick(40);
  expect(heartbeats).toBeGreaterThanOrEqual(2);
  const stopped = new Promise<void>(r => preview.on('stopped', r));
  preview.stop('call_ended');
  await stopped;
  expect([stopReleased, page.state]).toEqual([true, 'stopped']);  // `stopped` is acknowledged only after onStop resolves
  expect(seen).toEqual([['start', { width: 1280, height: 720 }, { count: 0 }, 0, ['pointer']], ['state', 1, 1], ['state', 2, 2],
    ['event', 'order.updated', { id: 7 }], ['call', 'remote_video_ready'], ['input', 'pointer'], ['stop', 'call_ended']]);
  expect(events).toEqual([['message', 'customer.choice', { option: 'b' }], ['health', 'degraded', 'slow_frame']]);
  expect(() => page.send('late', null)).toThrow('not live');
});

test('page: ignores foreign connect messages and stale revisions; preview fails when the page never becomes ready', async () => {
  const win = fakeWindow();
  const states: number[] = [];
  const page = connectLivingPage({ onState: (_s, r) => states.push(r) }, { target: win, trusted: trustedFor(win) });
  win.postMessage({ protocol: 'other', type: 'connect' }, '*', [new MessageChannel().port1]);
  win.postMessage({ protocol: PROTOCOL, type: 'connect' }, '*', []);   // no port
  win.postMessage({ protocol: PROTOCOL, type: 'connect' }, '*', [new MessageChannel().port1], { other: 'frame' });   // wrong source
  const foreign = fakeWindow('https://evil.example');
  const guarded = connectLivingPage({}, { target: foreign, trusted: trustedFor(foreign) });
  foreign.postMessage({ protocol: PROTOCOL, type: 'connect' }, '*', [new MessageChannel().port1]);   // wrong origin
  await tick();
  expect([page.state, guarded.state]).toEqual(['connecting', 'connecting']);
  expect(() => startLivingPreview(win, { origin: '*', viewport: { width: 640, height: 360 }, fps: 15 })).toThrow('exact');
  // Drive a raw host to send an out-of-order revision.
  const channel = new MessageChannel();
  const hello = new Promise<unknown>(r => { channel.port1.onmessage = e => r(e.data); });
  win.postMessage({ protocol: PROTOCOL, type: 'connect' }, '*', [channel.port2]);
  expect(await hello).toEqual({ type: 'hello', sdk: '@trychert/sdk/living@1' });
  const ready = new Promise<unknown>(r => { channel.port1.onmessage = e => { if ((e.data as { type: string }).type === 'ready') r(e.data); }; });
  channel.port1.postMessage({ type: 'start', session_id: 's', viewport: { width: 640, height: 360 }, fps: 15, input: [], state: null, revision: 5 });
  await ready;
  for (const revision of [4, 5, 7, 6, 8]) channel.port1.postMessage({ type: 'state', revision, state: null as Json });
  channel.port1.postMessage({ type: 'input', input: { kind: 'pointer', action: 'down', x: 0, y: 0 } });   // not enabled: ignored
  await tick(10);
  expect(states).toEqual([7, 8]);
  page.dispose(); channel.port1.close();

  const silent = fakeWindow();
  const failed = new Promise<string>(r => startLivingPreview(silent, { origin: ORIGIN, viewport: { width: 640, height: 360 }, fps: 15, readyTimeoutMs: 20 }).on('failed', r));
  expect(await failed).toBe('living_ready_timeout');
});

test('preview re-offers connect until a late-subscribing page (e.g. a React effect) says hello', async () => {
  const win = fakeWindow();
  const preview = startLivingPreview(win, { origin: ORIGIN, viewport: { width: 640, height: 360 }, fps: 15, state: { late: true } });
  await tick(400);                                   // several connects are offered before anyone listens
  const started: unknown[] = [];
  connectLivingPage({ onStart: s => { started.push(s.state); } }, { target: win, trusted: trustedFor(win) });
  await new Promise<void>(r => preview.on('ready', r));
  expect(started).toEqual([{ late: true }]);
  const stopped = new Promise<void>(r => preview.on('stopped', r)); preview.stop(); await stopped;
});
