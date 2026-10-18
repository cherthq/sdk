import {test,expect} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('v4 chat/contact retrieval uses actual authenticated chat handler and mapper',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./chat-retrieve-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:36,writes:0,outbound:0,nativeRequests:0,actualAuth:true,actualMapper:true});}finally{clearTimeout(timeout);}
},20000);
