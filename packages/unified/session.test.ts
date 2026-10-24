import { expect, test } from 'bun:test';
import { ChertSDK, UNIFIED_CONTRACT, UNIFIED_SCOPES, UnsupportedUnifiedBackend } from './index';

const token = 'chu_' + 'a'.repeat(43), project = '11000000-0000-4000-8000-000000000001';
const descriptor = (imessage = 'https://console.trychert.com', facetime = 'https://facetime.trychert.com') => ({
  data: { contract: 'chert-unified', contract_version: 1,
    auth: { scheme: 'Bearer', token_prefix: 'chu_', audience: 'chert.unified-api:v1', login_url: facetime + '/api/v1/cli/logins' },
    services: { imessage: { base_url: imessage + '/api/v1' }, facetime: { base_url: facetime + '/api/v1' } }, scopes: [...UNIFIED_SCOPES] }, request_id: 'fixture',
});

test('unified discovery precedes credentials and one session authorizes both channels with version echo', async () => {
  const requests: { url: string; headers: Headers; method: string }[] = [];
  let echo = true;
  const fetcher = (async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    requests.push({ url, headers, method: init?.method ?? 'GET' });
    expect(init?.redirect).toBe('error');
    if (url.endsWith('/sdk/capabilities')) {
      expect(headers.has('authorization')).toBe(false); return Response.json(descriptor());
    }
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('x-chert-contract')).toBe(UNIFIED_CONTRACT);
    const responseHeaders: Record<string, string> = echo ? { 'X-Chert-Contract': UNIFIED_CONTRACT } : {};
    if (url.includes('console.')) {
      expect(headers.has('x-chert-tenant')).toBe(false);
      expect(headers.has('x-chert-project-id')).toBe(false);
      if (url.includes('/stream')) return new Response('event: close\ndata: {"reconnect_with_since":"opaque"}\n\n', { headers: { ...responseHeaders, 'Content-Type': 'text/event-stream' } });
      return Response.json({ events: [], next_cursor: null, count: 0 }, { headers: responseHeaders });
    }
    expect(headers.get('x-chert-project-id')).toBe(project);
    return Response.json({ data: { id: 'call' } }, { status: 201, headers: responseHeaders });
  }) as typeof fetch;
  const sdk = await ChertSDK.connect({ accessToken: token, projectId: project, fetch: fetcher });
  expect(requests).toHaveLength(1);
  expect(await sdk.imessage.listEvents()).toEqual({ events: [], next_cursor: null, count: 0 });
  const call = await sdk.facetime.createCall({ direction: 'outbound', mode: 'managed', assistant_id: 'assistant', destination: '+15550000001', media: { audio: true, video: false } }, 'stable-key');
  expect(call.id).toBe('call');
  const frames = [];
  for await (const frame of sdk.imessage.streamEvents()) frames.push(frame);
  expect(frames).toEqual([{ event: 'close', data: { reconnect_with_since: 'opaque' } }]);
  echo = false;
  await expect(sdk.imessage.listEvents()).rejects.toBeInstanceOf(UnsupportedUnifiedBackend);
  await expect(sdk.imessage.streamEvents().next()).rejects.toBeInstanceOf(UnsupportedUnifiedBackend);
  await expect(sdk.facetime.getCall('call')).rejects.toMatchObject({ status: 426, code: 'unsupported_unified_backend' });
  expect(requests[0]!.url).toBe('https://console.trychert.com/api/v1/sdk/capabilities');
});

test('old, malformed, foreign-origin and incomplete capabilities never receive the token', async () => {
  const foreign = descriptor(); foreign.data.services.facetime.base_url = 'https://unapproved.example/api/v1';
  const old = descriptor(); old.data.contract_version = 0;
  const missingScope = descriptor(); missingScope.data.scopes.pop();
  const wrongAuth = descriptor(); wrongAuth.data.auth.token_prefix = 'ftu_';
  const duplicateScope = descriptor(); duplicateScope.data.scopes.push(UNIFIED_SCOPES[0]);
  const malformedScope = descriptor(); (malformedScope.data.scopes as unknown[]).push(null);
  for (const response of [Response.json({}, { status: 404 }), Response.json(foreign), Response.json(old), Response.json(missingScope), Response.json(wrongAuth), Response.json(duplicateScope), Response.json(malformedScope), new Response('x'.repeat(65_537)), Response.json(null)]) {
    let requests = 0;
    await expect(ChertSDK.connect({ accessToken: token, projectId: project, fetch: (async (_, init) => {
      requests++; expect(new Headers(init?.headers).has('authorization')).toBe(false); return response;
    }) as typeof fetch })).rejects.toBeInstanceOf(UnsupportedUnifiedBackend);
    expect(requests).toBe(1);
  }
});

test('explicit endpoint and credential mistakes fail locally; approved custom origins work', async () => {
  const fetcher = (async (): Promise<Response> => { throw new Error('must not request'); }) as unknown as typeof fetch;
  for (const accessToken of ['ftu_' + 'a'.repeat(43), token + '\n', '', token + 'a'])
    await expect(ChertSDK.connect({ accessToken, projectId: project, fetch: fetcher })).rejects.toBeInstanceOf(TypeError);
  for (const imessageBaseURL of ['', null, 'https://host.example/path', 'http://remote.example', 'https://user:secret@host.example'])
    await expect(ChertSDK.connect({ accessToken: token, projectId: project, imessageBaseURL: imessageBaseURL as string, fetch: fetcher })).rejects.toBeInstanceOf(TypeError);
  let requests = 0;
  const sdk = await ChertSDK.connect({ accessToken: token, projectId: project,
    imessageBaseURL: 'http://127.0.0.1:1234', facetimeBaseURL: 'http://127.0.0.1:4321', fetch: (async (url, init) => {
      requests++;
      if (requests === 1) return Response.json(descriptor('http://127.0.0.1:1234', 'http://127.0.0.1:4321'));
      expect(String(url)).toBe('http://127.0.0.1:1234/api/v1/events?');
      return Response.json({ events: [], count: 0, next_cursor: null }, { headers: { 'X-Chert-Contract': UNIFIED_CONTRACT } });
    }) as typeof fetch });
  await sdk.imessage.listEvents(); expect(requests).toBe(2);
});

test('failed response cancellation cannot conceal an unsupported contract', async () => {
  const sdk = await ChertSDK.connect({ accessToken: token, projectId: project, fetch: (async (url) => {
    if (String(url).endsWith('/sdk/capabilities')) return Response.json(descriptor());
    return new Response(new ReadableStream({ cancel() { throw new Error('cancel-failed'); } }));
  }) as typeof fetch });
  await expect(sdk.imessage.listEvents()).rejects.toBeInstanceOf(UnsupportedUnifiedBackend);
  await expect(sdk.facetime.getCall('call')).rejects.toMatchObject({ status: 426, code: 'unsupported_unified_backend' });
});
