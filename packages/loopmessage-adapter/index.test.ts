import {test,expect} from 'bun:test';
import {createLoopMessageFetch} from './index';
const endpoint='https://a.loopmessage.com/api/v1/message/send/';
const valid={contact:'+15550000002',text:'hello',channel:'imessage'};
function fixture(result:unknown={success:true,message_id:'a'.repeat(32),chat_id:'chat-a',status:'queued'},status=202){
 const calls:Request[]=[];
 const transport=createLoopMessageFetch({chert:{baseURL:'https://chert.test',apiKey:'owned-key',tenant:'owned-tenant',fetch:async(input,init)=>{calls.push(new Request(input,init));return Response.json(result,{status});}}});
 return {calls,transport};
}
const post=(transport:ReturnType<typeof createLoopMessageFetch>,body:unknown,headers:Record<string,string>={})=>transport(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'vendor-not-forwarded',...headers},body:JSON.stringify(body)});
test('real queue receipt maps endpoint-specific contact shape and isolates credentials',async()=>{
 const {calls,transport}=fixture();const response=await post(transport,valid);expect(response.status).toBe(200);expect(await response.json()).toEqual({message_id:'a'.repeat(32),contact:valid.contact,text:'hello'});expect(calls.length).toBe(1);expect(calls[0]!.url).toBe('https://chert.test/api/v1/text-operations/v1');expect(await calls[0]!.json()).toEqual({phone:valid.contact,body:'hello'});expect(calls[0]!.headers.get('authorization')).toBe('Bearer owned-key');expect(calls[0]!.headers.get('x-chert-tenant')).toBe('owned-tenant');
});
test('unsupported options, channels, malformed Unicode and routing reject before effects',async()=>{
 for(const body of [{...valid,sender:'sender-id'},{...valid,channel:'sms'},{...valid,attachments:[]},{contact:valid.contact,text:'hello'},{...valid,text:'\ud800'},{...valid,text:'bad\0text'},{...valid,text:'x'.repeat(16385)},{...valid,text:'x'.repeat(10000)},{...valid,contact:valid.contact+'\n'},{...valid,text:''}]){const {calls,transport}=fixture();expect((await post(transport,body)).status).toBe(501);expect(calls.length).toBe(0);}
 for(const headers of ([{'Idempotency-Key':'key'},{'x-provider-route':'unsafe'}] as Record<string,string>[])){const {calls,transport}=fixture();expect((await post(transport,valid,headers)).status).toBe(501);expect(calls.length).toBe(0);}
 const {calls,transport}=fixture();expect((await transport(endpoint+'?x=1',{method:'POST'})).status).toBe(501);expect((await transport(endpoint)).status).toBe(501);expect(calls.length).toBe(0);
});
test('incompatible successes never invent lifecycle or retry',async()=>{
 for(const [body,status]of [[{success:true,message_id:'a'.repeat(32),chat_id:'chat-a',status:'sent'},202],[{success:true,message_id:'a'.repeat(32),chat_id:'chat-a',status:'queued',extra:true},202],[{success:true,message_id:'550e8400-e29b-41d4-a716-446655440000',chat_id:'chat-a',status:'queued'},202],[{},200]] as const){const {calls,transport}=fixture(body,status);expect((await post(transport,valid)).status).toBe(502);expect(calls.length).toBe(1);}
});
test('uncertain outcomes expose only both validated Chert reconciliation headers',async()=>{
 for(const bad of [false,true]){const {calls,transport}=fixture({message_id:bad?'native_bad':'a'.repeat(32),chat_id:'chat-a',error:{code:4103,message:'private-secret',retryable:false}},502);const response=await post(transport,valid);expect(response.status).toBe(502);expect(await response.json()).toEqual({success:false,code:100,message:'Send request did not complete; reconcile before retrying.'});expect(response.headers.get('x-chert-message-id')).toBe(bad?null:'a'.repeat(32));expect(response.headers.get('x-chert-chat-id')).toBe(bad?null:'chat-a');expect(calls.length).toBe(1);}
});
test('already cancelled input has zero requests',async()=>{const {calls,transport}=fixture();const abort=new AbortController();abort.abort();await expect(transport(endpoint,{method:'POST',body:JSON.stringify(valid),signal:abort.signal})).rejects.toThrow();expect(calls.length).toBe(0);});

test('network uncertainty is sanitized once and inflight cancellation propagates',async()=>{
 let calls=0;const transport=createLoopMessageFetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;throw new Error('private-network-url');}}});
 const response=await post(transport,valid);expect(response.status).toBe(502);expect(await response.text()).not.toContain('private-network');expect(calls).toBe(1);
 const abort=new AbortController();let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const cancelled=createLoopMessageFetch({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(input,init)=>{const request=new Request(input,init);started();return new Promise<Response>((_,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}}});
 const pending=cancelled(endpoint,{method:'POST',body:JSON.stringify(valid),signal:abort.signal});await ready;abort.abort();await expect(pending).rejects.toThrow();
});
test('documented text boundary is conservative and never truncates',async()=>{
 const {calls,transport}=fixture();const text='x'.repeat(9999);const response=await post(transport,{...valid,text});expect(response.status).toBe(200);expect((await response.json() as {text:string}).text).toBe(text);expect((await calls[0]!.json()).body).toBe(text);
 const before=calls.length;expect((await post(transport,{...valid,text:'x'.repeat(10000)})).status).toBe(501);expect(calls.length).toBe(before);
});
test('status read maps actual outbound delivery without invented clocks',async()=>{
 const id='a'.repeat(32);const {calls,transport}=fixture({id,direction:'outbound',status:'delivered',delivered:true,service:'imessage',phone:valid.contact,text:'recorded'},200);
 const response=await transport(`https://a.loopmessage.com/api/v1/message/status/${id}/`);expect(response.status).toBe(200);expect(await response.json()).toEqual({message_id:id,status:'delivered',contact:valid.contact,text:'recorded'});expect(calls.length).toBe(1);expect(calls[0]!.method).toBe('GET');
});
test('status guards and unknown evidence never create terminal failures or deliveries',async()=>{
 const id='a'.repeat(32),url=`https://a.loopmessage.com/api/v1/message/status/${id}/`;
 for(const row of [{status:'queued'},{status:'sent'},{status:'read',read:true},{status:'failed',error_code:4103},{status:'unknown'},{status:'delivered',delivered:true}]){const {calls,transport}=fixture({id,direction:'outbound',...row},200);const response=await transport(url);expect(response.status).toBe(200);expect(await response.json()).toEqual({message_id:id,status:['queued','sent'].includes(row.status)?'processing':'unknown'});expect(calls.length).toBe(1);}
 for(const patch of [{id:'b'.repeat(32)},{direction:'inbound'},{service:'sms'},{delivered:'true'},{response:{status:'queued'}},{response:{delivered:false}},{response:[]}]){const {calls,transport}=fixture({id,direction:'outbound',status:'delivered',delivered:true,...patch},200);expect((await transport(url)).status).toBe(502);expect(calls.length).toBe(1);}
 for(const init of [{method:'POST',body:'{}'},{headers:{'Idempotency-Key':'x'}}]){const {calls,transport}=fixture();expect((await transport(url,init)).status).toBe(501);expect(calls.length).toBe(0);}
 for(const path of [url+'?x=1',url.replace(id,'%61'+id.slice(1)),url.replace(id,id+'%2f')]){const {calls,transport}=fixture();expect((await transport(path)).status).toBe(501);expect(calls.length).toBe(0);}
 const {calls,transport}=fixture({error:'private'},404);const response=await transport(url);expect(response.status).toBe(404);expect(await response.json()).toEqual({error_code:100,message:'Recorded status unavailable.'});expect(calls.length).toBe(1);
});
test('status cancellation propagates without retry or credential forwarding',async()=>{
 const abort=new AbortController();let start!:()=>void,calls=0;const ready=new Promise<void>(resolve=>{start=resolve;});
 const transport=createLoopMessageFetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(input,init)=>{calls++;const request=new Request(input,init);expect(request.method).toBe('GET');expect(request.headers.get('authorization')).toBe('Bearer owned');start();return new Promise<Response>((_,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}}});
 const pending=transport(`https://a.loopmessage.com/api/v1/message/status/${'a'.repeat(32)}/`,{headers:{authorization:'vendor'},signal:abort.signal});await ready;abort.abort();await expect(pending).rejects.toThrow();expect(calls).toBe(1);
});

test('delivery rejects explicit failure and contradictory read evidence without retry',async()=>{
 const id='a'.repeat(32),url=`https://a.loopmessage.com/api/v1/message/status/${id}/`;
 for(const patch of [{error:'failed'},{success:false},{ok:false},{error_code:4006},{retryable:true},{response:{ok:false}},{response:{error:'failed'}},{response:{error_code:4006}},{response:{retryable:true}},{retry_after:1},{error_code:'4103'},{read:true,delivered:false}]){
 const {calls,transport}=fixture({id,direction:'outbound',status:'delivered',service:'imessage',delivered:true,...patch},200);expect((await transport(url)).status).toBe(502);expect(calls.length).toBe(1);expect(calls[0]!.method).toBe('GET');
 }
});

test('queued and uncertainty receipts reject non-contract chat identities',async()=>{
 for(const chat_id of ['chat.dot','chat@account','chat🚫']){
  const queued=fixture({success:true,message_id:'a'.repeat(32),chat_id,status:'queued'},202);
  expect((await post(queued.transport,valid)).status).toBe(502);expect(queued.calls.length).toBe(1);
  const unknown=fixture({message_id:'a'.repeat(32),chat_id,error:{code:4103,retryable:false}},502);
  const response=await post(unknown.transport,valid);expect(response.headers.get('x-chert-chat-id')).toBeNull();expect(unknown.calls.length).toBe(1);
 }
});
