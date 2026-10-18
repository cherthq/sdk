import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('V4 and Linq keys cross actual auth/PG reservation, frozen-media replay and controlled races',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();
 const r=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--blooio-v4-idempotency'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);
 expect(JSON.parse(r.stdout.trim().split('\n').at(-1)!)).toMatchObject({passed:true,cases:42,nativePosts:9,metadataGets:2,downloadFetches:0,actualAuth:true,realPostgres:true,dbMocks:0,liveActions:0});
},70000);
test('V4 idempotency fixture requires explicit disposable runtime tools',()=>{
 const r=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--blooio-v4-idempotency'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8'});expect(r.status).not.toBe(0);expect(r.stdout).toBe('');
});
