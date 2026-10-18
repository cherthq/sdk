// Actual tenant auth, both routes, shared mutation and HMAC forwarder over HTTP.
// DB reads and native typing effects are synthetic; no send/create/write is permitted.
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { plugin } from 'bun';
import { mock } from 'bun:test';
import Sendblue from '../packages/sendblue-adapter/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'direct-typing-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-tenant-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false,email:null};
const line={id:'line-a',project_id:'project-a',phone_number:'+15550000001',status:'active',signing_secret:'fixture-hmac',api_key:'fixture-bearer'};
const lead={id:'chat-a',convo_id:'convo-a',project_id:'project-a',messaging_tenant_id:'tenant-a',number:'+15550000002',details:{phone_line_id:line.id}};
const tables={messaging_tenants:[tenant],phone_lines:[line],leads:[lead]};
let lineQueries=0;let dbQueries=0,dbWrites=0,dbFailure=false,race=null,unreachable=false,deviceAttempts=0,nativeStatus=200,ackPatch={};
const get=(row,key)=>key.startsWith('details->>')?row.details?.[key.slice(10)]:row[key];
class Query{
 constructor(table){this.table=table;this.filters=[];this.keys=[];}select(){return this;}
 eq(k,v){this.keys.push(k);this.filters.push(row=>get(row,k)===v);return this;}
 is(k,v){this.filters.push(row=>v===null?get(row,k)==null:get(row,k)===v);return this;}
 limit(n){this.cap=n;return this;}maybeSingle(){this.one=true;return this;}
 insert(){dbWrites++;throw new Error('writes forbidden');}update(){dbWrites++;throw new Error('writes forbidden');}delete(){dbWrites++;throw new Error('writes forbidden');}
 then(yes,no){try{dbQueries++;if(this.table==='phone_lines')lineQueries++;if(dbFailure&&this.table!=='messaging_tenants')return Promise.resolve({data:null,error:{message:'fixture-private-db-error'}}).then(yes,no);
  if(race&&this.table==='leads'&&this.keys.includes('id')){const change=race;race=null;change();}
  let rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));if(this.cap)rows=rows.slice(0,this.cap);
  return Promise.resolve({data:structuredClone(this.one?rows[0]??null:rows),error:null}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const requests=[];let redirectTyping=false,redirectSinkPosts=0;
const device=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(new URL(req.url).pathname==='/redirect-sink'){redirectSinkPosts++;return Response.json({ok:true,applied:true});}
 const raw=await req.text();const match=/^v1,(\d+),([a-f0-9]{64})$/.exec(req.headers.get('x-chert-signature')??'');assert.ok(match);const expected=createHmac('sha256',line.signing_secret).update(`${match[1]}.${raw}`).digest('hex');assert.ok(timingSafeEqual(Buffer.from(match[2]),Buffer.from(expected)));assert.equal(req.headers.get('authorization'),`Bearer ${line.api_key}`);assert.equal(req.method,'POST');
 const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['from','isTyping','to']);assert.equal(typeof body.isTyping,'boolean');assert.equal(body.from,line.phone_number);assert.equal(decodeURIComponent(new URL(req.url).pathname),`/api/v1/chats/${body.to}/typing`);requests.push(body);
 if(redirectTyping)return new Response(null,{status:307,headers:{location:'/redirect-sink'}});
 return Response.json({ok:true,applied:true,chat_id:body.to,from:body.from,...ackPatch},{status:nativeStatus});
}});line.server_url=`http://127.0.0.1:${device.port}`;
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1');if(url.port===String(device.port)){deviceAttempts++;if(unreachable)throw new Error('fixture-private-network-error');}return originalFetch(input,init);};
const direct=await import(resolve(app,'app/api/v1/typing/route.ts'));
const chat=await import(resolve(app,'app/api/v1/chats/[id]/typing/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/api/v1/typing'?direct.POST(new NextRequest(req)):chat.POST(new NextRequest(req),{params:Promise.resolve({id:decodeURIComponent(new URL(req.url).pathname.split('/').at(-2))})})});
let cases=0;
const payload=()=>({from:line.phone_number,to:lead.details.sent_to_number||lead.number,state:'typing'});
async function call(body=payload(),path='/api/v1/typing',auth=true){cases++;const response=await fetch(`http://127.0.0.1:${cloud.port}${path}`,{method:'POST',headers:{...(auth?{authorization:'Bearer fixture-tenant-key'}:{}),'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
try{
 assert.equal((await call(payload(),undefined,false)).status,401);assert.equal(dbQueries,0);assert.equal(deviceAttempts,0);
 for(const state of ['typing','stopped']){const result=await call({...payload(),state});assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body).sort(),['applied','chat_id','from','state','to']);assert.equal(result.body.from,line.phone_number);assert.equal(result.body.to,lead.number);assert.equal(result.body.state,state);assert.equal(result.body.applied,true);assert.equal(requests.at(-1).isTyping,state==='typing');}
 const projectQueries=lineQueries,projectAttempts=deviceAttempts;tenant.crm_project_id=null;assert.equal((await call()).status,422);assert.equal(lineQueries,projectQueries);assert.equal(deviceAttempts,projectAttempts);tenant.crm_project_id='project-a';
 const beforeInvalid=deviceAttempts;
 for(const body of [null,[],{},'{bad',{...payload(),from:'15550000001'},{...payload(),to:'email@example.com'},{...payload(),state:'start'},{...payload(),duration:100},{...payload(),on:true}])assert.equal((await call(body)).status,400);
 assert.equal(deviceAttempts,beforeInvalid);
 let result=await call({...payload(),from:'+15550000009'});assert.equal(result.status,422);
 lead.details.phone_line_id='other-line';assert.equal((await call()).status,404);lead.details.phone_line_id='line-a';
 lead.project_id='other-project';assert.equal((await call()).status,404);lead.project_id='project-a';
 lead.messaging_tenant_id='other-tenant';assert.equal((await call()).status,404);lead.messaging_tenant_id='tenant-a';
 tables.leads.push({...structuredClone(lead),id:'ambiguous'});assert.equal((await call()).status,409);tables.leads.pop();
 lead.details.is_group=true;assert.equal((await call()).status,501);delete lead.details.is_group;
 assert.equal(deviceAttempts,beforeInvalid);
 lead.details.sent_to_number='+15550000003';assert.equal((await call({...payload(),to:lead.number})).status,404);result=await call();assert.equal(result.status,200);assert.equal(requests.at(-1).to,'+15550000003');delete lead.details.sent_to_number;
 for(const override of ['',null]){lead.details.sent_to_number=override;assert.equal((await call()).status,200);}delete lead.details.sent_to_number;
 for(const patch of [{from:undefined},{applied:false},{ok:false},{ok:1},{chat_id:'+15550000009'},{success:false},{from:'+15550000009'},{error:'fixture-private-native-error'},{error_message:'fixture-private-native-error'},{status:'failed'},{error_code:42}]){ackPatch=patch;result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));}ackPatch={};
 nativeStatus=501;result=await call();assert.equal(result.status,501);assert.equal(result.body.error.retryable,false);nativeStatus=200;
 unreachable=true;result=await call();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));unreachable=false;
 const beforeDB=deviceAttempts;dbFailure=true;assert.equal((await call()).status,500);dbFailure=false;assert.equal(deviceAttempts,beforeDB);
 race=()=>{lead.details.phone_line_id='line-changed';};assert.equal((await call()).status,409);lead.details.phone_line_id='line-a';assert.equal(deviceAttempts,beforeDB);
 race=()=>{lead.details.sent_to_number='+15550000003';};assert.equal((await call()).status,409);delete lead.details.sent_to_number;assert.equal(deviceAttempts,beforeDB);
 race=()=>{line.phone_number='+15550000009';};const oldPayload=payload();assert.equal((await call(oldPayload)).status,409);line.phone_number='+15550000001';assert.equal(deviceAttempts,beforeDB);
 for(const body of [{on:true},{state:'stopped'},{on:false,state:'stopped'}]){result=await call(body,'/api/v1/chats/chat-a/typing');assert.equal(result.status,200);assert.equal(result.body.applied,true);}
 for(const body of [{on:true,state:'stopped'},{state:'typing',duration:5},[],null])assert.equal((await call(body,'/api/v1/chats/chat-a/typing')).status,400);
 for(const [stored,expected] of [['alice@example.com','alice@example.com'],['Alice@EXAMPLE.com','alice@example.com'],['(555) 000-0002','+15550000002']]){lead.number=stored;result=await call({state:'typing'},'/api/v1/chats/chat-a/typing');assert.equal(result.status,200);assert.equal(requests.at(-1).to,expected);}lead.number='+15550000002';
 lead.details.is_group=null;assert.equal((await call({on:true},'/api/v1/chats/chat-a/typing')).status,200);delete lead.details.is_group;
 line.project_id='other-project';assert.equal((await call({on:true},'/api/v1/chats/chat-a/typing')).status,422);line.project_id='project-a';
 line.status='disabled';assert.equal((await call({on:true},'/api/v1/chats/chat-a/typing')).status,422);line.status='active';
 const sdk=new Sendblue({chert:{baseURL:`http://127.0.0.1:${cloud.port}`,apiKey:'fixture-tenant-key'}});
 for(const state of [undefined,'start','stop']){cases++;const result=await sdk.typingIndicators.send({from_number:line.phone_number,number:lead.number,...(state?{state}:{})});assert.deepEqual(result,{number:lead.number,status:'SENT'});assert.equal(requests.at(-1).isTyping,state!=='stop');}
 const sdkUnknownBefore=deviceAttempts;nativeStatus=502;ackPatch={ok:false,applied:null,error_code:4103,retryable:false,error:'fixture-private-uncertain'};cases++;await assert.rejects(async()=>sdk.typingIndicators.send({from_number:line.phone_number,number:lead.number}),error=>error.status===502);assert.equal(deviceAttempts,sdkUnknownBefore+1);nativeStatus=200;ackPatch={};
 const redirectBefore=deviceAttempts;redirectTyping=true;cases++;await assert.rejects(async()=>sdk.typingIndicators.send({from_number:line.phone_number,number:lead.number}),error=>error.status===502);assert.equal(deviceAttempts,redirectBefore+1);assert.equal(redirectSinkPosts,0);redirectTyping=false;
 const beforeSDK=deviceAttempts;ackPatch={applied:false};cases++;await assert.rejects(async()=>sdk.typingIndicators.send({from_number:line.phone_number,number:lead.number}),error=>error.status===502);assert.equal(deviceAttempts,beforeSDK+1);ackPatch={};
 assert.equal(dbWrites,0);
 console.log(JSON.stringify({passed:true,cases,deviceRequests:requests.length,deviceAttempts,dbWrites,liveTypingChanges:0,actualAuth:true,redirectSinkPosts}));
}finally{cloud.stop(true);device.stop(true);globalThis.fetch=originalFetch;}
