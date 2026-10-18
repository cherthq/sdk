// Actual adapter/auth/routes/PostgreSQL; only native HTTP is synthetic loopback.
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {AsyncLocalStorage} from 'node:async_hooks';
import {plugin} from 'bun';
import {createClient} from '@supabase/supabase-js';
import Linq from '../packages/linq-adapter/src/index.ts';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
const origin=process.env.CHERT_TEST_JOURNAL_URL;assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const secret='chert-disposable-journal-secret-at-least-32-bytes',raw=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+300}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.'),jwt=raw+'.'+createHmac('sha256',secret).update(raw).digest('base64url');
const flow=new AsyncLocalStorage();
const realFetch=globalThis.fetch,allowed=new Set([origin]);let chertRequests=0,dbWrites=0,metadataGets=0,lookupPosts=0,nativePosts=0,cases=0,ackGate=null,insertBarrier=null,unknown=false,cloud;
async function guarded(input,init){const req=new Request(input,init),u=new URL(req.url);assert.ok(allowed.has(u.origin),'Only owned loopback');u.pathname=u.pathname.replace(/^\/rest\/v1/,'');if(u.origin===origin&&!['GET','HEAD'].includes(req.method))dbWrites++;if(flow.getStore()==='lookup')assert.equal(req.method,'GET','Lookup must not write or dispatch');if(u.origin===origin&&u.pathname==='/messaging_send_events'&&req.method==='POST'&&insertBarrier){const b=insertBarrier;if(++b.count===2){insertBarrier=null;b.release();}await b.ready;}const response=await realFetch(u,{method:req.method,headers:req.headers,redirect:'error',...(!['GET','HEAD'].includes(req.method)?{body:await req.arrayBuffer()}:{} )});if(u.origin===native.url.origin&&unknown){await response.body?.cancel();throw Error('Synthetic lost acknowledgement');}return response;}
globalThis.fetch=guarded;process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=jwt;
const db=createClient(origin,jwt,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guarded}}),check=async q=>{const r=await q;assert.equal(r.error,null);return r.data;};
for(let i=0;i<100;i++){if((await realFetch(origin+'/',{headers:{authorization:'Bearer '+jwt}}).catch(()=>null))?.ok)break;await Bun.sleep(20);}
const tenant='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002',project='21000000-0000-4000-8000-000000000001',lead='41000000-0000-4000-8000-000000000001',otherLead='41000000-0000-4000-8000-000000000002',line='61000000-0000-4000-8000-000000000001',from='+15550000001',to='+15550000002',text='  actual / Café 🦀\r\n  ';
const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){assert.equal(req.method,'POST');const media=new URL(req.url).pathname==='/api/v1/attachment-operations/v1';assert.ok(media||new URL(req.url).pathname==='/api/v1/text-operations/v1');assert.equal(req.headers.get('authorization'),'Bearer native-key');const raw=await req.text(),body=JSON.parse(raw),sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(req.headers.get('x-chert-signature')??'');assert.ok(sig);assert.equal(sig[2],createHmac('sha256','native-secret').update(sig[1]+'.'+raw).digest('hex'));assert.deepEqual(Object.keys(body).sort(),media?['attachment_id','from','origin','to']:['from','origin','text','to']);const stored=await check(db.from('messaging_send_events').select('*').eq('id',body.origin.slice(media?6:5)).single());assert.equal(stored.response_payload[media?'mac_media_dispatch_state':'mac_text_dispatch_state'],'reserved');if(media){assert.equal(stored.request_payload.message.parts[0].attachment_id,body.attachment_id);assert.equal(stored.response_payload.mac_media_from,body.from);}else{assert.equal(stored.request_payload.message.parts[0].value,body.text);assert.equal(stored.response_payload.mac_text_fingerprint,textOperationFingerprint(body.from,body.to,body.text));}assert.ok(['blooio-v4','linq-v3'].includes(stored.response_payload.mac_idempotency_request.profile));nativePosts++;if(ackGate)await ackGate;return Response.json({... (media?{attachment_id:body.attachment_id}:{}),origin:body.origin,from:body.from,to:body.to,fingerprint:media?'f'.repeat(64):textOperationFingerprint(body.from,body.to,body.text),preparedGuid:randomUUID(),state:'acknowledged'},{status:202});}});allowed.add(native.url.origin);
await check(db.from('messaging_tenants').insert([{id:tenant,signing_secret:'key-a',tenant_slug:'a',is_active:true,crm_project_id:project},{id:other,signing_secret:'key-b',tenant_slug:'b',is_active:true,crm_project_id:project}]));
await check(db.from('leads').insert([{id:lead,messaging_tenant_id:tenant,project_id:project,number:to,details:{phone_line_id:line}},{id:otherLead,messaging_tenant_id:other,project_id:project,number:to,details:{phone_line_id:line}}]));
await check(db.from('phone_lines').insert({id:line,project_id:project,phone_number:from,status:'active',health_status:'healthy',server_url:native.url.origin,api_key:'native-key',signing_secret:'native-secret'}));
const app=resolve(import.meta.dir,'../../imessage-server');await plugin({name:'v4-idempotency-pg',setup(b){b.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));b.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const route=await import('../../imessage-server/app/api/v1/chats/route.ts'),existing=await import('../../imessage-server/app/api/v1/chats/[id]/messages/route.ts'),metadata=await import('../../imessage-server/app/api/v1/attachments/[id]/route.ts');
const lookup=await import('../../imessage-server/app/api/v1/idempotency/lookup/route.ts'),{NextRequest}=await import('./next-route-platform.mjs');
const {createAttachmentDownloadURL}=await import('../../imessage-server/lib/messaging/attachment-download.ts');
const tlsDir=mkdtempSync(join(tmpdir(),'chert-v4-keyed-tls-')),certPath=join(tlsDir,'ca.pem'),keyPath=join(tlsDir,'key.pem'),configPath=join(tlsDir,'openssl.cnf');
writeFileSync(configPath,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Chert owned loopback\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n',{mode:0o600});
try{execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-config',configPath],{stdio:'pipe',timeout:10000});}catch(error){rmSync(tlsDir,{recursive:true,force:true});throw error;}
cloud=Bun.serve({hostname:'127.0.0.1',port:0,tls:{cert:Bun.file(certPath),key:Bun.file(keyPath)},fetch:r=>{const u=new URL(r.url),request=new NextRequest(r);if(u.pathname==='/api/v1/idempotency/lookup'){lookupPosts++;return flow.run('lookup',()=>lookup.POST(request));}if(u.pathname.startsWith('/api/v1/attachments/')){metadataGets++;return metadata.GET(request,{params:Promise.resolve({id:u.pathname.split('/')[4]})});}if(u.pathname==='/api/v1/chats')return route.POST(request);const m=/^\/api\/v1\/chats\/([^/]+)\/messages$/.exec(u.pathname);assert.ok(m);return existing.POST(request,{params:Promise.resolve({id:decodeURIComponent(m[1])})});}});
const cloudOrigin=`https://localhost:${cloud.port}`,ca=await Bun.file(certPath).text();allowed.add(cloudOrigin);
const chertFetch=(input,init)=>{chertRequests++;assert.equal(new URL(input instanceof Request?input.url:String(input)).origin,cloudOrigin);return realFetch(input,{...init,tls:{ca,rejectUnauthorized:true},redirect:'error'});};
const adapter=key=>createBlooioV4Fetch({chert:{baseURL:cloudOrigin,apiKey:key,fetch:chertFetch}}),a=adapter('key-a'),b=adapter('key-b');
const send=async(key,patch={},transport=a,path='/messages')=>{cases++;const r=await transport('https://api.blooio.com/v4'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from,to,text,...patch})});return{status:r.status,body:await r.json()};};
try{
 // Bypass adapter validation: real authenticated raw HTTP must reject before
 // lead pinning, reservation or native work, even with a syntactically valid context.
 for(const existingChat of [false,true])for(const invalidText of [' \t\r\n ','\ud800']){
  const beforeWrites=dbWrites,beforeNative=nativePosts,parts=[{type:'text',value:invalidText}];
  const requestContext={version:1,profile:'blooio-v4',route:existingChat?`/v4/chats/${lead}/messages`:'/v4/messages',body_sha256:'0'.repeat(64)};
  const message={parts,idempotency_key:'raw-invalid-'+cases,idempotency_request:requestContext};
  const body=existingChat?{message}:{from,to:[to],message};
  cases++;const res=await chertFetch(cloudOrigin+(existingChat?`/api/v1/chats/${lead}/messages`:'/api/v1/chats'),{method:'POST',headers:{authorization:'Bearer key-a','content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(res.status,501);assert.equal(dbWrites,beforeWrites,'Invalid context-bound text cannot mutate routing or reserve');assert.equal(nativePosts,beforeNative);
 }
 const first=await send('first');assert.equal(first.status,201);const id=first.body.id;assert.match(id,/^[a-f0-9]{32}$/);assert.equal(nativePosts,1);
 const replay=await send('first');assert.equal(replay.status,200);assert.equal(replay.body.id,id);assert.equal(nativePosts,1);
 for(const patch of [{from:'+15550000003'},{to:'+15550000003'},{text:text+'x'}]){assert.equal((await send('first',patch)).status,409);assert.equal(nativePosts,1);}
 await check(db.from('convo').insert({id:'51000000-0000-4000-8000-000000000001',lead_id:lead,messages:[]}));await check(db.from('phone_lines').update({status:'inactive'}).eq('id',line));await check(db.from('leads').update({number:'+15550000009',convo_id:'51000000-0000-4000-8000-000000000001',details:{phone_line_id:'61000000-0000-4000-8000-000000000009'}}).eq('id',lead));
 const historical=await send('first');assert.equal(historical.status,200);assert.equal(historical.body.id,id);assert.equal(nativePosts,1);
 for(const patch of [{from:'+15550000003'},{to:'+15550000003'},{text:'changed'}]){assert.equal((await send('first',patch)).status,409);assert.equal(nativePosts,1);}
 await check(db.from('leads').update({number:to,convo_id:null,details:{phone_line_id:line}}).eq('id',lead));await check(db.from('phone_lines').update({status:'active'}).eq('id',line));
 const isolated=await send('first',{},b);assert.equal(isolated.status,201);assert.notEqual(isolated.body.id,id);assert.equal(nativePosts,2);
 unknown=true;const lost=await send('lost');assert.equal(lost.status,502);assert.equal(lost.body.error.code,'4103');assert.equal(lost.body.error.details.retryable,false);assert.match(lost.body.error.details.message_id,/^[a-f0-9]{32}$/);const n=nativePosts;const lostAgain=await send('lost');assert.equal(lostAgain.status,502);assert.deepEqual(lostAgain.body.error.details,lost.body.error.details);assert.equal(nativePosts,n);unknown=false;
 let releaseInsert,releaseAck;insertBarrier={count:0,ready:new Promise(r=>{releaseInsert=r}),release:()=>releaseInsert()};ackGate=new Promise(r=>{releaseAck=r});
 const pending=[send('race'),send('race')];let race;
 try{const loser=await Promise.race(pending);assert.equal(loser.status,502);releaseAck();race=await Promise.all(pending);}finally{releaseAck();ackGate=null;}
 assert.equal(nativePosts,n+1);assert.equal(new Set(race.map(r=>r.body.id??r.body.error.details.message_id)).size,1);assert.equal(race.filter(r=>r.status===201).length,1);const win=race.find(r=>r.status===201);const later=await send('race');assert.equal(later.status,200);assert.equal(later.body.id,win.body.id);assert.equal(nativePosts,n+1);
 const before=nativePosts;assert.equal((await send('unsupported',{media_url:'https://foreign.invalid/image.png'})).status,501);assert.equal(nativePosts,before);
 const existingBody={text};
 const keyedExisting=async(key,body=existingBody)=>{cases++;const r=await a('https://api.blooio.com/v4/chats/'+lead+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 assert.equal((await keyedExisting('first')).status,409);
 const existingFresh=await keyedExisting('existing');assert.equal(existingFresh.status,201);assert.equal((await keyedExisting('existing')).status,200);assert.equal((await keyedExisting('existing',{...existingBody,text:'different'})).status,409);
 const attachmentID='a'.repeat(48),filename='image.png';
 await check(db.from('messaging_attachments').insert({attachment_id:attachmentID,tenant_id:tenant,filename,content_type:'image/png',size_bytes:70,uploaded_at:new Date().toISOString(),blob_url:`messaging-attachments/${tenant}/${attachmentID}/${filename}`,live_photo:false}));
 const imageURL=createAttachmentDownloadURL(cloudOrigin,{id:tenant,signing_secret:'key-a'},attachmentID),imageBody={attachments:[imageURL]};
 assert.equal((await keyedExisting('existing',imageBody)).status,409);assert.equal(metadataGets,0);
 const mediaFresh=await keyedExisting('media',imageBody);assert.equal(mediaFresh.status,201,JSON.stringify({code:mediaFresh.body.error?.code,message:mediaFresh.body.error?.message,nativePosts,metadataGets}));assert.equal(metadataGets,1);const mediaNative=nativePosts;
 const metaBefore=metadataGets,lookupBefore=lookupPosts;
 await check(db.from('messaging_attachments').delete().eq('attachment_id',attachmentID));await check(db.from('phone_lines').update({status:'inactive'}).eq('id',line));
 const mediaReplay=await keyedExisting('media',imageBody);assert.equal(mediaReplay.status,200);assert.equal(mediaReplay.body.id,mediaFresh.body.id);assert.equal(metadataGets,metaBefore);assert.equal(nativePosts,mediaNative);assert.equal(lookupPosts,lookupBefore+1);
 const newMissing=await keyedExisting('new-missing-media',imageBody);assert.equal(newMissing.status,404);assert.equal(metadataGets,metaBefore+1);assert.equal(nativePosts,mediaNative);
 const changedURL=imageURL.replace(/signature=[a-f0-9]{64}/,'signature='+'c'.repeat(64));assert.equal((await keyedExisting('media',{attachments:[changedURL]})).status,409);assert.equal(metadataGets,metaBefore+1);assert.equal(nativePosts,mediaNative);
 await check(db.from('messaging_tenants').update({signing_secret:'key-a-rotated'}).eq('id',tenant));
 const rotated=createBlooioV4Fetch({chert:{baseURL:cloudOrigin,apiKey:'key-a-rotated',fetch:chertFetch}});cases++;const rotatedResponse=await rotated('https://api.blooio.com/v4/chats/'+lead+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'media'},body:JSON.stringify(imageBody)});assert.equal(rotatedResponse.status,200);assert.equal(metadataGets,metaBefore+1);assert.equal(nativePosts,mediaNative);
 await check(db.from('messaging_tenants').update({signing_secret:'key-a'}).eq('id',tenant));
 // Genuine Linq SDK crosses the same authenticated route/database with its own
 // request profile and key limits, retaining exact frozen media on replay.
 await check(db.from('phone_lines').update({status:'active'}).eq('id',line));
 await check(db.from('messaging_attachments').insert({attachment_id:attachmentID,tenant_id:tenant,filename,content_type:'image/png',size_bytes:70,uploaded_at:new Date().toISOString(),blob_url:`messaging-attachments/${tenant}/${attachmentID}/${filename}`,live_photo:false}));
 const linq=new Linq({chert:{baseURL:cloudOrigin,apiKey:'key-a',fetch:chertFetch},maxRetries:0});
 const linqSend=async(key,parts=[{type:'text',value:text}],options)=>{cases++;return linq.chats.messages.send(lead,{message:{parts,idempotency_key:key}},options).withResponse();};
 const beforeLinq=nativePosts;
 const linqFresh=await linqSend('linq-text');assert.equal(linqFresh.response.status,200);assert.equal(linqFresh.data.message.delivery_status,'queued');assert.equal(nativePosts,beforeLinq+1);
 const linqReplay=await linqSend('linq-text',undefined,{idempotencyKey:'linq-text'});assert.equal(linqReplay.response.status,200);assert.deepEqual(linqReplay.data,linqFresh.data);assert.equal(nativePosts,beforeLinq+1);
 await assert.rejects(linqSend('linq-text',[{type:'text',value:'changed'}]),e=>e.status===409);assert.equal(nativePosts,beforeLinq+1);
 await assert.rejects(linqSend('existing'),e=>e.status===409);assert.equal(nativePosts,beforeLinq+1); // V4 key cannot migrate profiles.
 const linqMedia=await linqSend('linq-media',[{type:'media',attachment_id:attachmentID}]);assert.equal(linqMedia.response.status,200);assert.equal(nativePosts,beforeLinq+2);
 const frozenURL=linqMedia.data.message.parts[0].url;assert.ok(frozenURL);const mediaPublicID=linqMedia.data.message.id;
 const frozenRow=await check(db.from('messaging_send_events').select('*').eq('id',mediaPublicID).single());
 const originalNow=Date.now,expiredNow=originalNow()+65*60*1000,beforeReplayWrites=dbWrites,beforeReplayMeta=metadataGets;
 try{
  Date.now=()=>expiredNow;assert.ok(Number(new URL(frozenURL).searchParams.get('expires'))*1000<Date.now());
  const expiredReplay=await linqSend('linq-media',[{type:'media',attachment_id:attachmentID}]);assert.equal(expiredReplay.response.status,200);assert.equal(expiredReplay.data.message.parts[0].url,frozenURL);assert.deepEqual(expiredReplay.data,linqMedia.data);
 }finally{Date.now=originalNow;}
 assert.equal(dbWrites,beforeReplayWrites);assert.equal(metadataGets,beforeReplayMeta);assert.equal(nativePosts,beforeLinq+2);assert.deepEqual(await check(db.from('messaging_send_events').select('*').eq('id',mediaPublicID).single()),frozenRow);
 const unicodeKey='🦀'.repeat(255);const unicode=await linqSend(unicodeKey);assert.equal(unicode.response.status,200);assert.equal(nativePosts,beforeLinq+3);
 const invalidBefore=chertRequests;
 await assert.rejects(linqSend('🦀'.repeat(256)),e=>e.status===501||e.status===400);assert.equal(chertRequests,invalidBefore);
 await assert.rejects(linqSend('body-key',undefined,{idempotencyKey:'different-option'}),/Conflicting idempotency keys/);assert.equal(chertRequests,invalidBefore);assert.equal(nativePosts,beforeLinq+3);
 for(const request of [{version:1,profile:'foreign',route:`/v3/chats/${lead}/messages`,body_sha256:'a'.repeat(64)},{version:1,profile:'linq-v3',route:`/v3/chats/${lead}/other`,body_sha256:'a'.repeat(64)}]){
  const beforeWrites=dbWrites,beforeNative=nativePosts;cases++;const r=await chertFetch(cloudOrigin+'/api/v1/idempotency/lookup',{method:'POST',headers:{authorization:'Bearer key-a','content-type':'application/json'},body:JSON.stringify({key:'malformed-profile',request})});assert.equal(r.status,400);assert.equal(dbWrites,beforeWrites);assert.equal(nativePosts,beforeNative);
 }
 await check(db.from('leads').update({messaging_tenant_id:other}).eq('id',lead));assert.ok([404,409].includes((await send('first')).status));assert.equal(nativePosts,beforeLinq+3);
 console.log(JSON.stringify({passed:true,cases,nativePosts,metadataGets,lookupPosts,downloadFetches:0,actualAuth:true,realPostgres:true,dbMocks:0,liveActions:0}));
}finally{globalThis.fetch=realFetch;await native.stop(true);await cloud.stop(true);rmSync(tlsDir,{recursive:true,force:true});}
