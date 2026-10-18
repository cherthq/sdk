import {test,expect} from 'bun:test';
import {createMissBlueFetch,MISSBLUE_CONTRACT} from './index';
const line='8f14e45f-ceea-467a-9a1b-1b1e5f9e2c3d',chat='00000000-0000-4000-8000-000000000001',id='a'.repeat(32);
const inventory={phone_numbers:[{id:line,phone_number:'+15550000001',service:'imessage',is_active:true,capabilities:['imessage','send','receive']}]};
const row={id,lead_id:chat,phone_line_id:line,phone:'+15550000002',text:' Exact / Café 🌅\r\n ',direction:'outbound',status:'queued',created_at:'2026-10-19T01:00:00Z',response:{}};
function fixture(value:unknown=inventory,status=200){
 const calls:Request[]=[];
 const fetch=createMissBlueFetch({chert:{baseURL:'https://owned.chert.test',apiKey:'owned-chert-secret',tenant:'owned-tenant',fetch:async(input,init)=>{calls.push(new Request(input,init));return Response.json(value,{status});}}});
 return {fetch,calls};
}
const post=(f:ReturnType<typeof createMissBlueFetch>,path:string,body:unknown,headers:Record<string,string>={})=>f('https://api.missblue.dev'+path,{method:'POST',headers:{authorization:'Bearer provider-secret','content-type':'application/json',...headers},body:JSON.stringify(body)});
test('official contract is pinned and assigned numbers retain actual identities without availability fabrication',async()=>{
 expect(MISSBLUE_CONTRACT.version).toBe('1.0.0');expect(MISSBLUE_CONTRACT.sha256).toHaveLength(64);
 const f=fixture();const response=await f.fetch('https://api.missblue.dev/v1/numbers',{headers:{authorization:'Bearer vendor-secret'}});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({total:1,data:[{id:line,handle:'+15550000001',service:'imessage',disabled:false}]});
 expect(f.calls).toHaveLength(1);expect(f.calls[0]!.url).toBe('https://owned.chert.test/api/v1/phone-numbers');expect(f.calls[0]!.headers.get('authorization')).toBe('Bearer owned-chert-secret');expect(f.calls[0]!.headers.get('x-chert-tenant')).toBe('owned-tenant');
});
test('inventory refuses malformed, duplicate identity and unsupported service without partial results',async()=>{
 for(const patch of [{id:'native-derived-line'},{service:'sms'},{is_active:'true'},{capabilities:[]},{phone_number:'+15550000001\n'}]){
  const f=fixture({phone_numbers:[{...inventory.phone_numbers[0],...patch}]});expect((await f.fetch('https://api.missblue.dev/v1/numbers')).status).toBe(502);expect(f.calls).toHaveLength(1);
 }
 for(const second of [inventory.phone_numbers[0],{...inventory.phone_numbers[0],id:'00000000-0000-4000-8000-000000000002'},{...inventory.phone_numbers[0],phone_number:'+15550000009'}]){
  const f=fixture({phone_numbers:[inventory.phone_numbers[0],second]});expect((await f.fetch('https://api.missblue.dev/v1/numbers')).status).toBe(502);
 }
});
test('recorded retrieve exposes only supported stored facts, preserves text and never invents native IDs or clocks',async()=>{
 const f=fixture(row);const response=await f.fetch(`https://api.missblue.dev/v1/messages/${id}`);expect(response.status).toBe(200);
 expect(await response.json()).toEqual({id,chat_id:chat,direction:'outbound',recipient:row.phone,text:row.text,status:'pending',number_id:line,created_at:row.created_at});
 expect(f.calls[0]!.url).toBe(`https://owned.chert.test/api/v1/messages/${id}`);
 for(const patch of [{id:'b'.repeat(32)},{lead_id:'native-guid'},{phone_line_id:'invented'},{direction:'inbound'},{service:'sms'},{status:'unknown'},{text:'\ud800'},{text:'a\0b'},{created_at:'2026-02-30T00:00:00Z'},{status:'delivered',service:'imessage',delivered:false},{status:'read',service:'imessage',delivered:true,read:false},{error_code:4103},{response:{status:'sent'}}]){
  const x=fixture({...row,...patch});expect((await x.fetch(`https://api.missblue.dev/v1/messages/${id}`)).status).toBe(502);expect(x.calls).toHaveLength(1);
 }
});
test('delivery/read projection requires consistent actual iMessage receipt flags and copies only actual update time',async()=>{
 for(const status of ['delivered','read']){
  const x=fixture({...row,status,service:'imessage',delivered:true,read:status==='read',updated_at:'2026-10-19T01:01:00Z'});
  const r=await x.fetch(`https://api.missblue.dev/v1/messages/${id}`);expect(r.status).toBe(200);const b=await r.json();expect(b.status).toBe(status);expect(b.service).toBe('imessage');expect(b.updated_at).toBe('2026-10-19T01:01:00Z');expect(b.message_at).toBeUndefined();expect(b.external_message_id).toBeUndefined();
 }
 for(const patch of [{response:{error:'private'}},{response:{error_code:4006}},{read:true,delivered:false},{response:{delivered:false}},{retryable:true}]){
  const x=fixture({...row,status:'delivered',service:'imessage',delivered:true,...patch});expect((await x.fetch(`https://api.missblue.dev/v1/messages/${id}`)).status).toBe(502);
 }
});
test('typing uses existing owned canonical chat only, validates actual invocation receipt and returns empty204',async()=>{
 for(const active of [true,false]){
  const state=active?'typing':'stopped',f=fixture({chat_id:chat,state,applied:true});const response=await post(f.fetch,'/v1/typing',{chat_id:chat.toUpperCase(),active});expect(response.status).toBe(204);expect(await response.text()).toBe('');expect(f.calls).toHaveLength(1);expect(f.calls[0]!.url).toBe(`https://owned.chert.test/api/v1/chats/${chat}/typing`);expect(await f.calls[0]!.json()).toEqual({state});
 }
 for(const data of [{ok:true},{chat_id:chat,state:'typing',applied:1},{chat_id:'foreign',state:'typing',applied:true},{chat_id:chat,state:'stopped',applied:true},{chat_id:chat,state:'typing',applied:true,extra:true}]){
  const f=fixture(data);const r=await post(f.fetch,'/v1/typing',{chat_id:chat,active:true});expect(r.status).toBe(504);expect((await r.json()).error.code).toBe('command_unconfirmed');expect(f.calls).toHaveLength(1);
 }
});
test('unsupported mutation fields and routes refuse before even readonly Chert resolution',async()=>{
 for(const [path,body]of [['/v1/messages',{number_id:line,recipient:'+15550000002',text:'hello',status_callback:'https://example.test/cb'}],['/v1/typing',{chat_id:'any;-;+15550000002',active:true}],['/v1/typing',{chat_id:chat}],['/v1/typing',{chat_id:chat,active:1}],['/v1/typing',{chat_id:chat,active:true,from_number:'+15550000001'}],['/v1/typing-indicators',{number:'+15550000002',state:'start'}],['/v1/messages/'+id+'/react',{reaction_key:'heart'}]] as [string,unknown][]){
  const f=fixture();expect((await post(f.fetch,path,body)).status).toBe(501);expect(f.calls).toHaveLength(0);
 }
 for(const url of ['https://evil.test/v1/numbers','http://api.missblue.dev/v1/numbers','https://api.missblue.dev/v1/numbers?x=1','https://api.missblue.dev/v1/numbers#x','https://api.missblue.dev/v1/messages/'+id+'%2f']){const f=fixture();expect((await f.fetch(url)).status).toBe(501);expect(f.calls).toHaveLength(0);}
 const f=fixture();expect((await f.fetch('https://api.missblue.dev/v1/numbers',{headers:{'x-routing-override':'x'}})).status).toBe(501);expect(f.calls).toHaveLength(0);
});
test('constructor guards, cancellation and errors preserve oneattempt and sanitized official envelope',async()=>{
 expect(()=>createMissBlueFetch({chert:{baseURL:'http://not-local.test',apiKey:'key'}})).toThrow();
 const a=new AbortController();a.abort();const f=fixture();await expect(f.fetch('https://api.missblue.dev/v1/numbers',{signal:a.signal})).rejects.toThrow();expect(f.calls).toHaveLength(0);
 for(const status of [401,404,500]){const x=fixture({error:{code:'internal-secret',message:'private phone credential'}},status);const r=await x.fetch(`https://api.missblue.dev/v1/messages/${id}`);expect(r.status).toBe(status===500?504:status);const b=await r.json();expect(Object.keys(b)).toEqual(['error']);expect(Object.keys(b.error).sort()).toEqual(['code','message']);expect(JSON.stringify(b)).not.toContain('private');expect(x.calls).toHaveLength(1);}
});
test('actual Bun HTTP and ChertClient isolate auth and preserve exact typing payload with no SDK/network fallback',async()=>{
 const calls:{url:string;auth:string|null;body:string}[]=[];const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async r=>{calls.push({url:r.url,auth:r.headers.get('authorization'),body:await r.text()});return Response.json({chat_id:chat,state:'typing',applied:true});}});
 try{const fetch=createMissBlueFetch({chert:{baseURL:`http://127.0.0.1:${server.port}`,apiKey:'actual-owned'}});const r=await post(fetch,'/v1/typing',{chat_id:chat,active:true});expect(r.status).toBe(204);expect(calls).toHaveLength(1);expect(calls[0]!.auth).toBe('Bearer actual-owned');expect(calls[0]!.body).toBe('{"state":"typing"}');expect(calls[0]!.url).toEndWith('/api/v1/chats/'+chat+'/typing');}finally{await server.stop(true);}
});

function sendFixture(ack?:unknown,status=202,stock:unknown=inventory) {
 const calls:Request[]=[];
 const content='  Exact / Café 🌅\r\n  ',recipient='+15558670002';
 const receipt=ack??{chat:{id:chat,is_group:false,handles:[{address:recipient,service:'unknown'}]},message:{id,chat_id:chat,status:'queued',direction:'outbound',parts:[{type:'text',value:content}],service:'unknown',created_at:'2026-10-19T01:00:00Z',delivered_at:null,read_at:null}};
 const fetch=createMissBlueFetch({chert:{baseURL:'https://owned.chert.test',apiKey:'owned',fetch:async(input,init)=>{const r=new Request(input,init);calls.push(r);return Response.json(r.method==='GET'?stock:receipt,{status:r.method==='GET'?200:status});}}});
 return {fetch,calls,body:{number_id:line,recipient,text:content},receipt};
}
test('plaintext send resolves exact owned number then uses explicit from and validates actual202 queue without fake native facts',async()=>{
 const f=sendFixture();const response=await post(f.fetch,'/v1/messages',f.body);expect(response.status).toBe(201);expect(await response.json()).toEqual({id,chat_id:chat,status:'pending',queued:true});expect(f.calls).toHaveLength(2);
 expect(f.calls[0]!.method).toBe('GET');expect(f.calls[1]!.url).toBe('https://owned.chert.test/api/v1/chats');expect(await f.calls[1]!.json()).toEqual({from:'+15550000001',to:[f.body.recipient],message:{parts:[{type:'text',value:f.body.text}]}});
 expect(f.calls[1]!.headers.get('authorization')).toBe('Bearer owned');expect(f.calls[1]!.headers.get('idempotency-key')).toBeNull();
});
test('sender inventory ownership and complete contradictory inventory refuse before native-producing request',async()=>{
 const missing=sendFixture(undefined,202,{phone_numbers:[]});expect((await post(missing.fetch,'/v1/messages',missing.body)).status).toBe(404);expect(missing.calls).toHaveLength(1);
 for(const patch of [{service:'sms'},{is_active:false},{capabilities:['imessage','receive']},{phone_number:'+15550000001\n'}]){
  const f=sendFixture(undefined,202,{phone_numbers:[{...inventory.phone_numbers[0],...patch}]});expect((await post(f.fetch,'/v1/messages',f.body)).status).toBeGreaterThanOrEqual(400);expect(f.calls).toHaveLength(1);
 }
 const f=sendFixture(undefined,202,{phone_numbers:[inventory.phone_numbers[0],{...inventory.phone_numbers[0],phone_number:'+15550000009'}]});expect((await post(f.fetch,'/v1/messages',f.body)).status).toBe(502);expect(f.calls).toHaveLength(1);
});
test('bad send input refuses zeroHTTP, unsupported options stay closed, exact Unicode is never normalized',async()=>{
 for(const patch of [{text:'\ud800'},{text:'\0'},{text:' '},{text:'x'.repeat(16385)},{recipient:'+15555550100'},{recipient:'+15550000002'},{recipient:'someone@example.test'},{number_id:'native-id'}]){
  const f=sendFixture();expect((await post(f.fetch,'/v1/messages',{...f.body,...patch})).status).toBe(400);expect(f.calls).toHaveLength(0);
 }
 for(const patch of [{allow_duplicate:false},{manual:false},{attachment_ids:[]},{status_callback:'https://example.test'},{reply_to_message_id:chat}]){const f=sendFixture();expect((await post(f.fetch,'/v1/messages',{...f.body,...patch})).status).toBe(501);expect(f.calls).toHaveLength(0);}
});
test('malformed and wrongstatus ACKs are permanently uncertain for this invocation and never trigger automatic retry',async()=>{
 const base=sendFixture().receipt as {chat:Record<string,unknown>;message:Record<string,unknown>};
 for(const patch of [{id:'00000000-0000-4000-8000-000000000001'},{status:'sent'},{service:'sms'},{direction:'inbound'},{delivered_at:'2026-10-19T01:00:00Z'},{parts:[{type:'text',value:'changed'}]},{chat_id:'foreign'},{error:'private failure'},{extra:true}]){
  const f=sendFixture({...base,message:{...base.message,...patch}});const r=await post(f.fetch,'/v1/messages',f.body);expect(r.status).toBe(504);expect(await r.json()).toEqual({error:{code:'command_unconfirmed',message:'Send outcome is unconfirmed. Reconcile before retrying.'}});expect(f.calls).toHaveLength(2);
 }
 for(const status of [200,201]){const f=sendFixture(undefined,status);expect((await post(f.fetch,'/v1/messages',f.body)).status).toBe(504);expect(f.calls).toHaveLength(2);}
});
test('genuine HTTP two-hop ChertClient send honors chosen from, exact text, onePOST and unknown transport outcome',async()=>{
 const f=sendFixture(),seen:Request[]=[];let received:unknown;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async r=>{seen.push(r);if(r.method==='GET')return Response.json(inventory);received=await r.json();return Response.json(f.receipt,{status:202});}});
 try{const fetch=createMissBlueFetch({chert:{baseURL:`http://127.0.0.1:${server.port}`,apiKey:'local-owned'}});const r=await post(fetch,'/v1/messages',f.body);expect(r.status).toBe(201);expect(seen).toHaveLength(2);expect(seen.filter(r=>r.method==='POST')).toHaveLength(1);expect(received).toEqual({from:'+15550000001',to:[f.body.recipient],message:{parts:[{type:'text',value:f.body.text}]}});}finally{await server.stop(true);}
 let posts=0;const lost=createMissBlueFetch({chert:{baseURL:'https://owned.chert.test',apiKey:'owned',fetch:async(input,init)=>{const r=new Request(input,init);if(r.method==='GET')return Response.json(inventory);posts++;throw new TypeError('private network detail');}}});const r=await post(lost,'/v1/messages',f.body);expect(r.status).toBe(504);expect(posts).toBe(1);expect(await r.text()).not.toContain('private network');
});


test('uncertain sends preserve only validated Chert reconciliation IDs in namespaced headers without retry',async()=>{
 const valid={error:{code:4103,retryable:false,message:'private transport detail'},message_id:id,chat_id:chat,debug_secret:'never expose'};
 for(const patch of [{},{message_id:'550e8400-e29b-41d4-a716-446655440000'},{message_id:id.toUpperCase()},{chat_id:'foreign'},{error:{code:4001,message:'private'}}]){
  const f=sendFixture({...valid,...patch},502),response=await post(f.fetch,'/v1/messages',f.body);
  const accepted=Object.keys(patch).length===0;
  expect(response.status).toBe(504);expect(response.headers.get('x-chert-message-id')).toBe(accepted?id:null);expect(response.headers.get('x-chert-chat-id')).toBe(accepted?chat:null);
  const body=await response.json();expect(Object.keys(body)).toEqual(['error']);expect(Object.keys(body.error).sort()).toEqual(['code','message']);expect(body.error.code).toBe('command_unconfirmed');expect(JSON.stringify(body)).not.toContain('private');expect(JSON.stringify([...response.headers])).not.toContain('never expose');expect(f.calls.filter(r=>r.method==='POST')).toHaveLength(1);
 }
});
