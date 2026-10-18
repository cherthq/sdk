import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {prepareTextPlan,prepareProviderTextPlan,loadTextPlan,createTextGateway,startReviewedTextBroker} from './m4d-live-text-acceptance.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const dir=mkdtempSync('/tmp/chert-text-gateway-test.'),run=randomUUID(),sender='+15550000001',recipient='+15550000002';
 // Synthetic installation fixtures are for injected offline tests, never device evidence.
 const manifest={kind:'local-native-candidate-not-installed',inputs_unchanged_after_build:true,artifacts:{'mac-server':{sha256:'a'.repeat(64)},'chert-imsg-bridge.dylib':{sha256:'b'.repeat(64)}}};
 const put=(name,value)=>{const path=dir+'/'+name;writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;};
 const manifestPath=put('manifest.json',manifest),installationPath=put('installation.json',{kind:'reviewed-native-installation',host:'chert-m4d',candidate_manifest_sha256:hash(readFileSync(manifestPath)),service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64),server_pid:100,messages_pid:200,sender_sha256:hash(sender),recipient_sha256:hash(recipient),account_login_sha256:'c'.repeat(64),approved_chat_guid_sha256:'d'.repeat(64)}),guid='550e8400-e29b-41d4-a716-446655440000';
 const priorPath=put('prior.json',{attempted:true,passed:true,environment:'reviewed-live',native:{guid},recipient:{guid}});
 const plan=prepareTextPlan(manifestPath,installationPath,priorPath,run),path=put('plan.json',plan);
 return{dir,plan,path,journal:dir+'/'+run+'.receipt.json',sender,recipient,guid,identity:{ready:true,sender,recipient,server_pid:100,messages_pid:200,service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64)},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
async function request(gateway,body,update={}){const raw=typeof body==='string'?body:JSON.stringify(body),ts=Math.floor(Date.now()/1000);return fetch(gateway.nativeOrigin+'/api/v1/text-operations/v1'+(update.query??''),{method:'POST',headers:{authorization:'Bearer '+gateway.apiKey,'content-type':'application/json','x-chert-signature':`v1,${ts},${createHmac('sha256',gateway.signingSecret).update(`${ts}.${raw}`).digest('hex')}`,...update.headers},body:raw});}
const body=f=>({origin:f.plan.origin,from:f.sender,to:f.recipient,text:f.plan.marker});
test('plan requires separate matching installation receipt and binds source/receipt changes',()=>{const f=fixture();try{expect(loadTextPlan(f.path)).toEqual(f.plan);const installed=f.plan.files.installation.path;const value=JSON.parse(readFileSync(installed));value.kind='local-native-candidate-not-installed';writeFileSync(installed,JSON.stringify(value));expect(()=>loadTextPlan(f.path)).toThrow();expect(existsSync(f.journal+'.spent')).toBe(false);}finally{f.cleanup();}});
test('signed malformed requests cannot reserve or spend; actual ACK one effect and permanent claim',async()=>{const f=fixture();let effects=0,reservations=0;const execute=async p=>{if(['preflight','identity'].includes(p.action))return f.identity;expect(p.action).toBe('send');effects++;expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(true);expect(existsSync(f.journal+'.spent')).toBe(true);return{status:202,body:{origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:hash(JSON.stringify(['chert-text-once-v1',p.body.from,p.body.to,p.body.text])),preparedGuid:f.guid,state:'acknowledged'}};};const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{reservations++;},execute);try{
 for(const [value,options]of [[body(f),{headers:{authorization:'Bearer wrong'}}],[body(f),{headers:{'x-chert-signature':'v1,0,bad'}}],[{...body(f),to:'+15550000099'},{}],[{...body(f),origin:'text_'+'e'.repeat(32)},{}],[{...body(f),text:'foreign marker'},{}],[{...body(f),extra:true},{}],[' '.repeat(32769),{}],[body(f),{query:'?unknown=1'}]]){const response=await request(gateway,value,options);expect(response.status).toBe(502);expect(effects).toBe(0);expect(reservations).toBe(0);expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(false);}
 expect((await request(gateway,body(f))).status).toBe(202);expect(effects).toBe(1);expect(reservations).toBe(1);expect((await request(gateway,body(f))).status).toBe(502);expect(effects).toBe(1);
 await expect(createTextGateway(f.plan,f.journal,f.identity,async()=>{},execute)).rejects.toThrow();
 const copyDir=f.dir+'/copied';mkdirSync(copyDir,{mode:0o700});const copy=copyDir+'/plan.json';writeFileSync(copy,JSON.stringify(f.plan),{mode:0o600});expect(loadTextPlan(copy).receipt_path).toBe(f.plan.receipt_path);await expect(startReviewedTextBroker(copy,f.journal,'--live-one-text',async()=>{})).rejects.toThrow('Existing receipt');expect(effects).toBe(1);
 }finally{await gateway.close();f.cleanup();}});
test.each(['reservation','old-pair','lost-reply','wrong-fingerprint','wrong-guid','wrong-origin','wrong-status'])('%s cannot create a positive result or resend',async fault=>{const f=fixture();let effects=0;const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{if(fault==='reservation')throw Error('private DB data');},async p=>{if(p.action==='preflight')return fault==='old-pair'?{...f.identity,service_sha256:'e'.repeat(64)}:f.identity;effects++;if(fault==='lost-reply')throw Error('private SSH data');const ack={origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:hash(JSON.stringify(['chert-text-once-v1',p.body.from,p.body.to,p.body.text])),preparedGuid:f.guid,state:'acknowledged'};if(fault==='wrong-fingerprint')ack.fingerprint='f'.repeat(64);if(fault==='wrong-guid')ack.preparedGuid='bad';if(fault==='wrong-origin')ack.origin='text_'+'f'.repeat(32);return{status:fault==='wrong-status'?200:202,body:ack};});try{const response=await request(gateway,body(f));expect(response.status).toBe(502);expect(await response.text()).not.toContain('private');const spent=!['reservation','old-pair'].includes(fault);expect(JSON.parse(readFileSync(f.journal)).attempted).toBe(spent);expect(existsSync(f.journal+'.spent')).toBe(spent);expect(effects).toBe(spent?1:0);if(spent){expect((await request(gateway,body(f))).status).toBe(502);expect(effects).toBe(1);}}finally{await gateway.close();f.cleanup();}});

test.each([undefined,'SMS'])('observation refuses missing or wrong service %s without inventing iMessage',async service=>{const f=fixture();const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{},async p=>{if(['preflight','identity'].includes(p.action))return f.identity;if(p.action==='observe')return{complete:true,guid:f.guid,sender_exact:true,recipient_exact:true,...(service?{service}:{})};return{status:202,body:{origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:hash(JSON.stringify(['chert-text-once-v1',p.body.from,p.body.to,p.body.text])),preparedGuid:f.guid,state:'acknowledged'}};});try{expect((await request(gateway,body(f))).status).toBe(202);await expect(gateway.observe(f.guid)).rejects.toThrow();expect(JSON.parse(readFileSync(f.journal)).passed).toBe(false);}finally{await gateway.close();f.cleanup();}});

test('actual remote HTTP signer is exercised with a fake opener: exact body/HMAC and no network',async()=>{
 const {REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs');
 const start=REMOTE_TEXT_PROGRAM.indexOf('def request('),end=REMOTE_TEXT_PROGRAM.indexOf('\ndef pidpath(',start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const program=`import json,time,hmac,hashlib,urllib.request,urllib.error
a={'API_KEY':'remote-only-key','LINE_SIGNING_SECRET':'remote-only-signing'}
def check(v):assert v
class Reply:
 status=202
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self,n):return b'{"state":"acknowledged"}'
class FakeOpener:
 calls=0
 def open(self,req,timeout):
  self.calls+=1
  assert req.get_header('Authorization')=='Bearer remote-only-key'
  if req.full_url.endswith('/status'):
   assert req.method=='GET' and req.data is None and req.get_header('X-chert-signature') is None
  else:
   if req.method=='POST':assert req.data==b'{"fixture":true}'
   else:assert req.method=='GET' and req.data is None
   version,ts,signature=req.get_header('X-chert-signature').split(',')
   assert version=='v1' and signature==hmac.new(b'remote-only-signing',ts.encode()+b'.'+(req.data or b''),hashlib.sha256).hexdigest()
  return Reply()
opener=FakeOpener()
${REMOTE_TEXT_PROGRAM.slice(start,end)}
assert request('/api/v1/text-operations/v1',b'{"fixture":true}')=={'status':202,'body':{'state':'acknowledged'}}
request('/api/v1/text-operations/v1/text_'+'a'*32+'?from=%2B15550000001')
request('/status')
assert opener.calls==3
print('offline-native-http-signer-pass')
`;

 const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,err}).toEqual({code:0,err:''});expect(out.trim()).toBe('offline-native-http-signer-pass');
});


test('production entry refuses alternate claim path before reaching its SSH executor',async()=>{const f=fixture();try{await expect(startReviewedTextBroker(f.path,f.dir+'/alternate-receipt.json','--live-one-text',async()=>{})).rejects.toThrow('Claim path must be bound');expect(existsSync(f.journal)).toBe(false);expect(existsSync(f.dir+'/alternate-receipt.json')).toBe(false);}finally{f.cleanup();}});


function asV2(f,provider='linq'){const plan=prepareProviderTextPlan(f.plan.files.manifest.path,f.plan.files.installation.path,f.plan.files.prior.path,provider,f.plan.run);writeFileSync(f.path,JSON.stringify(plan),{mode:0o600});f.plan=plan;return f;}
const learnedBody=(f,id='1'.repeat(32))=>({origin:'text_'+id,from:f.sender,to:f.recipient,text:f.plan.marker});
test.each(['blooio','linq','sendblue','blooio-v4','loopmessage'])('v2 %s plan has no invented publicID or idempotency and requires matched explicit flag',async provider=>{const f=asV2(fixture(),provider);try{expect(loadTextPlan(f.path)).toEqual(f.plan);for(const key of ['origin','public_message_id','idempotency_key'])expect(f.plan).not.toHaveProperty(key);await expect(startReviewedTextBroker(f.path,f.journal,'--live-one-text',async()=>{})).rejects.toThrow();await expect(startReviewedTextBroker(f.path,f.journal,'--live-one-text-provider',async()=>{},provider==='linq'?'sendblue':'linq')).rejects.toThrow('Provider selection');expect(existsSync(f.journal)).toBe(false);}finally{f.cleanup();}});
test('v2 concurrent different reserved IDs freeze exactly one learned claim before one effect',async()=>{const f=asV2(fixture());let effects=0,reads=0,arrivals=0,release;const barrier=new Promise(yes=>release=yes);const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{reads++;if(reads<=2){if(++arrivals===2)release();await barrier;}},async p=>{if(p.action==='preflight'){expect(p.claim.provider).toBe('linq');return f.identity;}effects++;const stored=JSON.parse(readFileSync(f.journal));expect(stored.attempted).toBe(true);expect(stored.public_message_id).toBe(p.body.origin.slice(5));expect(stored.learned_claim).toEqual(p.claim);expect(p.claim.body_sha256).toBe(hash(p.raw));expect(p.claim.fingerprint).toBe(hash(JSON.stringify(['chert-text-once-v1',p.body.from,p.body.to,p.body.text])));expect(JSON.parse(readFileSync(f.journal+'.spent')).learned_claim).toEqual(p.claim);return{status:202,body:{origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:p.claim.fingerprint,preparedGuid:f.guid,state:'acknowledged'}};});try{const results=await Promise.all([request(gateway,learnedBody(f)),request(gateway,learnedBody(f,'2'.repeat(32)))]);expect(results.map(r=>r.status).sort()).toEqual([202,502]);expect(reads).toBe(4);expect(effects).toBe(1);expect((await request(gateway,learnedBody(f,'3'.repeat(32)))).status).toBe(502);expect(effects).toBe(1);await expect(createTextGateway(f.plan,f.journal,f.identity,async()=>{},async()=>{})).rejects.toThrow();const copyDir=f.dir+'/copy-v2';mkdirSync(copyDir,{mode:0o700});const copy=copyDir+'/plan.json';writeFileSync(copy,JSON.stringify(f.plan),{mode:0o600});expect(loadTextPlan(copy).receipt_path).toBe(f.plan.receipt_path);await expect(startReviewedTextBroker(copy,f.journal,'--live-one-text-provider',async()=>{},'linq')).rejects.toThrow('Existing receipt');}finally{await gateway.close();f.cleanup();}});
test.each(['first-read','second-read','origin-exists','old-pair','lost-reply','bad-ack'])('v2 %s preserves admission boundary and never retries learned identity',async fault=>{const f=asV2(fixture(),'loopmessage');let effects=0,reads=0;const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{reads++;if((fault==='first-read'&&reads===1)||(fault==='second-read'&&reads===2))throw Error('DB identity changed');},async p=>{if(p.action==='preflight'){if(fault==='origin-exists')throw Error('Origin already present');return fault==='old-pair'?{...f.identity,helper_sha256:'0'.repeat(64)}:f.identity;}effects++;if(fault==='lost-reply')throw Error('Lost actual reply');return{status:202,body:{origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:fault==='bad-ack'?'0'.repeat(64):p.claim.fingerprint,preparedGuid:f.guid,state:'acknowledged'}};});try{const response=await request(gateway,learnedBody(f));expect(response.status).toBe(502);const admitted=['lost-reply','bad-ack'].includes(fault);expect(effects).toBe(admitted?1:0);const receipt=JSON.parse(readFileSync(f.journal));expect(receipt.attempted).toBe(admitted);if(admitted){expect(receipt.public_message_id).toBe('1'.repeat(32));expect(receipt.learned_claim.provider).toBe('loopmessage');expect((await request(gateway,learnedBody(f,'4'.repeat(32)))).status).toBe(502);expect(effects).toBe(1);}else expect(existsSync(f.journal+'.spent')).toBe(false);}finally{await gateway.close();f.cleanup();}});

test('remote learned-claim validator rejects provider/origin/fingerprint/body/plan scope tampering offline',async()=>{
 const{REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs');const start=REMOTE_TEXT_PROGRAM.indexOf('def claim_origin():'),end=REMOTE_TEXT_PROGRAM.indexOf('\ntry:\n before=identity()',start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const program=`import json,re,hashlib\ndef sha(v):return hashlib.sha256(v).hexdigest()\ndef check(v):assert v\nsender='+15550000001';recipient='+15550000002'\nplan={'version':2,'provider':'linq','run':'fixture-run','marker':'fixed-marker'}\nc={'provider':'linq','run':'fixture-run','public_message_id':'1'*32,'origin':'text_'+'1'*32,'fingerprint':sha(json.dumps(['chert-text-once-v1',sender,recipient,plan['marker']],separators=(',',':')).encode()),'body_sha256':'a'*64,'plan_sha256':sha(json.dumps(plan,separators=(',',':')).encode())}\np={'claim':c}\n${REMOTE_TEXT_PROGRAM.slice(start,end)}\nassert claim_origin()==c['origin']\nfor key,value in [('provider','sendblue'),('run','other-run'),('public_message_id','bad'),('origin','text_'+'2'*32),('fingerprint','0'*64),('body_sha256','bad'),('plan_sha256','0'*64)]:\n original=c[key];c[key]=value\n try:claim_origin();raise RuntimeError('tampered claim accepted')\n except AssertionError:pass\n finally:c[key]=original\nprint('offline-learned-claim-pass')\n`;
 const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,err}).toEqual({code:0,err:''});expect(out.trim()).toBe('offline-learned-claim-pass');
});


test('v2 wrong peer/provider marker/malformed origin cannot reach reservation or remote preflight',async()=>{const f=asV2(fixture(),'sendblue');let reads=0,remote=0;const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{reads++;},async()=>{remote++;return f.identity;});try{for(const value of [{...learnedBody(f),to:'+15550000009'},{...learnedBody(f),text:f.plan.marker.replace('sendblue','linq')},{...learnedBody(f),origin:'text_bad'}]){expect((await request(gateway,value)).status).toBe(502);expect(reads).toBe(0);expect(remote).toBe(0);expect(existsSync(f.journal+'.spent')).toBe(false);}}finally{await gateway.close();f.cleanup();}});

test('complete remote program compiles offline without running its identity or send actions',async()=>{const{REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs');const child=Bun.spawn(['python3','-c',"import sys; compile(sys.stdin.read(), 'reviewed-remote-program', 'exec')"],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});child.stdin.write(REMOTE_TEXT_PROGRAM);child.stdin.end();const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'',err:''});});

test('exact GUID SQLite observation permits only NULL sender text with identical bounded recipient attributed bytes',async()=>{
 const{REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs');const start=REMOTE_TEXT_PROGRAM.indexOf('def observed_rows('),end=REMOTE_TEXT_PROGRAM.indexOf('\ntry:\n before=identity()',start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const program=`import sqlite3
${REMOTE_TEXT_PROGRAM.slice(start,end)}
guid='550e8400-e29b-41d4-a716-446655440000';sender='+15550000001';recipient='+15550000002';marker='CHERT-FIXTURE'
def database(incoming,text,blob):
 d=sqlite3.connect(':memory:');d.executescript('CREATE TABLE message(guid,is_from_me,service,text,destination_caller_id,handle_id,attributedBody);CREATE TABLE handle(id);CREATE TABLE chat(guid,chat_identifier);CREATE TABLE chat_message_join(message_id,chat_id);CREATE TABLE chat_handle_join(chat_id,handle_id);')
 peer=sender if incoming else recipient
 d.execute('INSERT INTO handle VALUES(?)',(peer,));d.execute('INSERT INTO chat VALUES(?,?)',('iMessage;-;'+peer,peer));d.execute('INSERT INTO message VALUES(?,?,?,?,?,?,?)',(guid,int(not incoming),'iMessage',text,sender,1,blob));d.execute('INSERT INTO chat_message_join VALUES(1,1)');d.execute('INSERT INTO chat_handle_join VALUES(1,1)');return d
a=database(False,None,b'exact-attributed');b=database(True,marker,b'exact-attributed')
def result():return exact_observed_pair([observed_rows(a,guid),observed_rows(b,guid)],guid,marker,sender,recipient)
assert result()
a.execute('UPDATE message SET text=?',(marker,));assert result()
a.execute('UPDATE message SET text=?',('wrong',));assert not result()
a.execute('UPDATE message SET text=NULL,attributedBody=?',(b'different',));assert not result()
a.execute('UPDATE message SET attributedBody=?',(b'',));assert not result()
a.execute('UPDATE message SET attributedBody=NULL');assert not result()
a.execute('UPDATE message SET attributedBody=?',(b'exact-attributed',));b.execute('UPDATE message SET text=?',('wrong',));assert not result()
b.execute('UPDATE message SET text=?',(marker,));b.execute('DELETE FROM message');assert not result()
b.execute('INSERT INTO message VALUES(?,?,?,?,?,?,?)',(guid,0,'iMessage',marker,sender,1,b'exact-attributed'));assert result()
a.execute('INSERT INTO chat_message_join VALUES(1,1)');assert not result()
a.execute('DELETE FROM chat_message_join WHERE rowid=2');a.execute('UPDATE message SET attributedBody=?',(b'x'*1048577,));b.execute('UPDATE message SET attributedBody=?',(b'x'*1048577,));assert not result()
a.close();b.close();print('offline-exact-attributed-pair-pass')
`;
 const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'offline-exact-attributed-pair-pass\n',err:''});
});

test('fixed Sendblue whitespace case preserves exact slash Unicode CRLF bytes and rejects plan tampering',async()=>{
 const f=fixture();try{const files=f.plan.files,plain=prepareProviderTextPlan(files.manifest.path,files.installation.path,files.prior.path,'sendblue',f.plan.run),fidelity=prepareProviderTextPlan(files.manifest.path,files.installation.path,files.prior.path,'sendblue',f.plan.run,'edge-spaces-crlf-v1');
 expect(plain.marker).toBe(`CHERT-M4D-STRICT-TEXT-${f.plan.run}-sendblue`);expect(plain).not.toHaveProperty('text_case');expect(fidelity.text_case).toBe('edge-spaces-crlf-v1');expect(fidelity.marker).toBe(`  CHERT-M4D-PLAINTEXT-FIDELITY-${f.plan.run}-sendblue / Café 🌅\r\n  `);
 writeFileSync(f.path,JSON.stringify(fidelity));expect(loadTextPlan(f.path)).toEqual(fidelity);
 for(const changed of [{...fidelity,text_case:'other'},{...fidelity,marker:fidelity.marker.trim()},{...fidelity,marker:fidelity.marker.replace('\r\n','\n')},{...fidelity,marker:fidelity.marker.normalize('NFD')}]){writeFileSync(f.path,JSON.stringify(changed));expect(()=>loadTextPlan(f.path)).toThrow();}
 expect(()=>prepareProviderTextPlan(files.manifest.path,files.installation.path,files.prior.path,'sendblue',f.plan.run,null)).toThrow();expect(existsSync(f.journal+'.spent')).toBe(false);
 }finally{f.cleanup();}
});
test.each([false,true])('fidelity gateway uses Foundation-compatible learned fingerprint; raw-JSON ACK rejected=%s',async badACK=>{
 const{ textOperationFingerprint }=await import('../../imessage-server/lib/sending/text-operation-fingerprint.ts');const f=fixture();const files=f.plan.files;f.plan=prepareProviderTextPlan(files.manifest.path,files.installation.path,files.prior.path,'sendblue',f.plan.run,'edge-spaces-crlf-v1');f.journal=f.plan.receipt_path;let effects=0,reads=0;
 const gateway=await createTextGateway(f.plan,f.journal,f.identity,async()=>{reads++;},async p=>{if(['preflight','identity'].includes(p.action)){if(p.claim){expect(p.claim.fingerprint).toBe(textOperationFingerprint(f.sender,f.recipient,f.plan.marker));expect(p.claim.fingerprint).not.toBe(hash(JSON.stringify(['chert-text-once-v1',f.sender,f.recipient,f.plan.marker])));}return f.identity;}effects++;expect(p.body.text).toBe(f.plan.marker);expect(JSON.parse(p.raw).text).toBe(f.plan.marker);expect(existsSync(f.journal+'.spent')).toBe(true);return{status:202,body:{origin:p.body.origin,from:p.body.from,to:p.body.to,fingerprint:badACK?hash(JSON.stringify(['chert-text-once-v1',p.body.from,p.body.to,p.body.text])):textOperationFingerprint(p.body.from,p.body.to,p.body.text),preparedGuid:f.guid,state:'acknowledged'}};});
 try{for(const text of [f.plan.marker.trim(),f.plan.marker.replace('\r\n','\n'),f.plan.marker.normalize('NFD')])expect((await request(gateway,{...learnedBody(f),text})).status).toBe(502);expect(reads).toBe(0);expect(effects).toBe(0);expect((await request(gateway,learnedBody(f))).status).toBe(badACK?502:202);expect(effects).toBe(1);expect((await request(gateway,learnedBody(f))).status).toBe(502);expect(effects).toBe(1);}finally{await gateway.close();f.cleanup();}
});
test('actual Python claim validator agrees on slash CRLF and Unicode Foundation fingerprint',async()=>{
 const{REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs'),{textOperationFingerprint}=await import('../../imessage-server/lib/sending/text-operation-fingerprint.ts');const start=REMOTE_TEXT_PROGRAM.indexOf('def claim_origin():'),end=REMOTE_TEXT_PROGRAM.indexOf('\ntry:\n before=identity()',start),sender='+15550000001',recipient='+15550000002',plan={version:2,provider:'sendblue',run:randomUUID(),marker:'  CHERT-FIDELITY / Café 🌅\r\n  '},claim={provider:plan.provider,run:plan.run,public_message_id:'1'.repeat(32),origin:'text_'+'1'.repeat(32),fingerprint:textOperationFingerprint(sender,recipient,plan.marker),body_sha256:'a'.repeat(64),plan_sha256:hash(JSON.stringify(plan))};
 const payload=Buffer.from(JSON.stringify({plan,claim,sender,recipient})).toString('base64'),program=`import json,re,hashlib,base64\nv=json.loads(base64.b64decode('${payload}'));plan=v['plan'];sender=v['sender'];recipient=v['recipient'];p={'claim':v['claim']}\ndef sha(v):return hashlib.sha256(v).hexdigest()\ndef check(v):assert v\n${REMOTE_TEXT_PROGRAM.slice(start,end)}\nassert claim_origin()==v['claim']['origin']\nprint('passed')\n`;const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'passed\n',err:''});
});

test('unified manifest selects only fixed worker artifact while preserving installation binding',()=>{
 const f=fixture();try{
  const mp=f.plan.files.manifest.path,ip=f.plan.files.installation.path;
  const manifest=JSON.parse(readFileSync(mp));manifest.serving_entry='unified-messages-v1';manifest.artifacts['chert-worker']=manifest.artifacts['mac-server'];delete manifest.artifacts['mac-server'];
  const rebuild=()=>{writeFileSync(mp,JSON.stringify(manifest));const binding=JSON.parse(readFileSync(ip));binding.candidate_manifest_sha256=hash(readFileSync(mp));writeFileSync(ip,JSON.stringify(binding));return prepareTextPlan(mp,ip,f.plan.files.prior.path,f.plan.run);};
  const plan=rebuild();expect(plan.service).toEqual({filename:'chert-worker',entry:'unified-messages-v1'});expect(Object.keys(plan.bindings).sort()).toEqual(Object.keys(f.plan.bindings).sort());expect(plan.bindings).toEqual({...f.plan.bindings,candidate_manifest_sha256:hash(readFileSync(mp))});writeFileSync(f.path,JSON.stringify(plan));expect(loadTextPlan(f.path)).toEqual(plan);
  manifest.serving_entry='unknown';expect(rebuild).toThrow();manifest.serving_entry='unified-messages-v1';manifest.artifacts['mac-server']=manifest.artifacts['chert-worker'];expect(rebuild).toThrow();delete manifest.artifacts['mac-server'];manifest.artifacts['chert-worker'].sha256='e'.repeat(64);expect(rebuild).toThrow();delete manifest.artifacts['chert-worker'];expect(rebuild).toThrow();expect(existsSync(f.journal+'.spent')).toBe(false);
 }finally{f.cleanup();}
});

test('actual remote service guard rejects wrong fixed path argv hash and entry offline',async()=>{
 const {REMOTE_TEXT_PROGRAM}=await import('./m4d-live-text-acceptance.mjs');const start=REMOTE_TEXT_PROGRAM.indexOf('def service_process('),end=REMOTE_TEXT_PROGRAM.indexOf('\ndef identity():',start);expect(start).toBeGreaterThan(0);
 const program=`def check(v):assert v
base='/Users/chert/bridge-upgrades/approved-1.9.0/mac-server'
plan={'service':{'filename':'chert-worker','entry':'unified-messages-v1'}}
B={'service_sha256':'a'*64}
${REMOTE_TEXT_PROGRAM.slice(start,end)}
path=base+'/build/chert-worker';argv=[path,'messages','serve','--config-dir',base]
service_process(path,argv,'a'*64)
for badpath,badargv,badhash in [(base+'/build/mac-server',argv,'a'*64),(path,argv+['extra'],'a'*64),(path,[path,'messages','serve','--config-dir','/tmp'],'a'*64),(path,argv,'b'*64),('/tmp/chert-worker',argv,'a'*64)]:
 try:service_process(badpath,badargv,badhash);raise RuntimeError('accepted')
 except AssertionError:pass
for service in [{'filename':'mac-server','entry':'unified-messages-v1'},{'filename':'chert-worker','entry':'other'}]:
 plan['service']=service
 try:service_process(path,argv,'a'*64);raise RuntimeError('accepted')
 except AssertionError:pass
plan={};service_process(base+'/build/mac-server',['./build/mac-server'],'a'*64)
print('passed')
`;
 const child=Bun.spawn(['python3','-c',program],{stdout:'pipe',stderr:'pipe'});const[code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect({code,out,err}).toEqual({code:0,out:'passed\n',err:''});
});
