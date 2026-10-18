// Official V4 contract -> real chat GET/auth/mapper; only database substituted.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'chat-retrieve-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture',signing_secret:'fixture-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false,email:null};
const lead={id:'chat-a',messaging_tenant_id:tenant.id,number:'+15550000001',name:'Fixture Person',details:{sent_to_number:'+15550000002'},created_at:'2026-10-17T00:00:00Z'};
let failure=false,reads=0,requests=0,writes=0,cases=0,outbound=0;
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}maybeSingle(){return this;}insert(){writes++;throw Error('writes forbidden');}update(){writes++;throw Error('writes forbidden');}then(yes,no){reads++;const object=this.table==='messaging_tenants'?tenant:lead;return Promise.resolve({data:this.filters.every(f=>f(object))?object:null,error:failure&&this.table==='leads'?{message:'private-db-secret'}:null}).then(yes,no);}}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const route=await import(resolve(app,'app/api/v1/chats/[id]/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{requests++;return route.GET(new NextRequest(req),{params:Promise.resolve({id:decodeURIComponent(new URL(req.url).pathname.split('/').at(-1))})});}});
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==cloud.url.origin){outbound++;throw Error('nonloopback forbidden');}return originalFetch(input,init);};
const transport=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'fixture-key'}});
let resource='chats';
async function get({id=lead.id,fetcher=transport,init={},suffix=''}={}){cases++;const response=await fetcher(`https://api.blooio.com/v4/${resource}/${encodeURIComponent(id)}${suffix}`,init);const body=await response.json();assert.ok(!JSON.stringify(body).includes('private-db-secret'));return{status:response.status,body};}
try{
 for(resource of ['chats','contacts']){
 lead.details.sent_to_number='+15550000002';
 const expected=identifier=>resource==='contacts'?{data:{id:lead.id,name:lead.name}}:({data:{id:lead.id,contact:{contact_id:lead.id,identifier,name:lead.name},group:null}});
 const override=await get();assert.equal(override.status,200);assert.deepEqual(override.body,expected('+15550000002'));
 delete lead.details.sent_to_number;assert.deepEqual((await get()).body,expected('+15550000001'));
 lead.name=null;assert.deepEqual((await get()).body,expected('+15550000001'));lead.name='Fixture Person';
 const wrong=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'wrong-key'}});assert.equal((await get({fetcher:wrong})).status,404);
 const wrongScoped=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'wrong-key',tenant:'fixture'}});assert.equal((await get({fetcher:wrongScoped})).status,401);
 tenant.requires_tenant_header=true;assert.equal((await get()).status,401);
 const strict=createBlooioV4Fetch({chert:{baseURL:cloud.url.origin,apiKey:'fixture-key',tenant:'fixture'}});assert.equal((await get({fetcher:strict})).status,200);tenant.requires_tenant_header=false;
 lead.messaging_tenant_id='foreign';assert.equal((await get()).status,404);lead.messaging_tenant_id=tenant.id;
 assert.equal((await get({id:'missing-chat'})).status,404);
 failure=true;assert.equal((await get()).status,500);failure=false;
 lead.details.is_group=true;assert.equal((await get()).status,501);delete lead.details.is_group;
 lead.details.sent_to_number='bad-recipient';assert.equal((await get()).status,502);delete lead.details.sent_to_number;
 const before=requests;
 for(const options of [{suffix:'?unknown=1'},{suffix:'#fragment'},{init:{headers:{'x-custom':'unsupported'}}},{init:{method:'POST',body:'{}'}},{id:'bad/segment'}])assert.equal((await get(options)).status,501);
 assert.equal(requests,before);
 cases++;const controller=new AbortController();controller.abort();await assert.rejects(async()=>transport(`https://api.blooio.com/v4/${resource}/chat-a`,{signal:controller.signal}));assert.equal(requests,before);
 }
 assert.equal(writes,0);assert.equal(outbound,0);console.log(JSON.stringify({passed:true,cases,requests,reads,writes,outbound,nativeRequests:0,actualAuth:true,actualMapper:true}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
