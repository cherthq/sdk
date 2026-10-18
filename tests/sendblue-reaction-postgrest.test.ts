import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('Sendblue HTTP reaction crosses signed ingest protected ledger auth GET inventory and actual reaction reservation',()=>{expect(pg).toBeTruthy();expect(rest).toBeTruthy();const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--sendblue-reaction-contract'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toMatchObject({passed:true,cases:40,nativePosts:13,getRequests:28,inventoryRequests:17,inboundRequests:10,reactionRequests:22,realPostgres:true,realPostgrest:true,actualMigrations:[23,25,26],actualAuth:true,actualInboundHMAC:true,protectedLedger:true,dbMocks:0,liveNativeActions:0});},70000);
test('Sendblue reaction fixture mode refuses missing explicit local tool arguments',()=>{const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--sendblue-reaction-contract'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8'});expect(result.status).not.toBe(0);expect(result.stdout).toBe('');});
test('Sendblue live mode refuses partial or mismatched explicit opt-in before local services',()=>{
 for(const tail of [['--live-one-sendblue-received-like'],['--sendblue-reaction-contract','--live-one-sendblue-received-like','relative.json'],['--linq-reaction-contract','--live-one-sendblue-received-like','/tmp/nonexistent-chert-sendblue-plan.json']]){
  const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin','/missing-owned-pg','--postgrest','/missing-owned-rest',...tail],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stdout).toBe('');
 }
});
