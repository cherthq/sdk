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
