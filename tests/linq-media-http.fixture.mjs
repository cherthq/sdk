// Real authentication, chat handler, attachment ownership and HMAC sender.
// Only database storage and the external native HTTP boundary are substituted.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import Linq from '../packages/linq-adapter/src/index.ts';
process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE='1';

import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'chat-media-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'10000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false};
const line={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001',project_id:'project-a',status:'active',health_status:'healthy',server_url:'https://device.invalid',signing_secret:'device-signing',api_key:'device-key'};
const lead={id:'chat-a',number:'+15550000002',messaging_tenant_id:tenant.id,project_id:'project-a',convo_id:'convo-a',details:{phone_line_id:line.id}};
const attachment={attachment_id:'a'.repeat(48),content_type:'image/png',size_bytes:4,filename:'image.png',tenant_id:tenant.id,uploaded_at:'2026-10-17T00:00:00Z'};
const tables={messaging_tenants:[tenant],leads:[lead],phone_lines:[line],messaging_attachments:[],messaging_send_events:[],convo:[{id:'convo-a',lead_id:lead.id,messages:[]}]};
let writes=0,nativePosts=0,nativeQueries=0,cases=0,mode='queued';
const guids=['550e8400-e29b-41d4-a716-446655440000','650e8400-e29b-41d4-a716-446655440000'];
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}eq(k,v){this.filters.push(row=>['response_payload','request_payload'].includes(k)&&typeof v==='string'?JSON.stringify(row[k])===v:row[k]===v);return this;}in(k,v){this.filters.push(row=>v.includes(row[k]));return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}limit(){return this;}order(){return this;}filter(k,op,v){assert.equal(op,'cs');const wanted=JSON.parse(v);this.filters.push(row=>Object.entries(wanted).every(([key,value])=>row[k]?.[key]===value));return this;}
 insert(value){this.inserted=value;return this;}update(value){this.updated=value;return this;}
 then(yes,no){try{let rows=(tables[this.table]??[]).filter(row=>this.filters.every(f=>f(row)));if(this.inserted){writes++;const inserted={created_at:'2026-10-18T00:00:00.000Z',updated_at:'2026-10-18T00:00:00.000Z',...this.inserted};tables[this.table].push(inserted);rows=[inserted];}if(this.updated){writes++;rows.forEach(row=>Object.assign(row,this.updated,{updated_at:'2026-10-18T00:01:00.000Z'}));}return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
const db={from:table=>new Query(table),rpc:async(name,args)=>{assert.equal(name,'append_convo_message');writes++;tables.convo[0].messages.push(args.p_message);return{data:tables.convo[0].messages,error:null};}};
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
mock.module(resolve(app,'lib/supabase.ts'),()=>({createServiceClient:()=>db}));
const blobs=new Map();let stores=0,downloads=0;
mock.module(resolve(app,'lib/supabase-storage.ts'),()=>({attachmentBlobPath:(tenant,id,name)=>`messaging-attachments/${tenant}/${id}/${name}`,attachmentChunkFolder:()=>'',attachmentChunkPath:()=>'',uploadAttachmentAtPath:async(path,bytes)=>{stores++;blobs.set(path,Buffer.from(bytes));return{path};},downloadAttachmentForCapability:async(path,expected)=>{downloads++;const bytes=blobs.get(path);assert.equal(bytes?.length,expected);return bytes;},downloadAttachmentAtPath:()=>{throw Error('unbounded read forbidden');},fetchAttachmentRangeByPath:()=>{throw Error('unused');},listAttachmentFolder:()=>{throw Error('unused');},removeAttachmentPaths:()=>{throw Error('unused');}}));
let evidenceMode='queued';const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const url=new URL(req.url);assert.equal(req.headers.get('authorization'),'Bearer device-key');
 if(req.method==='GET'){nativeQueries++;if(url.pathname.startsWith('/api/v1/attachment-operations/v1/')){assert.equal(url.searchParams.get('from'),line.phone_number);return Response.json({origin:url.pathname.split('/').at(-1),found:false},{status:404});}if(url.pathname.startsWith('/api/v1/messages/'))return Response.json({message_id:'msg_caption',guid:guids[1],fallback_owner:'none',status:'sent'});const guid=url.pathname.split('/').at(-1);assert.ok(guids.includes(guid));assert.equal(url.searchParams.get('recipient'),lead.number);const positive=evidenceMode!=='queued'&&!(evidenceMode==='partial'&&guid===guids[1]);return Response.json({evidence_source:'chat_db_exact_guid',guid,recipient:lead.number,sender:line.phone_number,service:'imessage',has_attachments:guid===guids[0],is_sent:positive,is_delivered:['delivered','read'].includes(evidenceMode),is_read:evidenceMode==='read',...(['delivered','read'].includes(evidenceMode)?{delivered_at:1700000000000}:{}),...(evidenceMode==='read'?{read_at:1700000001000}:{})});}
 assert.equal(req.method,'POST');const versioned=url.pathname==='/api/v1/attachment-operations/v1';assert.ok(versioned||url.pathname==='/api/v1/send');nativePosts++;const raw=await req.text(),wire=JSON.parse(raw),body=versioned?{attachments:[{id:wire.attachment_id}],phone:wire.to,lead_id:lead.id}:wire,[,ts,mac]=req.headers.get('x-chert-signature').split(',');assert.equal(mac,createHmac('sha256',line.signing_secret).update(`${ts}.${raw}`).digest('hex'));assert.deepEqual(body.attachments,[{id:attachment.attachment_id}]);assert.equal(body.phone,lead.number);assert.equal(body.lead_id,lead.id);assert.ok(body.body===undefined||body.body==='caption');
 if(versioned){assert.deepEqual(Object.keys(wire).sort(),['attachment_id','from','origin','to']);assert.equal(wire.from,line.phone_number);assert.match(wire.origin,/^media_[a-f0-9]{32}$/);const intent=tables.messaging_send_events.find(row=>row.id===wire.origin.slice(6));assert.ok(intent);assert.equal(intent.response_payload.mac_media_from,wire.from);assert.equal(intent.response_payload.mac_media_dispatch_state,'reserved');}
 if(mode==='uncertain')return Response.json({success:false,error:'private-native-error'},{status:502});
 const ack={success:true,status:body.body?'queued':'sent',delivery:body.body?'queued':'direct',message_id:body.body?'msg_caption':guids[0],fallback_owner:'none',attachments:mode==='partial'?[]:[{id:attachment.attachment_id,message_id:guids[0]}]};return Response.json(versioned?(mode==='partial'?{...wire,state:'unknown'}:{...wire,fingerprint:'f'.repeat(64),preparedGuid:guids[0],state:'acknowledged'}):ack,{status:versioned?202:body.body?202:200});
}});line.server_url=native.url.origin;
const metadata=await import(resolve(app,'app/api/v1/attachments/[id]/route.ts')),route=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts')),statusRoute=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const register=await import(resolve(app,'app/api/v1/attachments/route.ts')),upload=await import(resolve(app,'app/api/v1/attachments/[id]/upload/route.ts')),download=await import(resolve(app,'app/api/v1/attachments/[id]/download/route.ts'));
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const url=new URL(req.url),context={params:Promise.resolve({id:url.pathname.split('/')[4]})},request=new NextRequest(req);if(url.pathname==='/api/v1/attachments')return register.POST(request);if(url.pathname.endsWith('/upload'))return upload.PUT(request,context);if(url.pathname.endsWith('/download'))return download.GET(request,context);if(url.pathname.startsWith('/api/v1/attachments/'))return metadata.GET(request,context);if(req.method==='POST')return route.POST(request,{params:Promise.resolve({id:lead.id})});return statusRoute.GET(request,{params:Promise.resolve({id:url.pathname.split('/').at(-1)})});}});
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([cloud.url.origin,native.url.origin].includes(url.origin),'no external fetch');return originalFetch(input,init);};
let chertRequests=0;const client=new Linq({chert:{baseURL:cloud.url.origin,apiKey:'fixture-key',fetch:(i,o)=>{chertRequests++;return globalThis.fetch(i,o);}}});
// GET renews public capability URLs from the current second. Keep baseline reads
// in one deterministic second; expiry/rotation scenarios below advance it explicitly.
const realDateNow=Date.now,baselineNow=Math.floor(realDateNow()/1000)*1000;
Date.now=()=>baselineNow;
try{
 cases++;const created=await client.attachments.create({filename:'image.png',content_type:'image/png',size_bytes:4});Object.assign(attachment,tables.messaging_attachments[0]);assert.equal(created.attachment_id,attachment.attachment_id);
 cases++;const put=await fetch(created.upload_url,{method:'PUT',headers:created.required_headers,body:new Uint8Array([1,2,3,4])});assert.equal(put.status,200);assert.equal(stores,1);
 const before=nativePosts,beforeChert=chertRequests;cases++;const result=await client.chats.messages.send(lead.id,{message:{parts:[{type:'media',attachment_id:attachment.attachment_id}]}});assert.equal(nativePosts,before+1);assert.equal(chertRequests,beforeChert+1,'send uses frozen metadata, not a follow-up GET');assert.match(result.message.id,/^[a-f0-9]{32}$/);assert.equal(result.message.delivery_status,'queued');assert.equal(result.message.sent_at,null);const part=result.message.parts[0];assert.deepEqual(Object.keys(part).sort(),['filename','id','mime_type','reactions','size_bytes','type','url']);assert.equal(part.reactions,null);assert.equal(part.id,attachment.attachment_id);assert.equal(part.filename,'image.png');assert.equal(part.mime_type,'image/png');assert.equal(part.size_bytes,4);
 cases++;const bytes=await fetch(part.url);assert.equal(bytes.status,200);assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())],[1,2,3,4]);assert.equal(downloads,1);
 const now=Date.now;try{Date.now=()=>Number(new URL(part.url).searchParams.get('expires'))*1000+1;cases++;assert.equal((await fetch(part.url)).status,404);}finally{Date.now=now;}assert.equal(downloads,1);
 tenant.signing_secret='rotated-fixture-key';cases++;assert.equal((await fetch(part.url)).status,404);tenant.signing_secret='fixture-key';assert.equal(downloads,1);
 let lastRecorded;
 for(const state of ['queued','sent','delivered','read']){evidenceMode=state;cases++;const recorded=await client.messages.retrieve(result.message.id);assert.equal(recorded.id,result.message.id);assert.equal(recorded.delivery_status,state);assert.deepEqual(recorded.parts,result.message.parts,'recorded media uses persisted frozen attachment metadata');assert.equal(recorded.sent_at,undefined);assert.equal(recorded.service,undefined);lastRecorded=recorded;if(state==='delivered'||state==='read')assert.equal(recorded.delivered_at,new Date(1700000000000).toISOString());if(state==='read')assert.equal(recorded.read_at,new Date(1700000001000).toISOString());}
 const persisted=tables.messaging_send_events.find(row=>row.id===result.message.id);
 const frozenSnapshot=JSON.stringify(persisted.response_payload.attachments),postsBeforeRefresh=nativePosts;
 const originalNow=Date.now;
 try{
  Date.now=()=>Number(new URL(part.url).searchParams.get('expires'))*1000+1;
  cases++;assert.equal((await fetch(part.url)).status,404);
  cases++;const fresh=await client.messages.retrieve(result.message.id);assert.notEqual(fresh.parts[0].url,part.url);
  for(const key of ['id','chat_id','created_at','updated_at','delivery_status','delivered_at','read_at'])assert.deepEqual(fresh[key],lastRecorded[key]);
  assert.equal(new URL(fresh.parts[0].url).searchParams.get('expires'),String(Math.floor(Date.now()/1000)+3600));
  cases++;const freshBytes=await fetch(fresh.parts[0].url);assert.equal(freshBytes.status,200);assert.deepEqual([...new Uint8Array(await freshBytes.arrayBuffer())],[1,2,3,4]);
  tenant.signing_secret='rotated-refresh-key';cases++;assert.equal((await fetch(fresh.parts[0].url)).status,404);
  const rotated=new Linq({chert:{baseURL:cloud.url.origin,apiKey:tenant.signing_secret,fetch:(i,o)=>{chertRequests++;return globalThis.fetch(i,o);}}});
  cases++;const renewed=await rotated.messages.retrieve(result.message.id);assert.notEqual(renewed.parts[0].url,fresh.parts[0].url);
  cases++;assert.equal((await fetch(renewed.parts[0].url)).status,200);
  assert.equal(JSON.stringify(persisted.response_payload.attachments),frozenSnapshot,'renewal must not persist new capability');
  assert.equal(nativePosts,postsBeforeRefresh,'read renewal cannot send');
 }finally{Date.now=originalNow;tenant.signing_secret='fixture-key';}
 for(const [key,value]of[['uploaded_at',null],['tenant_id','foreign'],['filename',''],['size_bytes',0]]){const row=tables.messaging_attachments[0],old=row[key],before=nativePosts;row[key]=value;cases++;await assert.rejects(async()=>client.chats.messages.send(lead.id,{message:{parts:[{type:'media',attachment_id:attachment.attachment_id}]}}));assert.equal(nativePosts,before);row[key]=old;}
 const badClient=new Linq({chert:{baseURL:cloud.url.origin,apiKey:'wrong',fetch:(i,o)=>{chertRequests++;return globalThis.fetch(i,o);}}});const beforeBad=nativePosts;cases++;await assert.rejects(async()=>badClient.chats.messages.send(lead.id,{message:{parts:[{type:'media',attachment_id:attachment.attachment_id}]}}));assert.equal(nativePosts,beforeBad);
 const oldDetails=lead.details;lead.details={...oldDetails,is_group:true,group_chat_guid:'iMessage;+;group'};cases++;await assert.rejects(async()=>client.chats.messages.send(lead.id,{message:{parts:[{type:'media',attachment_id:attachment.attachment_id}]}}));assert.equal(nativePosts,beforeBad);lead.details=oldDetails;
 for(const outcome of ['uncertain','partial']){mode=outcome;const before=nativePosts;cases++;await assert.rejects(async()=>client.chats.messages.send(lead.id,{message:{parts:[{type:'media',attachment_id:attachment.attachment_id}]}}),e=>{assert.equal(e.status,502);const messageId=e.headers.get('x-chert-message-id');assert.match(messageId,/^[a-f0-9]{32}$/);assert.equal(e.headers.get('x-chert-chat-id'),lead.id);assert.ok(tables.messaging_send_events.some(row=>row.id===messageId&&row.tenant_id===tenant.id));assert.deepEqual(Object.keys(e.error).sort(),['code','message','request_id']);assert.ok(!JSON.stringify(e.error).includes(messageId));return true;});assert.equal(nativePosts,before+1);}
 console.log(JSON.stringify({passed:true,cases,nativePosts,nativeQueries,chertRequests,writes,stores,downloads,external:0}));
}finally{Date.now=realDateNow;cloud.stop(true);native.stop(true);globalThis.fetch=originalFetch;}
