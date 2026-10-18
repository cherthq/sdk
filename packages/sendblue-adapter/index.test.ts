import { expect, test } from 'bun:test';
import type { ChertFetch } from '@chert/sdk';
import SendblueAPI, { APIError, APIUserAbortError, NotFoundError } from './index';
const input = { from_number: '+15550000001', number: '+15550000002', content: 'hello' };
function client(fetch: ChertFetch, extra = {}) {
  return new SendblueAPI({ apiKey: 'vendor-key', apiSecret: 'vendor-secret', accessToken: 'vendor-token', ...extra,
    chert: { baseURL: 'https://chert.test', apiKey: 'chert-key', fetch } });
}
test('actual SDK response helpers, pinned sender and credential isolation', async () => {
  const calls: Request[] = [];
  const sdk = client(async (url, init) => {
    calls.push(new Request(url, init));
    return Response.json({ message: { id: 'id1', status: 'queued', created_at: '2026-10-17T00:00:00Z', direction: 'outbound', parts: [{ type: 'text', value: 'hello' }] } });
  });
  expect(sdk.apiKey).toBeUndefined();
  expect(sdk.apiSecret).toBeUndefined();
  expect(sdk.accessToken).toBe('chert-adapter');
  const { data } = await sdk.messages.send(input).withResponse();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://chert.test/api/v1/chats');
  expect(await calls[0]!.json()).toEqual({ from: input.from_number, to: [input.number], message: { parts: [{ type: 'text', value: 'hello' }] } });
  expect(JSON.stringify(Object.fromEntries(calls[0]!.headers))).not.toContain('vendor-');
  expect(calls[0]!.headers.has('sb-api-key-id')).toBe(false);
  expect(calls[0]!.headers.has('sb-api-secret-key')).toBe(false);
  expect(data).toEqual({ message_handle: 'id1', status: 'QUEUED', date_created: '2026-10-17T00:00:00Z', is_outbound: true, content: 'hello', from_number: input.from_number, number: input.number });
});
test.each([['queued', 'QUEUED'], ['sent', 'SENT'], ['delivered', 'DELIVERED'], ['read', 'DELIVERED'], ['failed', 'ERROR']] as const)('status %s with absent optional fields', async (status, expected) => {
  const data = await client(async () => Response.json({ message: { status } })).messages.send(input);
  expect(data.status).toBe(expected);
  for (const field of ['message_handle', 'date_created', 'date_updated', 'error_code', 'account_email']) expect(data).not.toHaveProperty(field);
});
test('unsupported fields and original SDK endpoints reject before network', async () => {
  let calls = 0;
  const sdk = client(async () => { calls++; return Response.json({}); });
  for (const call of [
    () => sdk.messages.send({ ...input, reply_to: {message_handle: 'unsupported-reply'} }),
    () => sdk.messages.send({ ...input, status_callback: 'https://example.test/hook' }),
    () => sdk.messages.send({ ...input, extra: true } as typeof input),
    () => sdk.messages.list({ worker_id: 'unsupported' }),
  ]) await expect((async () => await call())()).rejects.toMatchObject({ status: 501 });
  expect(calls).toBe(0);
});
test('constructor, request and clone retry guards; errors retain official class', async () => {
  let calls = 0;
  const fetch: ChertFetch = async () => { calls++; return Response.json({ error: { code: 3001, message: 'failed' } }, { status: 503 }); };
  expect(() => client(fetch, { maxRetries: 1 })).toThrow('maxRetries');
  const sdk = client(fetch);
  await expect((async () => await sdk.messages.send(input, { maxRetries: 1 }))()).rejects.toMatchObject({ status: 501 });
  expect(calls).toBe(0);
  await expect((async () => await sdk.messages.send(input))()).rejects.toBeInstanceOf(APIError);
  expect(calls).toBe(1);
  expect(() => sdk.withOptions({ maxRetries: 2 })).toThrow('maxRetries');
});
test('pre-aborted request never reaches Chert', async () => {
  let calls = 0;
  const sdk = client(async () => { calls++; return Response.json({}); });
  const controller = new AbortController(); controller.abort();
  await expect((async () => await sdk.messages.send(input, { signal: controller.signal }))()).rejects.toBeInstanceOf(APIUserAbortError);
  expect(calls).toBe(0);
});
test.each(['send', 'status', 'retrieve'] as const)('in-flight %s cancellation reaches Chert and prevents retry', async operation => {
  let calls = 0;
  let observed: AbortSignal | null = null;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const sdk = client(async (url, init) => {
    calls++;
    observed = new Request(url, init).signal;
    started();
    return await new Promise<Response>((_, reject) => {
      observed!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = operation === 'send' ? sdk.messages.send(input, { signal: controller.signal })
    : operation === 'status' ? sdk.messages.getStatus({ handle: 'event-42' }, { signal: controller.signal })
    : sdk.messages.retrieve('event-42', { signal: controller.signal });
  const result = (async () => await pending)();
  await ready;
  controller.abort();
  await expect(result).rejects.toBeInstanceOf(APIUserAbortError);
  expect(observed!.aborted).toBe(true);
  expect(calls).toBe(1);
});
test('clone remains isolated and unknown Chert statuses fail explicitly', async () => {
  let calls = 0;
  const sdk = client(async () => { calls++; return Response.json({ message: { status: 'unknown' } }); });
  const cloned = sdk.withOptions({ baseURL: 'https://vendor.test', apiKey: 'different-vendor-key' });
  await expect((async () => await cloned.messages.send(input))()).rejects.toMatchObject({ status: 502 });
  expect(calls).toBe(1);
});

test('canonical E.164 routing validation avoids response identity normalization', async () => {
  let calls = 0;
  const sdk = client(async () => { calls++; return Response.json({}); });
  await expect((async () => await sdk.messages.send({ ...input, from_number: ' +15550000001' }))()).rejects.toMatchObject({ status: 400 });
  expect(calls).toBe(0);
});

test('low-level request rejects explicit retries before any Chert send', async () => {
  let requests = 0;
  const sdk = client(async () => { requests++; return Response.json({ error: { code: 'temporary' } }, { status: 500 }); });
  const options = { method: 'post' as const, path: '/api/send-message', body: input };
  expect(() => sdk.request(options, 1)).toThrow('retry attempts');
  expect(requests).toBe(0);
  await expect((async () => await sdk.request(options, 0))()).rejects.toMatchObject({ status: 500 });
  expect(requests).toBe(1);
});

function recordedFixture(body: unknown, status = 200) {
  const requests: Request[] = [];
  const sdk = client(async (input, init) => { requests.push(new Request(input, init)); return Response.json(body, { status }); });
  return { sdk, requests };
}
test.each([
  ['queued', false, 'QUEUED'], ['sent', false, 'SENT'], ['sent', true, 'DELIVERED'], ['delivered', false, 'DELIVERED'], ['failed', false, 'ERROR'],
] as const)('getStatus preserves recorded %s delivered=%s', async (status, delivered, expected) => {
  const { sdk, requests } = recordedFixture({ id: 'event-42', status, delivered });
  expect(await sdk.messages.getStatus({ handle: 'event-42' })).toEqual({ message_handle: 'event-42', status: expected });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://chert.test/api/v1/messages/event-42');
  expect(requests[0]!.method).toBe('GET');
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer chert-key');
  expect(requests[0]!.headers.has('sb-api-key-id')).toBe(false);
});
test('retrieve wraps only observed optional fields without false sender or timestamps', async () => {
  const { sdk } = recordedFixture({ id: 'event-42', status: 'sent', delivered: false, phone: '+15551234567', text: 'observed text', direction: 'inbound', created_at: '2026-10-17T00:00:00Z' });
  expect(await sdk.messages.retrieve('event-42')).toEqual({ data: { message_handle: 'event-42', status: 'SENT', number: '+15551234567', content: 'observed text', is_outbound: false } });
  for (const status of ['received', 'duplicate', 'unknown']) {
    const { sdk } = recordedFixture({ id: 'event-42', status });
    expect(await sdk.messages.getStatus({ handle: 'event-42' })).toEqual({ message_handle: 'event-42' });
  }
});
test('recorded-message 404 retains original SDK NotFoundError, without retry', async () => {
  const { sdk, requests } = recordedFixture({ error: 'message not found' }, 404);
  try { await sdk.messages.retrieve('event-42'); throw new Error('Expected not found'); }
  catch (error) { expect(error).toBeInstanceOf(NotFoundError); expect(error).toMatchObject({ status: 404 }); }
  expect(requests).toHaveLength(1);
});
test('recorded-message identity mismatch fails and encoded IDs stay within route', async () => {
  const { sdk, requests } = recordedFixture({ id: 'event:42', status: 'queued' });
  expect((await sdk.messages.getStatus({ handle: 'event:42' })).message_handle).toBe('event:42');
  expect(requests[0]!.url).toBe('https://chert.test/api/v1/messages/event%3A42');
  await expect((async () => await sdk.messages.retrieve('wrong-id'))()).rejects.toMatchObject({ status: 502 });
  for (const id of ['../send', '..', 'id/other', '%2Fsend', 'id?other=1', 'id#fragment']) {
    await expect((async () => await sdk.messages.retrieve(id))()).rejects.toThrow();
    await expect((async () => await sdk.messages.getStatus({ handle: id }))()).rejects.toThrow();
  }
  expect(requests).toHaveLength(2);
});
test('status queries with extra routing fields reject before network', async () => {
  const { sdk, requests } = recordedFixture({ id: 'event-42', status: 'queued' });
  await expect((async () => await sdk.messages.getStatus({ handle: 'event-42', extra: 'ignored?' } as never))()).rejects.toMatchObject({ status: 501 });
  expect(requests).toHaveLength(0);
});
test('pre-aborted recorded-message reads never reach Chert', async () => {
  const { sdk, requests } = recordedFixture({ id: 'event-42', status: 'queued' });
  const controller = new AbortController(); controller.abort();
  await expect((async () => await sdk.messages.getStatus({ handle: 'event-42' }, { signal: controller.signal }))()).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test('official Sendblue typing sends default/start/stop only after exact native-application acknowledgement', async () => {
  for (const state of [undefined, 'start', 'stop'] as const) {
    const calls: Request[] = []; const expected = state === 'stop' ? 'stopped' : 'typing';
    const sdk = client(async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({ from: '+15551234567', to: '+15557654321', state: expected, applied: true, chat_id: 'chat-existing' });
    });
    expect(await sdk.typingIndicators.send({ from_number: '+15551234567', number: '+15557654321', ...(state ? { state } : {}) })).toEqual({ number: '+15557654321', status: 'SENT' });
    expect(calls).toHaveLength(1); expect(calls[0]!.url).toBe('https://chert.test/api/v1/typing');
    expect(calls[0]!.method).toBe('POST');
    expect(await calls[0]!.json()).toEqual({ from: '+15551234567', to: '+15557654321', state: expected });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer chert-key');
    expect([...calls[0]!.headers.values()].join(' ')).not.toContain('vendor');
  }
});

test('typing rejects unsupported duration, fields and routing/options before any Chert request', async () => {
  let calls = 0; const sdk = client(async () => { calls++; return Response.json({}); });
  const params = { from_number: '+15551234567', number: '+15557654321' };
  for (const fields of [
    { ...params, max_duration_ms: 1000 }, { ...params, max_duration_ms: undefined },
    { ...params, state: 'typing' }, { ...params, state: null }, { ...params, content: 'not a message' },
    { ...params, from_number: 'sender' }, { ...params, from_number: '+015551234567' },
    { ...params, number: 'person@example.test' }, { ...params, number: '+1555 7654321' },
  ]) await expect((async () => await sdk.typingIndicators.send(fields as Parameters<typeof sdk.typingIndicators.send>[0]))()).rejects.toMatchObject({ status: 501 });
  for (const options of [
    { maxRetries: 1 }, { query: {} }, { headers: {} }, { idempotencyKey: 'key' },
    { stream: true }, { __binaryResponse: true }, { fetchOptions: {} },
    { defaultBaseURL: 'https://other.invalid' }, { body: { ...params, extra: true } },
  ]) await expect((async () => await sdk.typingIndicators.send(params, options as Parameters<typeof sdk.typingIndicators.send>[1]))()).rejects.toMatchObject({ status: 501 });
  await expect((async () => await sdk.post('https://other.invalid/api/send-typing-indicator', { body: params }))()).rejects.toMatchObject({ status: 501 });
  await expect((async () => await sdk.post('https://sendblue.chert.invalid/api/send-typing-indicator', { body: params, headers: { 'x-extra': 'unsupported' } }))()).rejects.toMatchObject({ status: 501 });
  expect(calls).toBe(0);
});
test('typing wrong sender/recipient/state or incomplete application evidence never claims SENT', async () => {
  const params = { from_number: '+15551234567', number: '+15557654321' };
  const good = { from: params.from_number, to: params.number, state: 'typing', applied: true, chat_id: 'chat-existing' };
  for (const response of [null, {}, { ...good, from: '+15550000009' }, { ...good, to: '+15550000009' },
    { ...good, state: 'stopped' }, { ...good, applied: false }, { ...good, applied: 1 },
    { ...good, chat_id: '' }, { ...good, success: false }, { ...good, ok: false },
    { ...good, error: 'failed' }, { ...good, error_message: 'failed' }, { ...good, status: 'ERROR' }]) {
    let calls = 0; const sdk = client(async () => { calls++; return Response.json(response); });
    await expect((async () => await sdk.typingIndicators.send(params))()).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(1);
  }
});
test('typing cloud/native errors preserve official SDK failures without diagnostics or retry', async () => {
  for (const status of [403, 404, 501, 502]) {
    let calls = 0; const sdk = client(async () => { calls++; return Response.json({ error: { code: 4103, message: 'private upstream detail' } }, { status }); });
    try { await sdk.typingIndicators.send({ from_number: '+15551234567', number: '+15557654321' }); throw new Error('Expected failure'); }
    catch (error) { expect(error).toBeInstanceOf(APIError); expect(error).toMatchObject({ status }); expect(JSON.stringify(error)).not.toContain('private upstream detail'); }
    expect(calls).toBe(1);
  }
});
test('typing cancellation propagates and never creates a second native attempt', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  const sdk = client(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    calls++; init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
  }));
  const controller = new AbortController(); const params = { from_number: '+15551234567', number: '+15557654321' };
  const pending = (async () => await sdk.typingIndicators.send(params, { signal: controller.signal }))();
  await ready; controller.abort(); await expect(pending).rejects.toBeInstanceOf(APIUserAbortError); expect(calls).toBe(1);
  await expect((async () => await sdk.typingIndicators.send(params, { signal: controller.signal }))()).rejects.toBeInstanceOf(APIUserAbortError); expect(calls).toBe(1);
});

test('recorded read maps delivery and received is exposed only by the official retrieve schema', async () => {
  for (const [status, getStatus, retrieveStatus] of [
    ['read', 'DELIVERED', 'DELIVERED'],
    ['received', undefined, 'RECEIVED'],
    ['queued', 'QUEUED', 'QUEUED'],
    ['unknown', undefined, undefined],
    ['duplicate', undefined, undefined],
  ] as const) {
    const { sdk, requests } = recordedFixture({ id: 'event-42', status, delivered: true,
      phone: '+15551234567', text: 'actual text', direction: status === 'received' ? 'inbound' : 'outbound',
      created_at: '2026-10-17T00:00:00Z', read_at: '2026-10-17T01:00:00Z' });
    const common = { message_handle: 'event-42', number: '+15551234567', content: 'actual text', is_outbound: status !== 'received' };
    const observed = await sdk.messages.getStatus({ handle: 'event-42' }).withResponse();
    expect(observed.data).toEqual({ ...common, ...(getStatus ? { status: getStatus } : {}) });
    expect(observed.response.status).toBe(200);
    expect(await sdk.messages.retrieve('event-42')).toEqual({ data: { ...common, ...(retrieveStatus ? { status: retrieveStatus } : {}) } });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe('https://chert.test/api/v1/messages/event-42');
      expect(request.headers.get('authorization')).toBe('Bearer chert-key');
      expect(request.headers.has('sb-api-key-id')).toBe(false);
    }
  }
});

test('inbound local reads are received, while read with unknown direction never claims peer delivery', async () => {
  for (const direction of ['inbound', 'unknown', undefined] as const) {
    const { sdk, requests } = recordedFixture({ id: 'event-42', status: 'read', direction,
      text: 'actual text', read_at: '2026-10-17T01:00:00Z' });
    const common = { message_handle: 'event-42', content: 'actual text', ...(direction === 'inbound' ? { is_outbound: false } : {}) };
    expect(await sdk.messages.getStatus({ handle: 'event-42' })).toEqual(common);
    expect(await sdk.messages.retrieve('event-42')).toEqual({ data: { ...common, ...(direction === 'inbound' ? { status: 'RECEIVED' } : {}) } });
    expect(requests).toHaveLength(2);
  }
});

test('account-wide list uses one tenant-wide GET rather than chat history fanout', async () => {
  const requests:Request[]=[];
  const sdk=client(async(u,i)=>{requests.push(new Request(u,i));return Response.json({messages:[],pagination:{has_more:false,limit:50,offset:0,total:0}});});
  expect(await sdk.messages.list({number:'+15550000002',is_outbound:'false',order_by:'createdAt'})).toEqual({data:[],pagination:{hasMore:false,limit:50,offset:0,total:0}});
  expect(requests).toHaveLength(1);
  const url=new URL(requests[0]!.url);expect(url.pathname).toBe('/api/v1/messages');
  expect(Object.fromEntries(url.searchParams)).toEqual({number:'+15550000002',direction:'inbound',order_by:'created_at'});
  await expect((async()=>await sdk.messages.list({account_email:'unavailable'}))()).rejects.toMatchObject({status:501});
  expect(requests).toHaveLength(1);
});


test('3.20.1 optional upstream sender never enables automatic Chert line selection', async () => {
  let calls = 0;
  const sdk = client(async () => { calls++; throw new Error('No automatic sender'); });
  await expect((async () => await sdk.messages.send({ number: input.number, content: input.content }))()).rejects.toMatchObject({ status: 400 });
  expect(calls).toBe(0);
});

test('account history rejects inherited overrides before any authenticated request',async()=>{
 let calls=0;const sdk=client(async()=>{calls++;throw Error('no');});
 for(const options of [{headers:{x:'private'}},{body:{}},{fetchOptions:{redirect:'follow'}},{idempotencyKey:'key'},{stream:true}])
  await expect((async()=>await sdk.messages.list({},options as never))()).rejects.toMatchObject({status:501});
 expect(calls).toBe(0);
});
