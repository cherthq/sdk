import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { cli, cliHarness, SECRETS, until } from '../fixtures/cli-harness.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const application=process.env.CHERT_TALKING_HEAD_ROOT;
const python=process.env.CHERT_TALKING_HEAD_PYTHON;
const tarball=process.env.CHERT_QUALIFICATION_TARBALL;
const enabled=Boolean(application&&python&&tarball);

type AppRecord={state:string;events:Record<string,string>;cancel:boolean};
type Entry={acceptance:string;settled:boolean;cleanup:string;events:{acknowledged:boolean}[];session_expires_at?:number};
async function fixture(syntheticAudio:boolean, readyOwner=false) {
 const directory=mkdtempSync(join(tmpdir(),'talking-head-package-'));
 const appState=join(directory,'owner');mkdirSync(appState,{mode:0o700});
 const h=await cliHarness('byor');
 const env={PATH:`${dirname(process.execPath)}:${process.env.PATH}`,HOME:directory,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(tmpdir(),'chert-cli-empty-global-npmrc'),npm_config_cache:join(tmpdir(),'chert-cli-npm-cache')};
 writeFileSync(join(directory,'package.json'),JSON.stringify({name:'actual-talking-head-bridge-test',private:true,type:'module'}));
 execFileSync('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',tarball!],{cwd:directory,env,stdio:'pipe'});
 copyFileSync(join(application!,'connector/handler.ts'),join(directory,'handler.ts'));
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--strict','--skipLibCheck','--typeRoots',join(root,'node_modules/@types'),'--types','node','handler.ts'],{cwd:directory,env,stdio:'pipe'});
 const executable=join(directory,'node_modules/.bin/chert');const config=join(directory,'config.json');const state=join(directory,'state');
 const dev=JSON.parse(readFileSync(h.devPath,'utf8'));delete dev.livekit_api_origin;const devPath=join(directory,'development.json');writeFileSync(devPath,JSON.stringify(dev));
 const init=cli(executable,['init','--mode','byor','--handler-module',join(directory,'handler.js'),'--config',config,'--state-dir',state,'--development',devPath,'--json','--non-interactive'],{},directory);
 assert.equal(await init.exit,0,init.stderr);
 const appEnv={CHERT_CONNECTOR_TOKEN:SECRETS.CHERT_CONNECTOR_TOKEN,CHERT_RECOVERY_TOKEN:SECRETS.CHERT_RECOVERY_TOKEN,TALKING_HEAD_CALLBACK_SOCKET:join(appState,'owner.sock')};
 let server:ReturnType<typeof spawn>|undefined;let serverExit:Promise<number|null>|undefined;let serverError='';
 async function startOwner() {
  server=spawn(python!,[join(application!,'connector/tests/fixture_server.py'),appState,...(syntheticAudio?['--synthetic-audio-policy']:[]),...(readyOwner?['--ready-owner']:[])],{
   env:{PATH:process.env.PATH,PYTHONPATH:join(application!,'receiver/src')},stdio:['ignore','pipe','pipe']});
  server.stderr!.on('data',d=>{serverError+=d;});server.stdout!.on('data',()=>undefined);
  serverExit=new Promise((resolve,reject)=>{server!.once('error',reject);server!.once('exit',resolve);});
  await until(()=>existsSync(join(appState,'owner.sock'))||server!.exitCode!==null);
  assert.equal(server.exitCode,null,serverError);
 }
 async function stopOwner(){if(server&&server.exitCode===null){server.kill('SIGTERM');await serverExit;}}
 let running:ReturnType<typeof cli>|undefined;
 const provider=()=>JSON.parse(readFileSync(join(appState,'provider.json'),'utf8')) as {creates:number;dispatches:number;deletes:number;reads:number;late:number;rooms:Record<string,unknown>};
 const operations=()=>Object.values(JSON.parse(readFileSync(join(appState,'operations.json'),'utf8')).decisions) as AppRecord[];
 const entries=()=>Object.values(JSON.parse(readFileSync(join(state,'journal.json'),'utf8')).entries) as Entry[];
 return {h,directory,appState,provider,operations,entries,startOwner,stopOwner,
  async stage(slot_id:string){return new Promise<void>((resolve,reject)=>{const socket=connect(join(appState,'admin.sock'));socket.on('connect',()=>socket.write(JSON.stringify({method:'stage',args:{slot_id}})+'\n'));socket.on('error',reject);socket.on('data',data=>{socket.destroy();try{assert.equal(JSON.parse(data.toString()).ok,true);resolve();}catch(error){reject(error);}});});},
  control(value:object){writeFileSync(join(appState,'control.tmp'),JSON.stringify(value));renameSync(join(appState,'control.tmp'),join(appState,'control.json'));},
  async check(){const p=cli(executable,['check','--config',config,'--json'],appEnv,directory);return {code:await p.exit,stdout:p.stdout,stderr:p.stderr};},
  async start(){running=cli(executable,['byor','--config',config,'--json'],appEnv,directory,120000);await running.waitConnected();},
  async stop(){return running?.stop();},
  async close(){await running?.stop();await stopOwner();await h.close();rmSync(directory,{recursive:true,force:true});},
 };
}
function zeroWrapper(h:Awaited<ReturnType<typeof cliHarness>>){assert.deepEqual(h.effects,{created:0,deleted:0,explicitDispatch:0,cancelled:0,management:0,health:0});}

test('installed legacy prototype: audio/video profile explicitly declines; startup and health have zero session effects', {skip:!enabled,timeout:90000},async()=>{
 const f=await fixture(false);
 try{
  await f.startOwner();const health=await f.check();assert.equal(health.code,3);assert.match(health.stdout,/unavailable/);
  await f.start();await pause(100);
  assert.deepEqual(f.provider(),{rooms:{},creates:0,dispatches:0,deletes:0,reads:0,late:0});
  const request=f.h.authority.register(SECRETS.CHERT_CONNECTOR_TOKEN);
  const [a,b]=await Promise.all([f.h.incoming(request),f.h.incoming({...request,message_id:'duplicate'})]);
  assert.equal(a.decision.action,'decline');assert.deepEqual(a.decision,b.decision);
  const receipt=await f.h.authority.commit(SECRETS.CHERT_CONNECTOR_TOKEN,a.decision);f.h.relay.deliver(receipt);
  const terminal=f.h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'ended');f.h.relay.deliver(terminal);
  await until(()=>f.entries().every(e=>e.settled&&e.cleanup==='clean'&&e.events.every(x=>x.acknowledged)));
  assert.equal(f.provider().creates,0);zeroWrapper(f.h);assert.equal(await f.stop(),0);
 }finally{await f.close();}
});

test('installed legacy prototype + Python owner/AvatarAdapter: synthetic audio capability, duplicate, lost acceptance, two-process restart, 62-second call, replay and verified cleanup', {skip:!enabled,timeout:150000},async()=>{
 const f=await fixture(true);
 try{
  await f.startOwner();await f.check();await f.start();assert.equal(f.provider().creates,0);
  f.control({hold:true});const request=f.h.authority.register(SECRETS.CHERT_CONNECTOR_TOKEN);
  const a=f.h.incoming(request),b=f.h.incoming({...request,message_id:'duplicate'});
  await until(()=>f.provider().dispatches===1);assert.equal(f.provider().creates,1);f.control({});
  const [first,second]=await Promise.all([a,b]);assert.equal(first.decision.action,'accept');assert.deepEqual(first.decision,second.decision);
  if(first.decision.action!=='accept')throw new Error('accept required');
  assert.ok(first.decision.session_expires_at!>Date.now()+590000);
  await f.h.authority.commit(SECRETS.CHERT_CONNECTOR_TOKEN,first.decision); // Lose reply.
  assert.equal(await f.stop(),3);
  await f.stopOwner();assert.equal(f.provider().deletes,0);
  await f.startOwner();await f.start();
  await until(()=>f.entries()[0]?.acceptance==='accept');
  assert.equal(f.provider().creates,1);assert.equal(f.provider().dispatches,1);assert.equal(f.provider().deletes,0);
  const started=f.h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'started');f.h.relay.deliver(started);
  await pause(62000); // Real elapsed wall time; no fixture clock jump or token-only claim.
  assert.equal(Object.keys(f.provider().rooms).length,1);assert.equal(f.provider().deletes,0);
  assert.ok(f.entries()[0]!.session_expires_at!>Date.now());
  f.control({block_cleanup:true});const terminal=f.h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'ended');f.h.relay.deliver(terminal);f.h.relay.deliver(terminal);
  await until(()=>f.operations()[0]?.cancel===true&&f.provider().deletes>0);
  assert.equal(f.entries()[0]!.cleanup,'pending');assert.equal(Object.keys(f.operations()[0]!.events).length,2);
  f.control({});await until(()=>f.entries().every(e=>e.settled&&e.cleanup==='clean'&&e.events.every(x=>x.acknowledged)));
  assert.deepEqual(f.provider().rooms,{});assert.equal(f.h.authority.commitCount,1);zeroWrapper(f.h);
  assert.equal(await f.stop(),0);
 }finally{await f.close();}
});

test('installed legacy prototype + Python owner: preparation timeout, cancellation and late completion never accept or repeat preparation', {skip:!enabled,timeout:90000},async()=>{
 const f=await fixture(true);
 try{
  await f.startOwner();await f.start();f.control({hold:true,late_completion:true});
  const request=f.h.authority.register(SECRETS.CHERT_CONNECTOR_TOKEN);
  const response=await f.h.incoming(request);assert.equal(response.decision.action,'decline');
  assert.equal(f.provider().creates,1);assert.equal(f.provider().dispatches,1);
  const receipt=await f.h.authority.commit(SECRETS.CHERT_CONNECTOR_TOKEN,response.decision);f.h.relay.deliver(receipt);
  const terminal=f.h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'ended');f.h.relay.deliver(terminal);
  await until(()=>f.operations()[0]?.cancel===true);assert.notEqual(f.entries()[0]!.cleanup,'clean');
  f.control({});await until(()=>f.entries().every(e=>e.settled&&e.cleanup==='clean'&&e.events.every(x=>x.acknowledged)));
  assert.equal(f.provider().creates,1);assert.equal(f.provider().dispatches,1);assert.ok(f.provider().late>=1);
  assert.deepEqual(f.provider().rooms,{});zeroWrapper(f.h);assert.equal(await f.stop(),0);
 }finally{await f.close();}
});


test('installed package claims actual production-policy ready video session, preserves one room and supports reuse after cleanup', {skip:!enabled,timeout:90000},async()=>{
 const f=await fixture(false,true);
 try{
  await f.startOwner();await f.check();await f.start();
  assert.equal(f.provider().creates,0);
  for(const slot of ['one','two']){
   await f.stage(slot);
   await pause(1200); // periodic CLI health observes the explicitly staged slot
   const request=f.h.authority.register(SECRETS.CHERT_CONNECTOR_TOKEN,undefined,{audio:true,video:true});
   const [a,b]=await Promise.all([f.h.incoming(request),f.h.incoming({...request,message_id:'duplicate-video'})]);
   assert.equal(a.decision.action,'accept');assert.deepEqual(a.decision,b.decision);
   const count=slot==='one'?1:2;assert.equal(f.provider().creates,count);assert.equal(f.provider().dispatches,count);
   const committed=await f.h.authority.commit(SECRETS.CHERT_CONNECTOR_TOKEN,a.decision);f.h.relay.deliver(committed);
   const terminal=f.h.authority.lifecycle(SECRETS.CHERT_CONNECTOR_TOKEN,request,'ended');f.h.relay.deliver(terminal);
   await until(()=>Object.keys(f.provider().rooms).length===0&&f.entries().every(e=>e.settled&&e.cleanup==='clean'&&e.events.every(x=>x.acknowledged)));
  }
  assert.equal(f.h.authority.commitCount,2);zeroWrapper(f.h);assert.equal(await f.stop(),0);
 }finally{await f.close();}
});
