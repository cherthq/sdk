// Actual tenant bearer/HMAC auth, public handler and device signing over HTTP.
// Only database storage and the synthetic device probe are substituted.
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { plugin } from 'bun';
import { mock } from 'bun:test';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'address-lookup-route',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'tenant-a',tenant_slug:'fixture-tenant',signing_secret:'fixture-tenant-key',crm_project_id:'project-a',is_active:true,requires_tenant_header:false,email:null};
const line={id:'line-a',project_id:'project-a',phone_number:'+15550000001',status:'active',signing_secret:'fixture-native-hmac',api_key:'fixture-native-bearer'};
const tables={messaging_tenants:[tenant],phone_lines:[line,{...line,id:'foreign-line',project_id:'foreign',phone_number:'+15550000009'}]};
let redirectLeaks=0;let lineReads=0,tenantReads=0,deviceCalls=0,mode='normal',nativeStatus=200,dbFailure=false;
class Query{constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}maybeSingle(){if(this.table==='phone_lines')lineReads++;else tenantReads++;if(dbFailure&&this.table==='phone_lines')return Promise.resolve({data:null,error:{message:'fixture-private-db-secret'}});return Promise.resolve({data:tables[this.table].find(row=>this.filters.every(f=>f(row)))??null,error:null});}}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
const {normalizePublicRecipient}=await import(resolve(app,'lib/api-shape/phone-normalize.ts'));
function observation(input){const normalized=normalizePublicRecipient(input);assert.equal(normalized.ok,true);return{input,address:normalized.value,kind:normalized.kind,services:mode==='degraded'?[]:['iMessage'],reachable:mode==='degraded'?'unknown':'yes',service:mode==='degraded'?null:'iMessage',checked_at:'2026-10-17T00:00:00Z',probe:mode==='degraded'?'scriptingbridge_no_probe':'imhandle_multi',cached:false,...(mode==='degraded'?{degraded:true}:{})};}
const device=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 deviceCalls++;const raw=await req.text();const signature=/^v1,(\d+),([a-f0-9]{64})$/.exec(req.headers.get('x-chert-signature')??'');assert.ok(signature);const expected=createHmac('sha256',line.signing_secret).update(`${signature[1]}.${raw}`).digest('hex');assert.ok(timingSafeEqual(Buffer.from(expected),Buffer.from(signature[2])));
 assert.equal(req.headers.get('authorization'),`Bearer ${line.api_key}`);assert.equal(req.headers.get('x-chert-tenant'),null);
 if(req.method==='POST' && mode==='normal' && raw.includes('alice@example.com'))assert.equal(raw,'{ "addresses" : ["+15550000002", "alice@example.com"] }');assert.equal(new URL(req.url).pathname,'/api/v1/addresses/lookup');
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:`http://127.0.0.1:${cloud.port}/redirect-leak`}});
 if(nativeStatus!==200)return Response.json({error:'fixture-private-native-error',upstream_url:'https://private.invalid'},{status:nativeStatus});
 let output;if(req.method==='GET'){assert.equal(raw,'');output=observation(new URL(req.url).searchParams.get('address'));}else{const body=JSON.parse(raw);assert.deepEqual(Object.keys(body),['addresses']);output={results:body.addresses.map(observation)};}
 if(mode==='unknown-probe')output.probe='invented-private-probe';
 if(mode==='wrong-id')output.address='+15550000009';
 if(mode==='malformed')output={error:'fixture-private-malformed'};
 if(mode==='extra-fields')output={...output,api_key:'fixture-private-secret',upstream_url:'https://private.invalid',capability_verified:true};
 if(mode==='wrong-batch')output.results.reverse();
 return Response.json(output);
}});
line.server_url=`http://127.0.0.1:${device.port}`;
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.hostname,'127.0.0.1');return originalFetch(input,init);};
const routes=await import(resolve(app,'app/api/v1/addresses/lookup/route.ts'));const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{if(new URL(req.url).pathname==='/redirect-leak'){redirectLeaks++;return new Response(null,{status:204});}return routes[req.method](new NextRequest(req));}});
let cases=0;
async function call(query,options={}){cases++;const method=options.method??'GET';const raw=options.raw??(method==='POST'?JSON.stringify(options.body):undefined);const headers={...(options.auth===false?{}:{authorization:'Bearer fixture-tenant-key'}),...(raw!==undefined?{'content-type':'application/json'}:{})};if(options.hmac){delete headers.authorization;const ts=Math.floor(Date.now()/1000);headers['x-chert-tenant']=tenant.tenant_slug;headers['x-chert-signature']=`v1,${ts},${createHmac('sha256',tenant.signing_secret).update(`${ts}.${raw??''}`).digest('hex')}`;}const response=await fetch(`http://127.0.0.1:${cloud.port}/api/v1/addresses/lookup?${query}`,{method,headers,body:raw});return{status:response.status,body:await response.json()};}
const base='address=%2B15550000002&from_phone_line_id=line-a';
try{
 let result=await call(base,{auth:false});assert.equal(result.status,401);assert.equal(lineReads,0);assert.equal(tenantReads,0);assert.equal(deviceCalls,0);
 result=await call(base);assert.equal(result.status,200);assert.equal(result.body.address,'+15550000002');assert.equal(result.body.probe,'imhandle_multi');assert.equal(result.body.reachable,'unknown');assert.equal(result.body.capability_verified,false);assert.equal(result.body.capabilities,undefined);
 result=await call('address=alice%40example.com&from_phone=%2B15550000001');assert.equal(result.status,200);assert.equal(result.body.kind,'email');
 result=await call('address=%2B15550000002&phone_line_id=line-a');assert.equal(result.status,200);
 result=await call('from_phone_line_id=line-a',{method:'POST',raw:'{ "addresses" : ["+15550000002", "alice@example.com"] }',hmac:true});assert.equal(result.status,200);assert.equal(result.body.results.length,2);
 result=await call('from_phone_line_id=line-a',{method:'POST',body:{addresses:Array(50).fill('+15550000002')}});assert.equal(result.status,200);assert.equal(result.body.results.length,50);
 result=await call('from_phone_line_id=line-a',{method:'POST',body:{addresses:[]}});assert.equal(result.status,200);assert.deepEqual(result.body.results,[]);
 const before=deviceCalls;const readBefore=lineReads;
 for(const query of ['address=%2B15550000002','address=%2B15550000002&from_phone_line_id=foreign-line','address=%2B15550000002&from_phone_line_id=line-a&from_phone=%2B15550000009',base+'&from_phone_line_id=line-a',base+'&phone_line_id=foreign-line',base+'&unexpected=true','address=not-an-address&from_phone_line_id=line-a']){result=await call(query);assert.ok([400,422].includes(result.status));}
 for(const raw of ['', 'null', '{bad', '{"addresses":[123]}',JSON.stringify({addresses:Array(51).fill('+15550000002')}),JSON.stringify({addresses:['+15550000002'],from_phone:'ignored-selector'})]){result=await call('from_phone_line_id=line-a',{method:'POST',raw});assert.equal(result.status,400);}
 assert.equal(deviceCalls,before);assert.equal(lineReads,readBefore+2,'only explicit cross-project/mismatched-line queries touch line storage');
 mode='degraded';result=await call(base);assert.equal(result.status,200);assert.equal(result.body.reachable,'unknown');assert.deepEqual(result.body.services,[]);mode='normal';
 for(const invalid of ['unknown-probe','wrong-id','malformed']){mode=invalid;result=await call(base);assert.equal(result.status,502);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));}mode='normal';
 mode='wrong-batch';result=await call('from_phone_line_id=line-a',{method:'POST',body:{addresses:['+15550000002','alice@example.com']}});assert.equal(result.status,502);mode='normal';
 mode='extra-fields';result=await call(base);assert.equal(result.status,200);assert.equal(result.body.api_key,undefined);assert.equal(result.body.upstream_url,undefined);assert.equal(result.body.capability_verified,false);mode='normal';
 mode='redirect';result=await call(base);assert.equal(result.status,502);assert.equal(redirectLeaks,0);mode='normal';
 nativeStatus=500;result=await call(base);assert.equal(result.status,502);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));nativeStatus=200;
 dbFailure=true;const prior=deviceCalls;result=await call(base);assert.equal(result.status,500);assert.equal(deviceCalls,prior);assert.ok(!JSON.stringify(result.body).includes('fixture-private'));dbFailure=false;
 line.status='disabled';result=await call(base);assert.equal(result.status,422);line.status='active';
 console.log(JSON.stringify({passed:true,cases,deviceCalls,liveProbes:0,actualAuth:true,redirectLeaks}));
}finally{cloud.stop(true);device.stop(true);globalThis.fetch=originalFetch;}
