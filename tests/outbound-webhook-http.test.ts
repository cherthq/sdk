import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('actual signed outbound observations stay tenant/line owned without inferred delivery',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./outbound-webhook-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}});
 const timeout=setTimeout(()=>child.kill(),15000);
 try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});expect(JSON.parse(stdout)).toEqual({passed:true,cases:63,mutations:4,callbacks:46,dispatchErrors:13,fallbackChecks:2,deviceRequests:0,liveMessages:0});}finally{clearTimeout(timeout);}
},20000);
