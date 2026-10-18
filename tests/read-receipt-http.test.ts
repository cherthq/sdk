import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('real signed read receipts remain within the receiving line project and preserve retries',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./read-receipt-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toEqual({passed:true,cases:24,mutations:4,callbacks:7,dispatchErrors:6,deviceRequests:0,liveMessages:0});}finally{clearTimeout(timeout);}
},20000);
