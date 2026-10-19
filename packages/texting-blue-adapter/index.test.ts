import {expect, test} from 'bun:test';
import {createTextingBlueFetch, TEXTING_BLUE_CONTRACT} from './index';
import contract from './fixtures/contract.json';

const endpoint = 'https://api.texting.blue/v1/messages/send';
const valid = contract.send.request;
function fixture(result: unknown = contract.send.chertQueued, status = 202) {
  const calls: Request[] = [];
  const transport = createTextingBlueFetch({chert: {baseURL: 'https://chert.test', apiKey: 'owned-key', tenant: 'owned-tenant',
    fetch: async (input, init) => { calls.push(new Request(input, init)); return Response.json(result, {status}); }}});
  return {calls, transport};
}
const post = (transport: ReturnType<typeof createTextingBlueFetch>, body: unknown, headers: Record<string, string> = {}) =>
  transport(endpoint, {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': 'tb_live_not_forwarded', ...headers}, body: JSON.stringify(body)});

test('contract pin names the documented base URL', () => {
  expect(TEXTING_BLUE_CONTRACT.baseURL as string).toBe(contract.baseURL);
});

test('documented send maps to explicit-sender Chert chat and returns the 202 queued shape', async () => {
  const {calls, transport} = fixture();
  const response = await post(transport, valid);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(contract.send.response);
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe('https://chert.test/api/v1/chats');
  expect(calls[0]!.method).toBe('POST');
  expect(await calls[0]!.json()).toEqual({from: valid.from, to: [valid.to], message: {parts: [{type: 'text', value: valid.content}]}});
  expect(calls[0]!.headers.get('authorization')).toBe('Bearer owned-key');
  expect(calls[0]!.headers.get('x-chert-tenant')).toBe('owned-tenant');
  expect(calls[0]!.headers.get('x-api-key')).toBeNull();
});

test('unsupported fields, media, routes and headers reject before any Chert request', async () => {
  for (const body of [{...valid, media_url: 'https://example.com/a.png'}, {...valid, media_url: null}, {to: valid.to, content: 'x'}, {...valid, service: 'sms'}]) {
    const {calls, transport} = fixture();
    expect((await post(transport, body)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  for (const headers of [{'idempotency-key': 'k'}, {'x-provider-route': 'other'}] as Record<string, string>[]) {
    const {calls, transport} = fixture();
    expect((await post(transport, valid, headers)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  for (const [url, init] of [
    ['https://api.texting.blue/v1/messages', {}], ['https://api.texting.blue/v1/numbers', {}],
    ['https://api.texting.blue/v1/webhooks', {method: 'POST', body: '{}'}], [endpoint + '?x=1', {method: 'POST', body: '{}'}],
    ['https://api.texting.blue/v1/messages/msg_x', {}], ['https://evil.example/v1/messages/send', {method: 'POST', body: '{}'}],
  ] as const) {
    const {calls, transport} = fixture();
    const response = await transport(url, init);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({error: {code: 'unsupported_feature', message: expect.any(String)}});
    expect(calls.length).toBe(0);
  }
});

test('invalid phones and content are documented invalid_request errors with zero effects', async () => {
  for (const body of [{...valid, to: '4155551234'}, {...valid, from: 'me'}, {...valid, from: valid.to}, {...valid, content: ' '},
    {...valid, content: 'x'.repeat(5001)}, {...valid, content: '\ud800'}, {...valid, content: 'a\0b'}]) {
    const {calls, transport} = fixture();
    const response = await post(transport, body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as {error: {code: string}}).error.code).toBe('invalid_request');
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture();
  expect((await transport(endpoint, {method: 'POST', body: '{'})).status).toBe(400);
  expect(calls.length).toBe(0);
});

test('documented 5,000-character boundary is accepted without truncation', async () => {
  const text = 'x'.repeat(5000);
  const queuedBody = structuredClone(contract.send.chertQueued);
  queuedBody.message.parts[0]!.value = text;
  const {calls, transport} = fixture(queuedBody);
  const response = await post(transport, {...valid, content: text});
  expect(response.status).toBe(202);
  expect(((await response.json()) as {content: string}).content).toBe(text);
  expect(calls.length).toBe(1);
});

test('incompatible Chert acknowledgements never become queued receipts', async () => {
  const base = contract.send.chertQueued;
  for (const [body, status] of [
    [{...base, message: {...base.message, status: 'sent'}}, 202],
    [{...base, message: {...base.message, service: 'imessage'}}, 202],
    [{...base, message: {...base.message, parts: [{type: 'text', value: 'other'}]}}, 202],
    [{...base, chat: {...base.chat, handles: [{address: '+19999999999'}]}}, 202],
    [{...base, chat: {...base.chat, is_group: true}}, 202],
    [base, 200], [{}, 202],
  ] as const) {
    const {calls, transport} = fixture(body, status);
    const response = await post(transport, valid);
    expect(response.status).toBe(502);
    expect(((await response.json()) as {error: {code: string}}).error.code).toBe('outcome_unknown');
    expect(calls.length).toBe(1);
  }
});

test('Chert errors map to documented codes; uncertainty keeps only validated reconciliation IDs', async () => {
  for (const [status, code] of [[400, 'invalid_request'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [500, 'outcome_unknown']] as const) {
    const {calls, transport} = fixture({error: {code: 'x', message: 'private detail'}}, status);
    const response = await post(transport, valid);
    const json = (await response.json()) as {error: {code: string; message: string}};
    expect(json.error.code).toBe(code);
    expect(json.error.message).not.toContain('private');
    expect(calls.length).toBe(1);
  }
  const ids = {message_id: 'f'.repeat(32), chat_id: contract.send.chertQueued.chat.id};
  for (const good of [true, false]) {
    const {calls, transport} = fixture({error: {code: 4103, retryable: false}, ...ids, ...(good ? {} : {message_id: 'native'})}, 502);
    const response = await post(transport, valid);
    expect(response.status).toBe(502);
    expect(response.headers.get('x-chert-message-id')).toBe(good ? ids.message_id : null);
    expect(response.headers.get('x-chert-chat-id')).toBe(good ? ids.chat_id : null);
    expect(calls.length).toBe(1);
  }
});

test('network failure is sanitized once; cancellation propagates without retry', async () => {
  let attempts = 0;
  const failing = createTextingBlueFetch({chert: {baseURL: 'https://chert.test', apiKey: 'k', fetch: async () => { attempts++; throw new Error('private-url'); }}});
  const response = await post(failing, valid);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private');
  expect(attempts).toBe(1);
  const aborted = new AbortController(); aborted.abort();
  const {calls, transport} = fixture();
  await expect(transport(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: aborted.signal})).rejects.toThrow();
  expect(calls.length).toBe(0);
  const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(r => { started = r; });
  const hanging = createTextingBlueFetch({chert: {baseURL: 'https://chert.test', apiKey: 'k', fetch: async (input, init) => {
    const r = new Request(input, init); started();
    return new Promise<Response>((_, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), {once: true}));
  }}});
  const pending = hanging(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: abort.signal});
  await ready; abort.abort();
  await expect(pending).rejects.toThrow();
});
