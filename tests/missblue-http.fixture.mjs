// Actual Miss Blue adapter -> ChertClient HTTP -> actual auth/routes/reservation/HMAC.
// Explicit fake Supabase query storage and fake loopback native server; NOT PG/device proof.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import {createMissBlueFetch} from '../packages/missblue-adapter/index.ts';
const root=process.env.CHERT_MONOREPO_ROOT?resolve(process.env.CHERT_MONOREPO_ROOT):resolve(import.meta.dir,'../..');
const app=resolve(root,'imessage-server');
await plugin({name:'missblue-actual-routes',setup(build){
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:'platform',namespace:'missblue-next'}));
 build.onLoad({filter:/.*/,namespace:'missblue-next'},()=>({contents:`export {NextRequest} from ${JSON.stringify(resolve(root,'control-plane/node_modules/next/dist/server/web/spec-extension/request.js'))};export {NextResponse} from ${JSON.stringify(resolve(root,'control-plane/node_modules/next/dist/server/web/spec-extension/response.js'))};`,loader:'js'}));
}});
const {textOperationFingerprint}=await import(resolve(app,'lib/sending/text-operation-fingerprint.ts'));
const tenant={id:'21000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-tenant-key',crm_project_id:'project-a',is_active:true,auto_create_leads:false,requires_tenant_header:false};
const line={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15558670001',project_id:'project-a',status:'active',health_status:'healthy',server_url:'',api_key:'device-key',signing_secret:'device-signing'};
const inactive={...line,id:'21000000-0000-4000-8000-000000000012',phone_number:'+15558670003',status:'inbound_only'};
const lead={id:'21000000-0000-4000-8000-000000000021',project_id:'project-a',messaging_tenant_id:tenant.id,number:'+15558670002',name:'Fixture',convo_id:null,details:{phone_line_id:line.id},created_at:'2026-10-17T00:00:00Z'};
const tables={messaging_tenants:[tenant],phone_lines:[line,inactive,{...line,id:'21000000-0000-4000-8000-000000000099',project_id:'foreign',phone_number:'+15558670009'}],leads:[lead],messaging_send_events:[],campaigns:[],convo:[],messaging_event_journal:[],messaging_webhook_events:[]};
let cases=0,writes=0,queries=0,nativePosts=0,nativeGets=0,cloudRequests=0,dbFailure=false,mode='ack';
class Query {
 constructor(table){this.table=table;this.filters=[];this.sort=[];}
 select(){return this;}
 abortSignal(signal){assert.equal(signal.aborted,false);return this;}
 eq(k,v){this.filters.push(r=>k.startsWith('details->>')?r.details?.[k.slice(10)]===v:['response_payload','request_payload','details'].includes(k)&&typeof v==='string'?JSON.stringify(r[k])===v:r[k]===v);return this;}
 is(k,v){this.filters.push(r=>v===null?r[k]==null:r[k]===v);return this;}
 in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}
 gt(k,v){this.filters.push(r=>r[k]>v);return this;}
 filter(k,op,v){assert.equal(op,'cs');const expected=JSON.parse(v);this.filters.push(r=>r[k]&&Object.entries(expected).every(([key,value])=>r[k][key]===value));return this;}
 order(k,o){this.sort.push([k,o?.ascending!==false]);return this;}
 limit(n){this.cap=n;return this;}
 maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
 insert(v){this.inserted=structuredClone(v);return this;}
 update(v){this.updated=structuredClone(v);return this;}
 then(yes,no){try{queries++;if(dbFailure&&this.table==='phone_lines')return Promise.resolve({data:null,error:{message:'private-db-error'}}).then(yes,no);
  if(this.inserted){assert.equal(this.table,'messaging_send_events');writes++;tables.messaging_send_events.push(this.inserted);return Promise.resolve({data:{id:this.inserted.id},error:null}).then(yes,no);}
  let rows=(tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r)));
  if(this.updated){writes++;rows.forEach(r=>Object.assign(r,this.updated));}
  if(this.sort.length)rows=rows.toSorted((a,b)=>{for(const[k,asc]of this.sort){const d=String(a[k]).localeCompare(String(b[k]));if(d)return asc?d:-d;}return 0;});
  if(this.cap)rows=rows.slice(0,this.cap);
  return Promise.resolve({data:structuredClone(this.one?rows[0]??null:rows),error:null}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const raw=await req.text(),match=/^v1,(\d+),([a-f0-9]{64})$/.exec(req.headers.get('x-chert-signature')??'');assert.ok(match);assert.equal(match[2],createHmac('sha256',line.signing_secret).update(`${match[1]}.${raw}`).digest('hex'));assert.equal(req.headers.get('authorization'),'Bearer '+line.api_key);
 const url=new URL(req.url);
 if(req.method==='GET'){
  nativeGets++;assert.equal(url.pathname,'/api/v1/message-evidence/550e8400-e29b-41d4-a716-446655440000');assert.equal(url.searchParams.get('recipient'),lead.number);
  return Response.json({evidence_source:'chat_db_exact_guid',guid:'550e8400-e29b-41d4-a716-446655440000',recipient:lead.number,sender:line.phone_number,service:'imessage',is_sent:true,is_delivered:true,is_read:false,has_attachments:false,delivered_at:Date.now()-10000});
 }
 nativePosts++;assert.equal(req.method,'POST');const body=JSON.parse(raw);
 if(url.pathname==='/api/v1/text-operations/v1'){
  assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);assert.equal(body.from,line.phone_number);assert.equal(body.to,lead.number);
  const row=tables.messaging_send_events.find(r=>r.id===body.origin.slice(5));assert.ok(row,'reservation must precede native request');assert.equal(row.response_payload.mac_text_dispatch_state,'reserved');assert.equal(row.response_payload.mac_text_from,body.from);assert.equal(row.phone_line_id,line.id);assert.equal(row.tenant_id,tenant.id);assert.deepEqual(row.request_payload,{message:{parts:[{type:'text',value:body.text}]}});
  if(mode==='bad-send')return Response.json({ok:true,status:'sent'});
  return Response.json({origin:body.origin,from:body.from,to:body.to,fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:'550e8400-e29b-41d4-a716-446655440000',state:'acknowledged'},{status:202});
 }
 assert.equal(url.pathname,`/api/v1/chats/${lead.number}/typing`);assert.deepEqual(Object.keys(body).sort(),['from','isTyping','to']);assert.equal(body.from,line.phone_number);assert.equal(body.to,lead.number);assert.equal(typeof body.isTyping,'boolean');
 return Response.json({ok:true,applied:mode!=='bad-typing',chat_id:lead.number,from:line.phone_number});
}});line.server_url=native.url.origin;inactive.server_url=native.url.origin;
const inventoryRoute=await import(resolve(app,'app/api/v1/phone-numbers/route.ts'));
const sendRoute=await import(resolve(app,'app/api/v1/chats/route.ts'));
const typingRoute=await import(resolve(app,'app/api/v1/chats/[id]/typing/route.ts'));
const messageRoute=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));
const {NextRequest}=await import(resolve(root,'control-plane/node_modules/next/dist/server/web/spec-extension/request.js'));
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{
 cloudRequests++;const path=new URL(req.url).pathname;
 if(path==='/api/v1/phone-numbers')return inventoryRoute.GET(new NextRequest(req));
 if(path==='/api/v1/chats')return sendRoute.POST(new NextRequest(req));
 const typing=/^\/api\/v1\/chats\/([^/]+)\/typing$/.exec(path);
 if(typing)return typingRoute.POST(new NextRequest(req),{params:Promise.resolve({id:typing[1]})});
 const message=/^\/api\/v1\/messages\/([^/]+)$/.exec(path);assert.ok(message);
 return messageRoute.GET(new NextRequest(req),{params:Promise.resolve({id:message[1]})});
}});
const realFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([cloud.url.origin,native.url.origin].includes(url.origin),'no device/provider/external requests allowed');return realFetch(input,init);};
const adapter=(key='fixture-tenant-key')=>createMissBlueFetch({chert:{baseURL:cloud.url.origin,apiKey:key}});
const fetch=adapter(),body={number_id:line.id,recipient:lead.number,text:'  CHERT-OFFLINE-MISSBLUE / Café 🌅\r\n  '};
async function call(path,method='GET',data,client=fetch){cases++;const response=await client('https://api.missblue.dev'+path,{method,headers:{authorization:'Bearer unused-provider-key',...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,body:response.status===204?null:await response.json()};}
try{
 let before=queries;assert.equal((await call('/v1/numbers','GET',undefined,adapter('wrong'))).status,404);assert.equal(queries,before+1);assert.equal(nativePosts,0);
 const foreignScope=createMissBlueFetch({chert:{baseURL:cloud.url.origin,apiKey:'fixture-tenant-key',tenant:'foreign'}});assert.ok((await call('/v1/numbers','GET',undefined,foreignScope)).status>=400);assert.equal(nativePosts,0);
 let r=await call('/v1/numbers');assert.equal(r.status,200);assert.deepEqual(r.body,{total:2,data:[{id:line.id,handle:line.phone_number,service:'imessage',disabled:false},{id:inactive.id,handle:inactive.phone_number,service:'imessage',disabled:false}]});assert.ok(!JSON.stringify(r.body).includes('device-'));
 tenant.crm_project_id=null;r=await call('/v1/numbers');assert.deepEqual(r.body,{total:0,data:[]});tenant.crm_project_id='project-a';
 assert.equal((await call('/v1/messages','POST',body,adapter('wrong'))).status,404);assert.equal(nativePosts,0);
 assert.equal((await call('/v1/messages','POST',{...body,number_id:'21000000-0000-4000-8000-000000000099'})).status,404);assert.equal(nativePosts,0);
 assert.equal((await call('/v1/messages','POST',{...body,number_id:inactive.id})).status,501);assert.equal(nativePosts,0);
 r=await call('/v1/messages','POST',body);assert.equal(r.status,201);assert.match(r.body.id,/^[a-f0-9]{32}$/);assert.deepEqual(r.body,{id:r.body.id,chat_id:lead.id,status:'pending',queued:true});assert.equal(nativePosts,1);const id=r.body.id;assert.equal(tables.messaging_send_events[0].response_payload.mac_text_dispatch_state,'acknowledged');
 r=await call('/v1/messages/'+id);assert.equal(r.status,200);assert.equal(r.body.status,'delivered');assert.equal(r.body.text,body.text);assert.equal(r.body.number_id,line.id);assert.equal(r.body.service,'imessage');assert.equal(r.body.message_at,undefined);assert.equal(r.body.external_message_id,undefined);assert.equal(nativeGets,1);
 assert.equal((await call('/v1/messages/'+id,'GET',undefined,adapter('wrong'))).status,404);assert.equal(nativeGets,1);
 tables.messaging_send_events[0].tenant_id='foreign';assert.equal((await call('/v1/messages/'+id)).status,404);assert.equal(nativeGets,1);tables.messaging_send_events[0].tenant_id=tenant.id;
 for(const active of [true,false]){r=await call('/v1/typing','POST',{chat_id:lead.id,active});assert.equal(r.status,204);assert.equal(r.body,null);}assert.equal(nativePosts,3);
 assert.equal((await call('/v1/typing','POST',{chat_id:lead.id,active:true},adapter('wrong'))).status,404);assert.equal(nativePosts,3);
 lead.project_id='foreign';assert.equal((await call('/v1/typing','POST',{chat_id:lead.id,active:true})).status,404);lead.project_id='project-a';assert.equal(nativePosts,3);
 lead.details.phone_line_id='foreign-line';assert.ok((await call('/v1/typing','POST',{chat_id:lead.id,active:true})).status>=400);lead.details.phone_line_id=line.id;assert.equal(nativePosts,3);
 mode='bad-typing';r=await call('/v1/typing','POST',{chat_id:lead.id,active:true});assert.equal(r.status,504);assert.equal(r.body.error.code,'command_unconfirmed');assert.equal(nativePosts,4);
 mode='bad-send';r=await call('/v1/messages','POST',body);assert.equal(r.status,504);assert.equal(r.body.error.code,'command_unconfirmed');assert.equal(nativePosts,5);assert.equal(tables.messaging_send_events.at(-1).response_payload.mac_text_dispatch_state,'unconfirmed');mode='ack';
 before=cloudRequests;assert.equal((await call('/v1/messages','POST',{...body,attachment_ids:[]})).status,501);assert.equal(cloudRequests,before);
 lead.details.service='sms';assert.ok((await call('/v1/messages','POST',body)).status>=400);delete lead.details.service;assert.equal(nativePosts,5);
 dbFailure=true;assert.equal((await call('/v1/numbers')).status,504);dbFailure=false;assert.equal(nativePosts,5);
 assert.equal(tables.messaging_send_events.length,2);assert.equal(nativeGets,1);
 console.log(JSON.stringify({passed:true,cases,nativePosts,nativeGets,actualAuth:true,actualRoutes:true,actualHMAC:true,fakeDatabase:true,fakeNative:true,deviceEffects:0}));
}finally{cloud.stop(true);native.stop(true);globalThis.fetch=realFetch;}
