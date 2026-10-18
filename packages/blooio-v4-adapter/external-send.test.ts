import {test,expect} from 'bun:test';
import {createBlooioV4Fetch} from './index';
const id='a'.repeat(48),url=`https://chert.test/api/v1/attachments/${id}/download?tenant=11111111-1111-4111-8111-111111111111&signature=${'b'.repeat(64)}`;
const image={attachment_id:id,filename:'image.png',content_type:'image/png',size_bytes:12,download_url:url};
const receipt={message:{id:'c'.repeat(32),chat_id:'chat_owned',status:'queued'},idempotency:{replayed:true}};
function fixture(mode:'fresh'|'replay'|'conflict'|'race'|'dispatch-race'){
 const paths:string[]=[],bodies:any[]=[];let lookups=0;
 const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(i,o)=>{
  const r=new Request(i,o),path=new URL(r.url).pathname;paths.push(path);bodies.push(r.method==='POST'?await r.json():null);
  if(path.endsWith('/lookup')){lookups++;if(mode==='conflict')return Response.json({error:{code:1002,message:'conflict'}},{status:409});return Response.json(mode==='replay'||(mode==='race'&&lookups===2)||(mode==='dispatch-race'&&lookups===3)?{found:true,...receipt}:{found:false});}
  if(path.endsWith('/import'))return Response.json({...image,uploaded:true});
  if(r.method==='GET')return Response.json({attachment:{...image,uploaded_at:'2026-10-19T00:00:00Z'}});
  if(mode==='dispatch-race')return Response.json({error:{code:1002,message:'conflict'}},{status:409});
  return Response.json({...receipt,idempotency:{replayed:false}},{status:202});
 }}});
 const send=()=>transport('https://api.blooio.com/v4/chats/chat_owned/messages',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'external-key'},body:JSON.stringify({attachments:['https://cdn.example/image.png']})});
 return {send,paths,bodies};
}
test('external image imports through Chert after lookup and preserves original provider identity',async()=>{
 const f=fixture('fresh');expect((await f.send()).status).toBe(201);
 expect(f.paths).toEqual(['/api/v1/idempotency/lookup','/api/v1/attachments/import',`/api/v1/attachments/${id}`,'/api/v1/idempotency/lookup','/api/v1/chats/chat_owned/messages']);
 expect(f.bodies[1]).toEqual({url:'https://cdn.example/image.png'});
 expect(f.bodies[4].message.parts).toEqual([{type:'media',attachment_id:id}]);
 expect(f.bodies[4].message.idempotency_request).toEqual(f.bodies[0].request);
});
test('historical replay and changed-body conflict never import or dispatch',async()=>{
 for(const [mode,status] of [['replay',200],['conflict',409]] as const){const f=fixture(mode);expect((await f.send()).status).toBe(status);expect(f.paths).toEqual(['/api/v1/idempotency/lookup']);}
});
test('concurrent import is reconciled against original identity without a second dispatch',async()=>{
 for(const mode of ['race','dispatch-race'] as const){const f=fixture(mode);expect((await f.send()).status).toBe(200);expect(f.paths.filter(p=>p.endsWith('/messages'))).toHaveLength(mode==='race'?0:1);expect(f.paths.filter(p=>p.endsWith('/import'))).toHaveLength(1);expect(f.bodies.filter(b=>b?.request).every(b=>JSON.stringify(b.request)===JSON.stringify(f.bodies[0].request))).toBe(true);}
});
test('abort during conflict reconciliation preserves cancellation without redispatch',async()=>{
 const controller=new AbortController();let lookups=0,imports=0,dispatches=0;
 const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'owned',fetch:async(i,o)=>{
  const r=new Request(i,o),path=new URL(r.url).pathname;
  if(path.endsWith('/lookup')){
   if(++lookups===3){controller.abort();throw new DOMException('Aborted','AbortError');}
   return Response.json({found:false});
  }
  if(path.endsWith('/import')){imports++;return Response.json({...image,uploaded:true});}
  if(r.method==='GET')return Response.json({attachment:{...image,uploaded_at:'2026-10-19T00:00:00Z'}});
  dispatches++;return Response.json({error:{code:1002,message:'conflict'}},{status:409});
 }}});
 await expect(transport('https://api.blooio.com/v4/chats/chat_owned/messages',{method:'POST',signal:controller.signal,
  headers:{'Content-Type':'application/json','Idempotency-Key':'cancel-reconciliation'},body:JSON.stringify({attachments:['https://cdn.example/image.png']})})).rejects.toMatchObject({name:'AbortError'});
 expect({lookups,imports,dispatches}).toEqual({lookups:3,imports:1,dispatches:1});
});
