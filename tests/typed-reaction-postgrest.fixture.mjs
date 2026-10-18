// Actual four typed clients -> actual authenticated Chert reaction POST
// -> real migration25/PostgREST. Only native HTTP ACKs are synthetic; no device.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {statSync} from 'node:fs';
import {plugin} from 'bun';
const origin=process.env.CHERT_TEST_JOURNAL_URL;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const {createClient}=await import('@supabase/supabase-js');
const secret='chert-disposable-journal-secret-at-least-32-bytes';
const tenant='11aa0000-0000-4000-8000-000000000001',line='61cc0000-0000-4000-8000-000000000001';
const chat='41dd0000-0000-4000-8000-000000000001',convo='51ee0000-0000-4000-8000-000000000001';
const target='a1111111-2222-4333-8444-555555555555';
const rawMessage={id:'Recorded:Exact.Target_1',guid:target,role:'user',content:'actual owned plaintext',service:'imessage'};
const rust=process.env.CHERT_TEST_RUST_REACTION_CLIENT,cpp=process.env.CHERT_TEST_CPP_REACTION_CLIENT,python=process.env.CHERT_TEST_PYTHON;
for(const path of [rust,cpp,python])assert.ok(path&&isAbsolute(path)&&statSync(path).isFile(),'All explicit local typed helpers required');
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
let nativePosts=0,getRequests=0,reactionRequests=0,cases=0,mode='ack',expectedNative=null;
const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 nativePosts++;
 assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/api/v1/reaction-operations/v1');
 assert.equal(request.headers.get('authorization'),'Bearer fixture-native-key');
 const raw=await request.text(),body=JSON.parse(raw);
 assert.deepEqual(Object.keys(body).sort(),['from','origin','partIndex','reaction','remove','targetGuid','to']);
 assert.equal(body.from,'+15550000001');assert.equal(body.to,'+15550000002');assert.equal(body.targetGuid,target);assert.equal(body.partIndex,0);
 assert.deepEqual({reaction:body.reaction,remove:body.remove},expectedNative);
 const sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);
 assert.equal(sig[2],createHmac('sha256','fixture-native-signing').update(sig[1]+'.'+raw).digest('hex'));
 const fingerprint=createHash('sha256').update(JSON.stringify(['chert-reaction-once-v1',body.from,body.to,body.targetGuid,body.partIndex,body.reaction,body.remove]).replace(/\//g,'\\/')).digest('hex');
 const row=await db.from('messaging_reaction_operations').select('*').eq('id',body.origin.slice(9)).single();
 assert.equal(row.error,null);assert.equal(row.data.state,'reserved');assert.equal(row.data.tenant_id,tenant);
 assert.equal(row.data.fingerprint,fingerprint);assert.equal(row.data.prepared_guid,null);
 assert.equal(row.data.target_guid,target);assert.equal(row.data.chat_id,chat);assert.equal(row.data.phone_line_id,line);
 assert.equal(row.data.sender,body.from);assert.equal(row.data.recipient,body.to);assert.equal(row.data.part_index,0);
 assert.equal(row.data.reaction,body.reaction);assert.equal(row.data.remove,body.remove);
 return Response.json({...body,fingerprint:mode==='malformed'?'f'.repeat(64):fingerprint,preparedGuid:randomUUID(),state:'acknowledged'},{status:202});
}});allowed.add(native.url.origin);
process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=service;
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'typed-real-reaction-routes',setup(build){
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const {NextRequest}=await import('./next-route-platform.mjs');
const reactionRoute=await import('../../imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts');
const {ChertClient,ChertAPIError}=await import('../packages/sdk/src/index.ts');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const parts=new URL(request.url).pathname.split('/');
 if(request.method==='POST'&&parts.length===8&&parts[3]==='chats'&&parts[5]==='messages'&&parts[7]==='reactions'){
  assert.equal(parts[4],chat);assert.equal(parts[6],'Recorded%3AExact.Target_1');
  reactionRequests++;return reactionRoute.POST(new NextRequest(request),{params:Promise.resolve({id:parts[4],messageId:decodeURIComponent(parts[6])})});
 }
 return Response.json({error:'unsupported fixture route'},{status:404});
}});allowed.add(cloud.url.origin);
async function update(table,body,id){const r=await db.from(table).update(body).eq('id',id);assert.equal(r.error,null);}
async function invoke(language,input){
 if(language==='javascript'){
  try{return await new ChertClient({baseURL:cloud.url.origin,apiKey:input.api_key}).sendReaction(input.chat_id,input.message_id,
   {reaction:input.reaction,remove:input.remove},{idempotencyKey:input.idempotency_key});}
  catch(error){if(error instanceof TypeError)return{invalid:true};assert.ok(error instanceof ChertAPIError);
   return{ok:false,status:error.status,code:error.code==='4103'?'4103':'request_failed',
    ...(error.data&&typeof error.data==='object'&&typeof error.data.operation_id==='string'&&/^[a-f0-9]{32}$/.test(error.data.operation_id)?{operation_id:error.data.operation_id}:{})};}
 }
 const argv=language==='python'?[python,resolve(import.meta.dir,'../python/tests/reaction_fixture.py'),'--typed-reaction-fixture',cloud.url.origin]
  :[language==='rust'?rust:cpp,'--typed-reaction-fixture',cloud.url.origin];
 const child=Bun.spawn(argv,{stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/bin:/bin',PYTHONPATH:resolve(import.meta.dir,'../python')}});
 child.stdin.write(JSON.stringify(input));child.stdin.end();const timer=setTimeout(()=>child.kill(),10000);
 try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  assert.equal(err,'','No helper private diagnostics');if(code===2){assert.equal(out,'');return{invalid:true};}
  assert.equal(code,0,'Local helper failed');assert.ok(out.length<=4096);return JSON.parse(out);
 }finally{clearTimeout(timer)}
}
try{
 const deadline=Date.now()+12000;
 for(;;){try{const r=await realFetch(origin+'/phone_lines?select=id',{headers:{authorization:'Bearer '+service}});if(r.ok)break}catch{}assert.ok(Date.now()<deadline,'Local PostgREST readiness deadline');await Bun.sleep(50)}
 await update('phone_lines',{server_url:native.url.origin},line);
 await update('convo',{messages:[rawMessage]},convo);
 for(const language of ['javascript','python','rust','cpp']){
  const base={api_key:'fixture-cloud-key',chat_id:chat.toUpperCase(),message_id:rawMessage.id,reaction:'like',remove:false,idempotency_key:language+'-add'};
  mode='ack';expectedNative={reaction:'like',remove:false};let before=nativePosts,p=reactionRequests;
  const first=await invoke(language,base);
  assert.deepEqual(Object.keys(first).sort(),['chat_id','message_id','operation_id','status']);
  assert.equal(first.chat_id,chat);assert.equal(first.message_id,rawMessage.id);assert.equal(first.status,'acknowledged');assert.match(first.operation_id,/^[a-f0-9]{32}$/);
  assert.equal(nativePosts,before+1);assert.equal(reactionRequests,p+1);cases++;
  assert.deepEqual(await invoke(language,base),first);assert.equal(nativePosts,before+1);cases++;
  expectedNative={reaction:'like',remove:true};
  const removed=await invoke(language,{...base,remove:true,idempotency_key:language+'-remove'});
  assert.equal(removed.status,'acknowledged');assert.notEqual(removed.operation_id,first.operation_id);assert.equal(nativePosts,before+2);cases++;
  for(const api_key of ['wrong-key','fixture-foreign-key']){before=nativePosts;const denied=await invoke(language,{...base,api_key});
   assert.equal(denied.ok,false);assert.equal(denied.status,404);assert.equal(nativePosts,before);cases++;}
  for(const patch of [{reaction:'custom'},{idempotency_key:' bad header key'}]){
   before=nativePosts;p=reactionRequests;assert.deepEqual(await invoke(language,{...base,...patch}),{invalid:true});
   assert.equal(nativePosts,before);assert.equal(reactionRequests,p);cases++;
  }
  mode='malformed';expectedNative={reaction:'like',remove:false};before=nativePosts;const input={...base,idempotency_key:language+'-unknown'};
  const unknown=await invoke(language,input);assert.equal(unknown.ok,false);assert.equal(unknown.status,502);assert.equal(unknown.code,'4103');
  assert.match(unknown.operation_id,/^[a-f0-9]{32}$/);assert.equal(nativePosts,before+1);cases++;
  assert.deepEqual(await invoke(language,input),unknown);assert.equal(nativePosts,before+1);cases++;
 }
 const rows=await db.from('messaging_reaction_operations').select('id,state');assert.equal(rows.error,null);
 assert.equal(rows.data.length,12);assert.equal(rows.data.filter(r=>r.state==='acknowledged').length,8);assert.equal(rows.data.filter(r=>r.state==='unknown').length,4);
 assert.equal(nativePosts,12);assert.equal(getRequests,0);
 console.log(JSON.stringify({passed:true,cases,languages:['javascript','python','rust','cpp'],nativePosts,getRequests,reactionRequests,
  realPostgres:true,realPostgrest:true,actualMigration:25,actualAuth:true,reservationBeforeEffect:true,dbMocks:0,liveNativeActions:0}));
}finally{cloud.stop(true);native.stop(true);globalThis.fetch=realFetch;}
