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
    reply = () => Response.json({ error: { code, message: 'internal host 10.0.0.5' } }, { status });
    const error = await client.createMediaSession('call', { direction: 'publish' }).catch(e => e);
    expect([error.status, error.code, error.message.includes('10.0.0.5')]).toEqual([status, code, false]);
  }
});

test('living services: validated manifests, idempotent attach, revisioned state, events, gated input and capability parsing', async () => {
  const { parseLivingServices } = await import('./index');
  const seen: { method: string; path: string; body: unknown; key: string | null }[] = [];
  const client = new ChertControlPlane({ token: 'project-key', projectId: 'project', fetch: (async (url, init) => {
    seen.push({ method: init!.method!, path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined,
      key: new Headers(init?.headers).get('idempotency-key') });
    const session = { session_id: 'ls', call_id: 'call', deployment_id: 'dep', status: 'starting', viewport: { width: 1280, height: 720 }, fps: 30, ready_at: null, last_heartbeat_at: null, error_code: null };
    return Response.json({ data: new URL(String(url)).pathname.includes('living-sessions') && init!.method !== 'PUT' ? session : { ok: true } }, { status: 200 });
  }) as typeof fetch });
  const manifest = { name: 'Order board', entry_url: 'https://app.example/board', viewport: { width: 1280, height: 720 }, fps: 30, input: ['pointer' as const] };
  await client.createLivingService(manifest, 'create-key-1');
  await client.deployLivingService('svc', { ...manifest, state_schema_version: 2 }, 'deploy-key-1');
  await client.getLivingDeployment('svc', 'dep');
  await client.attachLivingService('call', { deployment_id: 'dep', initial_state: { step: 1 }, viewport: { width: 1280, height: 720 }, fps: 24 }, 'attach-key-1');
  await client.getLivingSession('call', 'ls');
  await client.setLivingState('call', 'ls', 2, { step: 2 });
  await client.sendLivingEvent('call', 'ls', 'order.updated', { id: 7 });
  await client.sendLivingInput('call', 'ls', { kind: 'pointer', action: 'down', x: 0.5, y: 0.5 });
  await client.detachLivingService('call', 'ls');
  expect(seen.map(s => `${s.method} ${s.path}`)).toEqual(['POST /api/v1/living-services', 'POST /api/v1/living-services/svc/deployments',
    'GET /api/v1/living-services/svc/deployments/dep', 'POST /api/v1/calls/call/living-sessions', 'GET /api/v1/calls/call/living-sessions/ls',
    'PUT /api/v1/calls/call/living-sessions/ls/state', 'POST /api/v1/calls/call/living-sessions/ls/events', 'POST /api/v1/calls/call/living-sessions/ls/input',
    'DELETE /api/v1/calls/call/living-sessions/ls']);
  expect([seen[0]!.body, seen[0]!.key, seen[1]!.key]).toEqual([manifest, 'create-key-1', 'deploy-key-1']);
  expect([seen[3]!.body, seen[3]!.key]).toEqual([{ deployment_id: 'dep', initial_state: { step: 1 }, viewport: { width: 1280, height: 720 }, fps: 24 }, 'attach-key-1']);
  expect(seen[5]!.body).toEqual({ revision: 2, state: { step: 2 } });
  const calls = seen.length;
  for (const bad of [{ ...manifest, entry_url: 'http://app.example' }, { ...manifest, entry_url: 'https://u:p@app.example' }, { ...manifest, entry_url: 'https://app.example/#x' },
    { ...manifest, viewport: { width: 1281, height: 720 } }, { ...manifest, fps: 60 }, { ...manifest, input: ['pointer', 'pointer'] as never }, { ...manifest, name: '' }])
    expect(() => client.createLivingService(bad, 'create-key-2')).toThrow(TypeError);
  expect(() => client.setLivingState('call', 'ls', -1, null)).toThrow(TypeError);
  expect(() => client.setLivingState('call', 'ls', 1, { big: 'x'.repeat(64 * 1024) })).toThrow('exceeds');
  expect(() => client.sendLivingEvent('call', 'ls', 'Not Valid')).toThrow(TypeError);
  expect(() => client.sendLivingInput('call', 'ls', { kind: 'pointer', action: 'down', x: 2, y: 0 })).toThrow(TypeError);
  expect(() => client.attachLivingService('call', { deployment_id: 'dep' }, 'short')).toThrow();
  expect(() => client.attachLivingService('call', { deployment_id: 'dep', viewport: { width: 1281, height: 720 } }, 'attach-key-2')).toThrow(TypeError);
  expect(() => client.createLivingService(manifest, 'short')).toThrow();
  expect(seen.length).toBe(calls);   // local validation never sends a request
  expect(parseLivingServices({ version: 1, supported: true, max_width: 1280, max_height: 720, max_fps: 30, input: ['pointer', 'pointer'] }))
    .toEqual({ version: 1, supported: true, max_width: 1280, max_height: 720, max_fps: 30, input: ['pointer'] });
  for (const bad of [undefined, { version: 2, supported: true, max_width: 1280, max_height: 720, max_fps: 30, input: [] },
    { version: 1, supported: false, max_width: 1280, max_height: 720, max_fps: 30, input: [] },
    { version: 1, supported: true, max_width: 0, max_height: 720, max_fps: 30, input: [] },
    { version: 1, supported: true, max_width: 1280, max_height: 720, max_fps: 30 }, { version: 1, custom_video: { supported: true } }])
    expect(parseLivingServices(bad)).toBeNull();
  // Newer services with larger limits or new input kinds stay usable, clamped to SDK v1 bounds.
  expect(parseLivingServices({ version: 1, supported: true, max_width: 3840, max_height: 2160, max_fps: 60, input: ['pointer', 'gamepad'] }))
    .toEqual({ version: 1, supported: true, max_width: 1920, max_height: 1080, max_fps: 30, input: ['pointer'] });
});

test('living session responses must carry a valid effective viewport and fps', async () => {
  let session: Record<string, unknown> = { session_id: 'ls', status: 'live', viewport: { width: 1279, height: 720 }, fps: 30 };
  const client = new ChertControlPlane({ token: 'k', projectId: 'p', fetch: (async () => Response.json({ data: session })) as unknown as typeof fetch });
  await expect(client.getLivingSession('call', 'ls')).rejects.toMatchObject({ code: 'invalid_response' });
  session = { ...session, viewport: { width: 1280, height: 720 }, status: 'mystery' };
  await expect(client.getLivingSession('call', 'ls')).rejects.toMatchObject({ code: 'invalid_response' });
  session = { ...session, status: 'live' };
  expect((await client.getLivingSession('call', 'ls')).viewport).toEqual({ width: 1280, height: 720 });
});
