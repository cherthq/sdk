// Source candidate. Importing this module performs no SSH, install or native action.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {openSync,closeSync,fstatSync,readFileSync,writeSync,fsyncSync,lstatSync,constants,renameSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
const root=resolve(import.meta.dirname,'../..');
const sha=v=>createHash('sha256').update(v).digest('hex');
const digest=/^[a-f0-9]{64}(?![\s\S])/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const phone=/^\+[1-9][0-9]{1,14}(?![\s\S])/;
export const FIXTURE_TENANT='11000000-0000-4000-8000-000000000001';
export const FIXTURE_LEAD='41000000-0000-4000-8000-000000000001';
export const FIXTURE_LINE='61000000-0000-4000-8000-000000000001';
export const REVIEWED_FILES=['sdk/package.json','sdk/bun.lock','sdk/packages/imessage/package.json','sdk/packages/blooio-adapter/package.json','sdk/scripts/m4d-live-text-acceptance.mjs','sdk/tests/strict-text-live-postgrest.fixture.mjs','scripts/test-attachment-native-postgrest.sh','imessage-server/tests/attachment-postgrest.sql','sdk/tests/strict-text-postgrest.sql','imessage-server/app/api/v1/text-operations/v1/route.ts','imessage-server/lib/messaging/auth.ts','imessage-server/lib/api-shape/auth-bridge.ts','imessage-server/lib/api-shape/envelope.ts','imessage-server/lib/messaging/lead-resolve.ts','imessage-server/lib/messaging/line-select.ts','imessage-server/lib/messaging/strict-text-lead.ts','imessage-server/lib/api-shape/phone-normalize.ts','imessage-server/lib/sending/text-operation.ts','imessage-server/lib/sending/text-operation-fingerprint.ts','imessage-server/lib/sending/text-operation-context.ts','imessage-server/lib/sending/native-json.ts','sdk/packages/blooio-adapter/index.ts','sdk/packages/imessage/src/index.ts','sdk/packages/imessage/dist/index.js'];
function file(path,privateOnly=true){assert.ok(typeof path==='string'&&path.startsWith('/'));const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid()&&s.size<=1048576&&(!privateOnly||(s.mode&0o777)===0o600));const bytes=readFileSync(fd);return{value:JSON.parse(bytes),sha256:sha(bytes),path:realpathSync(path)};}finally{closeSync(fd);}}
function privateParent(path){const s=lstatSync(dirname(path));assert.ok(s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700);}
const providerFiles={blooio:['sdk/packages/blooio-adapter/index.ts'],linq:['sdk/packages/linq-adapter/src/index.ts','sdk/packages/linq-adapter/src/history.ts','sdk/packages/linq-adapter/src/media.ts','sdk/packages/linq-adapter/src/attachments.ts','imessage-server/app/api/v1/chats/[id]/messages/route.ts'],sendblue:['sdk/packages/sendblue-adapter/index.ts','sdk/packages/sendblue-adapter/reactions.ts','imessage-server/app/api/v1/chats/route.ts'],'blooio-v4':['sdk/packages/blooio-v4-adapter/index.ts','imessage-server/app/api/v1/chats/[id]/messages/route.ts'],loopmessage:['sdk/packages/loopmessage-adapter/index.ts']};
function sourceManifest(provider='blooio'){const paths=provider==='blooio'?REVIEWED_FILES:[...REVIEWED_FILES.filter(path=>!['sdk/packages/blooio-adapter/index.ts','sdk/packages/blooio-adapter/package.json'].includes(path)),`sdk/packages/${provider}-adapter/package.json`,...providerFiles[provider]];return paths.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}));}

/** An explicit future installation receipt is required; a candidate package alone never authorizes a send. */
export function prepareTextPlan(manifestPath,installationPath,priorPath,run=randomUUID()){
 assert.match(run,uuid);const manifest=file(manifestPath,false),installed=file(installationPath),prior=file(priorPath);
 assert.equal(manifest.value.kind,'local-native-candidate-not-installed');assert.equal(manifest.value.inputs_unchanged_after_build,true);
 const unified=manifest.value.serving_entry==='unified-messages-v1';
 assert.ok(manifest.value.serving_entry===undefined||unified,'Unsupported native serving entry');
 const filename=unified?'chert-worker':'mac-server';
 assert.ok(!Object.hasOwn(manifest.value.artifacts??{},unified?'mac-server':'chert-worker'),'Ambiguous native service artifact');
 const server=manifest.value.artifacts?.[filename]?.sha256,helper=manifest.value.artifacts?.['chert-imsg-bridge.dylib']?.sha256;assert.match(server,digest);assert.match(helper,digest);
 const binding=installed.value;assert.equal(binding.kind,'reviewed-native-installation');assert.equal(binding.host,'chert-m4d');assert.equal(binding.candidate_manifest_sha256,manifest.sha256);assert.equal(binding.service_sha256,server);assert.equal(binding.helper_sha256,helper);
 for(const key of ['sender_sha256','recipient_sha256','account_login_sha256','approved_chat_guid_sha256'])assert.match(binding[key],digest);
 for(const key of ['server_pid','messages_pid'])assert.ok(Number.isSafeInteger(binding[key])&&binding[key]>0);
 assert.equal(prior.value.attempted,true);assert.equal(prior.value.passed,true);assert.equal(prior.value.environment,'reviewed-live');assert.equal(prior.value.native?.guid,prior.value.recipient?.guid);assert.match(prior.value.native?.guid,/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/);
 privateParent(installed.path);
 const key='strict-live:'+run,id=sha(JSON.stringify(['chert-text-idempotency-v1',FIXTURE_TENANT,key])).slice(0,32);
 return{version:1,receipt_path:resolve(dirname(installed.path),run+'.receipt.json'),plan:'one-reviewed-strict-text-v1',host:'chert-m4d',run,provider:'blooio',marker:`CHERT-M4D-STRICT-TEXT-${run}-blooio`,idempotency_key:key,public_message_id:id,origin:'text_'+id,approved_guid:prior.value.native.guid,
  ...(unified?{service:{filename:'chert-worker',entry:'unified-messages-v1'}}:{}),
  files:{manifest:{path:manifest.path,sha256:manifest.sha256},installation:{path:installed.path,sha256:installed.sha256},prior:{path:prior.path,sha256:prior.sha256}},bindings:binding,reviewed_files:sourceManifest(),attempted:false};
}
/** Version 2 fixes provider/peer/marker, but learns the real reserved ID before admission. */
export function prepareProviderTextPlan(manifestPath,installationPath,priorPath,provider,run=randomUUID(),textCase){
 assert.ok(typeof provider==='string'&&Object.hasOwn(providerFiles,provider),'One supported provider required');
 assert.ok(textCase===undefined||textCase==='edge-spaces-crlf-v1','One fixed reviewed text case required');
 const {origin,public_message_id,idempotency_key,...base}=prepareTextPlan(manifestPath,installationPath,priorPath,run);
 return{...base,version:2,plan:'one-reviewed-provider-strict-text-v2',provider,...(textCase===undefined?{}:{text_case:textCase}),marker:textCase===undefined?`CHERT-M4D-STRICT-TEXT-${run}-${provider}`:`  CHERT-M4D-PLAINTEXT-FIDELITY-${run}-${provider} / Café 🌅\r\n  `,reviewed_files:sourceManifest(provider)};
}
export function loadTextPlan(path){const plan=file(path).value;const args=[plan.files.manifest.path,plan.files.installation.path,plan.files.prior.path];const rebuilt=plan.version===2?prepareProviderTextPlan(...args,plan.provider,plan.run,plan.text_case):prepareTextPlan(...args,plan.run);assert.deepEqual(plan,rebuilt,'reviewed text plan changed');return plan;}

function persist(path,value,create=false){privateParent(path);const fd=openSync(create?path:path+'.next',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{const bytes=Buffer.from(JSON.stringify(value));let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}finally{closeSync(fd);}if(!create)renameSync(path+'.next',path);const parent=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}}
function matchesIdentity(value,plan){assert.equal(value.ready,true);assert.equal(value.service_sha256,plan.bindings.service_sha256);assert.equal(value.helper_sha256,plan.bindings.helper_sha256);assert.equal(value.server_pid,plan.bindings.server_pid);assert.equal(value.messages_pid,plan.bindings.messages_pid);assert.match(value.sender,phone);assert.match(value.recipient,phone);assert.notEqual(value.sender,value.recipient);assert.equal(sha(value.sender),plan.bindings.sender_sha256);assert.equal(sha(value.recipient),plan.bindings.recipient_sha256);}
function ack(value,body){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='fingerprint,from,origin,preparedGuid,state,to'&&value.origin===body.origin&&value.from===body.from&&value.to===body.to&&value.state==='acknowledged'&&typeof value.fingerprint==='string'&&digest.test(value.fingerprint)&&value.fingerprint===textOperationFingerprint(body.from,body.to,body.text)&&typeof value.preparedGuid==='string'&&/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/.test(value.preparedGuid);}
/** Injected executor in tests; production start supplies the fixed-host SSH executor. */
export async function createTextGateway(plan,journalPath,identity,verifyReservation,execute){
 matchesIdentity(identity,plan);assert.equal(typeof verifyReservation,'function');privateParent(journalPath);persist(journalPath,{run:plan.run,plan_sha256:sha(JSON.stringify(plan)),attempted:false,passed:false},true);
 const apiKey=randomBytes(32).toString('hex'),signingSecret=randomBytes(32).toString('hex');let spent=false,receipt=file(journalPath).value;
 const save=update=>{receipt={...receipt,...update};persist(journalPath,receipt);};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  try{
   const url=new URL(request.url);assert.equal(url.pathname,'/api/v1/text-operations/v1');assert.equal(url.search,'');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer '+apiKey);
   const reader=request.body?.getReader();assert.ok(reader);const chunks=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768){await reader.cancel();throw Error('Body limit');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}const raw=Buffer.concat(chunks).toString('utf8');const sig=/^v1,([0-9]+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig);assert.ok(Math.abs(Date.now()/1000-Number(sig[1]))<=300);const expected=createHmac('sha256',signingSecret).update(`${sig[1]}.${raw}`).digest();assert.ok(timingSafeEqual(expected,Buffer.from(sig[2],'hex')));
   const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);if(plan.version===2)assert.match(body.origin,/^text_[a-f0-9]{32}(?![\s\S])/);else assert.equal(body.origin,plan.origin);assert.equal(body.from,identity.sender);assert.equal(body.to,identity.recipient);assert.equal(body.text,plan.marker);
   assert.equal(spent,false);
   const learned=plan.version===2?{provider:plan.provider,run:plan.run,public_message_id:body.origin.slice(5),origin:body.origin,fingerprint:textOperationFingerprint(body.from,body.to,body.text),body_sha256:sha(raw),plan_sha256:sha(JSON.stringify(plan))}:null;
   const publicId=learned?.public_message_id??plan.public_message_id;
   if(learned)await verifyReservation({publicId,body});
   matchesIdentity(await execute({action:'preflight',plan,...(learned?{claim:learned}:{})}),plan);
   // Last asynchronous boundary before the durable one-use claim rereads actual DB ownership.
   await verifyReservation({publicId,body});
   // Recheck after async verification; concurrent requests cannot share a claim.
   assert.equal(spent,false);const claim=openSync(journalPath+'.spent',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeSync(claim,JSON.stringify({run:plan.run,public_message_id:publicId,...(learned?{learned_claim:learned}:{})}));fsyncSync(claim);}finally{closeSync(claim);}const directory=openSync(dirname(journalPath),constants.O_RDONLY);try{fsyncSync(directory);}finally{closeSync(directory);}spent=true;save({attempted:true,public_message_id:publicId,...(learned?{learned_claim:learned}:{}),outcome:'spent-before-SSH'});
   let result;try{result=await execute({action:'send',plan,body,raw,...(learned?{claim:learned}:{})});}catch{save({outcome:'unknown-no-resend'});return Response.json({error:{code:4103,retryable:false,message:'Text outcome unconfirmed; do not resend'}},{status:502});}
   if(result?.status!==202||!ack(result.body,body)){save({outcome:'unknown-no-resend'});return Response.json({error:{code:4103,retryable:false,message:'Text outcome unconfirmed; do not resend'}},{status:502});}
   // Actual HTTP acknowledgement is returned verbatim; never synthesize sent/delivered.
   save({native_guid:result.body.preparedGuid,native_fingerprint:result.body.fingerprint,native_http_status:202,outcome:'native-acknowledged'});return Response.json(result.body,{status:202});
  }catch{return Response.json({error:{code:4103,retryable:false,message:'Strict text acceptance refused; reconcile before retrying'}},{status:502});}
 }});
 return{nativeOrigin:server.url.origin,apiKey,signingSecret,sender:identity.sender,recipient:identity.recipient,async observe(guid){assert.equal(spent,true);assert.equal(guid,receipt.native_guid);const result=await execute({action:'observe',plan,guid});matchesIdentity(await execute({action:'identity',plan}),plan);assert.equal(result.complete,true);assert.equal(result.guid,guid);assert.equal(result.sender_exact,true);assert.equal(result.recipient_exact,true);assert.equal(result.service,'iMessage');save({passed:true,outcome:'exact-guid-sender-recipient-imessage-confirmed',evidence:{complete:true,guid:result.guid,sender_exact:true,recipient_exact:true,service:'iMessage'}});return{passed:true,receiptPath:journalPath,receiptSha256:sha(readFileSync(journalPath))};},close:()=>server.stop(true)};
}

// Fixed host/configs and actual native HTTP only. No bridge RPC, install, restart, readiness launch or fallback.
export const REMOTE_TEXT_PROGRAM=String.raw`
import sys,json,base64,os,re,hashlib,hmac,time,subprocess,sqlite3,ctypes,urllib.request,urllib.error,urllib.parse
p=json.loads(base64.b64decode('PAYLOAD'));plan=p['plan'];B=plan['bindings'];action=p['action']
def check(v):
 if not v:raise RuntimeError('strict acceptance refused')
def sha(v):return hashlib.sha256(v).hexdigest()
def cfg(path):
 out={}
 for line in open(path):
  if line.strip() and not line.lstrip().startswith('#') and '=' in line:
   k,v=line.strip().split('=',1);out[k.strip()]=v.strip().strip('"').strip("'")
 return out
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
a=cfg('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env');b=cfg('/Users/meganavery/imessage-server/mac-server/.env');sender=a.get('PHONE_NUMBER','');recipient=b.get('PHONE_NUMBER','')
def request(path,body=None):
 headers={'Authorization':'Bearer '+a['API_KEY']}
 if body is not None or path.startswith('/api/v1/'):
  ts=str(int(time.time()));secret=a.get('LINE_SIGNING_SECRET') or a['API_KEY'];headers.update({'Content-Type':'application/json','x-chert-signature':'v1,'+ts+','+hmac.new(secret.encode(),ts.encode()+b'.'+(body if body is not None else b''),hashlib.sha256).hexdigest()})
 req=urllib.request.Request('http://127.0.0.1:4010'+path,data=body,headers=headers,method='POST' if body is not None else 'GET')
 try:r=opener.open(req,timeout=65 if body is not None else 5)
 except urllib.error.HTTPError as e:r=e
 with r:
  raw=r.read(16385);check(len(raw)<=16384);return {'status':r.status,'body':json.loads(raw)}
def pidpath(pid):
 lib=ctypes.CDLL('/usr/lib/libproc.dylib');buf=ctypes.create_string_buffer(4096);check(lib.proc_pidpath(pid,buf,len(buf))>0);return buf.value.decode()
def service_process(path,argv,actual_sha):
 base='/Users/chert/bridge-upgrades/approved-1.9.0/mac-server'
 service=plan.get('service')
 if service is None:
  check(path==base+'/build/mac-server')
  check(argv in [[base+'/build/mac-server'],['./build/mac-server']])
 else:
  check(service=={'filename':'chert-worker','entry':'unified-messages-v1'})
  check(path==base+'/build/chert-worker')
  check(argv==[path,'messages','serve','--config-dir',base])
 check(actual_sha==B['service_sha256'])
def identity():
 check(a.get('PORT','4010')=='4010' and sha(sender.encode())==B['sender_sha256'] and sha(recipient.encode())==B['recipient_sha256'])
 ids=set(subprocess.check_output(['/usr/sbin/lsof','-nP','-t','-iTCP:4010','-sTCP:LISTEN'],timeout=5).decode().split());check(ids=={str(B['server_pid'])});service_path=pidpath(B['server_pid']);argv=__import__('shlex').split(subprocess.check_output(['/bin/ps','-p',str(B['server_pid']),'-o','command='],timeout=5).decode().strip());service_process(service_path,argv,sha(open(service_path,'rb').read()))
 check(os.path.basename(pidpath(B['messages_pid']))=='Messages')
 paths=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(B['messages_pid']),'-Fn'],timeout=5).decode().splitlines();loaded={v[1:] for v in paths if v.startswith('n') and v.endswith('/chert-imsg-bridge.dylib')};check(len(loaded)==1);check(sha(open(next(iter(loaded)),'rb').read())==B['helper_sha256'])
 status=request('/status')['body'];check(status.get('sender')=='bridge' and status.get('phoneNumber')==sender)
 db=sqlite3.connect('file:/Users/chert/Library/Messages/chat.db?mode=ro',uri=True);db.execute('PRAGMA query_only=ON')
 try:
  rows=db.execute('SELECT c.guid,c.chat_identifier,c.account_login,m.destination_caller_id,m.service,m.is_from_me FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid=? LIMIT 2',(plan['approved_guid'],)).fetchall();check(len(rows)==1);r=rows[0];check(r[1]==recipient and r[3]==sender and r[4]=='iMessage' and r[5]==1 and sha(r[0].encode())==B['approved_chat_guid_sha256'] and sha(r[2].encode())==B['account_login_sha256'])
 finally:db.close()
 return {'ready':True,'sender':sender,'recipient':recipient,'server_pid':B['server_pid'],'messages_pid':B['messages_pid'],'service_sha256':B['service_sha256'],'helper_sha256':B['helper_sha256']}
def claim_origin():
 if plan.get('version')!=2:return plan['origin']
 c=p.get('claim');check(isinstance(c,dict) and set(c)=={'provider','run','public_message_id','origin','fingerprint','body_sha256','plan_sha256'})
 check(c['provider']==plan['provider'] and c['run']==plan['run'] and re.fullmatch(r'[a-f0-9]{32}',c['public_message_id']) and c['origin']=='text_'+c['public_message_id'])
 check(c['plan_sha256']==sha(json.dumps(plan,separators=(',',':'),ensure_ascii=False).encode()) and re.fullmatch(r'[a-f0-9]{64}',c['body_sha256']))
 expected=json.dumps(['chert-text-once-v1',sender,recipient,plan['marker']],separators=(',',':'),ensure_ascii=False).replace('/','\\/')
 check(c['fingerprint']==sha(expected.encode()));return c['origin']
def observed_rows(db,guid):
 return db.execute('SELECT m.guid,m.is_from_me,m.service,m.text,m.destination_caller_id,h.id,c.chat_identifier,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID),m.attributedBody FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
def exact_observed_pair(rows,guid,marker,sender,recipient):
 if len(rows)!=2 or any(len(group)!=1 for group in rows):return False
 outgoing,incoming=rows[0][0],rows[1][0]
 for row,is_incoming,peer in [(outgoing,False,recipient),(incoming,True,sender)]:
  if not (row[0]==guid and row[1]==int(not is_incoming) and row[2]=='iMessage' and row[6]==peer and row[7]==1 and (row[5]==peer if is_incoming else row[4]==sender)):return False
 if incoming[3]!=marker:return False
 if outgoing[3]==marker:return True
 # Only a genuinely NULL sender plaintext can use the exact recipient's blob.
 # Do not decode, trim, scan or accept a conflicting non-NULL plaintext.
 a,b=outgoing[8],incoming[8]
 return outgoing[3] is None and isinstance(a,bytes) and isinstance(b,bytes) and 0<len(a)<=1048576 and len(a)==len(b) and a==b

try:
 before=identity()
 if action=='preflight':
  origin=claim_origin();missing=request('/api/v1/text-operations/v1/'+origin+'?from='+urllib.parse.quote(sender,safe=''));check(missing['status']==404 and missing['body']=={'origin':origin,'found':False});out=before
 elif action=='identity':out=before
 elif action=='send':
  body=p['body'];check(set(body)=={'origin','from','to','text'} and body['origin']==claim_origin() and body['from']==sender and body['to']==recipient and body['text']==plan['marker']);raw=p['raw'].encode();check(json.loads(raw)==body);check(plan.get('version')!=2 or sha(raw)==p['claim']['body_sha256']);out=request('/api/v1/text-operations/v1',raw);check(identity()==before)
 elif action=='observe':
  guid=p['guid'];check(re.fullmatch(r'[a-fA-F0-9-]{36}',guid));end=time.monotonic()+40;found=False
  while time.monotonic()<end:
   seen=[]
   for home,incoming,peer in [('/Users/chert',0,recipient),('/Users/meganavery',1,sender)]:
    db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
    try:
     seen.append(observed_rows(db,guid))
    finally:db.close()
   if exact_observed_pair(seen,guid,plan['marker'],sender,recipient):found=True;break
   time.sleep(.5)
  check(identity()==before);out={'complete':found,'guid':guid,'sender_exact':found,'recipient_exact':found,'service':'iMessage'}
 else:raise RuntimeError('unsupported action')
except Exception:out={'ready':False,'complete':False,'outcome':'unknown-no-resend'}
print(json.dumps(out))
`;
async function remoteText(payload){return new Promise((yes,no)=>{const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','chert-m4d','sudo','-n','python3','-'],{stdio:['pipe','pipe','pipe']});let out='',bytes=0;const timer=setTimeout(()=>child.kill(),payload.action==='send'?80000:60000);child.stdout.on('data',b=>{bytes+=b.length;if(bytes>65536)child.kill();else out+=b;});child.stderr.on('data',b=>{bytes+=b.length;if(bytes>65536)child.kill();});child.on('error',()=>{clearTimeout(timer);no(Error('Strict text remote outcome unavailable; never resend'));});child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);yes(JSON.parse(out));}catch{no(Error('Strict text remote outcome unavailable; never resend'));}});child.stdin.end(REMOTE_TEXT_PROGRAM.replace('PAYLOAD',Buffer.from(JSON.stringify(payload)).toString('base64')));});}
export async function startReviewedTextBroker(planPath,journalPath,flag,verifyReservation,provider){const plan=loadTextPlan(planPath);if(plan.version===1)assert.equal(flag,'--live-one-text');else{assert.equal(flag,'--live-one-text-provider');assert.equal(provider,plan.provider,'Provider selection must match plan');}const expectedJournal=plan.receipt_path;assert.equal(resolve(realpathSync(dirname(journalPath)),basename(journalPath)),expectedJournal,'Claim path must be bound to the reviewed plan');journalPath=expectedJournal;privateParent(journalPath);assert.equal(existsSync(journalPath),false,'Existing receipt: reconcile, never resend');assert.equal(existsSync(journalPath+'.spent'),false,'Spent plan: never resend');const identity=await remoteText({action:plan.version===2?'identity':'preflight',plan});matchesIdentity(identity,plan);return{plan,...await createTextGateway(plan,journalPath,identity,verifyReservation,remoteText)};}
