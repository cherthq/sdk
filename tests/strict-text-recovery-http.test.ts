import {test,expect} from 'bun:test'
import {fileURLToPath} from 'node:url'
test('actual authenticated GET reconciles lost strict text ACK using read-only exact origin and GUID',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./strict-text-recovery-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))}})
 const timer=setTimeout(()=>child.kill(),15000)
 try{const[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,stderr}).toEqual({code:0,stderr:''});const receipt=JSON.parse(stdout);expect(receipt).toEqual({passed:true,cases:36,operationReads:26,evidenceReads:20,writes:15,posts:0,actualAuth:true,actualGET:true,legacyClockMissing:true})}finally{clearTimeout(timer)}
},20000)
