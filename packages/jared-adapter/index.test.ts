import {expect, test} from 'bun:test';
import {createJaredFetch, JARED_CONTRACT} from './index';
import contract from './fixtures/contract.json';

const origin = 'http://localhost:3005', endpoint = origin + '/message';
const valid = contract.send.request;
function fixture(result: unknown = contract.send.chertQueued, status = 202) {
  const calls: Request[] = [];
  const transport = createJaredFetch({origin, chert: {baseURL: 'https://chert.test', apiKey: 'owned-key',
    fetch: async (input, init) => { calls.push(new Request(input, init)); return Response.json(result, {status}); }}});
  return {calls, transport};
}
const post = (transport: ReturnType<typeof createJaredFetch>, body: unknown, headers: Record<string, string> = {}, url = endpoint) =>
  transport(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});

test('contract pin names the reviewed commit', () => { expect(JARED_CONTRACT.commit as string).toBe(contract.commit); });

test('origin must be explicit loopback http with a port', () => {
  const chert = {baseURL: 'https://chert.test', apiKey: 'k'};
  for (const bad of ['https://localhost:3005', 'http://example.com:3005', 'http://localhost', 'http://localhost:3005/api', 'http://u:p@localhost:3005'])
    expect(() => createJaredFetch({chert, origin: bad})).toThrow(TypeError);
  for (const good of ['http://127.0.0.1:3000', 'http://[::1]:3005/']) expect(() => createJaredFetch({chert, origin: good})).not.toThrow();
});

test('documented POST /message maps to strict Chert text and returns the empty 200', async () => {
  const {calls, transport} = fixture();
  const response = await post(transport, valid);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect(calls.length).toBe(1);
  expect(calls[0]!.url).toBe('https://chert.test/api/v1/send');
  expect(await calls[0]!.json()).toEqual({phone: '+14155551234', body: 'Jared is an amazing app'});
  expect(calls[0]!.headers.get('authorization')).toBe('Bearer owned-key');
});

test('email, group GUID, attachments and extra fields reject before any request', async () => {
  for (const body of [{...valid, recipient: {handle: 'handle@email.com'}}, {...valid, recipient: {handle: 'iMessage;+;chat100000000000'}},
    {...valid, attachments: [{filePath: '~/Pictures/x.jpeg'}]}, {recipient: valid.recipient, attachments: [{filePath: '/x'}]},
    {...valid, recipient: {handle: valid.recipient.handle, givenName: 'A'}}, {...valid, body: {message: 'x', extra: true}}, {body: valid.body}]) {
    const {calls, transport} = fixture();
    expect((await post(transport, body)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  for (const [url, init] of [[origin + '/message?x=1', {method: 'POST', body: '{}'}], [origin + '/webhook', {method: 'POST', body: '{}'}],
    ['http://localhost:3000/message', {method: 'POST', body: JSON.stringify(valid)}], [endpoint, {}]] as const) {
    const {calls, transport} = fixture();
    expect((await transport(url, init)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture();
  expect((await post(transport, valid, {authorization: 'x'})).status).toBe(501);
  expect(calls.length).toBe(0);
});

test('invalid text is a plain-text 400 like upstream, with zero requests', async () => {
  for (const message of ['', '  ', 'a\0b', '\ud800']) {
    const {calls, transport} = fixture();
    const response = await post(transport, {...valid, body: {message}});
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture();
  expect((await transport(endpoint, {method: 'POST', body: '{'})).status).toBe(400);
  expect(calls.length).toBe(0);
});

test('malformed receipts and errors are unconfirmed; 4103 keeps validated headers', async () => {
  for (const [body, status] of [[{...contract.send.chertQueued, status: 'sent'}, 202], [contract.send.chertQueued, 200], [{error: 'private'}, 500]] as const) {
    const {calls, transport} = fixture(body, status);
    const response = await post(transport, valid);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private');
    expect(calls.length).toBe(1);
  }
  const {transport} = fixture({error: {code: 4103, retryable: false}, message_id: 'f'.repeat(32), chat_id: 'chat-a'}, 502);
  const response = await post(transport, valid);
  expect(response.headers.get('x-chert-message-id')).toBe('f'.repeat(32));
  expect(response.headers.get('x-chert-chat-id')).toBe('chat-a');
});

test('cancellation propagates without retry', async () => {
  const aborted = new AbortController(); aborted.abort();
  const {calls, transport} = fixture();
  await expect(transport(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: aborted.signal})).rejects.toThrow();
  expect(calls.length).toBe(0);
  const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(r => { started = r; }); let attempts = 0;
  const hanging = createJaredFetch({origin, chert: {baseURL: 'https://chert.test', apiKey: 'k', fetch: async (input, init) => {
    attempts++; const r = new Request(input, init); started();
    return new Promise<Response>((_, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), {once: true}));
  }}});
  const pending = hanging(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: abort.signal});
  await ready; abort.abort();
  await expect(pending).rejects.toThrow();
  expect(attempts).toBe(1);
});
