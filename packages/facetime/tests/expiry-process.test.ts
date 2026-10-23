import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startOnboarding } from '../src/onboard';

test.each(['bun','node'])('%s installed expiry child confirms startup and removes a completed handoff without another CLI command',async runtime=>{
  const directory=await mkdtemp(join(tmpdir(),'chert-expiry-process-'));
  try{
    const built=await Bun.build({entrypoints:[resolve(import.meta.dir,'../src/expiry.ts'),resolve(import.meta.dir,'../src/expiry-cli.ts')],outdir:directory,target:'node',format:'esm'});
    expect(built.success).toBe(true);
    const reply={sessionId:'expiry_process_123',pollCapability:'private-capability-'.repeat(3),expiresAt:Date.now()+1200,state:'ready'};
    const started=await startOnboarding({baseUrl:'http://127.0.0.1',phone:'+14155550123',consent:true,agent:'Codex',target:'project'},{temporaryRoot:directory,fetch:(async()=>Response.json({data:reply}))as unknown as typeof fetch});
    const file=String(started.helperFile),state=JSON.parse(await readFile(file,'utf8'));
    await writeFile(file,JSON.stringify({...state,state:'complete',capability:''}),{mode:0o600});
    for(const name of ['completion.json','continuation.md'])await writeFile(join(file,'..',name),'private handoff',{mode:0o600});
    const script=`import {scheduleHelperExpiry} from ${JSON.stringify(pathToFileURL(join(directory,'expiry.js')).href)};await scheduleHelperExpiry(${JSON.stringify(file)});`;
    const parent=Bun.spawn([runtime,'--input-type=module','-e',script],{stdout:'pipe',stderr:'pipe'});
    expect(await parent.exited).toBe(0);
    const deadline=Date.now()+5000;
    for(;;){try{await access(file);}catch{break;}if(Date.now()>=deadline)throw Error('Expiry child did not remove fixture');await Bun.sleep(25);}
    for(const name of ['state.json','completion.json','continuation.md'])await expect(access(join(file,'..',name))).rejects.toThrow();
  }finally{await rm(directory,{recursive:true,force:true});}
},10000);
