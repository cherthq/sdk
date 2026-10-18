import {expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {preparePlan,createOneAttemptBroker,CALLER_SOURCE,PNG} from '../scripts/m4d-live-media-acceptance.mjs';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
function setup(){const dir=mkdtempSync(join(tmpdir(),'chert-media-guard-')),prior=join(dir,'prior.json'),bindings=join(dir,'bindings.json'),journal=join(dir,'journal.json');writeFileSync(prior,JSON.stringify({attempted:true,passed:true,environment:'reviewed-live',outcome:'exact-guid-recipient-imessage-confirmed',native:{guid:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'},recipient:{guid:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'}}),{mode:0o600});writeFileSync(bindings,JSON.stringify({account_login_sha256:'c'.repeat(64),approved_chat_guid_sha256:'d'.repeat(64),helper_sha256:'a'.repeat(64),service_sha256:'b'.repeat(64),sender_sha256:hash('+15550000001'),recipient_sha256:hash('+15550000002'),messages_pid:123}),{mode:0o600});const plan=preparePlan(prior,bindings,'10000000-0000-4000-8000-000000000001');writeFileSync(journal,JSON.stringify(plan),{mode:0o600});return{dir,prior,bindings,journal,plan,body:{phone:'+15550000002',lead_id:'41000000-0000-4000-8000-000000000001',attachments:[{id:'a'.repeat(48)}],idempotency_key:'chert-media:'+'b'.repeat(32)}};}
test('media attempt is durably spent before executor and cannot repeat after uncertainty',async()=>{const s=setup();let calls=0;const broker=createOneAttemptBroker(s.plan,s.journal,async()=>{calls++;expect(JSON.parse(readFileSync(s.journal,'utf8')).attempted).toBe(true);throw Error('synthetic uncertainty');});try{await expect(broker.attempt(s.body,PNG)).rejects.toThrow();await expect(broker.attempt(s.body,PNG)).rejects.toThrow();expect(calls).toBe(1);expect(JSON.parse(readFileSync(s.journal,'utf8')).passed).toBe(false);}finally{broker.close();rmSync(s.dir,{recursive:true});}});
test('foreign body, bytes and receipt permissions cause zero executor actions',async()=>{const s=setup();let calls=0;const broker=createOneAttemptBroker(s.plan,s.journal,async()=>{calls++;});try{for(const body of [{...s.body,phone:'+15550000003'},{...s.body,attachments:[]},{...s.body,body:'caption'},{...s.body,idempotency_key:'wrong'}])await expect(broker.attempt(body,PNG)).rejects.toThrow();await expect(broker.attempt(s.body,new Uint8Array([1]))).rejects.toThrow();expect(calls).toBe(0);expect(JSON.parse(readFileSync(s.journal,'utf8')).attempted).toBe(false);chmodSync(s.prior,0o644);expect(()=>preparePlan(s.prior,s.bindings)).toThrow();}finally{broker.close();rmSync(s.dir,{recursive:true});}});
test('prepared caller binds actual client APIs without bootstrap or receipt-only success',()=>{expect(CALLER_SOURCE).toContain('BridgeAttachmentDispatch(');expect(CALLER_SOURCE).toContain('client.readyNow');expect(CALLER_SOURCE).toContain('invokeAction:@"send-attachment"');for(const forbidden of ['ensureReady','DYLD_INSERT_LIBRARIES','kill(','NSTask','system('])expect(CALLER_SOURCE).not.toContain(forbidden);expect(CALLER_SOURCE).toContain('expectedAccountLogin');expect(CALLER_SOURCE).toContain('list-chats');});

test('PNG chunks have valid CRCs and actual decompressed RGBA pixels',async()=>{
 const {inflateSync}=await import('node:zlib');expect(PNG.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 const crc=(bytes:Buffer)=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
 let position=8;const compressed:Buffer[]=[];let ended=false;
 while(position<PNG.length){const length=PNG.readUInt32BE(position),type=PNG.subarray(position+4,position+8).toString();expect(position+12+length).toBeLessThanOrEqual(PNG.length);const bytes=PNG.subarray(position+4,position+8+length);expect(crc(bytes)).toBe(PNG.readUInt32BE(position+8+length));if(type==='IHDR'){expect(PNG.readUInt32BE(position+8)).toBe(1);expect(PNG.readUInt32BE(position+12)).toBe(1);}if(type==='IDAT')compressed.push(PNG.subarray(position+8,position+8+length));if(type==='IEND')ended=true;position+=12+length;}
 expect(ended).toBe(true);expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0,255,153,51,255]);expect(createHash('sha256').update(PNG).digest('hex')).toBe('d9fcb70c377590fa3f85f04706960280d12f6158734dc8832a41ca641ffd49c0');
});

test('two independent processes cannot execute the same journal attempt',async()=>{
 const s=setup();const modulePath=new URL('../scripts/m4d-live-media-acceptance.mjs',import.meta.url).href;
 const code=`import{readFileSync,writeFileSync,existsSync,appendFileSync}from'node:fs';import{createOneAttemptBroker,PNG}from${JSON.stringify(modulePath)};const[p,j,b,ready,other,marker]=process.argv.slice(1);const broker=createOneAttemptBroker(JSON.parse(readFileSync(p,'utf8')),j,async()=>{appendFileSync(marker,'one\\n');});writeFileSync(ready,'ready');for(let n=0;!existsSync(other)&&n<200;n++)await Bun.sleep(10);try{await broker.attempt(JSON.parse(b),PNG);}catch{}finally{broker.close();}`;
 const plan=join(s.dir,'plan.json'),marker=join(s.dir,'effects');writeFileSync(plan,JSON.stringify(s.plan),{mode:0o600});
 try{const children=[0,1].map(i=>Bun.spawn([process.execPath,'--no-env-file','-e',code,plan,s.journal,JSON.stringify(s.body),join(s.dir,`ready${i}`),join(s.dir,`ready${1-i}`),marker],{stdout:'pipe',stderr:'pipe'}));const result=await Promise.all(children.map(async child=>({code:await child.exited,stderr:await new Response(child.stderr).text()})));expect(result).toEqual([{code:0,stderr:''},{code:0,stderr:''}]);expect(readFileSync(marker,'utf8')).toBe('one\n');}finally{rmSync(s.dir,{recursive:true});}
},10000);

test('loaded plan traversal, duplicate manifests and bad PNG refuse before any SSH executable',async()=>{
 const s=setup();const {mkdirSync,existsSync}=await import('node:fs');const bin=join(s.dir,'bin'),marker=join(s.dir,'ssh-called'),planFile=join(s.dir,'bad-plan.json');mkdirSync(bin,{mode:0o700});writeFileSync(join(bin,'ssh'),`#!/bin/sh\nprintf called > '${marker}'\nexit 1\n`,{mode:0o700});
 const modulePath=new URL('../scripts/m4d-live-media-acceptance.mjs',import.meta.url).href;
 const code=`import{startReviewedLiveBroker}from${JSON.stringify(modulePath)};try{await startReviewedLiveBroker(process.argv[1],process.argv[2],'--live-one-png',async()=>{});process.exit(2);}catch{process.stdout.write('refused');}`;
 try{for(const patch of [{sources:[{path:'../../private',sha256:'a'.repeat(64)}]},{reviewed_files:s.plan.reviewed_files.map(()=>s.plan.reviewed_files[0])},{version:2},{png_sha256:'0'.repeat(64)},{caller_sha256:'0'.repeat(64)}]){writeFileSync(planFile,JSON.stringify({...s.plan,...patch}),{mode:0o600});const child=Bun.spawn([process.execPath,'--no-env-file','-e',code,planFile,s.journal],{env:{PATH:bin},stdout:'pipe',stderr:'pipe'});expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toBe('refused');expect(await new Response(child.stderr).text()).toBe('');expect(existsSync(marker)).toBe(false);}}finally{rmSync(s.dir,{recursive:true});}
},10000);

test('durable private receipt preserves frozen public identity, ACK and independent spent claim',async()=>{
 const {recordMediaReceipt}=await import('../scripts/m4d-live-media-acceptance.mjs');const s=setup();const broker=createOneAttemptBroker(s.plan,s.journal,async()=>({acknowledged:true}));
 try{await broker.attempt(s.body,PNG);const ack=recordMediaReceipt(s.journal,{native_guid:'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',acknowledged:true,passed:false});const stored=JSON.parse(readFileSync(s.journal,'utf8'));expect(stored.public_message_id).toBe('b'.repeat(32));expect(stored.attachment_id).toBe('a'.repeat(48));expect(stored.bindings).toEqual(s.plan.bindings);expect(stored.sources).toEqual(s.plan.sources);expect(stored.png_sha256).toBe(hash(PNG));expect(stored.passed).toBe(false);expect(ack.receiptSha256).toBe(hash(readFileSync(s.journal)));const completed=recordMediaReceipt(s.journal,{passed:true,observation:{complete:true,identity_preserved:true,receiver_sha256:hash(PNG)}});expect(completed.receiptPath).toBe(s.journal);expect(JSON.parse(readFileSync(s.journal,'utf8')).native_guid).toBe(stored.native_guid);expect(readFileSync(s.journal+'.spent','utf8')).toContain(s.plan.run);await expect(broker.attempt(s.body,PNG)).rejects.toThrow();}finally{broker.close();rmSync(s.dir,{recursive:true});}
});

test('actual caller rejects framed DB account versus different active handle before dispatch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chert-media-account-'));try{
 const fake=String.raw`@interface ChertBridgeClient:NSObject
 +(instancetype)shared;-(BOOL)readyNow;-(NSDictionary*)invokeAction:(NSString*)action params:(NSDictionary*)params timeout:(double)timeout error:(NSError**)error;
 @end
 @implementation ChertBridgeClient
 +(instancetype)shared{return [self new];}-(BOOL)readyNow{return YES;}
 -(NSDictionary*)invokeAction:(NSString*)action params:(NSDictionary*)params timeout:(double)timeout error:(NSError**)error{if([action isEqual:@"status"])return @{@"pid":@123,@"account_login":@"different-active-handle"};return @{@"chats":@[@{@"guid":@"any;-;+15550000002",@"participants":@[@"+15550000002"]}]};}
 @end
 BOOL BridgeAttachmentDispatch(BOOL(^ready)(void),NSDictionary*(^invoke)(NSError**),NSString**guid,NSError**error){fputs("DISPATCH-REACHED",stderr);return NO;}`;
 const source=CALLER_SOURCE.replace('#import "ChertBridgeClient.h"',fake).replace('#import "BridgeAttachmentDispatch.h"','');writeFileSync(join(dir,'caller.m'),source);
 const compile=Bun.spawn(['/usr/bin/clang','-fobjc-arc','-fblocks','-framework','Foundation',join(dir,'caller.m'),'-o',join(dir,'caller')],{stdout:'pipe',stderr:'pipe'});const compileError=await new Response(compile.stderr).text();expect(await compile.exited).toBe(0);expect(compileError).toBe('');
 const child=Bun.spawn([join(dir,'caller'),'--send-once'],{stdin:new Blob([JSON.stringify({chatGuid:'any;-;+15550000002',filePath:'/unused',expectedPid:123,expectedAccountLogin:'iMessage;-;+15550000001'})]),stdout:'pipe',stderr:'pipe'});expect(await child.exited).toBe(2);expect(await new Response(child.stdout).text()).toBe('');expect(await new Response(child.stderr).text()).toBe('');
 }finally{rmSync(dir,{recursive:true});}
},15000);


test('versioned preflight binds actual native and cloud sources without authorizing device effects',async()=>{
 const {prepareOperationPlan,operationPreflight,OPERATION_SOURCE_FILES}=await import('../scripts/m4d-live-media-acceptance.mjs');
 const s=setup();try{
  const plan=prepareOperationPlan(s.prior,s.bindings,s.plan.run);
  expect(plan.version).toBe(2);expect(plan.sources.map(item=>item.path)).toEqual(OPERATION_SOURCE_FILES);
  expect(plan.sources.some(item=>item.path==='src/send/AttachmentOperationStage.m')).toBe(true);
  expect(plan.sources.some(item=>item.path==='src/helper/AttachmentOperationJournal.m')).toBe(true);
  const result=operationPreflight(plan);expect(result.ready).toBe(false);
  expect(result.path).toBe('/api/v1/attachment-operations/v1');
  expect(result.blockers).not.toContain('cloud-caller-must-use-versioned-operation-route');
  expect(operationPreflight({...plan,installed_compatible:true} as typeof plan).ready).toBe(false);
  expect(()=>operationPreflight({...plan,cloud_caller_sha256:'0'.repeat(64)})).toThrow('reviewed cloud caller changed');
  const changedContext={...plan,cloud_context_sha256:'0'.repeat(64)};
  expect(()=>operationPreflight(changedContext)).toThrow('reviewed cloud context changed');
  expect(()=>operationPreflight({...plan,sources:plan.sources.map((item,i)=>i?item:{...item,sha256:'0'.repeat(64)})})).toThrow('reviewed native source changed');
  expect(()=>operationPreflight({...plan,sources:[...plan.sources,plan.sources[0]]})).toThrow();
 }finally{rmSync(s.dir,{recursive:true});}
});

test('historical live broker refuses an otherwise valid plan before any SSH or journal creation',async()=>{
 const s=setup();const {mkdirSync,existsSync}=await import('node:fs');
 const bin=join(s.dir,'bin'),marker=join(s.dir,'ssh-called'),planFile=join(s.dir,'plan.json'),newJournal=join(s.dir,'never-created.json');
 mkdirSync(bin,{mode:0o700});writeFileSync(join(bin,'ssh'),`#!/bin/sh\nprintf called > '${marker}'\nexit 1\n`,{mode:0o700});
 writeFileSync(planFile,JSON.stringify(s.plan),{mode:0o600});
 const modulePath=new URL('../scripts/m4d-live-media-acceptance.mjs',import.meta.url).href;
 const code=`import{startReviewedLiveBroker}from${JSON.stringify(modulePath)};try{await startReviewedLiveBroker(process.argv[1],process.argv[2],'--live-one-png',async()=>{});process.exit(2);}catch(e){process.stdout.write(e.message);}`;
 try{const child=Bun.spawn([process.execPath,'--no-env-file','-e',code,planFile,newJournal],{env:{PATH:bin},stdout:'pipe',stderr:'pipe'});
  expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toContain('Historical media broker disabled');
  expect(await new Response(child.stderr).text()).toBe('');expect(existsSync(marker)).toBe(false);expect(existsSync(newJournal)).toBe(false);
 }finally{rmSync(s.dir,{recursive:true});}
},10000);
