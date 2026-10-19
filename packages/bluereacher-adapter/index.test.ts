import {expect, test} from 'bun:test';
import {createBlueReacherFetch, BLUEREACHER_CONTRACT} from './index';
import contract from './fixtures/contract.json';

const endpoint = 'https://api.bluereacher.com/v1/messages';
const valid = contract.send.request;
function fixture(send: unknown = contract.send.chertQueued, sendStatus = 202, inventory: unknown = contract.inventory, inventoryStatus = 200) {
  const calls: Request[] = [];
  const transport = createBlueReacherFetch({chert: {baseURL: 'https://chert.test', apiKey: 'owned-key', fetch: async (input, init) => {
    const request = new Request(input, init); calls.push(request);
    return request.method === 'GET' ? Response.json(inventory, {status: inventoryStatus}) : Response.json(send, {status: sendStatus});
  }}});
  return {calls, transport, posts: () => calls.filter(c => c.method === 'POST').length};
}
const post = (transport: ReturnType<typeof createBlueReacherFetch>, body: unknown, headers: Record<string, string> = {}) =>
  transport(endpoint, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer brk_live_not_forwarded', ...headers}, body: JSON.stringify(body)});

test('contract pin matches fixture', () => { expect(BLUEREACHER_CONTRACT.baseURL as string).toBe(contract.baseURL); });

test('instant send resolves device_id through owned inventory then sends with explicit from', async () => {
  const {calls, transport} = fixture();
  const response = await post(transport, {...valid, device_id: valid.device_id.toUpperCase()});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(contract.send.response);
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual(['GET https://chert.test/api/v1/phone-numbers', 'POST https://chert.test/api/v1/chats']);
  expect(await calls[1]!.json()).toEqual({from: '+14155559876', to: [valid.to], message: {parts: [{type: 'text', value: valid.message}]}});
  for (const call of calls) expect(call.headers.get('authorization')).toBe('Bearer owned-key');
});

test('drip, auto lines, groups, media, effects and options reject before any request', async () => {
  const {to, message} = valid;
  for (const body of [{to, message}, {...valid, send_mode: 'drip'}, {to, message, send_mode: 'instant'}, {...valid, device_id: 'auto_load_balanced'},
    {...valid, media_urls: ['https://example.com/a.png']}, {...valid, message_effect: 'confetti'}, {...valid, lock: false}, {...valid, metadata: {}},
    {message, send_mode: 'instant', device_id: valid.device_id, group_chat_id: 'g1'}, {message, send_mode: 'instant', device_id: valid.device_id, create_group_phones: ['+14155550001', '+14155550002']}]) {
    const {calls, transport} = fixture();
    const response = await post(transport, body);
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({success: false, error: 'unsupported_feature', message: expect.any(String)});
    expect(calls.length).toBe(0);
  }
  for (const [url, init] of [['https://api.bluereacher.com/v1/status/m_1', {}], ['https://api.bluereacher.com/v1/typing', {method: 'POST', body: '{}'}],
    ['https://api.bluereacher.com/v1/reactions', {method: 'POST', body: '{}'}], ['https://api.bluereacher.com/v1/read', {method: 'POST', body: '{}'}],
    ['https://api.bluereacher.com/v1/voice-memos', {method: 'POST', body: '{}'}], [endpoint + '?x=1', {method: 'POST', body: '{}'}]] as const) {
    const {calls, transport} = fixture();
    expect((await transport(url, init)).status).toBe(501);
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture();
  expect((await post(transport, valid, {'idempotency-key': 'seq-1'})).status).toBe(501);
  expect(calls.length).toBe(0);
});

test('documented validation codes apply before any request', async () => {
  for (const [body, code] of [[{...valid, to: '6465550119'}, 'invalid_phone'], [{...valid, message: ' '}, 'message_required'], [{...valid, message: 'a\0b'}, 'message_required']] as const) {
    const {calls, transport} = fixture();
    const response = await post(transport, body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as {error: string}).error).toBe(code);
    expect(calls.length).toBe(0);
  }
  const {calls, transport} = fixture();
  expect((await transport(endpoint, {method: 'POST', body: '[]'})).status).toBe(400);
  expect(calls.length).toBe(0);
});

test('unknown, inactive, non-send or ambiguous lines never send', async () => {
  const row = contract.inventory.phone_numbers[0]!;
  for (const [inventory, status, code] of [
    [{phone_numbers: []}, 403, 'device_not_owned'],
    [{phone_numbers: [{...row, is_active: false}]}, 409, 'no_online_device'],
    [{phone_numbers: [{...row, capabilities: ['imessage']}]}, 409, 'no_online_device'],
    [{phone_numbers: [row, row]}, 502, 'incompatible_response'],
    [{phone_numbers: [{...row, service: 'sms'}]}, 502, 'incompatible_response'],
    [{}, 502, 'incompatible_response'],
  ] as const) {
    const {transport, posts} = fixture(contract.send.chertQueued, 202, inventory);
    const response = await post(transport, valid);
    expect(response.status).toBe(status);
    expect(((await response.json()) as {error: string}).error).toBe(code);
    expect(posts()).toBe(0);
  }
  const {transport, posts} = fixture();
  expect((await post(transport, {...valid, to: row.phone_number})).status).toBe(400);
  expect(posts()).toBe(0);
});

test('malformed queue receipts are unconfirmed and never retried', async () => {
  const base = contract.send.chertQueued;
  for (const [body, status] of [[{...base, message: {...base.message, status: 'sent'}}, 202], [{...base, message: {...base.message, service: 'imessage'}}, 202],
    [{...base, chat: {...base.chat, is_group: true}}, 202], [base, 200], [{}, 202]] as const) {
    const {transport, posts} = fixture(body, status);
    const response = await post(transport, valid);
    expect(response.status).toBe(502);
    expect(((await response.json()) as {error: string}).error).toBe('outcome_unknown');
    expect(posts()).toBe(1);
  }
});

test('Chert errors are sanitized and 4103 keeps validated reconciliation headers', async () => {
  for (const [status, code] of [[400, 'invalid_request'], [401, 'invalid_api_key'], [404, 'device_not_owned'], [429, 'rate_limited'], [500, 'outcome_unknown']] as const) {
    const {transport} = fixture({error: {code: 'x', message: 'private detail'}}, status);
    const response = await post(transport, valid);
    const text = await response.text();
    expect(JSON.parse(text).error).toBe(code);
    expect(text).not.toContain('private');
  }
  const ids = {message_id: 'f'.repeat(32), chat_id: contract.send.chertQueued.chat.id};
  const {transport, posts} = fixture({error: {code: 4103, retryable: false}, ...ids}, 502);
  const response = await post(transport, valid);
  expect(response.status).toBe(502);
  expect(response.headers.get('x-chert-message-id')).toBe(ids.message_id);
  expect(response.headers.get('x-chert-chat-id')).toBe(ids.chat_id);
  expect(posts()).toBe(1);
});

test('cancellation propagates before and during dispatch', async () => {
  const aborted = new AbortController(); aborted.abort();
  const {calls, transport} = fixture();
  await expect(transport(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: aborted.signal})).rejects.toThrow();
  expect(calls.length).toBe(0);
  const abort = new AbortController(); let started!: () => void; const ready = new Promise<void>(r => { started = r; }); let posts = 0;
  const hanging = createBlueReacherFetch({chert: {baseURL: 'https://chert.test', apiKey: 'k', fetch: async (input, init) => {
    const r = new Request(input, init);
    if (r.method === 'GET') return Response.json(contract.inventory);
    posts++; started();
    return new Promise<Response>((_, reject) => r.signal.addEventListener('abort', () => reject(r.signal.reason), {once: true}));
  }}});
  const pending = hanging(endpoint, {method: 'POST', body: JSON.stringify(valid), signal: abort.signal});
  await ready; abort.abort();
  await expect(pending).rejects.toThrow();
  expect(posts).toBe(1);
});
