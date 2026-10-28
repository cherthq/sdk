import { expect, test } from 'bun:test';
import { ChertVideoSource, copyVideoFrame, MediaError, MediaFrameError, parseMediaCapabilities, parseIceServerLinks, publishWhip, receiveWhep,
  type MediaTransport, type OutboundItem, type PeerConnectionLike, type VideoFrameInit } from './index';

const i420 = (width: number, height: number, ts: bigint, stride = width): VideoFrameInit => ({ format: 'i420', width, height, timestampUs: ts,
  planes: [{ data: new Uint8Array(stride * height), stride }, { data: new Uint8Array((stride / 2) * (height / 2)), stride: stride / 2 },
    { data: new Uint8Array((stride / 2) * (height / 2)), stride: stride / 2 }] });

test('frames: copies caller memory, applies colour defaults and enforces stride/size bounds', () => {
  const input = i420(64, 32, 1n, 80);
  const frame = copyVideoFrame(input);
  input.planes[0]!.data[0] = 9;
  expect(frame.planes[0]!.data[0]).toBe(0);
  expect(frame.planes[0]!.data.byteLength).toBe(80 * 31 + 64);   // last row needs only rowBytes
  expect([frame.colorSpace, frame.rotation]).toEqual(['bt709-limited', 0]);
  expect(copyVideoFrame({ format: 'bgra', width: 16, height: 16, timestampUs: 0n, planes: [{ data: new Uint8Array(1024), stride: 64 }] }).colorSpace).toBe('srgb-full');
  expect(() => copyVideoFrame(i420(64, 32, 1n, 62))).toThrow(MediaFrameError);            // stride below row bytes
  expect(() => copyVideoFrame({ ...i420(64, 32, 1n), width: 63 })).toThrow('even');          // odd width
  expect(() => copyVideoFrame(i420(1922, 1080, 1n))).toThrow('1920x1080');
  expect(() => copyVideoFrame({ format: 'nv12', width: 16, height: 16, timestampUs: 0n, planes: [{ data: new Uint8Array(256), stride: 16 }] })).toThrow('2 plane');
  const short = i420(64, 32, 1n); short.planes[1] = { data: new Uint8Array(10), stride: 32 };
  expect(() => copyVideoFrame(short)).toThrow('Plane 1');
  // 1920x1080 RGBA with maximum padding exceeds 8 MiB: (7680+256)*1079+7680 > 8388608.
  expect(() => copyVideoFrame({ format: 'rgba', width: 1920, height: 1080, timestampUs: 0n, planes: [{ data: new Uint8Array(7936 * 1080), stride: 7936 }] }))
    .toThrow(expect.objectContaining({ code: 'frame_too_large' }));
});

test('capabilities: explicit v1 only; absent, unknown-version and malformed sections are unsupported', () => {
  const none = { version: 1 as const, custom_video: null, inbound_caller_video: null };
  for (const input of [undefined, null, {}, { version: 2, custom_video: { supported: true } }, { video: true }, 'v1']) expect(parseMediaCapabilities(input)).toEqual(none);
  const caps = parseMediaCapabilities({ version: 1,
    custom_video: { supported: true, transports: ['whip', 'whip'], codecs: ['h264', 'vp8'], max_width: 1920, max_height: 1080, max_fps: 30 },
    inbound_caller_video: { supported: true, transports: ['whep'], max_width: 1920, max_height: 1080, max_fps: 30 } });
  expect(caps.custom_video).toEqual({ supported: true, transports: ['whip'], codecs: ['h264', 'vp8'], max_width: 1920, max_height: 1080, max_fps: 30 });
  expect(caps.inbound_caller_video).toBeNull();   // caller return is capped at 1280x720
  expect(parseMediaCapabilities({ version: 1, custom_video: { supported: true, transports: ['rtmp'], codecs: ['h264'], max_width: 1280, max_height: 720, max_fps: 30 } }).custom_video).toBeNull();
  expect(parseMediaCapabilities({ version: 1, custom_video: { supported: false, transports: ['whip'], codecs: ['h264'], max_width: 1280, max_height: 720, max_fps: 30 } }).custom_video).toBeNull();
});

function gatedTransport(accepts: OutboundItem['kind'][]) {
  const sent: OutboundItem[] = []; let release: (() => void) | null = null; let gate = true; let closed = 0;
  const keyListeners = new Set<() => void>(); const failListeners = new Set<(e: MediaError) => void>();
  const transport: MediaTransport = { kind: 'test', accepts,
    async connect() {}, async close() { closed++; },
    async send(item) { sent.push(item); if (gate) await new Promise<void>(r => { release = r; }); },
    onKeyframeRequest(l) { keyListeners.add(l); return () => keyListeners.delete(l); },
    onFailure(l) { failListeners.add(l); return () => failListeners.delete(l); } };
  return { transport, sent, get closed() { return closed; }, open() { gate = false; release?.(); },
    step() { const r = release; release = null; r?.(); }, fail(e: MediaError) { for (const l of failListeners) l(e); }, key() { for (const l of keyListeners) l(); } };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('source: bounded drop-oldest queue never blocks, enforces config, fps and monotonic time', async () => {
  const t = gatedTransport(['video']);
  const source = new ChertVideoSource({ transport: t.transport, width: 64, height: 32, maxFps: 30 });
  const states: string[] = []; source.on('state', s => states.push(s));
  expect(() => source.pushFrame(i420(64, 32, 0n))).toThrow(expect.objectContaining({ code: 'invalid_state' }));
  await source.start();
  const step = 40_000n; // 25 fps
  expect(source.pushFrame(i420(64, 32, 0n))).toBe('queued');   // taken by transport, blocked in send
  await tick();
  for (let i = 1n; i <= 4n; i++) expect(source.pushFrame(i420(64, 32, i * step))).toBe('queued');
  expect(source.stats().dropped).toBe(2);                  // queue of 2 evicted frames 1 and 2
  expect(source.pushFrame(i420(64, 32, 4n * step + 1000n))).toBe('dropped'); // faster than maxFps
  expect(() => source.pushFrame(i420(64, 32, 4n * step))).toThrow(expect.objectContaining({ code: 'timestamp_regressed' }));
  expect(() => source.pushFrame(i420(32, 32, 9n * step))).toThrow(expect.objectContaining({ code: 'frame_mismatch' }));
  expect(() => source.pushEncoded({ codec: 'h264', keyFrame: true, timestampUs: 10n * step, data: new Uint8Array([1]) })).toThrow(expect.objectContaining({ code: 'codec_unsupported' }));
  t.open(); await tick(); await tick();
  expect(t.sent.map(i => i.kind === 'video' ? i.frame.timestampUs / step : -1n)).toEqual([0n, 3n, 4n]);
  expect(source.stats()).toEqual({ delivered: 3, dropped: 3, rejected: 2, keyframeRequests: 0, lastTimestampUs: 4n * step });  // dropped frames do not advance the clock
  await source.stop(); await source.stop();
  expect(states).toEqual(['starting', 'live', 'stopping', 'stopped']);
  expect(t.closed).toBe(1);
});

test('source: losing encoded chunks drops dependent deltas until the next keyframe and requests one', async () => {
  const t = gatedTransport(['encoded']);
  const source = new ChertVideoSource({ transport: t.transport, width: 64, height: 32, maxFps: 30, queue: { maxItems: 1 } });
  let requests = 0; source.on('keyframe-request', () => requests++);
  await source.start();
  const chunk = (n: bigint, keyFrame = false) => ({ codec: 'h264' as const, keyFrame, timestampUs: n, data: new Uint8Array([n > 255n ? 0 : Number(n)]) });
  expect(source.pushEncoded(chunk(1n, true))).toBe('queued'); await tick();   // in flight
  expect(source.pushEncoded(chunk(2n))).toBe('queued');                       // queued
  expect(source.pushEncoded(chunk(3n))).toBe('dropped');                      // evicts 2 -> chain broken, 3 depends on it
  expect(requests).toBe(1);
  expect(source.pushEncoded(chunk(4n))).toBe('dropped');                      // still awaiting key
  expect(source.pushEncoded(chunk(5n, true))).toBe('queued');
  expect(source.pushEncoded(chunk(6n))).toBe('dropped');                      // evicts key 5: chain broken again
  expect(source.pushEncoded(chunk(7n, true))).toBe('queued');
  t.key(); expect(source.stats().keyframeRequests).toBe(3);
  // 7 is still queued behind the in-flight 1; a new keyframe at a full queue replaces it and is never lost.
  expect(source.pushEncoded(chunk(8n, true))).toBe('queued');                        // remote request is surfaced too
  t.open(); await tick(); await tick();
  expect(t.sent.map(i => i.kind === 'encoded' ? [i.chunk.timestampUs, i.chunk.keyFrame] : null)).toEqual([[1n, true], [8n, true]]);
  await source.stop();
});

test('source: transport failure and abort move to failed with redacted errors', async () => {
  const t = gatedTransport(['video']);
  const source = new ChertVideoSource({ transport: t.transport, width: 64, height: 32, maxFps: 30 });
  const errors: MediaError[] = []; source.on('error', e => errors.push(e));
  await source.start();
  t.fail(new MediaError('session_expired')); await tick();
  expect([source.state, errors.map(e => e.code)]).toEqual(['failed', ['session_expired']]);
  expect(() => source.pushFrame(i420(64, 32, 5n))).toThrow(expect.objectContaining({ code: 'invalid_state' }));
  expect(t.closed).toBe(1);

  const controller = new AbortController();
  const slow: MediaTransport = { kind: 'slow', accepts: ['video'], async send() {}, async close() {},
    connect: signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('internal detail token=secret')))) };
  const aborted = new ChertVideoSource({ transport: slow, width: 16, height: 16, maxFps: 1 });
  const pending = aborted.start(controller.signal); controller.abort();
  const failure = await pending.catch(e => e);
  expect([failure.code, String(failure.message).includes('secret'), aborted.state]).toEqual(['aborted', false, 'failed']);
  const broken: MediaTransport = { kind: 'broken', accepts: ['video'], async connect() {}, async close() {}, async send() { throw new Error('socket 192.0.2.1 token=secret'); } };
  const failing = new ChertVideoSource({ transport: broken, width: 16, height: 16, maxFps: 30 });
  const seen: MediaError[] = []; failing.on('error', e => seen.push(e));
  await failing.start(); failing.pushFrame(i420(16, 16, 0n)); await tick(); await tick();
  expect([failing.state, seen[0]?.code, seen[0]?.message.includes('secret')]).toEqual(['failed', 'transport_failed', false]);
});

class FakePeer implements PeerConnectionLike {
  localDescription: { type: string; sdp: string } | null = null; remote: string | null = null; iceGatheringState = 'new'; closed = false;
  #listeners = new Set<() => void>();
  async createOffer() { return { type: 'offer' as const, sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' }; }
  async setLocalDescription(d: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string }) {
    this.localDescription = { type: d.type, sdp: d.sdp! };
    setTimeout(() => { this.iceGatheringState = 'complete'; this.localDescription!.sdp += 'a=candidate:1\r\n'; for (const l of this.#listeners) l(); }, 5);
  }
  async setRemoteDescription(d: { type: 'answer'; sdp: string }) { if (d.sdp.includes('reject')) throw new Error('bad'); this.remote = d.sdp; }
  addEventListener(_: string, l: () => void) { this.#listeners.add(l); }
  removeEventListener(_: string, l: () => void) { this.#listeners.delete(l); }
  close() { this.closed = true; }
}

test('WHIP/WHEP: RFC 9725 exchange with the session bearer on every method, trickle, ICE restart and stable error codes', async () => {
  const log: { method: string; path: string; auth: string | null; type: string | null; body: string; ifMatch: string | null }[] = [];
  let mode = 'ok';
  const json = (status: number, code: string) => Response.json({ error: { code, message: 'server detail token=secret' } }, { status });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url), body = await request.text();
    log.push({ method: request.method, path: url.pathname, auth: request.headers.get('Authorization'), type: request.headers.get('Content-Type'), body, ifMatch: request.headers.get('If-Match') });
    // A signaling facade validates the same bearer on POST, PATCH and DELETE.
    if (request.headers.get('Authorization') !== 'Bearer session-token') return json(401, 'media_session_expired');
    if (request.method === 'POST') {
      if (mode !== 'ok' && mode !== 'reject' && mode !== 'foreign') return json(Number(mode.split(':')[0]), mode.split(':')[1]!);
      if (mode === 'foreign') return new Response('v=0\r\n', { status: 201, headers: { Location: 'https://elsewhere.example/s/1', 'Content-Type': 'application/sdp' } });
      return new Response(mode === 'reject' ? 'v=0\r\nreject' : 'v=0\r\nanswer', { status: 201, headers: { Location: `/sessions/${url.pathname.slice(1)}`, 'Content-Type': 'application/sdp', ETag: '"e1"',
        Link: '<turn:turn.example:3478?transport=udp>; rel="ice-server"; username="u"; credential="c", <https://x.example>; rel="ice-server", <stun:stun.example>; rel="ice-server"' } });
    }
    if (request.method === 'PATCH') {
      if (body.includes('bad')) return json(400, 'invalid_ice_fragment');
      if (body.includes('ice-ufrag')) return new Response('a=ice-ufrag:srv2\r\na=ice-pwd:p\r\n', { status: 200, headers: { 'Content-Type': 'application/trickle-ice-sdpfrag', ETag: '"e2"' } });
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 200 });
  } });
  try {
    const base = `http://127.0.0.1:${server.port}`, creds = (path: string, token = 'session-token') => ({ endpoint: `${base}/${path}`, token });
    const pc = new FakePeer();
    const session = await publishWhip(pc, creds('whip'));
    expect(log[0]).toMatchObject({ method: 'POST', path: '/whip', type: 'application/sdp', auth: 'Bearer session-token', body: expect.stringContaining('a=candidate:1') });
    expect(pc.remote).toBe('v=0\r\nanswer');
    expect(session.iceServers).toEqual([{ urls: ['turn:turn.example:3478?transport=udp'], username: 'u', credential: 'c' }, { urls: ['stun:stun.example'] }]);
    expect(await session.patch('a=candidate:2')).toBe(true);
    expect(log[1]).toMatchObject({ method: 'PATCH', path: '/sessions/whip', type: 'application/trickle-ice-sdpfrag', ifMatch: '"e1"', auth: 'Bearer session-token' });
    expect(await session.restartIce('a=ice-ufrag:new\r\na=ice-pwd:x\r\n')).toBe('a=ice-ufrag:srv2\r\na=ice-pwd:p\r\n');
    expect(log[2]).toMatchObject({ method: 'PATCH', ifMatch: '*' });                   // RFC 9725 §4.3.2
    await session.patch('a=candidate:3');
    expect(log[3]!.ifMatch).toBe('"e2"');                                       // entity tag follows the restart
    await expect(session.patch('bad')).rejects.toMatchObject({ code: 'invalid_signaling' });
    await session.close(); await session.close();
    expect([log.filter(l => l.method === 'DELETE').map(l => [l.path, l.auth]), pc.closed]).toEqual([[['/sessions/whip', 'Bearer session-token']], true]);
    await expect(session.patch('a=x')).rejects.toMatchObject({ code: 'invalid_state' });

    const viewer = await receiveWhep(new FakePeer(), creds('whep'));
    expect(viewer.protocol).toBe('whep');
    await viewer.close();

    const failures: Record<string, string> = {};
    const cases = [['expired', 'ok', creds('whip', 'wrong')], ['conflict', '409:media_session_conflict', creds('whip')], ['inactive', '409:call_not_active', creds('whip')],
      ['ended', '410:call_ended', creds('whip')], ['capability', '409:media_capability_unsupported', creds('whip')], ['sdp', '400:invalid_sdp', creds('whip')],
      ['unknown', '409:something_new', creds('whip')], ['foreign', 'foreign', creds('whip')], ['reject', 'reject', creds('whip')]] as const;
    for (const [label, setMode, c] of cases) {
      mode = setMode; const error = await publishWhip(new FakePeer(), c).catch(e => e);
      expect(String(error.message)).not.toContain('secret');
      failures[label] = error.code;
    }
    expect(failures).toEqual({ expired: 'session_expired', conflict: 'session_conflict', inactive: 'call_not_active', ended: 'call_ended', capability: 'capability_missing',
      sdp: 'invalid_signaling', unknown: 'session_conflict', foreign: 'transport_unavailable', reject: 'codec_unsupported' });
    expect(log.at(-1)).toMatchObject({ method: 'DELETE', path: '/sessions/whip' });     // rejected answer cleans up the resource
    await expect(publishWhip(new FakePeer(), { endpoint: 'http://media.example/whip', token: 't' })).rejects.toMatchObject({ code: 'transport_unavailable' });
    await expect(publishWhip(new FakePeer(), { ...creds('whip'), connectBy: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'session_expired' });
    expect(parseIceServerLinks('<turns:t.example>; rel=ice-server')).toEqual([{ urls: ['turns:t.example'] }]);
  } finally { server.stop(true); }
});

test('LiveKit adapter: optional, structural, repacks strided planes and maps formats/rotation', async () => {
  const { liveKitVideoTransport } = await import('./livekit');
  const captured: { frame: { data: Uint8Array; width: number; height: number; type: number }; ts?: bigint; rotation?: number }[] = [];
  class Frame { constructor(public data: Uint8Array, public width: number, public height: number, public type: number) {} }
  const rtc = { VideoFrame: Frame, VideoBufferType: { RGBA: 0, BGRA: 3, I420: 5, NV12: 10 },
    VideoRotation: { VIDEO_ROTATION_0: 0, VIDEO_ROTATION_90: 1, VIDEO_ROTATION_180: 2, VIDEO_ROTATION_270: 3 } };
  const transport = liveKitVideoTransport(rtc, { captureFrame: (frame, ts, rotation) => captured.push({ frame: frame as never, ts, rotation }) });
  const source = new ChertVideoSource({ transport, width: 16, height: 16, maxFps: 30 });
  await source.start();
  const y = new Uint8Array(20 * 16).map((_, i) => i % 20);   // stride 20, row bytes 16
  source.pushFrame({ format: 'nv12', width: 16, height: 16, timestampUs: 7n, rotation: 270, planes: [{ data: y, stride: 20 }, { data: new Uint8Array(16 * 8).fill(128), stride: 16 }] });
  await tick(); await source.stop();
  const { frame, ts, rotation } = captured[0]!;
  expect([frame.type, frame.width, frame.height, frame.data.byteLength, ts, rotation]).toEqual([10, 16, 16, 16 * 16 + 16 * 8, 7n, 3]);
  expect([...frame.data.subarray(16, 20)]).toEqual([0, 1, 2, 3]);    // row 1 starts at packed offset 16, not stride 20
});

test('source: stop during an in-flight send is clean, and a late connect after stop is closed', async () => {
  let reject!: (e: Error) => void; let closes = 0;
  const closing: MediaTransport = { kind: 'closing', accepts: ['video'], async connect() {},
    send: () => new Promise((_, r) => { reject = r; }), async close() { closes++; reject?.(new Error('closed')); } };
  const source = new ChertVideoSource({ transport: closing, width: 16, height: 16, maxFps: 30 });
  const events: string[] = []; source.on('state', s => events.push(s)); source.on('error', e => events.push('error:' + e.code));
  await source.start(); source.pushFrame(i420(16, 16, 0n)); await tick();
  await source.stop(); await tick();
  expect([events, closes]).toEqual([['starting', 'live', 'stopping', 'stopped'], 1]);

  let finish!: () => void; let lateCloses = 0;
  const late: MediaTransport = { kind: 'late', accepts: ['video'], async send() {}, async close(reason) { if (reason === 'aborted') lateCloses++; },
    connect: () => new Promise<void>(r => { finish = r; }) };
  const delayed = new ChertVideoSource({ transport: late, width: 16, height: 16, maxFps: 30 });
  const starting = delayed.start(); await tick();
  await delayed.stop(); finish();
  expect([(await starting.catch(e => e)).code, lateCloses, delayed.state]).toEqual(['aborted', 1, 'stopped']);
});

test('WHIP: a resource created by a 201 is released when the answer is unusable or the caller aborted', async () => {
  const deletes: string[] = []; let body = 'not sdp'; const controller = new AbortController();
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') { deletes.push(String(url)); return new Response(null, { status: 200 }); }
    if (body === 'abort') controller.abort();
    return new Response(body === 'abort' ? 'v=0\r\n' : body, { status: 201, headers: { Location: '/r/1', 'Content-Type': 'application/sdp' } });
  }) as typeof fetch;
  const creds = { endpoint: 'https://signal.example/opaque', token: 't' };
  await expect(publishWhip(new FakePeer(), creds, { fetch: fetcher })).rejects.toMatchObject({ code: 'transport_unavailable' });
  body = 'abort';
  await expect(publishWhip(new FakePeer(), creds, { fetch: fetcher, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  expect(deletes).toEqual(['https://signal.example/r/1', 'https://signal.example/r/1']);
});
