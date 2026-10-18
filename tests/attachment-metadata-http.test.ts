import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('official Linq attachment metadata traverses actual tenant-authenticated GET',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./attachment-metadata-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timer=setTimeout(()=>child.kill(),15000);
 try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:20,writes:0,requests:18,actualAuth:true,deviceRequests:0,storageRequests:0});}finally{clearTimeout(timer);}
},20000);
