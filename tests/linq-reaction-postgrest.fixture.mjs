// Actual official Linq adapter -> actual authenticated Chert GET/reaction POST
// -> real migration25/PostgREST. Only native HTTP ACKs are synthetic; no device.
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
let target='a1111111-2222-4333-8444-555555555555';
const prepared='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const liveArgs=process.argv.slice(2);
assert.ok(liveArgs.length===0||(liveArgs.length===2&&['--live-one-linq-remove-love','--live-one-linq-like'].includes(liveArgs[0])&&liveArgs[1].startsWith('/')),'Explicit live plan required');
const live=liveArgs.length===2;let broker=null,liveNativeOrigin=null,livePhase='starting';
const rawMessage={id:'recorded-target',guid:target,role:'user',content:'actual owned plaintext',service:'imessage'};
const jwt=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+120}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const service=jwt+'.'+createHmac('sha256',secret).update(jwt).digest('base64url');
const realFetch=globalThis.fetch,allowed=new Set([origin]);
// Standalone PostgREST serves /table; preserve actual HTTP bytes except the
// Supabase client's fixed /rest/v1 prefix. No query, handler or DB substitution.
async function guardedFetch(input,init){
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.ok(allowed.has(url.origin),'Only owned loopback origins allowed');
 if(url.origin===origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);
 if(liveNativeOrigin&&url.origin===liveNativeOrigin&&init?.method==='POST')nativePosts++;
 return realFetch(url,init);
}
globalThis.fetch=guardedFetch;
const db=createClient(origin,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch}});
let nativePosts=0,getRequests=0,reactionRequests=0,cases=0,mode='ack';
const native=live?null:Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 nativePosts++;
 assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/api/v1/reaction-operations/v1');
 assert.equal(request.headers.get('authorization'),'Bearer fixture-native-key');
 const raw=await request.text(),body=JSON.parse(raw);
 assert.deepEqual(Object.keys(body).sort(),['from','origin','partIndex','reaction','remove','targetGuid','to']);
 assert.equal(body.from,'+15550000001');assert.equal(body.to,'+15550000002');assert.equal(body.targetGuid,target);assert.equal(body.partIndex,0);
 const sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);
 assert.equal(sig[2],createHmac('sha256','fixture-native-signing').update(sig[1]+'.'+raw).digest('hex'));
 const fingerprint=createHash('sha256').update(JSON.stringify(['chert-reaction-once-v1',body.from,body.to,body.targetGuid,body.partIndex,body.reaction,body.remove]).replace(/\//g,'\\/')).digest('hex');
 const row=await db.from('messaging_reaction_operations').select('*').eq('id',body.origin.slice(9)).single();
 assert.equal(row.error,null);assert.equal(row.data.state,'reserved');assert.equal(row.data.tenant_id,tenant);
 assert.equal(row.data.fingerprint,fingerprint);assert.equal(row.data.prepared_guid,null);
 assert.equal(row.data.target_guid,target);assert.equal(row.data.chat_id,chat);assert.equal(row.data.phone_line_id,line);
 return Response.json({...body,fingerprint:mode==='malformed'?'f'.repeat(64):fingerprint,preparedGuid:prepared,state:'acknowledged'},{status:202});
}});if(native)allowed.add(native.url.origin);
process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=service;
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'linq-real-reaction-routes',setup(build){
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const {NextRequest}=await import('./next-route-platform.mjs');
const getRoute=await import('../../imessage-server/app/api/v1/messages/[id]/route.ts');
const reactionRoute=await import('../../imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts');
const {default:Linq}=await import('../packages/linq-adapter/src/index.ts');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const parts=new URL(request.url).pathname.split('/');
 if(request.method==='GET'&&parts.length===5&&parts[3]==='messages'){
  getRequests++;return getRoute.GET(new NextRequest(request),{params:Promise.resolve({id:decodeURIComponent(parts[4])})});
 }
 if(request.method==='POST'&&parts.length===8&&parts[3]==='chats'&&parts[5]==='messages'&&parts[7]==='reactions'){
  reactionRequests++;return reactionRoute.POST(new NextRequest(request),{params:Promise.resolve({id:parts[4],messageId:decodeURIComponent(parts[6])})});
 }
 return Response.json({error:'unsupported fixture route'},{status:404});
}});allowed.add(cloud.url.origin);
const client=(apiKey='fixture-cloud-key')=>new Linq({chert:{baseURL:cloud.url.origin+'/api/v1',apiKey},maxRetries:0});
const sdk=client();
async function update(table,body,id){const r=await db.from(table).update(body).eq('id',id);assert.equal(r.error,null);}
async function rejectNoNative(call,status){const before=nativePosts;await assert.rejects(call,status?e=>e.status===status:undefined);assert.equal(nativePosts,before);cases++;}
try{
 const deadline=Date.now()+12000;
 for(;;){try{const r=await realFetch(origin+'/phone_lines?select=id',{headers:{authorization:'Bearer '+service}});if(r.ok)break}catch{}assert.ok(Date.now()<deadline,'Local PostgREST readiness deadline');await Bun.sleep(50)}
 if(live){
  const {loadReactionPlan,startReviewedReactionBroker}=await import('../scripts/m4d-live-reaction-acceptance.mjs');
  const plan=loadReactionPlan(liveArgs[1]);target=plan.target_guid;
  broker=await startReviewedReactionBroker(liveArgs[1],plan.receipt_path,liveArgs[0],async claim=>{
   const found=await db.from('messaging_reaction_operations').select('*').eq('id',claim.operationId).single();
   if(found.error||!found.data)return false;const row=found.data,body=claim.body;
   return row.id===claim.operationId&&row.tenant_id===tenant&&row.phone_line_id===line&&row.chat_id===chat
    &&row.sender===broker.sender&&row.recipient===broker.recipient&&row.target_guid===target
    &&row.part_index===0&&row.reaction===plan.reaction&&row.remove===plan.remove&&row.state==='reserved'
    &&row.prepared_guid===null&&row.fingerprint===claim.fingerprint&&body.origin==='reaction_'+row.id
    &&body.from===row.sender&&body.to===row.recipient&&body.targetGuid===row.target_guid
    &&body.partIndex===0&&body.reaction===plan.reaction&&body.remove===plan.remove;
  });
  liveNativeOrigin=broker.nativeOrigin;allowed.add(broker.nativeOrigin);
  await update('phone_lines',{server_url:broker.nativeOrigin,phone_number:broker.sender,api_key:broker.apiKey,signing_secret:broker.signingSecret},line);
  await update('leads',{number:broker.recipient},chat);
  assert.equal(typeof broker.targetText,'string');assert.ok(broker.targetText.length>0);
  await update('convo',{messages:[{id:target,guid:target,role:'assistant',content:broker.targetText,service:'imessage'}]},convo);
  livePhase='sdk';
  const result=await sdk.messages.addReaction(target,{operation:plan.remove?'remove':'add',type:plan.reaction});
  await broker.recordSDKAcceptance(result);
  livePhase='row';
  assert.deepEqual(result,{status:'accepted'});assert.equal(nativePosts,1);assert.equal(getRequests,1);assert.equal(reactionRequests,1);
  const rows=await db.from('messaging_reaction_operations').select('*').eq('tenant_id',tenant);
  assert.equal(rows.error,null);assert.equal(rows.data.length,1);const row=rows.data[0];
  assert.equal(row.state,'acknowledged');assert.equal(row.target_guid,target);assert.equal(row.remove,plan.remove);assert.equal(row.reaction,plan.reaction);
  assert.equal(row.sender,broker.sender);assert.equal(row.recipient,broker.recipient);
  livePhase='observe';
  const observation=await broker.observe(row.prepared_guid);assert.equal(observation.passed,true);
  console.log(JSON.stringify({passed:true,cases:1,nativePosts:1,getRequests:1,reactionRequests:1,realPostgres:true,realPostgrest:true,actualMigration:25,actualSDK:'@linqapp/sdk@0.78.0',actualAuth:true,actualMessageGET:true,dbMocks:0,liveNativeActions:1,receiptPath:observation.receiptPath,receiptSha256:observation.receiptSha256}));
 }else{
 await update('phone_lines',{server_url:native.url.origin},line);
 for(const type of ['love','like','dislike','laugh','emphasize','question'])for(const operation of ['add','remove']){
  const before=nativePosts,g=getRequests,p=reactionRequests;
  const result=await sdk.messages.addReaction(rawMessage.id,{operation,type});
  assert.deepEqual(result,{status:'accepted'});assert.equal(nativePosts,before+1);
  assert.equal(getRequests,g+1);assert.equal(reactionRequests,p+1);cases++;
 }
 for(const body of [{operation:'add',type:'custom',emoji:'❤️'},{operation:'add',type:'love',part_index:1}]){
  const before=getRequests;await rejectNoNative(()=>sdk.messages.addReaction(rawMessage.id,body));assert.equal(getRequests,before);
 }
 await rejectNoNative(()=>client('wrong-key').messages.addReaction(rawMessage.id,{operation:'add',type:'love'}),404);
 await rejectNoNative(()=>client('fixture-foreign-key').messages.addReaction(rawMessage.id,{operation:'add',type:'love'}),404);
 await update('convo',{messages:[rawMessage,{...rawMessage,id:'second-id'}]},convo);
 await rejectNoNative(()=>sdk.messages.addReaction(target,{operation:'add',type:'love'}),409);
 await update('convo',{messages:[rawMessage]},convo);
 await update('leads',{details:{phone_line_id:'61cc0000-0000-4000-8000-000000000099'}},chat);
 await rejectNoNative(()=>sdk.messages.addReaction(rawMessage.id,{operation:'add',type:'love'}));
 await update('leads',{details:{phone_line_id:line}},chat);
 await update('phone_lines',{status:'inactive'},line);
 await rejectNoNative(()=>sdk.messages.addReaction(rawMessage.id,{operation:'add',type:'love'}),404);
 await update('phone_lines',{status:'active'},line);
 mode='malformed';const before=nativePosts,g=getRequests,p=reactionRequests;
 await assert.rejects(()=>sdk.messages.addReaction(rawMessage.id,{operation:'add',type:'love'}),e=>e.status===502);
 assert.equal(nativePosts,before+1);assert.equal(getRequests,g+1);assert.equal(reactionRequests,p+1);cases++;
 const uncertain=await db.from('messaging_reaction_operations').select('id,state').eq('state','unknown');
 assert.equal(uncertain.error,null);assert.equal(uncertain.data.length,1);mode='ack';
 const abort=new AbortController();abort.abort();const calls=getRequests;
 await rejectNoNative(()=>sdk.messages.addReaction(rawMessage.id,{operation:'remove',type:'love'},{signal:abort.signal}));assert.equal(getRequests,calls);
 const records=await db.from('messaging_reaction_operations').select('id,state');assert.equal(records.error,null);
 assert.equal(records.data.length,13);assert.equal(records.data.filter(r=>r.state==='acknowledged').length,12);
 assert.equal(nativePosts,13);
 console.log(JSON.stringify({passed:true,cases,nativePosts,getRequests,reactionRequests,realPostgres:true,realPostgrest:true,actualMigration:25,actualSDK:'@linqapp/sdk@0.78.0',actualAuth:true,actualMessageGET:true,dbMocks:0,liveNativeActions:0}));
 }
}catch(error){
 if(live){
  const name=['Error','AssertionError','TypeError','AbortError','APIError','NotFoundError','InternalServerError'].includes(error?.name)?error.name:'Error';
  const status=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:'none';
  throw new Error(`Controlled reaction acceptance failed (phase=${livePhase}, name=${name}, status=${status}); inspect private receipt and never resend`);
 }
 throw error;
}finally{cloud.stop(true);native?.stop(true);broker?.close();globalThis.fetch=realFetch;}
