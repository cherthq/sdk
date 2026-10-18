// Official Linq SDK -> real register/PUT/metadata/capability handlers; DB/storage only substituted.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
import {mock} from 'bun:test';
import Linq from '../packages/linq-adapter/src/index.ts';
// Keep loopback authority literal: Next's dev normalization rewrites 127.0.0.1 to localhost.
process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE='1';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'attachment-create-http',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));build.onResolve({filter:/^next\/server$/},()=>({path:resolve(import.meta.dir,'next-route-platform.mjs')}));}});
const tenant={id:'11000000-0000-4000-8000-000000000001',tenant_slug:'fixture',signing_secret:'fixture-key',is_active:true,email:null,requires_tenant_header:false};
const rows=[],blobs=new Map();let writes=0,stores=0,reads=0,cases=0,outbound=0;
class Query{
 constructor(table){this.table=table;this.filters=[];}select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}maybeSingle(){return this;}insert(value){this.inserted=value;return this;}update(value){this.updated=value;return this;}
 then(yes,no){try{if(this.inserted){writes++;rows.push({id:`db-row-${rows.length}`,created_at:'2026-10-17T00:00:00.000Z',uploaded_at:null,...this.inserted});}const object=(this.table==='messaging_tenants'?[tenant]:rows).find(row=>this.filters.every(f=>f(row)));if(this.updated&&object){writes++;Object.assign(object,this.updated);}return Promise.resolve({data:object??null,error:null}).then(yes,no);}catch(e){return Promise.reject(e).then(yes,no);}}
}
mock.module(resolve(app,'lib/core/supabase.ts'),()=>({createServiceClient:()=>({from:table=>new Query(table)})}));
mock.module(resolve(app,'lib/supabase-storage.ts'),()=>({attachmentBlobPath:(tenant,id,name)=>`messaging-attachments/${tenant}/${id}/${name}`,attachmentChunkFolder:()=>'',attachmentChunkPath:()=>'',uploadAttachmentAtPath:async(path,bytes,type)=>{stores++;assert.equal(type,'image/png');blobs.set(path,Buffer.from(bytes));return{path};},downloadAttachmentAtPath:async()=>{throw Error('unbounded capability storage read forbidden');},downloadAttachmentForCapability:async(path,expectedBytes)=>{reads++;assert.equal(expectedBytes,4);assert.ok(blobs.has(path));return blobs.get(path);},fetchAttachmentRangeByPath:()=>{throw Error('unused');},listAttachmentFolder:()=>{throw Error('unused');},removeAttachmentPaths:()=>{throw Error('unused');}}));
const register=await import(resolve(app,'app/api/v1/attachments/route.ts'));
const upload=await import(resolve(app,'app/api/v1/attachments/[id]/upload/route.ts'));
const metadata=await import(resolve(app,'app/api/v1/attachments/[id]/route.ts'));
const download=await import(resolve(app,'app/api/v1/attachments/[id]/download/route.ts'));
const {NextRequest}=await import('./next-route-platform.mjs');
const cloud=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{const path=new URL(req.url).pathname;const id=path.split('/')[4];const context={params:Promise.resolve({id})};const request=new NextRequest(req);if(path==='/api/v1/attachments')return register.POST(request);if(path.endsWith('/upload'))return upload.PUT(request,context);if(path.endsWith('/download'))return download.GET(request,context);return metadata.GET(request,context);}});
const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.hostname!=='127.0.0.1'){outbound++;throw Error('nonloopback forbidden');}return originalFetch(input,init);};
let forgedHost=false;
const sdk=new Linq({chert:{baseURL:cloud.url.origin,apiKey:tenant.signing_secret,fetch:async(input,init)=>{const request=new Request(input,init);if(forgedHost)request.headers.set('x-forwarded-host','untrusted.invalid');return globalThis.fetch(request);}}});
try{
 cases++;const created=await sdk.attachments.create({filename:'fixture.png',content_type:'image/png',size_bytes:4});assert.match(created.attachment_id,/^[a-f0-9]{48}$/);assert.equal(created.http_method,'PUT');assert.equal(new URL(created.upload_url).origin,cloud.url.origin);assert.equal(new URL(created.download_url).origin,cloud.url.origin);assert.equal(created.required_headers.authorization,'Bearer fixture-key');assert.equal(created.required_headers['content-type'],'image/png');assert.ok(Date.parse(created.expires_at)>Date.now()+14*60_000&&Date.parse(created.expires_at)<=Date.now()+16*60_000);
 cases++;const pending=await sdk.attachments.retrieve(created.attachment_id);assert.equal(pending.status,'pending');assert.equal(pending.created_at,'2026-10-17T00:00:00.000Z');
 cases++;const short=await fetch(created.upload_url,{method:created.http_method,headers:created.required_headers,body:new Uint8Array([1,2,3])});assert.equal(short.status,422);assert.equal(stores,0);
 cases++;const put=await fetch(created.upload_url,{method:created.http_method,headers:created.required_headers,body:new Uint8Array([1,2,3,4])});assert.equal(put.status,200);assert.equal((await put.json()).uploaded,true);
 cases++;const bytes=await fetch(created.download_url);assert.equal(bytes.status,200);assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())],[1,2,3,4]);
 cases++;const complete=await sdk.attachments.retrieve(created.attachment_id);assert.equal(complete.status,'complete');assert.equal(complete.id,created.attachment_id);assert.equal(complete.size_bytes,4);assert.equal(complete.filename,'fixture.png');assert.equal(complete.created_at,pending.created_at);assert.equal(complete.download_url,created.download_url);
 rows[0].expires_at='2000-01-01T00:00:00Z';cases++;assert.equal((await fetch(created.download_url)).status,200);cases++;assert.equal((await fetch(created.upload_url,{method:'PUT',headers:created.required_headers,body:new Uint8Array([1,2,3,4])})).status,410);
 tenant.signing_secret='rotated-key';cases++;assert.equal((await fetch(created.download_url)).status,404);const rotatedSDK=new Linq({chert:{baseURL:cloud.url.origin,apiKey:tenant.signing_secret}});const refreshed=await rotatedSDK.attachments.retrieve(created.attachment_id);assert.notEqual(refreshed.download_url,created.download_url);assert.equal((await fetch(refreshed.download_url)).status,200);tenant.signing_secret='fixture-key';
 const row=rows.shift();cases++;assert.equal((await fetch(created.download_url)).status,404);rows.push(row);
 cases++;forgedHost=true;const forged=await sdk.attachments.create({filename:'fixture.png',content_type:'image/png',size_bytes:4});assert.equal(new URL(forged.upload_url).origin,cloud.url.origin);assert.equal(new URL(forged.download_url).origin,cloud.url.origin);assert.equal(stores,1);
 assert.equal(outbound,0);assert.equal(stores,1);assert.equal(writes,3);console.log(JSON.stringify({passed:true,cases,stores,reads,writes,outbound,nativeRequests:0,actualSDK:true,actualAuth:true}));
}finally{cloud.stop(true);globalThis.fetch=originalFetch;}
