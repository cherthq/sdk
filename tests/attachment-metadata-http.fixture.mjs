// Actual attachment GET/authentication and official SDK; database-only substitution.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import Linq from '../packages/linq-adapter/src/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'attachment-metadata-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-key',is_active:true,requires_tenant_header:false};
const row={attachment_id:'a'.repeat(48),tenant_id:tenant.id,content_type:'image/png',filename:'actual.png',size_bytes:42,created_at:'2026-10-17T01:00:00.000Z',uploaded_at:null,expires_at:'2026-10-18T01:00:00.000Z',blob_url:'https://forbidden.invalid/private-blob',storage_key:'fixture-private-storage-key'};
let writes=0,attachmentReads=0,dbFailure=false,cases=0;
class Query {
 constructor(table){this.table=table;this.filters=[];this.columns='*';}
 select(columns){this.columns=columns;return this;}eq(key,value){this.filters.push([key,value]);return this;}maybeSingle(){return this;}
 insert(){writes++;throw Error('no writes');}update(){writes++;throw Error('no writes');}delete(){writes++;throw Error('no writes');}
 then(yes,no){try{
  assert.ok(['messaging_tenants','messaging_attachments'].includes(this.table));
  if(this.table==='messaging_attachments'){attachmentReads++;assert.ok(this.filters.some(([k,v])=>k==='tenant_id'&&v===tenant.id));if(dbFailure)return Promise.resolve({data:null,error:{message:'fixture-private-db-error'}}).then(yes,no);}
  let data=(this.table==='messaging_tenants'?[tenant]:[row]).find(item=>this.filters.every(([key,value])=>item[key]===value))??null;
  if(data&&this.columns!=='*')data=Object.fromEntries(this.columns.split(',').map(s=>s.trim()).filter(key=>key in data).map(key=>[key,data[key]]));
  return Promise.resolve({data,error:null}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const actualFetch=globalThis.fetch;let requests=0;
globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,baseURL,'only the exact fixture server may receive requests');requests++;return actualFetch(input,init);};
const {GET}=await import(resolve(app,'app/api/v1/attachments/[id]/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const url=new URL(req.url);assert.equal(req.method,'GET');assert.ok(url.pathname.startsWith('/api/v1/attachments/'));return GET(new NextRequest(req),{params:Promise.resolve({id:decodeURIComponent(url.pathname.slice('/api/v1/attachments/'.length))})});}});
const baseURL=`http://127.0.0.1:${server.port}`;
async function direct(id=row.attachment_id,key='fixture-key',headers={}){cases++;const response=await fetch(`${baseURL}/api/v1/attachments/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${key}`,...headers}});return{status:response.status,body:await response.json()};}
function privateAbsent(value){const serialized=JSON.stringify(value);for(const marker of ['forbidden.invalid','fixture-private','blob_url','storage_key','signing_secret'])assert.ok(!serialized.includes(marker));}
try{
 let result=await direct();assert.equal(result.status,200);assert.equal(result.body.attachment.created_at,row.created_at,'GET must expose actual stored creation time');privateAbsent(result);
 if(process.argv.includes('--route-red-only')){console.log(JSON.stringify({passed:true,routeReady:true}));process.exitCode=0;}else{
  const sdk=new Linq({chert:{baseURL,apiKey:'fixture-key',tenant:'fixture-tenant'}});
  async function retrieve(){cases++;return sdk.attachments.retrieve(row.attachment_id);}
  let attachment=await retrieve();assert.deepEqual(attachment,{id:row.attachment_id,content_type:row.content_type,filename:row.filename,size_bytes:row.size_bytes,created_at:row.created_at,status:'pending'});privateAbsent(attachment);
  row.uploaded_at='2026-10-17T02:00:00.000Z';attachment=await retrieve();assert.equal(attachment.status,'complete');privateAbsent(attachment);row.uploaded_at=null;
  row.created_at='2026-10-17T01:00:00.123456+00:00';attachment=await retrieve();assert.equal(attachment.created_at,row.created_at);privateAbsent(attachment);
  const created=row.created_at;delete row.created_at;result=await direct();assert.equal(result.body.attachment.created_at,null);cases++;await assert.rejects(()=>sdk.attachments.retrieve(row.attachment_id),e=>e.status===502);row.created_at=created;
  for(const [field,value] of [['created_at','not-time'],['uploaded_at','not-time'],['size_bytes',-1],['filename',null],['content_type','application/x-unknown']]){const previous=row[field];row[field]=value;cases++;await assert.rejects(()=>sdk.attachments.retrieve(row.attachment_id),e=>e.status===502);row[field]=previous;}
  row.tenant_id='tenant-foreign';result=await direct();assert.equal(result.status,404);cases++;await assert.rejects(()=>sdk.attachments.retrieve(row.attachment_id),e=>e.status===404);row.tenant_id=tenant.id;
  const before=attachmentReads;result=await direct(row.attachment_id,'wrong-key',{'x-chert-tenant':'fixture-tenant'});assert.equal(result.status,401);assert.equal(attachmentReads,before);
  tenant.requires_tenant_header=true;result=await direct();assert.equal(result.status,401);assert.equal(attachmentReads,before);tenant.requires_tenant_header=false;
  dbFailure=true;result=await direct();assert.equal(result.status,500);privateAbsent(result);cases++;await assert.rejects(()=>sdk.attachments.retrieve(row.attachment_id),error=>error.status===500&&!JSON.stringify(error).includes('fixture-private'));dbFailure=false;
  result=await direct('b'.repeat(48));assert.equal(result.status,404);
  const beforeInvalid=requests;cases++;await assert.rejects(()=>sdk.attachments.retrieve('attachment%2Fa'),e=>e.status===501);assert.equal(requests,beforeInvalid);
  cases++;await assert.rejects(()=>sdk.attachments.retrieve(row.attachment_id,{headers:{'x-extra':'unsupported'}}));assert.equal(requests,beforeInvalid);assert.equal(writes,0);
  console.log(JSON.stringify({passed:true,cases,writes,requests,actualAuth:true,deviceRequests:0,storageRequests:0}));
 }
}finally{server.stop(true);}
