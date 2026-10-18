import {test,expect} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('attachment import authenticates before download and stores only completed owned canonical blobs',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./attachment-import-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});const timer=setTimeout(()=>child.kill(),15000);
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toEqual({passed:true,cases:22,downloads:8,uploads:7,inserts:6,nativeRequests:2,externalHTTPRequests:0,genuineSDK:true});}finally{clearTimeout(timer);child.kill();await child.exited;}
},20000);
