import {isDeepStrictEqual} from 'node:util';
// Real HMAC ingest, dispatch, conversation RPC helper, notifier and receiver.
// Only DB storage and unrelated opt-out/pacing/SMS integrations are substituted.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import { unwrapChert } from '../packages/sendblue-adapter/index.ts';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'inbound-fixture-resolution',setup(build){
 build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
 build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const originalError=console.error,originalWarn=console.warn;let dispatchErrors=0,verificationWarnings=0;
console.error=(...args)=>{assert.equal(args[0],'[imessage/inbound] dispatch error:');dispatchErrors++;};
console.warn=(...args)=>{assert.equal(args[0],'[imessage/inbound] verify failed:');verificationWarnings++;};
const inputSecret='fixture-native-secret',callbackSecret='fixture-callback-secret',inputSecretB='fixture-native-b',callbackSecretB='fixture-callback-b';
let persistFailure=false,subscriptionFailure=false,proofFailure=false,receiverStatus=204;
const line={id:'line-a',project_id:'project-a',webhook_subscription_id:'native-sub-a',signing_secret:inputSecret};
const lead={id:'lead-a',project_id:'project-a',messaging_tenant_id:'tenant-a',convo_id:'convo-a',number:'+15550000002',details:{phone_line_id:'line-a'}};
const tenant={id:'tenant-a',crm_project_id:'project-a',phone_line_id:'line-a',is_active:true,webhook_url:null,webhook_secret:null,outbound_consecutive_failures:0,signing_secret:'fixture-api-key',tenant_slug:'fixture-tenant',requires_tenant_header:false};
const lineB={id:'line-b',project_id:'project-b',webhook_subscription_id:'native-sub-b',signing_secret:inputSecretB};
const tables={phone_lines:[line,lineB],leads:[lead,{...lead,id:'foreign-lead',convo_id:'convo-b',project_id:'project-b',messaging_tenant_id:'tenant-b',details:{phone_line_id:'line-b'}}],
 messaging_tenants:[tenant,{...tenant,id:'tenant-b',crm_project_id:'project-b',phone_line_id:'line-b',signing_secret:'fixture-api-key-b',tenant_slug:'fixture-tenant-b'}],convo:[{id:'convo-a',messages:[]},{id:'convo-b',messages:[]}],tenant_webhook_subscriptions:[],messaging_send_events:[],messaging_events:[],messaging_received_contexts:[],webhook_event_dedup:[]};
const appends=new Set();let sideEffects=0;
class Query {
 constructor(table){this.table=table;this.filters=[];this.orders=[];}
 select(){return this;}eq(key,value){if(key==='delivery_attempts'){const expected=typeof value==='string'?JSON.parse(value):value;this.filters.push(row=>isDeepStrictEqual(row[key],expected));}else this.filters.push(row=>row[key]===value);return this;}
 filter(key,operator,value){if(this.table==='convo'){assert.equal(key,'messages');assert.equal(operator,'cs');const wanted=JSON.parse(value);this.filters.push(row=>wanted.every(pattern=>row.messages.some(message=>Object.entries(pattern).every(([k,v])=>message[k]===v))));return this;}assert.equal(this.table,'messaging_send_events');assert.equal(key,'response_payload');assert.equal(operator,'cs');const wanted=JSON.parse(value);assert.deepEqual(wanted,{mac_text_protocol:'text-operations/v1'});this.filters.push(row=>row.response_payload?.mac_text_protocol===wanted.mac_text_protocol);return this;}
 neq(key,value){this.filters.push(row=>row[key]!==value);return this;}
 or(filter){const pairs=filter.split(',').map(term=>term.split('.eq.'));this.filters.push(row=>pairs.some(([key,value])=>row[key]===value));return this;}
 in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}abortSignal(){return this;}
 limit(value){this.cap=value;return this;}order(key,options={}){this.orders.push([key,options.ascending!==false]);return this;}
 insert(value){this.inserted={id:`${this.table}-${tables[this.table].length+1}`,...(this.table==='messaging_events'?{delivery_attempts:[]}:{}),...value};return this;}
 upsert(value,options){assert.equal(this.table,'messaging_received_contexts');assert.deepEqual(options,{onConflict:'tenant_id,primary_guid',ignoreDuplicates:true});this.proofInsert=value;return this;}
 update(value){this.patch=value;return this;}single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}
 then(yes,no){try{
  if((persistFailure&&this.table==='messaging_events'&&this.inserted)||(subscriptionFailure&&this.table==='tenant_webhook_subscriptions'&&!this.patch))return Promise.resolve({data:null,error:{code:'XX',message:'fixture DB failure'}}).then(yes,no);
  let rows;
  if(this.proofInsert){if(proofFailure)return Promise.resolve({data:null,error:{code:'XX'}}).then(yes,no);if(!tables[this.table].some(row=>row.tenant_id===this.proofInsert.tenant_id&&row.primary_guid===this.proofInsert.primary_guid))tables[this.table].push(this.proofInsert);return Promise.resolve({data:null,error:null}).then(yes,no);}
  if(this.inserted){const duplicate=['messaging_events','webhook_event_dedup'].includes(this.table)&&tables[this.table].some(row=>row.event_id===this.inserted.event_id&&(this.table!=='messaging_events'||row.tenant_id===this.inserted.tenant_id));if(duplicate)return Promise.resolve({data:null,error:{code:'23505',message:'duplicate key'}}).then(yes,no);tables[this.table].push(this.inserted);rows=[this.inserted];}
  else rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));
  if(this.orders.length)rows=[...rows].sort((a,b)=>{for(const [key,asc] of this.orders){if(a[key]!==b[key])return(a[key]<b[key]?-1:1)*(asc?1:-1);}return 0;});
  if(this.cap)rows=rows.slice(0,this.cap);if(this.patch)for(const row of rows)Object.assign(row,this.patch);
  return Promise.resolve({data:this.one?rows[0]??null:rows,error:null,count:rows.length}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
const database={from:table=>new Query(table),rpc:async(name,args)=>{
 assert.equal(name,'append_convo_message');const convo=tables.convo.find(row=>row.id===args.p_convo_id);assert.ok(convo);
 const key=`${args.p_convo_id}:${args.p_idempotency_key}`;if(!appends.has(key)){appends.add(key);if(!convo.messages.some(message=>message.id===args.p_message.id))convo.messages.push(args.p_message);}
 return{error:null};
}};
mock.module(resolve(app,'lib/supabase-server.ts'),()=>({createServerSupabase:()=>database}));
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>database}));
mock.module(resolve(app,'lib/anti-spam/opt-out.ts'),()=>({detectAndBlock:async(input)=>{assert.equal(typeof input.body,'string');sideEffects++;return{hardStop:false};}}));
mock.module(resolve(app,'lib/anti-spam/recipient-pacing.ts'),()=>({recordReply:async()=>{sideEffects++;}}));
mock.module(resolve(app,'lib/sms/twilio-send.ts'),()=>({sendSMS:async()=>{throw new Error('SMS forbidden');}}));
const rawFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1');return rawFetch(input,init);};
const callbacks=[];
const receiver=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const body=await request.text();const subscription=request.headers.get('x-webhook-subscription-id');
 const converted=await unwrapChert(body,request.headers,{secret:subscription==='callback-a'?callbackSecret:callbackSecretB});
 assert.ok(tables.messaging_events.some(row=>row.event_id===converted.eventId),'event is durable before callback');
 callbacks.push({body:JSON.parse(body),converted,subscription:request.headers.get('x-webhook-subscription-id')});return new Response(null,{status:receiverStatus});
}});
tables.tenant_webhook_subscriptions.push({id:'callback-a',tenant_id:'tenant-a',url:`http://127.0.0.1:${receiver.port}/callback`,secret:callbackSecret,events:['message_received'],version:'2026-04-01',is_active:true,consecutive_failures:0},
 {id:'callback-b',tenant_id:'tenant-b',url:`http://127.0.0.1:${receiver.port}/callback-b`,secret:callbackSecretB,events:[],version:'2026-04-01',is_active:true,consecutive_failures:0});
const {POST}=await import(resolve(app,'app/api/imessage/inbound/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const messageRoute=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));
const historyRoute=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));
const {convoMessageToChertMessage}=await import(resolve(app,'lib/api-shape/internal-to-chert.ts'));
const ingest=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>{const messageMatch=/^\/api\/v1\/messages\/([^/]+)$/.exec(new URL(request.url).pathname);if(messageMatch)return messageRoute.GET(new NextRequest(request),{params:Promise.resolve({id:decodeURIComponent(messageMatch[1])})});const match=/^\/api\/v1\/chats\/([^/]+)\/messages$/.exec(new URL(request.url).pathname);return match?historyRoute.GET(new NextRequest(request),{params:Promise.resolve({id:decodeURIComponent(match[1])})}):POST(new NextRequest(request));}});
function event(id,patch={}){return{type:'message_received',event_id:`recv:${id}`,phone_line_id:'forged-line',ts:Math.floor(Date.now()/1000),message:{guid:id,role:'inbound',status:'received',recipient:lead.number,phone_line_id:'forged-line',parts:[{type:'text',text:'inbound fixture',value:'inbound fixture'}],is_group:false,...patch}};}
async function send(payload,{tamper=false,secondLine=false}={}){const body=JSON.stringify(payload),ts=Math.floor(Date.now()/1000);const mac=createHmac('sha256',secondLine?inputSecretB:inputSecret).update(`${ts}.${body}`).digest('hex');return fetch(`http://127.0.0.1:${ingest.port}/api/imessage/inbound`,{method:'POST',headers:{'x-webhook-subscription-id':secondLine?'native-sub-b':'native-sub-a','x-webhook-signature':`t=${ts},v1=${mac}`},body:tamper?body+' ':body});}
try{
 assert.equal((await send(event('good'))).status,200);assert.equal(callbacks.length,1);
 const delivered=callbacks[0];assert.equal(delivered.converted.eventId,'recv:good');assert.equal(delivered.body.phone_line_id,line.id);assert.equal(delivered.body.chat_id,lead.id);assert.equal(delivered.body.message.service,undefined);assert.equal(delivered.subscription,'callback-a');assert.equal(delivered.converted.message.from_number,lead.number);
 assert.equal((await send(event('good'))).status,200);assert.equal(callbacks.length,1);
 const before=sideEffects;assert.equal((await send(event('tamper'),{tamper:true})).status,401);assert.equal(sideEffects,before);
 tables.leads.push({...lead,id:'ambiguous'});assert.equal((await send(event('ambiguous'))).status,500);tables.leads.pop();assert.equal(sideEffects,before);
 lead.details.phone_line_id='line-b';assert.equal((await send(event('wrong-line'))).status,500);lead.details.phone_line_id='line-a';assert.equal(sideEffects,before);
 tenant.crm_project_id='project-b';assert.equal((await send(event('wrong-tenant'))).status,500);tenant.crm_project_id='project-a';assert.equal(sideEffects,before);
 persistFailure=true;assert.equal((await send(event('persist-retry'))).status,500);assert.equal(callbacks.length,1);persistFailure=false;
 assert.equal((await send(event('persist-retry'))).status,200);assert.equal(callbacks.length,2);
 receiverStatus=400;assert.equal((await send(event('callback-retry'))).status,500);assert.equal(tables.messaging_events.at(-1).delivery_status,'failed');receiverStatus=204;
 const beforeMutation=callbacks.length;assert.equal((await send(event('callback-retry',{parts:[{type:'text',text:'mutated plaintext',value:'mutated plaintext'}]}))).status,500);assert.equal(callbacks.length,beforeMutation);
 assert.equal((await send(event('callback-retry'))).status,200);assert.equal(callbacks.length,4);assert.equal(callbacks[2].converted.eventId,callbacks[3].converted.eventId);assert.equal(tables.messaging_events.filter(row=>row.event_id==='recv:callback-retry').length,1);
 subscriptionFailure=true;assert.equal((await send(event('subscription-retry'))).status,500);subscriptionFailure=false;assert.equal((await send(event('subscription-retry'))).status,200);
 const sameID=await send(event('good'),{secondLine:true});assert.equal(sameID.status,200);
 assert.equal(callbacks.at(-1).converted.eventId,'recv:good');assert.equal(callbacks.at(-1).subscription,'callback-b');assert.equal(callbacks.at(-1).body.chat_id,'foreign-lead');assert.equal(callbacks.at(-1).body.phone_line_id,'line-b');
 assert.equal(tables.messaging_events.filter(row=>row.event_id==='recv:good').length,2);
 assert.ok(tables.webhook_event_dedup.some(row=>row.event_id==='line-a:recv:good'));assert.ok(tables.webhook_event_dedup.some(row=>row.event_id==='line-b:recv:good'));
 const beforeHints=callbacks.length;
 const conflictingHints={...event('forged-lead',{lead_id:'foreign-lead'}),lead:{id:'foreign-lead',phone:'+15550000099'},inbound_message:{text:'not the actual native text'}};
 assert.equal((await send(conflictingHints)).status,200);assert.equal(callbacks.length,beforeHints+1);
 assert.equal(callbacks.at(-1).subscription,'callback-a');assert.equal(callbacks.at(-1).body.chat_id,lead.id);assert.equal(callbacks.at(-1).body.message.recipient,lead.number);assert.equal(callbacks.at(-1).body.message.text,'inbound fixture');
 const beforeUnsupported=callbacks.length;const previousAppendCount=appends.size;
 lead.messaging_tenant_id=null;assert.equal((await send(event('crm-owned'))).status,200);assert.equal(appends.size,previousAppendCount+1);assert.equal(callbacks.length,beforeUnsupported);lead.messaging_tenant_id='tenant-a';
 tenant.is_active=false;assert.equal((await send(event('inactive-tenant'))).status,200);assert.equal(callbacks.length,beforeUnsupported);tenant.is_active=true;

 for(const [id,patch] of [['numeric-group',{is_group:1}],['bad-participants',{chat_participants:'not-an-array'}],['unknown-peer',{recipient:'+15550000008'}]]) {
  assert.equal((await send(event(id,patch))).status,200);assert.equal(callbacks.length,beforeUnsupported);
 }
 const callbackCount=callbacks.length;assert.equal((await send(event('media',{parts:[{type:'media',url:'https://forbidden.invalid'}]}))).status,200);assert.equal(callbacks.length,callbackCount);
 const newLead={...lead,id:'first-inbound-lead',number:'+15550000004',convo_id:null,details:{phone_line_id:'line-a'}};tables.leads.push(newLead);
 const firstInbound=event('first-inbound',{recipient:newLead.number});receiverStatus=400;
 assert.equal((await send(firstInbound)).status,500);assert.ok(newLead.convo_id);
 const firstEvent=tables.messaging_events.find(row=>row.event_id==='recv:first-inbound');assert.equal(firstEvent.convo_id,newLead.convo_id);
 receiverStatus=204;assert.equal((await send(firstInbound)).status,200);assert.equal(tables.convo.find(row=>row.id===newLead.convo_id).messages.length,1);
 const storageLead={...lead,id:'storage-lead',number:'+15550000006',convo_id:'storage-convo',details:{phone_line_id:'line-a'}};
 const storageConvo={id:storageLead.convo_id,lead_id:storageLead.id,messages:[]};tables.leads.push(storageLead);tables.convo.push(storageConvo);
 const storageCallbacks=callbacks.length;
 async function stored(id,patch){storageConvo.messages=[];assert.equal((await send(event(id,{recipient:storageLead.number,...patch}))).status,200);assert.equal(callbacks.length,storageCallbacks);return storageConvo.messages[0];}
 const v4=createBlooioV4Fetch({chert:{baseURL:`http://127.0.0.1:${ingest.port}`,apiKey:'fixture-api-key'}});
 const multiParts=[{type:'text',text:'first',value:'first'},{type:'text',text:'second',value:'second'}];
 const multi=await stored('storage-multi',{parts:multiParts,text:'first\n\nsecond'});assert.equal(multi.content,'first\n\nsecond');assert.deepEqual(multi.parts,multiParts);assert.equal(multi.native_text,'first\n\nsecond');assert.equal(multi.status,'received');assert.equal(multi.updated_at,undefined);assert.equal(multi.service,undefined);
 const listed=await v4(`https://api.blooio.com/v4/chats/${storageLead.id}/messages`);assert.equal(listed.status,200);assert.deepEqual((await listed.json()).data,[{id:'recv:storage-multi',chat_id:storageLead.id,text:'first\n\nsecond',direction:'inbound',status:'received'}]);
 const mixedParts=[{type:'text',text:'caption',value:'caption'},{type:'media',url:'https://forbidden.invalid/asset'}];
 const mixed=await stored('storage-mixed',{parts:mixedParts,text:'caption'});assert.equal(mixed.content,'caption');assert.deepEqual(mixed.parts,mixedParts);assert.equal(convoMessageToChertMessage(mixed,storageLead.id),null);assert.equal((await v4(`https://api.blooio.com/v4/chats/${storageLead.id}/messages`)).status,500);
 const mediaParts=[{type:'media',url:'https://forbidden.invalid/only-media'}];const media=await stored('storage-media',{parts:mediaParts,text:''});assert.equal(media.content,'');assert.deepEqual(media.parts,mediaParts);assert.equal(media.status,'received');assert.equal(convoMessageToChertMessage(media,storageLead.id),null);
 const mismatch=await stored('storage-part-alias',{parts:[{type:'text',text:'first',value:'different'}]});assert.equal(mismatch.content,'first');assert.equal(convoMessageToChertMessage(mismatch,storageLead.id),null);
 const nativeMismatch=await stored('storage-native-alias',{parts:[{type:'text',text:'first',value:'first'}],text:'different'});assert.equal(nativeMismatch.native_text,'different');assert.equal(convoMessageToChertMessage(nativeMismatch,storageLead.id),null);
 const roleMismatch=await stored('storage-role',{role:'outbound'});assert.equal(roleMismatch.status,undefined);assert.equal(convoMessageToChertMessage(roleMismatch,storageLead.id).status,'unknown');
 storageConvo.messages=[];const legacy={...event('storage-legacy',{recipient:storageLead.number}),type:'lead_reply',lead:{id:storageLead.id,phone:storageLead.number},inbound_message:{text:'legacy reply'}};assert.equal((await send(legacy)).status,200);assert.equal(storageConvo.messages[0].content,'legacy reply');assert.equal(storageConvo.messages[0].status,undefined);assert.equal(storageConvo.messages[0].parts,undefined);
 assert.equal(await stored('storage-empty',{parts:[]}),undefined);
 const malformedParts=[{type:'text',text:{malformed:true}}];const malformed=await stored('storage-nonstring',{parts:malformedParts});assert.equal(malformed.content,'');assert.deepEqual(malformed.parts,malformedParts);assert.equal(convoMessageToChertMessage(malformed,storageLead.id),null);
 const statusMismatch=await stored('storage-status',{status:'sent'});assert.equal(statusMismatch.status,undefined);assert.equal(convoMessageToChertMessage(statusMismatch,storageLead.id).status,'unknown');
 const group=await stored('storage-group',{is_group:true,chat_participants:[storageLead.number,'+15550000007']});assert.equal(group.native_is_group,true);assert.deepEqual(group.native_chat_participants,[storageLead.number,'+15550000007']);assert.equal(convoMessageToChertMessage(group,storageLead.id),null);assert.equal((await v4(`https://api.blooio.com/v4/chats/${storageLead.id}/messages`)).status,500);
 const numericGroup=await stored('storage-group-number',{is_group:1});assert.equal(numericGroup.native_is_group,1);assert.equal(convoMessageToChertMessage(numericGroup,storageLead.id),null);
 const badParticipants=await stored('storage-participants-invalid',{chat_participants:{malformed:true}});assert.deepEqual(badParticipants.native_chat_participants,{malformed:true});assert.equal(convoMessageToChertMessage(badParticipants,storageLead.id),null);
 const contradictoryParticipants=await stored('storage-participants-group',{chat_participants:[storageLead.number,'+15550000007']});assert.equal(contradictoryParticipants.native_is_group,false);assert.equal(convoMessageToChertMessage(contradictoryParticipants,storageLead.id),null);

 const verifiedLine='11000000-0000-4000-8000-000000000001',nativeGuid='22222222-2222-4333-8444-555555555555';
 const originalLineId=line.id;line.id=verifiedLine;line.phone_number='+15550000001';tenant.phone_line_id=verifiedLine;storageLead.details.phone_line_id=verifiedLine;
 const nativeEvidence={version:1,primary_guid:nativeGuid,receiver:line.phone_number,service:'iMessage',is_from_me:false,is_group:false,associated_message_type:0,associated_message_guid:null,balloon_bundle_id:null};
 const receivedEvent=event(nativeGuid,{recipient:storageLead.number,parts:multiParts,text:'first\n\nsecond',service:'imessage',native_received_evidence:nativeEvidence});
 storageConvo.messages=[];assert.equal((await send(receivedEvent)).status,200);
 const frozen=structuredClone(storageConvo.messages[0].native_received_context);assert.deepEqual(frozen,{...nativeEvidence,phone_line_id:verifiedLine,source_event_id:'recv:'+nativeGuid});assert.equal(storageConvo.messages[0].service,'imessage');
 const read=async(headers={})=>{const response=await fetch(`http://127.0.0.1:${ingest.port}/api/v1/messages/${nativeGuid}`,{headers:{Authorization:'Bearer fixture-api-key',...headers}});return{status:response.status,body:await response.json()};};
 let projected=await read();assert.equal(projected.status,200);assert.deepEqual(projected.body.native_received_context,frozen);assert.equal(projected.body.native_guid,nativeGuid);
 storageLead.details.phone_line_id='line-repinned';line.phone_number='+15550000009';projected=await read();assert.deepEqual(projected.body.native_received_context,frozen);assert.equal(projected.body.phone_line_id,'line-repinned');assert.deepEqual(storageConvo.messages[0].native_received_context,frozen);
 assert.equal((await read({Authorization:'Bearer fixture-api-key-b'})).status,404);
 line.phone_number=nativeEvidence.receiver;storageLead.details.phone_line_id=verifiedLine;
 assert.equal((await send({...receivedEvent,message:{...receivedEvent.message,native_received_evidence:{...nativeEvidence,receiver:'+15550000009'}}})).status,200);assert.deepEqual(storageConvo.messages[0].native_received_context,frozen);
 for(const [index,patch] of [{receiver:'+15550000009'},{primary_guid:nativeGuid},{service:'SMS'},{associated_message_type:2000},{balloon_bundle_id:'app'},{is_from_me:true}].entries()){
  const id=`33333333-2222-4333-8444-${String(index).padStart(12,'0')}`;storageConvo.messages=[];
  assert.equal((await send(event(id,{recipient:storageLead.number,parts:multiParts,text:'first\n\nsecond',service:'imessage',native_received_evidence:{...nativeEvidence,primary_guid:id,...patch}}))).status,200);assert.equal(storageConvo.messages[0].native_received_context,undefined);
 }
 const failedGuid='66666666-2222-4333-8444-555555555555',beforeProofFailure=sideEffects;storageConvo.messages=[];proofFailure=true;
 assert.equal((await send(event(failedGuid,{recipient:storageLead.number,parts:multiParts,text:'first\n\nsecond',service:'imessage',native_received_evidence:{...nativeEvidence,primary_guid:failedGuid}}))).status,500);assert.equal(storageConvo.messages.length,0);assert.equal(sideEffects,beforeProofFailure);proofFailure=false;
 const forgedGuid='44444444-2222-4333-8444-555555555555';storageConvo.messages=[{role:'user',content:'forged',timestamp:new Date().toISOString(),source:'api',id:'recv:'+forgedGuid,guid:forgedGuid,service:'imessage',native_received_context:{...frozen,primary_guid:forgedGuid,source_event_id:'recv:'+forgedGuid}}];
 const forgedResponse=await fetch(`http://127.0.0.1:${ingest.port}/api/v1/messages/${forgedGuid}`,{headers:{Authorization:'Bearer fixture-api-key'}});assert.equal(forgedResponse.status,200);assert.equal((await forgedResponse.json()).native_received_context,undefined);assert.equal(tables.messaging_received_contexts.length,1);
 line.id=originalLineId;tenant.phone_line_id=originalLineId;storageLead.details.phone_line_id=originalLineId;
 assert.equal(callbacks.length,storageCallbacks);
 assert.equal(dispatchErrors,9);assert.equal(verificationWarnings,1);
 console.log(JSON.stringify({passed:true,cases:46,callbacks:callbacks.length,liveMessages:0,dispatchErrors,verificationWarnings}));
}finally{ingest.stop(true);receiver.stop(true);globalThis.fetch=rawFetch;console.error=originalError;console.warn=originalWarn;}
