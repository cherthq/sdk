import{test,expect}from'bun:test';
import{spawnSync}from'node:child_process';
import{resolve}from'node:path';
import{mkdtempSync,writeFileSync,rmSync}from'node:fs';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST;
test.skipIf(!pg&&!rest)('six strict provider adapters use actual auth and disposable PostgREST before synthetic native effects',()=>{
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();
 const result=spawnSync('/bin/bash',[resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh'),'--pg-bin',pg!,'--postgrest',rest!,'--text-live-contract'],{encoding:'utf8',timeout:65000,maxBuffer:1024*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout.trim())).toMatchObject({passed:true,mode:'offline-contract-only',actualSDK:true,actualAuth:true,realPostgREST:true,reservationBeforeEffect:true,reservedFingerprintChecks:27,sdkStatus:'queued',effects:1,liveMessages:0,positiveProviders:['blooio','linq','sendblue','blooio-v4','loopmessage','missblue'],fidelityProviders:['blooio','linq','sendblue','blooio-v4','loopmessage','missblue'],providerNativeEffects:12,totalOfflineEffects:15,offlineFaultCases:2,offlineFaultEffects:2,permanentRestartRefusals:2,missBlueNegativeCases:6});
},70000);
test('strict live runner rejects missing flag and public plan before starting tools',()=>{
 const dir=mkdtempSync('/tmp/chert-text-cli.');try{const plan=dir+'/plan.json';writeFileSync(plan,'{}',{mode:0o644});const script=resolve(import.meta.dir,'../../scripts/test-attachment-native-postgrest.sh');for(const suffix of [['--live-one-text',plan],['--live-one-text'],['--wrong-live-text',plan],['--live-one-text-provider','loopmessage',plan],['--live-one-text-provider','unknown',plan],['--live-one-text-provider','linq']]){const result=spawnSync('/bin/bash',[script,'--pg-bin',dir,'--postgrest','/usr/bin/true',...suffix],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});expect(result.status).toBe(2);expect(result.stdout).toBe('');}}finally{rmSync(dir,{recursive:true});}
});
