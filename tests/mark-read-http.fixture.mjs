// Actual cloud handler + HMAC forwarder over HTTP; DB/auth/device effects are synthetic.
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import Linq from '../packages/linq-adapter/src/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'mark-read-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',crm_project_id:'project-a',phone_line_id:'line-a'};
const lead={id:'chat-a',convo_id:'convo-a',number:'+15550000002',messaging_tenant_id:tenant.id,project_id:tenant.crm_project_id,details:{phone_line_id:'line-a'}};
const line={id:'line-a',project_id:'project-a',signing_secret:'fixture-hmac-secret',api_key:'fixture-native-bearer'};
const tables={leads:[lead],phone_lines:[line]};
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}maybeSingle(){return Promise.resolve({data:tables[this.table].find(row=>this.filters.every(f=>f(row)))??null,error:null});}}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
mock.module(resolve(app,'lib/api-shape/auth-bridge.ts'),()=>({authForChert:async req=>{assert.equal(req.headers.get('authorization'),'Bearer fixture-chert');return{ok:true,tenant,rawBody:await req.text()};}}));
const deviceRequests=[];let nativeStatus=200;let nativeBody;let unreachable=false;let deviceAttempts=0;
const device=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const raw=await req.text();const signature=req.headers.get('x-chert-signature');assert.ok(signature);const match=/^v1,(\d+),([a-f0-9]{64})$/.exec(signature);assert.ok(match);
 const expected=createHmac('sha256',line.signing_secret).update(`${match[1]}.${raw}`).digest('hex');assert.ok(timingSafeEqual(Buffer.from(expected),Buffer.from(match[2])));assert.equal(req.headers.get('authorization'),`Bearer ${line.api_key}`);assert.equal(req.method,'POST');
 const target=lead.details.is_group?lead.details.group_chat_guid:lead.number;
 assert.equal(new URL(req.url).pathname,`/api/v1/chats/${target}/mark-read`);assert.deepEqual(JSON.parse(raw),{to:target});deviceRequests.push({target});return Response.json(nativeBody,{status:nativeStatus});
}});
line.server_url=`http://127.0.0.1:${device.port}`;
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1');if(url.port===String(device.port)){deviceAttempts++;if(unreachable)throw new Error('fixture-private-transport-secret');}return originalFetch(input,init);};
const {POST}=await import(resolve(app,'app/api/v1/chats/[id]/mark-read/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>POST(new NextRequest(req),{params:Promise.resolve({id:new URL(req.url).pathname.split('/').at(-2)})})});
async function call(id='chat-a'){const response=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/chats/${id}/mark-read`,{method:'POST',headers:{authorization:'Bearer fixture-chert'}});return{status:response.status,body:await response.json()};}
function valid(){return{ok:true,chat_id:lead.number,chat_guid:`iMessage;-;${lead.number}`,marked:2,strategy:'_automation_markAsRead:messageGUID:forChatGUID:fromMe:'};}
try{
 nativeBody={...valid(),chat_id:'+15550000009'};assert.equal((await call()).status,502,'mismatched acknowledgement must never succeed');
 nativeBody=valid();let result=await call();assert.equal(result.status,200);assert.equal(result.body.chat_id,'chat-a');assert.equal(result.body.applied,true);assert.equal(result.body.read_at,undefined);
 nativeBody={...valid(),chat_guid:`any;-;${lead.number}`};result=await call();assert.equal(result.status,200,'exact Tahoe DM ACK is valid');assert.equal(result.body.applied,true);
 nativeBody={...valid(),chat_guid:`any;-;${lead.number}`,marked:0,reason:'no unread inbound messages'};assert.equal((await call()).status,200);
 result=await call('convo-a');assert.equal(result.status,200);assert.equal(result.body.chat_id,'chat-a');
 nativeBody={...valid(),marked:0,reason:'no unread inbound messages'};assert.equal((await call()).status,200);
 nativeBody={...valid(),marked:-1,strategy:'markAllMessagesAsRead'};assert.equal((await call()).status,200);
 nativeBody={...valid(),marked:10000};assert.equal((await call()).status,200);
 const bad=[{ok:false},{ok:1},{success:false},{chat_guid:undefined},{marked:-2},{marked:1.5},{marked:'2'},{marked:10001},{marked:0,reason:undefined},{marked:-1,strategy:'invented-selector'},{strategy:'invented-selector'},{chat_guid:'iMessage;-;+15550000009'},{chat_guid:'any;-;+15550000009'},{chat_guid:`any;+;${lead.number}`},{chat_guid:`SMS;-;${lead.number}`},{chat_guid:`RCS;-;${lead.number}`},{chat_guid:`any;-;${lead.number}/extra`},{error:'fixture-private-device-error'}];
 for(const patch of bad){nativeBody={...valid(),...patch};result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));}
 nativeBody=null;result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);
 nativeBody={error:'fixture-private-device-error'};nativeStatus=500;result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));nativeStatus=501;result=await call();assert.equal(result.status,501);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));nativeStatus=200;
 unreachable=true;result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));unreachable=false;
 const before=deviceAttempts;
 lead.project_id='foreign';assert.equal((await call()).status,404);lead.project_id='project-a';
 lead.messaging_tenant_id='foreign';assert.equal((await call()).status,404);lead.messaging_tenant_id=tenant.id;
 line.project_id='foreign';assert.equal((await call()).status,422);line.project_id='project-a';
 tenant.phone_line_id='foreign';assert.equal((await call()).status,422);tenant.phone_line_id='line-a';
 assert.equal(deviceAttempts,before,'ownership refusals precede forwarding');
 lead.details.is_group=true;lead.details.group_chat_guid='iMessage;+;group-fixture';nativeBody={ok:true,chat_id:lead.details.group_chat_guid,chat_guid:lead.details.group_chat_guid,marked:0,reason:'no unread inbound messages'};result=await call();assert.equal(result.status,200);assert.equal(result.body.applied,true);
 nativeBody={...nativeBody,chat_guid:'iMessage;+;wrong-group'};assert.equal((await call()).status,502);
 lead.details.is_group=false;delete lead.details.group_chat_guid;nativeBody=valid();
 const sdk=new Linq({apiKey:'unused-provider-key',chert:{baseURL:`http://127.0.0.1:${cloud.port}`,apiKey:'fixture-chert'}});
 const beforeSDK=deviceAttempts;const sdkAck=await sdk.chats.markAsRead('chat-a').withResponse();assert.equal(sdkAck.response.status,204);assert.equal(sdkAck.data,null);assert.equal(deviceAttempts,beforeSDK+1);
 nativeBody={...valid(),chat_id:'+15550000009'};
 await assert.rejects(async()=>sdk.chats.markAsRead('chat-a'),error=>error.status===502);assert.equal(deviceAttempts,beforeSDK+2,'bad SDK acknowledgement never retries the device mutation');
 console.log(JSON.stringify({passed:true,deviceRequests:deviceRequests.length,deviceAttempts,liveReadChanges:0,cases:38}));
}finally{cloud.stop(true);device.stop(true);globalThis.fetch=originalFetch;}
