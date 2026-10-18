import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('strict text durable idempotency through actual isolated PostgreSQL/PostgREST',()=>{
 expect(pg).toBeDefined();expect(rest).toBeDefined();
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--text-operations'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
 expect(receipt).toMatchObject({passed:true,cases:12,realPostgREST:true,realCommitFaults:2,nativeEffects:7,liveMessages:0,moduleMocks:0});
},70000);
