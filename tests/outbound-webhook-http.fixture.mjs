import {isDeepStrictEqual} from 'node:util';
// Real signed outbound-observation ingest, dispatcher and notifier. DB boundary only.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'outbound-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tables={phone_lines:[],leads:[],messaging_tenants:[],convo:[],tenant_webhook_subscriptions:[],messaging_events:[],webhook_event_dedup:[],messaging_send_events:[]};
for(const suffix of ['a','b']){tables.phone_lines.push({id:`line-${suffix}`,project_id:`project-${suffix}`,webhook_subscription_id:`sub-${suffix}`,signing_secret:`native-${suffix}`,sms_fallback_enabled:false,status:'active'});tables.leads.push({id:`lead-${suffix}`,project_id:`project-${suffix}`,convo_id:`convo-${suffix}`,number:'+15555550123',messaging_tenant_id:`tenant-${suffix}`,details:{phone_line_id:`line-${suffix}`}});tables.messaging_tenants.push({id:`tenant-${suffix}`,crm_project_id:`project-${suffix}`,phone_line_id:`line-${suffix}`,is_active:true,webhook_url:null,webhook_secret:null});tables.convo.push({id:`convo-${suffix}`,lead_id:`lead-${suffix}`,messages:[{id:`message-${suffix}`,guid:`guid-${suffix}`,role:'assistant',content:'actual outbound'}]});}
let mutations=0,callbacks=0,receiverStatus=204,dbFailure=false,cases=0,dispatchErrors=0,fallbackChecks=0;
class Query{
 constructor(table){this.table=table;this.filters=[];}
 select(columns){this.columns=columns;return this;}eq(k,v){if(k==='delivery_attempts'){const expected=typeof v==='string'?JSON.parse(v):v;this.filters.push(r=>isDeepStrictEqual(r[k],expected));}else this.filters.push(r=>r[k]===v);return this;}limit(n){this.cap=n;return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
 or(filter){const entries=filter.split(',').map(term=>term.split('.eq.'));this.filters.push(r=>entries.some(([k,v])=>(k==='details->>sent_to_number'?r.details?.sent_to_number:r[k])===v));return this;}
 filter(column,op,value){if(op==='eq')return this.eq(column,value);assert.equal(op,'cs');const pattern=JSON.parse(value);const contains=(a,b)=>Array.isArray(b)?Array.isArray(a)&&b.every(v=>a.some(x=>contains(x,v))):b&&typeof b==='object'?a&&typeof a==='object'&&Object.entries(b).every(([k,v])=>contains(a[k],v)):a===b;this.filters.push(r=>contains(r[column],pattern));return this;}
 insert(value){this.inserted={id:`${this.table}-${tables[this.table].length}`,...(this.table==='messaging_events'?{delivery_attempts:[]}:{}),...value};return this;}update(patch){this.patch=patch;return this;}
 then(yes,no){try{if(this.table==='phone_lines'&&this.columns?.includes('sms_fallback_enabled'))fallbackChecks++;if(dbFailure&&this.table==='messaging_send_events')return Promise.resolve({data:null,error:{message:'fixture failure'}}).then(yes,no);let rows=tables[this.table].filter(r=>this.filters.every(f=>f(r)));if(this.inserted){if(['messaging_events','webhook_event_dedup'].includes(this.table)&&tables[this.table].some(r=>r.event_id===this.inserted.event_id&&(this.table!=='messaging_events'||r.tenant_id===this.inserted.tenant_id)))return Promise.resolve({data:null,error:{code:'23505',message:'duplicate key'}}).then(yes,no);tables[this.table].push(this.inserted);rows=[this.inserted];}if(this.cap)rows=rows.slice(0,this.cap);if(this.patch){if(this.table==='messaging_send_events')mutations+=rows.length;rows.forEach(r=>Object.assign(r,this.patch));}return Promise.resolve({data:this.one?rows[0]??null:rows,error:null,count:rows.length}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
const db={from:t=>new Query(t),rpc:async(name,args)=>{assert.equal(name,'replace_convo_messages');const row=tables.convo.find(r=>r.id===args.p_convo_id);assert.ok(row);row.messages=args.p_messages;mutations++;return{data:null,error:null};}};
mock.module(resolve(app,'lib/supabase-server.ts'),()=>({createServerSupabase:()=>db}));mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const originalError=console.error;console.error=(...args)=>{assert.equal(args[0],'[imessage/inbound] dispatch error:');dispatchErrors++;};
const originalFetch=globalThis.fetch;let ingestOrigin,receiverOrigin;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([ingestOrigin,receiverOrigin].includes(url.origin));return originalFetch(input,{...init,redirect:'error'});};
const received=[];
const receiver=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){const raw=await request.text();const signature=request.headers.get('x-chert-signature');const [,ts,mac]=signature.split(',');assert.equal(mac,createHmac('sha256','callback-secret').update(`${ts}.${raw}`).digest('hex'));const payload=JSON.parse(raw);assert.ok(tables.messaging_events.some(r=>r.event_id===payload.event_id),'event durable before delivery');received.push(payload);callbacks++;return new Response(null,{status:receiverStatus});}});receiverOrigin=receiver.url.origin;
for(const suffix of ['a','b'])tables.tenant_webhook_subscriptions.push({id:`callback-${suffix}`,tenant_id:`tenant-${suffix}`,url:receiverOrigin,secret:'callback-secret',events:[],version:'2026-04-01',is_active:true,consecutive_failures:0});
const {POST}=await import(resolve(app,'app/api/imessage/inbound/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const ingest=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>POST(new NextRequest(r))});ingestOrigin=ingest.url.origin;
const guidA='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',guidB='BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
for(const [suffix,guid] of [['a',guidA],['b',guidB]]){
 tables.convo.find(r=>r.id===`convo-${suffix}`).messages=[{id:`recorded-${suffix}`,guid,role:'assistant',content:'actual outbound'}];
 tables.messaging_send_events.push({id:`send-${suffix}`,tenant_id:`tenant-${suffix}`,phone_line_id:`line-${suffix}`,lead_id:`lead-${suffix}`,convo_id:`convo-${suffix}`,phone:'+15555550123',message_guid:guid,status:'processing',request_payload:{message:{parts:[{type:'text',value:'actual outbound'}]}},response_payload:{status:'queued',mac_message_guids:[guid]}});
}
async function send(id,guid=guidA,{type='message_sent_observed',line='a',...patch}={}){cases++;const payload={type,event_id:`native:${id}`,phone_line_id:'forged',ts:1792195200,message:{guid,recipient:'+15555550123',text:'actual outbound',error_code:5000},...patch};const body=JSON.stringify(payload),ts=Math.floor(Date.now()/1000),mac=createHmac('sha256',`native-${line}`).update(`${ts}.${body}`).digest('hex');return fetch(ingestOrigin,{method:'POST',headers:{'x-webhook-subscription-id':`sub-${line}`,'x-webhook-signature':`t=${ts},v1=${mac}`},body});}
try{
 const foreign=JSON.stringify(tables.messaging_send_events[1]);assert.equal((await send('foreign',guidB,{type:'message_failed'})).status,200);assert.equal(JSON.stringify(tables.messaging_send_events[1]),foreign);assert.equal(mutations,0);assert.equal(callbacks,0);
 assert.equal((await send('valid')).status,200);assert.equal(callbacks,1);assert.equal(mutations,0);assert.equal(tables.messaging_send_events[0].status,'processing');
 const delivered=received.at(-1);assert.equal(delivered.chat_id,'lead-a');assert.equal(delivered.message_id,'send-a');assert.equal(delivered.observation.source_event_type,'message_sent_observed');assert.equal(delivered.observation.native_guid,guidA);assert.equal(delivered.observation.recipient,'+15555550123');assert.equal(delivered.observation.error_code,5000);assert.equal(delivered.status,undefined);assert.equal(delivered.delivered,undefined);
 assert.equal((await send('valid')).status,200);assert.equal(callbacks,1);
 receiverStatus=400;assert.equal((await send('callback-retry')).status,500);receiverStatus=204;assert.equal((await send('callback-retry')).status,200);assert.equal(callbacks,3);
 tables.messaging_send_events.push({...tables.messaging_send_events[0],id:'ambiguous-send'});assert.equal((await send('ambiguous')).status,500);tables.messaging_send_events.pop();assert.equal(callbacks,3);
 assert.equal((await send('unmatched','CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC')).status,200);assert.equal(callbacks,3);
 for(const ts of [null,-1,1e30,'1792195200'])assert.equal((await send(`invalid-${String(ts)}`,guidA,{ts})).status,ts===1e30?500:200);assert.equal(callbacks,3);
 tables.messaging_tenants[0].is_active=false;assert.equal((await send('inactive')).status,200);tables.messaging_tenants[0].is_active=true;assert.equal(callbacks,3);
 tables.leads[0].details.phone_line_id='line-b';assert.equal((await send('pin')).status,500);tables.leads[0].details.phone_line_id='line-a';assert.equal(callbacks,3);
 tables.messaging_send_events[0].request_payload.message.parts.push({type:'text',value:'second bubble'});assert.equal((await send('compound-failure',guidA,{type:'message_failed'})).status,200);assert.equal(mutations,0);assert.equal(tables.messaging_send_events[0].status,'processing');tables.messaging_send_events[0].request_payload.message.parts.pop();assert.equal(callbacks,4);
 assert.equal((await send('failed',guidA,{type:'message_failed'})).status,200);assert.equal(mutations,1);assert.equal(tables.messaging_send_events[0].status,'failed');assert.equal(callbacks,5);
 const fallbackBefore=fallbackChecks;receiverStatus=400;
 assert.equal((await send('failed-callback-retry',guidA,{type:'message_failed',message:{guid:guidA,recipient:'+15555550123',text:'actual outbound',error_code:4001}})).status,500);assert.equal(fallbackChecks,fallbackBefore+1,'disabled fallback evaluated before failed customer callback');
 receiverStatus=204;assert.equal((await send('failed-callback-retry',guidA,{type:'message_failed',message:{guid:guidA,recipient:'+15555550123',text:'actual outbound',error_code:4001}})).status,200);assert.equal(fallbackChecks,fallbackBefore+2);assert.equal(callbacks,7);
 tables.messaging_send_events[0].status='processing';
 const beforeBadFailure=mutations;
 for(const patch of [{error_code:undefined},{error_code:0},{error_code:'5000'},{error_code:1.2},{error_code:5000,status:'sent'},{error_code:5000,delivered:true},{error_code:5000,success:true},{error_code:5000,delivery:{isSent:true}}]){
  assert.equal((await send(`bad-failure-${cases}`,guidA,{type:'message_failed',message:{guid:guidA,recipient:'+15555550123',text:'actual outbound',...patch}})).status,200);assert.equal(mutations,beforeBadFailure);assert.equal(tables.messaging_send_events[0].status,'processing');
 }
 tables.messaging_send_events[0].message_guid=null;tables.messaging_send_events[0].response_payload.mac_message_guids=[guidA];assert.equal((await send('mac-guid')).status,200);assert.equal(callbacks,16);
 tables.messaging_send_events[0].response_payload={status:'queued',mac_bridge_outbox_ids:['msg_exact'],mac_message_guids:[guidA]};assert.equal((await send('bridge-failed','msg_exact',{type:'message_failed'})).status,200);assert.equal(callbacks,17);
 const oldCount=callbacks,oldFallback=fallbackChecks;assert.equal((await send('native-owned','msg_exact',{type:'message_failed',message:{guid:'msg_exact',recipient:'+15555550123',fallback_owner:'native',error_code:4104}})).status,200);assert.equal(callbacks,oldCount);assert.equal(fallbackChecks,oldFallback);
 const savedRow=structuredClone(tables.messaging_send_events[0]);
 tables.messaging_send_events[0].response_payload={spectrum_message_guid:guidA};assert.equal((await send('legacy-spectrum')).status,200);assert.equal(callbacks,18);
 tables.messaging_send_events[0].response_payload={mac_message_guids:[guidA,guidB]};const beforeCompound=mutations;
 assert.equal((await send('multiple-guid-failure',guidA,{type:'message_failed'})).status,200);assert.equal(mutations,beforeCompound);assert.equal(callbacks,19);
 tables.messaging_send_events[0].phone='+15555550000';assert.equal((await send('bad-ledger-peer')).status,500);tables.messaging_send_events[0].phone=savedRow.phone;assert.equal(callbacks,19);
 tables.messaging_send_events[0].convo_id='convo-b';assert.equal((await send('bad-ledger-convo')).status,500);tables.messaging_send_events[0].convo_id=savedRow.convo_id;assert.equal(callbacks,19);
 dbFailure=true;assert.equal((await send('lookup-retry')).status,500);dbFailure=false;assert.equal((await send('lookup-retry')).status,200);assert.equal(callbacks,20);
 assert.equal((await send('delivered-observation',guidA,{type:'message_delivered'})).status,200);assert.equal(received.at(-1).observation.source_event_type,'message_delivered');assert.equal(received.at(-1).delivered,undefined);assert.equal(mutations,beforeCompound);assert.equal(callbacks,21);
 tables.messaging_send_events.length=0;assert.equal((await send('convo-only')).status,200);assert.equal(received.at(-1).message_id,'recorded-a');assert.equal(callbacks,22);
 assert.equal((await send('same-public-event',guidA)).status,200);assert.equal((await send('same-public-event',guidB,{line:'b'})).status,200);assert.notEqual(received.at(-1).event_id,received.at(-2).event_id);assert.equal(received.at(-1).chat_id,'lead-b');assert.equal(callbacks,24);
 tables.leads[0].details.sent_to_number='+15555550999';
 assert.equal((await send('override-valid',guidA,{message:{guid:guidA,recipient:'+15555550999'}})).status,200);assert.equal(callbacks,25);
 assert.equal((await send('override-stale-original')).status,200);assert.equal(callbacks,25);
 receiverStatus=400;assert.equal((await send('snapshot-retry',guidA,{message:{guid:guidA,recipient:'+15555550999'}})).status,500);
 const snapshot=tables.messaging_events.at(-1);assert.equal(snapshot.payload.observation.recipient,'+15555550999');const beforeConflictingRetry=callbacks;
 receiverStatus=204;tables.leads[0].details.sent_to_number='+15555550888';
 assert.equal((await send('snapshot-retry',guidA,{message:{guid:guidA,recipient:'+15555550888'}})).status,500);assert.equal(callbacks,beforeConflictingRetry);assert.equal(snapshot.payload.observation.recipient,'+15555550999');
 tables.leads[0].details.sent_to_number='+15555550999';assert.equal((await send('snapshot-retry',guidA,{message:{guid:guidA,recipient:'+15555550999'}})).status,200);assert.equal(callbacks,beforeConflictingRetry+1);
 // Frozen accepted recipient remains authoritative after mutable CRM contact edits.
 tables.messaging_send_events.push({...savedRow,message_guid:guidA,response_payload:{status:'queued',mac_message_guids:[guidA]}});
 tables.leads[0].number='+15555550777';tables.leads[0].details.sent_to_number='+15555550666';
 assert.equal((await send('frozen-old-recipient')).status,200);assert.equal(callbacks,28);assert.equal(received.at(-1).message_id,'send-a');assert.equal(received.at(-1).observation.recipient,'+15555550123');
 receiverStatus=400;assert.equal((await send('frozen-retry')).status,500);const frozenPayload=structuredClone(received.at(-1));
 tables.leads[0].number='+15555550555';tables.leads[0].details.sent_to_number='+15555550444';receiverStatus=204;
 assert.equal((await send('frozen-retry')).status,200);assert.deepEqual(received.at(-1),frozenPayload);assert.equal(callbacks,30);
 assert.equal((await send('frozen-wrong-new-peer',guidA,{message:{guid:guidA,recipient:'+15555550444'}})).status,500);assert.equal(callbacks,30);
 const beforeMalformedFailure=mutations;
 for(const patch of [{success:'true'},{ok:{}},{delivered:{}},{status:'queued'},{delivery:{isSent:'false'}},{delivery:{isDelivered:null}},{delivery:{error:0}},{delivery:{error:'5000'}}]){
  assert.equal((await send(`malformed-failure-${cases}`,guidA,{type:'message_failed',message:{guid:guidA,recipient:'+15555550123',error_code:5000,...patch}})).status,200);
  assert.equal(mutations,beforeMalformedFailure);
 }
 // An unknown send-record conversation must not become mutable contact metadata.
 tables.messaging_send_events[0].convo_id=null;receiverStatus=400;
 assert.equal((await send('unknown-convo-retry')).status,500);
 const unknownConvoEvent=tables.messaging_events.at(-1);assert.equal(unknownConvoEvent.convo_id,null);
 tables.leads[0].convo_id='later-contact-conversation';receiverStatus=204;
 assert.equal((await send('unknown-convo-retry')).status,200);
 assert.equal(tables.messaging_events.at(-1).id,unknownConvoEvent.id);assert.equal(unknownConvoEvent.convo_id,null);
 const cardinalityRow=tables.messaging_send_events[0],beforeCardinality=mutations,beforeCardinalityFallback=fallbackChecks;
 for(const [request,response] of [
  [{body:'one'},{}],
  [{body:'one'},{mac_bridge_outbox_ids:['msg_cardinality']}],
  [{message:{parts:[{type:'text',value:'one\n\ntwo'}]}},{mac_message_guids:[guidA]}],
  [{body:'one\n\ntwo'},{mac_message_guids:[guidA]}],
  [{message:{parts:[{type:'text',value:'one',text:'other'}]}},{mac_message_guids:[guidA]}],
  [{message:{parts:[{type:'text',value:17}]}},{mac_message_guids:[guidA]}],
 ]){
  cardinalityRow.request_payload=request;cardinalityRow.response_payload=response;
  assert.equal((await send(`unknown-cardinality-${cases}`,guidA,{type:'message_failed',message:{guid:guidA,recipient:'+15555550123',text:'one',error_code:4001}})).status,200);
  assert.equal(mutations,beforeCardinality);assert.equal(fallbackChecks,beforeCardinalityFallback);
 }
 console.log(JSON.stringify({passed:true,cases,mutations,callbacks,dispatchErrors,fallbackChecks,deviceRequests:0,liveMessages:0}));
}finally{ingest.stop(true);receiver.stop(true);console.error=originalError;}
