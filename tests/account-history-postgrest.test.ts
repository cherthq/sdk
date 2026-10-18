import {test,expect} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST
test.skipIf(!pg&&!rest)('account-wide recorded history uses actual tenant auth and PostgreSQL before pagination',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy()
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--account-history'],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024})
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0)
 expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toMatchObject({passed:true,cases:40,actualAuth:true,actualGET:true,realPostgres:true,realPostgrest:true,dbMocks:0,nativeActions:0,actualOfficialSDK:true})
},70000)
test('account history mode requires explicit disposable tool paths',()=>{
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-webhook-postgrest.sh'),'--account-history'],{encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin'}})
 expect(result.status).not.toBe(0);expect(result.stdout).toBe('')
})
