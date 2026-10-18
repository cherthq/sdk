// Actual SQL/PostgREST, Supabase client, Next handlers and upstream Linq SDK.
// Default: in-memory Storage HTTP boundary. Optional mode: actual isolated Storage API.
import assert from 'node:assert/strict';
import {createHmac,createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import{lstatSync}from'node:fs';
import {plugin} from 'bun';
import Linq from '../packages/linq-adapter/src/index.ts';
const args=process.argv.slice(2),liveFlag=args[0],operationLive=liveFlag==='--live-one-png-operation',livePlanPath=args.length===2&&['--live-one-png','--live-one-png-operation'].includes(liveFlag)?args[1]:null;
if(args.length&&!livePlanPath)throw Error('Explicit live PNG arguments rejected');
if(livePlanPath){const file=lstatSync(livePlanPath);if(!livePlanPath.startsWith('/')||!file.isFile()||file.isSymbolicLink()||(file.mode&0o777)!==0o600||file.uid!==process.getuid?.())throw Error('Live PNG plan rejected');}
const target=new URL(process.env.CHERT_TEST_POSTGREST_URL??'');
assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');
assert.ok(target.port&&target.pathname==='/'&&!target.username&&!target.password&&!target.search&&!target.hash);
const storageTarget=process.env.CHERT_TEST_STORAGE_URL?new URL(process.env.CHERT_TEST_STORAGE_URL):null;
if(storageTarget){assert.equal(storageTarget.protocol,'http:');assert.equal(storageTarget.hostname,'127.0.0.1');
assert.ok(storageTarget.port&&storageTarget.pathname==='/'&&!storageTarget.username&&!storageTarget.password&&!storageTarget.search&&!storageTarget.hash);}
if(livePlanPath&&!storageTarget)throw Error('Live PNG requires explicit actual Storage');
const jwt=process.env.CHERT_TEST_SERVICE_JWT;assert.ok(jwt&&jwt.split('.').length===3);
const tenant='11000000-0000-4000-8000-000000000001';
const app=resolve(import.meta.dir,'../../imessage-server');
let restRequests=0,storageRequests=0,restWrites=0,restAuthRequests=0,actualStorageRequests=0,storageAuthRequests=0,cases=0;
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const blobs=new Map();const actualFetch=globalThis.fetch;
let gatewayOrigin,appOrigin,deviceOrigin,operationSignedPath=null;let nativeEffects=0,reservationCases=0,mediaMode='none';
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([target.origin,...(storageTarget?[storageTarget.origin]:[]),gatewayOrigin,appOrigin,deviceOrigin].includes(url.origin),'Only isolated loopback fixture origins allowed');return actualFetch(input,{...init,redirect:'error'});};
const gateway=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const url=new URL(req.url);
 if(url.pathname.startsWith('/rest/v1/')){
  assert.equal(req.headers.get('authorization'),`Bearer ${jwt}`);assert.equal(req.headers.get('apikey'),jwt);
  restRequests++;if(req.method!=='GET'&&req.method!=='HEAD')restWrites++;
  const forwarded=new URL(url.pathname.slice('/rest/v1'.length)+url.search,target);
  assert.equal(forwarded.origin,target.origin);
  const response=await actualFetch(forwarded,{method:req.method,headers:req.headers,redirect:'error',body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer(),signal:AbortSignal.any([req.signal,AbortSignal.timeout(15000)])});
  return new Response(response.body,{status:response.status,headers:response.headers});
 }
 assert.ok(url.pathname.startsWith('/storage/v1/'),'Unexpected gateway endpoint');
 const signedObjectPath=url.pathname.startsWith('/storage/v1/object/sign/attachments/');
 const signedObjectRead=operationLive&&storageTarget&&req.method==='GET'&&signedObjectPath;
 if(signedObjectRead){
  if(url.pathname!==operationSignedPath||url.searchParams.size!==1||!url.searchParams.get('token')||url.searchParams.get('token').length>8192||req.headers.has('authorization')||req.headers.has('apikey'))return new Response(null,{status:400});
 }else{assert.equal(req.headers.get('authorization'),`Bearer ${jwt}`);assert.equal(req.headers.get('apikey'),jwt);}
 storageRequests++;
 if(!storageTarget){
  const match=/^\/storage\/v1\/object\/(?:authenticated\/)?attachments\/(.+)$/.exec(url.pathname);
  assert.ok(match,'Unexpected default Storage boundary endpoint');const key=decodeURIComponent(match[1]);
  if(req.method==='POST'||req.method==='PUT'){
   const body=req.headers.get('content-type')?.startsWith('multipart/form-data')?await (await req.formData()).get('file').arrayBuffer():await req.arrayBuffer();
   blobs.set(key,new Uint8Array(body));return Response.json({Key:`attachments/${key}`,Id:'storage-fixture'});
  }
  assert.equal(req.method,'GET');const value=blobs.get(key);return value?new Response(value,{headers:{'content-length':String(value.byteLength)}}):new Response(null,{status:404});
 }
 actualStorageRequests++;
 const forwarded=new URL(url.pathname.slice('/storage/v1'.length)+url.search,storageTarget);
 assert.equal(forwarded.origin,storageTarget.origin);
 const headers=new Headers(req.headers);headers.delete('host');headers.delete('connection');
 const response=await actualFetch(forwarded,{method:req.method,headers,redirect:'error',
  body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer(),signal:AbortSignal.any([req.signal,AbortSignal.timeout(15000)])});
 return new Response(response.body,{status:response.status,headers:response.headers});
}});gatewayOrigin=gateway.url.origin;
process.env.NEXT_PUBLIC_SUPABASE_URL=gatewayOrigin;
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt;
process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE='1';
await plugin({name:'attachment-postgrest-real-routes',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const {POST:register}=await import(resolve(app,'app/api/v1/attachments/route.ts'));
const {PUT:upload}=await import(resolve(app,'app/api/v1/attachments/[id]/upload/route.ts'));
const {GET:metadata}=await import(resolve(app,'app/api/v1/attachments/[id]/route.ts'));
const {GET:download}=await import(resolve(app,'app/api/v1/attachments/[id]/download/route.ts'));
const {POST:sendMedia}=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const url=new URL(req.url),request=new NextRequest(req);
 if(url.pathname==='/api/v1/chats/41000000-0000-4000-8000-000000000001/messages')return sendMedia(request,{params:Promise.resolve({id:'41000000-0000-4000-8000-000000000001'})});
 if(url.pathname==='/api/v1/attachments'&&req.method==='POST')return register(request);
 const match=/^\/api\/v1\/attachments\/([a-f0-9]{48})(?:\/(upload|download))?$/.exec(url.pathname);
 assert.ok(match,'Unexpected application endpoint');const ctx={params:Promise.resolve({id:match[1]})};
 if(match[2]==='upload'&&req.method==='PUT')return upload(request,ctx);
 if(match[2]==='download'&&req.method==='GET')return download(request,ctx);
 if(!match[2]&&req.method==='GET')return metadata(request,ctx);
 throw Error('Unsupported fixture method');
}});appOrigin=server.url.origin;
async function rest(path,method='GET',body){const response=await fetch(`${gatewayOrigin}/rest/v1/${path}`,{method,headers:{authorization:`Bearer ${jwt}`,apikey:jwt,'content-type':'application/json',prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,'Isolated database REST request failed');return response.status===204?null:response.json();}
let fixtureKey='fixture-key';
const sdk=(key=fixtureKey)=>new Linq({chert:{baseURL:appOrigin,apiKey:key,tenant:'fixture'}});
try{
 if(livePlanPath){
  // This branch never enters the synthetic fault matrix below. A single SDK
  // invocation reaches the separately reviewed one-attempt broker.
  let broker,liveStage='tenant-key';const priorError=console.error,priorWarn=console.warn;console.error=()=>{};console.warn=()=>{};
  try{
   fixtureKey=randomBytes(32).toString('hex');
   await rest(`messaging_tenants?id=eq.${tenant}`,'PATCH',{signing_secret:fixtureKey});
   const {PNG,startReviewedLiveBroker}=await import('../scripts/m4d-live-media-acceptance.mjs');
   const startBroker=operationLive?(await import('../scripts/m4d-live-media-operation-acceptance.mjs')).startReviewedOperationBroker:startReviewedLiveBroker;
   const png=new Uint8Array(PNG);assert.ok(png.length>8);
   const bucket=await fetch(new URL('/bucket',storageTarget),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${jwt}`,apikey:jwt,'content-type':'application/json'},body:JSON.stringify({id:'attachments',name:'attachments',public:false})});assert.equal(bucket.status,200);await bucket.body?.cancel();
   liveStage='sdk-register';
   const created=await sdk().attachments.create({filename:'reviewed.png',content_type:'image/png',size_bytes:png.length});
   liveStage='old-key-denied';
   await assert.rejects(()=>sdk('fixture-key').attachments.retrieve(created.attachment_id),error=>error.status===401);
   liveStage='sdk-upload';
   const put=await fetch(created.upload_url,{method:'PUT',headers:created.required_headers,body:png});assert.equal(put.status,200);await put.body?.cancel();
   liveStage='uploaded-byte-download';
   const read=await fetch(created.download_url);assert.equal(read.status,200);const stored=new Uint8Array(await read.arrayBuffer());assert.deepEqual(stored,png);
   if(operationLive){
    // Actual native fetchURL deliberately carries only the Storage signed token.
    const {attachmentBlobPath}=await import(resolve(app,'lib/supabase-storage.ts'));
    const path='/storage/v1/object/sign/attachments/'+attachmentBlobPath(tenant,created.attachment_id,'reviewed.png');operationSignedPath=path;
    liveStage='storage-signed-url-create';
    const signed=await fetch(gatewayOrigin+path,{method:'POST',headers:{authorization:`Bearer ${jwt}`,apikey:jwt,'content-type':'application/json'},body:JSON.stringify({expiresIn:60})});assert.equal(signed.status,200);const signedBody=await signed.json();assert.equal(typeof signedBody.signedURL,'string');
    liveStage='storage-signed-url-shape';
    const signedURL=new URL('/storage/v1'+signedBody.signedURL,gatewayOrigin);assert.equal(signedURL.origin,gatewayOrigin);assert.equal(signedURL.pathname,path);
    liveStage='storage-signed-url-read';
    const signedRead=await fetch(signedURL);assert.equal(signedRead.status,200);assert.deepEqual(new Uint8Array(await signedRead.arrayBuffer()),png);
    liveStage='storage-missing-token-denied';
    const missing=await fetch(gatewayOrigin+path);assert.equal(missing.status,400);await missing.body?.cancel();
    liveStage='storage-invalid-token-denied';
    const invalid=await fetch(gatewayOrigin+path+'?token=invalid');assert.ok(invalid.status>=400&&invalid.status<500);await invalid.body?.cancel();assert.equal(nativeEffects,0);
   }
   let reservationVerified=false;
   liveStage='broker-prepare';
   broker=await startBroker(livePlanPath,`${livePlanPath}.attempt.json`,liveFlag,async(input)=>{
    liveStage='reservation-verify';
    assert.equal(reservationVerified,false);
    let publicId,body;
    if(operationLive){
     body=input;assert.deepEqual(Object.keys(body).sort(),['attachment_id','from','origin','to']);
     assert.match(body.origin,/^media_[a-f0-9]{32}(?![\s\S])/);publicId=body.origin.slice('media_'.length);
     assert.equal(body.from,broker.sender);assert.equal(body.to,broker.recipient);assert.equal(body.attachment_id,created.attachment_id);
    }else{
     ({publicId,body}=input);assert.match(body.idempotency_key,/^chert-media:[a-f0-9]{32}(?![\s\S])/);assert.equal(publicId,body.idempotency_key.slice('chert-media:'.length));
    assert.equal(body.phone,broker.recipient);assert.equal(body.lead_id,'41000000-0000-4000-8000-000000000001');assert.deepEqual(body.attachments,[{id:created.attachment_id}]);
    }
    const rows=await rest(`messaging_send_events?id=eq.${publicId}&tenant_id=eq.${tenant}&lead_id=eq.41000000-0000-4000-8000-000000000001&phone_line_id=eq.61000000-0000-4000-8000-000000000001&select=*`);assert.equal(rows.length,1);const intent=rows[0];assert.equal(intent.status,'processing');assert.equal(intent.phone,broker.recipient);assert.equal(intent.response_payload.mac_media_dispatch_state,'reserved');
    if(operationLive){assert.equal(intent.response_payload.mac_media_origin,body.origin);assert.equal(intent.response_payload.mac_media_protocol,'attachment-operations/v1');assert.equal(intent.response_payload.mac_media_from,broker.sender);}
    assert.deepEqual(intent.request_payload,{message:{parts:[{type:'media',attachment_id:created.attachment_id}]}});
    const frozen=intent.response_payload.attachments;assert.equal(frozen.length,1);assert.equal(frozen[0].attachment_id,created.attachment_id);assert.equal(frozen[0].filename,'reviewed.png');assert.equal(frozen[0].content_type,'image/png');assert.equal(frozen[0].size_bytes,png.length);const capability=new URL(frozen[0].download_url);assert.equal(capability.origin,appOrigin);assert.equal(capability.pathname,`/api/v1/attachments/${created.attachment_id}/download`);assert.equal(capability.searchParams.get('tenant'),tenant);const {verifyOneHourAttachmentDownload}=await import(resolve(app,'lib/messaging/attachment-download.ts'));assert.equal(verifyOneHourAttachmentDownload({id:tenant,signing_secret:fixtureKey},created.attachment_id,capability.searchParams.get('expires'),capability.searchParams.get('signature')),true);assert.equal(new Date(Number(capability.searchParams.get('expires'))*1000).toISOString(),frozen[0].download_url_expires_at);
    const [line]=await rest('phone_lines?id=eq.61000000-0000-4000-8000-000000000001&select=*');assert.equal(line.phone_number,broker.sender);assert.equal(line.api_key,broker.apiKey);assert.equal(line.signing_secret,broker.signingSecret);assert.equal(line.server_url,broker.nativeOrigin);reservationVerified=true;
   },{supabaseOrigin:gatewayOrigin,supabaseServiceKey:jwt});
   const nativeURL=new URL(broker.nativeOrigin);assert.equal(nativeURL.protocol,'http:');assert.equal(nativeURL.hostname,'127.0.0.1');assert.ok(nativeURL.port&&!nativeURL.username&&!nativeURL.password&&!nativeURL.search&&!nativeURL.hash&&nativeURL.pathname==='/');
   assert.equal(typeof broker.apiKey,'string');assert.ok(broker.apiKey.length>=32);assert.equal(typeof broker.signingSecret,'string');assert.ok(broker.signingSecret.length>=32);
   assert.match(broker.sender,/^\+[1-9][0-9]{1,14}(?![\s\S])/);assert.match(broker.recipient,/^\+[1-9][0-9]{1,14}(?![\s\S])/);deviceOrigin=nativeURL.origin;
   liveStage='owned-line-seed';
   await rest('phone_lines','POST',{id:'61000000-0000-4000-8000-000000000001',project_id:'21000000-0000-4000-8000-000000000001',phone_number:broker.sender,server_url:deviceOrigin,api_key:broker.apiKey,signing_secret:broker.signingSecret,status:'active',health_status:'healthy'});
   await rest('leads?id=eq.41000000-0000-4000-8000-000000000001','PATCH',{number:broker.recipient});
   liveStage='uploaded-byte-bind';
   await broker.bindUploadedPNG(stored,created.attachment_id);
   liveStage='sdk-send';
   const sent=await sdk().chats.messages.send('41000000-0000-4000-8000-000000000001',{message:{parts:[{type:'media',attachment_id:created.attachment_id}]}});
   liveStage='ack-ledger';
   assert.equal(sent.message.delivery_status,'queued');assert.equal(reservationVerified,true);const [record]=await rest(`messaging_send_events?id=eq.${sent.message.id}&select=response_payload,status`);assert.equal(record.status,'processing');assert.equal(record.response_payload.mac_media_dispatch_state,'acknowledged');assert.equal(record.response_payload.native_attachment_guids.length,1);
   liveStage='exact-recipient-observe';
   const observed=await broker.observe(record.response_payload.native_attachment_guids[0]);
   assert.ok(observed&&observed.passed===true);
   console.log(JSON.stringify({passed:true,mode:operationLive?'reviewed-one-png-operation':'reviewed-one-png',sdkSends:1,syntheticFaultScenarios:0,actualStorage:true,byteEquality:true,durableBeforeEffect:true,recipientObserved:true,receiptPath:observed.receiptPath,receiptSha256:observed.receiptSha256,pngSHA256:createHash('sha256').update(stored).digest('hex'),restRequests,restWrites,storageRequests,externalCallbacks:0}));
  }catch{process.exitCode=1;console.log(JSON.stringify({passed:false,mode:operationLive?'reviewed-one-png-operation':'reviewed-one-png',liveStage,uncertain:true,retryable:false,syntheticFaultScenarios:0}));}
  finally{try{await broker?.close();}catch{process.exitCode=1;console.log(JSON.stringify({passed:false,mode:operationLive?'reviewed-one-png-operation':'reviewed-one-png',cleanupUnconfirmed:true,retryable:false}));}finally{console.error=priorError;console.warn=priorWarn;}}
 }else{
 // Exercise real PostgREST JWT verification and table grants, outside the service gateway.
 const sign=claims=>{
  const payload=[{alg:'HS256',typ:'JWT'},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${payload}.${createHmac('sha256','chert-postgrest-fixture-signing-secret-local-only-20261017').update(payload).digest('base64url')}`;
 };
 const validAnonymous=sign({role:'anon',exp:Math.floor(Date.now()/1000)+60});
 const expired=sign({role:'service_role',exp:Math.floor(Date.now()/1000)-60});
 const [header,payload,signature]=jwt.split('.');
 const forged=`${header}.${payload}.${signature[0]==='A'?'B':'A'}${signature.slice(1)}`;
 for(const token of [null,validAnonymous,forged,expired]){
  for(const table of ['messaging_tenants','messaging_attachments']){
   const denied=await fetch(new URL(`/${table}?select=*&limit=1`,target),{headers:token?{authorization:`Bearer ${token}`}:{}});
   restAuthRequests++;assert.equal(denied.status,401);
   const body=await denied.text();assert.ok(!body.includes('fixture-key')&&!body.includes('fixture-foreign')&&!body.includes('foreign.txt'));
   cases++;
  }
 }
 if(storageTarget){
 actualStorageRequests++;
 const bucket=await fetch(new URL('/bucket',storageTarget),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{authorization:`Bearer ${jwt}`,apikey:jwt,'content-type':'application/json'},body:JSON.stringify({id:'attachments',name:'attachments',public:false})});
 assert.equal(bucket.status,200,'Private fixture bucket must be created by actual Storage');await bucket.body?.cancel();
 }
 const before=await rest('messaging_attachments?select=attachment_id');const writes=restWrites;
 let response=await fetch(`${appOrigin}/api/v1/attachments`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'noauth.png',content_type:'image/png',size_bytes:8})});
 assert.equal(response.status,401);assert.equal(restWrites,writes);assert.deepEqual(await rest('messaging_attachments?select=attachment_id'),before);cases++;
 const created=await sdk().attachments.create({filename:'actual.png',content_type:'image/png',size_bytes:bytes.length});assert.match(created.attachment_id,/^[a-f0-9]{48}$/);assert.equal(storageRequests,0);cases++;
 response=await fetch(created.download_url);assert.equal(response.status,404);cases++;
 let row=await sdk().attachments.retrieve(created.attachment_id);assert.equal(row.status,'pending');
 const [actual]=await rest(`messaging_attachments?attachment_id=eq.${created.attachment_id}&select=created_at,uploaded_at`);assert.equal(row.created_at,actual.created_at);assert.equal(actual.uploaded_at,null);cases++;
 response=await fetch(created.upload_url,{method:'PUT',headers:created.required_headers,body:bytes});assert.equal(response.status,200);cases++;
 row=await sdk().attachments.retrieve(created.attachment_id);assert.equal(row.status,'complete');assert.equal(row.created_at,actual.created_at);assert.equal(row.size_bytes,bytes.length);cases++;
 response=await fetch(row.download_url);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);cases++;
 await assert.rejects(()=>sdk().attachments.retrieve('b'.repeat(48)),error=>error.status===404);cases++;
 if(storageTarget){
 const [stored]=await rest(`messaging_attachments?attachment_id=eq.${created.attachment_id}&select=blob_url`);
 assert.equal(typeof stored.blob_url,'string');
 const objectPath=stored.blob_url.split('/').map(encodeURIComponent).join('/');
 for(const token of [null,validAnonymous,forged,expired]){
  actualStorageRequests++;storageAuthRequests++;
  const denied=await fetch(new URL(`/object/authenticated/attachments/${objectPath}`,storageTarget),{redirect:'error',signal:AbortSignal.timeout(15000),headers:token?{authorization:`Bearer ${token}`,apikey:token}:{}});
  assert.ok([400,401,403,404].includes(denied.status),'Private Storage object must reject invalid authorization');await denied.body?.cancel();cases++;
 }
 actualStorageRequests++;storageAuthRequests++;
 const privateRead=await fetch(new URL(`/object/authenticated/attachments/${objectPath}`,storageTarget),{redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${jwt}`,apikey:jwt}});
 assert.equal(privateRead.status,200);assert.deepEqual(new Uint8Array(await privateRead.arrayBuffer()),bytes);cases++;
 actualStorageRequests++;storageAuthRequests++;
 const publicRead=await fetch(new URL(`/object/public/attachments/${objectPath}`,storageTarget),{redirect:'error',signal:AbortSignal.timeout(15000)});
 assert.ok([400,401,403,404].includes(publicRead.status),'A private bucket must not expose a public object URL');await publicRead.body?.cancel();cases++;

 }

 // Actual route reservation/finalization against PostgreSQL JSONB; native effect is synthetic.
 const device=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  if(req.method==='GET'){const lookup=new URL(req.url);assert.ok(lookup.pathname.startsWith('/api/v1/attachment-operations/v1/'));assert.equal(lookup.searchParams.get('from'),'+15550000001');return Response.json({origin:lookup.pathname.split('/').at(-1),found:false},{status:404});}
  assert.equal(req.method,'POST');assert.equal(new URL(req.url).pathname,'/api/v1/attachment-operations/v1');assert.equal(req.headers.get('authorization'),'Bearer device-key');
  const raw=await req.text(),body=JSON.parse(raw),[,ts,mac]=req.headers.get('x-chert-signature').split(',');assert.equal(mac,createHmac('sha256','device-signing').update(`${ts}.${raw}`).digest('hex'));
  const id=body.origin.slice('media_'.length);assert.equal(body.origin,`media_${id}`);assert.deepEqual(Object.keys(body).sort(),['attachment_id','from','origin','to']);assert.equal(body.from,'+15550000001');assert.match(id,/^[a-f0-9]{32}$/);
  const [intent]=await rest(`messaging_send_events?id=eq.${id}&select=*`);assert.ok(intent,'durable intent exists before effect');assert.equal(intent.status,'processing');assert.equal(intent.phone,'+15550000002');assert.equal(intent.phone_line_id,'61000000-0000-4000-8000-000000000001');assert.equal(body.to,intent.phone);assert.equal(body.attachment_id,created.attachment_id);assert.equal(intent.response_payload.mac_media_from,body.from);assert.equal(intent.response_payload.mac_media_origin,body.origin);assert.equal(intent.tenant_id,tenant);assert.equal(intent.response_payload.mac_media_dispatch_state,'reserved');assert.equal(intent.response_payload.attachments[0].attachment_id,created.attachment_id);nativeEffects++;
  if(mediaMode==='concurrent')await rest(`messaging_send_events?id=eq.${id}`,'PATCH',{response_payload:{...intent.response_payload,mac_media_dispatch_state:'concurrent'}});
  if(mediaMode==='reorder'){const reversed=Object.fromEntries(Object.entries(intent.response_payload).reverse());await rest(`messaging_send_events?id=eq.${id}`,'PATCH',{response_payload:reversed});}
  return Response.json({...body,fingerprint:'f'.repeat(64),preparedGuid:'550e8400-e29b-41d4-a716-446655440000',state:'acknowledged'},{status:202});
 }});deviceOrigin=device.url.origin;
 try{
  await rest('phone_lines','POST',{id:'61000000-0000-4000-8000-000000000001',project_id:'21000000-0000-4000-8000-000000000001',phone_number:'+15550000001',server_url:deviceOrigin,api_key:'device-key',signing_secret:'device-signing',status:'active',health_status:'healthy'});
  for(const fault of ['none','reserve_error','reserve_zero','finalize_error','finalize_zero','concurrent','reorder']){
   mediaMode=fault;await rest('attachment_media_fault','PATCH',{mode:fault});const before=nativeEffects,rowsBefore=await rest('messaging_send_events?select=id');reservationCases++;cases++;
   const response=await fetch(`${appOrigin}/api/v1/chats/41000000-0000-4000-8000-000000000001/messages`,{method:'POST',headers:{authorization:'Bearer fixture-key','x-chert-tenant':'fixture','content-type':'application/json'},body:JSON.stringify({message:{parts:[{type:'media',attachment_id:created.attachment_id}]}})});const result=await response.json();
   if(fault==='reserve_error'||fault==='reserve_zero'){assert.equal(response.status,500);assert.equal(nativeEffects,before);assert.deepEqual(await rest('messaging_send_events?select=id'),rowsBefore);continue;}
   assert.equal(nativeEffects,before+1,'one synthetic native effect');const id=result.message?.id??result.message_id;assert.match(id,/^[a-f0-9]{32}$/);const [saved]=await rest(`messaging_send_events?id=eq.${id}&select=*`);assert.ok(saved);assert.deepEqual(saved.request_payload,{message:{parts:[{type:'media',attachment_id:created.attachment_id}]}});assert.equal(saved.phone,'+15550000002');assert.equal(saved.phone_line_id,'61000000-0000-4000-8000-000000000001');
   if(fault==='none'||fault==='reorder'){assert.equal(response.status,202);assert.equal(saved.response_payload.mac_media_dispatch_state,'acknowledged');assert.deepEqual(saved.response_payload.native_attachment_guids,['550e8400-e29b-41d4-a716-446655440000']);}
   else{assert.equal(response.status,502);assert.equal(result.error.retryable,false);assert.equal(saved.status,'processing');assert.equal(saved.response_payload.mac_media_dispatch_state,fault==='concurrent'?'concurrent':'reserved');assert.equal(saved.response_payload.attachments[0].attachment_id,created.attachment_id);assert.equal(saved.response_payload.native_attachment_guids,undefined);}
  }
 }finally{device.stop(true);}
 const oldURL=row.download_url;
 await rest(`messaging_tenants?id=eq.${tenant}`,'PATCH',{signing_secret:'fixture-key-rotated'});
 response=await fetch(oldURL);assert.equal(response.status,404);cases++;
 const rotated=await sdk('fixture-key-rotated').attachments.retrieve(created.attachment_id);assert.notEqual(rotated.download_url,oldURL);
 response=await fetch(rotated.download_url);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);cases++;
 await rest(`messaging_tenants?id=eq.${tenant}`,'PATCH',{is_active:false});response=await fetch(rotated.download_url);assert.equal(response.status,404);cases++;
 console.log(JSON.stringify({passed:true,cases,realPostgREST:true,moduleMocks:0,restRequests,restAuthRequests,restWrites,storageRequests,...(storageTarget?{actualStorageRequests,storageAuthRequests,realStorage:true}:{storedObjects:blobs.size}),reservationCases,nativeEffects,deviceRequests:nativeEffects,liveMessages:0}));
 }
}finally{server.stop(true);gateway.stop(true);}
