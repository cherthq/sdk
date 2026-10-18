// Preparation only. Importing or invoking this CLI never contacts a device.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {constants,openSync,fstatSync,readFileSync,writeSync,ftruncateSync,fsyncSync,closeSync,writeFileSync,readSync,lstatSync,renameSync,unlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4P9P4PwAHMQLLXCFjRAAAAABJRU5ErkJggg==','base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const digest=/^[a-f0-9]{64}(?![\s\S])/;
export const REVIEWED_FILES=['sdk/scripts/m4d-live-media-acceptance.mjs','sdk/scripts/m4d-live-media-acceptance.d.mts','sdk/tests/attachment-postgrest.fixture.mjs','scripts/test-attachment-native-postgrest.sh'];
export const SOURCE_FILES=['src/bridge/ChertBridgeClient.h','src/bridge/ChertBridgeClient.m','src/send/BridgeAttachmentDispatch.h','src/send/BridgeAttachmentDispatch.m','src/helper/BridgeHelperLocator.h','src/helper/BridgeHelperLocator.m','src/helper/LaunchReadinessTimeout.h','src/helper/LaunchReadinessTimeout.m','src/helper/MessagesLauncherError.h','src/helper/MessagesLauncherError.m'];
function privateJSON(path){assert.ok(typeof path==='string'&&path.startsWith('/'),'absolute private file required');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.size<=65536,'owned private regular file required');const bytes=readFileSync(fd);return{value:JSON.parse(bytes.toString('utf8')),digest:hash(bytes)};}finally{closeSync(fd);}}
export function preparePlan(priorPath,bindingsPath,run=randomUUID()){
 assert.match(run,uuid);const prior=privateJSON(priorPath),bindings=privateJSON(bindingsPath).value;
 assert.equal(prior.value.attempted,true);assert.equal(prior.value.passed,true);assert.equal(prior.value.environment,'reviewed-live');assert.equal(prior.value.outcome,'exact-guid-recipient-imessage-confirmed');
 assert.equal(prior.value.native?.guid,prior.value.recipient?.guid);assert.match(prior.value.native?.guid,/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/);
 assert.deepEqual(Object.keys(bindings).sort(),['account_login_sha256','approved_chat_guid_sha256','helper_sha256','messages_pid','recipient_sha256','sender_sha256','service_sha256']);
 for(const key of ['account_login_sha256','approved_chat_guid_sha256','helper_sha256','recipient_sha256','sender_sha256','service_sha256'])assert.match(bindings[key],digest);
 assert.ok(Number.isSafeInteger(bindings.messages_pid)&&bindings.messages_pid>0);
 return{version:1,run,approved_guid:prior.value.native.guid,caller_sha256:hash(CALLER_SOURCE),reviewed_files:REVIEWED_FILES.map(path=>({path,sha256:hash(readFileSync(resolve(root,path)))})),plan:'one-reviewed-synthetic-png-ready-only',prior_receipt_path:priorPath,prior_receipt_sha256:prior.digest,bindings,
  png_sha256:hash(PNG),png_bytes:PNG.length,attempted:false,passed:false,integration:'candidate-awaiting-primary-review',
  sources:SOURCE_FILES.map(path=>({path,sha256:hash(readFileSync(resolve(root,'imessage-server/mac-server',path)))}))};
}
// Version 2 is local contract review only. A source manifest is not installed-build proof.
export const OPERATION_SOURCE_FILES = [
 'src/http/AttachmentOperationSendRoute.h','src/http/AttachmentOperationSendRoute.m',
 'src/send/Sender.h','src/send/Sender.m',
 'src/send/AttachmentFingerprint.h','src/send/AttachmentFingerprint.m',
 'src/send/AttachmentOperationStage.h','src/send/AttachmentOperationStage.m',
 'src/send/BridgeAttachmentOnceDispatch.h','src/send/BridgeAttachmentOnceDispatch.m',
 'src/helper/AttachmentSendOnce.h','src/helper/AttachmentSendOnce.m',
 'src/helper/AttachmentOperationJournal.h','src/helper/AttachmentOperationJournal.m',
 'src/helper/AttachmentOperationRead.h','src/helper/AttachmentOperationRead.m',
 'src/helper/ChertImsgBridge.m',
];
export function prepareOperationPlan(priorPath, bindingsPath, run=randomUUID()) {
 const historical = preparePlan(priorPath, bindingsPath, run);
 return {...historical, version:2, plan:'attachment-operations/v1-preflight-only',
  integration:'blocked-awaiting-compatible-installed-caller-and-paired-release',
  cloud_caller_sha256:hash(readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation.ts'))),
  cloud_context_sha256:hash(readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation-context.ts'))),
  sources:OPERATION_SOURCE_FILES.map(path=>({path,sha256:hash(readFileSync(resolve(root,'imessage-server/mac-server',path)))}))};
}
export function operationPreflight(plan) {
 assert.equal(plan.version,2);assert.equal(plan.plan,'attachment-operations/v1-preflight-only');
 assert.match(plan.run,uuid);assert.equal(plan.png_sha256,hash(PNG));assert.equal(plan.png_bytes,PNG.length);
 assert.equal(plan.cloud_caller_sha256,hash(readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation.ts'))),'reviewed cloud caller changed');
 assert.equal(plan.cloud_context_sha256,hash(readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation-context.ts'))),'reviewed cloud context changed');
 const cloudCaller=readFileSync(resolve(root,'imessage-server/lib/sending/attachment-operation.ts'),'utf8');
 // The caption-aware caller still selects v1 exactly when no caption is present.
 assert.ok(/const\s+captioned\s*=\s*args\.caption\s*!==\s*undefined/.test(cloudCaller)
  && cloudCaller.includes('`/api/v1/attachment-operations/${captioned?"v2":"v1"}`'),
  'versioned cloud operation route required');
 assert.deepEqual(plan.sources.map(item=>item.path).sort(),[...OPERATION_SOURCE_FILES].sort());
 for(const item of plan.sources){assert.deepEqual(Object.keys(item).sort(),['path','sha256']);assert.match(item.sha256,digest);
  assert.equal(hash(readFileSync(resolve(root,'imessage-server/mac-server',item.path))),item.sha256,'reviewed native source changed');}
 // This result cannot authorize execution, even if the caller edits a capability field.
 return {ready:false,mode:'preflight-only',method:'POST',path:'/api/v1/attachment-operations/v1',
  blockers:['installed-server-and-helper-source-binding-not-verified',
   'configured-sender-and-existing-chat-binding-not-verified',
   'paired-crm-release-and-physical-acceptance-pending']};
}
export function validateNativeBody(plan,body){
 assert.match(plan.run,uuid);assert.equal(plan.plan,'one-reviewed-synthetic-png-ready-only');assert.equal(plan.png_sha256,hash(PNG));assert.equal(plan.png_bytes,PNG.length);
 assert.ok(body&&typeof body==='object'&&!Array.isArray(body));assert.deepEqual(Object.keys(body).sort(),['attachments','idempotency_key','lead_id','phone']);
 assert.match(body.idempotency_key,/^chert-media:[a-f0-9]{32}(?![\s\S])/);assert.match(body.phone,/^\+[1-9][0-9]{1,14}(?![\s\S])/);assert.equal(hash(body.phone),plan.bindings.recipient_sha256);
 assert.equal(body.lead_id,'41000000-0000-4000-8000-000000000001');assert.ok(Array.isArray(body.attachments)&&body.attachments.length===1);assert.deepEqual(Object.keys(body.attachments[0]),['id']);assert.match(body.attachments[0].id,/^[a-f0-9]{48}(?![\s\S])/);
}
// The reviewed integration supplies the executor; the durable claim precedes its sole dispatch.
export function createOneAttemptBroker(plan,journalPath,execute){
 assert.equal(typeof execute,'function');const fd=openSync(journalPath,constants.O_RDWR|constants.O_NOFOLLOW);const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.size<=65536);
 let closed=false;
 const parent=lstatSync(dirname(journalPath));assert.ok(parent.isDirectory()&&parent.uid===process.getuid()&&(parent.mode&0o777)===0o700,'private journal directory required');
 return{async attempt(body,uploadedBytes){
  assert.ok(!closed);validateNativeBody(plan,body);assert.ok(uploadedBytes instanceof Uint8Array);assert.equal(hash(uploadedBytes),plan.png_sha256);const state=Buffer.alloc(fstatSync(fd).size);readSync(fd,state,0,state.length,0);const current=JSON.parse(state.toString('utf8'));assert.equal(current.attempted,false,'spent: reconcile, never resend');assert.deepEqual(current,plan);
  const claim=openSync(journalPath+'.spent',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeSync(claim,Buffer.from(JSON.stringify({run:plan.run,plan_sha256:hash(JSON.stringify(plan))})));fsyncSync(claim);}finally{closeSync(claim);}
  const parentFD=openSync(dirname(journalPath),constants.O_RDONLY);try{fsyncSync(parentFD);}finally{closeSync(parentFD);}
  const bytes=Buffer.from(JSON.stringify({...current,attempted:true,passed:false,outcome:'attempt-spent-before-SSH',public_message_id:body.idempotency_key.slice('chert-media:'.length),attachment_id:body.attachments[0].id}));writeSync(fd,bytes,0,bytes.length,0);ftruncateSync(fd,bytes.length);fsyncSync(fd);
  return await execute({plan,body,png:Buffer.from(uploadedBytes)});
 },close(){if(!closed){closed=true;closeSync(fd);}}};
}
// Atomic receipt replacement never clears the independent, permanent spent claim.
export function recordMediaReceipt(journalPath, update){
 const previous=privateJSON(journalPath).value;assert.equal(previous.attempted,true);
 const next={...previous,...update,attempted:true};const temporary=journalPath+'.receipt-'+randomUUID();
 let fd;try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const bytes=Buffer.from(JSON.stringify(next));let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,journalPath);const parent=openSync(dirname(journalPath),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}}catch(error){if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch{}throw error;}
 return {receiptPath:journalPath,receiptSha256:privateJSON(journalPath).digest};
}
// Compile against the manifest-bound actual client/helper sources, never a copied RPC implementation.
export const CALLER_SOURCE=String.raw`#import <Foundation/Foundation.h>
#import "ChertBridgeClient.h"
#import "BridgeAttachmentDispatch.h"
int main(int argc,const char **argv){@autoreleasepool{
 BOOL inspect=argc==2&&strcmp(argv[1],"--inspect")==0;
 if(argc!=2||(!inspect&&strcmp(argv[1],"--send-once")!=0))return 2;
 @try{
  NSData *bytes=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];if(bytes.length>16384)return 2;
  NSDictionary *p=[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
  if(![p isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:p.allKeys] isEqual:[NSSet setWithArray:@[@"chatGuid",@"filePath",@"expectedPid",@"expectedAccountLogin"]]])return 2;
  ChertBridgeClient *client=ChertBridgeClient.shared;if(!client.readyNow)return 2;
  NSError *error=nil;NSDictionary *status=[client invokeAction:@"status" params:@{} timeout:5 error:&error];
  if(error||![status[@"pid"] isEqual:p[@"expectedPid"]]||(!inspect&&![status[@"account_login"] isEqual:p[@"expectedAccountLogin"]]))return 2;
  NSDictionary *list=[client invokeAction:@"list-chats" params:@{} timeout:5 error:&error];if(error)return 2;
  NSArray *pieces=[p[@"chatGuid"] componentsSeparatedByString:@";"];if(pieces.count!=3||!([pieces[0] isEqual:@"iMessage"]||[pieces[0] isEqual:@"any"])||![pieces[1] isEqual:@"-"])return 2;
  NSUInteger matches=0;for(NSDictionary *chat in list[@"chats"]){if([chat[@"guid"] isEqual:p[@"chatGuid"]]&&[chat[@"participants"] isEqual:@[pieces[2]]])matches++;}if(matches!=1)return 2;
  if(inspect){if(![status[@"account_login"] isKindOfClass:NSString.class])return 2;
   NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"account_login":status[@"account_login"]} options:0 error:nil];[[NSFileHandle fileHandleWithStandardOutput] writeData:json];return 0;}
  NSString *guid=nil;BOOL ok=BridgeAttachmentDispatch(^BOOL{return client.readyNow;},^NSDictionary *(NSError **err){
   NSDictionary *ack=[client invokeAction:@"send-attachment" params:@{@"chatGuid":p[@"chatGuid"],@"filePath":p[@"filePath"]} timeout:25 error:err];
   if(ack&&![ack[@"chatGuid"] isEqual:p[@"chatGuid"]])return nil;return ack;
  },&guid,&error);
  NSDictionary *out=ok?@{@"acknowledged":@YES,@"guid":guid}:@{@"acknowledged":@NO,@"outcome":@"unconfirmed-no-resend"};
  NSData *json=[NSJSONSerialization dataWithJSONObject:out options:0 error:nil];[[NSFileHandle fileHandleWithStandardOutput] writeData:json];return 0;
 }@catch(...){return 2;}
}}`;
if(import.meta.main&&process.argv[2]==='--operation-preflight-only'){
 assert.equal(process.argv.length,5);console.log(JSON.stringify(operationPreflight(prepareOperationPlan(process.argv[3],process.argv[4]))));
}else if(import.meta.main){
 assert.deepEqual(process.argv.slice(2,3),['--prepare-only'],'preparation only; no device action CLI');assert.equal(process.argv.length,5);
 const plan=preparePlan(process.argv[3],process.argv[4]);console.log(JSON.stringify(plan));
}

// This program is only submitted by the explicit reviewed runner branch. No shell interpolation.
export const REMOTE_PROGRAM=String.raw`
import base64,json,os,re,stat,hashlib,subprocess,tempfile,pwd,sqlite3,urllib.request,urllib.error,ctypes,time
p=json.loads(base64.b64decode('PAYLOAD'));plan=p['plan'];action=p['action'];B=plan['bindings']
def check(value):
    if not value:raise RuntimeError('media acceptance refused; no retry')
def sha(data):return hashlib.sha256(data).hexdigest()
def cfg(path):
    out={}
    for line in open(path):
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1);out[k.strip()]=v.strip().strip('"').strip("'")
    return out
a=cfg('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env');b=cfg('/Users/meganavery/imessage-server/mac-server/.env')
sender=a.get('PHONE_NUMBER','');recipient=b.get('PHONE_NUMBER','')
check(re.fullmatch(r'\+[1-9][0-9]{1,14}',sender) and re.fullmatch(r'\+[1-9][0-9]{1,14}',recipient) and sender!=recipient)
if action!='audit':check(sha(sender.encode())==B['sender_sha256'] and sha(recipient.encode())==B['recipient_sha256'])
check(a.get('PORT','4010')=='4010' and re.fullmatch(r'[a-f0-9-]{36}',plan['run']))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
def request(path):
    req=urllib.request.Request('http://127.0.0.1:4010'+path,headers={'Authorization':'Bearer '+a['API_KEY']})
    with opener.open(req,timeout=5) as r:
        check(r.status==200);return json.loads(r.read(65537))
def pidpath(pid):
    lib=ctypes.CDLL('/usr/lib/libproc.dylib');buf=ctypes.create_string_buffer(4096)
    check(lib.proc_pidpath(int(pid),buf,len(buf))>0);return buf.value.decode()
def approved_chat():
    db=sqlite3.connect('file:/Users/chert/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
    try:
        rows=db.execute('SELECT m.guid,m.is_from_me,m.service,m.destination_caller_id,c.guid,c.chat_identifier,c.account_login,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID) FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid=? LIMIT 2',(plan['approved_guid'],)).fetchall()
        check(len(rows)==1);r=rows[0];check(r[0]==plan['approved_guid'] and r[1]==1 and r[2]=='iMessage' and r[3]==sender and r[4] in ('iMessage;-;'+recipient,'any;-;'+recipient) and r[5]==recipient and isinstance(r[6],str) and r[6] and r[7]==1)
        peer=db.execute('SELECT h.id FROM chat_handle_join j JOIN handle h ON h.ROWID=j.handle_id JOIN chat c ON c.ROWID=j.chat_id WHERE c.guid=? LIMIT 2',(r[4],)).fetchall();check(peer==[(recipient,)])
        return {'account_login':r[6],'chat_guid':r[4]}
    finally:db.close()
def identity():
    h=request('/health');s=request('/status');check(h.get('status')=='healthy' and s.get('sender')=='bridge' and s.get('phoneNumber')==sender)
    ids=subprocess.check_output(['/usr/sbin/lsof','-nP','-t','-iTCP:4010','-sTCP:LISTEN'],timeout=5).decode().split();check(len(set(ids))==1)
    service=int(ids[0]);service_path=pidpath(service);service_hash=sha(open(service_path,'rb').read())
    if action!='audit':check(service_hash==B['service_sha256'])
    marker_path='/Users/chert/Library/Containers/com.apple.MobileSMS/Data/.chert-bridge-ready'
    ms=os.lstat(marker_path);check(stat.S_ISREG(ms.st_mode) and ms.st_uid==pwd.getpwnam('chert').pw_uid)
    marker=json.load(open(marker_path));check(isinstance(marker.get('pid'),int) and marker['pid']>0 and marker.get('bridge_version')==1)
    if action=='audit':B['messages_pid']=marker['pid']
    else:check(marker['pid']==B['messages_pid'])
    check(os.path.basename(pidpath(B['messages_pid']))=='Messages')
    loaded=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(B['messages_pid']),'-d','txt','-Fn'],timeout=5).decode().splitlines()
    helpers=set(x[1:] for x in loaded if x.startswith('n/') and os.path.basename(x[1:])=='chert-imsg-bridge.dylib');check(len(helpers)==1)
    helper_hash=sha(open(next(iter(helpers)),'rb').read())
    if action!='audit':check(helper_hash==B['helper_sha256'])
    return {'service_pid':service,'messages_pid':B['messages_pid'],'service_sha256':service_hash,'helper_sha256':helper_hash}
before=None;phase="identity"
try:
    before=identity();phase="approved-chat";approved=approved_chat()
    if action!='audit':check(sha(approved['account_login'].encode())==B['account_login_sha256'] and sha(approved['chat_guid'].encode())==B['approved_chat_guid_sha256'])
    if action=='audit':
        phase='installed-helper-source'
        source=open('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/src/helper/ChertImsgBridge.m','rb').read()
        check(all(token in source for token in [b'send-attachment',b'filePath',b'chatGuid',b'messageGuid']))
        result_json={'bindings':{k:before[k] for k in ['messages_pid','service_sha256','helper_sha256']} | {'sender_sha256':sha(sender.encode()),'recipient_sha256':sha(recipient.encode()),'account_login_sha256':sha(approved['account_login'].encode()),'approved_chat_guid_sha256':sha(approved['chat_guid'].encode())},'helper_source_sha256':sha(source),'source_binary_build_binding':False,'installed_source_protocol_tokens':True}
    elif action=='preflight':result_json={'sender':sender,'recipient':recipient,'identity':before}
    elif action=='prepare':
        phase='non-send-preparation'
        png=base64.b64decode(p['png'],validate=True);check(len(png)==plan['png_bytes'] and sha(png)==plan['png_sha256'])
        user=pwd.getpwnam('chert');control=os.path.realpath(tempfile.mkdtemp(prefix='chert-media-'+plan['run']+'-',dir='/tmp'));os.chmod(control,0o700);os.chown(control,user.pw_uid,user.pw_gid)
        control_stat=os.lstat(control);check(os.path.dirname(control)==os.path.realpath('/tmp') and stat.S_ISDIR(control_stat.st_mode) and control_stat.st_uid==user.pw_uid and stat.S_IMODE(control_stat.st_mode)==0o700)
        expected={v['path']:v['sha256'] for v in plan['sources']};check(set(p['sources'])==set(expected))
        for name,encoded in p['sources'].items():
            check(name in expected and '..' not in name.split('/'));data=base64.b64decode(encoded,validate=True);check(sha(data)==expected[name]);path=os.path.join(control,name);os.makedirs(os.path.dirname(path),mode=0o700,exist_ok=True);open(path,'wb').write(data)
        check(sha(p['caller'].encode())==plan['caller_sha256']);caller=os.path.join(control,'caller.m');open(caller,'w').write(p['caller'])
        executable=os.path.join(control,'caller')
        objects=['src/bridge/ChertBridgeClient.m','src/send/BridgeAttachmentDispatch.m','src/helper/BridgeHelperLocator.m','src/helper/LaunchReadinessTimeout.m','src/helper/MessagesLauncherError.m']
        command=['/usr/bin/clang','-fobjc-arc','-fblocks','-framework','Foundation','-Isrc/bridge','-Isrc/send','-Isrc/helper','caller.m']+objects+['-o',executable]
        compiled=subprocess.run(command,cwd=control,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30);check(compiled.returncode==0);os.chmod(executable,0o700);os.chown(executable,user.pw_uid,user.pw_gid)
        root='/Users/chert/Library/Messages/Attachments';check(os.path.isdir(root) and not os.path.islink(root))
        directory=os.path.join(root,'chert-acceptance-'+plan['run']);os.mkdir(directory,0o700);os.chown(directory,user.pw_uid,user.pw_gid)
        image=os.path.join(directory,'synthetic.png');fd=os.open(image,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,png);os.fsync(fd);os.close(fd);os.chown(image,user.pw_uid,user.pw_gid)
        args={'chatGuid':approved['chat_guid'],'filePath':image,'expectedPid':B['messages_pid'],'expectedAccountLogin':approved['account_login']}
        invoke=['/usr/bin/sudo','-n','-H','-u','chert',executable]
        inspection=subprocess.run(invoke+['--inspect'],input=json.dumps(args).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15);check(inspection.returncode==0);check(json.loads(inspection.stdout)['account_login']==approved['account_login']);check(identity()==before and approved_chat()==approved)
        result_json={'prepared':True,'control':control,'image':image,'executable':executable,'executable_sha256':sha(open(executable,'rb').read()),'identity':before}
    elif action=='send':
        phase='one-dispatch'
        body=p['body'];check(body['phone']==recipient and body['lead_id']=='41000000-0000-4000-8000-000000000001')
        prepared=p['prepared'];check(prepared.get('prepared') is True and prepared.get('identity')==before)
        control=prepared['control'];image=prepared['image'];executable=prepared['executable']
        check(os.path.basename(control).startswith('chert-media-'+plan['run']+'-') and os.path.realpath(control)==control and stat.S_IMODE(os.stat(control).st_mode)==0o700)
        check(executable==os.path.join(control,'caller') and sha(open(executable,'rb').read())==prepared['executable_sha256'])
        check(sha(open(os.path.join(control,'caller.m'),'rb').read())==plan['caller_sha256'])
        for item in plan['sources']:check(sha(open(os.path.join(control,item['path']),'rb').read())==item['sha256'])
        check(image=='/Users/chert/Library/Messages/Attachments/chert-acceptance-'+plan['run']+'/synthetic.png' and os.path.realpath(image)==image and sha(open(image,'rb').read())==plan['png_sha256'])
        args={'chatGuid':approved['chat_guid'],'filePath':image,'expectedPid':B['messages_pid'],'expectedAccountLogin':approved['account_login']}
        invoke=['/usr/bin/sudo','-n','-H','-u','chert',executable]
        outcome={'acknowledged':False,'outcome':'unconfirmed-no-resend'}
        try:
            result=subprocess.run(invoke+['--send-once'],input=json.dumps(args).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
            if result.returncode==0:outcome=json.loads(result.stdout)
        finally:
            # Never unlink a file an asynchronous native transfer may still consume.
            after=identity();check(approved_chat()==approved)
        check(before==after)
        guid=outcome.get('guid');check(outcome.get('acknowledged') is True and isinstance(guid,str) and re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',guid))
        result_json={'acknowledged':True,'guid':guid,'identity_unchanged':True,'staged_retained':True}
    elif action=='observe':
        phase='exact-receiver-observation'
        guid=p['guid'];check(re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}',guid));found=False
        db=sqlite3.connect('file:/Users/meganavery/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
        try:
            deadline=time.monotonic()+35
            while time.monotonic()<deadline:
                rows=db.execute('SELECT m.guid,m.is_from_me,m.service,h.id FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
                attachments=db.execute('SELECT a.filename FROM attachment a JOIN message_attachment_join j ON j.attachment_id=a.ROWID JOIN message m ON m.ROWID=j.message_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
                if len(rows)==1 and rows[0][0]==guid and rows[0][1]==0 and rows[0][2]=='iMessage' and rows[0][3]==sender and len(attachments)==1:
                    path=os.path.expanduser(attachments[0][0].replace('~','/Users/meganavery',1));base='/Users/meganavery/Library/Messages/Attachments/'
                    if path.startswith(base) and os.path.realpath(path)==path:
                        try:
                            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd)
                            try:found=stat.S_ISREG(s.st_mode) and s.st_size==plan['png_bytes'] and sha(os.read(fd,plan['png_bytes']+1))==plan['png_sha256']
                            finally:os.close(fd)
                        except OSError:pass
                if found:break
                time.sleep(0.5)
        finally:db.close()
        check(identity()==before);result_json={'complete':found,'guid':guid,'receiver_sha256':plan['png_sha256'] if found else None,'identity_unchanged':True}
    else:raise RuntimeError('unsupported action')
except Exception:
    result_json={'complete':False,'acknowledged':False,'outcome':'unconfirmed-no-resend','stage':phase}
finally:
    if before is not None:
        try:check(identity()==before)
        except Exception:result_json={'complete':False,'acknowledged':False,'outcome':'unconfirmed-no-resend','stage':'identity-after'}
print(json.dumps(result_json))
`;
async function remoteMedia(action,plan,extra={}){
 for(const item of plan.reviewed_files??[]){assert.ok(REVIEWED_FILES.includes(item.path));assert.equal(hash(readFileSync(resolve(root,item.path))),item.sha256,'reviewed harness changed');}
 if(action!=='audit'){assert.equal(plan.reviewed_files?.length,REVIEWED_FILES.length);assert.equal(plan.caller_sha256,hash(CALLER_SOURCE));}
 const sources=action==='prepare'?Object.fromEntries(plan.sources.map(({path,sha256})=>{const bytes=readFileSync(resolve(root,'imessage-server/mac-server',path));assert.equal(hash(bytes),sha256,'source changed after review');return[path,bytes.toString('base64')];})):undefined;
 const payload={action,plan,...extra,...(sources?{sources,caller:CALLER_SOURCE}: {})};
 return await new Promise((yes,no)=>{const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','chert-m4d','sudo','-n','python3','-'],{stdio:['pipe','pipe','pipe']});let out='',size=0;const timer=setTimeout(()=>child.kill(),action==='prepare'?90000:45000);child.stdout.on('data',b=>{size+=b.length;if(size>65536)child.kill();else out+=b;});child.stderr.on('data',b=>{size+=b.length;if(size>65536)child.kill();});child.on('error',()=>{clearTimeout(timer);no(Error('Remote media evidence unavailable; never resend'));});child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);yes(JSON.parse(out));}catch{no(Error('Remote media evidence unavailable; never resend'));}});child.stdin.end(REMOTE_PROGRAM.replace('PAYLOAD',Buffer.from(JSON.stringify(payload)).toString('base64')));});
}
/** Historical entry point retained for callers; never starts an obsolete live broker. */
export async function startReviewedLiveBroker(_planPath,_journalPath,_reviewFlag,_beforeDispatch){
 throw Error('Historical media broker disabled: attachment-operations/v1 requires compatible installed server/helper source binding and actual versioned HTTP caller; run local operationPreflight only');
}
/** Read-only installed process/source audit; returns hashes only, never account values. */
export async function auditReviewedMediaBindings(priorReceiptPath){
 const prior=privateJSON(priorReceiptPath);assert.equal(prior.value.passed,true);assert.equal(prior.value.attempted,true);assert.equal(prior.value.environment,'reviewed-live');assert.equal(prior.value.outcome,'exact-guid-recipient-imessage-confirmed');
 assert.equal(prior.value.native?.guid,prior.value.recipient?.guid);assert.match(prior.value.native?.guid,/^[a-fA-F0-9-]{36}$/);
 return remoteMedia('audit',{run:randomUUID(),approved_guid:prior.value.native.guid,bindings:{}});
}
