import { expect, test } from 'bun:test';
import { ChertControlPlane, type CreateCall, type AssistantConfig, type CallDetail, type CallEvent } from './index';

const byor: CreateCall = { direction: 'outbound', mode: 'customer_managed', line_id: 'line',
  destination: '+61400000000', media: { audio: true, video: true }, livekit_url: 'wss://room.example',
  participant_token: 'synthetic-room-token', remote_participant_identity: 'agent' };
const config: AssistantConfig = { instructions: 'Help the caller.', openai: { provider: 'openai', model: 'gpt-realtime-2.1' },
  voice: { provider: 'openai', voice_id: 'marin' }, interruption: {}, escalation: {},
  video: { mode: 'avatar', provider: 'anam', avatar_id: 'avatar', framing: 'portrait' },
  inbound_policy: 'auto_answer', media_defaults: { audio: true, video: true } };

test('video control contracts preserve bodies, separate event shapes and credentials over loopback', async () => {
  const requests: { path: string; method: string; body: unknown; key: string | null }[] = [];
  const detail: CallDetail = { id: 'call', project_id: 'project', direction: 'outbound', mode: 'customer_managed', status: 'active',
    line_id: 'line', worker_id: 'worker', assistant_id: null, terminal_reason: null, started_at: null, ended_at: null, duration_seconds: null,
    media: { audio: true, video: true }, media_status: { audio: 'ready', video: 'rendered' },
    facetime_call_events: [{ id: 'event', event_type: 'remote_video_ready', sequence: 9, payload: { video: 'rendered' }, source: 'worker', created_at: '2026-10-24T00:00:00Z' }] };
  const timeline: { call_id: string; events: CallEvent[] } = { call_id: 'call', events: [{ id: 'event', type: 'remote_video_ready', at: '2026-10-24T00:00:00Z', sequence: 3, source: 'worker' }] };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    expect(request.headers.get('authorization')).toBe('Bearer facetime-only');
    expect(request.headers.get('x-chert-project-id')).toBe('project');
    requests.push({ path: url.pathname + url.search, method: request.method,
      body: request.headers.has('content-type') ? await request.json() : undefined, key: request.headers.get('idempotency-key') });
    return Response.json({ data: url.pathname.endsWith('/events') ? timeline : detail }, { status: request.method === 'POST' ? 202 : 200 });
  } });
  try {
    const client = new ChertControlPlane({ baseUrl: server.url.origin, token: 'facetime-only', projectId: 'project' });
    expect(await client.createCall(byor, 'video-start-1')).toEqual(detail);
    expect((await client.getCall('call')).media_status.video).toBe('rendered');
    expect(await client.getCallEvents('call')).toEqual(timeline);
    await client.answerCall('call', 'video-answer-1');
    await client.rejectCall('call', 'video-reject-1', { reason: 'Unavailable' });
    await client.endCall('call', 'video-end-1');
    await client.listCalls({ limit: 7, offset: 2 });
    await client.updateLine('line', { video_framing: 'fill', connecting_screen_dismissal: 'video', default_assistant_id: null, inbound_policy: 'customer_decides' });
    await client.createAssistant({ name: 'Video', draft_config: config });
    await client.updateAssistant('assistant', { expected_draft_revision: 4, draft_config: config });
    await client.getAssistant('assistant'); await client.listAssistants({ limit: 3, offset: 1 }); await client.publishAssistant('assistant');
    expect(requests.map(r => `${r.method} ${r.path}`)).toEqual([
      'POST /api/v1/calls', 'GET /api/v1/calls/call', 'GET /api/v1/calls/call/events',
      'POST /api/v1/calls/call/answer', 'POST /api/v1/calls/call/reject', 'POST /api/v1/calls/call/end',
      'GET /api/v1/calls?limit=7&offset=2', 'PATCH /api/v1/lines/line', 'POST /api/v1/assistants',
      'PATCH /api/v1/assistants/assistant', 'GET /api/v1/assistants/assistant', 'GET /api/v1/assistants?limit=3&offset=1',
      'POST /api/v1/assistants/assistant/publish',
    ]);
    expect(requests[0]!.body).toEqual(byor); expect(requests[0]!.key).toBe('video-start-1');
    expect(requests.slice(3,6).map(r => [r.key,r.body])).toEqual([
      ['video-answer-1', {}], ['video-reject-1', { reason: 'Unavailable' }], ['video-end-1', {}],
    ]);
    expect(requests[7]!.body).toEqual({ video_framing: 'fill', connecting_screen_dismissal: 'video', default_assistant_id: null, inbound_policy: 'customer_decides' });
    expect(requests[8]!.body).toEqual({ name: 'Video', draft_config: config });
    expect(requests[9]!.body).toEqual({ expected_draft_revision: 4, draft_config: config });
    expect(requests[12]!.body).toBeUndefined();
  } finally { await server.stop(true); }
});

test('video mutations never replay or forward credentials on redirects and failures', async () => {
  let sinkRequests = 0, attempts = 0;
  const sink = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { sinkRequests++; return Response.json({ data: {} }); } });
  let status = 307;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    attempts++; return new Response(JSON.stringify({ error: { code: 'secret-room-token' } }),
      { status, headers: { Location: sink.url.href, 'Retry-After': '0' } });
  } });
  try {
    const client = new ChertControlPlane({ baseUrl: server.url.origin, token: 'facetime-only', projectId: 'project' });
    for (status of [301,302,303,307,308,429,503]) {
      await expect(client.createCall(byor, 'stable-video-key')).rejects.toThrow();
    }
    expect(attempts).toBe(7); expect(sinkRequests).toBe(0);
    for (const key of ['', 'short', 'newline\r\nsecret', 'x'.repeat(201)]) expect(() => client.createCall(byor, key)).toThrow();
    for (const id of ['', '.', '..']) expect(() => client.getCall(id)).toThrow();
    expect(attempts).toBe(7);
  } finally { await server.stop(true); await sink.stop(true); }
});

test('video requests use the canonical default once and preserve explicit origin overrides', async () => {
  for (const baseUrl of [undefined, 'https://override.example/']) {
    let seen = '';
    const client = new ChertControlPlane({ baseUrl, token: 'ftk_only', projectId: 'project', fetch: (async (url, init) => {
      seen = String(url); expect(init?.redirect).toBe('error'); return Response.json({ data: {} });
    }) as typeof fetch });
    await client.createCall(byor, 'stable-video-key');
    expect(seen).toBe(`${baseUrl ? 'https://override.example' : 'https://facetime.trychert.com'}/api/v1/calls`);
  }
});

test('media sessions: strict request, validated grant and stable error codes without leaking server text', async () => {
  const grant = { session_id: '3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77', direction: 'publish', endpoint: 'https://signal.example/opaque/abc', token: 'session-bearer',
    connect_by: '2026-10-25T00:05:00Z', expires_at: '2026-10-25T01:00:00Z', ice_servers: [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c', credentialType: 'password' }],
    codecs: ['h264', 'vp8'], limits: { max_width: 1920, max_height: 1080, max_fps: 30, max_frame_bytes: 8_388_608 } };
  const seen: { url: string; body: unknown }[] = [];
  let reply: () => Response = () => Response.json({ data: grant }, { status: 201 });
  const client = new ChertControlPlane({ token: 'project-key', projectId: 'project', fetch: (async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return reply();
  }) as typeof fetch });
  expect(await client.createMediaSession('call', { direction: 'publish' })).toEqual(grant as never);
  await client.createMediaSession('call', { direction: 'publish', codecs: ['vp8', 'h264'] });
  expect(seen.map(s => [s.url, s.body])).toEqual([
    ['https://facetime.trychert.com/api/v1/calls/call/media-sessions', { direction: 'publish' }],
    ['https://facetime.trychert.com/api/v1/calls/call/media-sessions', { direction: 'publish', codecs: ['vp8', 'h264'] }]]);
  for (const bad of [{ direction: 'both' }, { direction: 'publish', codecs: [] }, { direction: 'publish', codecs: ['av1'] }, { direction: 'publish', codecs: ['h264', 'h264'] }])
    await expect(client.createMediaSession('call', bad as never)).rejects.toBeInstanceOf(TypeError);
  // A returned codec the caller did not request is a contract violation.
  await expect(client.createMediaSession('call', { direction: 'publish', codecs: ['vp8'] })).rejects.toMatchObject({ code: 'invalid_response' });
  // Subscribe grants are capped at 1280x720; a publish-sized subscribe grant or a wrong direction is rejected.
  reply = () => Response.json({ data: grant }, { status: 201 });
  await expect(client.createMediaSession('call', { direction: 'subscribe' })).rejects.toMatchObject({ code: 'invalid_response' });
  for (const patch of [{ endpoint: 'http://signal.example/x' }, { endpoint: 'https://u:p@signal.example/x' }, { token: 'a\r\nb' }, { connect_by: 'soon' },
    { codecs: ['av1'] }, { codecs: ['h264', 'h264'] }, { ice_servers: [{ urls: 7 }] }, { ice_servers: [{ urls: 'turn:x', credential: 5 }] },
    { connect_by: '2026' }, { connect_by: '2026-10-25T02:00:00Z' }, { limits: { ...grant.limits, max_frame_bytes: 9_000_000 } }, { session_id: 'x' }]) {
    reply = () => Response.json({ data: { ...grant, ...patch } }, { status: 201 });
    await expect(client.createMediaSession('call', { direction: 'publish' })).rejects.toMatchObject({ code: 'invalid_response' });
  }
  for (const [status, code] of [[401, 'unauthorized'], [404, 'call_not_found'], [409, 'media_capability_unsupported'], [409, 'media_session_conflict'],
    [409, 'call_not_active'], [410, 'call_ended'], [503, 'media_transport_unavailable']] as const) {
    reply = () => Response.json({ error: { code, message: 'internal host 192.0.2.5' } }, { status });
    const error = await client.createMediaSession('call', { direction: 'publish' }).catch(e => e);
    expect([error.status, error.code, error.message.includes('192.0.2.5')]).toEqual([status, code, false]);
  }
});

test('screen media sessions: content is validated, echoed and screen grants are capped at 15 fps', async () => {
  const base = { session_id: '3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77', endpoint: 'https://signal.example/opaque/abc', token: 'session-bearer',
    connect_by: '2026-10-25T00:05:00Z', expires_at: '2026-10-25T01:00:00Z', ice_servers: [], codecs: ['h264'] };
  const screen = { ...base, direction: 'publish', content: 'screen', limits: { max_width: 1920, max_height: 1080, max_fps: 15, max_frame_bytes: 8_388_608 } };
  const callerScreen = { ...base, direction: 'subscribe', content: 'caller_screen', limits: { max_width: 1280, max_height: 720, max_fps: 30, max_frame_bytes: 8_388_608 } };
  const bodies: unknown[] = [];
  let reply: () => Response = () => Response.json({ data: screen }, { status: 201 });
  const client = new ChertControlPlane({ token: 'project-key', projectId: 'project', fetch: (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return reply(); }) as typeof fetch });

  expect(await client.createMediaSession('call', { direction: 'publish', content: 'screen' })).toEqual(screen as never);
  reply = () => Response.json({ data: callerScreen }, { status: 201 });
  expect(await client.createMediaSession('call', { direction: 'subscribe', content: 'caller_screen' })).toEqual(callerScreen as never);
  expect(bodies).toEqual([{ direction: 'publish', content: 'screen' }, { direction: 'subscribe', content: 'caller_screen' }]);

  // Wrong combinations fail locally with no request.
  for (const bad of [{ direction: 'publish', content: 'caller_screen' }, { direction: 'subscribe', content: 'screen' }, { direction: 'subscribe', content: 'camera' }, { direction: 'publish', content: 'window' }])
    await expect(client.createMediaSession('call', bad as never)).rejects.toBeInstanceOf(TypeError);
  expect(bodies).toHaveLength(2);

  // A screen grant above 15 fps, a missing or different echo, or a screen grant for a camera request is a contract violation.
  for (const [request, data] of [
    [{ direction: 'publish', content: 'screen' }, { ...screen, limits: { ...screen.limits, max_fps: 30 } }],
    [{ direction: 'publish', content: 'screen' }, { ...screen, content: undefined }],
    [{ direction: 'publish', content: 'screen' }, { ...screen, content: 'camera' }],
    [{ direction: 'publish' }, screen],
    [{ direction: 'subscribe' }, callerScreen],
  ] as const) {
    reply = () => Response.json({ data }, { status: 201 });
    await expect(client.createMediaSession('call', request as never)).rejects.toMatchObject({ code: 'invalid_response' });
  }
  // The backend resolves an omitted content to 'camera' and echoes it, in both directions.
  reply = () => Response.json({ data: { ...screen, content: 'camera', limits: { ...screen.limits, max_fps: 30 } } }, { status: 201 });
  await expect(client.createMediaSession('call', { direction: 'publish' })).resolves.toMatchObject({ content: 'camera' });
  reply = () => Response.json({ data: { ...callerScreen, content: 'camera' } }, { status: 201 });
  await expect(client.createMediaSession('call', { direction: 'subscribe' })).resolves.toMatchObject({ content: 'camera' });

  reply = () => Response.json({ error: { code: 'caller_screen_not_shared', message: 'internal detail' } }, { status: 409 });
  await expect(client.createMediaSession('call', { direction: 'subscribe', content: 'caller_screen' })).rejects.toMatchObject({ status: 409, code: 'caller_screen_not_shared' });
});
