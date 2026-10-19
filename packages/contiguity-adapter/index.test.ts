import {expect, test} from 'bun:test';
import {createContiguityFetch, CONTIGUITY_CONTRACT} from './index';
import contract from './fixtures/contract.json';

const send = 'https://api.contiguity.com/send/imessage';
const typing = 'https://api.contiguity.com/send/imessage/typing';
function fixture(result: unknown, status = 202) {
  const calls: Request[] = [];
  const transport = createContiguityFetch({chert: {baseURL: 'https://chert.test', apiKey: 'owned-key',
    fetch: async (input, init) => { calls.push(new Request(input, init)); return Response.json(result, {status}); }}});
  return {calls, transport};
}
const post = (transport: ReturnType<typeof createContiguityFetch>, url: string, body: unknown, headers: Record<string, string> = {}) =>
  transport(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Token not-forwarded', ...headers}, body: JSON.stringify(body)});
type Envelope = {id: string; timestamp: number; api_version: string; object: string; data: Record<string, unknown>};
function expectEnvelope(json: Envelope, object: 'response' | 'error') {
  expect(Object.keys(json).sort()).toEqual(['api_version', 'data', 'id', 'object', 'timestamp']);
  expect(json.id).toMatch(object === 'error' ? /^err_[a-f0-9]{16}$/ : /^req_[a-f0-9]{16}$/);
  expect(Number.isSafeInteger(json.timestamp)).toBe(true);
  expect(json.api_version).toBe(contract.apiVersion);
  expect(json.object).toBe(object);
}

test('contract pin matches fixture', () => {
  expect(CONTIGUITY_CONTRACT.apiVersion as string).toBe(contract.apiVersion);
  expect(CONTIGUITY_CONTRACT.baseURL as string).toBe(contract.baseURL);
});

test('explicit from maps to Chert explicit-sender chat send', async () => {
  const {calls, transport} = fixture(contract.send.chertChatQueued);
  const response = await post(transport, send, contract.send.explicit);
  expect(response.status).toBe(200);
  const json = await response.json() as Envelope;
  expectEnvelope(json, 'response');
  expect(json.data).toEqual(contract.send.responseData);
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe('https://chert.test/api/v1/chats');
  expect(await calls[0]!.json()).toEqual({from: '+14155559876', to: ['+14155551234'], message: {parts: [{type: 'text', value: 'Hello, world!'}]}});
  expect(calls[0]!.headers.get('authorization')).toBe('Bearer owned-key');
});

test('omitted or null from uses Chert line policy through strict text', async () => {
  for (const body of [contract.send.implicit, {...contract.send.implicit, from: null}]) {
    const {calls, transport} = fixture(contract.send.chertTextQueued);
    const response = await post(transport, send, body);
    expect(response.status).toBe(200);
    expect((await response.json() as Envelope).data).toEqual(contract.send.responseData);
    expect(calls[0]!.url).toBe('https://chert.test/api/v1/text-operations/v1');
    expect(await calls[0]!.json()).toEqual({phone: '+14155551234', body: 'Hello, world!'});
  }
});

test('fallback, attachments, effects, fast track, email recipients and formatting markup reject before any request', async () => {
  const base = contract.send.explicit;
  for (const body of [{...base, fallback: {when: ['imessage_unsupported']}}, {...base, fallback: null}, {...base, attachments: ['https://example.com/a.png']},
    {...base, effect: 'confetti'}, {...base, fast_track: true}, {...base, message: '**bold**'}, {...base, message: 'say __this__'},
    {...base, message: '~~gone~~'}, {...base, message: 'an *italic* word'}, {...base, message: 'an _italic_ word'}]) {
    const {calls, transport} = fixture(contract.send.chertChatQueued);
    const response = await post(transport, send, body);
    expect(response.status).toBe(501);
    expectEnvelope(await response.json() as Envelope, 'error');
    expect(calls.length).toBe(0);
  }
  for (const body of [{...base, to: 'name@icloud.com'}, {...base, from: 'x'}, {...base, from: base.to}, {...base, message: ''}, {to: base.to}, {...base, message: '\ud800'}]) {
    const {calls, transport} = fixture(contract.send.chertChatQueued);
    const response = await post(transport, send, body);
    expect(response.status).toBe(400);
    const json = await response.json() as Envelope;
    expectEnvelope(json, 'error');
    expect(json.data.status).toBe(400);
    expect(calls.length).toBe(0);
  }
});

test('plain punctuation that is not documented markup is sent losslessly', async () => {
  const message = 'Price is 5 * 3 = 15 and file_name.txt';
  const queued = structuredClone(contract.send.chertChatQueued);
  queued.message.parts[0]!.value = message;
  const {calls, transport} = fixture(queued);
  expect((await post(transport, send, {...contract.send.explicit, message})).status).toBe(200);
  expect(((await calls[0]!.json()) as {message: {parts: {value: string}[]}}).message.parts[0]!.value).toBe(message);
});

test('reactions, read receipts, history, other origins and extra headers are unsupported', async () => {
  for (const url of ['https://api.contiguity.com/send/imessage/reactions', 'https://api.contiguity.com/send/imessage/read',
    'https://api.contiguity.com/send/text', 'https://api.contiguity.com/send/imessage?x=1', 'https://example.com/send/imessage']) {
    const {calls, transport} = fixture({});
    expect((await post(transport, url, contract.send.explicit)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture({});
  expect((await post(transport, send, contract.send.explicit, {'idempotency-key': 'k'})).status).toBe(501);
  expect((await transport(send)).status).toBe(501);
  expect(calls.length).toBe(0);
});

test('malformed Chert receipts are unconfirmed, never accepted', async () => {
  const chat = contract.send.chertChatQueued, text = contract.send.chertTextQueued;
  for (const [body, req, status] of [
    [{...chat, message: {...chat.message, status: 'sent'}}, contract.send.explicit, 202],
    [{...chat, message: {...chat.message, service: 'imessage'}}, contract.send.explicit, 202],
    [{...chat, chat: {...chat.chat, handles: [{address: '+19999999999'}]}}, contract.send.explicit, 202],
    [chat, contract.send.explicit, 200],
    [{...text, status: 'sent'}, contract.send.implicit, 202], [{...text, extra: 1}, contract.send.implicit, 202], [text, contract.send.implicit, 200],
  ] as const) {
    const {calls, transport} = fixture(body, status);
    const response = await post(transport, send, req);
    expect(response.status).toBe(502);
    expectEnvelope(await response.json() as Envelope, 'error');
    expect(calls.length).toBe(1);
  }
});

test('Chert errors are sanitized; 4103 keeps validated reconciliation headers', async () => {
  for (const [status, expected] of [[400, 400], [401, 401], [403, 403], [404, 403], [429, 429], [500, 502]] as const) {
    const {transport} = fixture({error: {code: 'x', message: 'private detail'}}, status);
    const response = await post(transport, send, contract.send.implicit);
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain('private');
  }
  const {calls, transport} = fixture({error: {code: 4103, retryable: false}, message_id: 'f'.repeat(32), chat_id: 'chat-a'}, 502);
  const response = await post(transport, send, contract.send.implicit);
  expect(response.status).toBe(502);
  expect(response.headers.get('x-chert-message-id')).toBe('f'.repeat(32));
  expect(response.headers.get('x-chert-chat-id')).toBe('chat-a');
  expect(calls.length).toBe(1);
});

test('typing start/stop with explicit from maps to Chert typing', async () => {
  for (const action of ['start', 'stop'] as const) {
    const state = action === 'start' ? 'typing' : 'stopped';
    const {calls, transport} = fixture({...contract.typing.chertApplied, state}, 200);
    const response = await post(transport, typing, {...contract.typing.request, action});
    expect(response.status).toBe(200);
    const json = await response.json() as Envelope;
    expectEnvelope(json, 'response');
    expect(json.data).toEqual({status: action === 'start' ? 'started' : 'stopped'});
    expect(calls[0]!.url).toBe('https://chert.test/api/v1/typing');
    expect(await calls[0]!.json()).toEqual({from: '+14155559876', to: '+14155551234', state});
  }
});

test('typing without explicit from or with unconfirmed application never claims success', async () => {
  for (const body of [{to: '+14155551234', action: 'start'}, {...contract.typing.request, from: null}, {...contract.typing.request, action: 'pause'}]) {
    const {calls, transport} = fixture(contract.typing.chertApplied, 200);
    expect((await post(transport, typing, body)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  for (const patch of [{applied: false}, {state: 'stopped'}, {to: '+19999999999'}, {chat_id: ''}, {error: 'x'}]) {
    const {calls, transport} = fixture({...contract.typing.chertApplied, ...patch}, 200);
    expect((await post(transport, typing, contract.typing.request)).status).toBe(502);
    expect(calls.length).toBe(1);
  }
});

test('cancellation propagates and is never retried', async () => {
  const aborted = new AbortController(); aborted.abort();
  const {calls, transport} = fixture(contract.send.chertTextQueued);
  await expect(transport(send, {method: 'POST', body: JSON.stringify(contract.send.implicit), signal: aborted.signal})).rejects.toThrow();
  expect(calls.length).toBe(0);
  const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(r => { started = r; }); let attempts = 0;
  const hanging = createContiguityFetch({chert: {baseURL: 'https://chert.test', apiKey: 'k', fetch: async (input, init) => {
    attempts++; const r = new Request(input, init); started();
    return new Promise<Response>((_, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), {once: true}));
  }}});
  const pending = hanging(send, {method: 'POST', body: JSON.stringify(contract.send.implicit), signal: abort.signal});
  await ready; abort.abort();
  await expect(pending).rejects.toThrow();
  expect(attempts).toBe(1);
});
