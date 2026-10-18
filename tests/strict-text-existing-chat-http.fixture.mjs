import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
// Real authentication, chat handler, strict text reservation and HMAC sender.
// Only database storage and the external native HTTP boundary are substituted.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'strict-text-existing-chat',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'10000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false};
const line={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001',project_id:'project-a',status:'active',health_status:'healthy',server_url:'https://device.invalid',signing_secret:'device-signing',api_key:'device-key'};
const lead={id:'chat-a',number:'+15550000002',messaging_tenant_id:tenant.id,project_id:'project-a',convo_id:'convo-a',details:{phone_line_id:line.id}};
const tables={messaging_tenants:[tenant],leads:[lead],phone_lines:[line],messaging_send_events:[]};
let writes=0,nativePosts=0,cases=0,mode='success',failRecording=false,finalizeMode='';
const guids=['550e8400-e29b-41d4-a716-446655440000'];
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}eq(k,v){if(k==='id')this.updatedId=v;this.filters.push(row=>typeof v==='string'&&['response_payload','request_payload','details'].includes(k)?JSON.stringify(row[k])===v:row[k]===v);return this;}in(k,v){this.filters.push(row=>v.includes(row[k]));return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}limit(){return this;}order(){return this;}
 insert(value){this.inserted=value;return this;}update(value){this.updated=value;return this;}
 then(yes,no){try{let rows=(tables[this.table]??[]).filter(row=>this.filters.every(f=>f(row)));if(this.inserted&&this.table==='messaging_send_events'&&failRecording)return Promise.resolve({data:null,error:{message:'fixture-db-failure'}}).then(yes,no);if(this.inserted){writes++;tables[this.table].push(this.inserted);rows=[this.inserted];if(this.table==='messaging_send_events'&&mode==='line-race')line.phone_number='+15550000009';}if(this.updated&&this.table==='messaging_send_events'){
 if(finalizeMode==='error')return Promise.resolve({data:null,error:{message:'private-finalize-error'}}).then(yes,no);
 if(finalizeMode==='zero')return Promise.resolve({data:null,error:null}).then(yes,no);
 if(finalizeMode==='concurrent'){const row=tables.messaging_send_events.find(row=>row.id===this.updatedId);if(row)row.response_payload={...row.response_payload,mac_text_dispatch_state:'operator-reconciled'};return Promise.resolve({data:null,error:null}).then(yes,no);}
}if(this.updated){writes++;rows.forEach(row=>Object.assign(row,this.updated));if(finalizeMode==='lost')return Promise.resolve({data:null,error:{message:'private-lost-response'}}).then(yes,no);}
return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
const db={from:table=>new Query(table),rpc:()=>{throw Error('Queued acknowledgement must not append transcript');}};
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));

const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const url=new URL(req.url);assert.equal(url.pathname,'/api/v1/text-operations/v1');assert.equal(url.search,'');assert.equal(req.method,'POST');nativePosts++;
 const raw=await req.text(),body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);assert.match(body.origin,/^text_[a-f0-9]{32}$/);assert.equal(body.from,'+15550000001');assert.equal(body.to,lead.details.sent_to_number??lead.number);assert.equal(body.text,'synthetic strict text');
 const row=tables.messaging_send_events.find(r=>r.id===body.origin.slice(5));assert.ok(row,'durable intent BEFORE effect');assert.equal(row.tenant_id,tenant.id);assert.equal(row.lead_id,lead.id);assert.equal(row.phone_line_id,line.id);assert.equal(row.phone,body.to);assert.equal(row.status,'processing');assert.equal(row.response_payload.mac_text_dispatch_state,'reserved');assert.equal(row.response_payload.mac_text_to,body.to);assert.deepEqual(row.request_payload,{message:{parts:[{type:'text',value:body.text}]}});
 const [version,ts,hash]=req.headers.get('x-chert-signature').split(',');assert.equal(version,'v1');assert.equal(hash,createHmac('sha256',line.signing_secret).update(`${ts}.${raw}`).digest('hex'));assert.equal(req.headers.get('authorization'),'Bearer device-key');
 if(mode==='lost')return new Response('private-native-secret',{status:502});if(mode==='malformed')return new Response('not-json',{status:202});
 const ack={origin:body.origin,from:body.from,to:body.to,fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:guids[0],state:'acknowledged'};
 if(mode==='wrong-peer')ack.to='+15550000009';if(mode==='unknown')ack.state='unknown';if(mode==='extra')ack.sent=true;
 return Response.json(ack,{status:202});
}});
line.server_url=`http://127.0.0.1:${native.port}`;
const route=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>route.POST(new NextRequest(req),{params:Promise.resolve({id:lead.id})})});
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:input);assert.ok([native.port,cloud.port].includes(Number(url.port))&&url.hostname==='127.0.0.1','No external or legacy transport');return originalFetch(input,init);};
async function post(headers={authorization:'Bearer fixture-key'}){cases++;const res=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/chats/chat-a/messages`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({message:{parts:[{type:'text',value:'synthetic strict text'}]}})});const body=await res.json();assert.ok(!JSON.stringify(body).includes('private-'));return{status:res.status,body};}
try{
 for(const [headers,status] of [[{},401],[{authorization:'Bearer wrong-key'},404]]){const result=await post(headers);assert.equal(result.status,status);assert.equal(nativePosts,0);}
 const good=await post();assert.equal(good.status,202);assert.equal(good.body.message.status,'queued');assert.equal(good.body.message.service,'unknown');assert.equal(good.body.message.delivered_at,null);assert.equal(good.body.message.read_at,null);assert.match(good.body.message.id,/^[a-f0-9]{32}$/);assert.equal(nativePosts,1);const saved=tables.messaging_send_events.find(r=>r.id===good.body.message.id);assert.equal(saved.response_payload.mac_text_dispatch_state,'acknowledged');assert.deepEqual(saved.response_payload.mac_message_guids,[guids[0]]);
 for(const [object,key,value]of[[line,'project_id','foreign'],[line,'status','disabled'],[lead,'project_id','foreign'],[lead,'messaging_tenant_id','foreign'],[lead,'details',{}],[lead,'details',{phone_line_id:line.id,is_group:true}],[lead,'details',{phone_line_id:line.id,service:'sms'}],[lead,'details',{phone_line_id:line.id,service:'rcs'}]]){const previous=object[key],before=nativePosts;object[key]=value;const result=await post();assert.ok(result.status>=400,`must refuse ${key} ${JSON.stringify(value)}`);assert.equal(nativePosts,before);object[key]=previous;}
 for(const failure of ['malformed','lost','wrong-peer','unknown','extra']){mode=failure;const before=nativePosts;const result=await post();assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.equal(nativePosts,before+1);const row=tables.messaging_send_events.find(r=>r.id===result.body.message_id);assert.ok(row);assert.equal(row.response_payload.mac_text_dispatch_state,'unconfirmed');assert.equal(result.body.chat_id,lead.id);}
 mode='success';failRecording=true;let before=nativePosts;assert.equal((await post()).status,500);assert.equal(nativePosts,before);failRecording=false;
 for(const failure of ['error','zero','concurrent']){finalizeMode=failure;before=nativePosts;const result=await post();assert.equal(result.status,502);assert.equal(nativePosts,before+1);assert.equal(result.body.error.retryable,false);const row=tables.messaging_send_events.find(r=>r.id===result.body.message_id);assert.ok(row);assert.equal(row.response_payload.mac_text_dispatch_state,failure==='concurrent'?'operator-reconciled':'reserved');}
 finalizeMode='';mode='line-race';before=nativePosts;const raced=await post();assert.equal(raced.status,502);assert.equal(nativePosts,before);assert.equal(raced.body.error.retryable,false);assert.ok(tables.messaging_send_events.some(r=>r.id===raced.body.message_id));line.phone_number='+15550000001';
 console.log(JSON.stringify({passed:true,cases,nativePosts,writes,actualAuth:true,actualHMAC:true,reservationBeforeEffect:true,legacyPosts:0}));
}finally{cloud.stop(true);native.stop(true);globalThis.fetch=originalFetch;}
