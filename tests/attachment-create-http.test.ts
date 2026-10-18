import {test,expect} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('official Linq attachment registration upload and stable download use actual routes',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./attachment-create-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:11,stores:1,writes:3,outbound:0,nativeRequests:0,actualSDK:true,actualAuth:true});}finally{clearTimeout(timeout);}
},20000);
