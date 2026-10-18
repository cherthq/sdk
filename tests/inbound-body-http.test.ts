import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';

test('authenticated malformed native events reject before dispatch',async()=>{
  const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./inbound-body-http.fixture.mjs',import.meta.url))],{
    stdout:'pipe',stderr:'pipe',env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../control-plane/node_modules',import.meta.url))},
  });
  const timer=setTimeout(()=>child.kill(),10000);
  try{
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect({code,stderr}).toEqual({code:0,stderr:''});
    expect(JSON.parse(stdout)).toEqual({passed:true,cases:24,authLookups:24,malformedDispatchWrites:0,dedupWrites:2,liveMessages:0});
  }finally{clearTimeout(timer);}
},15000);
