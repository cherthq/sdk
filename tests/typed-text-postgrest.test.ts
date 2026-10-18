import {test,expect} from 'bun:test';
import {resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST,rust=process.env.CHERT_TEST_RUST_TYPED_CLIENT,cpp=process.env.CHERT_TEST_CPP_TYPED_CLIENT;
const configured=!!(pg||rest||rust||cpp);
test.skipIf(!configured)('four typed language clients use actual auth and PostgreSQL before one-attempt native boundaries',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();expect(rust).toBeTruthy();expect(cpp).toBeTruthy();
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--typed-text-clients','--rust-helper',rust!,'--cpp-helper',cpp!],{encoding:'utf8',timeout:65000,maxBuffer:1024*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout.trim())).toEqual({passed:true,cases:20,languages:['javascript','python','rust','cpp'],realPostgREST:true,actualAuth:true,reservationBeforeEffect:true,nativeEffects:12,reservedFingerprintChecks:12,liveMessages:0});
},70000);
test('typed runner refuses partial opt-in and missing executables before PostgreSQL tools',()=>{
 const script=resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh');
 for(const args of [['--typed-text-clients'],['--typed-text-clients','--rust-helper','/chert-missing-rust','--cpp-helper','/chert-missing-cpp']]){
  const result=spawnSync('/bin/bash',[script,'--pg-bin','/chert-missing-pg','--postgrest','/chert-missing-rest',...args],{encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin'}});expect(result.status).toBe(2);expect(result.stdout).toBe('');
 }
});
test.skipIf(!rust&&!cpp)('dedicated typed helper guards reject malformed inputs without HTTP effects or private logs',async()=>{
 expect(rust).toBeTruthy();expect(cpp).toBeTruthy();let requests=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){requests++;return new Response(null,{status:500});}});
 const valid={api_key:'synthetic-only',phone:'+15550000002',text:'CHERT-TYPED-TEXT-guard'};
 try{for(const binary of [rust!,cpp!]){
  const inputs=[{argv:[server.url.origin],body:valid},...['https://example.invalid','http://127.0.0.1:80/path','http://127.0.0.1:80?x=1'].map(url=>({argv:['--typed-text-fixture',url],body:valid})),...[
    {...valid,extra:true},{...valid,idempotency_key:null},{...valid,phone:'+15550000003'},{...valid,text:'wrong marker'},{...valid,text:'CHERT-TYPED-TEXT-'+'x'.repeat(140000)}
  ].map(body=>({argv:['--typed-text-fixture',server.url.origin],body}))];
  for(const input of inputs){const child=Bun.spawn([binary,...input.argv],{stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/bin:/bin'}});child.stdin.write(JSON.stringify(input.body));child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code).not.toBe(0);expect(out).toBe('');expect(err).toBe('');expect(requests).toBe(0);}finally{clearTimeout(timer)}}
 }}finally{await server.stop(true)}
},30000);
