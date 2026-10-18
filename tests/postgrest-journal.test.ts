import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
// Explicit opt-in: never discover/start a system database or download tools.
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN;
const rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg||!rest)('actual local PostgreSQL/PostgREST durable webhook journal',()=>{
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!],{
  env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024,
 });
 expect(result.error).toBeUndefined();
 expect(result.status, result.stderr).toBe(0);
 const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
 expect(receipt).toMatchObject({ok:true,cases:13,callbackPosts:3,realPostgres:true,realPostgrest:true,dbMocks:0,liveNativeActions:0});
 expect(receipt.casMisses).toBeGreaterThanOrEqual(1);
},70000);
