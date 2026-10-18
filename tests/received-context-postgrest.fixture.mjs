// Actual migration26 + disposable PostgreSQL/PostgREST; no devices or database mocks.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {persistReceivedContext,loadReceivedContext} from '../../imessage-server/lib/messaging/received-context-ledger.ts';
const origin=process.env.CHERT_TEST_JOURNAL_URL;assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const secret='chert-disposable-journal-secret-at-least-32-bytes';
function token(role){const raw=[{alg:'HS256',typ:'JWT'},{role,exp:Math.floor(Date.now()/1000)+120}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return raw+'.'+createHmac('sha256',secret).update(raw).digest('base64url');}
const service=token('service_role'),realFetch=globalThis.fetch;let requests=0,readFault=false;
const boundedFetch=async(input,init)=>{const request=new Request(input,init);assert.equal(new URL(request.url).origin,origin);requests++;if(readFault&&request.method==='GET'&&new URL(request.url).pathname.endsWith('/messaging_received_contexts'))return Response.json({message:'fixture read unavailable'},{status:500});return realFetch(request);};
for(let i=0;i<100;i++){const r=await boundedFetch(origin+'/',{headers:{Authorization:'Bearer '+service,apikey:service}}).catch(()=>null);if(r?.ok)break;if(i===99)throw Error('readiness');await Bun.sleep(20);}
// PostgREST is served at its root; Supabase's /rest/v1 prefix is removed at this boundary.
const fetchREST=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);url.pathname=url.pathname.replace(/^\/rest\/v1/,'');return boundedFetch(url,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{})});};
const client=createClient(origin,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchREST}});
const tenant='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002',lead='41000000-0000-4000-8000-000000000001',otherLead='41000000-0000-4000-8000-000000000002',line='61000000-0000-4000-8000-000000000001',guid='22222222-2222-4333-8444-555555555555';
const context={version:1,primary_guid:guid,receiver:'+15550000001',service:'iMessage',is_from_me:false,is_group:false,associated_message_type:0,associated_message_guid:null,balloon_bundle_id:null,phone_line_id:line,source_event_id:'recv:'+guid};let cases=0;
await persistReceivedContext(client,tenant,lead,context);assert.deepEqual(await loadReceivedContext(client,tenant,lead,guid),context);cases++;
await persistReceivedContext(client,tenant,lead,context);assert.equal((await client.from('messaging_received_contexts').select('*')).data.length,1);cases++;
await Promise.all([persistReceivedContext(client,tenant,lead,context),persistReceivedContext(client,tenant,lead,context)]);assert.equal((await client.from('messaging_received_contexts').select('*')).data.length,1);cases++;
for(const change of [{receiver:'+15550000009'},{phone_line_id:'61000000-0000-4000-8000-000000000002'}]){await assert.rejects(persistReceivedContext(client,tenant,lead,{...context,...change}));assert.deepEqual(await loadReceivedContext(client,tenant,lead,guid),context);cases++;}
await assert.rejects(persistReceivedContext(client,tenant,otherLead,context));assert.equal(await loadReceivedContext(client,tenant,otherLead,guid),null);cases++;
assert.equal(await loadReceivedContext(client,foreign,lead,guid),null);cases++;
for(const method of ['PATCH','DELETE']){const r=await fetchREST(origin+'/rest/v1/messaging_received_contexts?primary_guid=eq.'+guid,{method,headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},...(method==='PATCH'?{body:JSON.stringify({receiver:'+15550000009'})}:{})});assert.ok(r.status===401||r.status===403);assert.deepEqual(await loadReceivedContext(client,tenant,lead,guid),context);cases++;}
for(const role of ['anon','authenticated'])for(const method of ['GET','POST','PATCH','DELETE']){const jwt=token(role);const r=await fetchREST(origin+'/rest/v1/messaging_received_contexts',{method,headers:{Authorization:'Bearer '+jwt,apikey:jwt,'Content-Type':'application/json'},...(!['GET','DELETE'].includes(method)?{body:JSON.stringify({tenant_id:tenant,lead_id:lead,...context})}:{})});assert.ok(r.status===401||r.status===403);cases++;}
for(const change of [{primary_guid:guid+'\n'},{receiver:'+15550000001\n'},{associated_message_type:2000},{balloon_bundle_id:'app'},{is_from_me:true}]){const r=await client.from('messaging_received_contexts').insert({tenant_id:foreign,lead_id:lead,...context,...change});assert.ok(r.error);cases++;}
const raceGuid='55555555-2222-4333-8444-555555555555';const raceContext={...context,primary_guid:raceGuid,source_event_id:'recv:'+raceGuid};const race=await Promise.allSettled([persistReceivedContext(client,tenant,lead,raceContext),persistReceivedContext(client,tenant,lead,{...raceContext,receiver:'+15550000009'})]);assert.equal(race.filter(result=>result.status==='fulfilled').length,1);assert.equal(race.filter(result=>result.status==='rejected').length,1);assert.ok(await loadReceivedContext(client,tenant,lead,raceGuid));cases++;
readFault=true;await assert.rejects(loadReceivedContext(client,tenant,lead,guid));readFault=false;cases++;
assert.equal((await client.from('fixture_received_faults').update({mode:'commit'}).neq('mode','commit')).error,null);
const fresh={...context,primary_guid:'33333333-2222-4333-8444-555555555555',source_event_id:'recv:33333333-2222-4333-8444-555555555555'};
await assert.rejects(persistReceivedContext(client,tenant,lead,fresh));assert.equal(await loadReceivedContext(client,tenant,lead,fresh.primary_guid),null);cases++;
console.log(JSON.stringify({passed:true,cases,realPostgres:true,realPostgrest:true,actualMigration:26,migrationApplications:2,realCommitFaults:1,dbMocks:0,nativeActions:0,requests}));
