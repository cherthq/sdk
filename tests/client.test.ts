import { expect, test } from 'bun:test';
import { ChertClient, ChertAPIError } from '../packages/sdk/src/index';
const options = { baseURL: 'https://chert.example.test', apiKey: 'synthetic-chert-key', tenant: 'tenant' };
test('pins auth and destination, forwards abort and never follows redirects', async () => {
  const controller = new AbortController();
  const client = new ChertClient({ ...options, fetch: (async (input, init) => {
    expect(String(input)).toBe('https://chert.example.test/api/v1/send');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-chert-key');
    expect(new Headers(init?.headers).get('x-chert-tenant')).toBe('tenant');
    expect(init?.signal).toBe(controller.signal); expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).toEqual({ phone: '+15551234567', body: 'hello' });
    return Response.json({ message_id: 'message' });
  }) });
  expect(await client.request<{message_id:string}>('/send', {body:{phone:'+15551234567',body:'hello'},signal:controller.signal})).toEqual({message_id:'message'});
  await expect(client.request('//provider.test/leak')).rejects.toThrow(TypeError);
});
test('rejects insecure destinations and path traversal before network', async () => {
  for (const baseURL of ['http://public.test','https://user:pass@chert.test','https://chert.test?q=1']) expect(() => new ChertClient({...options,baseURL})).toThrow(TypeError);
  let calls = 0;
  const client = new ChertClient({...options,baseURL:'https://chert.test/deployment',fetch:(async()=>{calls++;return Response.json({});})});
  await expect(client.request('/%2e%2e/leak')).rejects.toThrow(TypeError);
  expect(calls).toBe(0);
});
test('retains machine-readable errors without logging credentials/content or retrying', async () => {
  let calls = 0;
  const client = new ChertClient({...options,fetch:(async()=>{calls++;return Response.json({success:false,error:{code:4104,message:'private message content'}},{status:502,headers:{'x-trace-id':'trace'}});})});
  try { await client.request('/send',{body:{}}); throw new Error('expected failure'); }
  catch(error) {
    expect(error).toBeInstanceOf(ChertAPIError);
    const failure=error as ChertAPIError;
    expect(failure.code).toBe('4104');expect(failure.requestId).toBe('trace');expect(failure.message).not.toContain('private message content');
  }
  expect(calls).toBe(1);
});

test('preserves the legacy send route error code without exposing its private message', async () => {
  const client = new ChertClient({...options, fetch:async()=>Response.json({status:'failed',error:'private message content',code:4103,retryable:false},{status:502})});
  try { await client.request('/send',{body:{}}); throw new Error('expected failure'); }
  catch(error) {
    expect(error).toBeInstanceOf(ChertAPIError);
    expect((error as ChertAPIError).code).toBe('4103');
    expect((error as Error).message).not.toContain('private message content');
  }
});

test('retains durable media reconciliation identity without retrying or logging the envelope', async () => {
  const envelope = { error: { code: 4103, message: 'private content', retryable: false }, message_id: 'a'.repeat(32), chat_id: 'owned-chat' };
  let calls = 0;
  const client = new ChertClient({...options, fetch:async()=>{ calls++; return Response.json(envelope,{status:502}); }});
  try { await client.request('/chats/owned-chat/messages',{body:{}}); throw new Error('expected failure'); }
  catch(error) {
    expect(error).toBeInstanceOf(ChertAPIError);
    const failure = error as ChertAPIError;
    expect(failure.code).toBe('4103');
    expect(failure.data).toEqual(envelope);
    expect(failure.message).not.toContain('private content');
    expect(failure.message).not.toContain(envelope.message_id);
  }
  expect(calls).toBe(1);
});

test('status-aware requests retain the actual HTTP status without a second transport', async () => {
  let calls=0,status=202;
  const client=new ChertClient({...options,fetch:async()=>{calls++;return Response.json({status:'queued'},{status});}});
  expect(await client.requestWithResponse('/text-operations/v1',{body:{}})).toEqual({status:202,data:{status:'queued'}});
  status=200;expect(await client.requestWithResponse('/text-operations/v1',{body:{}})).toEqual({status:200,data:{status:'queued'}});
  expect(await client.request<{status:string}>('/text-operations/v1',{body:{}})).toEqual({status:'queued'});
  expect(calls).toBe(3);
});
test('status-aware empty and error responses use the same no-retry boundary',async()=>{
 let calls=0;const client=new ChertClient({...options,fetch:async()=>{calls++;return calls===1?new Response(null,{status:204}):Response.json({error:{code:4103,message:'private-content'}},{status:502});}});
 expect(await client.requestWithResponse('/empty')).toEqual({status:204,data:undefined});
 await expect(client.requestWithResponse('/text-operations/v1',{body:{}})).rejects.toMatchObject({status:502,code:'4103'});expect(calls).toBe(2);
});
