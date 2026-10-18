import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('strict existing-DM text reserves identity before actual native HTTP and never falls back',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./strict-text-existing-chat-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:21,nativePosts:9,writes:17,actualAuth:true,actualHMAC:true,reservationBeforeEffect:true,legacyPosts:0});}finally{clearTimeout(timeout);}
},20000);
