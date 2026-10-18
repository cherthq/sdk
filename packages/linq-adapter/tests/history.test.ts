import { expect, test } from 'bun:test';
import Linq from '../src/index';
import type { Message } from '@linqapp/sdk/resources/messages/messages';
const recorded = { id: 'record-1', chat_id: 'chat-a', created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T01:00:00Z', status: 'received', direction: 'inbound',
  parts: [{ type: 'text', value: 'actual text' }] };
const expected = { id: recorded.id, chat_id: recorded.chat_id, created_at: recorded.created_at,
  updated_at: recorded.updated_at, delivery_status: 'received', is_delivered: false,
  is_read: false, is_from_me: false } satisfies Message;
function fixture(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = new Linq({ apiKey: 'private-provider-key', chert: { baseURL: 'https://chert.test', apiKey: 'chert-key',
    fetch: async (input, init) => { const request = new Request(input, init); requests.push(request); return respond(request); } } });
  return { client, requests };
}
test('official retrieve preserves required recorded metadata and list terminates with a string cursor', async () => {
  const { client, requests } = fixture(request => Response.json(new URL(request.url).pathname.includes('/chats/')
    ? { messages: [recorded], has_more: false, next_cursor: null } : recorded));
  expect(await client.messages.retrieve(recorded.id)).toEqual(expected);
  const page = await client.chats.messages.list('chat-a').withResponse();
  expect(page.data.messages).toEqual([expected]); expect(page.data.next_cursor).toBe(''); expect(page.data.hasNextPage()).toBe(false);
  expect(requests).toHaveLength(2);expect(requests[0]!.url).toBe('https://chert.test/api/v1/messages/record-1');
  expect(requests[1]!.url).toBe('https://chert.test/api/v1/chats/chat-a/messages');
});

test('real SDK async iteration follows opaque cursors with original limit and never contacts the vendor', async () => {
  const { client, requests } = fixture(request => {
    const query = new URL(request.url).searchParams;
    expect(query.get('limit')).toBe('1');
    return Response.json(query.get('cursor') === 'opaque_2'
      ? { messages: [{ ...recorded, id: 'record-2' }], has_more: false, next_cursor: null }
      : { messages: [recorded], has_more: true, next_cursor: 'opaque_2' });
  });
  const rows = [];
  for await (const message of client.chats.messages.list('chat-a', { limit: 1 })) rows.push(message.id);
  expect(rows).toEqual(['record-1', 'record-2']);expect(requests).toHaveLength(2);
  expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe('opaque_2');
  for (const request of requests) {
    expect(request.headers.get('authorization')).toBe('Bearer chert-key');expect(request.headers.has('x-api-key')).toBe(false);
    expect(request.url.startsWith('https://chert.test/api/v1/')).toBe(true);
  }
});

test('deprecated boolean definitions derive only from explicit status and observed direction', async () => {
  for (const status of ['pending', 'queued', 'sent', 'delivered', 'received', 'read', 'failed'] as const) {
    const { client } = fixture(() => Response.json({ ...recorded, status, delivered: true, is_read: true }));
    const message = await client.messages.retrieve(recorded.id);
    expect(message.delivery_status).toBe(status);expect(message.is_delivered).toBe(status === 'delivered' || status === 'read');
    expect(message.is_read).toBe(status === 'read');expect(message.is_from_me).toBe(false);
  }
});

test('retrieve uses explicit lead identity when needed and omits absent parts, sender, service and times', async () => {
  const { chat_id: _chat, parts: _parts, ...without } = recorded;
  const { client } = fixture(() => Response.json({ ...without, lead_id: 'chat-a', text: 'not reconstructed',
    request: { message: { parts: [{ type: 'text', value: 'not reconstructed' }] } }, service: 'unknown', secret: 'private' }));
  const message = await client.messages.retrieve(recorded.id);
  expect(message).toEqual(expected);
  const reactions = fixture(() => Response.json({ ...recorded, parts: [{ type: 'text', value: 'actual text', reactions: null }] }));
  expect(await reactions.client.messages.retrieve(recorded.id)).toEqual({ ...expected, parts: [{ type: 'text', value: 'actual text', reactions: null }] });
  const mixed = fixture(() => Response.json({ ...recorded, parts: [{ type: 'text', value: 'one', reactions: null }, { type: 'text', value: 'two' }] }));
  expect(await mixed.client.messages.retrieve(recorded.id)).toEqual(expected);
  const observed = fixture(() => Response.json({ ...recorded, delivered_at: null, sent_at: '2026-10-17T00:01:00Z', read_at: null }));
  expect(await observed.client.messages.retrieve(recorded.id)).toEqual({ ...expected, delivered_at: null, sent_at: '2026-10-17T00:01:00Z', read_at: null });
});

test('missing required metadata, conflicting identities and rich parts reject the complete response', async () => {
  for (const update of [{ updated_at: undefined }, { updated_at: null }, { created_at: null }, { created_at: '2026-02-30T00:00:00Z' },
    { status: 'unknown' }, { direction: 'unknown' }, { id: 'other-id' }, { id: '../unsafe' }, { chat_id: null }, { lead_id: 'other-chat' },
    { parts: null }, { parts: [{ type: 'media', url: 'private' }] }, { parts: [{ type: 'text', value: 'text', text_decorations: [] }] },
    { parts: [{ type: 'text', value: 'text', reactions: [] }] }, { read_at: 'bad-time' }]) {
    const { client, requests } = fixture(() => Response.json({ ...recorded, ...update }));
    await expect((async () => await client.messages.retrieve(recorded.id))()).rejects.toMatchObject({ status: 502, code: 'incompatible_history' });
    expect(requests).toHaveLength(1);
  }
  for (const messages of [[recorded, { ...recorded, id: 'second', updated_at: null }], [recorded, recorded], [{ ...recorded, chat_id: 'foreign-chat' }]]) {
    const { client } = fixture(() => Response.json({ messages, has_more: false, next_cursor: null }));
    await expect((async () => await client.chats.messages.list('chat-a'))()).rejects.toMatchObject({ status: 502 });
  }
});

test('page shape, termination and cursor progress are checked before upstream iteration can hide errors', async () => {
  for (const body of [{}, { messages: [], has_more: true, next_cursor: 'opaque' }, { messages: [recorded], has_more: false, next_cursor: 'opaque' },
    { messages: [recorded], has_more: true, next_cursor: null }, { messages: [recorded], has_more: true, next_cursor: 'same' },
    { messages: [recorded, { ...recorded, id: 'second' }], has_more: false, next_cursor: null }]) {
    const { client, requests } = fixture(() => Response.json(body));
    await expect((async () => await client.chats.messages.list('chat-a', { limit: 1, cursor: 'same' }))()).rejects.toMatchObject({ status: 502 });
    expect(requests).toHaveLength(1);
  }
  const empty = fixture(() => Response.json({ messages: [], has_more: false, next_cursor: null }));
  expect((await empty.client.chats.messages.list('chat-a')).next_cursor).toBe('');
});

test('unsupported history queries, identifiers and request overrides reject before Chert', async () => {
  const { client, requests } = fixture(() => Response.json(recorded));
  for (const query of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { order: 'asc' }, { cursor: '' }, { cursor: 'bad/' }, { cursor: 'a'.repeat(2049) }])
    await expect((async () => await client.chats.messages.list('chat-a', query as never))()).rejects.toThrow();
  for (const id of ['..', 'bad/id', '%2Fsend', 'bad?id', 'a'.repeat(129)]) {
    await expect((async () => await client.messages.retrieve(id))()).rejects.toThrow();
    await expect((async () => await client.chats.messages.list(id))()).rejects.toThrow();
  }
  for (const options of [{ headers: { custom: 'private' } }, { body: {} }, { idempotencyKey: 'key' }, { stream: true }, { __binaryResponse: true }, { maxRetries: 1 }]) {
    await expect((async () => await client.messages.retrieve(recorded.id, options as never))()).rejects.toThrow();
    await expect((async () => await client.chats.messages.list('chat-a', {}, options as never))()).rejects.toThrow();
  }
  await expect((async () => await client.request({ method: 'get', path: '/v3/chats/chat-a/messages?limit=1&limit=2' }))()).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test('auth, snapshot errors, cancellation and retry overrides retain original SDK behavior', async () => {
  for (const status of [401, 404, 409, 500]) {
    const { client, requests } = fixture(() => Response.json({ error: { code: 'recorded_error', message: 'sanitized' } }, { status }));
    await expect((async () => await client.chats.messages.list('chat-a'))()).rejects.toMatchObject({ status, code: 'recorded_error' });expect(requests).toHaveLength(1);
  }
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = fixture(request => new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    started();
  }));
  const controller = new AbortController();const promise = pending.client.messages.retrieve(recorded.id, { signal: controller.signal });
  const result = (async () => await promise)();
  await ready;controller.abort();await expect(result).rejects.toThrow();expect(pending.requests).toHaveLength(1);
  const before = fixture(() => Response.json(recorded));const stopped = new AbortController();stopped.abort();
  await expect((async () => await before.client.chats.messages.list('chat-a', {}, { signal: stopped.signal }))()).rejects.toThrow();
  expect(() => before.client.request({ method: 'get', path: '/v3/messages/record-1' }, 1)).toThrow('retry attempts');expect(before.requests).toHaveLength(0);
});

test('official recorded media retrieve exposes the actual frozen single attachment',async()=>{
 const attachment_id='a'.repeat(48),expires=Math.floor(Date.now()/1000)+3600;
 const download_url=`https://chert.test/api/v1/attachments/${attachment_id}/download?tenant=11000000-0000-4000-8000-000000000001&expires=${expires}&signature=${'b'.repeat(64)}`;
 const attachment={attachment_id,filename:'actual.png',content_type:'image/png',size_bytes:4,download_url,download_url_expires_at:new Date(expires*1000).toISOString()};
 const row={...recorded,status:'read',direction:'outbound',parts:undefined,request:{message:{parts:[{type:'media',attachment_id}]}},response:{attachments:[attachment]}};
 const {client}=fixture(()=>Response.json(row));const result=await client.messages.retrieve(recorded.id);
 expect(result.parts).toEqual([{type:'media',id:attachment_id,filename:'actual.png',mime_type:'image/png',size_bytes:4,url:download_url,reactions:null}]);expect(result.sent_at).toBeUndefined();expect(result.service).toBeUndefined();
});

test('recorded media rejects expired, foreign, missing and incompatible metadata without extra requests',async()=>{
 const id='a'.repeat(48),expires=Math.floor(Date.now()/1000)+3600;
 const url=new URL(`https://chert.test/api/v1/attachments/${id}/download?tenant=11000000-0000-4000-8000-000000000001&expires=${expires}&signature=${'b'.repeat(64)}`);
 const attachment={attachment_id:id,filename:'actual.png',content_type:'image/png',size_bytes:4,download_url:url.href,download_url_expires_at:new Date(expires*1000).toISOString()};
 const row={...recorded,status:'queued',direction:'outbound',parts:undefined,request:{message:{parts:[{type:'media',attachment_id:id}]}},response:{attachments:[attachment]}};
 const expired=new URL(url);expired.searchParams.set('expires',String(Math.floor(Date.now()/1000)-1));
 const duplicate=new URL(url);duplicate.searchParams.append('signature','b'.repeat(64));
 for(const variant of [
  {...row,response:{}}, {...row,response:{attachments:[]}}, {...row,response:{attachments:[attachment,attachment]}},
  {...row,direction:'inbound'}, {...row,parts:[{type:'text',value:'conflict'}]},
  {...row,request:{message:{parts:[{type:'media',attachment_id:id},{type:'text',value:'caption'}]}}},
  ...[{attachment_id:'c'.repeat(48)},{filename:null},{size_bytes:0},{download_url:url.href.replace('chert.test','foreign.invalid')},{download_url:duplicate.href},{download_url:expired.href,download_url_expires_at:new Date(Number(expired.searchParams.get('expires'))*1000).toISOString()},{download_url_expires_at:'2026-02-30T00:00:00Z'}].map(patch=>({...row,response:{attachments:[{...attachment,...patch}]}})),
 ]) {
  const {client,requests}=fixture(()=>Response.json(variant));await expect((async()=>client.messages.retrieve(recorded.id))()).rejects.toMatchObject({status:502});expect(requests).toHaveLength(1);
 }
});
