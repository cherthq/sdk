import {describe,it,expect} from 'bun:test';
import {ChertClient} from '@cherthq/imessage';
import {resolveMediaSource,MediaSourceError} from './media-source';
const origin='https://chert.test',id='a'.repeat(48),tenant='11111111-1111-4111-8111-111111111111';
const url=`${origin}/api/v1/attachments/${id}/download?tenant=${tenant}&signature=${'b'.repeat(64)}`;
const imported={attachment_id:id,uploaded:true,size_bytes:70,filename:'image.png',content_type:'image/png',download_url:url};
const meta={...imported,uploaded_at:'2026-10-19T00:00:00.000Z'};
function setup(responses:unknown[],statuses:number[]=[]){
 const calls:Array<{path:string;method:string;body:unknown}>=[];
 const client=new ChertClient({baseURL:origin,apiKey:'fixture',fetch:async(input,init)=>{
  const r=new Request(input,init);calls.push({path:new URL(r.url).pathname,method:r.method,body:r.body?await r.json():null});
  return Response.json(responses.shift(),{status:statuses.shift()??200});
 }});return{client,calls};
}
describe('strict image source resolver',()=>{
 it('reads owned uploaded image without import or capability fetch',async()=>{
  const {client,calls}=setup([{attachment:meta}]);expect(await resolveMediaSource(client,origin,url)).toEqual({id,url});
  expect(calls).toEqual([{path:`/api/v1/attachments/${id}`,method:'GET',body:null}]);
 });
 it('imports original external URL then validates matching uploaded metadata',async()=>{
  const {client,calls}=setup([imported,{attachment:meta}]);const external='https://cdn.test/image.png?token=fixture';
  expect(await resolveMediaSource(client,origin,external)).toEqual({id,url});
  expect(calls.map(c=>c.method)).toEqual(['POST','GET']);expect(calls[0]!.body).toEqual({url:external});
  expect(calls.map(c=>c.path)).toEqual(['/api/v1/attachments/import',`/api/v1/attachments/${id}`]);
 });
 it('accepts JPEG but rejects unsupported content before metadata/send',async()=>{
  const jpeg={...imported,filename:'image.jpeg',content_type:'image/jpeg'};
  const ok=setup([jpeg,{attachment:{...jpeg,uploaded_at:meta.uploaded_at}}]);await resolveMediaSource(ok.client,origin,'https://cdn.test/image.jpeg');
  for(const patch of [{content_type:'video/mp4'},{size_bytes:104857601},{uploaded:false},{attachment_id:id+'\n'},{extra:true},{download_url:url+'&extra=1'}]){
   const {client,calls}=setup([{...imported,...patch}]);await expect(resolveMediaSource(client,origin,'https://cdn.test/image.png')).rejects.toBeInstanceOf(MediaSourceError);expect(calls).toHaveLength(1);
  }
 });
 it('rejects invalid/foreign capability and invalid URL before any Chert request',async()=>{
  for(const bad of ['http://cdn.test/a.png','https://user:secret@cdn.test/a.png','https://cdn.test/a.png#fragment',url.replace(origin,'https://foreign.test'),url+'&extra=1',url+'\n']){
   const {client,calls}=setup([]);await expect(resolveMediaSource(client,origin,bad)).rejects.toMatchObject({code:'unsupported_feature'});expect(calls).toHaveLength(0);
  }
 });
 it('rejects contradictory metadata and wrong success status without further requests',async()=>{
  for(const patch of [{filename:'different.png'},{uploaded_at:null},{download_url:url.replace('b'.repeat(64),'c'.repeat(64))},{live_photo:false}]){
   const {client,calls}=setup([imported,{attachment:{...meta,...patch}}]);await expect(resolveMediaSource(client,origin,'https://cdn.test/image.png')).rejects.toMatchObject({code:'invalid_response'});expect(calls).toHaveLength(2);
  }
  const {client,calls}=setup([imported],[201]);await expect(resolveMediaSource(client,origin,'https://cdn.test/image.png')).rejects.toMatchObject({code:'invalid_response'});expect(calls).toHaveLength(1);
 });
 it('rejects trailing junk and newline in imported identifiers and capability query values',async()=>{
  for(const suffix of ['x','\n']){
   const badID=setup([{...imported,attachment_id:id+suffix}]);
   await expect(resolveMediaSource(badID.client,origin,'https://cdn.test/image.png')).rejects.toMatchObject({code:'invalid_response'});expect(badID.calls).toHaveLength(1);
   for(const badURL of [url.replace(`tenant=${tenant}`,`tenant=${tenant}${suffix==='\n'?'%0A':suffix}`),url+ (suffix==='\n'?'%0A':suffix)]){
    const result=setup([{...imported,download_url:badURL},{attachment:{...meta,download_url:badURL}}]);
    await expect(resolveMediaSource(result.client,origin,'https://cdn.test/image.png')).rejects.toMatchObject({code:'invalid_response'});expect(result.calls).toHaveLength(1);
   }
  }
 });
 it('does not retry import errors and stops if cancelled after import',async()=>{
  const failed=setup([{error:{code:'4103',message:'Unavailable'}}],[502]);
  await expect(resolveMediaSource(failed.client,origin,'https://cdn.test/image.png')).rejects.toBeDefined();expect(failed.calls).toHaveLength(1);
  const controller=new AbortController();let calls=0;
  const client=new ChertClient({baseURL:origin,apiKey:'fixture',fetch:async()=>{calls++;controller.abort();return Response.json(imported);}});
  await expect(resolveMediaSource(client,origin,'https://cdn.test/image.png',controller.signal)).rejects.toBeDefined();expect(calls).toBe(1);
 });
 it('propagates cancellation without dispatch or retry',async()=>{
  const {client,calls}=setup([]);const controller=new AbortController();controller.abort();await expect(resolveMediaSource(client,origin,url,controller.signal)).rejects.toBeDefined();expect(calls).toHaveLength(0);
 });
});
