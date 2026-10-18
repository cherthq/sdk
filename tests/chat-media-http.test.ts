import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('actual chat attachment-ID route retains ownership and native HMAC boundaries',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./chat-media-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:48,nativePosts:16,nativeQueries:5,writes:34,actualAuth:true,actualOwnership:true,actualHMAC:true});}finally{clearTimeout(timeout);}
},20000);
