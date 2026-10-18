import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { plugin } from 'bun';
const app=resolve(import.meta.dir,'../../imessage-server');
await plugin({name:'mutation-redirect',setup(build){build.onResolve({filter:/^@\//},({path})=>({path:resolve(app,path.slice(2)+'.ts')}));}});
const {forwardToMac,forwardSignedJsonToMac}=await import(resolve(app,'lib/messaging/mac-forward.ts'));
const {sendViaMiniServer}=await import(resolve(app,'lib/sending/mini-server.ts'));
let initialPosts=0,sinkPosts=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){if(new URL(req.url).pathname==='/sink'){sinkPosts++;return Response.json({success:true,ok:true});}assert.equal(req.method,'POST');initialPosts++;return new Response(null,{status:307,headers:{location:'/sink'}});}});
const origin=`http://127.0.0.1:${server.port}`;const line={server_url:origin,api_key:'fixture-key',signing_secret:'fixture-signing'};
try{
 // A network failure after a plain email POST is an unknown outcome, never retryable.
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('fixture dropped response');};
 try{const result=await sendViaMiniServer(origin,'fixture-key','person@example.com','fixture plaintext','stable-email');assert.equal(result.errorEnvelope?.code,4103);assert.equal(result.errorEnvelope?.retryable,false);assert.ok(!JSON.stringify(result).includes(origin));assert.equal(result.fallback_owner,undefined);}finally{globalThis.fetch=original;}
 const simple=await forwardToMac(line,'/api/v1/chats/chat-a/typing',{to:'+15550000002',isTyping:true});assert.equal(simple.ok,false);
 const typed=await forwardSignedJsonToMac(line,'/api/v1/chats/group',{participants:['+15550000002','+15550000003']});assert.equal(typed.ok,false);
 for(const to of ['+15550000002','person@example.com']){const result=await sendViaMiniServer(origin,'fixture-key',to,'fixture plaintext',`stable-${to}`);assert.equal(result.success,false);assert.equal(result.errorEnvelope?.code,4103);assert.equal(result.errorEnvelope?.retryable,false);assert.ok(!JSON.stringify(result).includes(origin));assert.equal(result.fallback_owner,undefined);}
 assert.equal(initialPosts,4);assert.equal(sinkPosts,0);console.log(JSON.stringify({passed:true,initialPosts,sinkPosts,liveMessages:0}));
}finally{server.stop(true);}
