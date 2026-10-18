// Actual migration25, PG/PostgREST/Supabase, and production reservation/transport.
// Native HTTP is a synthetic signed ACK boundary, never a device or provider.
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
const origin=process.env.CHERT_TEST_JOURNAL_URL;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const {createClient}=await import('@supabase/supabase-js');
const {sendReservedReactionOperation}=await import('../../imessage-server/lib/sending/reserved-reaction-operation.ts');
const secret='chert-disposable-journal-secret-at-least-32-bytes',tenant='11aa0000-0000-4000-8000-000000000001',foreign='11aa0000-0000-4000-8000-000000000002',project='21bb0000-0000-4000-8000-000000000001',line='61cc0000-0000-4000-8000-000000000001',chat='41dd0000-0000-4000-8000-000000000001',target='a1111111-2222-4333-8444-555555555555',prepared='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const token=role=>{const data=[{alg:'HS256',typ:'JWT'},{role,exp:Math.floor(Date.now()/1000)+120}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url')};
const service=token('service_role'),realFetch=globalThis.fetch,allowed=new Set([origin]);
let effects=0,cases=0,nativeMode='ack',fault='',barrier=null,casMisses=0,nativeAckGate=null;
const headers={authorization:'Bearer '+service,'content-type':'application/json'};
async function guardedFetch(input,init){const url=new URL(input instanceof Request?input.url:String(input));assert.ok(allowed.has(url.origin),'outside owned loopback');if(url.origin===origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);const method=init?.method??'GET';
 if(url.origin===origin&&url.pathname==='/messaging_reaction_operations'){
  if(fault==='read-failure'&&method==='GET')throw Error('PRIVATE-READ-FAILURE');
  if(barrier&&method==='POST'){const current=barrier;if(++current.count===2){barrier=null;current.release()}await Promise.race([current.ready,new Promise((_,no)=>{const timer=setTimeout(()=>no(Error('bounded insertion barrier')),3000);timer.unref()})]);}
  if(fault==='cas-race'&&method==='PATCH'){fault='';const race=await realFetch(origin+'/messaging_reaction_operations?id='+encodeURIComponent(url.searchParams.get('id')),{method:'PATCH',headers,body:JSON.stringify({state:'unknown',prepared_guid:null})});assert.equal(race.status,204);}
  const result=await realFetch(url,init);
  if(fault==='lost-insert'&&method==='POST'&&result.ok)throw Error('PRIVATE-LOST-INSERT-REPLY');
  if(fault==='lost-finalize'&&method==='PATCH'&&result.ok)throw Error('PRIVATE-LOST-PATCH-REPLY');
  if(method==='PATCH'&&result.status!==204){const data=await result.clone().json();if(data===null||Array.isArray(data)&&data.length===0||data?.code==='PGRST116'&&/0 rows/.test(data.details??''))casMisses++;}
  return result;
 }
 return realFetch(url,init);
}
globalThis.fetch=guardedFetch;
const db=createClient(origin,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch}});
const get=async key=>{const result=await db.from('messaging_reaction_operations').select('*').eq('tenant_id',tenant).eq('idempotency_key',key);assert.equal(result.error,null);return result.data};
const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){effects++;assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/api/v1/reaction-operations/v1');assert.equal(request.headers.get('authorization'),'Bearer fixture-native-key');const raw=await request.text(),body=JSON.parse(raw),sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);assert.equal(sig[2],createHmac('sha256','fixture-native-signing').update(sig[1]+'.'+raw).digest('hex'));const persisted=await db.from('messaging_reaction_operations').select('*').eq('id',body.origin.slice(9)).single();assert.equal(persisted.error,null);assert.equal(persisted.data.state,'reserved');assert.equal(persisted.data.prepared_guid,null);assert.equal(persisted.data.target_guid,body.targetGuid);const fingerprint=createHash('sha256').update(JSON.stringify(['chert-reaction-once-v1',body.from,body.to,body.targetGuid,body.partIndex,body.reaction,body.remove]).replace(/\//g,'\\/')).digest('hex');assert.equal(persisted.data.fingerprint,fingerprint);if(nativeAckGate)await nativeAckGate;if(nativeMode==='unknown')return Response.json({error:{code:4103,retryable:false}},{status:502});return Response.json({...body,fingerprint,preparedGuid:prepared,state:'acknowledged'},{status:202});}});allowed.add(native.url.origin);
const args={supabase:db,tenantId:tenant,projectId:project,lineId:line,chatId:chat,from:'+15550000001',to:'+15550000002',targetGuid:target,partIndex:0,reaction:'love',remove:false};
const send=(key,change={})=>sendReservedReactionOperation({...args,idempotencyKey:key,...change});
try{
 const deadline=Date.now()+12000;for(;;){try{const r=await realFetch(origin+'/phone_lines?select=id',{headers});if(r.ok)break}catch{}assert.ok(Date.now()<deadline);await Bun.sleep(50)}
 assert.equal((await db.from('phone_lines').update({server_url:native.url.origin}).eq('id',line)).error,null);
 const first=await send('first');assert.equal(first.ok,true);assert.equal(effects,1);assert.equal(first.operationId,createHash('sha256').update(JSON.stringify(['chert-reaction-idempotency-v1',tenant,'first'])).digest('hex').slice(0,32));assert.equal((await get('first'))[0].created_at,first.createdAt);cases++;
 assert.deepEqual(await send('first',{tenantId:tenant.toUpperCase(),projectId:project.toUpperCase(),lineId:line.toUpperCase(),chatId:chat.toUpperCase()}),first);assert.equal(effects,1);cases++;
 for(const change of [{targetGuid:target.toUpperCase()},{to:'+15550000009'},{chatId:project},{lineId:project},{reaction:'like'},{remove:true}]){assert.equal((await send('first',change)).status,409);assert.equal(effects,1)}cases++;
 const secondTenant=await send('first',{tenantId:foreign});assert.equal(secondTenant.ok,true);assert.notEqual(secondTenant.operationId,first.operationId);assert.equal(effects,2);cases++;
 nativeMode='unknown';const unknown=await send('unknown');assert.equal(unknown.code,4103);const before=effects;assert.deepEqual(await send('unknown'),unknown);assert.equal(effects,before);assert.equal((await get('unknown'))[0].state,'unknown');nativeMode='ack';cases++;
 fault='lost-insert';const lost=await send('lost-insert');assert.equal(lost.code,4103);assert.equal(effects,before);fault='';assert.deepEqual(await send('lost-insert'),lost);assert.equal((await get('lost-insert'))[0].state,'reserved');cases++;
 let release;const ready=new Promise(resolve=>{release=resolve});barrier={count:0,ready,release};
 // Hold the winner before acknowledgement so the loser must observe reserved,
 // rather than legitimately replaying an already-finalized operation.
 let releaseNative;nativeAckGate=new Promise(resolve=>{releaseNative=resolve});
 const pendingConcurrent=[send('concurrent'),send('concurrent')];let concurrent;
 try{const loser=await Promise.race(pendingConcurrent);assert.equal(loser.ok,false);assert.equal(loser.code,4103);releaseNative();concurrent=await Promise.all(pendingConcurrent);}
 finally{releaseNative();nativeAckGate=null;}
assert.equal(effects,before+1);assert.equal(new Set(concurrent.map(r=>r.operationId)).size,1);assert.equal(concurrent.filter(r=>r.ok).length,1);assert.deepEqual(await send('concurrent'),concurrent.find(r=>r.ok));assert.equal(effects,before+1);cases++;
 for(const kind of ['reserve-commit','finalize-commit']){assert.equal((await db.from('fixture_reaction_faults').update({mode:kind}).eq('id',1)).error,null);const prior=effects,result=await send(kind);assert.equal(result.code,4103);assert.equal(effects,prior+(kind==='finalize-commit'?1:0));assert.equal((await db.from('fixture_reaction_faults').update({mode:'none'}).eq('id',1)).error,null);assert.equal((await get(kind)).length,kind==='reserve-commit'?0:1);if(kind==='finalize-commit'){assert.equal((await send(kind)).code,4103);assert.equal(effects,prior+1)}cases++;}
 for(const kind of ['cas-race','lost-finalize']){fault=kind;const prior=effects,result=await send(kind);assert.equal(result.code,4103);fault='';assert.equal(effects,prior+1);const replay=await send(kind);assert.equal(replay.ok,kind==='lost-finalize');assert.equal(effects,prior+1);cases++;}
 fault='read-failure';const prior=effects;assert.equal((await send('read-failure')).status,500);fault='';assert.equal(effects,prior);cases++;
 const saved=(await get('first'))[0];for(const role of ['anon','authenticated']){for(const method of ['GET','POST','PATCH','DELETE']){const r=await realFetch(origin+'/messaging_reaction_operations?id=eq.'+first.operationId,{method,headers:{authorization:'Bearer '+token(role),'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({...saved,id:'f'.repeat(32),idempotency_key:'denied'})}:method==='PATCH'?{body:JSON.stringify({state:'unknown'})}:{})});assert.ok([401,403].includes(r.status));}cases++;}
 const deniedDelete=await db.from('messaging_reaction_operations').delete().eq('id',first.operationId);assert.ok(deniedDelete.error);assert.deepEqual((await get('first'))[0],saved);cases++;
 for(const invalid of [{id:'f'.repeat(32)+'\n'},{sender:args.from+'\n'},{target_guid:target+'\n'},{part_index:-1},{reaction:'emoji'},{idempotency_key:''},{idempotency_key:'é'.repeat(101)},{prepared_guid:target,state:'acknowledged'}]){const r=await db.from('messaging_reaction_operations').insert({...saved,id:'e'.repeat(32),idempotency_key:'invalid',...invalid});assert.ok(r.error,'SQL check must reject invalid row');}cases++;

 // Actual Next handler/auth and actual database, no module substitution.
 process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=service;process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE='1';
 const app=resolve(import.meta.dir,'../../imessage-server');
 await plugin({name:'reaction-owned-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
 const route=await import('../../imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts');
 const{NextRequest}=await import('./next-route-platform.mjs');const{textOperationFingerprint}=await import('../../imessage-server/lib/sending/text-operation-fingerprint.ts');
 const messageId='b'.repeat(32),convoId='51ee0000-0000-4000-8000-000000000001',text='actual owned plaintext';
 assert.equal((await db.from('messaging_send_events').insert({id:messageId,tenant_id:tenant,lead_id:chat,convo_id:convoId,phone:args.to,phone_line_id:line,message_guid:target,request_payload:{message:{parts:[{type:'text',value:text}]}},response_payload:{mac_text_origin:'text_'+messageId,mac_text_protocol:'text-operations/v1',mac_text_from:args.from,mac_text_to:args.to,mac_text_fingerprint:textOperationFingerprint(args.from,args.to,text),mac_text_dispatch_state:'acknowledged',mac_message_guids:[target]}})).error,null);
 const inbound={id:'recv:stored-alias',guid:'22222222-3333-4444-8555-666666666666',role:'user',content:'inbound actual',service:'imessage'};
 assert.equal((await db.from('convo').update({messages:[inbound]}).eq('id',convoId)).error,null);
 const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{const pieces=new URL(request.url).pathname.split('/');return route.POST(new NextRequest(request),{params:Promise.resolve({id:pieces[4],messageId:decodeURIComponent(pieces[6])})});}});allowed.add(cloud.url.origin);
 let routeCases=0;
 async function react({id=messageId,key='route-'+routeCases,body={reaction:'love',part_index:0},auth='fixture-cloud-key',hmac=false}={}){routeCases++;const raw=JSON.stringify(body),ts=Math.floor(Date.now()/1000),headers={'content-type':'application/json','idempotency-key':key,...(auth?{authorization:'Bearer '+auth}:{})};if(hmac)Object.assign(headers,{'x-chert-tenant':'fixture','x-chert-signature':`v1,${ts},${createHmac('sha256','fixture-cloud-key').update(ts+'.'+raw).digest('hex')}`});const r=await fetch(cloud.url.origin+'/api/v1/chats/'+chat+'/messages/'+encodeURIComponent(id)+'/reactions',{method:'POST',headers,body:raw});return{status:r.status,body:await r.json()};}
 try{
  let beforeRoute=effects;const good=await react({key:'route-first'});assert.equal(good.status,202);assert.deepEqual(Object.keys(good.body).sort(),['chat_id','message_id','operation_id','status']);assert.equal(good.body.status,'acknowledged');assert.equal(good.body.message_id,messageId);assert.equal(effects,beforeRoute+1);assert.equal((await db.from('messaging_reaction_operations').select('*').eq('id',good.body.operation_id).single()).data.chat_id,chat);
  assert.deepEqual((await react({key:'route-first'})).body,good.body);assert.equal(effects,beforeRoute+1);
  const hmac=await react({key:'route-hmac',hmac:true});assert.equal(hmac.status,202);assert.equal(effects,beforeRoute+2);
  for(const options of [{auth:null},{auth:'fixture-foreign-key'},{body:{reaction:'love'}},{body:{reaction:'love',part_index:true}},{body:{reaction:'love',part_index:1}},{body:{reaction:'love',part_index:0,extra:true}},{id:'recv:unrecorded-prefix'},{id:'unknown'}]){const before=effects,r=await react(options);assert.ok(r.status>=400);assert.equal(effects,before);}
  const alias=await react({id:inbound.id,key:'inbound-alias'});assert.equal(alias.status,202);const nativeAlias=await react({id:inbound.guid,key:'inbound-alias'});assert.equal(nativeAlias.status,202);assert.equal(nativeAlias.body.operation_id,alias.body.operation_id);assert.equal(effects,beforeRoute+3);
  assert.equal((await db.from('convo').update({messages:[inbound,{...inbound,id:'duplicate'}]}).eq('id',convoId)).error,null);let before=effects;assert.equal((await react({id:inbound.guid})).status,404);assert.equal(effects,before);assert.equal((await db.from('convo').update({messages:[inbound]}).eq('id',convoId)).error,null);
  nativeMode='unknown';const uncertain=await react({key:'route-unknown'});assert.equal(uncertain.status,502);assert.equal(uncertain.body.error.code,4103);assert.equal(uncertain.body.error.retryable,false);assert.match(uncertain.body.operation_id,/^[a-f0-9]{32}$/);before=effects;assert.equal((await react({key:'route-unknown'})).body.operation_id,uncertain.body.operation_id);assert.equal(effects,before);nativeMode='ack';
  let releaseRoute;const readyRoute=new Promise(resolve=>{releaseRoute=resolve});barrier={count:0,ready:readyRoute,release:releaseRoute};before=effects;
  let releaseRouteNative;nativeAckGate=new Promise(resolve=>{releaseRouteNative=resolve});
  const pendingRace=[react({key:'route-concurrent'}),react({key:'route-concurrent'})];let race;
  try{const loser=await Promise.race(pendingRace);assert.equal(loser.status,502);assert.equal(loser.body.error.code,4103);releaseRouteNative();race=await Promise.all(pendingRace);}
  finally{releaseRouteNative();nativeAckGate=null;}
assert.equal(effects,before+1);assert.equal(new Set(race.map(r=>r.body.operation_id)).size,1);assert.equal(race.filter(r=>r.status===202).length,1);const completedReplay=await react({key:'route-concurrent'});assert.equal(completedReplay.status,202);assert.deepEqual(completedReplay.body,race.find(r=>r.status===202).body);assert.equal(effects,before+1);
  assert.equal((await db.from('phone_lines').update({phone_number:'+15550000009'}).eq('id',line)).error,null);before=effects;assert.equal((await react()).status,409);assert.equal(effects,before);assert.equal((await db.from('phone_lines').update({phone_number:args.from}).eq('id',line)).error,null);
  assert.equal((await db.from('messaging_tenants').update({is_active:false}).eq('id',tenant)).error,null);before=effects;assert.ok((await react()).status>=400);assert.equal(effects,before);assert.equal((await db.from('messaging_tenants').update({is_active:true}).eq('id',tenant)).error,null);
  assert.equal((await db.from('leads').update({details:{phone_line_id:line,is_group:true}}).eq('id',chat)).error,null);before=effects;assert.equal((await react()).status,501);assert.equal(effects,before);assert.equal((await db.from('leads').update({details:{phone_line_id:line}}).eq('id',chat)).error,null);
 }finally{cloud.stop(true)}
 cases+=routeCases;
 console.log(JSON.stringify({passed:true,cases,routeCases,nativePosts:effects,realPostgres:true,realPostgrest:true,actualMigration:25,migrationApplications:2,realCommitFaults:2,casMisses,dbMocks:0,liveNativeActions:0}));
}finally{native.stop(true);globalThis.fetch=realFetch;}
