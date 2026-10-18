// Actual authenticated HTTP and PostgreSQL/PostgREST. No device or native effect.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import {createClient} from '@supabase/supabase-js';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
import SendblueAPI from '../packages/sendblue-adapter/index.ts';
import {attachmentCaptionSHA256} from '../../imessage-server/lib/sending/attachment-operation-context.ts';
import {verifyOneHourAttachmentDownload} from '../../imessage-server/lib/messaging/attachment-download.ts';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
const origin=process.env.CHERT_TEST_JOURNAL_URL;
assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const secret='chert-disposable-journal-secret-at-least-32-bytes';
const raw=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+180}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const jwt=raw+'.'+createHmac('sha256',secret).update(raw).digest('base64url');
const realFetch=globalThis.fetch;let reads=0,writes=0,requests=0,cases=0,cloud;
const fetchREST=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url);assert.equal(url.origin,origin);
 url.pathname=url.pathname.replace(/^\/rest\/v1/,'');requests++;
 if(req.method==='GET')reads++;else writes++;
 return realFetch(url,{method:req.method,headers:req.headers,redirect:'error',...(!['GET','HEAD'].includes(req.method)?{body:await req.arrayBuffer()}:{})});
};
const db=createClient(origin,jwt,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchREST}});
for(let i=0;i<100;i++){if((await realFetch(origin+'/',{headers:{Authorization:'Bearer '+jwt}}).catch(()=>null))?.ok)break;if(i===99)throw Error('local database readiness');await Bun.sleep(20);}
const tenant='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002',project='21000000-0000-4000-8000-000000000001';
const lead='41000000-0000-4000-8000-000000000001',legacy='41000000-0000-4000-8000-000000000002',foreign='41000000-0000-4000-8000-000000000003';
const convo='51000000-0000-4000-8000-000000000001',foreignConvo='51000000-0000-4000-8000-000000000003',line='61000000-0000-4000-8000-000000000001';
const from='+15550000001',to='+15550000002',text='Frozen account history / Café';
const event=(id,date)=>({id,tenant_id:tenant,lead_id:lead,convo_id:null,phone:to,phone_line_id:line,status:'processing',created_at:date,request_payload:{message:{parts:[{type:'text',value:text}]}},response_payload:{status:'queued',mac_text_origin:'text_'+id,mac_text_protocol:'text-operations/v1',mac_text_from:from,mac_text_to:to,mac_text_fingerprint:textOperationFingerprint(from,to,text),mac_text_dispatch_state:'reserved'}});
const check=async query=>{const r=await query;assert.equal(r.error,null);return r.data;};
await check(db.from('messaging_tenants').insert([{id:tenant,tenant_slug:'account-a',signing_secret:'account-a-test-key',crm_project_id:project,is_active:true},{id:other,tenant_slug:'account-b',signing_secret:'account-b-test-key',crm_project_id:project,is_active:true}]));
await check(db.from('leads').insert([{id:lead,messaging_tenant_id:tenant,project_id:project,number:'+15550000009',convo_id:null},{id:legacy,messaging_tenant_id:tenant,project_id:project,number:to,convo_id:convo},{id:foreign,messaging_tenant_id:other,project_id:project,number:to,convo_id:foreignConvo}]));
await check(db.from('convo').insert([{id:convo,lead_id:legacy,messages:[{id:'legacy-inbound',role:'user',content:'Legacy observed text',timestamp:'2026-10-18T00:00:00Z',status:'received'}]},{id:foreignConvo,lead_id:foreign,messages:[{id:'foreign-hidden',role:'user',content:'Never expose foreign content',timestamp:'2026-10-20T00:00:00Z',status:'received'}]}]));
await check(db.from('messaging_send_events').insert([event('a'.repeat(32),'2026-10-18T01:00:00.123456Z'),event('b'.repeat(32),'2026-10-18T02:00:00Z'),{...event('c'.repeat(32),'2026-10-21T00:00:00Z'),tenant_id:other,lead_id:foreign}]));
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'account-history-pg',setup(b){b.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));b.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const route=await import(resolve(app,'app/api/v1/messages/route.ts'));
const chatRoute=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname.startsWith('/api/v1/chats/')?chatRoute.GET(new NextRequest(req),{params:Promise.resolve({id:new URL(req.url).pathname.split('/')[4]})}):route.GET(new NextRequest(req))});
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,cloud.url.origin,'No native or external request');return realFetch(input,init);};
async function get(query='',status=200,key='account-a-test-key'){
 cases++;const before=writes;
 const res=await fetch(cloud.url.origin+'/api/v1/messages'+query,{headers:key?{authorization:'Bearer '+key}:{}});assert.equal(res.status,status,`HTTP case ${cases}`);assert.equal(writes,before,'Route must only read');
 const body=await res.json();assert.ok(!JSON.stringify(body).includes('mac_text_'));assert.ok(!JSON.stringify(body).includes('mac_media_'));if(key==='account-a-test-key')assert.ok(!JSON.stringify(body).includes('Never expose foreign content'));return body;
}
try{
 await get('',401,'');
 const sdk=new SendblueAPI({chert:{baseURL:cloud.url.origin,apiKey:'account-a-test-key'},maxRetries:0});
 const beforeSDKWrites=writes;
 const listed=await sdk.messages.list({limit:1,offset:1,order_by:'createdAt',order_direction:'desc'});
 assert.equal(listed.data.length,1);assert.equal(listed.data[0].message_handle,'a'.repeat(32));assert.equal(listed.data[0].number,to);assert.equal(listed.data[0].from_number,from);assert.equal(listed.data[0].sendblue_number,from);assert.equal(listed.data[0].date_sent,undefined);assert.equal(listed.pagination.total,3);assert.equal(writes,beforeSDKWrites);
 await assert.rejects(sdk.messages.list({number:to}),error=>error.status===422);
 await assert.rejects(sdk.messages.list({account_email:'unsupported@example.invalid'}),error=>error.status===501);
 const all=await get();assert.equal(all.messages.length,3);assert.equal(all.pagination.total,3);assert.deepEqual(all.messages.map(r=>r.id),['b'.repeat(32),'a'.repeat(32),'legacy-inbound']);
 assert.equal(all.messages[0].from,from);assert.equal(all.messages[0].to,to);assert.equal(all.messages[0].line_number,from);assert.equal(all.messages[0].sent_at,null);assert.equal(all.messages[2].from,null);
 const fractional=await get('?created_at_gte=2026-10-18T01%3A00%3A00.123400Z&created_at_lte=2026-10-18T01%3A00%3A00.123500Z');assert.equal(fractional.messages.length,1);assert.equal(fractional.messages[0].id,'a'.repeat(32));
 const page=await get('?limit=1&offset=1');assert.equal(page.messages[0].id,'a'.repeat(32));assert.equal(page.pagination.has_more,true);
 await get('?number='+encodeURIComponent(to),422); // Legacy endpoints cannot be inferred from current contact.
 await get('?order_by=sent_at',422);
 await get('?limit=1&limit=2',400);
 await check(db.from('convo').update({messages:[]}).eq('id',convo));
 const filtered=await get('?from_number='+encodeURIComponent(from)+'&to_number='+encodeURIComponent(to)+'&limit=1&offset=1');assert.equal(filtered.pagination.total,2);assert.equal(filtered.messages[0].id,'a'.repeat(32));
 const ownOther=await get('',200,'account-b-test-key');assert.equal(ownOther.pagination.total,2);assert.ok(ownOther.messages.every(r=>r.chat_id===foreign));
 await check(db.from('messaging_send_events').insert({...event('d'.repeat(32),'2026-10-18T03:00:00Z'),request_payload:{message:{parts:[{type:'media',attachment_id:'a'.repeat(48)}]}},response_payload:{status:'queued',mac_media_protocol:'attachment-operations/v1'}}));
 await get('',500); // Unsupported owned send must not disappear from a successful inventory.
 await check(db.from('messaging_send_events').delete().eq('id','d'.repeat(32)));
 await get();
 const mediaID='e'.repeat(48),mediaMessage='e'.repeat(32);
 const oldAttachment={attachment_id:mediaID,filename:'photo.png',content_type:'image/png',size_bytes:4,download_url:`https://old.invalid/api/v1/attachments/${mediaID}/download?tenant=${tenant}&signature=${'0'.repeat(64)}&expires=946684800`,download_url_expires_at:'2000-01-01T00:00:00.000Z'};
 const mediaPayload={status:'queued',mac_media_protocol:'attachment-operations/v1',mac_media_origin:'media_'+mediaMessage,mac_media_from:from,mac_media_dispatch_state:'reserved',attachments:[oldAttachment]};
 await check(db.from('messaging_attachments').insert({attachment_id:mediaID,tenant_id:tenant,uploaded_at:'2026-10-18T00:00:00Z',filename:'photo.png',content_type:'image/png',size_bytes:4,blob_url:`messaging-attachments/${tenant}/${mediaID}/photo.png`,live_photo:false}));
 await check(db.from('messaging_send_events').insert({...event(mediaMessage,'2026-10-18T04:00:00Z'),request_payload:{message:{parts:[{type:'media',attachment_id:mediaID}]}},response_payload:mediaPayload}));
 const withMedia=await get();const mediaRecord=withMedia.messages.find(r=>r.id===mediaMessage);assert.ok(mediaRecord);assert.equal(mediaRecord.endpoint_source,'strict_media_intent');
 const renewedURL=new URL(mediaRecord.attachments[0].download_url);assert.equal(renewedURL.origin,cloud.url.origin);assert.ok(verifyOneHourAttachmentDownload({id:tenant,signing_secret:'account-a-test-key'},mediaID,renewedURL.searchParams.get('expires'),renewedURL.searchParams.get('signature')));
 const sdkMedia=await sdk.messages.list({limit:1});assert.equal(sdkMedia.data[0].message_handle,mediaMessage);const sdkURL=new URL(sdkMedia.data[0].media_url);assert.equal(sdkURL.origin,cloud.url.origin);assert.equal(sdkURL.pathname,renewedURL.pathname);assert.ok(verifyOneHourAttachmentDownload({id:tenant,signing_secret:'account-a-test-key'},mediaID,sdkURL.searchParams.get('expires'),sdkURL.searchParams.get('signature')));assert.equal(sdkMedia.data[0].date_sent,undefined);assert.equal(sdkMedia.data[0].status,'QUEUED');
 assert.deepEqual((await check(db.from('messaging_send_events').select('response_payload').eq('id',mediaMessage).single())).response_payload,mediaPayload);
 await check(db.from('messaging_attachments').update({tenant_id:other}).eq('attachment_id',mediaID));await get('',500);
 await check(db.from('messaging_attachments').update({tenant_id:tenant,filename:'changed.png'}).eq('attachment_id',mediaID));await get('',500);
 await check(db.from('messaging_attachments').update({filename:'photo.png'}).eq('attachment_id',mediaID));await get();
 const v4=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'account-a-test-key'}});
 const chatList=async(status=200,query='')=>{cases++;const before=writes;const r=await v4(`https://api.blooio.com/v4/chats/${lead}/messages${query}`);assert.equal(r.status,status);assert.equal(writes,before);const body=await r.json();assert.ok(!JSON.stringify(body).includes('mac_media_'));return body;};
 const v4Listed=await chatList();const v4Media=v4Listed.data.find(row=>row.id===mediaMessage);assert.ok(v4Media);assert.equal(v4Media.status,'queued');assert.equal(v4Media.attachments[0].media_type,'image/png');assert.equal(v4Media.attachments[0].size,4);assert.equal(new URL(v4Media.attachments[0].url).origin,cloud.url.origin);
 assert.deepEqual((await check(db.from('messaging_send_events').select('response_payload').eq('id',mediaMessage).single())).response_payload,mediaPayload);
 const v4Caption='  Exact caption / Café 🌅\r\n  ',v4CaptionPayload={...mediaPayload,mac_media_origin:'caption_'+mediaMessage,mac_media_protocol:'attachment-operations/v2',mac_media_caption_sha256:attachmentCaptionSHA256(v4Caption)};
 await check(db.from('messaging_send_events').update({request_payload:{message:{parts:[{type:'text',value:v4Caption},{type:'media',attachment_id:mediaID}]}},response_payload:v4CaptionPayload}).eq('id',mediaMessage));
 const captionList=await chatList();const captionRecord=captionList.data.find(row=>row.id===mediaMessage);assert.equal(captionRecord.text,v4Caption);assert.equal(captionRecord.attachments[0].caption,v4Caption);
 await check(db.from('messaging_send_events').update({request_payload:{message:{parts:[{type:'text',value:'edited'},{type:'media',attachment_id:mediaID}]}}}).eq('id',mediaMessage));await chatList(500);
 await check(db.from('messaging_send_events').update({request_payload:{message:{parts:[{type:'media',attachment_id:mediaID}]}},response_payload:mediaPayload}).eq('id',mediaMessage));
 await check(db.from('messaging_attachments').update({tenant_id:other}).eq('attachment_id',mediaID));await chatList(500);
 await check(db.from('messaging_attachments').update({tenant_id:tenant}).eq('attachment_id',mediaID));
 cases++;const badAuth=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'wrong'}});assert.equal((await badAuth(`https://api.blooio.com/v4/chats/${lead}/messages`)).status,404);
 const foreignList=await v4(`https://api.blooio.com/v4/chats/${foreign}/messages`);cases++;assert.equal(foreignList.status,404);
 const firstMediaPage=await chatList(200,'?limit=1');assert.equal(firstMediaPage.has_more,true);const nextMediaPage=await chatList(200,'?limit=1&cursor='+encodeURIComponent(firstMediaPage.next_cursor));assert.notEqual(nextMediaPage.data[0].id,firstMediaPage.data[0].id);
 const addedConvo='51000000-0000-4000-8000-000000000099';await check(db.from('convo').insert({id:addedConvo,lead_id:lead,messages:[{id:'new-inbound-after-media-page',role:'user',content:'Recorded append',timestamp:'2026-10-18T06:00:00Z'}]}));await check(db.from('leads').update({convo_id:addedConvo}).eq('id',lead));const afterAppend=await chatList(200,'?limit=1&cursor='+encodeURIComponent(firstMediaPage.next_cursor));assert.equal(afterAppend.data[0].id,nextMediaPage.data[0].id);const laterMedia='8'.repeat(32);await check(db.from('messaging_send_events').insert({...event(laterMedia,'2026-10-18T07:00:00Z'),request_payload:{message:{parts:[{type:'media',attachment_id:mediaID}]}},response_payload:{...mediaPayload,mac_media_origin:'media_'+laterMedia}}));const afterMediaAppend=await chatList(200,'?limit=1&cursor='+encodeURIComponent(firstMediaPage.next_cursor));assert.equal(afterMediaAppend.data[0].id,nextMediaPage.data[0].id);await check(db.from('messaging_send_events').delete().eq('id',laterMedia));await check(db.from('convo').update({messages:[{id:'new-inbound-after-media-page',role:'user',content:'Recorded historical insert',timestamp:'2026-10-18T00:30:00Z'}]}).eq('id',addedConvo));await chatList(409,'?limit=1&cursor='+encodeURIComponent(firstMediaPage.next_cursor));await check(db.from('leads').update({convo_id:null}).eq('id',lead));await check(db.from('convo').delete().eq('id',addedConvo));
 const overflow=Array.from({length:1000},(_,i)=>{const id='9'+i.toString(16).padStart(31,'0');return{...event(id,'2026-10-18T05:00:00Z'),request_payload:{message:{parts:[{type:'media',attachment_id:mediaID}]}},response_payload:{...mediaPayload,mac_media_origin:'media_'+id}}});await check(db.from('messaging_send_events').insert(overflow));await chatList(500);for(let i=0;i<overflow.length;i+=100)await check(db.from('messaging_send_events').delete().in('id',overflow.slice(i,i+100).map(r=>r.id)));
 const strongMedia={...mediaPayload,status:'delivered',service:'imessage',delivered:true,delivered_at:'2026-10-18T04:00:02.000Z',mac_media_dispatch_state:'acknowledged',native_attachment_guids:['550E8400-E29B-41D4-A716-446655440000']};
 await check(db.from('messaging_send_events').update({status:'ok',response_payload:strongMedia}).eq('id',mediaMessage));
 const unproved=await get();assert.equal(unproved.messages.find(r=>r.id===mediaMessage).status,'unknown');assert.equal(unproved.messages.find(r=>r.id===mediaMessage).delivered_at,null);
 const unknownSDK=await sdk.messages.list({limit:1});assert.equal(unknownSDK.data[0].status,undefined);assert.ok(unknownSDK.data[0].media_url);
 // Bound cached evidence is a synthetic native-proof fixture, not a live device poll.
 const proofGUID='550E8400-E29B-41D4-A716-446655440000';
 const deliveredMs=Date.now()-2000,readMs=deliveredMs+1000;
 const nativeEvidence={evidence_source:'chat_db_exact_guid',guid:proofGUID,recipient:to,sender:from,service:'imessage',has_attachments:true,is_sent:true,is_delivered:true,is_read:false,delivered_at:deliveredMs};
 const bound={version:1,tenant_id:tenant,lead_id:lead,message_id:mediaMessage,phone_line_id:line,protocol:'attachment-operations/v1',origin:'media_'+mediaMessage,attachment_id:mediaID,caption_sha256:null,evidence:nativeEvidence};
 const deliveredPayload={...strongMedia,status:'delivered',error:null,retryable:false,delivered:true,read:false,delivered_at:new Date(deliveredMs).toISOString(),mac_media_evidence:bound};
 await check(db.from('messaging_send_events').update({response_payload:deliveredPayload}).eq('id',mediaMessage));
 const provenDelivered=(await get()).messages.find(r=>r.id===mediaMessage);
 const chatDelivered=await chatList();assert.equal(chatDelivered.data.find(r=>r.id===mediaMessage).status,'delivered');
 assert.equal(provenDelivered.status,'delivered');assert.equal(provenDelivered.delivered_at,new Date(deliveredMs).toISOString());assert.equal(provenDelivered.sent_at,null);assert.equal(provenDelivered.read_at,null);
 const deliveredSDK=await sdk.messages.list({limit:1});assert.equal(deliveredSDK.data[0].status,'DELIVERED');assert.equal(deliveredSDK.data[0].date_sent,undefined);
 const readPayload={...deliveredPayload,status:'read',read:true,read_at:new Date(readMs).toISOString(),mac_media_evidence:{...bound,evidence:{...nativeEvidence,is_read:true,read_at:readMs}}};
 await check(db.from('messaging_send_events').update({response_payload:readPayload}).eq('id',mediaMessage));
 const provenRead=(await get()).messages.find(r=>r.id===mediaMessage);assert.equal(provenRead.status,'read');assert.equal(provenRead.read_at,new Date(readMs).toISOString());assert.equal(provenRead.delivered_at,new Date(deliveredMs).toISOString());assert.equal(provenRead.sent_at,null);
 const chatRead=await chatList();assert.equal(chatRead.data.find(r=>r.id===mediaMessage).status,'read');
 for(const bad of [
  {...readPayload,mac_media_evidence:{...readPayload.mac_media_evidence,tenant_id:other}},
  {...readPayload,mac_media_evidence:{...readPayload.mac_media_evidence,evidence:{...readPayload.mac_media_evidence.evidence,recipient:'+15550000003'}}},
  {...readPayload,mac_media_evidence:{...readPayload.mac_media_evidence,evidence:{...readPayload.mac_media_evidence.evidence,guid:'650E8400-E29B-41D4-A716-446655440000'}}},
  {...readPayload,delivered_at:new Date(deliveredMs+1).toISOString()},
  {...readPayload,mac_media_evidence:{...readPayload.mac_media_evidence,caption_sha256:'a'.repeat(64)}},
  {...readPayload,mac_media_evidence:{...readPayload.mac_media_evidence,evidence:{...readPayload.mac_media_evidence.evidence,is_read:1}}},
 ]){
  await check(db.from('messaging_send_events').update({response_payload:bad}).eq('id',mediaMessage));
  const refused=(await get()).messages.find(r=>r.id===mediaMessage);assert.equal(refused.status,'unknown');assert.equal(refused.delivered_at,null);assert.equal(refused.read_at,null);assert.equal(refused.sent_at,null);
 }
 await check(db.from('messaging_send_events').update({response_payload:strongMedia}).eq('id',mediaMessage));
 const captionID='f'.repeat(32),caption='  Exact / Café 🌅\r\n  ';
 const captionPayload={...mediaPayload,mac_media_protocol:'attachment-operations/v2',mac_media_origin:'caption_'+captionID,mac_media_caption_sha256:attachmentCaptionSHA256(caption)};
 await check(db.from('messaging_send_events').insert({...event(captionID,'2026-10-18T05:00:00Z'),request_payload:{message:{parts:[{type:'text',value:caption},{type:'media',attachment_id:mediaID}]}},response_payload:captionPayload}));
 const captionHistory=await get();assert.equal(captionHistory.messages[0].id,captionID);assert.equal(captionHistory.messages[0].parts[0].value,caption);
 const captionSDK=await sdk.messages.list({limit:1});assert.equal(captionSDK.data[0].content,caption);assert.ok(captionSDK.data[0].media_url);assert.equal(captionSDK.data[0].date_sent,undefined);
 assert.deepEqual((await check(db.from('messaging_send_events').select('response_payload').eq('id',mediaMessage).single())).response_payload,strongMedia);
 await check(db.from('messaging_send_events').update({response_payload:{...event('a'.repeat(32),'2026-10-18T01:00:00.123456Z').response_payload,mac_text_fingerprint:'corrupt'}}).eq('id','a'.repeat(32)));
 await get('',500);
 console.log(JSON.stringify({passed:true,cases,actualAuth:true,actualGET:true,realPostgres:true,realPostgrest:true,dbMocks:0,nativeActions:0,actualOfficialSDK:true,reads,requests}));
}finally{globalThis.fetch=realFetch;await cloud.stop(true);}
