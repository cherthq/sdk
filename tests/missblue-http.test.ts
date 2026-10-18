import {expect,test} from 'bun:test';
import {fileURLToPath} from 'node:url';
test('Miss Blue fetch replacement exercises actual authenticated Chert routes with explicit fake DB/native boundaries',async()=>{
 const child=Bun.spawn([process.execPath,'--no-install',fileURLToPath(new URL('./missblue-http.fixture.mjs',import.meta.url))],{stdout:'pipe',stderr:'pipe',env:{...process.env}});
 const timeout=setTimeout(()=>child.kill(),20000);
 try{
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect({code,stderr}).toEqual({code:0,stderr:''});
  expect(JSON.parse(stdout)).toEqual({passed:true,cases:21,nativePosts:5,nativeGets:1,actualAuth:true,actualRoutes:true,actualHMAC:true,fakeDatabase:true,fakeNative:true,deviceEffects:0});
 }finally{clearTimeout(timeout);}
},25000);
