import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('both real chat routes reserve strict single media in actual PG before native effects',()=>{
 expect(pg).toBeDefined();expect(rest).toBeDefined();
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--single-media-operations'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);const {nativeEffects,textEffects,...receipt}=JSON.parse(result.stdout.trim().split('\n').at(-1)!);expect(receipt).toEqual({passed:true,cases:39,captionEffects:6,realPostgREST:true,nativeQueries:2,crossTypeEffects:1,legacyCalls:0,realCommitFaults:2,liveMessages:0,moduleMocks:0});expect(nativeEffects+textEffects).toBe(9);expect([5,6]).toContain(nativeEffects);expect([3,4]).toContain(textEffects);
},70000);
