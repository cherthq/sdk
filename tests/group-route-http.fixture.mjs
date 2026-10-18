// Isolated actual HTTP route fixture. Only external auth, DB and device boundary are mocked.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mock } from 'bun:test';
import { plugin } from 'bun';
const app = resolve(import.meta.dir, '../../imessage-server');
const originalFetch=globalThis.fetch;let loopbackRequests=0;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1','fixture permits loopback HTTP only');loopbackRequests++;return originalFetch(input,init);};
await plugin({ name: 'group-route-resolution', setup(build) {
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const tenant={id:'tenant-a',crm_project_id:'project-a',phone_line_id:'line-a'};
const line={id:'line-a',project_id:'project-a',phone_number:'+15550000001',status:'active',server_url:'https://device.invalid',api_key:'fixture-device-key'};
const tables={phone_lines:[line],leads:[],convo:[],messaging_send_events:[]};
let failEventInsert=false;
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;} eq(key,value){this.filters.push(row=>row[key]===value);return this;}
 insert(value){this.inserted={id:`${this.table}-${tables[this.table].length+1}`,created_at:'2026-10-17T00:00:00Z',...value};return this;}
 update(value){this.patch=value;return this;} single(){this.one=true;return this;} maybeSingle(){this.one=true;return this;}
 then(yes,no){try{if(this.inserted && this.table==='messaging_send_events' && failEventInsert)return Promise.resolve({data:null,error:{message:'fixture storage failure'}}).then(yes,no);let rows;if(this.inserted){tables[this.table].push(this.inserted);rows=[this.inserted];}else rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));if(this.patch)for(const row of rows)Object.assign(row,this.patch);return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);}catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
mock.module(resolve(app,'lib/api-shape/auth-bridge.ts'),()=>({authForChert:async req=>{
 assert.equal(req.headers.get('authorization'),'Bearer fixture-chert-key');return{ok:true,tenant,rawBody:await req.text()};
}}));
mock.module(resolve(app,'lib/sending/follow-up-send.ts'),()=>({sendFollowUp:async()=>{throw new Error('Unexpected DM dispatch');}}));
mock.module(resolve(app,'lib/messaging/auth.ts'),()=>({authenticateRequest:async req=>{assert.equal(req.headers.get('authorization'),'Bearer fixture-chert-key');return{ok:true,tenant};}}));
let nativeBody;const dispatches=[];
mock.module(resolve(app,'lib/messaging/mac-forward.ts'),()=>({forwardSignedJsonToMac:async(config,path,body)=>{
 assert.equal(config.server_url,'https://device.invalid');assert.equal(path,'/api/v1/chats/group');dispatches.push(body);return{ok:true,status:200,body:nativeBody};
}}));
const {POST}=await import(resolve(app,'app/api/v1/chats/route.ts'));
const messageStatus=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>req.method==='GET'?messageStatus.GET(new NextRequest(req),{params:Promise.resolve({id:new URL(req.url).pathname.split('/').at(-1)})}):POST(new NextRequest(req))});
try {
 for(const mode of ['guid-only','no-guid','initial-error']) {
  nativeBody={ok:true,chat_id:'iMessage;+;group-a',participants:['+15550000002','+15550000003'],created:true,resolver:'fixture-selector',initial_message_id:mode==='guid-only'?'apple-actual-guid':null,...(mode==='initial-error'?{initial_message_error:'device rejected initial message'}:{})};
  const response=await fetch(`http://127.0.0.1:${server.port}/api/v1/chats`,{method:'POST',headers:{authorization:'Bearer fixture-chert-key','content-type':'application/json'},body:JSON.stringify({from:line.phone_number,to:nativeBody.participants,message:{parts:[{type:'text',value:'group fixture plaintext'}]}})});
  assert.equal(response.status,202);const body=await response.json();const failed=mode==='initial-error';
  assert.equal(body.message.status,failed?'failed':'queued');assert.equal(body.message.delivered_at,null);assert.equal(body.message.read_at,null);assert.equal(body.message.service,'unknown');assert.equal(body.chat.service,'unknown');assert.ok(body.chat.handles.every(handle=>handle.service==='unknown'));
  const event=tables.messaging_send_events.at(-1);assert.equal(event.status,failed?'failed':'processing');assert.equal(event.response_payload.status,failed?'failed':'queued');assert.equal(event.response_payload.delivered,false);assert.equal(event.response_payload.service,'unknown');assert.equal(event.response_payload.spectrum_message_guid,nativeBody.initial_message_id);assert.equal(event.tenant_id,tenant.id);assert.equal(event.phone_line_id,line.id);
  const read=await fetch(`http://127.0.0.1:${server.port}/api/v1/messages/${event.id}`,{headers:{authorization:'Bearer fixture-chert-key'}});assert.equal(read.status,200);assert.equal((await read.json()).status,failed?'failed':'queued');
  const convo=tables.convo.at(-1);assert.equal(convo.messages[0].delivered,false);assert.equal(convo.messages[0].spectrum_message_guid,nativeBody.initial_message_id);assert.equal(body.message.id,event.id);assert.equal(tables.leads.at(-1).details.phone_line_id,line.id);
 }
 failEventInsert=true;nativeBody={ok:true,chat_id:'iMessage;+;group-a',created:true,participants:['+15550000002','+15550000003'],initial_message_id:'actual-guid'};
 const storageFailure=await fetch(`http://127.0.0.1:${server.port}/api/v1/chats`,{method:'POST',headers:{authorization:'Bearer fixture-chert-key','content-type':'application/json'},body:JSON.stringify({from:line.phone_number,to:nativeBody.participants,message:{parts:[{type:'text',value:'durability fixture'}]}})});
 assert.equal(storageFailure.status,500);const failure=await storageFailure.json();assert.equal(failure.error.retryable,false);assert.equal(failure.message,undefined);assert.match(failure.error.message,/do not retry/);failEventInsert=false;
 const before=dispatches.length;
 const response=await fetch(`http://127.0.0.1:${server.port}/api/v1/chats`,{method:'POST',headers:{authorization:'Bearer fixture-chert-key','content-type':'application/json'},body:JSON.stringify({from:'+15550000009',to:['+15550000002','+15550000003'],message:{parts:[{type:'text',value:'no dispatch'}]}})});
 assert.equal(response.status,403);assert.equal(dispatches.length,before);
 console.log(JSON.stringify({passed:true,cases:['guid-only acceptance','no-guid acceptance','explicit initial failure','unassigned sender rejected','event persistence failure forbids retry','recorded status preserves queued'],deviceDispatches:dispatches.length,liveMessages:0,loopbackRequests}));
} finally {server.stop(true);}
