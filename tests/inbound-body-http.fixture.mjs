// Actual HMAC receiver; only signing-line lookup and accepted-event dedup exist.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {mock} from 'bun:test';
import {plugin} from 'bun';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'inbound-body-fixture',setup(build){
  build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));
  build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));
}});
const secret='fixture-body-secret';let lookups=0;const dedup=[];let allowDedup=false;
const database={from(table){
  if(table==='webhook_event_dedup'&&allowDedup)return {async insert(value){dedup.push(value);return {error:null};}};
  assert.equal(table,'phone_lines','malformed events must not reach dispatch storage');
  return {select(){return this;},eq(key,value){assert.equal(key,'webhook_subscription_id');assert.equal(value,'body-fixture');return this;},
    async maybeSingle(){lookups++;return {data:{id:'verified-line',signing_secret:secret},error:null};}};
}};
mock.module(resolve(app,'lib/supabase-server.ts'),()=>({createServerSupabase:()=>database}));
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>database}));
const {POST}=await import(resolve(app,'app/api/imessage/inbound/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const rawFetch=globalThis.fetch;
globalThis.fetch=(...args)=>{assert.equal(new URL(args[0] instanceof Request?args[0].url:String(args[0])).hostname,'127.0.0.1');return rawFetch(...args);};
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  try{return await POST(new NextRequest(request));}catch{return new Response('uncaught',{status:500});}
}});
const bodies=['null','false','42','"text"','[]','[{}]','{}','{"event_id":"x"}','{"type":"read_receipt"}',
  '{"type":4,"event_id":"x"}','{"type":"read_receipt","event_id":4}',
  '{"type":"","event_id":"x"}','{"type":"read_receipt","event_id":""}','{',
  ...[null,[], 'invalid',42].map(message=>JSON.stringify({type:'message_received',event_id:'invalid-nested',message}))];
async function send(body,headerId){
  const ts=Math.floor(Date.now()/1000),mac=createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex');
  return fetch(`http://127.0.0.1:${server.port}/api/imessage/inbound`,{method:'POST',body,
    headers:{'x-webhook-subscription-id':'body-fixture','x-webhook-signature':`t=${ts},v1=${mac}`,
      ...(headerId?{'x-webhook-event-id':headerId}:{})}});
}
try{
  for(const body of bodies){
    const response=await send(body);
    assert.equal(response.status,400,`authenticated malformed body ${body}`);
    assert.ok(['bad json','bad event'].includes(await response.text()));
  }
  for(const event_id of [42,0,false,null]){
    assert.equal((await send(JSON.stringify({type:'extension_fixture',event_id}),'header-invalid')).status,400);
  }
  assert.equal(dedup.length,0);
  allowDedup=true;
  for(const [index,event_id] of [undefined,''].entries()){
    const id=`header-${index}`,response=await send(JSON.stringify({type:'extension_fixture',event_id,phone_line_id:'forged-line'}),id);
    assert.equal(response.status,200);
    assert.equal((await response.json()).event_id,id);
    assert.equal(dedup.at(-1).event_id,id);
  }
  assert.equal(lookups,bodies.length+6);assert.equal(dedup.length,2);
  console.log(JSON.stringify({passed:true,cases:bodies.length+6,authLookups:lookups,malformedDispatchWrites:0,dedupWrites:2,liveMessages:0}));
}finally{server.stop(true);}
