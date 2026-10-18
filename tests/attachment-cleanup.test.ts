import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const script=readFileSync(new URL('../../scripts/test-attachment-postgrest.sh',import.meta.url),'utf8');
const start=script.indexOf('cleanup() {'),end=script.indexOf('\ntrap cleanup EXIT',start);
if(start<0||end<start)throw Error('Actual fixture cleanup function not found');
const cleanup=script.slice(start,end);

for(const [failure,original,expected] of [['none',0,0],['postgres',0,1],['postgres',7,7],['remove-context',0,1],['remove-context',7,7]] as const){
 test(`fixture cleanup ${failure} failure preserves exit ${original} as ${expected}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'chert-cleanup-test-')),control=join(root,'control'),calls=join(root,'calls');
  mkdirSync(control,{mode:0o700});
  const program=`set -euo pipefail
task_control=$1; failed_resource=$2; calls=$3
storage_id=storage; rest_id=rest; pg_id=postgres; network_id=network
docker_local() {
  printf '%s\\n' "$*" >> "$calls"
  [[ "$*" != *"$failed_resource"* ]]
}
rm() {
  [[ "$failed_resource" != remove-context ]] || return 1
  command rm "$@"
}
${cleanup}
trap cleanup EXIT
exit "$4"`;
  try{
   const child=Bun.spawn(['bash','-c',program,'fixture-cleanup',control,failure,calls,String(original)],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},stdout:'pipe',stderr:'pipe'});
   const [code,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()]);
   expect(code).toBe(expected);
   expect(readFileSync(calls,'utf8').trim().split('\n')).toEqual(['rm -f -v storage','rm -f -v rest','rm -f -v postgres','network rm network']);
   if(failure==='none'){expect(existsSync(control)).toBe(false);expect(stderr).toBe('');}
   else{
    expect(statSync(control).mode&0o777).toBe(0o700);
    expect(readFileSync(join(control,'resources.txt'),'utf8')).toBe('storage=storage\nrest=rest\npostgres=postgres\nnetwork=network\n');
    expect(statSync(join(control,'resources.txt')).mode&0o777).toBe(0o600);
    expect(stderr).toContain('Fixture cleanup incomplete');
   }
  }finally{rmSync(root,{recursive:true,force:true});}
 });
}
