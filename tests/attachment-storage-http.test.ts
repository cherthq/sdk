import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('capability storage uses exact authenticated HTTP with redirect/byte/deadline bounds',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./attachment-storage-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'*',no_proxy:'*',NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timer=setTimeout(()=>child.kill(),25000);
 try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({passed:true,cases:25,requests:7,sinkRequests:0,actualStorageHTTP:true,deviceRequests:0,dbWrites:0});}finally{clearTimeout(timer);}
},30000);
