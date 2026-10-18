import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';

test('signed ledger-first reads preserve frozen routing, ownership and constituent scope',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./ledger-read-receipt-http.fixture.mjs',import.meta.url))],{
  stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))},
 });
 const timer=setTimeout(()=>child.kill(),15000);
 try{
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect({code,stderr}).toEqual({code:0,stderr:''});
  expect(JSON.parse(stdout)).toEqual({passed:true,cases:27,mutations:4,callbacks:9,dispatchErrors:12,deviceRequests:0,liveMessages:0});
 }finally{clearTimeout(timer);}
},20000);
