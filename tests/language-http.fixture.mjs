// Actual language clients, tenant authentication and public inventory route.
// Only database storage is substituted; no device/network beyond loopback.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { plugin } from 'bun';
import { mock } from 'bun:test';
import { ChertClient } from '../packages/imessage/src/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'assigned-number-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-chert-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false,email:null};
const own={id:'line-a',phone_number:'+15550000001',project_id:'project-a',status:'active',api_key:'fixture-private-device-key',signing_secret:'fixture-private-signing',server_url:'https://forbidden.invalid',notes:'fixture-private-note'};
const tables={messaging_tenants:[tenant],phone_lines:[own,{...own,id:'line-inbound',phone_number:'+15550000002',status:'inbound_only'},
 {...own,id:'foreign-line',phone_number:'+15550000009',project_id:'project-b'}, {...own,id:'unassigned-line',phone_number:'+15550000008',project_id:null},
 {...own,id:'inactive-line',phone_number:'+15550000007',status:'disabled'}]};
let reads=0,lineReads=0,writes=0,dbFailure=false;
class Query{
 constructor(table){this.table=table;this.filters=[];this.columns=[];}select(columns){this.columns=columns.split(',').map(x=>x.trim());return this;}
 eq(k,v){this.filters.push(row=>row[k]===v);return this;}in(k,values){this.filters.push(row=>values.includes(row[k]));return this;}
 order(key){this.sort=key;return this;}maybeSingle(){this.one=true;return this;}
 insert(){writes++;throw new Error('no DB writes allowed');}update(){writes++;throw new Error('no DB writes allowed');}delete(){writes++;throw new Error('no DB writes allowed');}
 then(yes,no){try{reads++;if(this.table==='phone_lines'){lineReads++;assert.deepEqual(this.columns,['id','phone_number','status','project_id']);if(dbFailure)return Promise.resolve({data:null,error:{message:'fixture-private-db-secret'}}).then(yes,no);}
 let rows=tables[this.table].filter(row=>this.filters.every(filter=>filter(row)));if(this.sort)rows=rows.toSorted((a,b)=>a[this.sort].localeCompare(b[this.sort]));rows=rows.map(row=>Object.fromEntries(this.columns.filter(key=>key in row).map(key=>[key,row[key]])));
 return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(yes,no);
 }catch(error){return Promise.reject(error).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const originalFetch=globalThis.fetch;let httpRequests=0;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1','inventory never contacts device or vendor');httpRequests++;return originalFetch(input,init);};
const route=await import(resolve(app,'app/api/v1/phone-numbers/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>route.GET(new NextRequest(req))});
const baseURL=`http://127.0.0.1:${cloud.port}`;const expected={phone_numbers:[{id:'line-a',phone_number:'+15550000001'},{id:'line-inbound',phone_number:'+15550000002'}]};
const python = `import json,sys
from chert import ChertClient,ChertAPIError
try:
 data=ChertClient(sys.argv[1],sys.argv[2],tenant='fixture-tenant').request('/phone-numbers')
 print(json.dumps({'ok':True,'data':data}))
except ChertAPIError as error:
 print(json.dumps({'ok':False,'status':error.status,'code':error.code,'display':str(error)}))
`;
async function subprocess(command, key) {
 const child=Bun.spawn([...command,baseURL,key],{stdout:'pipe',stderr:'pipe',env:{...process.env,PYTHONPATH:resolve(import.meta.dir,'../python')}});
 const timeout=setTimeout(()=>child.kill(),10000);
 try {
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  assert.equal(code,0,stderr);assert.equal(stderr,'');assert.ok(!stdout.includes('fixture-private'));assert.ok(!stdout.includes('forbidden.invalid'));
  return JSON.parse(stdout);
 } finally {clearTimeout(timeout);}
}
const clients={
 javascript:async key=>{try{return {ok:true,data:await new ChertClient({baseURL,apiKey:key,tenant:'fixture-tenant'}).request('/phone-numbers')};}catch(error){return {ok:false,status:error.status,code:error.code,display:error.message};}},
 python:key=>subprocess(['python3','-c',python],key),
};
const skipped=[];
for(const [name,variable] of [['cpp','CHERT_TEST_CPP_CLIENT'],['rust','CHERT_TEST_RUST_CLIENT']]) {
 if(process.env[variable])clients[name]=key=>subprocess([process.env[variable]],key);
 else skipped.push(name);
}
let cases=0;
const completed=[];
try {
 const unauthorized=await fetch(`${baseURL}/api/v1/phone-numbers`);assert.equal(unauthorized.status,401);assert.equal(reads,0);cases++;
 for(const [name,client] of Object.entries(clients)) {
  const success=await client('fixture-chert-key');assert.equal(success.ok,true,name);
  assert.deepEqual(success.data.phone_numbers.map(({id,phone_number})=>({id,phone_number})),expected.phone_numbers,name);
  assert.equal(success.data.phone_numbers.length,2);assert.ok(!JSON.stringify(success).includes('fixture-private'));assert.ok(!JSON.stringify(success).includes('forbidden.invalid'));cases++;
  const denied=await client('wrong-key');assert.equal(denied.ok,false,name);assert.equal(denied.status,401,name);assert.equal(typeof denied.code,'string');assert.equal(typeof denied.display,'string');assert.ok(!denied.display.includes('wrong-key'));cases++;
  tenant.crm_project_id='project-b';const other=await client('fixture-chert-key');assert.equal(other.ok,true,name);assert.deepEqual(other.data.phone_numbers.map(({id,phone_number})=>({id,phone_number})),[{id:'foreign-line',phone_number:'+15550000009'}],name);tenant.crm_project_id='project-a';cases++;
  dbFailure=true;const failed=await client('fixture-chert-key');dbFailure=false;assert.equal(failed.ok,false,name);assert.equal(failed.status,500,name);assert.equal(typeof failed.code,'string');assert.equal(typeof failed.display,'string');assert.ok(!JSON.stringify(failed).includes('fixture-private'));assert.ok(!JSON.stringify(failed).includes('forbidden.invalid'));cases++;
  completed.push(name);
 }
 assert.equal(writes,0);
 console.log(JSON.stringify({passed:true,cases,clients:completed,skipped,writes,deviceRequests:0,actualAuth:true}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
