// Real authenticated retrieval and canonical history mapper; only DB storage is substituted.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
import Sendblue from '../packages/sendblue-adapter/index.ts';
import Linq from '../packages/linq-adapter/src/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'history-retrieve-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false};
const lead={id:'z-lead',convo_id:'owned-convo',number:'+15550000001',details:{phone_line_id:'line-a'},messaging_tenant_id:tenant.id};
const message={id:'recv:GUID-A',guid:'GUID-A',role:'user',content:'recorded text',timestamp:'2026-10-17T01:02:03Z',source:'api'};
const convo={id:lead.convo_id,lead_id:lead.id,messages:[message]};
const tables={messaging_tenants:[tenant],messaging_send_events:[],leads:[...Array.from({length:100},(_,i)=>({id:`padding-${String(i).padStart(3,'0')}`,convo_id:null,messaging_tenant_id:tenant.id})),lead,
 {id:'foreign-lead',convo_id:'foreign-convo',number:'+15550000009',messaging_tenant_id:'tenant-b'}],convo:[convo,{id:'foreign-convo',lead_id:'foreign-lead',messages:[{...message,id:'foreign-message',content:'fixture-private-foreign'}]}]};
let reads=0,writes=0,leadPages=0,leadReads=0,convoQueries=0,failure=null,repeat=false,churn=false,removedLead=null;
class Query{
 constructor(table){this.table=table;this.filters=[];this.columns=[];}
 select(columns){this.columns=columns.split(',').map(x=>x.trim());return this;}
 eq(k,v){this.filters.push(row=>row[k]===v);this.equalities??={};this.equalities[k]=v;return this;}
 in(k,values){if(this.table==='messaging_send_events'){assert.equal(k,'response_payload->>mac_media_protocol');assert.deepEqual(values,['attachment-operations/v1','attachment-operations/v2']);assert.equal(this.equalities.tenant_id,tenant.id);assert.ok(tables.leads.some(row=>row.id===this.equalities.lead_id&&row.messaging_tenant_id===tenant.id));this.filters.push(row=>values.includes(row.response_payload?.mac_media_protocol));return this;}assert.equal(this.table,'convo');assert.equal(k,'id');assert.ok(!values.includes('foreign-convo'));this.scoped=true;this.filters.push(row=>values.includes(row[k]));return this;}
 filter(k,operator,value){if(this.table==='messaging_send_events'){
  assert.equal(k,'response_payload');assert.equal(operator,'cs');assert.equal(this.equalities.tenant_id,tenant.id);assert.ok(tables.leads.some(row=>row.id===this.equalities.lead_id&&row.messaging_tenant_id===tenant.id));
  const wanted=JSON.parse(value);assert.deepEqual(wanted,{mac_text_protocol:'text-operations/v1'});
  this.filters.push(row=>row.response_payload?.mac_text_protocol===wanted.mac_text_protocol);return this;
 }assert.equal(k,'messages');assert.equal(operator,'cs');assert.equal(this.scoped,true);const wanted=JSON.parse(value);assert.equal(wanted.length,1);assert.equal(Object.values(wanted[0]).length,1);this.filters.push(row=>Array.isArray(row[k])&&wanted.every(part=>row[k].some(item=>item&&Object.entries(part).every(([name,v])=>item[name]===v))));return this;}
 gt(key,value){if(!repeat)this.filters.push(row=>row[key]>value);return this;}order(key){this.sort=key;return this;}limit(cap){this.cap=cap;return this;}
 abortSignal(signal){assert.equal(signal.aborted,false);return this;}
 maybeSingle(){this.one=true;return this;}
 insert(){writes++;throw new Error('no writes');}update(){writes++;throw new Error('no writes');}delete(){writes++;throw new Error('no writes');}
 then(yes,no){try{reads++;if(this.table===failure)return Promise.resolve({data:null,error:{message:'fixture-private-database'}}).then(yes,no);
 if(this.table==='leads'){leadReads++;if(this.cap===100){leadPages++;assert.deepEqual(this.columns,['id','convo_id','number','details']);}}
 if(this.table==='convo'){convoQueries++;if(this.scoped){assert.equal(this.cap,2);}else{assert.equal(typeof this.equalities?.id,'string');assert.equal(typeof this.equalities?.lead_id,'string');}}
 let rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));if(this.sort)rows=rows.toSorted((a,b)=>a[this.sort].localeCompare(b[this.sort]));
 if(this.cap)rows=rows.slice(0,this.cap);
 if(this.table==='leads'&&this.cap===100&&churn&&!removedLead)removedLead=tables.leads.shift();
 rows=rows.map(row=>Object.fromEntries(this.columns.filter(key=>key in row).map(key=>[key,row[key]])));
 return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const originalFetch=globalThis.fetch;let httpRequests=0;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1','retrieval must not query devices');httpRequests++;return originalFetch(input,init);};
const route=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));const chatRoute=await import(resolve(app,'app/api/v1/chats/[id]/messages/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{const path=new URL(req.url).pathname;const chat=path.match(/^\/api\/v1\/chats\/(.+)\/messages$/);return chat?chatRoute.GET(new NextRequest(req),{params:Promise.resolve({id:decodeURIComponent(chat[1])})}):route.GET(new NextRequest(req),{params:Promise.resolve({id:decodeURIComponent(path.slice('/api/v1/messages/'.length))})});}});
let cases=0;
async function get(id,headers={authorization:'Bearer fixture-key'}){cases++;const response=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/messages/${encodeURIComponent(id)}`,{headers});const body=await response.json();assert.ok(!JSON.stringify(body).includes('fixture-private'));return{status:response.status,body};}
async function getChat(id=lead.id,query=''){cases++;const response=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/chats/${encodeURIComponent(id)}/messages${query}`,{headers:{authorization:'Bearer fixture-key'}});const body=await response.json();assert.ok(!JSON.stringify(body).includes('fixture-private'));return{status:response.status,body};}
try{
 assert.equal((await get(message.id,{})).status,401);assert.equal(reads,0);
 const canonical=await get(message.id);assert.equal(canonical.status,200);assert.equal(canonical.body.id,message.id);assert.equal(canonical.body.chat_id,lead.id);assert.equal(canonical.body.text,message.content);assert.equal(canonical.body.status,'unknown');assert.equal(canonical.body.service,'unknown');assert.equal(canonical.body.created_at,'2026-10-17T01:02:03.000Z');assert.equal(canonical.body.updated_at,null);assert.equal(canonical.body.delivered_at,null);assert.equal(canonical.body.direction,'inbound');assert.equal(leadPages,2);
 const alias=await get(message.guid);assert.equal(alias.status,200);assert.equal(alias.body.id,message.guid);assert.equal(alias.body.canonical_id,message.id);assert.equal(alias.body.native_guid,message.guid);
 const ts=Math.floor(Date.now()/1000);const sig=createHmac('sha256',tenant.signing_secret).update(`${ts}.`).digest('hex');assert.equal((await get(message.id,{'x-chert-tenant':tenant.tenant_slug,'x-chert-signature':`v1,${ts},${sig}`})).status,200);
 tenant.crm_project_id=null;assert.equal((await get(message.id)).status,200);tenant.crm_project_id='project-a';
 assert.equal((await get('foreign-message')).status,404);
 const leadRef=convo.lead_id;convo.lead_id='foreign-lead';assert.equal((await get(message.id)).status,404);convo.lead_id=leadRef;
 const duplicate={...message,id:'different-record'};convo.messages.push(duplicate);assert.equal((await get(message.guid)).status,409);convo.messages.pop();
 const secondLead={...lead,id:'zz-second',convo_id:'second-convo'};tables.leads.push(secondLead);tables.convo.push({id:secondLead.convo_id,lead_id:secondLead.id,messages:[{...message,id:'second-message'}]});assert.equal((await get(message.guid)).status,409);tables.leads.pop();tables.convo.pop();
 const old={...message,id:'old-record',guid:undefined,spectrum_message_guid:'old-guid',status:'received',service:'imessage'};convo.messages.push(old);assert.equal((await get('old-guid')).body.canonical_id,old.id);convo.messages.pop();
 const content=message.content;message.content=42;assert.equal((await get(message.id)).status,500);message.content=content;
 message.spectrum_message_guid='contradictory-guid';assert.equal((await get(message.id)).status,500);delete message.spectrum_message_guid;
 for(const table of ['leads','convo','messaging_send_events']){failure=table;assert.equal((await get(message.id)).status,500);}failure=null;
 repeat=true;assert.equal((await get(message.id)).status,500);repeat=false;
 const event={id:'legacy-text-event',tenant_id:tenant.id,status:'processing',phone:lead.number,lead_id:lead.id,convo_id:lead.convo_id,phone_line_id:null,created_at:'2026-10-17T00:00:00Z',response_payload:{status:'queued'},request_payload:{body:'recorded'},error:null};tables.messaging_send_events.push(event);
 const outgoing=await get(event.id);assert.equal(outgoing.status,200);assert.equal(outgoing.body.id,event.id);assert.equal(outgoing.body.status,'queued');assert.equal(outgoing.body.text,'recorded');assert.equal(outgoing.body.direction,'outbound');
 for(const [payload,text] of [
  [{message:{parts:[{type:'text',value:'first'},{type:'text',value:'second'}]}},'first\n\nsecond'],
  [{body:'raw wins',message:{parts:[{type:'text',value:'other'}]}},'raw wins'],
  [{body:''},''],
  [{message:{parts:[{type:'text',value:'visible'},{type:'media',attachment_id:'media-a'}]}},undefined],
  [{message:{parts:[{type:'text',value:'visible'},null]}},undefined],
  [{message:{parts:[{type:'text',value:42}]}},undefined],
  [{message:{parts:[]}},undefined],
  [{message:{parts:{malformed:true}}},undefined],
 ]){event.request_payload=payload;const row=await get(event.id);assert.equal(row.status,200);assert.equal(row.body.direction,'outbound');if(text===undefined)assert.ok(!Object.hasOwn(row.body,'text'));else assert.equal(row.body.text,text);}
 event.request_payload={body:'recorded'};tables.messaging_send_events.pop();

 const listed=await getChat();assert.equal(listed.status,200);assert.equal(listed.body.messages[0].id,message.id);assert.equal(listed.body.messages[0].status,'unknown');assert.equal(listed.body.messages[0].service,'unknown');assert.equal(listed.body.has_more,false);
 assert.equal((await get(listed.body.messages[0].id)).body.id,message.id);
 assert.equal((await getChat(lead.convo_id)).body.messages[0].id,message.id);
 message.delivered=true;const noInvent=await getChat();assert.equal(noInvent.body.messages[0].status,'unknown');assert.equal(noInvent.body.messages[0].delivered_at,null);delete message.delivered;
 message.delivered_at='2026-10-17T02:03:04Z';message.read_at='2026-10-17T03:04:05Z';message.updated_at='2026-10-17T03:04:05Z';message.service='imessage';const observed=await getChat();assert.equal(observed.body.messages[0].status,'read');assert.equal(observed.body.messages[0].delivered_at,'2026-10-17T02:03:04.000Z');assert.equal(observed.body.messages[0].read_at,'2026-10-17T03:04:05.000Z');assert.equal(observed.body.messages[0].service,'imessage');delete message.delivered_at;delete message.read_at;delete message.updated_at;delete message.service;
 const freshId=message.id,freshGuid=message.guid;delete message.id;delete message.guid;message.spectrum_message_guid='legacy-only-guid';const legacyList=await getChat();assert.equal(legacyList.body.messages[0].id,'legacy-only-guid');assert.equal((await get(legacyList.body.messages[0].id)).body.id,'legacy-only-guid');delete message.spectrum_message_guid;
 assert.equal((await getChat()).status,500);message.id=freshId;message.guid=freshGuid;
 message.content={malformed:true};assert.equal((await getChat()).status,500);message.content=content;
 convo.lead_id='foreign-lead';assert.equal((await getChat()).status,404);convo.lead_id=lead.id;
 convo.messages=[];assert.deepEqual((await getChat()).body.messages,[]);
 convo.messages=Array.from({length:201},(_,index)=>({...message,id:`stored-${index}`,guid:undefined}));const capped=await getChat();assert.equal(capped.body.messages.length,200);assert.equal(capped.body.has_more,true);assert.equal(capped.body.messages[0].id,'stored-200');assert.equal(typeof capped.body.next_cursor,'string');
 const beforeQueries=leadReads;assert.equal((await getChat(lead.id,'?unknown=10')).status,400);assert.equal(leadReads,beforeQueries);
 convo.messages={malformed:true};assert.equal((await getChat()).status,500);convo.messages=[message];

 churn=true;assert.equal((await get(message.id)).status,200);assert.ok(removedLead);tables.leads.unshift(removedLead);removedLead=null;churn=false;
 const v4=createBlooioV4Fetch({chert:{baseURL:`http://127.0.0.1:${cloud.port}`,apiKey:'fixture-key'}});
 cases++;const unknownV4=await v4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${encodeURIComponent(message.id)}`);assert.equal(unknownV4.status,200);assert.deepEqual(await unknownV4.json(),{data:{id:message.id,chat_id:lead.id,text:message.content,direction:'inbound'}});
 message.status='received';message.service='imessage';cases++;const observedV4=await v4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${message.guid}`);assert.equal(observedV4.status,200);assert.deepEqual(await observedV4.json(),{data:{id:message.guid,chat_id:lead.id,status:'received',text:message.content,direction:'inbound'}});delete message.status;delete message.service;
 cases++;const wrongV4=await v4(`https://api.blooio.com/v4/chats/wrong-chat/messages/${message.guid}`);assert.equal(wrongV4.status,404);

 tables.messaging_send_events.push(event);cases++;const outgoingV4=await v4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${event.id}`);assert.equal(outgoingV4.status,200);assert.deepEqual(await outgoingV4.json(),{data:{id:event.id,chat_id:lead.id,status:'queued',text:'recorded',direction:'outbound'}});
 event.request_payload={message:{parts:[{type:'text',value:'first'},{type:'text',value:'second'}]}};cases++;const partsV4=await v4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${event.id}`);assert.equal(partsV4.status,200);assert.equal((await partsV4.json()).data.text,'first\n\nsecond');
 for(const status of [null,'legacy-unknown']){event.status=status;const raw=await get(event.id);assert.equal(raw.status,200);assert.equal(raw.body.status,'unknown');cases++;const unknown=await v4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${event.id}`);assert.equal(unknown.status,200);const row=(await unknown.json()).data;assert.ok(!Object.hasOwn(row,'status'));assert.equal(row.direction,'outbound');assert.equal(row.text,'first\n\nsecond');}tables.messaging_send_events.pop();

 const history=Array.from({length:605},(_,index)=>({...message,id:`page-${index}`,guid:undefined,timestamp:new Date(Date.UTC(2026,9,17,0,0,index)).toISOString()}));convo.messages=history;
 const all=[];let chunk=await getChat(lead.id,'?limit=37');assert.equal(chunk.status,200);assert.equal(chunk.body.messages[0].id,'page-604');all.push(...chunk.body.messages.map(row=>row.id));let step=0;
 while(chunk.body.next_cursor){chunk=await getChat(lead.id,`?limit=${[200,100,17][step++%3]}&cursor=${encodeURIComponent(chunk.body.next_cursor)}`);assert.equal(chunk.status,200);all.push(...chunk.body.messages.map(row=>row.id));}
 assert.deepEqual(all,history.toReversed().map(row=>row.id));assert.equal(new Set(all).size,605);assert.equal(chunk.body.has_more,false);assert.equal(chunk.body.next_cursor,null);
 const asc=await getChat(lead.convo_id,'?limit=2&order=asc');assert.equal(asc.body.messages[0].id,'page-0');const ascToken=asc.body.next_cursor;
 const appendOnly={...message,id:'appended-only',timestamp:'2026-10-18T00:00:00Z'};history.push(appendOnly);history[2].content='updated actual text';history[2].read_at='2026-10-17T05:00:00Z';
 const continued=await getChat(lead.id,`?limit=200&cursor=${ascToken}`);assert.equal(continued.status,200);assert.equal(continued.body.messages[0].id,'page-2');assert.equal(continued.body.messages[0].parts[0].value,'updated actual text');assert.equal(continued.body.messages[0].status,'read');assert.ok(continued.body.messages.every(row=>row.id!=='appended-only'));
 assert.equal((await getChat(lead.id,`?cursor=${ascToken}&order=desc`)).status,400);
 const prefixOriginal=history[0];history[0]={...prefixOriginal,id:'changed-member'};assert.equal((await getChat(lead.id,`?cursor=${ascToken}`)).status,409);history[0]=prefixOriginal;
 history[0]={...prefixOriginal,timestamp:'2026-10-16T00:00:00Z'};assert.equal((await getChat(lead.id,`?cursor=${ascToken}`)).status,409);history[0]=prefixOriginal;
 [history[0],history[1]]=[history[1],history[0]];assert.equal((await getChat(lead.id,`?cursor=${ascToken}`)).status,409);[history[0],history[1]]=[history[1],history[0]];
 const removed=history.shift();assert.equal((await getChat(lead.id,`?cursor=${ascToken}`)).status,409);history.unshift(removed);
 const otherLead={...lead,id:'other-owned',convo_id:'other-owned-convo'};tables.leads.push(otherLead);tables.convo.push({id:otherLead.convo_id,lead_id:otherLead.id,messages:history});assert.equal((await getChat(otherLead.id,`?cursor=${ascToken}`)).status,400);tables.leads.pop();tables.convo.pop();
 for(const query of ['?limit=0','?limit=201','?limit=01','?limit=1&limit=2','?order=other','?order=asc&order=desc','?cursor=bad!','?cursor=','?unknown=1']){const before=leadReads;assert.equal((await getChat(lead.id,query)).status,400);assert.equal(leadReads,before);}
 history.push({...history[0]});assert.equal((await getChat(lead.id,'?limit=1')).status,500);history.pop();const originalDate=history.at(-1).timestamp;history.at(-1).timestamp=undefined;assert.equal((await getChat(lead.id,'?limit=1')).status,500);history.at(-1).timestamp=originalDate;
 const priorConvo=lead.convo_id;lead.convo_id=null;const unassigned=await getChat();assert.deepEqual(unassigned.body,{messages:[],has_more:false,next_cursor:null});lead.convo_id=priorConvo;

 const oldTenantId=tenant.id,oldOwner=lead.messaging_tenant_id;tenant.id='tenant-new';lead.messaging_tenant_id=tenant.id;assert.equal((await getChat(lead.id,`?cursor=${ascToken}`)).status,400);tenant.id=oldTenantId;lead.messaging_tenant_id=oldOwner;
 const v4Ids=[];let v4Cursor=null;
 do {cases++;const url=`https://api.blooio.com/v4/chats/${lead.id}/messages?limit=${v4Cursor?200:37}${v4Cursor?`&cursor=${encodeURIComponent(v4Cursor)}`:'&order=asc'}`;const response=await v4(url);assert.equal(response.status,200);const body=await response.json();assert.ok(body.data.every(row=>row.chat_id===lead.id));assert.ok(body.data.every(row=>!Object.hasOwn(row,'created_at')&&!Object.hasOwn(row,'protocol')));v4Ids.push(...body.data.map(row=>row.id));v4Cursor=body.next_cursor;if(!body.has_more)assert.equal(v4Cursor,null);}while(v4Cursor);
 assert.deepEqual(v4Ids,[...history].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)).map(row=>row.id));assert.equal(new Set(v4Ids).size,606);
 convo.messages=[message];
 const sendblue=new Sendblue({chert:{baseURL:`http://127.0.0.1:${cloud.port}`,apiKey:'fixture-key'}});
 message.read_at='2026-10-17T03:04:05Z';message.role='assistant';
 cases++;const readSendblue=await sendblue.messages.retrieve(message.id);assert.equal(readSendblue.data.status,'DELIVERED');assert.equal(readSendblue.data.message_handle,message.id);assert.equal(readSendblue.data.is_outbound,true);assert.equal(readSendblue.data.content,message.content);assert.ok(!Object.hasOwn(readSendblue.data,'date_sent'));assert.ok(!Object.hasOwn(readSendblue.data,'date_updated'));
 cases++;assert.equal((await sendblue.messages.getStatus({handle:message.id})).status,'DELIVERED');message.role='user';
 cases++;assert.equal((await sendblue.messages.retrieve(message.id)).data.status,'RECEIVED');
 cases++;assert.ok(!Object.hasOwn(await sendblue.messages.getStatus({handle:message.id}),'status'));message.role='unknown';
 cases++;assert.ok(!Object.hasOwn((await sendblue.messages.retrieve(message.id)).data,'status'));
 cases++;assert.ok(!Object.hasOwn(await sendblue.messages.getStatus({handle:message.id}),'status'));message.role='user';delete message.read_at;
 message.status='received';
 cases++;assert.equal((await sendblue.messages.retrieve(message.id)).data.status,'RECEIVED');
 cases++;assert.ok(!Object.hasOwn(await sendblue.messages.getStatus({handle:message.id}),'status'));delete message.status;
 cases++;assert.ok(!Object.hasOwn((await sendblue.messages.retrieve(message.id)).data,'status'));
 const linq=new Linq({chert:{baseURL:`http://127.0.0.1:${cloud.port}`,apiKey:'fixture-key'}});
 message.status='received';
 cases++;await assert.rejects(async()=>await linq.chats.messages.list(lead.id),error=>error.status===502);
 message.updated_at='2026-10-17T03:04:05Z';
 cases++;const linqPage=await linq.chats.messages.list(lead.id,{limit:1});assert.equal(linqPage.messages.length,1);assert.equal(linqPage.messages[0].id,message.id);assert.equal(linqPage.messages[0].updated_at,'2026-10-17T03:04:05.000Z');assert.equal(linqPage.messages[0].delivery_status,'received');assert.equal(linqPage.messages[0].is_delivered,false);assert.equal(linqPage.messages[0].is_read,false);assert.equal(linqPage.messages[0].is_from_me,false);assert.ok(!Object.hasOwn(linqPage.messages[0],'parts'));assert.equal(linqPage.next_cursor,'');assert.equal(linqPage.hasNextPage(),false);
 cases++;const linqRetrieved=await linq.messages.retrieve(message.id);assert.equal(linqRetrieved.id,message.id);assert.equal(linqRetrieved.chat_id,lead.id);assert.equal(linqRetrieved.delivery_status,'received');assert.ok(!Object.hasOwn(linqRetrieved,'parts'));
 message.read_at='2026-10-17T03:04:05Z';message.role='assistant';
 cases++;const linqRead=(await linq.chats.messages.list(lead.id)).messages[0];assert.equal(linqRead.delivery_status,'read');assert.equal(linqRead.is_read,true);assert.equal(linqRead.is_delivered,true);assert.equal(linqRead.is_from_me,true);
 message.role='user';cases++;assert.equal((await linq.messages.retrieve(message.id)).is_from_me,false);delete message.read_at;delete message.status;
 cases++;await assert.rejects(async()=>await linq.chats.messages.list(lead.id),error=>error.status===502);
 message.status='received';message.role='unknown';cases++;await assert.rejects(async()=>await linq.messages.retrieve(message.id),error=>error.status===502);message.role='user';delete message.updated_at;
 cases++;await assert.rejects(async()=>await linq.messages.retrieve(message.id),error=>error.status===502);
 const linqHistory=history.slice(0,605).map(row=>({...row,status:'received',updated_at:'2026-10-18T00:00:00Z'}));convo.messages=linqHistory;
 cases++;const linqIDs=[];for await(const row of linq.chats.messages.list(lead.id,{limit:37})){linqIDs.push(row.id);assert.equal(row.chat_id,lead.id);assert.equal(row.delivery_status,row.id==='page-2'?'read':'received');}
 assert.deepEqual(linqIDs,linqHistory.toReversed().map(row=>row.id));assert.equal(new Set(linqIDs).size,605);convo.messages=[message];delete message.status;
 assert.equal(writes,0);console.log(JSON.stringify({passed:true,cases,writes,deviceRequests:0,actualAuth:true,paginatedMetadata:true,scopedConvoQueries:convoQueries>0}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
