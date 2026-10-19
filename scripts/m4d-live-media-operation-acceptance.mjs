// Explicit, reviewed one-PNG acceptance only. Importing this module has no effects.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,writeSync,fsyncSync,renameSync,existsSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {prepareTextPlan,REMOTE_TEXT_PROGRAM} from './m4d-live-text-acceptance.mjs';
import {PNG,REMOTE_PROGRAM as MEDIA_OBSERVER} from './m4d-live-media-acceptance.mjs';
const root=resolve(import.meta.dirname,'../..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=/^[a-f0-9]{64}(?![\s\S])/;
const uuid=/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/;
const phone=/^\+[1-9][0-9]{1,14}(?![\s\S])/;
const mediaFiles=['sdk/scripts/m4d-live-media-operation-acceptance.mjs','sdk/scripts/m4d-live-media-acceptance.mjs','sdk/scripts/m4d-live-text-acceptance.mjs','sdk/tests/attachment-postgrest.fixture.mjs','scripts/test-attachment-native-postgrest.sh','imessage-server/app/api/v1/chats/[id]/messages/route.ts','imessage-server/lib/supabase-storage.ts','imessage-server/lib/messaging/media-response.ts','imessage-server/lib/messaging/attachment-download.ts','imessage-server/lib/sending/attachment-operation.ts','imessage-server/lib/sending/native-json.ts','sdk/packages/linq-adapter/src/index.ts','sdk/packages/linq-adapter/src/media.ts','sdk/packages/linq-adapter/src/attachments.ts'];
export const URL_MEDIA_SOURCE=Object.freeze({url:'https://raw.githubusercontent.com/github/explore/main/topics/rust/rust.png',filename:'rust.png',content_type:'image/png',bytes:12746,sha256:'cf78cef9ba96a43bda7254c0ffb10b9faffd075997ca6b7bd89df1c64e3c5605'});
const urlMediaFiles=['sdk/tests/external-media-import-postgrest.fixture.mjs','sdk/tests/external-media-import-postgrest.test.ts','imessage-server/app/api/v1/attachments/import/route.ts','imessage-server/lib/messaging/external-media.ts','imessage-server/lib/api-shape/filename.ts','imessage-server/lib/api-shape/attachments.ts','imessage-server/lib/messaging/auth.ts','imessage-server/lib/api-shape/auth-bridge.ts','imessage-server/app/api/v1/chats/route.ts','imessage-server/lib/sending/reserved-attachment-operation.ts','sdk/packages/sendblue-adapter/index.ts','sdk/packages/imessage/src/index.ts','sdk/packages/imessage/src/media.ts'];
function mediaTuple(plan){if((plan?.version===2||plan?.version===3)){assert.deepEqual(plan.media_source,URL_MEDIA_SOURCE);assert.equal(plan.png_bytes,URL_MEDIA_SOURCE.bytes);assert.equal(plan.png_sha256,URL_MEDIA_SOURCE.sha256);return URL_MEDIA_SOURCE;}return{filename:'reviewed.png',bytes:PNG.length,sha256:sha(PNG)};}
function privateFile(path){
 assert.ok(typeof path==='string'&&path.startsWith('/'));
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.size<=1048576);const bytes=readFileSync(fd);return{value:JSON.parse(bytes),sha256:sha(bytes),path:realpathSync(path)};}finally{closeSync(fd);}
}
function privateParent(path){const s=lstatSync(dirname(path));assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700);}
function persist(path,value,create=false){
 privateParent(path);const temporary=create?path:path+'.next-'+randomUUID();
 const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{const bytes=Buffer.from(JSON.stringify(value));for(let n=0;n<bytes.length;)n+=writeSync(fd,bytes,n,bytes.length-n);fsyncSync(fd);}finally{closeSync(fd);}
 if(!create)renameSync(temporary,path);
 const parent=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}
}
export function requiredHarnessSources(){
 const prefix='imessage-server/mac-server/',make=readFileSync(resolve(root,prefix,'Makefile'),'utf8');
 const sources=/^ISOLATED_ATTACHMENT_SOURCES := (.+)$/m.exec(make);assert.ok(sources);
 const headers=['http','attachments','bridge'].flatMap(dir=>readdirSync(resolve(root,prefix,'src',dir)).filter(name=>name.endsWith('.h')).map(name=>`src/${dir}/${name}`));
 return [...new Set(['Makefile',...sources[1].split(/\s+/),...headers,'src/send/AttachmentOperationStage.h','src/send/AttachmentFingerprint.h','src/send/BridgeAttachmentOnceDispatch.h','src/helper/BridgeHelperLocator.h','src/helper/LaunchReadinessTimeout.h','src/helper/MessagesLauncherError.h'])].map(path=>prefix+path).sort();
}
export function prepareOperationLivePlan(manifestPath,installationPath,priorPath,harnessPath,run=randomUUID()){
 const base=prepareTextPlan(manifestPath,installationPath,priorPath,run),harness=privateFile(harnessPath),h=harness.value;
 assert.deepEqual(Object.keys(h).sort(),['host','kind','local_artifact','remote_artifact','sources','verified_stage']);
 assert.equal(h.kind,'reviewed-isolated-attachment-harness');assert.equal(h.host,'chert-m4d');assert.equal(h.verified_stage,true);
 for(const artifact of [h.local_artifact,h.remote_artifact]){assert.deepEqual(Object.keys(artifact).sort(),['path','sha256']);assert.ok(typeof artifact.path==='string'&&artifact.path.startsWith('/')&&!/[\r\n\0]/.test(artifact.path));assert.match(artifact.sha256,digest);}
 assert.equal(h.local_artifact.sha256,h.remote_artifact.sha256);assert.equal(sha(readFileSync(h.local_artifact.path)),h.local_artifact.sha256);
 assert.deepEqual(h.sources.map(item=>item.path).sort(),requiredHarnessSources());
 for(const item of h.sources){assert.deepEqual(Object.keys(item).sort(),['path','sha256']);assert.match(item.sha256,digest);assert.equal(sha(readFileSync(resolve(root,item.path))),item.sha256);}
 return{version:1,plan:'one-reviewed-isolated-attachment-operation',run,host:'chert-m4d',approved_guid:base.approved_guid,bindings:base.bindings,files:{...base.files,harness:{path:harness.path,sha256:harness.sha256}},harness:h,reviewed_files:[...new Map([...base.reviewed_files,...mediaFiles.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}))].map(item=>[item.path,item])).values()],png_sha256:sha(PNG),png_bytes:PNG.length,attempted:false};
}
function comparatorManifest(path){
 const file=privateFile(path),value=file.value;assert.deepEqual(Object.keys(value).sort(),['binary','height','kind','pixel_format','pixel_sha256','reference','source','width']);assert.equal(value.kind,'reviewed-png-pixel-comparator');assert.equal(value.width,288);assert.equal(value.height,288);assert.equal(value.pixel_format,'srgb-premultiplied-rgba8');assert.equal(value.pixel_sha256,'8a602024918a630553c2ceeb48c5aefd6d9373ab5353a4d73950ce1e25ac8a9b');
 for(const key of ['binary','source','reference']){const item=value[key];assert.deepEqual(Object.keys(item).sort(),['path','sha256']);assert.equal(realpathSync(item.path),item.path);privateParent(item.path);const stat=lstatSync(item.path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===(key==='binary'?0o700:0o600)&&stat.size<=1048576);assert.match(item.sha256,digest);assert.equal(sha(readFileSync(item.path)),item.sha256);}
 assert.equal(value.reference.sha256,URL_MEDIA_SOURCE.sha256);assert.equal(readFileSync(value.reference.path).length,URL_MEDIA_SOURCE.bytes);return{path:file.path,sha256:file.sha256,value};
}
export function prepareURLMediaLivePlan(manifestPath,installationPath,priorPath,harnessPath,run=randomUUID(),pixelManifestPath){
 const base=prepareOperationLivePlan(manifestPath,installationPath,priorPath,harnessPath,run),pixel=comparatorManifest(pixelManifestPath);
 return{...base,version:2,plan:'one-reviewed-sendblue-url-media-operation',provider:'sendblue',receipt_path:resolve(dirname(base.files.installation.path),run+'.url-media.attempt.json'),files:{...base.files,pixel},media_source:{...URL_MEDIA_SOURCE},png_sha256:URL_MEDIA_SOURCE.sha256,png_bytes:URL_MEDIA_SOURCE.bytes,pixel_acceptance:'inline-png-exact-decoded-pixels-byte-gate-recorded-separately',reviewed_files:[...new Map([...base.reviewed_files,...urlMediaFiles.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))}))].map(item=>[item.path,item])).values()]};
}
export function prepareURLCaptionLivePlan(manifestPath,installationPath,priorPath,harnessPath,run=randomUUID(),pixelManifestPath){
 const base=prepareURLMediaLivePlan(manifestPath,installationPath,priorPath,harnessPath,run,pixelManifestPath);
 return {...base,version:3,plan:'one-reviewed-sendblue-url-caption-operation',caption:`  CHERT-URL-CAPTION-${run} / Café 🌅\r\n  `,
  receipt_path:resolve(dirname(base.files.installation.path),run+'.url-caption.attempt.json'),
  reviewed_files:[...base.reviewed_files,{path:'imessage-server/lib/sending/attachment-operation-context.ts',sha256:sha(readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation-context.ts')))}]};
}
function operationFingerprint(body,plan){const media=mediaTuple(plan);return sha(JSON.stringify(plan?.version===3
 ?['chert-captioned-attachment-once-v2',body.from,body.to,media.filename,media.sha256,body.caption]
 :['chert-attachment-once-v1',body.from,body.to,media.filename,media.sha256]).replace(/\//g,'\\/'));}
export function loadOperationLivePlan(path){const plan=privateFile(path).value;const f=plan.files;assert.deepEqual(plan,(plan.version===3?prepareURLCaptionLivePlan:plan.version===2?prepareURLMediaLivePlan:prepareOperationLivePlan)(f.manifest.path,f.installation.path,f.prior.path,f.harness.path,plan.run,f.pixel?.path),'Reviewed operation sources changed');return plan;}
export function compareURLMediaObservation(plan,value){
 const pixel=comparatorManifest(plan.files.pixel.path);assert.deepEqual(pixel,plan.files.pixel);assert.equal(value.complete,true);assert.equal(value.identity_unchanged,true);assert.equal(typeof value.receiver_png_base64,'string');assert.ok(value.receiver_png_base64.length<=1398104);const bytes=Buffer.from(value.receiver_png_base64,'base64');assert.equal(bytes.toString('base64'),value.receiver_png_base64);assert.ok(bytes.length>0&&bytes.length<=1048576);assert.equal(sha(bytes),value.receiver_sha256);
 const result=JSON.parse(execFileSync(pixel.value.binary.path,[],{input:JSON.stringify({left:readFileSync(pixel.value.reference.path).toString('base64'),right:bytes.toString('base64')}),timeout:10000,maxBuffer:16384,encoding:'utf8'}));
 assert.equal(result.left_valid,true);assert.equal(result.right_valid,true);assert.equal(result.source_mutations,0);assert.equal(result.pixel_format,pixel.value.pixel_format);assert.deepEqual(result.left_dimensions,[288,288]);assert.deepEqual(result.right_dimensions,[288,288]);assert.equal(result.left_source_sha256,plan.png_sha256);assert.equal(result.right_source_sha256,value.receiver_sha256);assert.equal(result.left_pixel_sha256,pixel.value.pixel_sha256);assert.equal(result.right_pixel_sha256,pixel.value.pixel_sha256);assert.equal(result.pixels_equal,true);assert.equal(result.bytes_equal,value.receiver_sha256===plan.png_sha256);
 return{original_byte_gate_passed:result.bytes_equal,byte_preserved:result.bytes_equal,pixel_equivalence_passed:true,pixel_format:result.pixel_format,pixel_sha256:result.right_pixel_sha256,source_bytes:plan.png_bytes,recipient_bytes:bytes.length,comparator_sha256:pixel.value.binary.sha256};
}
function origin(value){const u=new URL(value);assert.equal(u.protocol,'http:');assert.equal(u.hostname,'127.0.0.1');assert.ok(u.port&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash);return u;}
function identityMatches(value,plan){assert.equal(value.ready,true);for(const key of ['service_sha256','helper_sha256','server_pid','messages_pid'])assert.equal(value[key],plan.bindings[key]);for(const key of ['sender','recipient']){assert.match(value[key],phone);assert.equal(sha(value[key]),plan.bindings[key+'_sha256']);}assert.notEqual(value.sender,value.recipient);}
export function validateOperationBody(body,identity,attachmentId,plan){const captioned=plan?.version===3;assert.ok(body&&typeof body==='object'&&!Array.isArray(body));assert.deepEqual(Object.keys(body).sort(),captioned?['attachment_id','caption','from','origin','to']:['attachment_id','from','origin','to']);assert.match(body.origin,captioned?/^caption_[a-f0-9]{32}(?![\s\S])/:/^media_[a-f0-9]{32}(?![\s\S])/);assert.equal(body.from,identity.sender);assert.equal(body.to,identity.recipient);assert.equal(body.attachment_id,attachmentId);if(captioned)assert.equal(body.caption,plan.caption);}
export function validOperationACK(value,body,plan){const captioned=plan?.version===3;return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===(captioned?'attachment_id,caption_sha256,fingerprint,from,origin,preparedGuid,state,to':'attachment_id,fingerprint,from,origin,preparedGuid,state,to')&&value.origin===body.origin&&value.from===body.from&&value.to===body.to&&value.attachment_id===body.attachment_id&&value.state==='acknowledged'&&typeof value.preparedGuid==='string'&&uuid.test(value.preparedGuid)&&value.fingerprint===operationFingerprint(body,plan)&&(!captioned||value.caption_sha256===sha(body.caption));}
const prefix=REMOTE_TEXT_PROGRAM.slice(0,REMOTE_TEXT_PROGRAM.indexOf('def claim_origin():'));
assert.ok(prefix.includes('def identity():')&&!prefix.includes("elif action=='send'"));
// Reuse the installed identity predicate verbatim. Only this isolated process is launched/stopped.
export const REMOTE_OPERATION_PROGRAM=prefix+String.raw`
import socket,stat,pwd,signal,tempfile
before=None;out={'ready':False,'stage':'identity'}
def artifact():
 h=plan['harness']['remote_artifact'];fd=os.open(h['path'],os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd);check(stat.S_ISREG(s.st_mode) and s.st_uid==pwd.getpwnam('chert').pw_uid and stat.S_IMODE(s.st_mode)==0o700 and s.st_nlink==1 and sha(os.read(fd,s.st_size+1))==h['sha256'])
 finally:os.close(fd)
 return h['path']
def task_control():
 return os.path.join(os.path.dirname(plan['harness']['remote_artifact']['path']),'run-'+plan['run'])
def save_task(task):
 path=task_control()+'/process.json';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  data=json.dumps(task,separators=(',',':')).encode();offset=0
  while offset<len(data):offset+=os.write(fd,data[offset:])
  os.fchown(fd,pwd.getpwnam('chert').pw_uid,pwd.getpwnam('chert').pw_gid);os.fsync(fd)
 finally:os.close(fd)
 fd=os.open(task_control(),os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
def load_task():
 path=task_control()+'/process.json'
 if not os.path.lexists(task_control()):return None
 directory=os.lstat(task_control());check(stat.S_ISDIR(directory.st_mode) and directory.st_uid==pwd.getpwnam('chert').pw_uid and stat.S_IMODE(directory.st_mode)==0o700)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd);check(stat.S_ISREG(s.st_mode) and s.st_uid==pwd.getpwnam('chert').pw_uid and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<4096);task=json.loads(os.read(fd,4096))
 finally:os.close(fd)
 check(set(task)=={'pid','port','control','artifact_sha256'} and task['control']==task_control() and task['artifact_sha256']==plan['harness']['remote_artifact']['sha256'] and type(task['pid'])==int and task['pid']>0 and task['pid']!=B['server_pid'])
 return task
def stop_task():
 task=load_task()
 if task is None:return {'stopped':True,'found':False}
 try:os.kill(task['pid'],0)
 except ProcessLookupError:return {'stopped':True,'found':True}
 check(pidpath(task['pid'])==artifact());os.kill(task['pid'],signal.SIGTERM)
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  try:os.kill(task['pid'],0)
  except ProcessLookupError:return {'stopped':True,'found':True}
  time.sleep(.1)
 raise RuntimeError('owned process stop unconfirmed')
def freeport():
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();return port
def task_request(process,path,raw=None):
 check(isinstance(process,dict) and isinstance(process.get('pid'),int) and process['pid']!=B['server_pid'])
 check(pidpath(process['pid'])==artifact());headers={'Authorization':'Bearer '+p['apiKey']}
 if path.startswith('/api/v1/'):
  ts=str(int(time.time()));headers['x-chert-signature']='v1,'+ts+','+hmac.new(p['signingSecret'].encode(),ts.encode()+b'.'+(raw or b''),hashlib.sha256).hexdigest()
 req=urllib.request.Request('http://127.0.0.1:'+str(process['port'])+path,data=raw,headers=headers,method='POST' if raw is not None else 'GET')
 try:r=opener.open(req,timeout=12 if raw is not None else 5)
 except urllib.error.HTTPError as e:r=e
 with r:
  data=r.read(16385);check(len(data)<=16384);return {'status':r.status,'body':json.loads(data)}
try:
 before=None if action=='stop' else identity()
 if action=='identity':out=before
 elif action=='ports':out={'native':freeport(),'reverse':freeport()}
 elif action=='launch':
  executable=artifact();user=pwd.getpwnam('chert');port=p['port'];reverse=p['reverse'];check(type(port)==int and type(reverse)==int and 1024<port<65536 and 1024<reverse<65536 and port!=reverse)
  for key in ['apiKey','signingSecret']:check(re.fullmatch(r'[a-f0-9]{64}',p[key]))
  check(isinstance(p['jwt'],str) and len(p['jwt'])<8192 and p['jwt'].count('.')==2)
  # The forward must already reach the isolated fixture, not an unrelated listener.
  req=urllib.request.Request('http://127.0.0.1:'+str(reverse)+'/rest/v1/messaging_tenants?select=id&limit=1',headers={'apikey':p['jwt'],'Authorization':'Bearer '+p['jwt']})
  deadline=time.monotonic()+8;forward_ready=False
  while time.monotonic()<deadline:
   try:
    with opener.open(req,timeout=1) as r:forward_ready=r.status==200 and len(r.read(16385))<=16384
    if forward_ready:break
   except Exception:pass
   time.sleep(.1)
  check(forward_ready)
  control=task_control();os.mkdir(control,0o700);os.chown(control,user.pw_uid,user.pw_gid)
  check(os.path.realpath(control)==control and not os.path.exists(control+'/.env'))
  env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','TMPDIR':control,'API_KEY':p['apiKey'],'LINE_SIGNING_SECRET':p['signingSecret'],'PHONE_NUMBER':sender,'SUPABASE_URL':'http://127.0.0.1:'+str(reverse),'SUPABASE_SERVICE_KEY':p['jwt'],'MAC_SERVER_TENANT_ID':'11000000-0000-4000-8000-000000000001'}
  if plan['version']==3:env['CHERT_ACCEPTANCE_MEDIA_PROTOCOL']='attachment-operations/v2'
  def drop():os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
  fd=os.open(control+'/runtime.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,user.pw_uid,user.pw_gid)
  try:child=subprocess.Popen([executable,'--isolated-attachment-acceptance',str(port)],cwd=control,env=env,stdin=subprocess.DEVNULL,stdout=fd,stderr=fd,preexec_fn=drop,start_new_session=True)
  finally:os.close(fd)
  task={'pid':child.pid,'port':port,'control':control,'artifact_sha256':plan['harness']['remote_artifact']['sha256']};save_task(task);out={'ready':False,'stage':'task-health','process':task}
  deadline=time.monotonic()+8
  while time.monotonic()<deadline:
   if child.poll() is not None:break
   try:
    health=task_request(task,'/health')
    if health=={'status':200,'body':{'kind':'isolated-attachment-acceptance','ready':True}}:out={'ready':True,'process':task};break
   except Exception:pass
   time.sleep(.1)
 elif action=='preflight':
  body=p['body'];captioned=plan['version']==3;protocol='attachment-operations/v2' if captioned else 'attachment-operations/v1';check(set(body)==({'origin','from','to','attachment_id','caption'} if captioned else {'origin','from','to','attachment_id'}) and re.fullmatch(r'caption_[a-f0-9]{32}' if captioned else r'media_[a-f0-9]{32}',body['origin']) and body['from']==sender and body['to']==recipient and re.fullmatch(r'[a-f0-9]{48}',body['attachment_id']) and (not captioned or body['caption']==plan['caption']))
  missing=task_request(p['process'],'/api/v1/'+protocol+'/'+body['origin']+'?from='+urllib.parse.quote(sender,safe=''));check(missing=={'status':404,'body':{'origin':body['origin'],'found':False}});out=before
 elif action=='send':
  body=p['body'];captioned=plan['version']==3;protocol='attachment-operations/v2' if captioned else 'attachment-operations/v1';check(set(body)==({'origin','from','to','attachment_id','caption'} if captioned else {'origin','from','to','attachment_id'}) and re.fullmatch(r'caption_[a-f0-9]{32}' if captioned else r'media_[a-f0-9]{32}',body['origin']) and body['from']==sender and body['to']==recipient and re.fullmatch(r'[a-f0-9]{48}',body['attachment_id']) and (not captioned or body['caption']==plan['caption']))
  raw=p['raw'].encode();check(json.loads(raw)==body);out=task_request(p['process'],'/api/v1/'+protocol,raw)
 elif action=='stop':
  out=stop_task()
 else:raise RuntimeError('unsupported isolated action')
except Exception:out={'ready':False,'stage':action,'outcome':'unconfirmed-no-resend',**({'process':task} if action=='launch' and 'task' in locals() else {})}
finally:
 if before is not None:
  try:check(identity()==before)
  except Exception:out={'ready':False,'stage':'identity-after','outcome':'unconfirmed-no-resend',**({'process':task} if action=='launch' and 'task' in locals() else {})}
print(json.dumps(out))
`;
// AttachmentSendOnce constructs exact caption followed by its single U+FFFC attachment.
// SQL may expose plain caption or that full string; neither is normalized.
export const CAPTION_PROJECTION_SOURCE=String.raw`def caption_projection(value,caption):
 if not isinstance(value,str):return None
 if value==caption:return 'plain-caption'
 if value==caption+chr(0xFFFC):return 'caption-plus-attachment'
 return None
`;
// V2 reads only the exact accepted GUID; image decoding stays in the reviewed local tool.
export const URL_MEDIA_OBSERVER=MEDIA_OBSERVER.slice(0,MEDIA_OBSERVER.indexOf('before=None;phase="identity"'))+String.raw`
${CAPTION_PROJECTION_SOURCE}
before=None;phase='identity'
try:
 before=identity();check(before['service_pid']==B['server_pid']);approved=approved_chat();check(sha(approved['account_login'].encode())==B['account_login_sha256'] and sha(approved['chat_guid'].encode())==B['approved_chat_guid_sha256'])
 guid=p['guid'];check(action=='observe' and re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',guid));phase='exact-guid-pair';result_json={'complete':False}
 senderdb=sqlite3.connect('file:/Users/chert/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);receiverdb=sqlite3.connect('file:/Users/meganavery/Library/Messages/chat.db?mode=ro',uri=True,timeout=2)
 try:
  senderdb.execute('PRAGMA query_only=ON');receiverdb.execute('PRAGMA query_only=ON');deadline=time.monotonic()+35
  while time.monotonic()<deadline:
   sent=senderdb.execute('SELECT m.guid,m.is_from_me,m.service,m.destination_caller_id,c.guid,c.account_login,m.is_sent,m.is_delivered,m.error,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID) FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
   rows=receiverdb.execute('SELECT m.guid,m.is_from_me,m.service,h.id,m.error,c.ROWID,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID) FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
   attachments=receiverdb.execute('SELECT a.filename FROM attachment a JOIN message_attachment_join j ON j.attachment_id=a.ROWID JOIN message m ON m.ROWID=j.message_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
   senderattachments=senderdb.execute('SELECT count(*) FROM message_attachment_join j JOIN message m ON m.ROWID=j.message_id WHERE m.guid=?',(guid,)).fetchone()[0]
   if len(sent)==1 and sent[0]==(guid,1,'iMessage',sender,approved['chat_guid'],approved['account_login'],1,1,0,1) and senderattachments==1 and len(rows)==1 and rows[0][:5]==(guid,0,'iMessage',sender,0) and rows[0][6]==1 and len(attachments)==1:
    peer=receiverdb.execute('SELECT h.id FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id WHERE j.chat_id=? LIMIT 2',(rows[0][5],)).fetchall();check(peer==[(sender,)])
    projections=None
    if p['plan']['version']==3:
     phase='exact-caption-projection'
     sendertext=senderdb.execute('SELECT text FROM message WHERE guid=? LIMIT 2',(guid,)).fetchall()
     recipienttext=receiverdb.execute('SELECT text FROM message WHERE guid=? LIMIT 2',(guid,)).fetchall()
     check(len(sendertext)==1 and len(recipienttext)==1)
     projections={'sender':caption_projection(sendertext[0][0],p['plan']['caption']),'recipient':caption_projection(recipienttext[0][0],p['plan']['caption'])}
     check(all(value is not None for value in projections.values()))
    path=attachments[0][0];check(isinstance(path,str));path=path.replace('~','/Users/meganavery',1) if path.startswith('~/') else path;base='/Users/meganavery/Library/Messages/Attachments/'
    if path.startswith(base) and os.path.realpath(path)==path:
     try:
      fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
      try:
       st=os.fstat(fd);check(stat.S_ISREG(st.st_mode) and 0<st.st_size<=1048576);data=os.read(fd,1048577);check(len(data)==st.st_size and data.startswith(b'\x89PNG\r\n\x1a\n'))
      finally:os.close(fd)
      result_json={'complete':True,'guid':guid,'receiver_sha256':sha(data),'receiver_png_base64':base64.b64encode(data).decode(),'identity_unchanged':True,**({'caption_exact_both_accounts':True,'caption_projections':projections} if projections is not None else {})};break
     except OSError:pass
   time.sleep(.5)
 finally:senderdb.close();receiverdb.close()
 check(identity()==before and approved_chat()==approved)
except Exception:result_json={'complete':False,'outcome':'unconfirmed-no-resend','stage':phase}
print(json.dumps(result_json))
`;
function ssh(program,payload,timeout=25000,maxOutput=65536){return new Promise((yes,no)=>{
 const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','chert-m4d','sudo','-n','python3','-'],{stdio:['pipe','pipe','pipe']});let output='',size=0;
 const timer=setTimeout(()=>child.kill(),timeout);child.stdout.on('data',b=>{size+=b.length;if(size>maxOutput)child.kill();else output+=b;});child.stderr.on('data',b=>{size+=b.length;if(size>maxOutput)child.kill();});
 child.on('error',()=>{clearTimeout(timer);no(Error('Isolated media evidence unavailable; never resend'));});child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);yes(JSON.parse(output));}catch{no(Error('Isolated media evidence unavailable; never resend'));}});
 child.stdin.end(program.replace('PAYLOAD',Buffer.from(JSON.stringify(payload)).toString('base64')));
});}
/** Executor injection is exclusively for deterministic offline boundary tests. */
export async function createOperationGateway(plan,journalPath,identity,beforeDispatch,execute){
 const media=mediaTuple(plan);if(plan.version===2||plan.version===3)assert.equal(resolve(journalPath),plan.receipt_path);
 identityMatches(identity,plan);assert.equal(typeof beforeDispatch,'function');assert.equal(typeof execute,'function');
 assert.equal(existsSync(journalPath+'.spent'),false);persist(journalPath,{run:plan.run,plan_sha256:sha(JSON.stringify(plan)),attempted:false,passed:false},true);
 const apiKey=randomBytes(32).toString('hex'),signingSecret=randomBytes(32).toString('hex');let attachmentId=null,spent=false,receipt=privateFile(journalPath).value;
 const save=update=>{receipt={...receipt,...update,attempted:spent};persist(journalPath,receipt);};
 const unknown=()=>Response.json({error:{code:4103,retryable:false,message:'Media outcome unconfirmed; reconcile before retrying'}},{status:502});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:15,maxRequestBodySize:16384,async fetch(request){
  try{
   const url=new URL(request.url);assert.equal(url.pathname,plan.version===3?'/api/v1/attachment-operations/v2':'/api/v1/attachment-operations/v1');assert.equal(url.search,'');assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer '+apiKey);
   const reader=request.body?.getReader();assert.ok(reader);const chunks=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();throw Error('Bounded body refused');}chunks.push(part.value);}}finally{reader.releaseLock();}
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),sig=/^v1,([0-9]+),([a-f0-9]{64})(?![\s\S])/.exec(request.headers.get('x-chert-signature')??'');
   assert.ok(sig&&Math.abs(Date.now()/1000-Number(sig[1]))<=300);assert.ok(timingSafeEqual(createHmac('sha256',signingSecret).update(sig[1]+'.'+raw).digest(),Buffer.from(sig[2],'hex')));
   const body=JSON.parse(raw);assert.ok(attachmentId);validateOperationBody(body,identity,attachmentId,plan);assert.equal(spent,false);
   // No effect until actual PG ownership is checked and exact native origin is absent.
   identityMatches(await execute({action:'preflight',body}),plan);await beforeDispatch(body);
   assert.equal(spent,false);const claim=openSync(journalPath+'.spent',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{const bytes=Buffer.from(JSON.stringify({run:plan.run,public_message_id:body.origin.slice(plan.version===3?8:6),origin:body.origin,attachment_id:attachmentId,plan_sha256:sha(JSON.stringify(plan))}));for(let n=0;n<bytes.length;)n+=writeSync(claim,bytes,n,bytes.length-n);fsyncSync(claim);}finally{closeSync(claim);}
   const parent=openSync(dirname(journalPath),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}spent=true;
   save({public_message_id:body.origin.slice(plan.version===3?8:6),origin:body.origin,attachment_id:attachmentId,png_sha256:media.sha256,body_sha256:sha(raw),expected_fingerprint:operationFingerprint(body,plan),outcome:'spent-before-native-HTTP'});
   let result;try{result=await execute({action:'send',body,raw});}catch{save({outcome:'unknown-no-resend'});return unknown();}
   if(result?.status!==202||!validOperationACK(result.body,body,plan)){save({outcome:'unknown-no-resend'});return unknown();}
   // Receipt survives local PG cleanup and precedes the HTTP response. A failed write never resends.
   save({native_guid:result.body.preparedGuid,native_fingerprint:result.body.fingerprint,native_http_status:202,outcome:'native-acknowledged'});
   return Response.json(result.body,{status:202});
  }catch{return unknown();}
 }});
 return{nativeOrigin:server.url.origin,apiKey,signingSecret,sender:identity.sender,recipient:identity.recipient,
  bindUploadedPNG(bytes,id){assert.equal(spent,false);assert.equal(attachmentId,null);assert.ok(bytes instanceof Uint8Array);assert.equal(bytes.length,plan.png_bytes);assert.equal(sha(bytes),plan.png_sha256);assert.match(id,/^[a-f0-9]{48}(?![\s\S])/);attachmentId=id;},
  async observe(guid){assert.equal(spent,true);assert.equal(guid,receipt.native_guid);const value=await execute({action:'observe',guid});identityMatches(await execute({action:'identity'}),plan);assert.equal(value.complete,true);assert.equal(value.guid,guid);assert.equal(value.identity_unchanged,true);if(plan.version===3){assert.equal(value.caption_exact_both_accounts,true);assert.deepEqual(Object.keys(value.caption_projections).sort(),['recipient','sender']);for(const projection of Object.values(value.caption_projections))assert.ok(['plain-caption','caption-plus-attachment'].includes(projection));}
   if(plan.version===2||plan.version===3){const byteGate=value.receiver_sha256===media.sha256;save({original_byte_gate_passed:byteGate,byte_preserved:byteGate,outcome:'exact-guid-observed-pixel-check-pending'});const proof=compareURLMediaObservation(plan,value);save({...proof,passed:true,outcome:plan.version===3?'exact-guid-caption-and-inline-png-pixels-confirmed':'exact-guid-inline-png-pixels-confirmed',...(plan.version===3?{caption_sha256:sha(plan.caption),caption_exact_both_accounts:true,caption_projections:value.caption_projections}:{}),observation:{native_guid:guid,public_message_id:receipt.public_message_id,identity_preserved:true,observed_at:new Date().toISOString()}});}
   else{assert.equal(value.receiver_sha256,media.sha256);save({passed:true,outcome:'exact-guid-recipient-png-confirmed',observation:{native_guid:guid,public_message_id:receipt.public_message_id,png_sha256:media.sha256,identity_preserved:true,observed_at:new Date().toISOString()}});}
   return{passed:true,receiptPath:journalPath,receiptSha256:sha(readFileSync(journalPath))};},
  close:()=>server.stop(true)};
}
function stopTunnel(child){return new Promise((yes,no)=>{if(child.exitCode!==null||child.signalCode!==null||!child.pid){yes();return;}const timer=setTimeout(()=>{child.kill('SIGKILL');no(Error('Owned tunnel shutdown unconfirmed'));},5000);child.once('close',()=>{clearTimeout(timer);yes();});child.kill('SIGTERM');});}
export async function startReviewedOperationBroker(planPath,journalPath,flag,beforeDispatch,options){
 assert.ok(['--live-one-png-operation','--live-one-sendblue-url-media-operation','--live-one-sendblue-url-caption-operation'].includes(flag));assert.equal(typeof beforeDispatch,'function');
 const plan=loadOperationLivePlan(planPath);assert.equal(flag,plan.version===3?'--live-one-sendblue-url-caption-operation':plan.version===2?'--live-one-sendblue-url-media-operation':'--live-one-png-operation');assert.equal(resolve(journalPath),(plan.version===2||plan.version===3)?plan.receipt_path:privateFile(planPath).path+'.attempt.json');privateParent(journalPath);
 assert.equal(existsSync(journalPath),false);assert.equal(existsSync(journalPath+'.spent'),false);
 assert.deepEqual(Object.keys(options).sort(),['supabaseOrigin','supabaseServiceKey']);const gateway=origin(options.supabaseOrigin);assert.ok(typeof options.supabaseServiceKey==='string'&&options.supabaseServiceKey.length<8192&&options.supabaseServiceKey.split('.').length===3);
 const call=(action,extra={})=>ssh(REMOTE_OPERATION_PROGRAM,{plan,action,...extra},action==='launch'?35000:action==='send'?20000:25000);
 const identity=await call('identity');identityMatches(identity,plan);
 const ports=await call('ports');for(const port of [ports.native,ports.reverse])assert.ok(Number.isInteger(port)&&port>1024&&port<=65535);assert.notEqual(ports.native,ports.reverse);
 const tunnel=spawn('ssh',['-T','-N','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-R',`127.0.0.1:${ports.reverse}:127.0.0.1:${gateway.port}`,'chert-m4d'],{stdio:['ignore','ignore','ignore']});
 let tunnelError=false;tunnel.on('error',()=>{tunnelError=true;});
 // Loopback ephemeral broker credentials never enter argv, plan, receipts or output.
 const apiKey=randomBytes(32).toString('hex'),signingSecret=randomBytes(32).toString('hex');let processInfo,broker;
 const remote=(action,extra={})=>call(action,{apiKey,signingSecret,process:processInfo,...extra});
 try{
  const launched=await call('launch',{apiKey,signingSecret,jwt:options.supabaseServiceKey,port:ports.native,reverse:ports.reverse});processInfo=launched.process;
  assert.equal(tunnelError,false);assert.equal(tunnel.exitCode,null);assert.equal(launched.ready,true);assert.ok(processInfo);
  const execute=async request=>{
   if(request.action==='observe')return ssh(plan.version>=2?URL_MEDIA_OBSERVER:MEDIA_OBSERVER,{action:'observe',plan,guid:request.guid},45000,plan.version>=2?1572864:65536);
   return remote(request.action,request);
  };
  broker=await createOperationGateway(plan,journalPath,identity,beforeDispatch,execute);
  // The cloud-facing random credentials and task-server credentials are distinct.
  // SSH forwards the verified request using the task-server credential pair.
  return{...broker,plan,async close(){let failure;try{await broker.close();}catch(error){failure=error;}try{assert.equal((await remote('stop')).stopped,true);}catch(error){failure=error;}try{await stopTunnel(tunnel);}catch(error){failure=error;}if(failure)throw Error('Owned isolated media cleanup unconfirmed');}};
 }catch(error){try{await broker?.close();}catch{}try{assert.equal((await remote('stop')).stopped,true);}catch{await stopTunnel(tunnel);throw Error('Owned isolated media preparation cleanup unconfirmed');}await stopTunnel(tunnel);throw error;}
}
