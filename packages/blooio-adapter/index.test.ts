import { describe, expect, test } from 'bun:test';
import OfficialBlooio, { APIError } from '@blooio/sdk';
import Blooio from './index';

const receipt = { status:'queued',message_id:'550e8400-e29b-41d4-a716-446655440000',chat_id:'a1b2c3d4-e5f6-4789-8abc-def012345678',lead_id:'a1b2c3d4-e5f6-4789-8abc-def012345678',lead_created:false,convo_id:'convo-1',phone_line_id:'line-1' };
function fixture(response: unknown = receipt, status = 202) {
  const requests: Request[] = [];
  const client = new Blooio({
    apiKey: 'vendor-secret-must-not-leak',
    baseURL: 'https://vendor-must-not-be-contacted.invalid',
    defaultHeaders: { 'X-Vendor-Secret': 'vendor-secret-must-not-leak' },
    fetch: async () => { throw new Error('Vendor fetch must not run'); },
    chert: {
      baseURL: 'https://chert.example.test', apiKey: 'chert-key',
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(response, { status });
      },
    },
  });
  return { client, requests };
}

describe('official Blooio 0.0.2 compatibility', () => {
  test('subclasses the actual SDK and translates its send/header contract', async () => {
    const { client, requests } = fixture();
    expect(client).toBeInstanceOf(OfficialBlooio);
    expect(client.maxRetries).toBe(0);
    const response = await client.messages.send({ to: '+15551234567', text: 'hello', 'Idempotency-Key': 'logical-send-42' });
    expect(response).toEqual({ message_id: receipt.message_id, status: 'queued' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/send');
    expect(await requests[0]!.json()).toEqual({ phone: '+15551234567', body: 'hello', idempotency_key: 'logical-send-42' });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer chert-key');
    expect([...requests[0]!.headers.values()].join(' ')).not.toContain('vendor-secret');
  });

  test('requires explicit Chert connection and forbids automatic retries', async () => {
    expect(() => new Blooio({} as never)).toThrow('Explicit chert');
    expect(() => new Blooio({ maxRetries: 1, chert: { baseURL: 'https://chert.test', apiKey: 'key' } })).toThrow('maxRetries: 0');
    const { client, requests } = fixture();
    await expect((async () => await client.messages.send({ to: '+15551234567', text: 'hello' }, { maxRetries: 1 }))()).rejects.toMatchObject({ status: 501 });
    expect(requests).toHaveLength(0);
  });

  test('rejects unsupported resources and unknown send fields before Chert fetch', async () => {
    const { client, requests } = fixture();
    const operations = [
      () => client.messages.cancel('id'),
      () => client.messages.send({ to: '+15551234567', text: 'hello', attachments: [] }),
      () => client.messages.send({ to: '+15551234567', text: 'hello', metadata: null }),
      () => client.messages.send({ to: '+15551234567', text: 'hello', surprise: true } as never),
    ];
    for (const operation of operations) await expect((async () => await operation())()).rejects.toMatchObject({ status: 501 });
    expect(requests).toHaveLength(0);
  });

  test('rejects malformed text sends without contacting Chert', async () => {
    const { client, requests } = fixture();
    await expect((async () => await client.messages.send({ to: '+15551234567' }))()).rejects.toMatchObject({ status: 400 });
    await expect((async () => await client.messages.send({ to: '+15551234567', text: '   ' }))()).rejects.toMatchObject({ status: 400 });
    expect(requests).toHaveLength(0);
  });

  test('strict sends reject incomplete, contradictory or non-202 receipts after exactly one attempt', async () => {
    const good=receipt;
    for(const [body,status] of [[{},202],[{message_id:null,status:null},202],[{...good,status:'sent'},202],[{...good,message_id:'bad id'},202],[{...good,chat_id:'bad/chat'},202],[good,200],[good,201],[{...good,status:'failed'},200]] as const){
      const {client,requests}=fixture(body,status);await expect((async()=>await client.messages.send({to:'+15551234567',text:'hello'}))()).rejects.toMatchObject({status:502});expect(requests).toHaveLength(1);
    }
  });

  test('preserves the original SDK error family and sends once on server failure', async () => {
    const { client, requests } = fixture({ error: 'unavailable' }, 503);
    try {
      await client.messages.send({ to: '+15551234567', text: 'hello' });
      throw new Error('Expected send failure');
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect(error).toMatchObject({ status: 503 });
    }
    expect(requests).toHaveLength(1);
  });

  test('withOptions retains explicit Chert routing and cannot turn retries on', async () => {
    const { client, requests } = fixture();
    const copied = client.withOptions({ apiKey: 'another-vendor-secret', baseURL: 'https://elsewhere.invalid' });
    await copied.messages.send({ to: '+15551234567', text: 'hello' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/send');
    expect(() => client.withOptions({ maxRetries: 1 })).toThrow('maxRetries: 0');
  });
});

test('low-level request rejects explicit retries before any Chert send', async () => {
  const { client, requests } = fixture({ error: { code: 'temporary' } }, 500);
  const options = { method: 'post' as const, path: '/v1/api/messages', body: { to: '+15551234567', text: 'hello' } };
  expect(() => client.request(options, 1)).toThrow('retry attempts');
  expect(requests).toHaveLength(0);
  await expect((async () => await client.request(options, 0))()).rejects.toMatchObject({ status: 500 });
  expect(requests).toHaveLength(1);
});

test('cloned clients keep the explicit Chert transport and cannot restore retries', async () => {
  const { client, requests } = fixture();
  const clone = client.withOptions({ baseURL: 'https://vendor.invalid', apiKey: 'vendor-replacement' });
  expect(clone).toBeInstanceOf(Blooio);
  expect((await clone.messages.send({ to: '+15551234567', text: 'hello' })).message_id).toBe(receipt.message_id);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/send');
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer chert-key');
  expect(() => client.withOptions({ maxRetries: 2 })).toThrow();
});

test.each([
  ['queued', false, 'queued'], ['sent', false, 'sent'], ['sent', true, 'delivered'],
  ['delivered', false, 'delivered'], ['failed', false, 'failed'],
] as const)('recorded status %s with delivered=%s maps only observed state', async (status, delivered, expected) => {
  const { client, requests } = fixture({ id: 'event-42', status, delivered });
  expect(await client.messages.getStatus('event-42')).toEqual({ message_id: 'event-42', status: expected });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/messages/event-42');
  expect(requests[0]!.method).toBe('GET');
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer chert-key');
  expect(requests[0]!.headers.has('X-Vendor-Secret')).toBe(false);
});
test('retrieve maps recorded optional fields without inventing send time or read evidence', async () => {
  const { client } = fixture({ id: 'event-42', status: 'sent', delivered: false, phone: '+15551234567', direction: 'outbound',
    service: 'imessage', created_at: '2026-10-17T00:00:00Z', request: { body: 'private message' } });
  expect(await client.messages.retrieve('event-42')).toEqual({ message_id: 'event-42', status: 'sent', external_id: '+15551234567', direction: 'outbound', protocol: 'imessage' });
  for (const status of ['received', 'read', 'duplicate', 'unknown']) {
    const { client } = fixture({ id: 'event-42', status });
    expect(await client.messages.getStatus('event-42')).toEqual({ message_id: 'event-42' });
  }
});
test('missing recorded messages keep the upstream NotFoundError and never retry', async () => {
  const { client, requests } = fixture({ error: 'message not found' }, 404);
  try { await client.messages.getStatus('event-42'); throw new Error('Expected not found'); }
  catch (error) { expect(error).toBeInstanceOf(OfficialBlooio.NotFoundError); expect(error).toMatchObject({ status: 404 }); }
  expect(requests).toHaveLength(1);
});
test('recorded-message reads reject mismatched identity instead of returning another record', async () => {
  const { client, requests } = fixture({ id: 'different-id', status: 'sent' });
  await expect((async () => await client.messages.retrieve('event-42'))()).rejects.toMatchObject({ status: 502 });
  expect(requests).toHaveLength(1);
});
test('encoded identifiers stay within the recorded-message route and traversal never reaches Chert', async () => {
  const { client, requests } = fixture({ id: 'event:42', status: 'queued' });
  expect((await client.messages.getStatus('event:42')).message_id).toBe('event:42');
  expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/messages/event%3A42');
  for (const id of ['../send', 'id/other', '%2Fsend', '..', 'id?query=1', 'id#fragment', 'id\\other']) {
    await expect((async () => await client.messages.retrieve(id))()).rejects.toThrow();
  }
  expect(requests).toHaveLength(1);
});
test('pre-aborted reads never reach Chert', async () => {
  const { client, requests } = fixture({ id: 'event-42', status: 'queued' });
  const controller = new AbortController(); controller.abort();
  await expect((async () => await client.messages.getStatus('event-42', { signal: controller.signal }))()).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test('official me.retrieve maps only observed active state and never exposes credentials or billing', async () => {
  for (const active of [true, false]) {
    const { client, requests } = fixture({ is_active: active, plan: 'starter', api_key: 'private', devices: [{ id: 'private' }], credit_balance: 42 });
    const result = await client.me.retrieve();
    expect(result).toEqual({ valid: active });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://chert.example.test/api/v1/whoami');
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer chert-key');
    expect([...requests[0]!.headers.values()].join(' ')).not.toContain('vendor-secret');
  }
});
test('identity rejects missing/nonboolean evidence instead of inventing validity', async () => {
  for (const result of [{}, null, [], { is_active: 1 }, { is_active: 'true' }]) {
    const { client, requests } = fixture(result);
    await expect((async () => await client.me.retrieve())()).rejects.toMatchObject({ status: 502 });
    expect(requests).toHaveLength(1);
  }
});
test('identity preserves authentication failure as official SDK error and never retries', async () => {
  const { client, requests } = fixture({ error: { code: 2004, message: 'private auth detail' } }, 401);
  try { await client.me.retrieve(); throw new Error('Expected auth failure'); }
  catch (error) { expect(error).toBeInstanceOf(OfficialBlooio.AuthenticationError); expect(error).toMatchObject({ status: 401 }); }
  expect(requests).toHaveLength(1);
});
test('identity rejects request overrides and unsupported routes before network', async () => {
  const { client, requests } = fixture({ is_active: true });
  for (const operation of [
    () => client.me.retrieve({ maxRetries: 1 }),
    () => client.me.retrieve({ query: { target: 'other' } }),
    () => client.get('/v1/api/me/other'),
    () => client.post('/v1/api/me', { body: {} }),
    () => client.get('/v1/api/me', { body: {} }),
  ]) await expect((async () => await operation())()).rejects.toMatchObject({ status: 501 });
  expect(requests).toHaveLength(0);
});
test('identity forwards cancellation to its only Chert attempt', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  let attempts = 0;
  const client = new Blooio({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    attempts++; init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
  }) } });
  const controller = new AbortController(); const pending = (async () => await client.me.retrieve({ signal: controller.signal }))();
  await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(attempts).toBe(1);
  const before = attempts;
  await expect((async () => await client.me.retrieve({ signal: controller.signal }))()).rejects.toThrow(); expect(attempts).toBe(before);
});

test('contacts capability probes remain unsupported before Chert for phone and email', async () => {
  // A locally vended iMessage handle is not IDS capability evidence. Even a
  // misleading positive-looking response must never enable this operation.
  const { client, requests } = fixture({ address: '+15551234567', kind: 'phone',
    services: ['iMessage'], reachable: 'yes', service: 'iMessage', probe: 'imhandle_multi' });
  for (const contact of ['+15551234567', 'person@example.test']) {
    await expect((async () => await client.contacts.checkCapabilities(contact))()).rejects.toMatchObject({ status: 501 });
  }
  expect(requests).toHaveLength(0);
});


test('strict plaintext limits reject invalid recipients, lossy text and oversized keys before Chert',async()=>{
 for(const body of [{to:'+15551234567',text:'invalid\0text'},{to:'chat-id',text:'hello'},{to:'+15551234567\n',text:'hello'},{to:'+15551234567',text:'x'.repeat(16385)},{to:'+15551234567',text:'\ud800'},{to:'+15551234567',text:'hello','Idempotency-Key':'x'.repeat(201)},{to:'+15551234567',text:'hello','Idempotency-Key':''}]){
  const{client,requests}=fixture();await expect((async()=>await client.messages.send(body))()).rejects.toMatchObject({status:400});expect(requests).toHaveLength(0);
 }
});
test('old cloud404 propagates without fallback and uncertain4103 retains public identity data',async()=>{
 for(const status of [404,502]){const body={success:false,error:{code:4103,message:'private body',retryable:false},message_id:'b'.repeat(32),chat_id:'chat-a'};const{client,requests}=fixture(body,status);try{await client.messages.send({to:'+15551234567',text:'hello'});throw Error('expectedfailure');}catch(error){expect(error).toBeInstanceOf(APIError);if(!(error instanceof APIError))throw error;expect(error.status).toBe(status);expect(JSON.stringify(error.error)).toContain('b'.repeat(32));}expect(requests).toHaveLength(1);expect(requests[0].url).toEndWith('/api/v1/send');}
});

test('strict send preserves exact boundary text/key and original SDK response helpers',async()=>{
 const {client,requests}=fixture();const text='🦀'.repeat(4096),key='é'.repeat(100);
 const {data,response}=await client.messages.send({to:'+15551234567',text,'Idempotency-Key':key}).withResponse();
 expect(response.status).toBe(202);expect(data).toEqual({message_id:receipt.message_id,status:'queued'});
 expect(await requests[0]!.json()).toEqual({phone:'+15551234567',body:text,idempotency_key:key});
 const invalid=fixture();await expect((async()=>await invalid.client.messages.send({to:'+15551234567',text:'hello','Idempotency-Key':'é'.repeat(101)}))()).rejects.toMatchObject({status:400});expect(invalid.requests).toHaveLength(0);
 const cancelled=fixture(),controller=new AbortController();controller.abort();await expect((async()=>await cancelled.client.messages.send({to:'+15551234567',text:'hello'},{signal:controller.signal}))()).rejects.toThrow();expect(cancelled.requests).toHaveLength(0);
});
