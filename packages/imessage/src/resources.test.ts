import { test, expect } from 'bun:test';
import { ChertClient, type CreateChatRequest, type CreateChatResult, type Chat, type ChatMessage, type MessageLookup } from './index';

const chat = { id: 'chat-1', display_name: null, handles: [{ service: 'imessage', address: '+15550000002' }], is_group: false, service: 'imessage', health_score: null, created_at: null } satisfies Chat;
const message = { id: 'msg-1', chat_id: 'chat-1', parts: [], status: 'queued', direction: 'outbound', created_at: '2026-10-30T00:00:00Z', service: 'unknown', delivered_at: null, read_at: null } satisfies ChatMessage;
const body: CreateChatRequest = { from: '+15550000001', to: ['person@example.com'], message: { parts: [{ type: 'text', value: 'Hello' }] }, idempotency_key: 'create-123' };
const outbound = { id: 'msg-1', phone: '+15550000002', chat_id: null, lead_id: null, convo_id: null, phone_line_id: null, created_at: message.created_at, status: 'sent', error: null, idempotency_key: 'create-123', external_id: null, request: { message: 'sensitive' }, response: { status: 'retrying' }, service: 'mixed', delivered: false } satisfies MessageLookup;

test('chat creation preserves fresh and evolving replay bodies with a single keyed request', async () => {
  const replies = [
    { chat, message, status: 'queued' },
    { chat: { ...chat, is_group: true }, message: { ...message, status: 'sent', service: 'imessage' } },
    { status: 'queued', message_id: 'msg-1', delivered: false, retryable: false },
    { status: 'retrying', error: 'send_retrying', reason: 'pending', attempt: 1, max_attempts: 3, lead_id: 'lead', convo_id: null, phone_line_id: 'line' },
    { status: 'failed', error: 'send_failed', code: 5004, reason: 'failed', retryable: false, attempts: 3, lead_id: 'lead', convo_id: 'convo', phone_line_id: null },
  ] satisfies CreateChatResult[];
  for (const reply of replies) {
    let calls = 0;
    const client = new ChertClient({ apiKey: 'fixture', fetch: async (url, init) => {
      calls++; expect(String(url)).toBe('https://console.trychert.com/api/v1/chats');
      expect(init?.method).toBe('POST'); expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
      return Response.json(reply, { status: reply.status === 'queued' ? 202 : 200 });
    } });
    expect(await client.createChat(body)).toEqual(reply); expect(calls).toBe(1);
  }
});

test('unsupported send policies, invalid first messages and invented pagination have no effects', async () => {
  let calls = 0;
  const client = new ChertClient({ apiKey: 'fixture', fetch: async () => { calls++; return Response.json({}); } });
  for (const invalid of [
    { ...body, sms_fallback: false }, { ...body, phone_line_id: 'line' }, { ...body, idempotency_key: '' },
    { ...body, message: { ...body.message, idempotency_key: '' } }, { ...body, from: 'sender@example.com' },
    { ...body, message: { parts: [{ type: 'text', value: 'https://example.com' }] } },
    { ...body, message: { parts: [{ type: 'text', value: 'one' }, { type: 'text', value: 'two' }] } },
    { ...body, to: ['+15550000002', '+15550000003'], message: { parts: [{ type: 'rich_link', url: 'https://example.com' }] } },
  ]) await expect(client.createChat(invalid as never)).rejects.toBeInstanceOf(TypeError);
  await expect(client.listChatMessages('chat', { limit: 10 } as never)).rejects.toBeInstanceOf(TypeError);
  const abort = new AbortController(); abort.abort();
  await expect(client.createChat(body, { signal: abort.signal })).rejects.toThrow();
  expect(calls).toBe(0);
});

test('incompatible accepted chat replies are explicitly unconfirmed, never retried', async () => {
  for (const reply of [new Response('not JSON', { status: 202 }), Response.json({ success: false }, { status: 202 }), Response.json({ chat, message: { ...message, service: null } }, { status: 202 })]) {
    let calls = 0;
    const client = new ChertClient({ apiKey: 'fixture', fetch: async () => { calls++; return reply; } });
    await expect(client.createChat(body)).rejects.toMatchObject({ code: 'unconfirmed_chat_outcome' });
    expect(calls).toBe(1);
  }
});

test('history and lookup preserve their distinct schemas and encode opaque IDs', async () => {
  const received = { id: 'legacy', status: 'received', error: null, phone: '+15550000002', chat_id: 'chat', lead_id: 'lead', convo_id: null, phone_line_id: null, direction: 'outbound', text: 'legacy', created_at: message.created_at, message_guid: 'guid' } satisfies MessageLookup;
  const replies = [{ messages: [message], has_more: true }, outbound, received];
  const paths = ['chats/opaque%2Fid%3F/messages', 'messages/opaque%2Fid%3F', 'messages/legacy'];
  const client = new ChertClient({ apiKey: 'fixture', fetch: async (url, init) => {
    expect(String(url)).toBe(`https://console.trychert.com/api/v1/${paths.shift()}`);
    expect(init?.method).toBe('GET'); return Response.json(replies.shift());
  } });
  expect(await client.listChatMessages('opaque/id?')).toEqual({ messages: [message], has_more: true });
  expect(await client.getMessage('opaque/id?')).toEqual(outbound);
  expect(await client.getMessage('legacy')).toEqual(received);
  const malformed = new ChertClient({ apiKey: 'fixture', fetch: async () => Response.json({ ...outbound, service: null }) });
  await expect(malformed.getMessage('msg')).rejects.toMatchObject({ code: 'invalid_response' });
});
