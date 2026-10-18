// Generic typed clients, actual auth/recipient route and PostgreSQL; native HTTP is synthetic.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {statSync} from 'node:fs';
import {plugin} from 'bun';import {mock} from 'bun:test';
import {createClient} from '@supabase/supabase-js';
import {ChertClient,ChertAPIError} from '@chert/sdk';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
const root=resolve(import.meta.dir,'../..'),app=resolve(root,'imessage-server');
const target=new URL(process.env.CHERT_TEST_POSTGREST_URL??'');assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');assert.ok(target.port&&target.pathname==='/'&&!target.search&&!target.hash&&!target.username&&!target.password);
const rust=process.env.CHERT_TEST_RUST_TYPED_CLIENT,cpp=process.env.CHERT_TEST_CPP_TYPED_CLIENT,python=process.env.CHERT_TEST_PYTHON;
for(const path of [rust,cpp,python])assert.ok(path&&isAbsolute(path)&&statSync(path).isFile(),'All typed helpers required');
const jwt=process.env.CHERT_TEST_SERVICE_JWT;assert.ok(jwt);
const tenant='11000000-0000-4000-8000-000000000001',project='21000000-0000-4000-8000-000000000001',lead='41000000-0000-4000-8000-000000000001',line='61000000-0000-4000-8000-000000000001';
const peer='+15550000002',sender='+15550000001',key=randomBytes(32).toString('hex'),deviceKey=randomBytes(32).toString('hex'),signing=randomBytes(32).toString('hex');
let native,cloud,mode='ack',effects=0,cases=0,reservations=0;const realFetch=globalThis.fetch;
const guarded=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([target.origin,native?.url.origin,cloud?.url.origin].includes(url.origin));if(url.origin===target.origin&&url.pathname.startsWith('/rest/v1/'))url.pathname=url.pathname.slice('/rest/v1'.length);return realFetch(url,{...init,redirect:'error'});};globalThis.fetch=guarded;
const db=createClient(target.origin,jwt,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:guarded}});
await plugin({name:'typed-text-postgrest',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const pythonCode=`import json,sys,re
from urllib.parse import urlsplit
from chert import ChertClient,ChertAPIError
u=urlsplit(sys.argv[2]);assert sys.argv[1]=='--typed-text-fixture' and u.scheme=='http' and u.hostname=='127.0.0.1' and u.port and not u.path and not u.query and not u.fragment and not u.username
v=json.loads(sys.stdin.buffer.read(16385));assert set(v) in ({'api_key','phone','text'},{'api_key','phone','text','idempotency_key'}) and v['phone']=='+15550000002' and v['text'].startswith('CHERT-TYPED-TEXT-')
try:
 r=ChertClient(sys.argv[2],v['api_key'],timeout=10).send_text(v['phone'],v['text'],idempotency_key=v.get('idempotency_key'));print(json.dumps(r))
except ChertAPIError as e:
 r={'ok':False,'status':e.status,'code':e.code};d=e.data
 if isinstance(d,dict) and isinstance(d.get('message_id'),str) and re.fullmatch('[a-f0-9]{32}',d['message_id']) and isinstance(d.get('chat_id'),str) and re.fullmatch('[A-Za-z0-9:_-]{1,160}',d['chat_id']):r.update(message_id=d['message_id'],chat_id=d['chat_id'])
 print(json.dumps(r))`;
async function invoke(language,input){if(language==='javascript'){try{return await new ChertClient({baseURL:cloud.url.origin,apiKey:input.api_key,fetch:guarded}).sendText({phone:input.phone,body:input.text,...(Object.hasOwn(input,'idempotency_key')?{idempotency_key:input.idempotency_key}:{})});}catch(error){assert.ok(error instanceof ChertAPIError);const result={ok:false,status:error.status,code:error.code},data=error.data;if(data&&typeof data==='object'&&typeof data.message_id==='string'&&/^[a-f0-9]{32}$/.test(data.message_id)&&typeof data.chat_id==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(data.chat_id)){result.message_id=data.message_id;result.chat_id=data.chat_id;}return result;}}const argv=language==='python'?[python,'-c',pythonCode,'--typed-text-fixture',cloud.url.origin]:[language==='rust'?rust:cpp,'--typed-text-fixture',cloud.url.origin];const child=Bun.spawn(argv,{stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/bin:/bin',PYTHONPATH:resolve(root,'sdk/python')}});child.stdin.write(JSON.stringify(input));child.stdin.end();const timer=setTimeout(()=>child.kill(),15000);try{const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);assert.equal(code,0,'typed helper execution');assert.equal(err,'');return JSON.parse(out);}finally{clearTimeout(timer)}}
try{
 native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){assert.equal(req.method,'POST');assert.equal(new URL(req.url).pathname,'/api/v1/text-operations/v1');const raw=await req.text(),body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);assert.equal(body.from,sender);assert.equal(body.to,peer);assert.ok(body.text.startsWith('CHERT-TYPED-TEXT-'));assert.equal(req.headers.get('authorization'),'Bearer '+deviceKey);const [,ts,mac]=req.headers.get('x-chert-signature').split(',');assert.equal(mac,createHmac('sha256',signing).update(`${ts}.${raw}`).digest('hex'));
 const row=await db.from('messaging_send_events').select('*').eq('id',body.origin.slice(5));assert.equal(row.error,null);assert.equal(row.data.length,1);const saved=row.data[0];assert.equal(saved.tenant_id,tenant);assert.equal(saved.lead_id,lead);assert.equal(saved.phone_line_id,line);assert.equal(saved.phone,peer);assert.equal(saved.status,'processing');assert.deepEqual(saved.request_payload,{message:{parts:[{type:'text',value:body.text}]}});assert.equal(saved.response_payload.mac_text_dispatch_state,'reserved');assert.equal(saved.response_payload.mac_text_fingerprint,textOperationFingerprint(sender,peer,body.text));reservations++;effects++;
 if(mode==='lost')return Response.json({error:'synthetic unknown'},{status:502});return Response.json({origin:body.origin,from:sender,to:peer,fingerprint:mode==='malformed'?'0'.repeat(64):textOperationFingerprint(sender,peer,body.text),preparedGuid:randomUUID(),state:'acknowledged'},{status:202});}});
 for(const result of [await db.from('messaging_tenants').update({signing_secret:key,auto_create_leads:false}).eq('id',tenant),await db.from('phone_lines').insert({id:line,project_id:project,phone_number:sender,server_url:native.url.origin,api_key:deviceKey,signing_secret:signing,status:'active',health_status:'healthy'}),await db.from('leads').update({number:peer,project_id:project,messaging_tenant_id:tenant,convo_id:null,details:{phone_line_id:line},name:'Synthetic typed client'}).eq('id',lead)])assert.equal(result.error,null);
 const route=await import(resolve(app,'app/api/v1/text-operations/v1/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>route.POST(new NextRequest(req))});
 for(const language of ['javascript','python','rust','cpp']){
  const input={api_key:key,phone:peer,text:'CHERT-TYPED-TEXT-'+randomUUID(),idempotency_key:'typed-'+randomUUID()};mode='ack';let before=effects;const receipt=await invoke(language,input);assert.deepEqual(Object.keys(receipt).sort(),['chat_id','message_id','status','success']);assert.equal(receipt.status,'queued');assert.equal(receipt.success,true);assert.equal(receipt.chat_id,lead);assert.equal(effects,before+1);const stored=await db.from('messaging_send_events').select('id').eq('id',receipt.message_id);assert.equal(stored.data.length,1);cases++;
  assert.deepEqual(await invoke(language,input),receipt);assert.equal(effects,before+1);cases++;
  before=effects;const denied=await invoke(language,{...input,api_key:'synthetic-invalid'});assert.equal(denied.ok,false);assert.ok([401,404].includes(denied.status));assert.equal(effects,before);cases++;
  for(const fault of ['lost','malformed']){mode=fault;const failedInput={...input,text:'CHERT-TYPED-TEXT-'+randomUUID(),idempotency_key:'typed-'+randomUUID()};before=effects;const failed=await invoke(language,failedInput);assert.equal(failed.ok,false);assert.equal(failed.status,502);assert.equal(String(failed.code),'4103');assert.match(failed.message_id,/^[a-f0-9]{32}$/);assert.equal(failed.chat_id,lead);assert.equal(effects,before+1);const replay=await invoke(language,failedInput);assert.deepEqual(replay,failed);assert.equal(effects,before+1);cases++;}
 }
 console.log(JSON.stringify({passed:true,cases,languages:['javascript','python','rust','cpp'],realPostgREST:true,actualAuth:true,reservationBeforeEffect:true,nativeEffects:effects,reservedFingerprintChecks:reservations,liveMessages:0}));
}finally{if(cloud)await cloud.stop(true);if(native)await native.stop(true);globalThis.fetch=realFetch;}
