// Actual official SDK, tenant bearer/HMAC auth and public inventory route.
// Only database storage is substituted; no device/network beyond loopback.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { plugin } from 'bun';
import { mock } from 'bun:test';
import Linq from '../packages/linq-adapter/src/index.ts';
import {createBlooioV4Fetch} from '../packages/blooio-v4-adapter/index.ts';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'assigned-number-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-chert-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false,email:null};
const own={id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001',project_id:'project-a',status:'active',api_key:'fixture-private-device-key',signing_secret:'fixture-private-signing',server_url:'https://forbidden.invalid',notes:'fixture-private-note'};
const tables={messaging_tenants:[tenant],phone_lines:[own,{...own,id:'21000000-0000-4000-8000-000000000012',phone_number:'+15550000002',status:'inbound_only'},
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
const baseURL=`http://127.0.0.1:${cloud.port}`;const expected={phone_numbers:[{id:'21000000-0000-4000-8000-000000000011',phone_number:'+15550000001'},{id:'21000000-0000-4000-8000-000000000012',phone_number:'+15550000002'}]};
let cases=0;
async function direct(headers={authorization:'Bearer fixture-chert-key'}){cases++;const response=await fetch(`${baseURL}/api/v1/phone-numbers`,{headers});return{status:response.status,body:await response.json()};}
const sdk=new Linq({apiKey:'unused-vendor-key',chert:{baseURL,apiKey:'fixture-chert-key'}});
try{
 assert.equal((await direct({})).status,401);assert.equal(reads,0);
 cases++;const listed=await sdk.phonenumbers.list().withResponse();assert.equal(listed.response.status,200);assert.deepEqual(listed.data,expected);assert.ok(!JSON.stringify(listed.data).includes('fixture-private'));assert.ok(listed.data.phone_numbers.every(row=>row.capabilities===undefined));
 const ts=Math.floor(Date.now()/1000);const signature=createHmac('sha256',tenant.signing_secret).update(`${ts}.`).digest('hex');const hmac=await direct({'x-chert-tenant':tenant.tenant_slug,'x-chert-signature':`v1,${ts},${signature}`});assert.equal(hmac.status,200);assert.deepEqual(hmac.body.phone_numbers.map(({id,phone_number})=>({id,phone_number})),expected.phone_numbers);assert.ok(!JSON.stringify(hmac.body).includes('fixture-private'));assert.ok(!JSON.stringify(hmac.body).includes('forbidden.invalid'));
 const before= httpRequests;cases++;await assert.rejects(async()=>sdk.phoneNumbers.list(),error=>error.status===501);assert.equal(httpRequests,before,'modern reputation contract stays unsupported before Chert request');
 const priorLineReads=lineReads;tenant.crm_project_id=null;cases++;assert.deepEqual(await sdk.phonenumbers.list(),{phone_numbers:[]});assert.equal(lineReads,priorLineReads);tenant.crm_project_id='project-a';
 for(const patch of [{id:undefined},{id:'../invalid'},{phone_number:'5550000001'}]){const original={id:own.id,phone_number:own.phone_number};Object.assign(own,patch);cases++;await assert.rejects(async()=>sdk.phonenumbers.list(),error=>error.status===500);Object.assign(own,original);}
 for(const patch of [{id:own.id,phone_number:'+15550000003'},{id:'duplicate-number',phone_number:own.phone_number}]){tables.phone_lines.push({...own,...patch});cases++;await assert.rejects(async()=>sdk.phonenumbers.list(),error=>error.status===500);tables.phone_lines.pop();}
 dbFailure=true;const failed=await direct();assert.equal(failed.status,500);assert.ok(!JSON.stringify(failed.body).includes('fixture-private'));dbFailure=false;
 tenant.crm_project_id='unowned-project';cases++;assert.deepEqual(await sdk.phonenumbers.list(),{phone_numbers:[]});tenant.crm_project_id='project-a';
 const v4=createBlooioV4Fetch({chert:{baseURL,apiKey:'fixture-chert-key'}});
 async function channel(reference,fetcher=v4){cases++;const response=await fetcher(`https://api.blooio.com/v4/channels/${encodeURIComponent(reference)}`);const body=await response.json();assert.ok(!JSON.stringify(body).includes('fixture-private'));return{status:response.status,body};}
 for(const reference of [own.phone_number,own.id]){const selected=await channel(reference);assert.equal(selected.status,200);assert.deepEqual(selected.body,{data:{id:own.id,address:own.phone_number}});}
 const inbound=await channel('+15550000002');assert.equal(inbound.status,200);assert.deepEqual(inbound.body,{data:{id:expected.phone_numbers[1].id,address:'+15550000002'}});
 for(const reference of ['+15550000009','+15550000008','+15550000007','21000000-0000-4000-8000-000000000099']){const missing=await channel(reference);assert.equal(missing.status,404);assert.ok(!Object.hasOwn(missing.body,'data'));}
 tenant.requires_tenant_header=true;assert.equal((await channel(own.id)).status,401);
 const strictV4=createBlooioV4Fetch({chert:{baseURL,apiKey:'fixture-chert-key',tenant:tenant.tenant_slug}});assert.equal((await channel(own.id,strictV4)).status,200);tenant.requires_tenant_header=false;
 dbFailure=true;assert.equal((await channel(own.id)).status,500);dbFailure=false;
 const beforeAlias=httpRequests;assert.equal((await channel('unmapped-alias')).status,501);assert.equal(httpRequests,beforeAlias);
 const actualId=own.id;own.id='legacy-non-uuid';assert.equal((await channel(own.phone_number)).status,502);own.id=actualId;
 async function channels(fetcher=v4,suffix=''){cases++;const response=await fetcher('https://api.blooio.com/v4/channels'+suffix);const body=await response.json();assert.ok(!JSON.stringify(body).includes('fixture-private'));assert.ok(!JSON.stringify(body).includes('forbidden.invalid'));return{status:response.status,body};}
 const all=await channels();assert.equal(all.status,200);assert.deepEqual(all.body,{data:expected.phone_numbers.map(line=>({id:line.id,address:line.phone_number})),has_more:false,next_cursor:null});
 const unauthenticated=createBlooioV4Fetch({chert:{baseURL,apiKey:'wrong-key'}});assert.equal((await channels(unauthenticated)).status,404);
 tenant.crm_project_id='project-b';assert.equal((await channels()).status,502,'foreign legacy ID is not invented into a channel UUID');tenant.crm_project_id='empty-project';assert.deepEqual((await channels()).body,{data:[],has_more:false,next_cursor:null});tenant.crm_project_id='project-a';
 const priorId=own.id;own.id='legacy-id';assert.equal((await channels()).status,502);own.id=priorId;
 dbFailure=true;assert.equal((await channels()).status,500);dbFailure=false;
 const initialCount=tables.phone_lines.length;for(let i=0;i<49;i++)tables.phone_lines.push({...own,id:'22000000-0000-4000-8000-'+String(i).padStart(12,'0'),phone_number:'+1666'+String(i).padStart(7,'0')});assert.equal((await channels()).status,502,'over-limit refuses whole inventory rather than truncate or invent cursor');tables.phone_lines.splice(initialCount);
 const beforeUnsupported=httpRequests;assert.equal((await channels(v4,'?limit=50')).status,501);assert.equal(httpRequests,beforeUnsupported);
 assert.equal(writes,0);console.log(JSON.stringify({passed:true,cases,httpRequests,lineReads,writes,deviceRequests:0,actualAuth:true}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
