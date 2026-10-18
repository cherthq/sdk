// Real signed inbound HTTP handler, dispatcher, conversation RPC helper and notifier. DB boundary only.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'receipt-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const GUID='12345678-1234-4234-8234-123456789abc';
const OTHER='87654321-4321-4321-8321-cba987654321';
const PEER='+15555550123';
const tables={phone_lines:[],leads:[],messaging_tenants:[],convo:[],messaging_send_events:[],tenant_webhook_subscriptions:[],messaging_events:[],webhook_event_dedup:[]};
function reset(){
 for(const key of Object.keys(tables))tables[key].length=0;
 for(const suffix of ['a','b']){
  tables.phone_lines.push({id:`line-${suffix}`,project_id:`project-${suffix}`,webhook_subscription_id:`sub-${suffix}`,signing_secret:`native-${suffix}`});
  tables.leads.push({id:`lead-${suffix}`,project_id:`project-${suffix}`,convo_id:`current-${suffix}`,number:'+15555550999',messaging_tenant_id:`tenant-${suffix}`,details:{phone_line_id:`line-${suffix}`,sent_to_number:'+15555550888'}});
  tables.messaging_tenants.push({id:`tenant-${suffix}`,crm_project_id:`project-${suffix}`,phone_line_id:`line-${suffix}`,is_active:true,webhook_url:null,webhook_secret:null});
  tables.convo.push({id:`frozen-${suffix}`,lead_id:`lead-${suffix}`,messages:[{id:`old-native-${suffix}`,guid:suffix==='a'?GUID:OTHER,role:'assistant',content:'actual native outbound'}]});
  tables.convo.push({id:`current-${suffix}`,lead_id:`lead-${suffix}`,messages:[]});
  tables.messaging_send_events.push({id:`public-send-${suffix}`,tenant_id:`tenant-${suffix}`,lead_id:`lead-${suffix}`,phone_line_id:`line-${suffix}`,phone:PEER,convo_id:`frozen-${suffix}`,message_guid:null,request_payload:{body:'one actual bubble'},response_payload:{mac_message_guids:[suffix==='a'?GUID:OTHER]}});
  if(typeof receiverOrigin==='string')tables.tenant_webhook_subscriptions.push({id:`callback-${suffix}`,tenant_id:`tenant-${suffix}`,url:receiverOrigin,secret:'callback-secret',version:'2026-04-01',events:['read_receipt','message_outbound_observed'],is_active:true,consecutive_failures:0});
 }
}
let mutations=0,callbacks=0,receiverStatus=204,dbFailure=false,cases=0,dispatchErrors=0;
class Query{
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}neq(k,v){this.filters.push(r=>r[k]!==v);return this;}eq(k,v){this.filters.push(r=>k==='delivery_attempts'?JSON.stringify(r[k])===v:r[k]===v);return this;}limit(n){this.cap=n;return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
 or(filter){const entries=filter.split(',').map(term=>term.split('.eq.'));this.filters.push(r=>entries.some(([k,v])=>r[k]===v));return this;}
 filter(column,op,value){
  if(op==='eq')return this.eq(column,value);
  assert.equal(op,'cs');const wanted=JSON.parse(value);
  const contains=(actual,expected)=>Array.isArray(expected)?Array.isArray(actual)&&expected.every(item=>actual.some(part=>contains(part,item))):expected&&typeof expected==='object'?actual&&typeof actual==='object'&&Object.entries(expected).every(([key,value])=>contains(actual[key],value)):actual===expected;
  this.filters.push(row=>contains(row[column],wanted));return this;
 }
 insert(value){this.inserted={id:`${this.table}-${tables[this.table].length}`,...(this.table==='messaging_events'?{created_at:'2026-10-17T00:00:00Z',delivery_attempts:[]}:{}),...value};return this;}update(patch){this.patch=patch;return this;}
 then(yes,no){try{if(dbFailure&&this.table==='convo')return Promise.resolve({data:null,error:{message:'fixture failure'}}).then(yes,no);let rows=tables[this.table].filter(r=>this.filters.every(f=>f(r)));if(this.inserted){if(['messaging_events','webhook_event_dedup'].includes(this.table)&&tables[this.table].some(r=>r.event_id===this.inserted.event_id&&(this.table!=='messaging_events'||r.tenant_id===this.inserted.tenant_id)))return Promise.resolve({data:null,error:{code:'23505',message:'duplicate key'}}).then(yes,no);tables[this.table].push(this.inserted);rows=[this.inserted];}if(this.cap)rows=rows.slice(0,this.cap);if(this.patch)rows.forEach(r=>Object.assign(r,this.patch));return Promise.resolve({data:structuredClone(this.one?rows[0]??null:rows),error:null,count:rows.length}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
const db={from:t=>new Query(t),rpc:async(name,args)=>{assert.equal(name,'replace_convo_messages');const row=tables.convo.find(r=>r.id===args.p_convo_id);assert.ok(row);row.messages=args.p_messages;mutations++;return{data:null,error:null};}};
mock.module(resolve(app,'lib/supabase-server.ts'),()=>({createServerSupabase:()=>db}));mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const originalError=console.error;console.error=(...args)=>{assert.equal(args[0],'[imessage/inbound] dispatch error:');dispatchErrors++;};
const originalFetch=globalThis.fetch;let ingestOrigin,receiverOrigin;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([ingestOrigin,receiverOrigin].includes(url.origin));return originalFetch(input,{...init,redirect:'error'});};
const received=[];
const receiver=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){const raw=await request.text();const signature=request.headers.get('x-chert-signature');const [,ts,mac]=signature.split(',');assert.equal(mac,createHmac('sha256','callback-secret').update(`${ts}.${raw}`).digest('hex'));const payload=JSON.parse(raw);assert.ok(tables.messaging_events.some(r=>r.event_id===payload.event_id),'event durable before delivery');received.push(payload);callbacks++;return new Response(null,{status:receiverStatus});}});receiverOrigin=receiver.url.origin;
reset();

const {POST}=await import(resolve(app,'app/api/imessage/inbound/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const ingest=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>POST(new NextRequest(r))});ingestOrigin=ingest.url.origin;
async function send(id,guid=GUID,patch={},line='a'){cases++;const payload={type:'read_receipt',event_id:`read:${id}`,phone_line_id:'forged',recipient_phone:'+15555550123',target_message_guid:guid,read_at:1792195200,ts:1792195200,...patch};const body=JSON.stringify(payload),ts=Math.floor(Date.now()/1000),mac=createHmac('sha256',`native-${line}`).update(`${ts}.${body}`).digest('hex');return fetch(ingestOrigin,{method:'POST',headers:{'x-webhook-subscription-id':`sub-${line}`,'x-webhook-signature':`t=${ts},v1=${mac}`},body});}
try{
 const callBefore=()=>received.length;
 const owned=()=>tables.messaging_send_events[0];
 const frozen=()=>tables.convo.find(row=>row.id==='frozen-a');
 const assertQuiet=async(id,mutate,patch={},line='a')=>{
  reset();mutate?.();const before=JSON.stringify(tables.convo),count=callBefore();
  const response=await send(id,GUID,patch,line);
  assert.ok([200,500].includes(response.status));assert.equal(callBefore(),count);assert.equal(JSON.stringify(tables.convo),before);
 };
 reset();
 assert.equal((await send('ledger-edited-contact')).status,200);
 assert.equal(received.at(-1).message_id,'public-send-a');assert.equal(received.at(-1).chat_id,'lead-a');
 assert.equal(received.at(-1).read_at,'2026-10-17T00:00:00.000Z');
 assert.equal(frozen().messages[0].read_at,1792195200);assert.equal(tables.convo.find(r=>r.id==='current-a').messages.length,0);
 let count=callBefore(),writes=mutations;assert.equal((await send('ledger-edited-contact')).status,200);assert.equal(callBefore(),count);assert.equal(mutations,writes);
 reset();owned().convo_id=null;count=callBefore();writes=mutations;
 assert.equal((await send('ledger-no-convo')).status,200);assert.equal(callBefore(),count+1);assert.equal(mutations,writes);assert.equal(received.at(-1).message_id,'public-send-a');
 reset();tables.convo=tables.convo.filter(row=>row.id!=='frozen-a');count=callBefore();
 assert.equal((await send('ledger-missing-convo')).status,200);assert.equal(callBefore(),count+1);
 await assertQuiet('foreign-ledger',()=>{owned().tenant_id='tenant-b';});
 await assertQuiet('foreign-line',()=>{owned().phone_line_id='line-b';});
 await assertQuiet('wrong-pin',()=>{tables.leads[0].details.phone_line_id='line-b';});
 await assertQuiet('wrong-tenant-project',()=>{tables.messaging_tenants[0].crm_project_id='project-b';});
 await assertQuiet('wrong-ledger-peer',()=>{owned().phone='+15555550777';});
 await assertQuiet('wrong-event-peer',null,{recipient_phone:'+15555550666'});
 await assertQuiet('wrong-guid',()=>{owned().response_payload.mac_message_guids=[OTHER];});
 await assertQuiet('wrong-convo-owner',()=>{frozen().lead_id='lead-b';});
 await assertQuiet('inactive',()=>{tables.messaging_tenants[0].is_active=false;});
 await assertQuiet('signed-other-line',null,{},'b');
 reset();owned().response_payload.mac_message_guids=[GUID,OTHER];owned().request_payload={body:'first\n\nsecond'};count=callBefore();writes=mutations;
 assert.equal((await send('compound')).status,200);assert.equal(callBefore(),count+1);assert.equal(mutations,writes);
 assert.equal(frozen().messages[0].read_at,undefined);assert.equal(received.at(-1).event,'message_outbound_observed');assert.equal(received.at(-1).observation.identity_scope,'native_message');assert.equal(received.at(-1).observation.native_guid,GUID);
 reset();owned().message_guid=GUID;owned().response_payload={};count=callBefore();
 assert.equal((await send('incomplete-then-complete')).status,500);assert.equal(callBefore(),count);
 assert.equal(tables.webhook_event_dedup.some(row=>row.event_id.includes('incomplete-then-complete')),false);
 owned().response_payload={mac_message_guids:[GUID]};assert.equal((await send('incomplete-then-complete')).status,200);assert.equal(callBefore(),count+1);
 reset();dbFailure=true;count=callBefore();assert.equal((await send('ledger-db-retry')).status,500);assert.equal(callBefore(),count);dbFailure=false;assert.equal((await send('ledger-db-retry')).status,200);assert.equal(callBefore(),count+1);
 reset();receiverStatus=400;count=callBefore();assert.equal((await send('ledger-callback-retry')).status,500);assert.equal(callBefore(),count+1);assert.equal(tables.webhook_event_dedup.length,0);receiverStatus=204;
 assert.equal((await send('ledger-callback-retry')).status,200);assert.equal(callBefore(),count+2);
 // Current native receipt identity is recoverable before any cloud ledger commit.
 reset();tables.leads[0].number=PEER;tables.leads[0].details.sent_to_number=PEER;
 const delayedLedger=structuredClone(owned());tables.messaging_send_events.length=0;
 for(const row of tables.convo)row.messages=[];
 const readMs=1792195200123,nativeId=`read:rr:${GUID}:${readMs}`;
 const nativePatch={event_id:nativeId,read_at:Math.floor(readMs/1000),ts:Math.floor(readMs/1000)};
 count=callBefore();writes=mutations;
 assert.equal((await send('strict-before-ledger',GUID,nativePatch)).status,500);
 assert.equal(callBefore(),count);assert.equal(mutations,writes);assert.equal(tables.messaging_events.length,0);assert.equal(tables.webhook_event_dedup.length,0);
 tables.messaging_send_events.push(delayedLedger);
 assert.equal((await send('strict-after-ledger',GUID,nativePatch)).status,200);assert.equal(callBefore(),count+1);
 assert.equal(received.at(-1).message_id,delayedLedger.id);
 assert.equal((await send('strict-repeated',GUID,nativePatch)).status,200);assert.equal(callBefore(),count+1);
 // Synthetic unknown legacy identities are not treated as proof of a pending native receipt.
 reset();tables.leads[0].number=PEER;tables.leads[0].details.sent_to_number=PEER;tables.messaging_send_events.length=0;
 for(const row of tables.convo)row.messages=[];
 count=callBefore();assert.equal((await send('legacy-unknown',OTHER)).status,200);assert.equal(callBefore(),count);
 for(const [name,change] of [
  ['inbound-role',message=>{message.role='user';}],
  ['conflicting-alias',message=>{message.spectrum_message_guid=OTHER;}],
 ]){
  reset();change(frozen().messages[0]);count=callBefore();writes=mutations;
  assert.equal((await send(`ledger-${name}`)).status,500);
  assert.equal(callBefore(),count);assert.equal(mutations,writes);assert.equal(tables.messaging_events.length,0);assert.equal(tables.webhook_event_dedup.length,0);
 }
 console.log(JSON.stringify({passed:true,cases,mutations,callbacks,dispatchErrors,deviceRequests:0,liveMessages:0}));
}finally{ingest.stop(true);receiver.stop(true);console.error=originalError;}
