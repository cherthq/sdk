// Real SDK/auth/cloud route/PostgREST reservation. Offline executor is explicitly synthetic.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {mkdtempSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import {createClient} from '@supabase/supabase-js';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
import {createTextGateway,startReviewedTextBroker,loadTextPlan,FIXTURE_TENANT as tenant,FIXTURE_LEAD as lead,FIXTURE_LINE as line} from '../scripts/m4d-live-text-acceptance.mjs';
const args=process.argv.slice(2),offline=args.length===1&&args[0]==='--offline-one-text';
const v2=args.length===3&&args[0]==='--live-one-text-provider'&&['blooio','linq','sendblue','blooio-v4','loopmessage'].includes(args[1])&&args[2].startsWith('/');
assert.ok(offline||v2||(args.length===2&&args[0]==='--live-one-text'&&args[1].startsWith('/')),'Explicit strict text mode required');
const target=new URL(process.env.CHERT_TEST_POSTGREST_URL??'');assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');assert.ok(target.port&&target.pathname==='/'&&!target.search&&!target.hash&&!target.username&&!target.password);
const jwt=process.env.CHERT_TEST_SERVICE_JWT;assert.ok(jwt&&jwt.split('.').length===3);
const app=resolve(import.meta.dir,'../../imessage-server');
const originalFetch=globalThis.fetch;let nativeOrigin,cloudOrigin,restRequests=0,effects=0,reservedFingerprintChecks=0;
const guarded=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([target.origin,nativeOrigin,cloudOrigin].includes(url.origin),'Only task-owned loopback transports');if(url.origin===target.origin){restRequests++;if(url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);}return originalFetch(url,{...init,redirect:'error'});};
globalThis.fetch=guarded;
const db=createClient(target.origin,jwt,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guarded}});
await plugin({name:'strict-text-live-auth',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const project='21000000-0000-4000-8000-000000000001',key=randomBytes(32).toString('hex');
const planPath=v2?args[2]:args[1],reviewed=offline?null:loadTextPlan(planPath);
if(!offline){assert.equal(reviewed.version,v2?2:1);assert.equal(reviewed.provider,v2?args[1]:'blooio');}
const dir=offline?mkdtempSync('/tmp/chert-strict-text-receipt.'):dirname(reviewed.receipt_path);if(offline)chmodSync(dir,0o700);const journalPath=offline?dir+'/receipt.json':reviewed.receipt_path;
const verifyReservation=async({publicId,body})=>{
 const result=await db.from('messaging_send_events').select('*').eq('id',publicId);assert.equal(result.error,null);assert.equal(result.data.length,1);const row=result.data[0];assert.equal(row.tenant_id,tenant);assert.equal(row.lead_id,lead);assert.equal(row.phone_line_id,line);assert.equal(row.phone,body.to);assert.equal(row.status,'processing');assert.deepEqual(row.request_payload,{message:{parts:[{type:'text',value:body.text}]}});assert.equal(row.response_payload.mac_text_dispatch_state,'reserved');assert.equal(row.response_payload.mac_text_origin,body.origin);assert.equal(row.response_payload.mac_text_protocol,'text-operations/v1');assert.equal(row.response_payload.mac_text_from,body.from);assert.equal(row.response_payload.mac_text_to,body.to);assert.equal(row.response_payload.mac_text_fingerprint,textOperationFingerprint(body.from,body.to,body.text));reservedFingerprintChecks++;
};
let gateway,cloud,phase='gateway';
try{
 let plan;
 if(offline){const run=randomUUID(),id=createHash('sha256').update(JSON.stringify(['chert-text-idempotency-v1',tenant,'strict-live:'+run])).digest('hex').slice(0,32);plan={run,public_message_id:id,origin:'text_'+id,marker:`CHERT-M4D-STRICT-TEXT-${run}-blooio`,idempotency_key:'strict-live:'+run,bindings:{sender_sha256:createHash('sha256').update('+15550000001').digest('hex'),recipient_sha256:createHash('sha256').update('+15550000002').digest('hex'),service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64),server_pid:1,messages_pid:2}};const identity={ready:true,sender:'+15550000001',recipient:'+15550000002',service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64),server_pid:1,messages_pid:2};const guid='550e8400-e29b-41d4-a716-446655440000';gateway=await createTextGateway(plan,journalPath,identity,verifyReservation,async payload=>{if(['preflight','identity'].includes(payload.action))return identity;if(payload.action==='observe')return{complete:true,guid,sender_exact:true,recipient_exact:true,service:'iMessage'};assert.equal(payload.action,'send');effects++;assert.equal(effects,1);return{status:202,body:{origin:payload.body.origin,from:payload.body.from,to:payload.body.to,fingerprint:textOperationFingerprint(payload.body.from,payload.body.to,payload.body.text),preparedGuid:guid,state:'acknowledged'}};});}
 else{gateway=await startReviewedTextBroker(planPath,journalPath,args[0],verifyReservation,v2?args[1]:undefined);plan=gateway.plan;}
 nativeOrigin=gateway.nativeOrigin;
 phase='seed';
 for(const result of [await db.from('messaging_tenants').update({signing_secret:key,auto_create_leads:false}).eq('id',tenant),await db.from('phone_lines').insert({id:line,project_id:project,phone_number:gateway.sender,server_url:nativeOrigin,api_key:gateway.apiKey,signing_secret:gateway.signingSecret,status:'active',health_status:'healthy'}),await db.from('leads').update({number:gateway.recipient,project_id:project,messaging_tenant_id:tenant,convo_id:null,details:{phone_line_id:line},name:'Synthetic strict acceptance',created_at:new Date().toISOString()}).eq('id',lead).eq('messaging_tenant_id',tenant)])assert.equal(result.error,null);
 const route=await import(resolve(app,'app/api/v1/text-operations/v1/route.ts'));const{NextRequest}=await import('./next-route-platform.mjs');
 const chats=(offline||reviewed?.provider==='sendblue')?await import(resolve(app,'app/api/v1/chats/route.ts')):null,messages=(offline||['linq','blooio-v4'].includes(reviewed?.provider))?await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts')):null;
 const providerResponses=[];
 cloud=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const path=new URL(req.url).pathname;if(req.method!=='POST')return new Response(null,{status:405});const request=new NextRequest(req);let response;if(path==='/api/v1/text-operations/v1')response=await route.POST(request);else if(chats&&path==='/api/v1/chats')response=await chats.POST(request);else if(messages&&path===`/api/v1/chats/${lead}/messages`)response=await messages.POST(request,{params:Promise.resolve({id:lead})});else return new Response(null,{status:404});providerResponses.push({path,status:response.status,body:await response.clone().json()});return response;}});cloudOrigin=cloud.url.origin;
 phase='auth';const denied=await fetch(cloudOrigin+'/api/v1/text-operations/v1',{method:'POST',headers:{authorization:'Bearer fixture-key','content-type':'application/json'},body:JSON.stringify({phone:gateway.recipient,body:plan.marker})});assert.equal(denied.status,404);
 async function sendOne(provider,marker,idempotencyKey){
  const options={baseURL:cloudOrigin,apiKey:key,fetch:guarded};
  if(provider==='blooio'){const{default:Blooio}=await import('../packages/blooio-adapter/index.ts');const result=await new Blooio({chert:options}).messages.send({to:gateway.recipient,text:marker,...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})});assert.equal(result.status,'queued');return result.message_id;}
  if(provider==='linq'){const{default:Linq}=await import('../packages/linq-adapter/src/index.ts');const result=await new Linq({chert:options}).chats.messages.send(lead,{message:{parts:[{type:'text',value:marker}]}});assert.equal(result.message.delivery_status,'queued');return result.message.id;}
  if(provider==='sendblue'){const{default:Sendblue}=await import('../packages/sendblue-adapter/index.ts');const result=await new Sendblue({chert:options}).messages.send({from_number:gateway.sender,number:gateway.recipient,content:marker});assert.equal(result.status,'QUEUED');assert.equal(result.date_sent,undefined);return result.message_handle;}
  if(provider==='blooio-v4'){const{createBlooioV4Fetch}=await import('../packages/blooio-v4-adapter/index.ts');const response=await createBlooioV4Fetch({chert:options})(`https://api.blooio.com/v4/chats/${lead}/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:marker})});assert.equal(response.status,201);const result=await response.json();assert.equal(result.status,'queued');assert.equal(result.protocol,undefined);return result.id;}
  assert.equal(provider,'loopmessage');const{createLoopMessageFetch}=await import('../packages/loopmessage-adapter/index.ts');const response=await createLoopMessageFetch({chert:options})('https://a.loopmessage.com/api/v1/message/send/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contact:gateway.recipient,text:marker,channel:'imessage'})});assert.equal(response.status,200);const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['contact','message_id','text']);assert.equal(result.contact,gateway.recipient);assert.equal(result.text,marker);return result.message_id;
 }
 phase='sdk';const sdk=offline?new (await import('../packages/blooio-adapter/index.ts')).default({chert:{baseURL:cloudOrigin,apiKey:key,fetch:guarded}}):null;
 const returned=await sendOne(plan.provider??'blooio',plan.marker,plan.idempotency_key);
 const frozen=JSON.parse(readFileSync(journalPath));assert.equal(returned,v2?frozen.public_message_id:plan.public_message_id);const receipt={message_id:returned,status:'queued'};
 phase='ledger';const stored=await db.from('messaging_send_events').select('*').eq('id',receipt.message_id);assert.equal(stored.error,null);assert.equal(stored.data.length,1);const row=stored.data[0];assert.equal(row.response_payload.mac_text_dispatch_state,'acknowledged');assert.equal(row.status,'processing');assert.equal(row.response_payload.mac_message_guids.length,1);
 phase='observe';const observed=await gateway.observe(row.response_payload.mac_message_guids[0]);assert.equal(observed.passed,true);
 const positiveProviders=[],fidelityProviders=[];let providerNativeEffects=0;
 if(offline){
  for(const [index,entry]of [...['blooio','linq','sendblue','blooio-v4','loopmessage'].map(provider=>({provider,fidelity:false})),...['blooio','linq','sendblue','blooio-v4','loopmessage'].map(provider=>({provider,fidelity:true}))].entries()){
   const {provider,fidelity}=entry;
   phase='offline-v2-'+provider+(fidelity?'-fidelity':'');await gateway.close();const run=randomUUID(),marker=fidelity?`  CHERT-M4D-PLAINTEXT-FIDELITY-${run}-${provider} / Café 🌅\r\n  `:`CHERT-M4D-STRICT-TEXT-${run}-${provider}`,nextJournal=dir+'/'+run+'.receipt.json';
   if(fidelity){assert.ok(marker.startsWith('  ')&&marker.endsWith('\r\n  '));assert.ok(marker.includes(' / Café 🌅\r\n'));assert.equal(marker.includes('\\r\\n'),false);}
   const nextPlan={version:2,provider,run,marker,bindings:plan.bindings},identity={ready:true,sender:'+15550000001',recipient:'+15550000002',...plan.bindings},guid=`550e8400-e29b-41d4-a716-${String(index+1).padStart(12,'0')}`;let calls=0,publicId;
   gateway=await createTextGateway(nextPlan,nextJournal,identity,verifyReservation,async payload=>{
    if(['preflight','identity'].includes(payload.action)){if(payload.action==='preflight'){assert.match(payload.claim.origin,/^text_[a-f0-9]{32}$/);assert.equal(payload.claim.provider,provider);}return identity;}
    assert.equal(payload.action,'send');assert.equal(payload.body.text,marker);calls++;assert.equal(calls,1);const committed=JSON.parse(readFileSync(nextJournal));assert.equal(committed.attempted,true);assert.deepEqual(committed.learned_claim,payload.claim);assert.equal(payload.claim.body_sha256,createHash('sha256').update(payload.raw).digest('hex'));assert.equal(payload.claim.fingerprint,textOperationFingerprint(payload.body.from,payload.body.to,payload.body.text));publicId=payload.claim.public_message_id;assert.equal(payload.body.origin,'text_'+publicId);return{status:202,body:{origin:payload.body.origin,from:payload.body.from,to:payload.body.to,fingerprint:payload.claim.fingerprint,preparedGuid:guid,state:'acknowledged'}};
   });nativeOrigin=gateway.nativeOrigin;
   assert.equal((await db.from('phone_lines').update({server_url:nativeOrigin,api_key:gateway.apiKey,signing_secret:gateway.signingSecret}).eq('id',line)).error,null);
   const returned=await sendOne(provider,marker);assert.equal(returned,publicId);assert.equal(calls,1);const response=providerResponses.at(-1);assert.equal(response.path,['blooio','loopmessage'].includes(provider)?'/api/v1/text-operations/v1':provider==='sendblue'?'/api/v1/chats':`/api/v1/chats/${lead}/messages`);assert.equal(response.status,202);
   if(['blooio','loopmessage'].includes(provider))assert.deepEqual(response.body,{success:true,message_id:publicId,chat_id:lead,status:'queued'});else{assert.equal(response.body.message.id,publicId);assert.equal(response.body.message.chat_id,lead);assert.equal(response.body.message.parts[0].value,marker);assert.equal(response.body.message.service,'unknown');assert.equal(response.body.message.delivered_at,null);assert.equal(response.body.message.read_at,null);}
   const durable=await db.from('messaging_send_events').select('*').eq('id',publicId);assert.equal(durable.error,null);assert.equal(durable.data.length,1);assert.equal(durable.data[0].response_payload.mac_text_dispatch_state,'acknowledged');assert.deepEqual(durable.data[0].response_payload.mac_message_guids,[guid]);assert.equal(durable.data[0].status,'processing');assert.deepEqual(durable.data[0].request_payload,{message:{parts:[{type:'text',value:marker}]}});(fidelity?fidelityProviders:positiveProviders).push(provider);providerNativeEffects+=calls;
  }
 }
 let offlineFaultCases=0,offlineFaultEffects=0,permanentRestartRefusals=0;
 if(offline){for(const fault of ['lost-reply','wrong-ack']){
  await gateway.close();const run=randomUUID(),nextKey='strict-live:'+run,nextId=createHash('sha256').update(JSON.stringify(['chert-text-idempotency-v1',tenant,nextKey])).digest('hex').slice(0,32);
  const nextPlan={...plan,run,idempotency_key:nextKey,public_message_id:nextId,origin:'text_'+nextId,marker:`CHERT-M4D-STRICT-TEXT-${run}-blooio`},nextJournal=dir+'/'+run+'.receipt.json';
  const identity={ready:true,sender:'+15550000001',recipient:'+15550000002',...plan.bindings};let count=0;
  const executor=async payload=>{if(['preflight','identity'].includes(payload.action))return identity;assert.equal(payload.action,'send');count++;if(fault==='lost-reply')throw Error('Offline lost reply');return{status:202,body:{origin:payload.body.origin,from:payload.body.from,to:payload.body.to,fingerprint:'0'.repeat(64),preparedGuid:'550e8400-e29b-41d4-a716-446655440000',state:'acknowledged'}};};
  gateway=await createTextGateway(nextPlan,nextJournal,identity,verifyReservation,executor);nativeOrigin=gateway.nativeOrigin;
  assert.equal((await db.from('phone_lines').update({server_url:nativeOrigin,api_key:gateway.apiKey,signing_secret:gateway.signingSecret}).eq('id',line)).error,null);
  await assert.rejects(async()=>await sdk.messages.send({to:gateway.recipient,text:nextPlan.marker,'Idempotency-Key':nextKey}),error=>error.status===502);
  const failed=await db.from('messaging_send_events').select('*').eq('id',nextId);assert.equal(failed.error,null);assert.equal(failed.data.length,1);assert.equal(failed.data[0].response_payload.mac_text_dispatch_state,'unconfirmed');assert.equal(count,1);
  await gateway.close();await assert.rejects(createTextGateway(nextPlan,nextJournal,identity,verifyReservation,executor));assert.equal(count,1);offlineFaultCases++;offlineFaultEffects+=count;permanentRestartRefusals++;
 }}
 console.log(JSON.stringify({passed:true,mode:offline?'offline-contract-only':'reviewed-live',actualSDK:true,actualAuth:true,realPostgREST:true,reservationBeforeEffect:true,reservedFingerprintChecks,sdkStatus:'queued',effects:offline?effects:1,...(!offline?observed:{liveMessages:0,positiveProviders,fidelityProviders,providerNativeEffects,totalOfflineEffects:effects+providerNativeEffects+offlineFaultEffects,offlineFaultCases,offlineFaultEffects,permanentRestartRefusals})}));
}catch(error){console.error(JSON.stringify({passed:false,outcome:'incomplete-no-resend',phase,...(offline?{errorClass:error?.constructor?.name,httpStatus:Number.isInteger(error?.status)?error.status:null}:{}),receiptPath:journalPath}));process.exitCode=1;}
finally{if(cloud)await cloud.stop(true);if(gateway)await gateway.close();globalThis.fetch=originalFetch;if(offline)rmSync(dir,{recursive:true,force:true});}
