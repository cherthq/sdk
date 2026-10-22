import { expect, test, mock } from 'bun:test';
import contract from './fixtures/contract.json';
import { BLOOIO_V4_CONTRACT, createBlooioV4Fetch } from './index';
const text = { from: '+15551234567', to: '+15557654321', text: 'hello' };
function setup(result: unknown = { message: { id: 'real-message-id', chat_id: 'chat_existing', status: 'queued' } }, status = 200, tenant?: string) {
  const fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => new URL(_input instanceof Request ? _input.url : String(_input)).pathname.endsWith('/idempotency/lookup') ? Response.json({found:false}) : Response.json(result, { status }));
  return { fetch, transport: createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'chert-secret', fetch, tenant } }) };
}
function post(transport: ReturnType<typeof createBlooioV4Fetch>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return transport(`https://api.blooio.com/v4${path}`, { method: 'POST', headers: { Authorization: 'Bearer vendor-secret', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
test('pins actual v4 schema, operations and optional send-result fields', () => {
  expect({ url: contract.source, version: contract.version, sha256: contract.sha256 }).toEqual(BLOOIO_V4_CONTRACT);
  expect(contract.operations['/messages'].operationId).toBe('sendMessage');
  expect(contract.operations['/contacts/{contactId}'].get.operationId).toBe('getContact');
  expect('required' in contract.schemas.Contact).toBe(false);
  expect(contract.schemas.Contact.properties.name.type).toEqual(['string','null']);
  expect(contract.operations['/chats/{chatId}/messages'].operationId).toBe('sendMessageToChat');
  expect('required' in contract.schemas.MessageSendResult).toBe(false);
});
test.each(['/messages', '/chats/chat_existing/messages'])('maps %s actual IDs and lifecycle without inventing transport/sender metadata', async path => {
  const { fetch, transport } = setup();
  const response = await post(transport, path, path === '/messages' ? text : { text: text.text });
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result).toEqual({ id: 'real-message-id', chat_id: 'chat_existing', status: 'queued' });
  for (const [key, value] of Object.entries(result)) {
    const property = contract.schemas.MessageSendResult.properties[key as keyof typeof contract.schemas.MessageSendResult.properties];
    expect(property).toBeDefined();
    expect('type' in property && property.type).toBe(typeof value);
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  const [input, init] = fetch.mock.calls[0];
  const request = new Request(input, init);
  expect(request.url).toBe(`https://chert.test/api/v1${path === '/messages' ? '/chats' : path}`);
  expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
  expect(await request.json()).toEqual(path === '/messages'
    ? { from: text.from, to: [text.to], message: { parts: [{ type: 'text', value: text.text }] } }
    : { message: { parts: [{ type: 'text', value: text.text }] } });
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('vendor-secret');
});
test('rejects unsupported channel/routing/content requirements before contacting Chert', async () => {
  const { fetch, transport } = setup();
  for (const body of [
    { to: text.to, text: text.text }, { ...text, from: 'support' }, { ...text, to: [text.to] },
    ...['blooio', 'twilio', 'whatsapp', 'whatsapp_business', 'rcs_business', 'amb'].map(channel_type => ({ ...text, channel_type })),
    { ...text, preferred_service: 'imessage' }, { ...text, protocol: 'imessage' }, { ...text, attachments: ['https://media.test/image.png'] }, { ...text, dry_run: true },
  ]) expect((await (await post(transport, '/messages', body)).json()).error.code).toBe('unsupported_feature');
  expect((await (await post(transport, '/chats/chat_existing/messages', {text:text.text}, { 'Idempotency-Key': 'key', 'x-unsupported':'unsafe' })).json()).error.code).toBe('unsupported_feature');
  expect(fetch).not.toHaveBeenCalled();
});
test('failed HTTP errors retain the v4 error schema and never retry', async () => {
  const { fetch, transport } = setup({ success: false, error: { code: 4103, message: 'sensitive server text' } }, 500);
  const response = await post(transport, '/messages', text);
  const result = await response.json();
  expect(response.status).toBe(500);
  expect(Object.keys(result)).toEqual(contract.schemas.Error.required);
  expect(Object.keys(result.error).sort()).toEqual([...contract.schemas.Error.properties.error.required].sort());
  expect(result.error.code).toBe('4103');
  expect(JSON.stringify(result)).not.toContain('sensitive server text');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('incomplete or wrong-chat results are outcome-unknown with exactly one send', async () => {
  for (const result of [{ message: { id: 'real-id' } }, { message: { id: 'real-id', chat_id: 'another-chat', status: 'sent' } }]) {
    const { fetch, transport } = setup(result);
    const response = await post(transport, '/chats/chat_existing/messages', { text: 'hello' });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('outcome_unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('unkeyed chat replies reject noncanonical IDs before contacting Chert', async () => {
  const { fetch, transport } = setup();
  for (const id of ['chat%2Fx', 'chat%252Fx']) {
    const response = await post(transport, `/chats/${id}/messages`, { text: 'hello' });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: { code: 'unsupported_feature' } });
  }
  expect(fetch).not.toHaveBeenCalled();
});
test('network timeout is outcome-unknown and never retried', async () => {
  const fetch = mock(async () => { throw new DOMException('Timed out', 'TimeoutError'); });
  const transport = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch } });
  const response = await post(transport, '/messages', text);
  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe('outcome_unknown');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('aborted requests and unsupported endpoints never dispatch', async () => {
  const { fetch, transport } = setup();
  const controller = new AbortController(); controller.abort();
  await expect(transport('https://api.blooio.com/v4/messages', { method: 'POST', body: JSON.stringify(text), signal: controller.signal })).rejects.toThrow();
  expect((await transport('https://api.blooio.com/v4/channels?cursor=unsupported')).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});
test('in-flight cancellation reaches Chert without retry or invented response', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    started();
  }));
  const transport = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch } });
  const controller = new AbortController();
  const pending = transport('https://api.blooio.com/v4/messages', { method: 'POST', body: JSON.stringify(text), signal: controller.signal });
  await ready; controller.abort();
  await expect(pending).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('pins the official v4 chat-scoped status operation and response fields', () => {
  const operation = contract.operations['/chats/{chatId}/messages/{messageId}/status'];
  expect(operation.operationId).toBe('getMessageStatus');
  expect(operation.responseCodes).toEqual(['200', '401', '404']);
  expect(operation.responseSchema.properties.data.$ref).toBe('#/components/schemas/MessageStatus');
  expect(contract.schemas.MessageStatus.properties.id.type).toBe('string');
  expect(contract.schemas.MessageStatus.properties.status.type).toBe('string');
});

test('reads actual message state with explicit Chert auth and exact chat membership', async () => {
  const { fetch, transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status: 'queued',
    phone: 'private', created_at: '2026-10-17', response: { private: true } }, 200, 'chert-tenant');
  const response = await transport('https://api.blooio.com/v4/chats/%63hat_existing/messages/%6dsg_1/status', {
    headers: { Authorization: 'Bearer vendor-secret', 'X-Chert-Tenant': 'untrusted-tenant' },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { id: 'msg_1', status: 'queued' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = new Request(...fetch.mock.calls[0]);
  expect(request.url).toBe('https://chert.test/api/v1/messages/msg_1');
  expect(request.method).toBe('GET');
  expect(request.body).toBeNull();
  expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
  expect(request.headers.get('x-chert-tenant')).toBe('chert-tenant');
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('vendor-secret');
});

test.each([null, undefined, 'duplicate', 'unsupported', 1])('does not invent lifecycle evidence from %s', async status => {
  const { transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status, delivered: true,
    protocol: 'imessage', created_at: '2026-10-17', updated_at: '2026-10-17' });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1/status');
  expect(await response.json()).toEqual({ data: { id: 'msg_1' } });
});

test.each(['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'received'])('preserves recorded status %s without enrichment', async status => {
  const { transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1/status');
  expect(await response.json()).toEqual({ data: { id: 'msg_1', status } });
});

test('wrong or missing chat membership and mismatched IDs never disclose returned data', async () => {
  for (const [result, code] of [
    [{ id: 'msg_1', lead_id: 'another-chat', status: 'delivered', private: 'secret' }, 404],
    [{ id: 'msg_1', lead_id: null, status: 'delivered', private: 'secret' }, 404],
    [{ id: 'another-message', lead_id: 'chat_existing', status: 'delivered', private: 'secret' }, 502],
  ] as const) {
    const { fetch, transport } = setup(result);
    const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1/status');
    expect(response.status).toBe(code);
    const body = await response.json();
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/another-chat|another-message|delivered|secret/);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

test('rejects unknown status paths, queries and encoded path escapes before Chert', async () => {
  const { fetch, transport } = setup();
  for (const path of [
    '/v4/messages/msg_1/status', '/v4/chats/chat_existing/messages/msg_1/unsupported',
    '/v4/chats/chat_existing/messages/msg_1/status?include=private',
    ...['%2F', '%5C', '%252F', '%00', '%ZZ'].map(id => `/v4/chats/chat_existing/messages/${id}/status`),
    '/v4/chats/chat%2Fother/messages/msg_1/status',
  ]) expect((await transport(`https://api.blooio.com${path}`)).status).toBe(501);
  expect((await transport('https://other.test/v4/chats/chat_existing/messages/msg_1/status')).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});

test('status lookup preserves sanitized Chert errors and does not retry', async () => {
  const { fetch, transport } = setup({ error: 'private account detail' }, 404);
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1/status');
  expect(response.status).toBe(404);
  expect(JSON.stringify(await response.json())).not.toContain('private account detail');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('status network outages are bounded errors without retries or private diagnostics', async () => {
  let calls = 0;
  const transport = createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;throw new Error('private network diagnostic');}}});
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1/status');
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({error:{code:'status_unavailable',message:'Chert status could not be read.'}});
  expect(calls).toBe(1);
});

test('pins typing POST/DELETE defaults and optional response properties', () => {
  const operation = contract.operations['/chats/{chatId}/typing'];
  expect(operation.post.operationId).toBe('setTyping');
  expect(operation.delete.operationId).toBe('stopTyping');
  expect(operation.post.requestBody.required).toBe(false);
  expect(operation.post.requestBody.content['application/json'].schema.properties.state).toEqual({ type: 'string', enum: ['started', 'stopped'], default: 'started' });
  expect('required' in operation.post.responseSchema.properties.data).toBe(false);
});
test.each([
  ['POST', undefined, 'typing', 'started'], ['POST', {}, 'typing', 'started'],
  ['POST', { state: 'started' }, 'typing', 'started'], ['POST', { state: 'stopped' }, 'stopped', 'stopped'],
  ['DELETE', undefined, 'stopped', 'stopped'],
] as const)('typing %s %j uses actual state and never invents a timestamp', async (method, body, state, output) => {
  const { fetch, transport } = setup({ chat_id: 'chat_existing', state }, 200, 'tenant-pinned');
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/typing', {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: 'Bearer vendor-secret', 'x-chert-tenant': 'vendor-tenant' },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { chat_id: 'chat_existing', state: output } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [input, init] = fetch.mock.calls[0]; const request = new Request(input, init);
  expect(request.url).toBe('https://chert.test/api/v1/chats/chat_existing/typing');
  expect(request.method).toBe('POST'); expect(await request.json()).toEqual({ state });
  expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('vendor-secret');
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('vendor-tenant');
});
test('typing rejects unsupported input and ambiguous identifiers before any network call', async () => {
  const { fetch, transport } = setup();
  for (const body of [null, [], 'started', { state: 'typing' }, { state: null }, { from: text.from }, { state: 'started', channel_type: 'amb' }]) {
    expect((await post(transport, '/chats/chat_existing/typing', body)).status).toBe(501);
  }
  for (const body of ['{}', ' ', '{']) expect((await transport('https://api.blooio.com/v4/chats/chat_existing/typing', { method: 'DELETE', body })).status).toBe(501);
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/typing', { method: 'POST', body: '{' })).status).toBe(501);
  for (const id of ['bad%2Fid', 'bad%5Cid', 'bad%250Aid', '%00', '%']) expect((await transport(`https://api.blooio.com/v4/chats/${id}/typing`, { method: 'POST' })).status).toBe(501);
  for (const url of ['https://other.test/v4/chats/chat_existing/typing', 'https://api.blooio.com/v4/chats/chat_existing/typing?state=started', 'https://api.blooio.com/v4/chats/chat_existing/typing#extra']) expect((await transport(url, { method: 'POST' })).status).toBe(501);
  expect((await post(transport, '/chats/chat_existing/typing', {}, { 'Idempotency-Key': 'key' })).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});
test('typing never claims success for upstream failures, missing or mismatched observations', async () => {
  for (const result of [{}, { chat_id: 'wrong', state: 'typing' }, { chat_id: 'chat_existing', state: 'stopped' }, { chat_id: 'chat_existing', state: 'typing', error: 'not applied' }]) {
    const { fetch, transport } = setup(result);
    const response = await post(transport, '/chats/chat_existing/typing', {});
    expect(response.status).toBe(502); expect((await response.json()).error.code).toBe('outcome_unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  for (const status of [404, 502]) {
    const { fetch, transport } = setup({ error: { code: 4099, message: 'sensitive native detail' } }, status);
    const response = await post(transport, '/chats/chat_existing/typing', {});
    expect(response.status).toBe(status); expect((await response.json()).error.code).toBe('4099');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('typing cancellation reaches the sole Chert attempt', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
  }));
  const transport = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch } });
  const controller = new AbortController();
  const pending = transport('https://api.blooio.com/v4/chats/chat_existing/typing', { method: 'DELETE', signal: controller.signal });
  await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});

test('recorded retrieval maps only observed flat content with exact message/chat binding', async () => {
  const { fetch, transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status: 'received',
    text: 'observed inbound text', direction: 'inbound', service: 'unknown',
    phone: 'private', created_at: '2026-10-17T00:00:00Z', request: { content: 'private' } });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { id: 'msg_1', chat_id: 'chat_existing', status: 'received', text: 'observed inbound text', direction: 'inbound' } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = new Request(...fetch.mock.calls[0]);
  expect(request.url).toBe('https://chert.test/api/v1/messages/msg_1'); expect(request.method).toBe('GET'); expect(request.body).toBeNull();
});

test('pins official getChatMessage operation and optional Message schema from unchanged snapshot', () => {
  const operation = contract.operations['/chats/{chatId}/messages/{messageId}'];
  expect(operation.operationId).toBe('getChatMessage');
  expect(operation.responseCodes).toEqual(['200', '401', '404']);
  expect(operation.responseSchema.properties.data.$ref).toBe('#/components/schemas/Message');
  expect('required' in contract.schemas.Message).toBe(false);
  expect(contract.schemas.Message.properties.text.type).toEqual(['string', 'null']);
  expect(contract.schemas.Message.properties.created_at.type).toBe('integer');
  expect(contract.sha256).toBe(BLOOIO_V4_CONTRACT.sha256);
});
test('retrieve does not promote service, delivery booleans, timestamps, parts or request metadata into observations', async () => {
  const { transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status: 'unknown',
    direction: 'unknown', service: 'imessage', delivered: true, text: null,
    parts: [{ type: 'text', value: 'must not infer' }], request: { body: 'private' },
    response: { status: 'sent', service: 'imessage', retryable: false },
    created_at: '2026-10-17T00:00:00Z', delivered_at: '2026-10-17T00:00:00Z', error: 'private error' });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1');
  expect(await response.json()).toEqual({ data: { id: 'msg_1', chat_id: 'chat_existing' } });
});
test('retrieve preserves only explicit supported direction and lifecycle values', async () => {
  for (const direction of ['inbound', 'outbound'] as const) {
    const { transport } = setup({ id: 'msg_1', lead_id: 'chat_existing', status: 'failed', direction,
      text: '', error: 'private delivery failure' });
    expect(await (await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1')).json())
      .toEqual({ data: { id: 'msg_1', chat_id: 'chat_existing', text: '', direction, status: 'failed' } });
  }
});
test('retrieve exact identity/chat authorization fails without exposing response fields', async () => {
  for (const [body, status] of [
    [{ id: 'msg_1', lead_id: 'foreign-chat', text: 'private text' }, 404],
    [{ id: 'msg_1', text: 'private text' }, 404],
    [{ id: 'wrong-message', lead_id: 'chat_existing', text: 'private text' }, 502],
  ] as const) {
    const { fetch, transport } = setup(body);
    const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1');
    expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain('private text');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('retrieve rejects malformed IDs, queries, methods and unsupported headers before network', async () => {
  const { fetch, transport } = setup();
  for (const id of ['bad%2Fid', 'bad%5Cid', '%252F', '%00', '%20', '%3f', '%23', '%', 'a'.repeat(161)]) {
    expect((await transport(`https://api.blooio.com/v4/chats/chat_existing/messages/${id}`)).status).toBe(501);
  }
  for (const suffix of ['?include=private', '#fragment', '/events', '/attachments']) {
    expect((await transport(`https://api.blooio.com/v4/chats/chat_existing/messages/msg_1${suffix}`)).status).toBe(501);
  }
  for (const headers of [{ 'Idempotency-Key': 'key' }, { 'X-Route': 'other' }] as Record<string, string>[]) {
    expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1', { headers })).status).toBe(501);
  }
  expect((await transport('https://other.test/v4/chats/chat_existing/messages/msg_1')).status).toBe(501);
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1', { method: 'DELETE' })).status).toBe(501);
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1', { method: 'GET', body: '{}' })).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});
test('retrieve preserves sanitized HTTP failure and cancellation with no retries', async () => {
  const { fetch, transport } = setup({ error: { code: 2005, message: 'private auth detail' } }, 403);
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1');
  expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain('private auth detail');
  expect(fetch).toHaveBeenCalledTimes(1);
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let attempts = 0;
  const cancellable = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    attempts++; init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
  }) } });
  const controller = new AbortController();
  const pending = cancellable('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1', { signal: controller.signal });
  await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(attempts).toBe(1);
  await expect(cancellable('https://api.blooio.com/v4/chats/chat_existing/messages/msg_1', { signal: controller.signal })).rejects.toThrow(); expect(attempts).toBe(1);
});

test('URL fragments reject every supported operation before any Chert dispatch', async () => {
  const { fetch, transport } = setup();
  for (const path of ['/messages', '/chats/chat_existing/messages']) {
    expect((await post(transport, `${path}#unsupported`, path === '/messages' ? text : { text: 'hello' })).status).toBe(501);
  }
  for (const path of ['/chats/chat_existing/messages/msg_1', '/chats/chat_existing/messages/msg_1/status']) {
    expect((await transport(`https://api.blooio.com/v4${path}#unsupported`)).status).toBe(501);
  }
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/typing#unsupported', { method: 'POST' })).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});

test('history first page uses official defaults and returns actual plaintext plus opaque next cursor', async () => {
  const { fetch, transport } = setup({ messages: [{ id: 'msg_1', chat_id: 'chat_existing', parts: [{ type: 'text', value: 'one' }, { type: 'text', value: 'two' }], status: 'received', direction: 'inbound' }], has_more: true, next_cursor: 'opaque_next' });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [{ id: 'msg_1', chat_id: 'chat_existing', text: 'one\n\ntwo', status: 'received', direction: 'inbound' }], has_more: true, next_cursor: 'opaque_next' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(new Request(...fetch.mock.calls[0]).url).toBe('https://chert.test/api/v1/chats/chat_existing/messages?order=desc&limit=50');
});
test('history accepts nullable flattened text when plaintext parts are present', async () => {
  const { fetch, transport } = setup({
    messages: [{ id: 'msg_1', chat_id: 'chat_existing', parts: [{ type: 'text', value: 'hello' }], text: null }],
    has_more: false, next_cursor: null,
  });
  const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [{ id: 'msg_1', chat_id: 'chat_existing', text: 'hello' }], has_more: false, next_cursor: null });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('pins listChatMessages query limits and optional page schema without changing source hash', () => {
  const op = contract.operations['/chats/{chatId}/messages'].get;
  expect(op.operationId).toBe('listChatMessages');
  expect(op.responseSchema.properties.data.items.$ref).toBe('#/components/schemas/Message');
  expect('required' in op.responseSchema).toBe(false);
  expect(op.parameters.find(p => p.name === 'limit')!.schema).toEqual({ type: 'integer', minimum: 1, maximum: 200, default: 50 });
  expect(op.parameters.find(p => p.name === 'order')!.schema).toEqual({ type: 'string', enum: ['asc', 'desc'], default: 'desc' });
  expect(contract.sha256).toBe(BLOOIO_V4_CONTRACT.sha256);
});
test('history forwards opaque continuation with varying limits and inherits omitted order', async () => {
  const { fetch, transport } = setup({ messages: [], has_more: false, next_cursor: null });
  for (const query of ['order=asc&limit=1&cursor=opaque_token', 'limit=200&cursor=opaque_token', 'cursor=opaque_token']) {
    const response = await transport(`https://api.blooio.com/v4/chats/%63hat_existing/messages?${query}`);
    expect(await response.json()).toEqual({ data: [], has_more: false, next_cursor: null });
    const request = new Request(...fetch.mock.calls.at(-1)!);
    const url = new URL(request.url); expect(url.pathname).toBe('/api/v1/chats/chat_existing/messages');
    expect(url.searchParams.get('cursor')).toBe('opaque_token');
    expect(url.searchParams.get('limit')).toBe(query.includes('limit=1&') ? '1' : query.includes('limit=200') ? '200' : '50');
    expect(url.searchParams.get('order')).toBe(query.startsWith('order=asc') ? 'asc' : null);
    expect(request.method).toBe('GET'); expect(request.body).toBeNull();
  }
  expect(fetch).toHaveBeenCalledTimes(3);
});
test('history rejects invalid/duplicate queries, body, headers and chat IDs before network', async () => {
  const { fetch, transport } = setup();
  for (const query of ['limit=0', 'limit=201', 'limit=01', 'limit=1.0', 'limit=-1', 'limit=NaN', 'limit=',
    'order=ASC', 'order=', 'order=asc&order=desc', 'limit=1&limit=2', '%6cimit=1&limit=2',
    'cursor=', 'cursor=a&cursor=b', 'cursor=bad%0a', 'cursor=%25escape', `cursor=${'a'.repeat(2049)}`, 'unknown=1']) {
    expect((await transport(`https://api.blooio.com/v4/chats/chat_existing/messages?${query}`)).status).toBe(501);
  }
  for (const id of ['bad%2Fchat', '%252f', '%00', '%20', '%', 'a'.repeat(161)]) expect((await transport(`https://api.blooio.com/v4/chats/${id}/messages`)).status).toBe(501);
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages', { body: '{}', method: 'GET' })).status).toBe(501);
  expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages', { headers: { 'X-Route': 'other' } })).status).toBe(501);
  expect((await transport('https://other.test/v4/chats/chat_existing/messages')).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});
test('history rejects inconsistent pagination and foreign, duplicate or nonplaintext records without leaking a partial page', async () => {
  const row = { id: 'msg_1', chat_id: 'chat_existing', parts: [{ type: 'text', value: 'visible' }] };
  for (const page of [
    { messages: [], has_more: true, next_cursor: 'next' },
    { messages: [row], has_more: true, next_cursor: null },
    { messages: [row], has_more: false, next_cursor: 'next' },
    { messages: [row], has_more: false }, { messages: [row], has_more: 'false', next_cursor: null },
    { messages: [row, row], has_more: false, next_cursor: null },
    { messages: [{ ...row, chat_id: 'foreign', text: 'private' }], has_more: false, next_cursor: null },
    { messages: [{ ...row, id: 'bad/ID' }], has_more: false, next_cursor: null },
    { messages: [{ ...row, parts: [{ type: 'media', url: 'private' }] }], has_more: false, next_cursor: null },
    { messages: [{ ...row, parts: [{ type: 'text', value: 1 }] }], has_more: false, next_cursor: null },
    { messages: [{ ...row, parts: [{ type: 'text', value: 'visible', text: 'different' }] }], has_more: false, next_cursor: null },
    { messages: [{ ...row, text: 'different' }], has_more: false, next_cursor: null },
  ]) {
    const { fetch, transport } = setup(page);
    const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages');
    expect(response.status).toBe(502); const body = await response.json(); expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/private|foreign|visible|different/); expect(fetch).toHaveBeenCalledTimes(1);
  }
  for (const page of [{ messages: [row], has_more: true, next_cursor: 'same' }, { messages: [row, { ...row, id: 'msg_2' }], has_more: false, next_cursor: null }]) {
    const { transport } = setup(page);
    expect((await transport('https://api.blooio.com/v4/chats/chat_existing/messages?cursor=same&limit=1')).status).toBe(502);
  }
});
test('history omits unobserved protocol, time, metadata and lifecycle rather than inventing defaults', async () => {
  const { transport } = setup({ messages: [{ id: 'msg_1', chat_id: 'chat_existing', parts: [], status: 'unknown', direction: 'unknown',
    delivered: true, service: 'imessage', created_at: '2026-10-17T00:00:00Z', request: { private: true } }], has_more: false, next_cursor: null });
  expect(await (await transport('https://api.blooio.com/v4/chats/chat_existing/messages')).json()).toEqual({ data: [{ id: 'msg_1', chat_id: 'chat_existing' }], has_more: false, next_cursor: null });
});
test('history errors are sanitized and cancellation/no retry remain one request', async () => {
  for (const status of [401, 404, 409, 500]) {
    const { fetch, transport } = setup({ error: { code: 'snapshot_changed', message: 'private server content' } }, status);
    const response = await transport('https://api.blooio.com/v4/chats/chat_existing/messages');
    expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain('private server content'); expect(fetch).toHaveBeenCalledTimes(1);
  }
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let count = 0;
  const transport = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    count++; init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
  }) } });
  const controller = new AbortController(); const pending = transport('https://api.blooio.com/v4/chats/chat_existing/messages', { signal: controller.signal });
  await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(count).toBe(1);
  await expect(transport('https://api.blooio.com/v4/chats/chat_existing/messages', { signal: controller.signal })).rejects.toThrow(); expect(count).toBe(1);
});

test('getChannel selects actual assigned UUID or phone and omits unobserved provider fields', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  for (const reference of [id, '+15551234567']) {
    const { transport, fetch } = setup({ phone_numbers: [{ id, phone_number: '+15551234567', service: 'imessage', capabilities: ['imessage'] }] });
    const response = await transport(`https://api.blooio.com/v4/channels/${encodeURIComponent(reference)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id, address: '+15551234567' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Request(...fetch.mock.calls[0]!).url).toBe('https://chert.test/api/v1/phone-numbers');
  }
});

test('channel inventory rejects unsupported references and request overrides before effects', async () => {
  const { transport, fetch } = setup();
  for (const reference of ['support', 'ch_vendor', '550E8400-E29B-41D4-A716-446655440000', '%2F', '%252F', '..%2Fx', '%3F', '%23', '+0123']) {
    expect((await transport(`https://api.blooio.com/v4/channels/${reference}`)).status).toBe(501);
  }
  const path = 'https://api.blooio.com/v4/channels/%2B15551234567';
  for (const [url, init] of [
    [path + '?limit=1', {}], [path + '#x', {}], [path.replace('api.blooio.com', 'foreign.test'), {}],
    [path, { headers: { 'x-custom': 'secret' } }], [path, { headers: { 'Idempotency-Key': 'x' } }],
    [path, { method: 'POST', body: '{}' }],
  ] as [string, RequestInit][]) expect((await transport(url, init)).status).toBe(501);
  expect(fetch).not.toHaveBeenCalled();
});
test('channel inventory rejects malformed or ambiguous complete inventory without leaking rows', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const line = { id, phone_number: '+15551234567' };
  for (const result of [null, {}, { phone_numbers: null }, ...[
    [line, line], [line, { ...line, id: '650e8400-e29b-41d4-a716-446655440000' }],
    [line, { ...line, phone_number: '+15557654321' }], [line, { id: 'not-uuid', phone_number: '+15557654321' }],
    [line, { id: '650e8400-e29b-41d4-a716-446655440000', phone_number: 'secret-invalid' }],
  ].map(phone_numbers => ({ phone_numbers }))]) {
    const { transport, fetch } = setup(result);
    const response = await transport(`https://api.blooio.com/v4/channels/${id}`);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-invalid');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  const { transport, fetch } = setup({ phone_numbers: [] });
  expect((await transport(`https://api.blooio.com/v4/channels/${id}`)).status).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('channel inventory propagates sanitized errors once and aborts without retries', async () => {
  for (const status of [401, 404, 500]) {
    const { transport, fetch } = setup({ error: { code: 'inventory_error', message: 'secret-upstream' } }, status);
    const response = await transport('https://api.blooio.com/v4/channels/%2B15551234567');
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('secret-upstream');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
  const controller = new AbortController(); controller.abort();
  const { transport, fetch } = setup();
  await expect((async () => await transport('https://api.blooio.com/v4/channels/%2B15551234567', { signal: controller.signal }))()).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test('pins optional getChannel schema from unchanged official artifact', () => {
  expect(contract.operations['/channels/{channel}'].operationId).toBe('getChannel');
  expect(contract.operations['/channels/{channel}'].responseSchema.properties.data.$ref).toBe('#/components/schemas/Channel');
  expect('required' in contract.schemas.Channel).toBe(false);
  expect(contract.schemas.Channel.properties.address.type).toEqual(['string', 'null']);
});
test('channel inventory forwards inflight cancellation with one attempt', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const transport = createBlooioV4Fetch({ chert: { baseURL: 'https://chert.test', apiKey: 'chert-secret', fetch: async (input, init) => {
    attempts++;
    const request = new Request(input, init);
    controller.abort();
    request.signal.throwIfAborted();
    throw new Error('unreachable');
  } } });
  await expect((async () => await transport('https://api.blooio.com/v4/channels/%2B15551234567', { signal: controller.signal }))()).rejects.toThrow();
  expect(attempts).toBe(1);
});

test('receipt-emitting markChatRead stays unsupported before any Chert dispatch', async () => {
  const pinned = contract.operations['/chats/{chatId}/read'].post;
  expect(pinned.operationId).toBe('markChatRead');
  expect(pinned.description).toBe('Sends a read receipt. Blooio channels only.');
  expect(pinned.responseSchema.properties.data.properties.read.type).toBe('boolean');
  expect(pinned.responseSchema.properties.data.properties.at.type).toBe('integer');
  const { transport, fetch } = setup({ chat_id: 'chat_existing', applied: true });
  for (const body of [undefined, {}, { read: true }]) {
    const response = await transport('https://api.blooio.com/v4/chats/chat_existing/read', {
      method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    });
    expect(response.status).toBe(501);
    expect((await response.json()).error.code).toBe('unsupported_feature');
  }
  expect(fetch).not.toHaveBeenCalled();
});
test('getChat returns actual owned DM contact identity without inferred channel metadata',async()=>{
 const {transport,fetch}=setup({chat:{id:'chat-a',display_name:'Actual Name',handles:[{address:'+15551234567',service:'unknown'}],is_group:false,created_at:'2026-10-17T00:00:00Z',private:'omit'}});
 const response=await transport('https://api.blooio.com/v4/chats/chat-a');expect(response.status).toBe(200);
 expect(await response.json()).toEqual({data:{id:'chat-a',contact:{contact_id:'chat-a',identifier:'+15551234567',name:'Actual Name'},group:null}});
 expect(fetch).toHaveBeenCalledTimes(1);const request=new Request(...fetch.mock.calls[0]);expect(request.url).toBe('https://chert.test/api/v1/chats/chat-a');expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
});
test('getChat rejects groups and malformed whole responses',async()=>{
 const base={id:'chat-a',display_name:null,handles:[{address:'+15551234567'}],is_group:false};
 for(const [change,status] of [[{is_group:true},501],[{id:'other'},502],[{is_group:0},502],[{display_name:undefined},502],[{handles:[]},502],[{handles:[{address:'1555'}]},502],[{handles:[{address:'+15551234567'},{address:'+15557654321'}]},502]] as const){
 const {transport,fetch}=setup({chat:{...base,...change}});expect((await transport('https://api.blooio.com/v4/chats/chat-a')).status).toBe(status);expect(fetch).toHaveBeenCalledTimes(1);
 }
});
test('getChat request guards, cancellation and server failures retain one-attempt isolation',async()=>{
 const {transport,fetch}=setup();
 for(const path of ['/chats/chat-a?limit=1','/chats/chat%2Fa','/chats/chat%252Fa'])expect((await transport(`https://api.blooio.com/v4${path}`)).status).toBe(501);
 expect((await transport('https://api.blooio.com/v4/chats/chat-a',{headers:{'x-extra':'bad'}})).status).toBe(501);expect(fetch).not.toHaveBeenCalled();
 const abort=new AbortController();abort.abort();await expect(transport('https://api.blooio.com/v4/chats/chat-a',{signal:abort.signal})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 const failed=setup({error:{code:3001,message:'private receiver data'}},500);const response=await failed.transport('https://api.blooio.com/v4/chats/chat-a');expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('private receiver');expect(failed.fetch).toHaveBeenCalledTimes(1);
});

test('getChat schema requires complete contact summary and preserves actual null name',async()=>{
 expect(contract.operations['/chats/{chatId}'].get.operationId).toBe('getChat');
 expect(contract.schemas.ContactSummary.required).toEqual(['contact_id','identifier','name']);
 const {transport}=setup({chat:{id:'chat-a',display_name:null,is_group:false,handles:[{address:'+15551234567'}]}});
 expect(await (await transport('https://api.blooio.com/v4/chats/chat-a')).json()).toEqual({data:{id:'chat-a',contact:{contact_id:'chat-a',identifier:'+15551234567',name:null},group:null}});
});

test('getChat preserves actual Chert request ID on API failure',async()=>{
 let calls=0;
 const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'chert-secret',fetch:async()=>{calls++;return Response.json({error:{code:3001,message:'private'}},{status:500,headers:{'x-request-id':'fixture-chat-request'}});}}});
 const response=await transport('https://api.blooio.com/v4/chats/chat-a');
 expect(response.status).toBe(500);expect(response.headers.get('x-request-id')).toBe('fixture-chat-request');expect(calls).toBe(1);expect(JSON.stringify(await response.json())).not.toContain('private');
});
const imageID='a'.repeat(48),imageTenant='10000000-0000-4000-8000-000000000001';
const imageURL=`https://chert.test/api/v1/attachments/${imageID}/download?tenant=${imageTenant}&signature=${'b'.repeat(64)}`;
const imageMetadata={attachment_id:imageID,content_type:'image/png',size_bytes:4,filename:'image.png',uploaded_at:'2026-10-17T00:00:00.000Z',download_url:imageURL};
test('existing-chat single canonical uploaded image preflights actual metadata then sends actual ID once',async()=>{
 const calls:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'chert-secret',fetch:async(input,init)=>{const req=new Request(input,init);calls.push(req);return Response.json(req.method==='GET'?{attachment:imageMetadata}:{message:{id:'actual-media-send',chat_id:'chat_existing',status:'queued'}});}}});
 const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});expect(response.status).toBe(201);expect(await response.json()).toEqual({id:'actual-media-send',chat_id:'chat_existing',status:'queued'});expect(calls.map(r=>[r.method,r.url])).toEqual([['GET',`https://chert.test/api/v1/attachments/${imageID}`],['POST','https://chert.test/api/v1/chats/chat_existing/messages']]);expect(await calls[1]!.json()).toEqual({message:{parts:[{type:'media',attachment_id:imageID}]}});
});
test('media rejects unsupported URLs/options and opaque IDs before any Chert request',async()=>{
 for(const body of [{attachments:['http://foreign.test/image.png']},{attachments:[imageURL,imageURL]},{attachments:[imageID]},{attachments:[imageURL.replace('https:','http:')]},{attachments:[imageURL+'#fragment']},{attachments:[imageURL+'&extra=1']},{attachments:[imageURL],carousel:false},{attachments:[imageURL],format:'markdown'},{attachments:[imageURL],text:''},{attachments:[imageURL],text:'caption'},{attachments:[imageURL],text:null},{attachments:[imageURL],unknown:true}]){
  const {fetch,transport}=setup();expect((await post(transport,'/chats/chat_existing/messages',body)).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);
 }
 const {fetch,transport}=setup();expect((await post(transport,'/messages',{...text,attachments:[imageURL]})).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);
});
test('image metadata ownership/upload/type/size/identity checks fail before any POST',async()=>{
 for(const patch of [{attachment_id:'foreign'},{download_url:imageURL+'x'},{uploaded_at:null},{uploaded_at:'invalid'},{size_bytes:0},{size_bytes:100*1024*1024+1},{size_bytes:1.5},{filename:'../image.png'},{filename:'sound.mp3',content_type:'audio/mpeg'},{filename:'clip.mp4',content_type:'video/mp4'},{content_type:'image/svg+xml'},{live_photo:true},{companion_attachment_id:'other'}]){
  const calls:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{calls.push(new Request(i,o));return Response.json({attachment:{...imageMetadata,...patch}});}}});
  expect((await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]})).status).toBe(502);expect(calls.length).toBe(1);expect(calls[0]!.method).toBe('GET');
 }
});
test('single image without caption and JPEG metadata preserve actual send response only',async()=>{
 for(const meta of [imageMetadata,{...imageMetadata,filename:'PHOTO.JPEG',content_type:'image/jpeg'}]){
  const calls:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{const req=new Request(i,o);calls.push(req);return Response.json(req.method==='GET'?{attachment:meta}:{message:{id:'send',chat_id:'chat_existing',status:'sent'}});}}});
  const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});expect(await response.json()).toEqual({id:'send',chat_id:'chat_existing',status:'sent'});expect(await calls[1]!.json()).toEqual({message:{parts:[{type:'media',attachment_id:imageID}]}});expect(calls.every(r=>r.headers.get('authorization')==='Bearer key')).toBe(true);
 }
});
test('media metadata failures never dispatch; uncertain POST has exactly one attempt',async()=>{
 for(const stage of ['metadata','send']){
  const calls:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{const req=new Request(i,o);calls.push(req);if(stage==='metadata'||req.method==='POST')throw Error('private-secret');return Response.json({attachment:imageMetadata});}}});
  const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});expect(response.status).toBe(502);const raw=await response.text();expect(raw).not.toContain('private-secret');expect(raw).toContain(stage==='metadata'?'attachment_unavailable':'outcome_unknown');expect(calls.length).toBe(stage==='metadata'?1:2);
 }
});
test('media cancellation during metadata propagates without dispatch',async()=>{
 const abort=new AbortController();let calls=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;abort.abort();return Response.json({attachment:imageMetadata});}}});
 await expect(transport('https://api.blooio.com/v4/chats/chat_existing/messages',{method:'POST',signal:abort.signal,body:JSON.stringify({attachments:[imageURL]})})).rejects.toThrow();expect(calls).toBe(1);
});
test('image overrides and metadata auth failures cannot dispatch a send',async()=>{
 const overrides:Record<string,string>[]=[{'x-custom':'unsupported'}];
 for(const headers of overrides){const {fetch,transport}=setup();expect((await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]},headers)).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);}
 const calls:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{calls.push(new Request(i,o));return Response.json({error:{code:'unauthorized',message:'Denied'}},{status:401,headers:{'x-request-id':'actual-auth-failure'}});}}});
 const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});expect(response.status).toBe(401);expect(response.headers.get('x-request-id')).toBe('actual-auth-failure');expect(calls.map(r=>r.method)).toEqual(['GET']);
});
test('uncertain media response preserves only actual durable reconciliation IDs in documented error details',async()=>{
 const id='10000000000040008000000000000001';let calls=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{calls++;return new Request(i,o).method==='GET'?Response.json({attachment:imageMetadata}):Response.json({message_id:id,chat_id:'chat_existing',private_native_secret:'must-not-leak',error:{code:4103,message:'Reconcile before retrying',retryable:false}},{status:502});}}});
 const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});expect(response.status).toBe(502);expect(await response.json()).toEqual({error:{code:'4103',message:'Chert request failed (502); reconcile uncertain sends before retrying',details:{message_id:id,chat_id:'chat_existing',retryable:false}}});expect(calls).toBe(2);
});
test('media reconciliation details refuse foreign chat, malformed public ID and retryable/raw metadata',async()=>{
 for(const patch of [{chat_id:'foreign'},{message_id:'msg_native'},{message_id:'a'.repeat(32)+'\n'},{error:{code:4103,retryable:true}},{message_id:undefined}]){let calls=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{calls++;return new Request(i,o).method==='GET'?Response.json({attachment:imageMetadata}):Response.json({message_id:'a'.repeat(32),chat_id:'chat_existing',private_native_secret:'must-not-leak',error:{code:4103,retryable:false},...patch},{status:502});}}});const response=await post(transport,'/chats/chat_existing/messages',{attachments:[imageURL]});const value=await response.json();expect(value.error.details).toBeUndefined();expect(JSON.stringify(value)).not.toContain('must-not-leak');expect(calls).toBe(2);}
});

test('listChannels returns only complete assigned identity inventory with no inferred channel metadata',async()=>{
 const calls:Request[]=[];const line={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001',status:'active',api_key:'private-key'};
 let inventory:unknown={phone_numbers:[line]};const adapter=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'chert-key',fetch:async(input,init)=>{calls.push(new Request(input,init));return Response.json(inventory);}}});
 const response=await adapter('https://api.blooio.com/v4/channels');expect(response.status).toBe(200);expect(await response.json()).toEqual({data:[{id:line.id,address:line.phone_number}],has_more:false,next_cursor:null});expect(calls.length).toBe(1);expect(calls[0]!.url).toBe('https://chert.test/api/v1/phone-numbers');expect(calls[0]!.method).toBe('GET');
 for(const query of ['?type=blooio','?status=active','?limit=50','?cursor=opaque','?unknown=1']){const before=calls.length;expect((await adapter('https://api.blooio.com/v4/channels'+query)).status).toBe(501);expect(calls.length).toBe(before)}
 for(const value of [{phone_numbers:[line,line]},{phone_numbers:[{...line,id:'foreign'}]},{phone_numbers:[{...line,phone_number:'+15550000001\n'}]},{phone_numbers:Array.from({length:51},(_,i)=>({...line,id:`21000000-0000-4000-8000-${String(i).padStart(12,'0')}`,phone_number:'+1555'+String(i).padStart(7,'0')}))}]){inventory=value;expect((await adapter('https://api.blooio.com/v4/channels')).status).toBe(502)}
 inventory={phone_numbers:[]};expect(await (await adapter('https://api.blooio.com/v4/channels')).json()).toEqual({data:[],has_more:false,next_cursor:null});
});
test('getContact projects only actual owned Chert contact ID and nullable name',async()=>{
 for(const name of ['Actual Name',null]){const {transport,fetch}=setup({chat:{id:'contact-a',display_name:name,handles:[{address:'+15551234567'}],is_group:false,created_at:'2026-10-17T00:00:00Z',private:'omit'}});const response=await transport('https://api.blooio.com/v4/contacts/contact-a');expect(response.status).toBe(200);expect(await response.json()).toEqual({data:{id:'contact-a',name}});expect(fetch).toHaveBeenCalledTimes(1);expect(new Request(...fetch.mock.calls[0]).url).toBe('https://chert.test/api/v1/chats/contact-a');}
});
test('getContact guards malformed paths and options before requests and rejects group/malformed metadata',async()=>{
 for(const path of ['/contacts/contact-a?x=1','/contacts/contact%2fa','/contacts/contact%252fa']){const {transport,fetch}=setup({});expect((await transport('https://api.blooio.com/v4'+path)).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);}
 for(const init of [{method:'POST',body:'{}'},{headers:{'Idempotency-Key':'unsafe'}}]){const {transport,fetch}=setup({});expect((await transport('https://api.blooio.com/v4/contacts/contact-a',init)).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);}
 const base={id:'contact-a',display_name:null,handles:[{address:'+15551234567'}],is_group:false};
 for(const patch of [{id:'foreign'},{is_group:0},{display_name:undefined},{handles:[]},{handles:[{address:'+15551234567\n'}]}]){const {transport,fetch}=setup({chat:{...base,...patch}});expect((await transport('https://api.blooio.com/v4/contacts/contact-a')).status).toBe(502);expect(fetch).toHaveBeenCalledTimes(1);}
 const {transport,fetch}=setup({chat:{...base,is_group:true}});expect((await transport('https://api.blooio.com/v4/contacts/contact-a')).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(1);
});
test('getContact preserves owned errors/request IDs and cancellation without retries',async()=>{
 let calls=0;const adapter=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async()=>{calls++;return Response.json({error:{code:1001,message:'private'}},{status:404,headers:{'x-request-id':'actual-trace'}});}}});
 const response=await adapter('https://api.blooio.com/v4/contacts/contact-a');expect(response.status).toBe(404);expect(response.headers.get('x-request-id')).toBe('actual-trace');expect(await response.text()).not.toContain('private');expect(calls).toBe(1);
 const abort=new AbortController();abort.abort();await expect(adapter('https://api.blooio.com/v4/contacts/contact-a',{signal:abort.signal})).rejects.toThrow();expect(calls).toBe(1);
});

test('keyed explicit-sender plaintext maps durable fresh/replay receipts without forwarding vendor headers',async()=>{
 for(const replayed of [false,true]){
  const {transport,fetch}=setup({message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed}},202);
  const response=await post(transport,'/messages',text,{'Idempotency-Key':'order / key'});
  expect(response.status).toBe(replayed?200:201);expect(await response.json()).toEqual({id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'});
  expect(fetch).toHaveBeenCalledTimes(2);const req=new Request(...fetch.mock.calls[1]);
  expect((await req.json()).message.idempotency_key).toBe('order / key');expect(req.headers.has('Idempotency-Key')).toBe(false);
  expect(req.headers.get('Authorization')).toBe('Bearer chert-secret');expect(JSON.stringify(fetch.mock.calls)).not.toContain('vendor-secret');
 }
});
test('keyed plaintext refuses invalid keys/options before HTTP and accepts exactly 200 UTF8 bytes',async()=>{
 for(const key of ['', 'x'.repeat(201), 'é'.repeat(101)]){const {transport,fetch}=setup();expect((await post(transport,'/messages',text,{'Idempotency-Key':key})).status).toBe(501);expect(fetch).toHaveBeenCalledTimes(0);}
 const {transport,fetch}=setup({message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:false}});
 expect((await post(transport,'/messages',text,{'Idempotency-Key':'é'.repeat(100)})).status).toBe(201);expect(fetch).toHaveBeenCalledTimes(2);
 const bad=setup();expect((await post(bad.transport,'/messages',text,{'Idempotency-Key':'key','x-custom':'unsafe'})).status).toBe(501);expect(bad.fetch).toHaveBeenCalledTimes(0);
});
test('keyed missing/malformed replay indicators or receipts are unknown after one dispatch, never retried',async()=>{
 for(const idempotency of [undefined,null,{}, {replayed:1},{replayed:'true'},{replayed:true,extra:true}]){const {transport,fetch}=setup({message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency});const response=await post(transport,'/messages',text,{'Idempotency-Key':'key'});expect(response.status).toBe(502);expect((await response.json()).error.code).toBe('outcome_unknown');expect(fetch).toHaveBeenCalledTimes(2);}
 const {transport,fetch}=setup({message:{id:'550e8400-e29b-41d4-a716-446655440000',chat_id:'chat_owned',status:'queued'},idempotency:{replayed:false}});expect((await post(transport,'/messages',text,{'Idempotency-Key':'key'})).status).toBe(502);expect(fetch).toHaveBeenCalledTimes(2);
});
test('keyed conflict and unknown outcome preserve safe semantics and owned public reconciliation only',async()=>{
 const conflict=setup({error:{code:1002,retryable:false}},409);expect((await post(conflict.transport,'/messages',text,{'Idempotency-Key':'key'})).status).toBe(409);expect(conflict.fetch).toHaveBeenCalledTimes(2);
 for(const patch of [{},{message_id:'native-guid'},{chat_id:'bad/chat'},{error:{code:4103,retryable:true}}]){
  const s=setup({message_id:'a'.repeat(32),chat_id:'chat_owned',private_native_secret:'PRIVATE',error:{code:4103,retryable:false},...patch},502);const response=await post(s.transport,'/messages',text,{'Idempotency-Key':'key'});const result=await response.json();
  expect(response.status).toBe(502);expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(s.fetch).toHaveBeenCalledTimes(2);
  expect(result.error.details).toEqual(Object.keys(patch).length?undefined:{message_id:'a'.repeat(32),chat_id:'chat_owned',retryable:false});
 }
});
test('keyed cancellation and thrown transport error never retry',async()=>{
 const abort=new AbortController();abort.abort();const s=setup();await expect(s.transport('https://api.blooio.com/v4/messages',{method:'POST',headers:{'Idempotency-Key':'key'},body:JSON.stringify(text),signal:abort.signal})).rejects.toThrow();expect(s.fetch).toHaveBeenCalledTimes(0);
 let calls=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;throw Error('PRIVATE');}}});const result=await post(transport,'/messages',text,{'Idempotency-Key':'key'});expect(result.status).toBe(502);expect((await result.json()).error.code).toBe('outcome_unknown');expect(calls).toBe(1);
});
test('unrepresentable HTTP header keys and altered reconciliation IDs cause zero extra attempts',async()=>{
 for(const key of ['key\0unsafe','\ud800']){const s=setup();await expect(post(s.transport,'/messages',text,{'Idempotency-Key':key})).rejects.toThrow();expect(s.fetch).toHaveBeenCalledTimes(0);}
 for(const chat_id of ['%63hat_owned','chat_owned\n','../foreign']){const s=setup({message_id:'a'.repeat(32),chat_id,error:{code:4103,retryable:false}},502);const response=await post(s.transport,'/messages',text,{'Idempotency-Key':'key'});expect((await response.json()).error.details).toBeUndefined();expect(s.fetch).toHaveBeenCalledTimes(2);}
});

test('canonical provider context preserves exact strings, arrays and URL identity with sorted object keys',async()=>{
 const {createV4IdempotencyRequest}=await import('./idempotency');
 const {createHash}=await import('node:crypto');
 const body={to:text.to,text:'  Café / 🌅\r\n  ',from:text.from};
 const context=await createV4IdempotencyRequest('/v4/messages',body);
 expect(context).toEqual({version:1,profile:'blooio-v4',route:'/v4/messages',body_sha256:createHash('sha256').update(JSON.stringify({from:body.from,text:body.text,to:body.to})).digest('hex')});
 expect(await createV4IdempotencyRequest('/v4/messages',{from:body.from,text:body.text,to:body.to})).toEqual(context);
 expect((await createV4IdempotencyRequest('/v4/messages',{...body,text:body.text.trim()})).body_sha256).not.toBe(context.body_sha256);
 const first=await createV4IdempotencyRequest('/v4/chats/chat_existing/messages',{attachments:[imageURL]});
 expect((await createV4IdempotencyRequest(first.route,{attachments:[imageURL.replace('signature='+new URL(imageURL).searchParams.get('signature'),'signature='+'e'.repeat(64))]})).body_sha256).not.toBe(first.body_sha256);
 for(const route of ['/v4/chats/%63hat/messages','/v4/chats/../messages','/v4/chats/chat%2Fforeign/messages'])await expect(createV4IdempotencyRequest(route,{})).rejects.toThrow();
});
test('all supported keyed paths replay before routing or image metadata with one readonly lookup',async()=>{
 for(const [path,body] of [['/messages',text],['/chats/chat_owned/messages',{text:'reply'}],['/chats/chat_owned/messages',{attachments:[imageURL]}]] as const){
  const requests:Request[]=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(i,o)=>{const req=new Request(i,o);requests.push(req);expect(new URL(req.url).pathname).toBe('/api/v1/idempotency/lookup');return Response.json({found:true,message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:true}});}}});
  const response=await post(transport,path,body,{'Idempotency-Key':'key'});expect(response.status).toBe(200);expect(requests).toHaveLength(1);expect(requests[0]!.method).toBe('POST');const sent=await requests[0]!.json();expect(sent.key).toBe('key');expect(sent.request.route).toBe('/v4'+path);expect(sent.request.profile).toBe('blooio-v4');expect(sent.request.body_sha256).toMatch(/^[a-f0-9]{64}$/);
 }
});
test('keyed fresh reply and image forward the same frozen context after lookup, one native send request only',async()=>{
 for(const media of [false,true]){
  const calls:Array<{path:string;method:string;body:any}>=[];const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(i,o)=>{const req=new Request(i,o),path=new URL(req.url).pathname;calls.push({path,method:req.method,body:req.method==='POST'?await req.json():null});return path.endsWith('/lookup')?Response.json({found:false}):req.method==='GET'?Response.json({attachment:imageMetadata}):Response.json({message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:false}},{status:202});}}});
  const response=await post(transport,'/chats/chat_owned/messages',media?{attachments:[imageURL]}:{text:'exact\r\n reply'},{'Idempotency-Key':'owned-key'});expect(response.status).toBe(201);expect(calls.map(c=>c.method)).toEqual(media?['POST','GET','POST']:['POST','POST']);expect(calls.at(-1)!.body.message.idempotency_request).toEqual(calls[0]!.body.request);expect(calls.at(-1)!.body.message.idempotency_key).toBe('owned-key');expect(calls.filter(c=>c.path.endsWith('/messages'))).toHaveLength(1);
 }
});
test('stale image metadata performs one race reconciliation lookup, never dispatches automatically',async()=>{
 for(const race of ['replay','missing','unknown'] as const){
  const paths:string[]=[];let lookups=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(i,o)=>{const req=new Request(i,o),path=new URL(req.url).pathname;paths.push(path);if(path.endsWith('/lookup')){lookups++;if(lookups===1||race==='missing')return Response.json({found:false});if(race==='unknown')return Response.json({message_id:'a'.repeat(32),chat_id:'chat_owned',error:{code:4103,retryable:false}},{status:502});return Response.json({found:true,message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:true}});}expect(req.method).toBe('GET');return Response.json({error:{code:5001}},{status:404});}}});
  const response=await post(transport,'/chats/chat_owned/messages',{attachments:[imageURL]},{'Idempotency-Key':'key'});expect(response.status).toBe(race==='replay'?200:race==='unknown'?502:404);expect(lookups).toBe(2);expect(paths).toEqual(['/api/v1/idempotency/lookup','/api/v1/attachments/'+imageID,'/api/v1/idempotency/lookup']);if(race==='unknown')expect((await response.json()).error.details).toEqual({message_id:'a'.repeat(32),chat_id:'chat_owned',retryable:false});
 }
});
test('lookup rejects malformed/foreign receipts and propagates changed-URL conflict without metadata',async()=>{
 for(const value of [{found:false,extra:true},{found:0},{found:true,message:{id:'a'.repeat(32),chat_id:'foreign',status:'queued'},idempotency:{replayed:true}},{found:true,message:{id:'a'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:false}}]){
 const fetch=mock(async()=>Response.json(value));const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch}});expect((await post(transport,'/chats/chat_owned/messages',{text:'reply'},{'Idempotency-Key':'key'})).status).toBe(502);expect(fetch).toHaveBeenCalledTimes(1);
 }
 let hash='';const fetch=mock(async(i:RequestInfo|URL,o?:RequestInit)=>{const body=await new Request(i,o).json();hash=body.request.body_sha256;return Response.json({error:{code:1002,retryable:false}},{status:409});});const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch}});
 const changed=imageURL.replace('signature='+new URL(imageURL).searchParams.get('signature'),'signature='+'e'.repeat(64));expect((await post(transport,'/chats/chat_owned/messages',{attachments:[changed]},{'Idempotency-Key':'key'})).status).toBe(409);expect(hash).toMatch(/^[a-f0-9]{64}$/);expect(fetch).toHaveBeenCalledTimes(1);
});
test('lookup refuses expanded receipt fields rather than trusting extra source metadata',async()=>{
 const full={id:'a'.repeat(32),chat_id:'chat_owned',status:'queued',parts:[{type:'text',value:'reply'}],created_at:'2026-01-01T00:00:00Z',direction:'outbound',service:'unknown',delivered_at:null,read_at:null};
 for(const patch of [{},{parts:[{type:'text',value:'other'}]},{direction:'inbound'},{service:'imessage'},{created_at:'bad'},{delivered_at:'2026-01-01T00:01:00Z'},{mac_native_guid:'private'}]){
 const fetch=mock(async()=>Response.json({found:true,message:{...full,...patch},idempotency:{replayed:true}}));const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch}});const response=await post(transport,'/chats/chat_owned/messages',{text:'reply'},{'Idempotency-Key':'key'});expect(response.status).toBe(502);expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(await response.json())).not.toContain('private');
 }
});
test('abort during keyed lookup prevents metadata, reconciliation and message dispatch',async()=>{
 const abort=new AbortController();let calls=0;const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;abort.abort();return Response.json({found:false});}}});
 await expect(transport('https://api.blooio.com/v4/chats/chat_owned/messages',{method:'POST',body:JSON.stringify({attachments:[imageURL]}),headers:{'Idempotency-Key':'key'},signal:abort.signal})).rejects.toThrow();expect(calls).toBe(1);
});
