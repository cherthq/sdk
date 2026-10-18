// Real PostgreSQL + PostgREST + Supabase client + production wire journal/notifier.
// Only task-owned loopback services; schema is an explicit disposable approximation.
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
const origin=process.env.CHERT_TEST_JOURNAL_URL;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'postgrest-journal',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));}});
const {createClient}=await import('@supabase/supabase-js');
const {appendDeliveryAttempts,deliverVersionedSubscription,publicDeliveryAttempts}=await import('../../imessage-server/lib/messaging/webhook-delivery.ts');
const {deliverMessagingEvent}=await import('../../imessage-server/lib/messaging/webhook-deliver.ts');
const tenant='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002';
const secret='chert-disposable-journal-secret-at-least-32-bytes';
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const jwtBody=`${enc({alg:'HS256',typ:'JWT'})}.${enc({role:'service_role',exp:Math.floor(Date.now()/1000)+120})}`;
const token=`${jwtBody}.${createHmac('sha256',secret).update(jwtBody).digest('base64url')}`;
const realFetch=globalThis.fetch;
let barrier=null,casMisses=0,callbacks=0;
const allowedOrigins=new Set([origin]);
const guardedFetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.ok(allowedOrigins.has(url.origin),'unowned network origin forbidden');
 // Supabase client gateway prefix only: standalone PostgREST has no /rest/v1.
 if(url.origin===origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);
 const response=await realFetch(url,init);
 if(barrier&&url.pathname==='/messaging_events'&&(init?.method??'GET')==='GET'){
  const current=barrier;
  if(++current.arrivals===2){barrier=null;current.release();}
  await Promise.race([current.ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('CAS barrier deadline')),3000);timer.unref();})]);
 }
 if(url.pathname==='/messaging_events'&&init?.method==='PATCH'){const body=await response.clone().json();if(body===null||(Array.isArray(body)&&body.length===0)||(body?.code==='PGRST116'&&/0 rows/.test(body.details??'')))casMisses++;}
 return response;
};
globalThis.fetch=guardedFetch;
const db=createClient(origin,token,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch}});
const row=async id=>{const result=await db.from('messaging_events').select('*').eq('id',id).single();assert.equal(result.error,null);return result.data;};
let receiverStatus=400;const received=[];
const receiver=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 callbacks++;const raw=await request.text(),body=JSON.parse(raw);
 const persisted=await row(body.id);
 assert.ok(persisted.delivery_attempts.some(a=>a._wire?.prepared.body===raw),'snapshot durable before callback');
 const signature=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(request.headers.get('x-blooio-signature')??'');assert.ok(signature);
 assert.equal(signature[2],createHmac('sha256','callback-fixture-secret').update(`${signature[1]}.${raw}`).digest('hex'));
 const delivery=request.headers.get('x-blooio-delivery');assert.match(delivery,/^[0-9a-f-]{36}$/);
 received.push({raw,delivery});return new Response(null,{status:receiverStatus});
}});
allowedOrigins.add(`http://127.0.0.1:${receiver.port}`);
let cases=0;
try{
 const deadline=Date.now()+15000;while(true){try{const res=await guardedFetch(`${origin}/messaging_tenants?select=id`,{headers:{Authorization:`Bearer ${token}`}});if(res.ok)break;}catch{}assert.ok(Date.now()<deadline,'PostgREST readiness deadline');await Bun.sleep(100);}
 for(const authorization of [null,`Bearer ${jwtBody}.${token.split('.')[2].startsWith('a')?'b':'a'}${token.split('.')[2].slice(1)}`]){
  const denied=await guardedFetch(`${origin}/messaging_events?select=id`,{headers:authorization?{Authorization:authorization}:{}});assert.equal(denied.status,401);cases++;
 }
 const sub={id:randomUUID(),tenant_id:tenant,url:`http://127.0.0.1:${receiver.port}`,secret:'callback-fixture-secret',version:'blooio-v4/2026-10-01',events:['message_received'],is_active:true,consecutive_failures:0};
 assert.equal((await db.from('tenant_webhook_subscriptions').insert(sub)).error,null);
 const payload={chat_id:'chat-fixture',phone_line_id:'line-fixture',message:{guid:randomUUID(),role:'inbound',status:'received',recipient:'+15550000002',phone_line_id:'line-fixture',is_group:false,parts:[{type:'text',text:'fixture',value:'fixture'}],text:'fixture'}};
 const args={supabase:db,tenantId:tenant,eventType:'message_received',eventId:`recv:${payload.message.guid}`,payload,requireDelivery:true};
 await assert.rejects(deliverMessagingEvent(args),/callback delivery failed/);cases++;
 const first=await db.from('messaging_events').select('*').eq('tenant_id',tenant).single();assert.equal(first.error,null);const id=first.data.id;
 assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(first.data.delivery_attempts.length,1);assert.equal(first.data.delivery_attempts[0].status,400);assert.equal(callbacks,1);cases++;
 receiverStatus=200;
 const result=await deliverVersionedSubscription({supabase:db,tenantId:tenant,eventRowId:id,subscription:sub});assert.equal(result.ok,true);assert.equal(callbacks,2);assert.deepEqual(received[1],received[0]);cases++;
 const noRepeat=await deliverVersionedSubscription({supabase:db,tenantId:tenant,eventRowId:id,subscription:sub});assert.equal(noRepeat.attempts,0);assert.equal(callbacks,2);cases++;
 const replay=await deliverVersionedSubscription({supabase:db,tenantId:tenant,eventRowId:id,subscription:sub,replay:true});assert.equal(replay.ok,true);assert.equal(received[2].raw,received[0].raw);assert.notEqual(received[2].delivery,received[0].delivery);cases++;
 await assert.rejects(deliverVersionedSubscription({supabase:db,tenantId:foreign,eventRowId:id,subscription:sub}),/persistence unavailable/);assert.equal(callbacks,3);cases++;
 await assert.rejects(deliverMessagingEvent({...args,payload:{...payload,extra:'conflict'}}));assert.equal(callbacks,3);cases++;
 let release;const ready=new Promise(r=>release=r);barrier={arrivals:0,release,ready};
 const attempt=n=>({at:new Date().toISOString(),status:200,duration_ms:n,subscription_id:randomUUID()});const a=attempt(1),b=attempt(2);
 await Promise.all([appendDeliveryAttempts(db,tenant,id,[a]),appendDeliveryAttempts(db,tenant,id,[b])]);
 const final=await row(id);assert.equal(final.delivery_attempts.length,4);assert.ok(final.delivery_attempts.some(x=>x.subscription_id===a.subscription_id));assert.ok(final.delivery_attempts.some(x=>x.subscription_id===b.subscription_id));assert.ok(casMisses>=1,'real PostgREST zero-row CAS exercised');cases++;
 assert.ok(publicDeliveryAttempts(final.delivery_attempts).every(a=>!('_wire'in a)));cases++;
 const bad=await db.from('messaging_events').select('id').eq('id','not-a-uuid');assert.equal(bad.error?.code,'22P02');cases++;
 const contained=await db.from('messaging_events').select('id').contains('payload',{message:{guid:payload.message.guid}});assert.equal(contained.error,null);assert.deepEqual(contained.data,[{id}]);cases++;
 console.log(JSON.stringify({ok:true,cases,callbackPosts:callbacks,casMisses,realPostgres:true,realPostgrest:true,dbMocks:0,liveNativeActions:0}));
}finally{receiver.stop(true);globalThis.fetch=realFetch;}
