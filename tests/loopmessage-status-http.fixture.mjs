import {createLoopMessageFetch} from '../packages/loopmessage-adapter/index.ts';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
// Actual auth/status handler and native GET transport; database/native device are boundaries.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'strict-text-recovery-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture',signing_secret:'fixture-key',is_active:true,requires_tenant_header:false,crm_project_id:'project-a'};
const id='a'.repeat(32),guid='550e8400-e29b-41d4-a716-446655440000',origin='text_'+id;
const line={id:'line-a',phone_number:'+15550000001',status:'active',server_url:'',api_key:'device-key'};
const base={id,tenant_id:tenant.id,lead_id:'chat-a',convo_id:'convo-a',phone:'+15550000002',phone_line_id:line.id,status:'processing',error:null,created_at:'2026-10-17T00:00:00Z',request_payload:{message:{parts:[{type:'text',value:'synthetic recovery'}]}},response_payload:{status:'queued',mac_text_dispatch_state:'unconfirmed',mac_text_origin:origin,mac_text_protocol:'text-operations/v1',mac_text_from:line.phone_number,mac_text_to:'+15550000002',mac_text_fingerprint:textOperationFingerprint(line.phone_number,'+15550000002','synthetic recovery')}};
let row=structuredClone(base),mode='attempted',proof='none',cas='',cases=0,queries=0,writes=0,posts=0,operationReads=0,evidenceReads=0;
const tables={messaging_tenants:[tenant],phone_lines:[line],messaging_events:[],leads:[]};
class Query{
 constructor(table){this.table=table;this.filters=[];}select(columns){this.columns=columns;return this;}eq(k,v){this.filters.push(r=>['response_payload','request_payload'].includes(k)?JSON.stringify(r[k])===v:r[k]===v);return this;}in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}filter(){return this;}abortSignal(){return this;}order(){return this;}limit(){return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}update(value){this.updated=value;return this;}
 then(yes,no){try{queries++;if(this.table==='messaging_send_events'&&!this.updated&&this.columns?.includes('updated_at'))return Promise.resolve({data:null,error:{code:'42703',message:'column messaging_send_events.updated_at does not exist'}}).then(yes,no);
 if(this.updated){assert.equal(this.table,'messaging_send_events');writes++;if(cas==='concurrent')row.response_payload={...row.response_payload,mac_text_dispatch_state:'operator-reconciled'};if(cas==='phone')row.phone='+15550000099';if(cas==='request')row.request_payload={message:{parts:[{type:'text',value:'concurrent-edit'}]}};if(cas==='status')row.status='failed';if(cas==='line')row.phone_line_id='foreign-line';if(cas==='error')return Promise.resolve({data:null,error:{message:'private-error-sentinel'}}).then(yes,no);if(cas==='zero')return Promise.resolve({data:null,error:null}).then(yes,no);}
 let rows=(this.table==='messaging_send_events'?[row]:tables[this.table]??[]).filter(r=>this.filters.every(f=>f(r)));if(this.updated)rows.forEach(r=>Object.assign(r,this.updated));const data=this.one?rows[0]??null:rows;return Promise.resolve({data:structuredClone(data),error:null}).then(yes,no);}catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const native=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){assert.equal(req.headers.get('authorization'),'Bearer device-key');const url=new URL(req.url);if(req.method!=='GET'){posts++;throw Error('POST forbidden');}
 if(url.pathname.startsWith('/api/v1/text-operations/v1/')){operationReads++;assert.equal(url.pathname,'/api/v1/text-operations/v1/'+origin);assert.equal(url.searchParams.get('from'),base.response_payload.mac_text_from);assert.deepEqual([...url.searchParams.keys()],['from']);assert.equal(req.body,null);if(mode==='missing')return Response.json({origin,found:false},{status:404});if(mode==='old')return Response.json({message_id:guid,status:'sent',delivered:true});if(mode==='malformed')return Response.json({origin,found:true});return Response.json({origin:mode==='foreign'?'text_'+'d'.repeat(32):origin,found:true,fingerprint:mode==='wrong-fingerprint'?'c'.repeat(64):textOperationFingerprint(base.response_payload.mac_text_from,base.phone,base.request_payload.message.parts[0].value),preparedGuid:guid,state:mode==='acknowledged'?'acknowledged':'attempted'});}
 assert.equal(url.pathname,'/api/v1/message-evidence/'+guid);assert.equal(url.searchParams.get('recipient'),row.phone);evidenceReads++;if(proof==='none')return new Response(null,{status:404});return Response.json({evidence_source:proof==='wrong-source'?'legacy':'chat_db_exact_guid',guid:proof==='wrong-guid'?'650e8400-e29b-41d4-a716-446655440000':guid,recipient:proof==='wrong-peer'?'+15550000099':row.phone,sender:proof==='wrong-sender'?'+15550000099':line.phone_number,service:'imessage',is_sent:true,is_delivered:['delivered','read'].includes(proof),is_read:proof==='read',has_attachments:false,...(['delivered','read'].includes(proof)?{delivered_at:1700000000000}:{}),...(proof==='read'?{read_at:1700000001000}:{})});
}});line.server_url=native.url.origin;
const route=await import(resolve(app,'app/api/v1/messages/[id]/route.ts'));const{NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>route.GET(new NextRequest(req),{params:Promise.resolve({id})})});
const actualFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.ok([cloud.url.origin,native.url.origin].includes(url.origin));return actualFetch(input,init)};
const adapter=createLoopMessageFetch({chert:{baseURL:cloud.url.origin,apiKey:'fixture-key'}});
async function get(status=200,transport=adapter){cases++;const response=await transport(`https://a.loopmessage.com/api/v1/message/status/${id}/`);assert.equal(response.status,status);const body=await response.json();assert.ok(!JSON.stringify(body).includes('private'));return body;}
function reset(){row=structuredClone(base);mode='attempted';proof='none';cas='';line.phone_number=base.response_payload.mac_text_from;}
try{
 let before=posts;const queued=await get();assert.equal(queued.status,'processing');assert.equal(queued.message_id,id);assert.equal(queued.contact,row.phone);assert.equal(queued.text,'synthetic recovery');assert.equal(posts,before);
 for(const state of ['sent','delivered','read']){reset();proof=state;const value=await get();assert.equal(value.status,state==='sent'?'processing':'delivered');assert.deepEqual(Object.keys(value).sort(),['contact','message_id','status','text']);}
 reset();row.response_payload={};row.status='failed';row.error='native private failure';const failed=await get();assert.equal(failed.status,'unknown');
 reset();row.tenant_id='foreign';await get(404);
 reset();const wrong=createLoopMessageFetch({chert:{baseURL:cloud.url.origin,apiKey:'wrong'}});await get(404,wrong);
 reset();row.request_payload={message:{parts:[{type:'text',value:'edited'}]}};const invalid=await get();assert.equal(invalid.status,'processing');
 assert.equal(posts,0);
 console.log(JSON.stringify({passed:true,cases,posts,operationReads,evidenceReads,actualAuth:true,actualGET:true}));
}finally{cloud.stop(true);native.stop(true);globalThis.fetch=actualFetch;}
