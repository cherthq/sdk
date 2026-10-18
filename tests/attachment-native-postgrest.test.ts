import{mkdtempSync,writeFileSync,symlinkSync,chmodSync,existsSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{join}from'node:path';
import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
// Uses explicit task-owned tools; Storage bytes remain an HTTP fixture.
test.skipIf(!pg||!rest)('actual local PostgreSQL/PostgREST attachment metadata and media reservation through actual routes',()=>{
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:65000,maxBuffer:1024*1024});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toEqual({passed:true,cases:26,realPostgREST:true,moduleMocks:0,restRequests:114,restAuthRequests:8,restWrites:26,storageRequests:3,storedObjects:1,reservationCases:7,nativeEffects:5,deviceRequests:5,liveMessages:0});
},70000);

const storageEntry=process.env.CHERT_TEST_STORAGE_ENTRYPOINT,node=process.env.CHERT_TEST_STORAGE_NODE;
// Explicit verified official runtime only; no dependency download or runtime fallback.
test.skipIf(!pg||!rest||!storageEntry||!node)('actual official Storage private objects through Linq SDK',()=>{
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--storage-entrypoint',storageEntry!,'--node',node!],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 const receipt=JSON.parse(result.stdout.trim().split('\n').at(-1)!);
 expect(receipt).toEqual({passed:true,cases:32,realPostgREST:true,moduleMocks:0,restRequests:115,restAuthRequests:8,restWrites:26,storageRequests:3,actualStorageRequests:10,storageAuthRequests:6,realStorage:true,reservationCases:7,nativeEffects:5,deviceRequests:5,liveMessages:0});
},95000);

// Offline CLI guards: invalid live selections stop before any database/runtime startup.
test('live PNG requires explicit flag, actual Storage arguments and private regular plan',()=>{
 const root=mkdtempSync(join(tmpdir(),'chert-media-cli-')),plan=join(root,'plan.json'),entry=join(root,'entry.js'),link=join(root,'plan-link');
 try{writeFileSync(plan,'{}',{mode:0o644});writeFileSync(entry,'');symlinkSync(plan,link);
  const script=resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),base=['--pg-bin',root,'--postgrest','/usr/bin/true'],storage=['--storage-entrypoint',entry,'--node','/usr/bin/true'];
  for(const args of [[...base,'--live-one-png-operation',plan],[...base,...storage,'--live-one-png-operation',plan],[...base,...storage,'--live-one-png-operation',link],[...base,'--live-one-png',plan],[...base,...storage,'--live-one-png',plan],[...base,...storage,'--live-one-png',link],[...base,...storage,'--wrong-live-flag',plan]]){const result=spawnSync('/bin/bash',[script,...args],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});expect(result.status).toBe(2);expect(existsSync(join(root,'cluster'))).toBe(false);}
  chmodSync(plan,0o600);
  const operation=spawnSync(process.execPath,['--no-install',resolve(import.meta.dir,'attachment-postgrest.fixture.mjs'),'--live-one-png-operation',plan],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'/usr/bin:/bin',CHERT_TEST_POSTGREST_URL:'http://127.0.0.1:1/'}});expect(operation.status).not.toBe(0);expect(operation.stderr).toContain('Live PNG requires explicit actual Storage');
  const result=spawnSync(process.execPath,['--no-install',resolve(import.meta.dir,'attachment-postgrest.fixture.mjs'),'--wrong-live-flag',plan],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});expect(result.status).not.toBe(0);expect(result.stderr).toContain('Explicit live PNG arguments rejected');
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Same credential generator as live startup; no plan, services or network.
test('live database JWT rejects the public fixture signing key offline',()=>{
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--check-live-jwt-isolation'],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
 expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stderr).toBe('');
 expect(JSON.parse(result.stdout.trim())).toEqual({passed:true,freshKey:true,publicKeyRejected:true,networkRequests:0});
});

// Deliberately invalid source plan: actual Storage checks finish, then the
// broker's mandatory plan validation refuses before SSH, journal or native POST.
test.skipIf(!pg||!rest||!storageEntry||!node)('operation Storage signed token reads use the actual canonical blob key before plan admission',()=>{
 const root=mkdtempSync(join(tmpdir(),'chert-media-storage-preflight-')),plan=join(root,'invalid-plan.json');
 try{
  writeFileSync(plan,'{}',{mode:0o600});
  const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--storage-entrypoint',storageEntry!,'--node',node!,'--live-one-png-operation',plan],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toEqual({passed:false,mode:'reviewed-one-png-operation',liveStage:'broker-prepare',uncertain:true,retryable:false,syntheticFaultScenarios:0});
  expect(existsSync(plan+'.attempt.json')).toBe(false);expect(existsSync(plan+'.attempt.json.spent')).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},95000);
