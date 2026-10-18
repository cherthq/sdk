import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'subscription-wire',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'11000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',is_active:true,requires_tenant_header:false};
const rows=[];let writes=0,cases=0;
class Query{
 constructor(table){this.table=table;this.filters=[];}
 select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}insert(row){this.newRow=row;return this;}update(patch){this.patch=patch;return this;}
 async single(){return this.maybeSingle();}
 async maybeSingle(){
  if(this.table==='messaging_tenants')return{data:this.filters.every(f=>f(tenant))?tenant:null,error:null};
  assert.equal(this.table,'tenant_webhook_subscriptions');
  if(this.newRow){writes++;const row={id:`subscription-${rows.length}`,created_at:'2026-10-17T00:00:00Z',...this.newRow};rows.push(row);return{data:row,error:null};}
  const row=rows.find(r=>this.filters.every(f=>f(r)));if(row&&this.patch){writes++;Object.assign(row,this.patch);}return{data:row??null,error:null};
 }
}
const db={from:table=>new Query(table)};
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>db}));
const {POST}=await import(resolve(app,'app/api/v1/webhook-subscriptions/route.ts'));
const {PATCH}=await import(resolve(app,'app/api/v1/webhook-subscriptions/[id]/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>r.method==='POST'?POST(new NextRequest(r)):PATCH(new NextRequest(r),{params:Promise.resolve({id:new URL(r.url).pathname.slice(1)})})});
async function request(body,{id,auth=true}={}){cases++;return fetch(new URL(id??'',server.url),{method:id?'PATCH':'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-key'}:{})},body:JSON.stringify(body)});}
const profile='blooio-v4/2026-10-01';
try{
 for(const body of [null,[],17,'string'])assert.equal((await request(body)).status,400);
 assert.equal(writes,0);assert.equal((await request({url:'https://receiver.invalid',version:profile,events:['message_received']},{auth:false})).status,401);
 for(const events of [undefined,[],['*'],['message_received','message_received'],['message_received',3],['message_outbound_observed']])assert.equal((await request({url:'https://receiver.invalid',version:profile,events})).status,400);
 assert.equal((await request({url:'https://receiver.invalid',version:'blooio-v4/unknown',events:['message_received']})).status,400);assert.equal(writes,0);
 const created=await request({url:'https://receiver.invalid',version:profile,events:['message_received']});assert.equal(created.status,201);const body=await created.json();assert.equal(body.subscription.version,profile);assert.equal(writes,1);
 const id=rows[0].id;
 for(const patch of [null,[],{events:[]},{events:['message_received',8]},{version:'blooio-v4/unknown'}])assert.equal((await request(patch,{id})).status,400);
 assert.equal(writes,1);assert.equal((await request({url:'https://other.invalid'},{id})).status,200);assert.equal(rows[0].version,profile);
 assert.equal((await request({version:'legacy',events:[]},{id})).status,200);assert.equal(rows[0].version,'legacy');assert.deepEqual(rows[0].events,[]);
 assert.equal((await request({version:profile},{id})).status,400);assert.equal((await request({version:profile,events:['message_received']},{id})).status,200);
 for(const events of [['message_delivered'],['message_received','message_delivered']]){
  const registered=await request({url:'https://receiver.invalid',version:profile,events});assert.equal(registered.status,201);assert.deepEqual((await registered.json()).subscription.events,events);
 }
 for(const events of [['message_delivered'],['message_delivered','message_received']]){assert.equal((await request({version:profile,events},{id})).status,200);assert.deepEqual(rows[0].events,events);}
 for(const events of [['message_delivered','message_delivered'],['message_delivered','message_edited'],['*','message_delivered']]){const prior=writes;assert.equal((await request({version:profile,events},{id})).status,400);assert.equal(writes,prior);}
 for(const events of [['read_receipt'],['message_received','message_delivered','read_receipt']]){const registered=await request({url:'https://receiver.invalid',version:profile,events});assert.equal(registered.status,201);assert.deepEqual((await registered.json()).subscription.events,events);}
 for(const events of [['read_receipt'],['read_receipt','message_received','message_delivered']]){assert.equal((await request({version:profile,events},{id})).status,200);assert.deepEqual(rows[0].events,events);}
 for(const events of [['read_receipt','read_receipt'],['read_receipt','message_edited']]){const prior=writes;assert.equal((await request({version:profile,events},{id})).status,400);assert.equal(writes,prior);}
 for(const events of [['message_sent'],['message_received','message_delivered','read_receipt','message_sent']]){const registered=await request({url:'https://receiver.invalid',version:profile,events});assert.equal(registered.status,201);assert.deepEqual((await registered.json()).subscription.events,events);}
 for(const events of [['message_sent'],['message_sent','read_receipt','message_received','message_delivered']]){assert.equal((await request({version:profile,events},{id})).status,200);assert.deepEqual(rows[0].events,events);}
 for(const events of [['message_sent','message_sent'],['message_sent','message_edited']]){const prior=writes;assert.equal((await request({version:profile,events},{id})).status,400);assert.equal(writes,prior);}
 for(const events of [['message_failed'],['message_received','message_delivered','read_receipt','message_sent','message_failed']]){const registered=await request({url:'https://receiver.invalid',version:profile,events});assert.equal(registered.status,201);assert.deepEqual((await registered.json()).subscription.events,events);}
 for(const events of [['message_failed'],['message_failed','message_sent','read_receipt','message_received','message_delivered']]){assert.equal((await request({version:profile,events},{id})).status,200);assert.deepEqual(rows[0].events,events);}
 for(const events of [['message_failed','message_failed'],['message_failed','message_edited']]){const prior=writes;assert.equal((await request({version:profile,events},{id})).status,400);assert.equal(writes,prior);}
 for(const events of [['message_queued'],['message_received','message_queued','message_sent','message_delivered','read_receipt','message_failed']]){const registered=await request({url:'https://receiver.invalid',version:profile,events});assert.equal(registered.status,201);assert.deepEqual((await registered.json()).subscription.events,events);}
 for(const events of [['message_queued'],['message_failed','message_sent','read_receipt','message_received','message_delivered','message_queued']]){assert.equal((await request({version:profile,events},{id})).status,200);assert.deepEqual(rows[0].events,events);}
 for(const events of [['message_queued','message_queued'],['message_queued','message_edited']]){const prior=writes;assert.equal((await request({version:profile,events},{id})).status,400);assert.equal(writes,prior);}
 const before=writes;assert.equal((await request({url:'https://receiver.invalid'},{id:'foreign-sub'})).status,404);assert.equal(writes,before);
 assert.equal((await request({url:'https://receiver.invalid',version:'legacy-any',events:[3,'anything']})).status,201);assert.deepEqual(rows.at(-1).events,['anything']);
 console.log(JSON.stringify({passed:true,cases,writes,actualAuth:true,receiverRequests:0}));
}finally{server.stop(true);}
