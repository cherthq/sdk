import{test,expect}from'bun:test';
import{spawnSync}from'node:child_process';
import{resolve}from'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('official Linq reactions cross actual authenticated GET/POST and migration25 PostgREST',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--linq-reaction-contract'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
 expect(receipt).toMatchObject({passed:true,cases:21,nativePosts:13,realPostgres:true,realPostgrest:true,actualMigration:25,actualSDK:'@linqapp/sdk@0.78.0',actualAuth:true,actualMessageGET:true,dbMocks:0,liveNativeActions:0});
},70000);
test('Linq reaction mode refuses incomplete explicit local tool arguments',()=>{
 for(const args of [['--linq-reaction-contract'],['--pg-bin','/missing','--postgrest','/missing','--linq-reaction-contract','--live-one-linq-remove-love','/missing-plan'],['--pg-bin','/missing','--postgrest','/missing','--linq-reaction-contract','--live-one-linq-like','/missing-plan'],['--pg-bin','/missing','--postgrest','/missing','--reaction-operations','--live-one-linq-like','/missing-plan']]){
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),...args],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8'});
 expect(result.status).not.toBe(0);expect(result.stdout).toBe('');
 }
});
