import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, cliHarness, SECRETS, until } from '../fixtures/cli-harness.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('installed BYOR tarball serves a clean application without a receiver, coalesces requests and recovers without any wrapper LiveKit operations', {timeout:90000}, async()=>{
 const consumer=mkdtempSync(join(tmpdir(),'byor-consumer-'));const h=await cliHarness('byor');
 const env={PATH:`${dirname(process.execPath)}:${process.env.PATH}`,HOME:consumer,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(tmpdir(),'chert-cli-empty-global-npmrc'),npm_config_cache:join(tmpdir(),'chert-cli-npm-cache')};
 const npm=(args:string[])=>execFileSync('npm',args,{cwd:consumer,env,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
 let running: ReturnType<typeof cli>|undefined;
 try {
  const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',consumer],{cwd:root,env,encoding:'utf8'}));
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'no-receiver-application',version:'1.0.0',private:true,type:'module'}));
  npm(['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',join(consumer,packed[0].filename)]);
  const executable=join(consumer,'node_modules/.bin/chert');const config=join(consumer,'config.json');const state=join(consumer,'state');
  const dev=JSON.parse(readFileSync(h.devPath,'utf8'));delete dev.livekit_api_origin;const devFile=join(consumer,'development.json');writeFileSync(devFile,JSON.stringify(dev));
  const initialized=cli(executable,['init','--config',config,'--state-dir',state,'--development',devFile,'--json','--non-interactive'],{},consumer);assert.equal(await initialized.exit,0,initialized.stderr);
  const tsc=join(root,'node_modules/typescript/bin/tsc');
  const compile=(sources:string[])=>execFileSync(process.execPath,[tsc,'--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--strict','--skipLibCheck','--typeRoots',join(root,'node_modules/@types'),'--types','node',...sources],{cwd:consumer,env,encoding:'utf8'});
  compile(['chert-handler.ts']); // Generated callback compiles against the installed package's types.
  const runtimeEnv={CHERT_CONNECTOR_TOKEN:SECRETS.CHERT_CONNECTOR_TOKEN,CHERT_RECOVERY_TOKEN:SECRETS.CHERT_RECOVERY_TOKEN};
  const check=cli(executable,['check','--config',config,'--json'],runtimeEnv,consumer);assert.equal(await check.exit,3,check.stderr);assert.equal(JSON.parse(check.stdout).health.code,'unknown');
  for (const file of ['handler.ts','sessions.ts']) copyFileSync(join(consumer,'node_modules/@trychert/facetime/examples/byor',file),join(consumer,file));
  const gate=join(consumer,'gate'), count=join(consumer,'preparations');writeFileSync(gate,'held');
  writeFileSync(join(consumer,'chert-handler.ts'),`import app from './handler.js';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import type { ByorHandler } from '@trychert/facetime/byor';
const handler: ByorHandler = {...app, async prepare(call, context) {
 appendFileSync(process.env.PREPARATIONS!, 'prepare\\n');
 while (existsSync(process.env.GATE!)) { if(context.signal.aborted) return {action:'decline'}; await pause(10); }
 return app.prepare(call, context);
}};
export default handler;
`);
  compile(['chert-handler.ts','handler.ts','sessions.ts']);
  const sessionFile=join(consumer,'application-session.json');
  const claims={sub:'customer-bridge',nbf:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,video:{room:'application-owned-room',roomJoin:true,canPublish:true,canSubscribe:true}};
  writeFileSync(sessionFile,JSON.stringify({session_ref:'application-session',state:'claimed',session_expires_at:Date.now()+600000,livekit_url:'wss://customer.invalid',participant_token:`e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic-signature`,remote_participant_identity:'application-agent'}),{mode:0o600});
  const applicationEnv={...runtimeEnv,BYOR_APPLICATION_SESSION_FILE:sessionFile,GATE:gate,PREPARATIONS:count};
  running=cli(executable,['byor','--config',config,'--json'],applicationEnv,consumer);await running.waitConnected();
  assert.equal(existsSync(count),false);assert.equal(h.effects.management,0);assert.equal(h.effects.health,0);
  assert.ok(running.stdout.includes('agent_unavailable'));
  writeFileSync(sessionFile,JSON.stringify({...JSON.parse(readFileSync(sessionFile,'utf8')),state:'ready'}));
  await until(()=>running!.stdout.includes('"health":"available"'));

  const request=h.authority.register(SECRETS.CHERT_CONNECTOR_TOKEN);
  const a=h.incoming(request), b=h.incoming({...request,message_id:'duplicate'});
  await until(()=>existsSync(count));unlinkSync(gate);
  const [first,second]=await Promise.all([a,b]);assert.equal(first.decision.action,'accept');assert.deepEqual(first.decision,second.decision);assert.equal(readFileSync(count,'utf8'),'prepare\n');
  const receipt=await h.authority.commit(SECRETS.CHERT_CONNECTOR_TOKEN,first.decision); // Deliberately lose the acceptance response.
  assert.ok(receipt.resource_expires_at>request.created_at+60000);
  assert.equal(await running.stop(),3);
  running=cli(executable,['byor','--config',config,'--json'],applicationEnv,consumer);await running.waitConnected();
  const snapshot=()=>JSON.parse(readFileSync(join(state,'journal.json'),'utf8'));
  await until(()=>Object.values(snapshot().entries).some((e:unknown)=>(e as {acceptance:string}).acceptance==='accept'));
  assert.equal(readFileSync(count,'utf8'),'prepare\n');
  const terminal=h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'ended');h.relay.deliver(terminal);h.relay.deliver(terminal);
  await until(()=>JSON.parse(readFileSync(sessionFile,'utf8')).cancel_requested===true);
  assert.ok(Object.values(snapshot().entries).some((e:unknown)=>(e as {cleanup:string}).cleanup==='pending'));
  const app=JSON.parse(readFileSync(sessionFile,'utf8'));assert.equal(app.events.length,1);writeFileSync(sessionFile,JSON.stringify({...app,state:'cleaned'}));
  await until(()=>Object.values(snapshot().entries).every((e:unknown)=>{const x=e as {settled:boolean;cleanup:string};return x.settled&&x.cleanup==='clean';}));
  assert.equal(await running.stop(),0);assert.equal(h.authority.commitCount,1);
  assert.equal(h.effects.management,0);assert.equal(h.effects.created,0);assert.equal(h.effects.deleted,0);assert.equal(h.effects.explicitDispatch,0);assert.equal(h.effects.cancelled,0);
  assert.ok(!readFileSync(join(state,'journal.json'),'utf8').includes('synthetic-signature'));
  const mismatch=cli(executable,['create-room','--config',config,'--json'],applicationEnv,consumer);assert.equal(await mismatch.exit,2);assert.equal(JSON.parse(mismatch.stderr).code,'mode_mismatch');
 } finally {await running?.stop();await h.close();rmSync(consumer,{recursive:true,force:true});}
});
