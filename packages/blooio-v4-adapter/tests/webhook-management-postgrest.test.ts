import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('existing qualified webhook management crosses actual authentication and PostgreSQL without callbacks',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();
 const r=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--v4-webhook-management'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(r.error).toBeUndefined();expect(r.status,r.stderr).toBe(0);
 expect(JSON.parse(r.stdout.trim().split('\n').at(-1)!)).toMatchObject({passed:true,cases:15,chertRequests:10,actualAuth:true,realPostgres:true,dbMocks:0,nativeActions:0,callbacks:0});
},70000);
test('qualified webhook management requires explicit disposable tool paths',()=>{
 const r=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../../../scripts/test-webhook-postgrest.sh'),'--v4-webhook-management'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8'});expect(r.status).not.toBe(0);expect(r.stdout).toBe('');
});
