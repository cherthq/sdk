// Actual SDK -> authenticated message GET -> owned capability refresh. Only DB substituted.
import assert from 'node:assert/strict';import{resolve}from'node:path';import{plugin}from'bun';import{mock}from'bun:test';
import Sendblue from '../packages/sendblue-adapter/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');await plugin({name:'sendblue-media-retrieve',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'11000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',is_active:true,email:null,requires_tenant_header:false};
const id='a'.repeat(48),attachment={attachment_id:id,tenant_id:tenant.id,filename:'photo.png',content_type:'image/png',size_bytes:4,uploaded_at:'2026-10-17T00:00:00Z',blob_url:`messaging-attachments/${tenant.id}/${id}/photo.png`};
const send={id:'public-media',tenant_id:tenant.id,lead_id:'chat-a',convo_id:'convo-a',phone_line_id:'line-a',phone:'+15550000002',created_at:'2026-10-17T00:00:00Z',status:'processing',error:null,request_payload:{message:{parts:[{type:'media',attachment_id:id}]}},response_payload:{status:'queued',mac_media_dispatch_state:'reserved'}};
const tables={messaging_tenants:[tenant],messaging_send_events:[send],messaging_attachments:[attachment],messaging_events:[],leads:[],convo:[]};let writes=0,requests=0,posts=0,external=0,cases=0,attachmentError=false;
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}filter(k,op,v){assert.equal(op,'cs');const wanted=JSON.parse(v);this.filters.push(r=>Object.entries(wanted).every(([key,value])=>r[k]?.[key]===value));return this;}abortSignal(signal){assert.equal(signal.aborted,false);return this;}order(){return this;}limit(n){this.cap=n;return this;}maybeSingle(){this.one=true;return this;}update(){writes++;throw Error('write forbidden');}insert(){writes++;throw Error('write forbidden');}then(yes,no){let rows=(tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r)));if(this.cap)rows=rows.slice(0,this.cap);return Promise.resolve({data:this.one?rows[0]??null:rows,error:this.table==='messaging_attachments'&&attachmentError?{message:'private-db-error'}:null}).then(yes,no);}}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const route=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));const{createFrozenMediaResponse}=await import(resolve(app,'lib/messaging/media-response.ts'));const{NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){requests++;if(req.method!=='GET'){posts++;throw Error('mutation forbidden');}assert.equal(new URL(req.url).pathname,'/api/v1/messages/'+send.id);return route.GET(new NextRequest(req),{params:Promise.resolve({id:send.id})});}});
// NextRequest canonicalizes literal loopback addresses to localhost. Seed the same actual request origin.
const origin=cloud.url.origin.replace('127.0.0.1','localhost');
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==origin||url.pathname!=='/api/v1/messages/'+send.id){external++;throw Error('only recorded GET allowed; no native/download fetch');}return originalFetch(input,init);};
const client=(key=tenant.signing_secret)=>new Sendblue({chert:{baseURL:origin,apiKey:key}});const sdk=client();send.response_payload.attachments=createFrozenMediaResponse([attachment],[id],tenant,origin);assert.equal(send.response_payload.attachments.length,1);const snapshot=JSON.stringify(send.response_payload),original=structuredClone({send,attachment});const actualNow=Date.now;
async function rejected(action,status=502){cases++;const before=requests;await assert.rejects(action,e=>{assert.equal(e.status,status);assert.ok(!e.message.includes('private-db-error'));return true;});assert.equal(requests,before+1);}
try{
 cases++;const first=await sdk.messages.retrieve(send.id);assert.equal(first.data.media_url,send.response_payload.attachments[0].download_url);assert.deepEqual(Object.keys(first.data).sort(),['is_outbound','media_url','message_handle','number','status']);assert.equal(first.data.status,'QUEUED');
 cases++;assert.equal(Object.hasOwn(await sdk.messages.getStatus({handle:send.id}),'media_url'),false);
 Date.now=()=>Number(new URL(first.data.media_url).searchParams.get('expires'))*1000+1;
cases++;const renewed=await sdk.messages.retrieve(send.id);assert.notEqual(renewed.data.media_url,first.data.media_url);assert.equal(JSON.stringify(send.response_payload),snapshot);assert.equal(new URL(renewed.data.media_url).searchParams.get('expires'),String(Math.floor(Date.now()/1000)+3600));
 tenant.signing_secret='rotated-key';cases++;const rotated=await client().messages.retrieve(send.id);assert.notEqual(rotated.data.media_url,renewed.data.media_url);assert.equal(JSON.stringify(send.response_payload),snapshot);await rejected(async()=>await sdk.messages.retrieve(send.id),404);
 for(const change of [()=>attachment.filename='changed.png',()=>attachment.tenant_id='foreign',()=>attachment.uploaded_at=null,()=>attachment.size_bytes=0,()=>tables.messaging_attachments.push({...attachment}),()=>tables.messaging_attachments.splice(0),()=>attachmentError=true]){
  change();await rejected(async()=>await client().messages.retrieve(send.id));Object.assign(attachment,structuredClone(original.attachment));tables.messaging_attachments=[attachment];attachmentError=false;
 }
 for(const change of [()=>send.request_payload.message.parts.push({type:'text',value:'caption'}),()=>send.response_payload.attachments[0].attachment_id='b'.repeat(48),()=>send.response_payload.attachments[0].download_url=send.response_payload.attachments[0].download_url.replace(origin,'https://foreign.invalid')]){
  change();await rejected(async()=>await client().messages.retrieve(send.id));Object.assign(send,structuredClone(original.send));
 }
 send.tenant_id='foreign';await rejected(async()=>await client().messages.retrieve(send.id),404);Object.assign(send,structuredClone(original.send));
 cases++;const unauth=await fetch(origin+'/api/v1/messages/'+send.id);assert.equal(unauth.status,401);await rejected(async()=>await client('wrong').messages.retrieve(send.id),404);
 tenant.is_active=false;await rejected(async()=>await client().messages.retrieve(send.id),404);tenant.is_active=true;
 assert.equal(writes,0);assert.equal(posts,0);assert.equal(external,0);assert.equal(JSON.stringify(send.response_payload),snapshot);
 console.log(JSON.stringify({passed:true,cases,requests,writes,posts,external,actualAuth:true}));
}finally{Date.now=actualNow;cloud.stop(true);globalThis.fetch=originalFetch;}
