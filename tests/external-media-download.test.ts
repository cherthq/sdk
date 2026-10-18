import {test,expect} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('external-media downloader enforces DNS-pinned HTTPS and bounded unauthenticated streaming',async()=>{
 const child=Bun.spawn([process.execPath,'--no-env-file','--no-install',fileURLToPath(new URL('./external-media-download.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/bin:/bin'}});
 const timer=setTimeout(()=>child.kill(),10000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,err}).toEqual({code:0,err:''});expect(JSON.parse(out)).toMatchObject({passed:true,cases:63,realNetworkRequests:0,pinnedTransport:true,totalDeadlineMs:15000});}finally{clearTimeout(timer)}
},15000);
