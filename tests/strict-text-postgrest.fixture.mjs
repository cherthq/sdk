import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
// Actual PostgreSQL/PostgREST + Supabase + production strict-text helper.
// Cross-protocol races with legacy /send remain outside this strict deterministic-ID fence.
// Native HTTP is loopback synthetic. Does NOT exercise cloud authentication/native messaging.
import assert from 'node:assert/strict';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {sendReservedTextOperation} from '../../imessage-server/lib/sending/text-operation.ts';
const target=new URL(process.env.CHERT_TEST_POSTGREST_URL??'');
assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');
assert.ok(target.port&&target.pathname==='/'&&!target.username&&!target.password&&!target.search&&!target.hash);
const jwt=process.env.CHERT_TEST_SERVICE_JWT;assert.ok(jwt&&jwt.split('.').length===3);
const realFetch=globalThis.fetch;let nativeOrigin,barrier=null,loseReservation=false,restRequests=0;
const guardedFetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.ok([target.origin,nativeOrigin].includes(url.origin),'Only owned loopback endpoints allowed');
 if(url.origin===target.origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);
 if(url.origin===target.origin){
  restRequests++;
  if(barrier&&url.pathname==='/messaging_send_events'&&init?.method==='POST'){
   const current=barrier;if(++current.arrivals===2){barrier=null;current.release();}
   await Promise.race([current.ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Insert barrier deadline')),3000);timer.unref();})]);
  }
 }
 const response=await realFetch(url,{...init,redirect:'error'});
 if(url.origin===nativeOrigin&&nativeMode==='lost-ack'){await response.body?.cancel();throw Error('Synthetic lost native acknowledgement');}
 if(loseReservation&&url.origin===target.origin&&url.pathname==='/messaging_send_events'&&init?.method==='POST'){
  loseReservation=false;await response.body?.cancel();throw Error('Synthetic lost reservation response');
 }
 return response;
};
globalThis.fetch=guardedFetch;
const db=createClient(target.origin,jwt,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guardedFetch}});
const tenant='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002',project='21000000-0000-4000-8000-000000000001',line='61000000-0000-4000-8000-000000000001',lead='41000000-0000-4000-8000-000000000001';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=(owner,key)=>hash(JSON.stringify(['chert-text-idempotency-v1',owner,key])).slice(0,32);
async function rows(messageId){const result=await db.from('messaging_send_events').select('*').eq('id',messageId);assert.equal(result.error,null);return result.data;}
async function mode(value){const result=await db.from('strict_text_fault').update({mode:value}).eq('mode',currentFault);assert.equal(result.error,null);currentFault=value;}
let currentFault='none',nativeMode='ack',nativeEffects=0,cases=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 assert.equal(request.method,'POST');const url=new URL(request.url);assert.equal(url.pathname,'/api/v1/text-operations/v1');assert.equal(url.search,'');
 assert.equal(request.headers.get('authorization'),'Bearer fixture-native-key');
 const raw=await request.text(),body=JSON.parse(raw);
 assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);
 assert.equal(body.from,'+15550000001');assert.equal(body.to,'+15550000002');
 assert.match(body.origin,/^text_[a-f0-9]{32}$/);
 const sig=/^v1,([0-9]+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);
 assert.equal(sig[2],createHmac('sha256','fixture-native-signing').update(`${sig[1]}.${raw}`).digest('hex'));
 const durable=await rows(body.origin.slice(5));assert.equal(durable.length,1);
 assert.equal(durable[0].response_payload.mac_text_origin,body.origin);
 assert.equal(durable[0].response_payload.mac_text_dispatch_state,'reserved');
 assert.equal(durable[0].request_payload.message.parts[0].value,body.text);
 nativeEffects++;
 if(nativeMode==='unknown')return Response.json({error:{code:4103,retryable:false}},{status:502});
 return Response.json({origin:body.origin,from:body.from,to:body.to,
  fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:randomUUID(),state:'acknowledged'},{status:202});
}});nativeOrigin=server.url.origin;
const args={supabase:db,tenantId:tenant,projectId:project,lineId:line,from:'+15550000001',to:'+15550000002',text:'strict fixture',leadId:lead,convoId:null};
const send=(key,extra={})=>sendReservedTextOperation({...args,idempotencyKey:key,...extra});
try{
 let result=await db.from('phone_lines').insert({id:line,project_id:project,phone_number:args.from,server_url:nativeOrigin,api_key:'fixture-native-key',signing_secret:'fixture-native-signing',status:'active'});assert.equal(result.error,null);
 let first=await send('success');assert.equal(first.ok,true);assert.equal(first.messageId,id(tenant,'success'));assert.equal(nativeEffects,1);cases++;
 let replay=await send('success');assert.equal(replay.ok,true);assert.equal(replay.messageId,first.messageId);assert.equal(nativeEffects,1);cases++;
 const conflict=await send('success',{text:'different body'});assert.equal(conflict.ok,false);assert.equal(conflict.status,409);assert.equal(nativeEffects,1);cases++;
 nativeMode='unknown';first=await send('lost-native-ack');assert.equal(first.ok,false);assert.equal(first.code,4103);replay=await send('lost-native-ack');assert.equal(replay.messageId,first.messageId);assert.equal(replay.ok,false);assert.equal(nativeEffects,2);nativeMode='ack';cases++;
 let release;const ready=new Promise(resolve=>{release=resolve;});barrier={arrivals:0,release,ready};
 const concurrent=await Promise.all([send('concurrent'),send('concurrent')]);assert.equal(nativeEffects,3);assert.ok(concurrent.some(value=>value.ok));assert.ok(concurrent.every(value=>value.messageId===id(tenant,'concurrent')));assert.equal((await rows(id(tenant,'concurrent'))).length,1);cases++;
 const isolated=await send('success',{tenantId:foreign});assert.equal(isolated.ok,true);assert.equal(isolated.messageId,id(foreign,'success'));assert.notEqual(isolated.messageId,id(tenant,'success'));assert.equal(nativeEffects,4);cases++;
 await mode('reserve_commit');first=await send('reserve-commit');assert.equal(first.ok,false);assert.equal((await rows(id(tenant,'reserve-commit'))).length,0);assert.equal(nativeEffects,4);await mode('none');cases++;
 await mode('finalize_commit');first=await send('finalize-commit');assert.equal(first.ok,false);assert.equal(first.code,4103);assert.equal(nativeEffects,5);assert.equal((await rows(id(tenant,'finalize-commit')))[0].response_payload.mac_text_dispatch_state,'reserved');await mode('none');replay=await send('finalize-commit');assert.equal(replay.ok,false);assert.equal(replay.messageId,first.messageId);assert.equal(nativeEffects,5);cases++;
 result=await db.from('messaging_send_events').insert({id:'f'.repeat(32),tenant_id:tenant,idempotency_key:'legacy-key',status:'ok',phone:args.to});assert.equal(result.error,null);
 first=await send('legacy-key');assert.equal(first.ok,false);assert.equal(first.status,409);assert.equal(nativeEffects,5);cases++;
 first=await send('fresh-key');assert.equal(first.ok,true);assert.equal(nativeEffects,6);cases++;
 loseReservation=true;first=await send('lost-reservation-response');assert.equal(first.ok,false);assert.equal(first.messageId,id(tenant,'lost-reservation-response'));replay=await send('lost-reservation-response');assert.equal(replay.ok,false);assert.equal(replay.messageId,first.messageId);assert.equal(nativeEffects,6);cases++;
 nativeMode='lost-ack';first=await send('lost-successful-ack');assert.equal(first.ok,false);assert.equal(first.code,4103);assert.equal(nativeEffects,7);nativeMode='ack';replay=await send('lost-successful-ack');assert.equal(replay.ok,false);assert.equal(replay.messageId,first.messageId);assert.equal(nativeEffects,7);cases++;
 console.log(JSON.stringify({passed:true,cases,realPostgREST:true,realCommitFaults:2,nativeEffects,liveMessages:0,moduleMocks:0,restRequests}));
}finally{server.stop(true);globalThis.fetch=realFetch;}
