// Real adapter, HTTP authentication and PostgreSQL; no notification/native calls.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {createClient} from '@supabase/supabase-js';
import {createBlooioV4Fetch} from '../index.ts';
const origin=process.env.CHERT_TEST_JOURNAL_URL;assert.match(origin??'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
const raw=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+300}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const jwt=raw+'.'+createHmac('sha256','chert-disposable-journal-secret-at-least-32-bytes').update(raw).digest('base64url');
const realFetch=globalThis.fetch,allowed=new Set([origin]);let chertRequests=0,writes=0,cases=0,cloud;
const guarded=async(input,init)=>{const req=new Request(input,init),url=new URL(req.url);assert.ok(allowed.has(url.origin),'No native or external callbacks');if(url.origin===origin){url.pathname=url.pathname.replace(/^\/rest\/v1/,'');if(!['GET','HEAD'].includes(req.method))writes++;}return realFetch(url,{method:req.method,headers:req.headers,redirect:'error',...(!['GET','HEAD'].includes(req.method)?{body:await req.arrayBuffer()}:{} )});};
globalThis.fetch=guarded;process.env.NEXT_PUBLIC_SUPABASE_URL=origin;process.env.SUPABASE_SERVICE_ROLE_KEY=jwt;
const db=createClient(origin,jwt,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guarded}}),check=async q=>{const r=await q;assert.equal(r.error,null);return r.data;};
for(let i=0;i<100;i++){if((await realFetch(origin+'/',{headers:{authorization:'Bearer '+jwt}}).catch(()=>null))?.ok)break;await Bun.sleep(20);}
const tenant='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002',project='21000000-0000-4000-8000-000000000001',id='71000000-0000-4000-8000-000000000001',foreign='71000000-0000-4000-8000-000000000002',legacy='71000000-0000-4000-8000-000000000003';
await check(db.from('messaging_tenants').insert([{id:tenant,tenant_slug:'a',signing_secret:'key-a',crm_project_id:project,is_active:true},{id:other,tenant_slug:'b',signing_secret:'key-b',crm_project_id:project,is_active:true}]));
const initial={id,tenant_id:tenant,url:'https://receiver.invalid/hook',events:['message_received','message_delivered'],version:'blooio-v4/2026-10-01',is_active:true,secret:'PRIVATE-SUBSCRIPTION-SECRET'};
await check(db.from('tenant_webhook_subscriptions').insert([initial,{...initial,id:foreign,tenant_id:other},{...initial,id:legacy,version:'2026-04-01'}]));
const app=resolve(import.meta.dir,'../../../../imessage-server');await plugin({name:'webhook-crud-pg',setup(b){b.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));b.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'../../../tests/next-route-platform.mjs')}));}});
const route=await import(resolve(app,'app/api/v1/webhook-subscriptions/[id]/route.ts')),{NextRequest}=await import('../../../tests/next-route-platform.mjs');
cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{chertRequests++;const url=new URL(req.url),id=url.pathname.split('/').at(-1);assert.ok(['GET','PATCH','DELETE'].includes(req.method));return route[req.method](new NextRequest(req),{params:Promise.resolve({id})});}});allowed.add(cloud.url.origin);
const transport=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'key-a',fetch:guarded}});
async function call(path='/'+id,method='GET',body,adapter=transport){cases++;const r=await adapter('https://api.blooio.com/v4/webhooks'+path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await r.json();assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.ok(!JSON.stringify(data).includes('secret'));return{status:r.status,data};}
try{
 cases++;const unauth=await guarded(cloud.url.origin+'/api/v1/webhook-subscriptions/'+id);assert.equal(unauth.status,401);
 const baseline=await check(db.from('tenant_webhook_subscriptions').select('*').eq('id',id).single());const beforeRead=writes;
 const read=await call();assert.equal(read.status,200);assert.deepEqual(read.data,{data:{id,url:initial.url,event_types:['message.received','message.delivered'],status:'active',api_version:'2026-10-01'}});assert.equal(writes,beforeRead);
 const changed=await call('/'+id,'PATCH',{url:'https://receiver.invalid/new',status:'disabled',api_version:'2026-10-01'});assert.equal(changed.status,200);assert.equal(changed.data.data.status,'disabled');
 const stored=await check(db.from('tenant_webhook_subscriptions').select('*').eq('id',id).single());assert.equal(stored.url,'https://receiver.invalid/new');assert.equal(stored.is_active,false);assert.deepEqual(stored.events,baseline.events);assert.equal(stored.version,baseline.version);assert.equal(stored.secret,baseline.secret);assert.equal(stored.created_at,baseline.created_at);
 const beforeForeign=writes;assert.equal((await call('/'+foreign,'PATCH',{status:'disabled'})).status,404);assert.equal((await call('/'+legacy,'DELETE')).status,502);assert.equal(writes,beforeForeign);
 const bad=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'bad-key',fetch:guarded}});assert.equal((await call('/'+id,'GET',undefined,bad)).status,404);assert.equal(writes,beforeForeign);
 const beforeUnsupported=chertRequests;
 for(const [path,method,body,status]of [['','POST',{url:initial.url,event_types:['message.received']},422],['','POST',{url:initial.url},501],['','GET',undefined,501],['/'+id+'/secret/rotate','POST',{},501],['/'+id+'/deliveries/wdel_1/replay','POST',{},501],['/'+id,'PATCH',{url:'https://user:pass@receiver.invalid/hook'},501],['/'+id,'PATCH',{api_version:'2026-09-01'},501]])assert.equal((await call(path,method,body)).status,status);
 assert.equal(chertRequests,beforeUnsupported);assert.equal(writes,beforeForeign);
 const removed=await call('/'+id,'DELETE');assert.equal(removed.status,200);assert.deepEqual(removed.data,{data:{id,deleted:true}});assert.deepEqual(await check(db.from('tenant_webhook_subscriptions').select('*').eq('id',id)),[]);
 assert.equal((await call()).status,404);assert.deepEqual((await check(db.from('tenant_webhook_subscriptions').select('*').eq('id',foreign).single())).events,initial.events);
 console.log(JSON.stringify({passed:true,cases,chertRequests,actualAuth:true,realPostgres:true,dbMocks:0,nativeActions:0,callbacks:0}));
}finally{globalThis.fetch=realFetch;await cloud.stop(true);}
