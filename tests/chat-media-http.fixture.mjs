// Real authentication, chat handler, attachment ownership and HMAC sender.
// Only database storage and the external native HTTP boundary are substituted.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'chat-media-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'10000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false};
const line={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001',project_id:'project-a',status:'active',health_status:'healthy',server_url:'https://device.invalid',signing_secret:'device-signing',api_key:'device-key'};
const lead={id:'chat-a',number:'+15550000002',messaging_tenant_id:tenant.id,project_id:'project-a',convo_id:'convo-a',details:{phone_line_id:line.id}};
const attachment={attachment_id:'a'.repeat(48),tenant_id:tenant.id,uploaded_at:'2026-10-17T00:00:00Z',filename:'image.png',content_type:'image/png',size_bytes:4};
const tables={messaging_tenants:[tenant],leads:[lead],phone_lines:[line],messaging_attachments:[attachment],messaging_send_events:[],convo:[{id:'convo-a',lead_id:lead.id,messages:[]}]};
attachment.blob_url=`messaging-attachments/${tenant.id}/${attachment.attachment_id}/${attachment.filename}`;
const nativeQueryPaths=[];
let attachmentReads=0;
let lastNativePath=null;let writes=0,nativePosts=0,nativeQueries=0,cases=0,mode='queued',failRecording=false,finalizeMode='',reserveMissing=false;
const guids=['550e8400-e29b-41d4-a716-446655440000','650e8400-e29b-41d4-a716-446655440000'];
class Query {
 constructor(table){this.table=table;this.filters=[];}
 select(){if(this.table==='messaging_attachments')attachmentReads++;return this;}eq(k,v){if(k==='id')this.updatedId=v;this.filters.push(row=>typeof v==='string'&&['response_payload','request_payload'].includes(k)?JSON.stringify(row[k])===v:row[k]===v);return this;}in(k,v){this.filters.push(row=>v.includes(row[k]));return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}limit(){return this;}order(){return this;}
 insert(value){this.inserted=value;return this;}update(value){this.updated=value;return this;}
 then(yes,no){try{let rows=(tables[this.table]??[]).filter(row=>this.filters.every(f=>f(row)));if(this.inserted&&this.table==='messaging_send_events'&&failRecording)return Promise.resolve({data:null,error:{message:'fixture-db-failure'}}).then(yes,no);if(this.inserted){writes++;tables[this.table].push(this.inserted);rows=[this.inserted];if(this.table==='messaging_send_events'&&mode==='line-race')line.phone_number='+15550000009';}if(this.updated&&this.table==='messaging_send_events'){
 if(finalizeMode==='error')return Promise.resolve({data:null,error:{message:'private-finalize-error'}}).then(yes,no);
 if(finalizeMode==='zero')return Promise.resolve({data:null,error:null}).then(yes,no);
 if(finalizeMode==='concurrent'){const row=tables.messaging_send_events.find(row=>row.id===this.updatedId);if(row)row.response_payload={...row.response_payload,mac_media_dispatch_state:'operator-reconciled'};return Promise.resolve({data:null,error:null}).then(yes,no);}
}if(this.updated){writes++;rows.forEach(row=>Object.assign(row,this.updated));if(finalizeMode==='lost')return Promise.resolve({data:null,error:{message:'private-lost-response'}}).then(yes,no);}
if(this.inserted&&reserveMissing)return Promise.resolve({data:null,error:null}).then(yes,no);return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
const db={from:table=>new Query(table),rpc:async(name,args)=>{assert.equal(name,'append_convo_message');writes++;tables.convo[0].messages.push(args.p_message);return{data:tables.convo[0].messages,error:null};}};
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.hostname==='127.0.0.1')return originalFetch(input,init);
 assert.equal(url.origin,'https://device.invalid');if(request.method==='GET'){nativeQueries++;nativeQueryPaths.push(url.pathname);assert.equal(request.headers.get('authorization'),'Bearer device-key');assert.equal(init.redirect,'error');if(url.pathname.startsWith('/api/v1/attachment-operations/v1/')){assert.equal(url.searchParams.get('from'),line.phone_number);return Response.json({origin:url.pathname.split('/').at(-1),found:false},{status:404});}if(url.pathname.startsWith('/api/v1/message-evidence/')){assert.equal(url.pathname,'/api/v1/message-evidence/'+guids[0]);assert.equal(url.searchParams.get('recipient'),lead.number);return new Response(null,{status:404});}assert.equal(url.pathname,'/api/v1/messages/msg_attachmentA');assert.equal(url.search,'');return Response.json({message_id:'msg_attachmentA',fallback_owner:'none',status:'sent',service:'imessage',delivered:true});}const versioned=url.pathname==='/api/v1/attachment-operations/v1';assert.ok(versioned||url.pathname==='/api/v1/send');assert.equal(request.method,'POST');lastNativePath=url.pathname;nativePosts++;
 const raw=await request.text(),wire=JSON.parse(raw),body=versioned?{attachments:[{id:wire.attachment_id}],phone:wire.to,lead_id:lead.id}:wire;const publicID=versioned?wire.origin.slice(6):body.idempotency_key?.replace(/^chert-media:/,'');if(versioned){assert.deepEqual(Object.keys(wire).sort(),['attachment_id','from','origin','to']);assert.equal(wire.from,line.phone_number);assert.match(wire.origin,/^media_[a-f0-9]{32}$/);}const intent=tables.messaging_send_events.find(row=>row.id===publicID);assert.ok(intent,'durable intent must precede native POST');assert.equal(intent.response_payload.mac_media_dispatch_state,'reserved');assert.equal(intent.phone,body.phone);assert.equal(intent.phone_line_id,line.id);
 const signature=request.headers.get('x-chert-signature');const[,ts,hash]=signature.split(',');
 assert.equal(hash,createHmac('sha256',line.signing_secret).update(`${ts}.${raw}`).digest('hex'));
 assert.equal(request.headers.get('authorization'),'Bearer device-key');assert.equal(init.redirect,'error');
 assert.ok(body.attachments.length>=1&&body.attachments.length<=2);assert.deepEqual(body.attachments,body.attachments.length===1?[{id:attachment.attachment_id}]:[{id:attachment.attachment_id},{id:'b'.repeat(48)}]);assert.equal(body.phone,lead.number);assert.equal(body.lead_id,lead.id);
 if(mode==='timeout')throw new Error('private-native-secret');
 if(mode==='malformed')return new Response('not-json');
 const ack={success:true,status:body.body?'queued':'sent',delivery:body.body?'queued':'direct',message_id:body.body?'msg_attachmentA':guids[body.attachments.length-1],fallback_owner:'none',attachments:body.attachments.map((item,index)=>({id:item.id,message_id:guids[index]}))};
 if(mode==='partial')ack.attachments=[];
 if(mode==='mutate-metadata'){attachment.filename='changed.png';attachment.size_bytes=99;}
 if(mode==='wrong-id')ack.attachments[0].id='att_foreign';
 if(mode==='contradiction')ack.success=false;
 if(mode==='sent-unproven'){ack.status='sent';delete ack.delivery;}
 const versionedAck={...wire,fingerprint:'f'.repeat(64),preparedGuid:guids[0],state:'acknowledged'};if(mode==='partial')versionedAck.state='unknown';if(mode==='wrong-id')versionedAck.attachment_id='b'.repeat(48);if(mode==='contradiction')versionedAck.success=false;if(mode==='sent-unproven')delete versionedAck.fingerprint;return Response.json(versioned?versionedAck:ack,{status:versioned?202:body.body?202:200});
};
const route=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));
const statusRoute=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>req.method==='GET'?statusRoute.GET(new NextRequest(req),{params:Promise.resolve({id:new URL(req.url).pathname.split('/').at(-1)})}):route.POST(new NextRequest(req),{params:Promise.resolve({id:lead.id})})});
async function post(parts,headers={authorization:'Bearer fixture-key'}){cases++;const response=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/chats/${lead.id}/messages`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({message:{parts}})});const body=await response.json();assert.ok(!JSON.stringify(body).includes('private-native-secret'));return{status:response.status,body};}
const media={type:'media',attachment_id:attachment.attachment_id};
try{
 const noauth=await post([media],{});assert.equal(noauth.status,401);assert.equal(nativePosts,0);const badauth=await post([media],{authorization:'Bearer wrong-key'});assert.equal(badauth.status,404);assert.equal(nativePosts,0);
 const response=await post([media]);assert.equal(response.status,202,'owned uploaded attachment must use actual attachment-ID sender');
 assert.equal(response.body.message.status,'queued');assert.equal(response.body.message.service,'unknown');assert.equal(response.body.message.delivered_at,null);assert.equal(response.body.message.read_at,null);
 const lookup=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/messages/${response.body.message.id}`,{headers:{authorization:'Bearer fixture-key'}});cases++;assert.equal(lookup.status,200);assert.equal((await lookup.json()).status,'queued');
 assert.equal(nativePosts,1);const durable=tables.messaging_send_events.find(row=>row.id===response.body.message.id&&row.tenant_id===tenant.id);assert.ok(durable);assert.deepEqual(durable.request_payload,{message:{parts:[media]}});assert.deepEqual(response.body.message.parts,[media]);assert.deepEqual(durable.response_payload.native_attachment_guids,[guids[0]]);
 for(const bad of [[{type:'media',url:'https://untrusted.invalid/media'}],[{...media,live_photo:true}],[{...media,attachment_id:'att_missing'}],[media,media],[{...media,unknown:true}],[{type:'text',value:'before'},media],[media,{type:'text',value:'one'},{type:'text',value:'two'}]]){const before=nativePosts;const result=await post(bad);assert.ok(result.status>=400);assert.equal(nativePosts,before);}
 for(const [object,key,value] of [[attachment,'tenant_id','foreign'],[attachment,'uploaded_at',null],[line,'project_id','foreign'],[line,'status','disabled'],[lead,'messaging_tenant_id','foreign'],[lead,'details',{}],[lead,'details',{phone_line_id:line.id,is_group:true,group_chat_guid:'iMessage;+;group'}]]){const saved=object[key];object[key]=value;const before=nativePosts;const result=await post([media]);assert.ok(result.status>=400,`rejection for ${object===lead?'lead':object===line?'line':'attachment'}.${key}`);assert.equal(nativePosts,before);object[key]=saved;}
 for(const outcome of ['timeout','malformed','partial','wrong-id','contradiction','sent-unproven']){mode=outcome;const before=nativePosts;const result=await post([media]);assert.equal(result.status,502);assert.equal(result.body.error.retryable,false);assert.equal(nativePosts,before+1);assert.equal(result.body.chat_id,lead.id);const intent=tables.messaging_send_events.find(row=>row.id===result.body.message_id);assert.ok(intent);assert.equal(intent.response_payload.mac_media_dispatch_state,'unconfirmed');}
 const previousProject=lead.project_id;lead.project_id='foreign';const previousPosts=nativePosts;const projectMismatch=await post([media]);assert.ok(projectMismatch.status>=400,'lead project must match');assert.equal(nativePosts,previousPosts);lead.project_id=previousProject;
 mode='queued';const before=nativePosts;const caption=await post([media,{type:'text',value:'synthetic caption'}]);assert.equal(caption.status,202);assert.equal(caption.body.message.status,'queued');assert.equal(caption.body.message.service,'unknown');assert.equal(nativePosts,before+1);
 const captionEvent=tables.messaging_send_events.find(row=>row.id===caption.body.message.id);assert.deepEqual(captionEvent.response_payload.native_caption_outbox_ids,['msg_attachmentA']);assert.equal(captionEvent.response_payload.mac_bridge_outbox_ids,undefined);assert.equal(captionEvent.response_payload.mac_native_outbox_ids,undefined);
 const captionLookup=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/messages/${caption.body.message.id}`,{headers:{authorization:'Bearer fixture-key'}});cases++;assert.equal(captionLookup.status,200);assert.equal((await captionLookup.json()).status,'queued');assert.equal(nativeQueries,2,'one attachment evidence lookup plus one caption GUID lookup');assert.deepEqual(nativeQueryPaths,['/api/v1/message-evidence/'+guids[0],'/api/v1/messages/msg_attachmentA']);assert.equal(nativePosts,before+1,'read-only lookup never repeats native send');assert.equal(captionEvent.status,'processing');
 tables.messaging_attachments.push({...attachment,attachment_id:'b'.repeat(48),blob_url:`messaging-attachments/${tenant.id}/${'b'.repeat(48)}/${attachment.filename}`});
 const two=[media,{type:'media',attachment_id:'b'.repeat(48)}];
 for(const parts of [two,[...two,{type:'text',value:'synthetic pair caption'}]]){
  const before=nativePosts;const result=await post(parts);assert.equal(result.status,202);assert.equal(result.body.message.status,'queued');assert.equal(result.body.message.service,'unknown');assert.equal(nativePosts,before+1);
  const event=tables.messaging_send_events.find(row=>row.id===result.body.message.id);assert.deepEqual(event.response_payload.native_attachment_guids,guids);assert.deepEqual(event.request_payload,{message:{parts}});
 }
 const beforeTooMany=attachmentReads;const oversized=await post(Array.from({length:101},(_,i)=>({type:'media',attachment_id:i.toString(16).padStart(48,'0')})));assert.ok(oversized.status>=400);assert.equal(attachmentReads,beforeTooMany,'over-cap request must reject before attachment lookups');
 for(const [key,value]of[['filename','bad/name.png'],['size_bytes',0],['content_type','application/not-real'],['blob_url','foreign/path'],['uploaded_at','2026-02-30T00:00:00Z']]){const previous=attachment[key],before=nativePosts;attachment[key]=value;const invalid=await post([media]);assert.equal(invalid.status,422);assert.equal(nativePosts,before,'malformed metadata must fail before native dispatch');attachment[key]=previous;}
 const originalName=attachment.filename,originalSize=attachment.size_bytes;mode='mutate-metadata';const snapshotResult=await post([media]);assert.equal(snapshotResult.status,202);assert.equal(snapshotResult.body.message.attachments[0].filename,originalName);assert.equal(snapshotResult.body.message.attachments[0].size_bytes,originalSize);assert.deepEqual(tables.messaging_send_events.find(row=>row.id===snapshotResult.body.message.id).response_payload.attachments,snapshotResult.body.message.attachments);attachment.filename=originalName;attachment.size_bytes=originalSize;mode='queued';
 failRecording=true;const beforeFailure=nativePosts;const eventsBefore=tables.messaging_send_events.length;const unsaved=await post([media]);assert.equal(unsaved.status,500);assert.equal(unsaved.body.error.retryable,false);assert.equal(nativePosts,beforeFailure,'reservation failure must precede native effect');assert.equal(tables.messaging_send_events.length,eventsBefore);
 failRecording=false;
 reserveMissing=true;const beforeMissing=nativePosts;const missing=await post([media]);assert.equal(missing.status,500);assert.equal(nativePosts,beforeMissing);reserveMissing=false;
 for(const failure of ['error','zero','lost','concurrent']){
  finalizeMode=failure;const before=nativePosts;const result=await post([media]);assert.equal(result.status,502);assert.equal(result.body.error.code,4103);assert.equal(result.body.error.retryable,false);assert.equal(result.body.chat_id,lead.id);assert.equal(nativePosts,before+1);
  const intent=tables.messaging_send_events.find(row=>row.id===result.body.message_id);assert.ok(intent,'public identity remains durable');
  assert.equal(intent.response_payload.mac_media_dispatch_state,failure==='lost'?'acknowledged':failure==='concurrent'?'operator-reconciled':'reserved');
  const lookup=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/messages/${intent.id}`,{headers:{authorization:'Bearer fixture-key'}});cases++;assert.equal(lookup.status,200);const body=await lookup.json();assert.equal(body.id,intent.id);assert.ok(!JSON.stringify(body).includes('mac_media_dispatch_state'));assert.ok(!JSON.stringify(body).includes('private-finalize-error'));
 }
 finalizeMode='';mode='line-race';const beforeRace=nativePosts;const raced=await post([media]);assert.equal(raced.status,502);assert.equal(raced.body.error.retryable,false);assert.equal(nativePosts,beforeRace);const racedIntent=tables.messaging_send_events.find(row=>row.id===raced.body.message_id);assert.equal(racedIntent.response_payload.mac_media_from,'+15550000001');assert.equal(racedIntent.response_payload.mac_media_origin,'media_'+racedIntent.id);assert.equal(racedIntent.response_payload.mac_media_dispatch_state,'unconfirmed');line.phone_number='+15550000001';
 mode='queued';const emptyCaption=await post([media,{type:'text',value:''}]);assert.equal(emptyCaption.status,202);assert.equal(lastNativePath,'/api/v1/send','explicit empty caption selects legacy before dispatch');const emptyEvent=tables.messaging_send_events.find(row=>row.id===emptyCaption.body.message.id);for(const key of ['mac_media_origin','mac_media_protocol','mac_media_from'])assert.equal(Object.hasOwn(emptyEvent.response_payload,key),false);
 console.log(JSON.stringify({passed:true,cases,nativePosts,nativeQueries,writes,actualAuth:true,actualOwnership:true,actualHMAC:true}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
