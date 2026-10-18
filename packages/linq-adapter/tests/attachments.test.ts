import { expect, test } from 'bun:test';
import Linq from '../src/index';
const id='a'.repeat(48);
const metadata={attachment_id:id,filename:'photo.jpg',content_type:'image/jpeg',size_bytes:42,created_at:'2026-10-17T00:00:00Z',uploaded_at:null};
function fixture(value:unknown=metadata,status=200){let calls=0;const client=new Linq({apiKey:'vendor-secret',chert:{baseURL:'https://chert.test',apiKey:'chert-key',fetch:async(input,init)=>{calls++;const r=new Request(input,init);expect(r.url).toBe(`https://chert.test/api/v1/attachments/${id}`);expect(r.headers.get('authorization')).toBe('Bearer chert-key');return Response.json(value,{status});}}});return{client,calls:()=>calls};}
test('official attachment retrieve maps actual metadata and upload state only',async()=>{for(const uploaded_at of [null,'2026-10-17T00:01:00Z']){const f=fixture({attachment:{...metadata,uploaded_at,blob_url:'private'}});expect(await f.client.attachments.retrieve(id)).toEqual({id,filename:'photo.jpg',content_type:'image/jpeg',size_bytes:42,created_at:metadata.created_at,status:uploaded_at===null?'pending':'complete'});expect(f.calls()).toBe(1);}});
test('malformed metadata rejects whole response',async()=>{for(const bad of [{attachment_id:'foreign'},{created_at:null},{created_at:"2026-02-30T00:00:00Z"},{uploaded_at:'bad'},{uploaded_at:undefined},{filename:null},{size_bytes:-1},{content_type:'invalid/type'}]){const f=fixture({attachment:{...metadata,...bad}});await expect(async()=>await f.client.attachments.retrieve(id)).toThrow();expect(f.calls()).toBe(1);}});
test('unsupported request options reject before dispatch',async()=>{for(const options of [{headers:{x:'bad'}},{body:{}},{query:{x:1}},{maxRetries:1}]){const f=fixture();await expect(async()=>await f.client.attachments.retrieve(id,options as never)).toThrow();expect(f.calls()).toBe(0);}const f=fixture();await expect(async()=>await f.client.get(`/v3/attachments/${id}?x=1`)).toThrow();expect(f.calls()).toBe(0);});
test('API failures are official errors with one attempt and cancellation prevents dispatch',async()=>{const f=fixture({error:{code:1005,message:'not found'}},404);await expect(async()=>await f.client.attachments.retrieve(id)).toThrow();expect(f.calls()).toBe(1);const c=fixture();const abort=new AbortController();abort.abort();await expect(async()=>await c.client.attachments.retrieve(id,{signal:abort.signal})).toThrow();expect(c.calls()).toBe(0);});

test('server errors never retry and low-level retry override rejects without network',async()=>{
 const f=fixture({error:{code:3001,message:'unavailable'}},500);
 await expect(async()=>await f.client.attachments.retrieve(id)).toThrow();expect(f.calls()).toBe(1);
 const blocked=fixture();expect(()=>blocked.client.request({method:'get',path:`/v3/attachments/${id}`},1)).toThrow();expect(blocked.calls()).toBe(0);
});
test('actual database timezone offsets and microseconds remain exact',async()=>{
 for(const timestamp of ['2026-10-17T00:00:00.123456+00:00','2026-10-17T00:00:00.123456+05:30','2026-10-17T00:00:00.654321-07:00']){
 const f=fixture({attachment:{...metadata,created_at:timestamp,uploaded_at:timestamp}});
 expect(await f.client.attachments.retrieve(id)).toMatchObject({created_at:timestamp,status:'complete'});
 }
});
test('invalid calendar, clock and timezone metadata rejects',async()=>{
 for(const timestamp of ['2026-02-30T00:00:00+00:00','2026-13-01T00:00:00Z','2026-10-17T24:00:00+00:00','2026-10-17T00:60:00Z','2026-10-17T00:00:60Z','2026-10-17T00:00:00+24:00','2026-10-17T00:00:00+05:60','2026-10-17T00:00:00+0000','2026-10-17']){
 const f=fixture({attachment:{...metadata,created_at:timestamp}});await expect(async()=>await f.client.attachments.retrieve(id)).toThrow();
 }
});
const createInput={filename:'photo.jpg',content_type:'image/jpeg' as const,size_bytes:42};
const tenant='11111111-1111-4111-8111-111111111111';
function creation(overrides:Record<string,unknown>={}){return {attachment_id:id,upload_url:`https://chert.test/api/v1/attachments/${id}/upload`,download_url:`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&signature=${'b'.repeat(64)}`,expires_at:new Date(Date.now()+14*60_000).toISOString(),http_method:'PUT',required_headers:{authorization:'Bearer <your-signing-secret>','content-type':'image/jpeg'},...overrides};}
function createFixture(value:unknown=creation()){let calls=0;const client=new Linq({apiKey:'vendor-secret',chert:{baseURL:'https://chert.test',apiKey:'chert-key',tenant:'fixture-tenant',fetch:async(input,init)=>{calls++;const request=new Request(input,init);expect(request.url).toBe('https://chert.test/api/v1/attachments');expect(await request.json()).toEqual(createInput);return Response.json(value);}}});return{client,calls:()=>calls};}
test('official create returns real URLs and actual configured upload credentials without uploading',async()=>{const f=createFixture();const response=await f.client.attachments.create(createInput);expect(response.attachment_id).toBe(id);expect(response.required_headers).toEqual({authorization:'Bearer chert-key','content-type':'image/jpeg','x-chert-tenant':'fixture-tenant'});expect(response.http_method).toBe('PUT');expect(f.calls()).toBe(1);});
test('invalid create fields and request overrides refuse before registration',async()=>{for(const bad of [{size_bytes:0},{size_bytes:100*1024*1024+1},{content_type:'image/avif'},{filename:''},{lifetime:'ephemeral'}]){const f=createFixture();await expect(async()=>await f.client.attachments.create({...createInput,...bad} as never)).toThrow();expect(f.calls()).toBe(0);}for(const options of [{headers:{x:'bad'}},{query:{x:1}},{maxRetries:1}]){const f=createFixture();await expect(async()=>await f.client.attachments.create(createInput,options as never)).toThrow();expect(f.calls()).toBe(0);}});
test('unsafe or incomplete create responses never expose upload credentials',async()=>{for(const bad of [{upload_url:'https://foreign.invalid/upload'},{download_url:'https://foreign.invalid/download'},{http_method:'POST'},{expires_at:'2020-01-01T00:00:00Z'},{required_headers:{authorization:'Bearer foreign','content-type':'image/jpeg'}},{attachment_id:'foreign'}]){const f=createFixture(creation(bad));await expect(async()=>await f.client.attachments.create(createInput)).toThrow();expect(f.calls()).toBe(1);}});

test('create never retries errors and cancellation prevents registration',async()=>{
 let calls=0;const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'chert-key',fetch:async()=>{calls++;return Response.json({error:{code:3001,message:'private'}},{status:500});}}});
 await expect(async()=>await client.attachments.create(createInput)).toThrow();expect(calls).toBe(1);
 const abort=new AbortController();abort.abort();await expect(async()=>await client.attachments.create(createInput,{signal:abort.signal})).toThrow();expect(calls).toBe(1);
});
test('retrieve preserves fresh actual download capability and rejects malformed present URLs',async()=>{
 for(const signature of ['b'.repeat(64),'c'.repeat(64)]){
 const download_url=`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&signature=${signature}`;
 const f=fixture({attachment:{...metadata,download_url}});expect((await f.client.attachments.retrieve(id)).download_url).toBe(download_url);
 }
 for(const download_url of [null,'https://foreign.invalid/download',`https://chert.test/api/v1/attachments/foreign/download?tenant=${tenant}&signature=${'b'.repeat(64)}`,`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&signature=bad`]){
 const f=fixture({attachment:{...metadata,download_url}});await expect(async()=>await f.client.attachments.retrieve(id)).toThrow();expect(f.calls()).toBe(1);
 }
});
