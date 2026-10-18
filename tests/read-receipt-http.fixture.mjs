// Real signed inbound HTTP handler, dispatcher, conversation RPC helper and notifier. DB boundary only.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'receipt-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tables={phone_lines:[],leads:[],messaging_tenants:[],convo:[],tenant_webhook_subscriptions:[],messaging_events:[],webhook_event_dedup:[]};
for(const suffix of ['a','b']){tables.phone_lines.push({id:`line-${suffix}`,project_id:`project-${suffix}`,webhook_subscription_id:`sub-${suffix}`,signing_secret:`native-${suffix}`});tables.leads.push({id:`lead-${suffix}`,project_id:`project-${suffix}`,convo_id:`convo-${suffix}`,number:'+15555550123',messaging_tenant_id:`tenant-${suffix}`,details:{phone_line_id:`line-${suffix}`}});tables.messaging_tenants.push({id:`tenant-${suffix}`,crm_project_id:`project-${suffix}`,phone_line_id:`line-${suffix}`,is_active:true,webhook_url:null,webhook_secret:null});tables.convo.push({id:`convo-${suffix}`,lead_id:`lead-${suffix}`,messages:[{id:`message-${suffix}`,guid:`guid-${suffix}`,role:'assistant',content:'actual outbound'}]});}
let mutations=0,callbacks=0,receiverStatus=204,dbFailure=false,cases=0,dispatchErrors=0;
class Query{
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}neq(k,v){this.filters.push(r=>r[k]!==v);return this;}eq(k,v){this.filters.push(r=>k==='delivery_attempts'?JSON.stringify(r[k])===v:r[k]===v);return this;}limit(n){this.cap=n;return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
 or(filter){const entries=filter.split(',').map(term=>term.split('.eq.'));this.filters.push(r=>entries.some(([k,v])=>r[k]===v));return this;}
 filter(_column,_op,value){const [pattern]=JSON.parse(value);this.filters.push(r=>r.messages.some(m=>Object.entries(pattern).every(([k,v])=>m[k]===v)));return this;}
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
for(const suffix of ['a','b'])tables.tenant_webhook_subscriptions.push({id:`callback-${suffix}`,tenant_id:`tenant-${suffix}`,url:receiverOrigin,secret:'callback-secret',version:'2026-04-01',events:['read_receipt'],is_active:true,consecutive_failures:0});
const {POST}=await import(resolve(app,'app/api/imessage/inbound/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const ingest=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>POST(new NextRequest(r))});ingestOrigin=ingest.url.origin;
async function send(id,guid='guid-a',patch={},line='a'){cases++;const payload={type:'read_receipt',event_id:`read:${id}`,phone_line_id:'forged',recipient_phone:'+15555550123',target_message_guid:guid,read_at:1792195200,ts:1792195200,...patch};const body=JSON.stringify(payload),ts=Math.floor(Date.now()/1000),mac=createHmac('sha256',`native-${line}`).update(`${ts}.${body}`).digest('hex');return fetch(ingestOrigin,{method:'POST',headers:{'x-webhook-subscription-id':`sub-${line}`,'x-webhook-signature':`t=${ts},v1=${mac}`},body});}
try{
 // A valid signature from line A cannot mutate B merely by naming B's GUID.
 const foreign=JSON.stringify(tables.convo[1]);assert.equal((await send('foreign','guid-b')).status,200);assert.equal(JSON.stringify(tables.convo[1]),foreign);assert.equal(mutations,0);assert.equal(callbacks,0);
 assert.equal((await send('valid')).status,200);assert.equal(mutations,1);assert.equal(received.at(-1).chat_id,'lead-a');assert.equal(received.at(-1).phone_line_id,'line-a');assert.equal(tables.convo[0].messages[0].read_at,1792195200);
 assert.equal((await send('valid')).status,200);assert.equal(callbacks,1);assert.equal(mutations,1);
 for(const value of [null,0,-1,1e30,'1792195200']){assert.equal((await send(`bad-time-${String(value)}`,'guid-a',{read_at:value})).status,200);assert.equal(mutations,1);assert.equal(callbacks,1);}
 assert.equal((await send('formatted-peer','guid-a',{recipient_phone:'(555)555-0123'})).status,200);assert.equal(callbacks,1);
 tables.leads.push({...tables.leads[0],id:'ambiguous'});assert.equal((await send('ambiguous')).status,500);tables.leads.pop();assert.equal(mutations,1);
 tables.leads[0].details.phone_line_id='line-b';assert.equal((await send('wrong-pin')).status,500);tables.leads[0].details.phone_line_id='line-a';assert.equal(mutations,1);
 tables.messaging_tenants[0].crm_project_id='project-b';assert.equal((await send('wrong-project')).status,500);tables.messaging_tenants[0].crm_project_id='project-a';assert.equal(mutations,1);
 tables.messaging_tenants[0].is_active=false;assert.equal((await send('inactive')).status,200);tables.messaging_tenants[0].is_active=true;assert.equal(callbacks,1);
 const original=tables.convo[0].messages[0];tables.convo[0].messages=[{...original,read_at:undefined,role:'user'}];assert.equal((await send('inbound-target')).status,200);assert.equal(mutations,1);assert.equal(callbacks,1);
 tables.convo[0].messages=[{...original,read_at:undefined},{...original,id:'duplicate-guid'}];assert.equal((await send('duplicate-guid')).status,500);assert.equal(mutations,1);tables.convo[0].messages=[original];
 dbFailure=true;assert.equal((await send('db-retry')).status,500);dbFailure=false;assert.equal((await send('db-retry')).status,200);assert.equal(callbacks,2);
 receiverStatus=400;assert.equal((await send('callback-retry')).status,500);const stored=tables.messaging_events.at(-1);assert.equal(stored.delivery_status,'failed');receiverStatus=204;assert.equal((await send('callback-retry')).status,200);assert.equal(callbacks,4);
 for(const c of tables.convo)c.messages=[{role:'assistant',content:'same native GUID in distinct projects',guid:'shared',id:`public-${c.id}`}];
 assert.equal((await send('shared','shared')).status,200);assert.equal((await send('shared','shared',{},'b')).status,200);assert.equal(tables.convo[0].messages[0].read_at,1792195200);assert.equal(tables.convo[1].messages[0].read_at,1792195200);assert.equal(received.at(-1).chat_id,'lead-b');assert.equal(callbacks,6);
 const beforeOwned=JSON.stringify(tables.convo), beforeCallbacks=callbacks;
 tables.convo[0].lead_id='foreign-lead';assert.equal((await send('wrong-convo-lead','shared')).status,200);tables.convo[0].lead_id='lead-a';assert.equal(callbacks,beforeCallbacks);assert.equal(JSON.stringify(tables.convo),beforeOwned);
 tables.convo[0].messages=[{role:'assistant',content:'legacy native alias',spectrum_message_guid:'legacy-guid',id:'legacy-public'}];
 assert.equal((await send('legacy-valid','legacy-guid',{read_at:1792195200123})).status,200);assert.equal(tables.convo[0].messages[0].read_at,1792195200123);assert.equal(received.at(-1).read_at,'2026-10-17T00:00:00.123Z');
 tables.convo[0].messages=[{role:'assistant',content:'fresh unread',guid:'inactive-guid',id:'inactive-public'}];tables.messaging_tenants[0].is_active=false;
 const beforeInactive=mutations;assert.equal((await send('inactive-fresh','inactive-guid')).status,200);assert.equal(mutations,beforeInactive);assert.equal(tables.convo[0].messages[0].read_at,undefined);tables.messaging_tenants[0].is_active=true;
 console.log(JSON.stringify({passed:true,cases,mutations,callbacks,dispatchErrors,deviceRequests:0,liveMessages:0}));
}finally{ingest.stop(true);receiver.stop(true);console.error=originalError;}
