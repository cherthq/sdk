// Opt-in Sendblue HTTP adapter -> actual signed native ingest/protected ledger
// -> actual authenticated GETs/reaction POST and PostgreSQL. Native ACKs are synthetic.
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
const origin=process.env.CHERT_TEST_JOURNAL_URL;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const {createClient}=await import('@supabase/supabase-js');
const secret='chert-disposable-journal-secret-at-least-32-bytes';
const tenant='11aa0000-0000-4000-8000-000000000001',line='61cc0000-0000-4000-8000-000000000001';
const chat='41dd0000-0000-4000-8000-000000000001',convo='51ee0000-0000-4000-8000-000000000001';
const args=process.argv.slice(2);
assert.ok(args.length===0||(args.length===2&&args[0]==='--live-one-sendblue-received-like'&&args[1].startsWith('/')));
const live=args.length===2;
let target='a1111111-2222-4333-8444-555555555555';
const prepared='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';

const jwt=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+120}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const service=jwt+'.'+createHmac('sha256',secret).update(jwt).digest('base64url');
const realFetch=globalThis.fetch,allowed=new Set([origin]);
// Standalone PostgREST serves /table; preserve actual HTTP bytes except the
// Supabase client's fixed /rest/v1 prefix. No query, handler or DB substitution.
async function guardedFetch(input,init){
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.ok(allowed.has(url.origin),'Only owned loopback origins allowed');
 if(url.origin===origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);
 return realFetch(url,init);
}
globalThis.fetch=guardedFetch;
const db=createClient(origin,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch}});
let nativePosts=0,getRequests=0,inventoryRequests=0,inboundRequests=0,reactionRequests=0,cases=0,mode='ack',inventoryRace=null,expectedReaction='love',expectedRemove=false;
let broker=null,reservationChecks=0,livePhase='setup';
if(live){
 const {startReviewedSendblueReactionBroker}=await import('../scripts/m4d-live-sendblue-reaction-acceptance.mjs');
 // load/start itself revalidates the full immutable plan; no direct eligibility seeding.
 const privatePlan=JSON.parse(await Bun.file(args[1]).text());
 try{broker=await startReviewedSendblueReactionBroker(args[1],privatePlan.receipt_path,args[0],async claim=>{
  const row=await db.from('messaging_reaction_operations').select('*').eq('id',claim.operationId).eq('tenant_id',tenant).single();
  assert.equal(row.error,null);const r=row.data;assert.ok(r);
  assert.equal(r.state,'reserved');assert.equal(r.prepared_guid,null);assert.equal(r.chat_id,chat);assert.equal(r.phone_line_id,line);
  assert.equal(r.sender,claim.body.from);assert.equal(r.recipient,claim.body.to);assert.equal(r.target_guid,claim.body.targetGuid);assert.equal(r.part_index,0);assert.equal(r.reaction,'like');assert.equal(r.remove,false);assert.equal(r.fingerprint,claim.fingerprint);
  const proof=await db.from('messaging_received_contexts').select('*').eq('tenant_id',tenant).eq('primary_guid',target).single();
  assert.equal(proof.error,null);assert.equal(proof.data.lead_id,chat);assert.equal(proof.data.phone_line_id,line);assert.equal(proof.data.receiver,broker.sender);assert.equal(proof.data.source_event_id,'recv:'+target);
  for(const [key,value]of Object.entries({version:1,primary_guid:target,service:'iMessage',is_from_me:false,is_group:false,associated_message_type:0,associated_message_guid:null,balloon_bundle_id:null}))assert.equal(proof.data[key],value);
  const ownedLine=await db.from('phone_lines').select('id,phone_number,api_key,signing_secret,status').eq('id',line).single();assert.equal(ownedLine.error,null);assert.equal(ownedLine.data.status,'active');assert.equal(ownedLine.data.phone_number,broker.sender);assert.equal(ownedLine.data.api_key,broker.apiKey);assert.equal(ownedLine.data.signing_secret,broker.signingSecret);
  reservationChecks++;return true;
 });}catch{throw new Error('Controlled Sendblue setup refused before reaction dispatch');}
 target=broker.targetGuid;
}

const native=live?{url:new URL(broker.nativeOrigin),stop(){}}:Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 nativePosts++;
 assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/api/v1/reaction-operations/v1');
 assert.equal(request.headers.get('authorization'),'Bearer fixture-native-key');
 const raw=await request.text(),body=JSON.parse(raw);
 assert.deepEqual(Object.keys(body).sort(),['from','origin','partIndex','reaction','remove','targetGuid','to']);
 assert.equal(body.from,'+15550000001');assert.equal(body.to,'+15550000002');assert.equal(body.targetGuid,target);assert.equal(body.partIndex,0);assert.equal(body.reaction,expectedReaction);assert.equal(body.remove,expectedRemove);
 const sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);
 assert.equal(sig[2],createHmac('sha256','fixture-native-signing').update(sig[1]+'.'+raw).digest('hex'));
 const fingerprint=createHash('sha256').update(JSON.stringify(['chert-reaction-once-v1',body.from,body.to,body.targetGuid,body.partIndex,body.reaction,body.remove]).replace(/\//g,'\\/')).digest('hex');
 const row=await db.from('messaging_reaction_operations').select('*').eq('id',body.origin.slice(9)).single();
 assert.equal(row.error,null);assert.equal(row.data.state,'reserved');assert.equal(row.data.tenant_id,tenant);
 assert.equal(row.data.fingerprint,fingerprint);assert.equal(row.data.prepared_guid,null);
 assert.equal(row.data.target_guid,target);assert.equal(row.data.chat_id,chat);assert.equal(row.data.phone_line_id,line);
 return Response.json({...body,fingerprint:mode==='malformed'?'f'.repeat(64):fingerprint,preparedGuid:prepared,state:'acknowledged'},{status:202});
}});allowed.add(native.url.origin);
process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=service;
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'linq-real-reaction-routes',setup(build){
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const {NextRequest}=await import('./next-route-platform.mjs');
const inboundRoute=await import('../../imessage-server/app/api/imessage/inbound/route.ts');
const inventoryRoute=await import('../../imessage-server/app/api/v1/phone-numbers/route.ts');
const getRoute=await import('../../imessage-server/app/api/v1/messages/[id]/route.ts');
const reactionRoute=await import('../../imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts');
const {createSendblueReactionFetch}=await import('../packages/sendblue-adapter/reactions.ts');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const parts=new URL(request.url).pathname.split('/');
 if(request.method==='POST'&&new URL(request.url).pathname==='/api/imessage/inbound'){inboundRequests++;return inboundRoute.POST(new NextRequest(request));}
 if(request.method==='GET'&&new URL(request.url).pathname==='/api/v1/phone-numbers'){inventoryRequests++;const response=await inventoryRoute.GET(new NextRequest(request));if(inventoryRace){const race=inventoryRace;inventoryRace=null;await race();}return response;}
 if(request.method==='GET'&&parts.length===5&&parts[3]==='messages'){
  getRequests++;return getRoute.GET(new NextRequest(request),{params:Promise.resolve({id:decodeURIComponent(parts[4])})});
 }
 if(request.method==='POST'&&parts.length===8&&parts[3]==='chats'&&parts[5]==='messages'&&parts[7]==='reactions'){
  reactionRequests++;return reactionRoute.POST(new NextRequest(request),{params:Promise.resolve({id:parts[4],messageId:decodeURIComponent(parts[6])})});
 }
 return Response.json({error:'unsupported fixture route'},{status:404});
}});allowed.add(cloud.url.origin);
const transport=(apiKey='fixture-cloud-key')=>createSendblueReactionFetch({baseURL:cloud.url.origin+'/api/v1',apiKey});
const sdk=transport();
async function update(table,body,id){const r=await db.from(table).update(body).eq('id',id);assert.equal(r.error,null);}
const evidence=guid=>({version:1,primary_guid:guid,receiver:'+15550000001',service:'iMessage',is_from_me:false,is_group:false,associated_message_type:0,associated_message_guid:null,balloon_bundle_id:null});
function event(guid,patch={}){return{type:'message_received',event_id:'recv:'+guid,ts:Math.floor(Date.now()/1000),message:{guid,role:'inbound',status:'received',recipient:'+15550000002',service:'imessage',parts:[{type:'text',text:'actual inbound plaintext',value:'actual inbound plaintext'}],is_group:false,native_received_evidence:evidence(guid),...patch}};}
async function ingest(payload,{secret='fixture-native-signing',sub='fixture-native-sub'}={}){const raw=JSON.stringify(payload),ts=Math.floor(Date.now()/1000);return guardedFetch(cloud.url.origin+'/api/imessage/inbound',{method:'POST',body:raw,headers:{'x-webhook-subscription-id':sub,'x-webhook-signature':`t=${ts},v1=${createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')}`}});}
async function reaction(handle=target,value='love',client=sdk){return client('https://api.sendblue.com/api/send-reaction',{method:'POST',body:JSON.stringify({from_number:'+15550000001',message_handle:handle,reaction:value})});}
async function refused(call,status,unsupported=false){const before=nativePosts;const response=await call();assert.equal(response.status,status);if(unsupported)assert.deepEqual(await response.clone().json(),{status:'ERROR',message:'unsupported_target'});assert.equal(nativePosts,before);cases++;return response;}
try{
 const deadline=Date.now()+12000;for(;;){try{const r=await realFetch(origin+'/phone_lines?select=id',{headers:{authorization:'Bearer '+service}});if(r.ok)break}catch{}assert.ok(Date.now()<deadline);await Bun.sleep(50)}
 await update('phone_lines',{server_url:native.url.origin},line);
 if(live){
  livePhase='reingest';
  await update('phone_lines',{server_url:broker.nativeOrigin,api_key:broker.apiKey,signing_secret:broker.signingSecret,phone_number:broker.sender},line);
  await update('leads',{number:broker.recipient},chat);
  assert.equal((await ingest(broker.event,{secret:broker.signingSecret})).status,200);
  livePhase='sdk';
  const response=await sdk('https://api.sendblue.com/api/send-reaction',{method:'POST',body:JSON.stringify({from_number:broker.sender,message_handle:target,reaction:'like'})});
  assert.equal(response.status,200);const accepted=await response.json();await broker.recordSDKAcceptance(accepted);
  assert.deepEqual(accepted,{status:'OK',message:'Reaction request sent',message_handle:target,reaction:'like'});
  livePhase='ledger';
  const rows=await db.from('messaging_reaction_operations').select('*').eq('tenant_id',tenant).eq('target_guid',target);
  assert.equal(rows.error,null);assert.equal(rows.data.length,1);const row=rows.data[0];assert.equal(row.state,'acknowledged');assert.equal(row.reaction,'like');assert.equal(row.remove,false);assert.equal(reservationChecks,2);
  livePhase='observe';const observed=await broker.observe(row.prepared_guid);assert.equal(observed.passed,true);
  console.log(JSON.stringify({passed:true,mode:'reviewed-export-reingest-sendblue-like',actualAuth:true,actualInboundHMAC:true,protectedLedger:true,realPostgres:true,realPostgrest:true,reservationChecks,nativePosts:1,receiptPath:observed.receiptPath,receiptSha256:observed.receiptSha256,originalWebhookTransport:false,applicationProven:false}));
 }else{
 assert.equal((await ingest(event(target))).status,200);cases++;
 const proof=await db.from('messaging_received_contexts').select('*').eq('primary_guid',target).single();assert.equal(proof.error,null);assert.equal(proof.data.phone_line_id,line);assert.equal(proof.data.lead_id,chat);cases++;
 for(const name of ['love','like','dislike','laugh','emphasize','question'])for(const value of [name,'-'+name]){
  expectedReaction=name;expectedRemove=value.startsWith('-');
  const before=nativePosts;const response=await reaction(target,value);assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'OK',message:'Reaction request sent',message_handle:target,reaction:value});assert.equal(nativePosts,before+1);cases++;
 }
 const original=(await db.from('convo').select('messages').eq('id',convo).single()).data.messages;
 const outbound='09111111-2222-4333-8444-555555555555';
 inventoryRace=async()=>update('convo',{messages:[{id:target,guid:outbound,role:'assistant',content:'same DM outbound alias substitution',service:'imessage'}]},convo);
 await refused(()=>reaction(target),422,true);
 await update('convo',{messages:original},convo);

 inventoryRace=async()=>update('leads',{details:{phone_line_id:'61cc0000-0000-4000-8000-000000000099'}},chat);
 await refused(()=>reaction(target),422,true);await update('leads',{details:{phone_line_id:line}},chat);
 inventoryRace=async()=>update('phone_lines',{phone_number:'+15550000009'},line);
 await refused(()=>reaction(target),422,true);await update('phone_lines',{phone_number:'+15550000001'},line);
 const guardedPost=(handle,received)=>guardedFetch(cloud.url.origin+`/api/v1/chats/${chat}/messages/${handle}/reactions`,{method:'POST',headers:{authorization:'Bearer fixture-cloud-key','content-type':'application/json'},body:JSON.stringify({reaction:'love',remove:false,part_index:0,received_target:received})});
 await refused(()=>guardedPost(target,{primary_guid:target,phone_line_id:line,receiver:'+15550000009'}),422);
 await refused(()=>guardedPost(target,{primary_guid:target.toUpperCase(),phone_line_id:line,receiver:'+15550000001'}),422);
 await refused(()=>guardedPost(target,{primary_guid:target,phone_line_id:'61cc0000-0000-4000-8000-000000000099',receiver:'+15550000001'}),422);
 await refused(()=>guardedPost(target,{primary_guid:target,phone_line_id:line,receiver:'+15550000001',extra:true}),400);
 const sentTarget='08111111-2222-4333-8444-555555555555';
 assert.equal((await db.from('messaging_send_events').insert({id:sentTarget,tenant_id:tenant,lead_id:chat,convo_id:convo,phone:'+15550000002',phone_line_id:line,status:'queued'})).error,null);
 await refused(()=>guardedPost(sentTarget,{primary_guid:sentTarget,phone_line_id:line,receiver:'+15550000001'}),422);

 const forged='b1111111-2222-4333-8444-555555555555';
 await update('convo',{messages:[...original,{id:forged,guid:forged,role:'user',content:'forged context',service:'imessage',native_received_context:{...evidence(forged),phone_line_id:line,source_event_id:'recv:'+forged}}]},convo);
 await refused(()=>reaction(forged),422);
 await refused(()=>guardedPost(forged,{primary_guid:forged,phone_line_id:line,receiver:'+15550000001'}),422);
 await update('convo',{messages:[...original,{id:'c1111111-2222-4333-8444-555555555555',guid:'c1111111-2222-4333-8444-555555555555',role:'user',content:'historical',service:'imessage'}]},convo);
 await refused(()=>reaction('c1111111-2222-4333-8444-555555555555'),422);
 await update('convo',{messages:original},convo);
 for(const [index,patch]of [{native_received_evidence:{...evidence(target),balloon_bundle_id:'app'}},{native_received_evidence:{...evidence(target),associated_message_type:2000}},{native_received_evidence:{...evidence(target),is_from_me:true}},{service:'sms'},{native_received_evidence:{...evidence(target),receiver:'+15550000009'}}].entries()){
  const guid=`d111111${index}-2222-4333-8444-555555555555`;const payload=event(guid,patch);if(patch.native_received_evidence)payload.message.native_received_evidence.primary_guid=guid;
  assert.equal((await ingest(payload)).status,200);assert.equal((await db.from('messaging_received_contexts').select('*').eq('primary_guid',guid)).data.length,0);await refused(()=>reaction(guid),422);
 }
 await refused(async()=>{const r=await ingest(event('e1111111-2222-4333-8444-555555555555'),{secret:'wrong'});return r;},401);
 await refused(async()=>ingest(event('e2111111-2222-4333-8444-555555555555'),{sub:'unknown'}),401);
 const wrongLine='e3111111-2222-4333-8444-555555555555';
 await update('leads',{details:{phone_line_id:'61cc0000-0000-4000-8000-000000000099'}},chat);
 await refused(()=>ingest(event(wrongLine)),500);assert.equal((await db.from('messaging_received_contexts').select('*').eq('primary_guid',wrongLine)).data.length,0);
 await update('leads',{details:{phone_line_id:line}},chat);
 const wrongTenant='e4111111-2222-4333-8444-555555555555';
 await update('messaging_tenants',{crm_project_id:'21bb0000-0000-4000-8000-000000000002'},tenant);
 await refused(()=>ingest(event(wrongTenant)),500);assert.equal((await db.from('messaging_received_contexts').select('*').eq('primary_guid',wrongTenant)).data.length,0);
 await update('messaging_tenants',{crm_project_id:'21bb0000-0000-4000-8000-000000000001'},tenant);
 const absent='f1111111-2222-4333-8444-555555555555';const missing=await refused(()=>reaction(absent),404);assert.equal((await missing.json()).message,'The message to react to was not found for this account');
 await refused(()=>reaction(target,'love',transport('fixture-foreign-key')),404);
 await refused(()=>reaction(target,'love',transport('wrong-key')),404);
 await update('leads',{details:{phone_line_id:'61cc0000-0000-4000-8000-000000000099'}},chat);await refused(()=>reaction(target),422);await update('leads',{details:{phone_line_id:line}},chat);
 await update('phone_lines',{phone_number:'+15550000009'},line);await refused(()=>reaction(target),422);await update('phone_lines',{phone_number:'+15550000001'},line);
 expectedReaction='love';expectedRemove=false;mode='malformed';const before=nativePosts;assert.equal((await reaction()).status,502);assert.equal(nativePosts,before+1);const uncertain=await db.from('messaging_reaction_operations').select('*').eq('state','unknown');assert.equal(uncertain.error,null);assert.equal(uncertain.data.length,1);cases++;
 assert.equal(inboundRequests,10);assert.equal(inventoryRequests,17);
 const records=await db.from('messaging_reaction_operations').select('id,state');assert.equal(records.error,null);assert.equal(records.data.length,13);assert.equal(nativePosts,13);
 console.log(JSON.stringify({passed:true,cases,nativePosts,getRequests,inventoryRequests,inboundRequests,reactionRequests,realPostgres:true,realPostgrest:true,actualMigrations:[23,25,26],actualAuth:true,actualInboundHMAC:true,protectedLedger:true,dbMocks:0,liveNativeActions:0}));
 }
}catch(error){if(live){console.error(JSON.stringify({passed:false,livePhase,outcome:'unconfirmed-never-resend'}));throw new Error('Controlled Sendblue reaction acceptance incomplete');}throw error;}finally{cloud.stop(true);native.stop(true);broker?.close();globalThis.fetch=realFetch;}
