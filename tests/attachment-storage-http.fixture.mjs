// Actual storage HTTP only; synthetic child-process configuration. No DB/device requests.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plugin} from 'bun';
await plugin({name:'capability-storage',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(import.meta.dir,'../../imessage-server',path.slice(2)+'.ts')}));}});
const saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
let mode='exact',requests=0,sinkRequests=0,cancelled=false,sent=0,cases=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:30,fetch(req){
 const url=new URL(req.url);if(url.pathname==='/sink'){sinkRequests++;return new Response('leaked');}
 requests++;assert.equal(req.method,'GET');assert.equal(url.pathname,'/storage/v1/object/authenticated/attachments/messaging-attachments/tenant/id/actual.png');assert.equal(req.headers.get('apikey'),'synthetic-storage-key');assert.equal(req.headers.get('authorization'),'Bearer synthetic-storage-key');
 if(mode==='redirect')return new Response(null,{status:307,headers:{location:'/sink'}});
 if(mode==='status')return new Response('fixture-private-error',{status:500});
 if(mode==='short')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('ab'));controller.close();}}));
 if(mode==='length')return new Response('abc',{headers:{'content-length':'3'}});
 if(mode==='overflow')return new Response(new ReadableStream({async pull(controller){await Bun.sleep(5);sent++;controller.enqueue(new Uint8Array(1024));if(sent>=100)controller.close();},cancel(){cancelled=true;}}));
 if(mode==='stall')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}}));
 return new Response(new Uint8Array([1,2,3,4]),{headers:{'content-length':'4'}});
}});
process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${server.port}`;process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-storage-key';
const {downloadAttachmentForCapability:download}=await import('../../imessage-server/lib/supabase-storage.ts');
const path='messaging-attachments/tenant/id/actual.png';
async function denied(p=path,n=4){cases++;await assert.rejects(()=>download(p,n),error=>error.message==='Attachment storage download unavailable'&&!error.cause);}
try{
 cases++;assert.deepEqual([...await download(path,4)],[1,2,3,4]);
 mode='redirect';await denied();assert.equal(sinkRequests,0);
 mode='status';await denied();mode='short';await denied();mode='length';await denied();
 mode='overflow';await denied();for(let i=0;i<20&&!cancelled;i++)await Bun.sleep(10);assert.ok(cancelled);assert.ok(sent<100,'overflow must stop upstream');
 const before=requests;for(const p of ['', '../x', '/absolute', 'a//b', 'a/./b', 'a/%2e%2e/b', 'https://evil.invalid/x', 'a?b', 'a\\b'])await denied(p);
 for(const n of [0,-1,1.5,Number.MAX_SAFE_INTEGER,200*1024*1024+1])await denied(path,n);assert.equal(requests,before);
 for(const configured of ['https://user:secret@example.test','https://example.test/path','https://example.test?x=1','http://public.invalid']){process.env.NEXT_PUBLIC_SUPABASE_URL=configured;await denied();}assert.equal(requests,before);process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${server.port}`;
 mode='stall';cancelled=false;const started=Date.now();await denied();assert.ok(Date.now()-started>=14000&&Date.now()-started<20000,'15s deadline applies while reading');
 console.log(JSON.stringify({passed:true,cases,requests,sinkRequests,actualStorageHTTP:true,deviceRequests:0,dbWrites:0}));
}finally{server.stop(true);if(saved.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;if(saved.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=saved.key;}
