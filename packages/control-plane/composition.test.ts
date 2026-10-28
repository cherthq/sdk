import { expect, test } from 'bun:test';
import { ChertControlPlane, compositionInputTarget, parseVideoComposition, type CallVideoComposition } from './index';

const grant = { session_id: '3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77', direction: 'publish', content: 'camera', endpoint: 'https://signal.example/opaque/abc',
  token: 'session-bearer', connect_by: '2026-10-25T00:05:00Z', expires_at: '2026-10-25T01:00:00Z', ice_servers: [{ urls: ['turn:turn.example:3478'] }],
  codecs: ['h264'], limits: { max_width: 1920, max_height: 1080, max_fps: 24, max_frame_bytes: 8_388_608 } };
const session = (fps: number, call = 'call') => ({ session_id: 'ls', call_id: call, deployment_id: 'dep', status: 'starting', viewport: { width: 1920, height: 270 },
  fps, ready_at: null, last_heartbeat_at: null, error_code: null });
const captions = { id: 'captions', z: 1, living_session: session(12), region: { x: 0, y: 0.75, width: 1, height: 0.25 }, background: 'transparent', opacity: 0.8, input: ['pointer'] };
const layered = { composition_id: 'cmp', call_id: 'call', revision: 3, status: 'starting', output: { width: 1920, height: 1080, fps: 24 }, error_code: null,
  layers: [{ id: 'base', z: 0, source: { kind: 'camera' }, publish: grant }, captions] } as unknown as CallVideoComposition;
const pageOnly = { ...layered, output: { width: 1280, height: 720, fps: 30 },
  layers: [{ id: 'page', z: 1, living_session: session(30), region: { x: 0, y: 0, width: 1, height: 1 }, background: 'opaque', opacity: 1, input: [] }] };

function harness(reply: (method: string, path: string) => Response) {
  const seen: { method: string; path: string; body: unknown; key: string | null }[] = [];
  const client = new ChertControlPlane({ token: 'project-key', projectId: 'project', fetch: (async (url, init) => {
    seen.push({ method: init!.method!, path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined,
      key: new Headers(init?.headers).get('idempotency-key') });
    return reply(init!.method!, new URL(String(url)).pathname);
  }) as typeof fetch });
  return { client, seen };
}

test('call video: page shortcut, layered base + overlay, get and clear', async () => {
  const deployment = { service_id: 'svc', deployment_id: 'dep-url', revision: 1, error_code: null };
  let data: unknown = pageOnly;
  const { client, seen } = harness((method, path) => Response.json({ data: path.includes('living-services')
    ? { ...deployment, status: method === 'POST' ? 'pending' : 'ready' } : data }, { status: 200 }));
  // A URL page is deployed and awaited first; the call-video PUT only ever carries the immutable deployment ID.
  expect(await client.setCallVideo('call', { page: 'https://agent.example/live.html' }, 'video-key-1')).toEqual(pageOnly as never);
  data = layered;
  const result = await client.setCallVideo('call', { revision: 2, layers: [
    { id: 'base', source: { kind: 'camera' } },
    { id: 'captions', z: 1, page: { deployment_id: 'dep' }, region: { x: 0, y: 0.75, width: 1, height: 0.25 }, background: 'transparent', opacity: 0.8, input: ['pointer'], initial_state: { lang: 'en' } },
  ] }, 'video-key-2');
  expect(result.layers[0]).toMatchObject({ publish: { token: 'session-bearer' } });
  await client.getCallVideo('call');
  await client.clearCallVideo('call');
  expect(seen).toEqual([
    { method: 'POST', path: '/api/v1/living-services', key: 'video-key-1:page:page', body: { name: 'agent.example', entry_url: 'https://agent.example/live.html',
      viewport: { width: 1280, height: 720 }, fps: 30 } },
    { method: 'GET', path: '/api/v1/living-services/svc/deployments/dep-url', key: null, body: undefined },
    { method: 'PUT', path: '/api/v1/calls/call/video', key: 'video-key-1', body: { layers: [{ id: 'page', z: 1, page: { deployment_id: 'dep-url' },
      region: { x: 0, y: 0, width: 1, height: 1 }, background: 'opaque', opacity: 1 }] } },
    { method: 'PUT', path: '/api/v1/calls/call/video', key: 'video-key-2', body: { revision: 2, layers: [{ id: 'base', z: 0, source: { kind: 'camera' } },
      { id: 'captions', z: 1, page: { deployment_id: 'dep' }, region: { x: 0, y: 0.75, width: 1, height: 0.25 }, background: 'transparent', opacity: 0.8,
        input: ['pointer'], initial_state: { lang: 'en' } }] } },
    { method: 'GET', path: '/api/v1/calls/call/video', key: null, body: undefined },
    { method: 'DELETE', path: '/api/v1/calls/call/video', key: null, body: undefined },
  ]);
  // Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
  expect(compositionInputTarget(layered, 0.5, 0.9)?.id).toBe('captions');
  expect(compositionInputTarget(layered, 0.5, 0.74)).toBeNull();
  expect(compositionInputTarget(pageOnly as never, 0.5, 0.5)).toBeNull();   // declares no input
});

test('call video: a URL page whose deployment fails never reaches the call-video resource', async () => {
  const { client, seen } = harness(() => Response.json({ data: { service_id: 'svc', deployment_id: 'dep', revision: 1, status: 'failed', error_code: 'fetch_failed' } }));
  await expect(client.setCallVideo('call', { page: { url: 'https://agent.example/p', viewport: { width: 1920, height: 1080 }, fps: 24 } }, 'video-key-3'))
    .rejects.toMatchObject({ status: 409, code: 'living_deployment_not_ready' });
  expect(seen.map(s => `${s.method} ${s.path}`)).toEqual(['POST /api/v1/living-services']);
  expect(seen[0]!.body).toMatchObject({ viewport: { width: 1920, height: 1080 }, fps: 24 });
});

test('call video: invalid compositions are rejected locally before any request', async () => {
  const { client, seen } = harness(() => Response.json({ data: layered }));
  const page = { id: 'p', z: 1, page: { deployment_id: 'dep' } as never };
  const base = { id: 'base', source: { kind: 'camera' as const } };
  for (const input of [
    { layers: [] }, { layers: [base, page, { ...page, id: 'q', z: 2 }] },                          // 0 and 3 layers
    { layers: [base, { ...base, id: 'b2' }] }, { layers: [base, { ...page, id: 'base' }] },           // two bases; duplicate id
    { layers: [base, { ...page, z: 0 }] }, { layers: [base, { ...page, z: 1.5 }] },
    { layers: [base, { ...page, region: { x: 0.5, y: 0, width: 0.6, height: 1 } }] },                 // leaves the frame
    { layers: [base, { ...page, region: { x: 0, y: 0, width: 0, height: 1 } }] },
    { layers: [base, { ...page, opacity: 1.2 }] }, { layers: [base, { ...page, background: 'blurred' }] },
    { layers: [{ ...page, background: 'transparent' }] }, { layers: [{ ...page, opacity: 0.5 }] },     // nothing below to show through
    { layers: [{ ...page, region: { x: 0, y: 0, width: 0.5, height: 1 } }] },
    { layers: [base, { ...page, input: ['pointer', 'pointer'] }] }, { layers: [{ id: 'base', source: { kind: 'screen' } }] },
    { page: 'http://agent.example/p' }, { page: 'https://user:pw@agent.example/p' }, { page: 'https://agent.example/p#x' },
    { page: { url: 'https://agent.example/p', digest: 'md5-x' } }, { page: { deployment_id: '' } },
    { page: 'https://agent.example/p', revision: -1 }, { layers: [{ ...page, id: 'Upper' }] },
  ]) await expect(client.setCallVideo('call', input as never, 'video-key-1')).rejects.toBeInstanceOf(TypeError);
  expect(seen).toEqual([]);
  // A region touching the frame edge is inside it.
  await client.setCallVideo('call', { layers: [base, { ...page, region: { x: 0.75, y: 0.75, width: 0.25, height: 0.25 } }] }, 'video-key-1');
  expect(seen.length).toBe(1);
});

test('call video: responses outside the contract fail as invalid_response', async () => {
  let data: unknown;
  const { client } = harness(() => Response.json({ data }));
  const withLayers = (layers: unknown[], extra: object = {}) => ({ ...layered, ...extra, layers });
  for (const bad of [
    withLayers([layered.layers[0], { ...captions, living_session: session(30) }]),                      // page fps above output fps
    withLayers([layered.layers[0], captions], { output: { width: 1920, height: 1080, fps: 30 } }),      // output fps above the base grant
    withLayers([{ id: 'base', z: 0, source: { kind: 'managed' }, publish: grant }, captions]),          // grant on a managed base
    withLayers([{ ...layered.layers[0], publish: { ...grant, content: 'screen' } }, captions]),
    withLayers([layered.layers[0], captions, { ...captions, id: 'more', z: 2 }]),
    withLayers([layered.layers[0], { ...captions, living_session: session(12, 'other') }]),
    withLayers([layered.layers[0], { ...captions, region: { x: 0.5, y: 0, width: 0.6, height: 1 } }]),
    withLayers([layered.layers[0], { ...captions, z: 0 }]),
    { ...layered, status: 'paused' }, { ...layered, output: { width: 1921, height: 1080, fps: 24 } },
  ]) {
    data = bad;
    await expect(client.getCallVideo('call')).rejects.toMatchObject({ code: 'invalid_response' });
  }
  data = withLayers([{ id: 'base', z: 0, source: { kind: 'managed' } }, captions]);
  await expect(client.getCallVideo('call')).resolves.toBeDefined();
});

test('call video: composition error codes survive sanitization without server text', async () => {
  for (const [status, code] of [[409, 'video_composition_unsupported'], [422, 'composition_invalid'], [409, 'composition_revision_conflict'],
    [409, 'composition_base_unavailable'], [409, 'media_session_conflict'], [409, 'composition_secret']] as const) {
    const { client } = harness(() => Response.json({ error: { code, message: 'internal detail' } }, { status }));
    const error = await client.setCallVideo('call', { page: { deployment_id: 'dep' } }, 'video-key-1').catch(e => e);
    expect([error.status, error.code, JSON.stringify(error).includes('internal detail') || String(error).includes('internal detail')])
      .toEqual([status, code === 'composition_secret' ? 'request_failed' : code, false]);
  }
});

test('video_composition capability: explicit, versioned, clamped to SDK v1 bounds', () => {
  const cap = { version: 1, supported: true, max_layers: 4, bases: ['camera', 'hologram', 'managed', 'camera'], page_alpha: true, regions: true,
    max_width: 3840, max_height: 1080, max_fps: 60 };
  expect(parseVideoComposition(cap)).toEqual({ version: 1, supported: true, max_layers: 2, bases: ['camera', 'managed'], page_alpha: true, regions: true,
    max_width: 1920, max_height: 1080, max_fps: 30 });
  expect(parseVideoComposition({ ...cap, page_alpha: 'yes' })?.page_alpha).toBe(false);
  for (const bad of [undefined, null, { ...cap, version: 2 }, { ...cap, supported: false }, { ...cap, max_layers: 0 }, { ...cap, bases: 'camera' }])
    expect(parseVideoComposition(bad)).toBeNull();
});
