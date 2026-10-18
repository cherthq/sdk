import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {PNG} from './m4d-live-media-acceptance.mjs';
import {createOperationGateway,validOperationACK,validateOperationBody,REMOTE_OPERATION_PROGRAM,prepareOperationLivePlan,prepareURLMediaLivePlan,prepareURLCaptionLivePlan,loadOperationLivePlan,requiredHarnessSources} from './m4d-live-media-operation-acceptance.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const dir=mkdtempSync('/tmp/chert-operation-gateway-'),sender='+15550000001',recipient='+15550000002',guid='550e8400-e29b-41d4-a716-446655440000',id='a'.repeat(48);
 const identity={ready:true,sender,recipient,server_pid:100,messages_pid:200,service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64)};
 const plan={run:randomUUID(),png_bytes:PNG.length,png_sha256:sha(PNG),bindings:{...identity,sender_sha256:sha(sender),recipient_sha256:sha(recipient)}};
 const body={origin:'media_'+'c'.repeat(32),from:sender,to:recipient,attachment_id:id};
 const ack={...body,fingerprint:sha(JSON.stringify(['chert-attachment-once-v1',sender,recipient,'reviewed.png',sha(PNG)])),preparedGuid:guid,state:'acknowledged'};
 return{dir,plan,identity,body,ack,id,guid,journal:dir+'/attempt.json',cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
async function request(gateway,body,options={}){const raw=typeof body==='string'?body:JSON.stringify(body),ts=Math.floor(Date.now()/1000);return fetch(gateway.nativeOrigin+'/api/v1/attachment-operations/v1'+(options.query??''),{method:'POST',headers:{authorization:'Bearer '+gateway.apiKey,'x-chert-signature':`v1,${ts},${createHmac('sha256',gateway.signingSecret).update(ts+'.'+raw).digest('hex')}`,...options.headers},body:raw});}
test('signed exact operation verifies durable reservation before one effect and retains ACK/observer receipt',async()=>{
 const f=fixture();let effects=0,reads=0;
 const gateway=await createOperationGateway(f.plan,f.journal,f.identity,async body=>{reads++;expect(body).toEqual(f.body);expect(existsSync(f.journal+'.spent')).toBe(false);},async input=>{
  if(['preflight','identity'].includes(input.action))return f.identity;
  if(input.action==='observe')return{complete:true,guid:f.guid,receiver_sha256:sha(PNG),identity_unchanged:true};
  effects++;expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(true);expect(existsSync(f.journal+'.spent')).toBe(true);return{status:202,body:f.ack};
 });
 try{gateway.bindUploadedPNG(PNG,f.id);expect((await request(gateway,f.body)).status).toBe(202);expect(reads).toBe(1);expect(effects).toBe(1);const before=JSON.parse(readFileSync(f.journal));expect(before.native_guid).toBe(f.guid);expect(before.public_message_id).toBe('c'.repeat(32));expect(before.passed).toBe(false);expect((await request(gateway,f.body)).status).toBe(502);expect(effects).toBe(1);expect((await gateway.observe(f.guid)).passed).toBe(true);const receipt=readFileSync(f.journal,'utf8');expect(receipt).not.toContain(gateway.apiKey);expect(receipt).not.toContain(gateway.signingSecret);expect(JSON.parse(receipt).observation.png_sha256).toBe(sha(PNG));await expect(createOperationGateway(f.plan,f.journal,f.identity,async()=>{},async()=>{})).rejects.toThrow();}finally{await gateway.close();f.cleanup();}
});
test('wrong body, peer, authentication, oversized body and absent uploaded bytes never claim or call executor',async()=>{
 const f=fixture();let calls=0;const gateway=await createOperationGateway(f.plan,f.journal,f.identity,async()=>{calls++;},async()=>{calls++;});
 try{
  expect((await request(gateway,f.body)).status).toBe(502);gateway.bindUploadedPNG(PNG,f.id);
  for(const [body,options] of [[{...f.body,to:'+15550000003'},{}],[{...f.body,attachment_id:'b'.repeat(48)},{}],[{...f.body,extra:true},{}],[{...f.body,origin:f.body.origin+'\n'},{}],[f.body,{headers:{authorization:'Bearer wrong'}}],[f.body,{headers:{'x-chert-signature':'invalid'}}],['x'.repeat(16385),{}],[f.body,{query:'?unexpected=1'}]]){const result=await request(gateway,body,options);expect(result.status).toBe(typeof body==='string'&&body.length>16384?413:502);expect(await result.text()).not.toContain(f.body.to);}
  expect(calls).toBe(0);expect(existsSync(f.journal+'.spent')).toBe(false);
 }finally{await gateway.close();f.cleanup();}
});
test.each(['reservation','identity','lost-ack','malformed-ack','wrong-fingerprint'])('%s fails closed without retry or invented GUID',async fault=>{
 const f=fixture();let effects=0;const gateway=await createOperationGateway(f.plan,f.journal,f.identity,async()=>{if(fault==='reservation')throw Error('private row');},async input=>{if(input.action==='preflight')return fault==='identity'?{...f.identity,helper_sha256:'0'.repeat(64)}:f.identity;effects++;if(fault==='lost-ack')throw Error('private response');return{status:202,body:fault==='wrong-fingerprint'?{...f.ack,fingerprint:'0'.repeat(64)}:fault==='malformed-ack'?{...f.ack,unexpected:true}:f.ack};});
 try{gateway.bindUploadedPNG(PNG,f.id);const result=await request(gateway,f.body);expect(result.status).toBe(502);expect(await result.text()).not.toContain('private');const attempted=!['reservation','identity'].includes(fault);expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(attempted);expect(effects).toBe(attempted?1:0);expect(existsSync(f.journal+'.spent')).toBe(attempted);expect(JSON.parse(readFileSync(f.journal)).native_guid).toBeUndefined();if(attempted){expect((await request(gateway,f.body)).status).toBe(502);expect(effects).toBe(1);}}finally{await gateway.close();f.cleanup();}
});
test('concurrent requests can produce only one durable claim and one effect',async()=>{
 const f=fixture();let effects=0,release;const barrier=new Promise(resolve=>{release=resolve;});let entered=0;
 const gateway=await createOperationGateway(f.plan,f.journal,f.identity,async()=>{if(++entered===2)release();await barrier;},async input=>input.action==='preflight'?f.identity:(effects++,{status:202,body:f.ack}));
 try{gateway.bindUploadedPNG(PNG,f.id);const responses=await Promise.all([request(gateway,f.body),request(gateway,f.body)]);expect(responses.map(r=>r.status).sort()).toEqual([202,502]);expect(effects).toBe(1);}finally{release();await gateway.close();f.cleanup();}
});
test('complete remote program compiles without starting processes; exact ACK/body predicates reject unsupported shapes',async()=>{
 const f=fixture();try{expect(validOperationACK(f.ack,f.body)).toBe(true);expect(validOperationACK({...f.ack,state:'attempted'},f.body)).toBe(false);expect(()=>validateOperationBody({...f.body,attachment_id:f.id+'\n'},f.identity,f.id)).toThrow();expect(REMOTE_OPERATION_PROGRAM).not.toContain('ensureReady');expect(REMOTE_OPERATION_PROGRAM).toContain("'--isolated-attachment-acceptance'");const child=Bun.spawn(['python3','-c',"import sys;compile(sys.stdin.read(),'operation-program','exec')"],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});child.stdin.write(REMOTE_OPERATION_PROGRAM);child.stdin.end();const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'',err:''});}finally{f.cleanup();}
});
test('operation plan requires verified staged artifact, exact source set and immutable source/receipt hashes',()=>{
 const f=fixture(),put=(name,value)=>{const path=f.dir+'/'+name;writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;};
 try{
  const manifest=put('manifest.json',{kind:'local-native-candidate-not-installed',inputs_unchanged_after_build:true,artifacts:{'mac-server':{sha256:'a'.repeat(64)},'chert-imsg-bridge.dylib':{sha256:'b'.repeat(64)}}});
  const installed=put('installed.json',{kind:'reviewed-native-installation',host:'chert-m4d',candidate_manifest_sha256:sha(readFileSync(manifest)),...f.plan.bindings,kind_unused:undefined,account_login_sha256:'c'.repeat(64),approved_chat_guid_sha256:'d'.repeat(64)});
  const prior=put('prior.json',{attempted:true,passed:true,environment:'reviewed-live',native:{guid:f.guid},recipient:{guid:f.guid}});
  const artifact=f.dir+'/artifact';writeFileSync(artifact,'test-only-no-executable',{mode:0o600});
  const harness={kind:'reviewed-isolated-attachment-harness',host:'chert-m4d',verified_stage:true,local_artifact:{path:artifact,sha256:sha(readFileSync(artifact))},remote_artifact:{path:'/tmp/test-only-no-executable',sha256:sha(readFileSync(artifact))},sources:requiredHarnessSources().map(path=>({path,sha256:sha(readFileSync(new URL('../../'+path,import.meta.url)))}))};
  const harnessPath=put('harness.json',harness),plan=prepareOperationLivePlan(manifest,installed,prior,harnessPath,f.plan.run),path=put('plan.json',plan);
  expect(loadOperationLivePlan(path)).toEqual(plan);if(process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST){const v2=prepareURLMediaLivePlan(manifest,installed,prior,harnessPath,f.plan.run,process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST),v2path=put('url-plan.json',v2);expect(loadOperationLivePlan(v2path)).toEqual(v2);expect(v2.receipt_path).toBe(realpathSync(f.dir)+'/'+f.plan.run+'.url-media.attempt.json');expect(v2.files.pixel.value.reference.sha256).toBe(v2.png_sha256);const v3=prepareURLCaptionLivePlan(manifest,installed,prior,harnessPath,f.plan.run,process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST),v3path=put('caption-plan.json',v3);expect(loadOperationLivePlan(v3path)).toEqual(v3);expect(v3.caption).toContain(' / Café 🌅');expect(v3.receipt_path).toEndWith('.url-caption.attempt.json');writeFileSync(v3path,JSON.stringify({...v3,caption:v3.caption.trim()}));expect(()=>loadOperationLivePlan(v3path)).toThrow('Reviewed operation sources changed');}harness.verified_stage=false;writeFileSync(harnessPath,JSON.stringify(harness));expect(()=>loadOperationLivePlan(path)).toThrow();
  harness.verified_stage=true;harness.sources[0].path='../../outside';writeFileSync(harnessPath,JSON.stringify(harness));expect(()=>prepareOperationLivePlan(manifest,installed,prior,harnessPath,f.plan.run)).toThrow();expect(existsSync(f.journal+'.spent')).toBe(false);
 }finally{f.cleanup();}
});
test('lost launch response recovers only durable matching process manifest and stops actual task-owned process',async()=>{
 const begin=REMOTE_OPERATION_PROGRAM.indexOf('def task_control():'),end=REMOTE_OPERATION_PROGRAM.indexOf('def freeport():',begin);expect(begin).toBeGreaterThan(0);expect(end).toBeGreaterThan(begin);
 const program=`import os,sys,json,stat,subprocess,tempfile,threading,time,signal,types,shutil,ctypes\nbase=tempfile.mkdtemp(prefix='chert-owned-stop-test-')\ndef check(v):assert v\nplan={'run':'offline-run','harness':{'remote_artifact':{'path':base+'/artifact','sha256':'a'*64}}};B={'server_pid':os.getpid()}\npwd=types.SimpleNamespace(getpwnam=lambda _:types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid()))\ndef artifact():return '/bin/sleep'\ndef pidpath(pid):\n lib=ctypes.CDLL('/usr/lib/libproc.dylib');buf=ctypes.create_string_buffer(4096);check(lib.proc_pidpath(pid,buf,len(buf))>0);return buf.value.decode()\n${REMOTE_OPERATION_PROGRAM.slice(begin,end)}\nchild=None\ntry:\n os.mkdir(task_control(),0o700);child=subprocess.Popen(['/bin/sleep','30']);reaper=threading.Thread(target=child.wait);reaper.start()\n task={'pid':child.pid,'port':12345,'control':task_control(),'artifact_sha256':'a'*64};save_task(task)\n # The caller deliberately discards the launch result; only manifest recovery remains.\n assert stop_task()=={'stopped':True,'found':True};reaper.join(timeout=2);assert child.poll() is not None\n assert load_task()==task;assert os.path.isfile(task_control()+'/process.json')\n print('owned-process-stopped')\nfinally:\n if child is not None and child.poll() is None:child.kill();child.wait()\n shutil.rmtree(base)\n`;
 const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'owned-process-stopped\n',err:''});
});

test('URL media v2 exact frozen tuple refuses changed imported bytes and alternate permanent claim before effects',async()=>{
 const {URL_MEDIA_SOURCE}=await import('./m4d-live-media-operation-acceptance.mjs'),f=fixture();let effects=0;
 const plan={...f.plan,version:2,media_source:URL_MEDIA_SOURCE,png_bytes:URL_MEDIA_SOURCE.bytes,png_sha256:URL_MEDIA_SOURCE.sha256,receipt_path:f.journal};
 try{
  await expect(createOperationGateway(plan,f.dir+'/alternate.json',f.identity,async()=>{},async()=>{effects++;})).rejects.toThrow();
  const gateway=await createOperationGateway(plan,f.journal,f.identity,async()=>{},async()=>{effects++;});try{expect(()=>gateway.bindUploadedPNG(PNG,f.id)).toThrow();expect((await request(gateway,f.body)).status).toBe(502);expect(effects).toBe(0);expect(existsSync(f.journal+'.spent')).toBe(false);expect(validOperationACK(f.ack,f.body,plan)).toBe(false);const ack={...f.ack,fingerprint:sha(JSON.stringify(['chert-attachment-once-v1',f.body.from,f.body.to,URL_MEDIA_SOURCE.filename,URL_MEDIA_SOURCE.sha256]))};expect(validOperationACK(ack,f.body,plan)).toBe(true);}finally{await gateway.close();}
 }finally{f.cleanup();}
});
test('URL media observer compiles offline and proves exact pair before returning bounded bytes',async()=>{
 const {URL_MEDIA_OBSERVER}=await import('./m4d-live-media-operation-acceptance.mjs');const child=Bun.spawn(['python3','-c',"import sys;compile(sys.stdin.read(),'url-media-observer','exec')"],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});child.stdin.write(URL_MEDIA_OBSERVER);child.stdin.end();expect(await child.exited).toBe(0);expect(await new Response(child.stderr).text()).toBe('');expect(URL_MEDIA_OBSERVER).toContain("senderattachments==1");expect(URL_MEDIA_OBSERVER).toContain('1048576');expect(URL_MEDIA_OBSERVER).not.toContain("action=='send'");
});
test.skipIf(!process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST)('reviewed ImageIO tool checks frozen source locally without network or device actions',async()=>{
 const {compareURLMediaObservation,URL_MEDIA_SOURCE}=await import('./m4d-live-media-operation-acceptance.mjs'),path=process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST;
 const value=JSON.parse(readFileSync(path)),bytes=readFileSync(value.reference.path),plan={version:2,files:{pixel:{path,sha256:sha(readFileSync(path)),value}},png_sha256:URL_MEDIA_SOURCE.sha256,png_bytes:URL_MEDIA_SOURCE.bytes};
 const observation={complete:true,identity_unchanged:true,receiver_sha256:sha(bytes),receiver_png_base64:bytes.toString('base64')};expect(compareURLMediaObservation(plan,observation)).toMatchObject({original_byte_gate_passed:true,pixel_equivalence_passed:true,source_bytes:12746,recipient_bytes:12746});expect(()=>compareURLMediaObservation(plan,{...observation,receiver_sha256:'0'.repeat(64)})).toThrow();expect(()=>compareURLMediaObservation(plan,{...observation,receiver_png_base64:PNG.toString('base64'),receiver_sha256:sha(PNG)})).toThrow();
});
test.skipIf(!process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST)('v2 injected executor spends exactly once on valid ACK or lost reply; copied plan cannot change claim',async()=>{
 const {URL_MEDIA_SOURCE}=await import('./m4d-live-media-operation-acceptance.mjs'),manifest=JSON.parse(readFileSync(process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST)),bytes=readFileSync(manifest.reference.path);
 for(const lost of [false,true]){const f=fixture();let effects=0;const plan={...f.plan,version:2,media_source:URL_MEDIA_SOURCE,png_bytes:URL_MEDIA_SOURCE.bytes,png_sha256:URL_MEDIA_SOURCE.sha256,receipt_path:f.journal};const ack={...f.ack,fingerprint:sha(JSON.stringify(['chert-attachment-once-v1',f.body.from,f.body.to,URL_MEDIA_SOURCE.filename,URL_MEDIA_SOURCE.sha256]))};
 const gateway=await createOperationGateway(plan,f.journal,f.identity,async()=>{},async input=>{if(input.action==='preflight')return f.identity;effects++;if(lost)throw Error('lost reply');return{status:202,body:ack};});
 try{gateway.bindUploadedPNG(bytes,f.id);expect((await request(gateway,f.body)).status).toBe(lost?502:202);expect(effects).toBe(1);expect(existsSync(f.journal+'.spent')).toBe(true);expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(true);expect((await request(gateway,f.body)).status).toBe(502);expect(effects).toBe(1);await expect(createOperationGateway({...plan},f.dir+'/copy-receipt.json',f.identity,async()=>{},async()=>{})).rejects.toThrow();await expect(createOperationGateway({...plan},f.journal,f.identity,async()=>{},async()=>{})).rejects.toThrow();}finally{await gateway.close();f.cleanup();}
 }
});

test.skipIf(!process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST)('caption v3 binds exact bytes and Foundation fingerprint, spends once and refuses malformed ACK',async()=>{
 const {URL_MEDIA_SOURCE}=await import('./m4d-live-media-operation-acceptance.mjs');
 for(const bad of [false,true,'lost']){const f=fixture();f.plan={...f.plan,version:3,caption:'  CHERT-CAPTION / Café 🌅\r\n  ',media_source:{...URL_MEDIA_SOURCE},png_bytes:URL_MEDIA_SOURCE.bytes,png_sha256:URL_MEDIA_SOURCE.sha256,receipt_path:f.journal};
 const body={...f.body,origin:'caption_'+'c'.repeat(32),caption:f.plan.caption};
 const {caption,...tuple}=body;const ack={...tuple,caption_sha256:sha(caption),fingerprint:sha(JSON.stringify(['chert-captioned-attachment-once-v2',body.from,body.to,URL_MEDIA_SOURCE.filename,URL_MEDIA_SOURCE.sha256,caption]).replace(/\//g,'\\/')),preparedGuid:f.guid,state:'acknowledged'};
 expect(validOperationACK(ack,body,f.plan)).toBe(true);expect(validOperationACK({...ack,caption_sha256:'0'.repeat(64)},body,f.plan)).toBe(false);expect(validOperationACK({...ack,caption},body,f.plan)).toBe(false);expect(()=>validateOperationBody({...body,caption:caption.trim()},f.identity,f.id,f.plan)).toThrow();
 let effects=0;const gateway=await createOperationGateway(f.plan,f.journal,f.identity,async()=>{expect(existsSync(f.journal+'.spent')).toBe(false);},async input=>{if(input.action==='preflight')return f.identity;effects++;expect(existsSync(f.journal+'.spent')).toBe(true);if(bad==='lost')throw Error('unknown');return{status:202,body:bad?{...ack,caption_sha256:'0'.repeat(64)}:ack};});
 // The URL source bytes are independently required before any executor action.
 const bytes=JSON.parse(readFileSync(process.env.CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST)).reference.path;
 try{gateway.bindUploadedPNG(readFileSync(bytes),f.id);const post=()=>{const raw=JSON.stringify(body),ts=Math.floor(Date.now()/1000);return fetch(gateway.nativeOrigin+'/api/v1/attachment-operations/v2',{method:'POST',headers:{authorization:'Bearer '+gateway.apiKey,'x-chert-signature':`v1,${ts},${createHmac('sha256',gateway.signingSecret).update(ts+'.'+raw).digest('hex')}`},body:raw});};expect((await post()).status).toBe(bad?502:202);expect((await post()).status).toBe(502);expect(effects).toBe(1);expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(true);}finally{await gateway.close();f.cleanup();}}
});

test('caption observer checks exact plain or constructed body projections; NULL and changed bodies refuse',async()=>{
 const {URL_MEDIA_OBSERVER,CAPTION_PROJECTION_SOURCE}=await import('./m4d-live-media-operation-acceptance.mjs');
 expect(URL_MEDIA_OBSERVER).toContain("if p['plan']['version']==3:");
 expect(URL_MEDIA_OBSERVER).toContain("SELECT text FROM message WHERE guid=? LIMIT 2");
 expect(URL_MEDIA_OBSERVER).not.toContain('attributedBody');
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync('/usr/bin/python3',['-c','import sys;compile(sys.stdin.read(),"observer","exec")'],{input:URL_MEDIA_OBSERVER.replace('PAYLOAD',Buffer.from('{}').toString('base64')),encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');
 const program=`${CAPTION_PROJECTION_SOURCE}
caption='  exact / 🌅'+chr(13)+chr(10)+'  '
assert caption_projection(caption,caption)=='plain-caption'
assert caption_projection(caption+chr(0xFFFC),caption)=='caption-plus-attachment'
normalized=chr(0xA0)*2+'exact / 🌅'+chr(10)*2+chr(0xA0)*2+chr(0xFFFC)
for value in [None,'',caption.strip(),caption+chr(0xFFFC)*2,caption+'x',normalized,caption+chr(92)+'uFFFC']:
 assert caption_projection(value,caption) is None
`;
 const checked=spawnSync('/usr/bin/python3',['-c',program],{encoding:'utf8'});expect(checked.status).toBe(0);expect(checked.stderr).toBe('');
});
