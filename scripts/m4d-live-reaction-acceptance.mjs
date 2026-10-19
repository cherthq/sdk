// Source-only controlled remove-love acceptance. Import performs no device actions.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,writeSync,fsyncSync,renameSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {REMOTE_TEXT_PROGRAM} from './m4d-live-text-acceptance.mjs';
const root=resolve(import.meta.dirname,'../..');
const sha=v=>createHash('sha256').update(v).digest('hex');
const uuid=/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/;
const hex=/^[a-f0-9]{64}(?![\s\S])/;
const phone=/^\+[1-9][0-9]{1,14}(?![\s\S])/;
export const REACTION_FILES=['imessage-server/lib/messaging/received-context.ts','imessage-server/lib/messaging/received-context-ledger.ts','imessage-server/docs/migrations/26_messaging-received-contexts.sql','sdk/scripts/m4d-live-reaction-acceptance.mjs','sdk/scripts/m4d-live-text-acceptance.mjs','sdk/packages/linq-adapter/src/index.ts','imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts','imessage-server/lib/sending/reaction-target.ts','imessage-server/lib/sending/reaction-operation.ts','imessage-server/lib/sending/reserved-reaction-operation.ts','imessage-server/docs/migrations/25_messaging-reaction-operations.sql','sdk/tests/linq-reaction-postgrest.fixture.mjs','sdk/tests/linq-reaction-postgrest.sql','sdk/tests/linq-reaction-postgrest.test.ts','scripts/test-webhook-postgrest.sh','sdk/package.json','sdk/bun.lock','sdk/packages/linq-adapter/package.json','sdk/packages/imessage/src/index.ts','imessage-server/lib/messaging/auth.ts','imessage-server/lib/api-shape/auth-bridge.ts','imessage-server/lib/sending/text-operation-context.ts','imessage-server/app/api/v1/messages/[id]/route.ts','imessage-server/lib/api-shape/internal-to-chert.ts','sdk/packages/imessage/dist/index.js','sdk/packages/imessage/package.json','sdk/tests/next-route-platform.mjs','imessage-server/lib/core/supabase.ts'];
function privateParent(path){const s=lstatSync(dirname(path));assert.ok(s.isDirectory()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700);}
function privateJSON(path,nonsecret=false){assert.ok(typeof path==='string'&&path.startsWith('/'));privateParent(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);assert.ok(s.isFile()&&s.uid===process.getuid()&&(nonsecret?(s.mode&0o022)===0:(s.mode&0o777)===0o600)&&s.nlink===1&&s.size<=1048576);const bytes=readFileSync(fd);return{path:realpathSync(path),sha256:sha(bytes),value:JSON.parse(bytes)};}finally{closeSync(fd);}}
function persist(path,value,create=false){privateParent(path);const fd=openSync(create?path:path+'.next',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{const bytes=Buffer.from(JSON.stringify(value));let n=0;while(n<bytes.length)n+=writeSync(fd,bytes,n,bytes.length-n);fsyncSync(fd);}finally{closeSync(fd);}if(!create)renameSync(path+'.next',path);const dir=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}}
export function reactionFingerprint(body){return sha(JSON.stringify(['chert-reaction-once-v1',body.from,body.to,body.targetGuid,body.partIndex,body.reaction,body.remove]).replace(/\//g,'\\/'));}
/** Validate the immutable actual first-love export without inventing approval fields. */
export function prepareReactionPlan(manifestPath,installationPath,nativeLovePath,targetTextProofPath,run=randomUUID()){
 assert.match(run,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/);
 const manifest=privateJSON(manifestPath,true),installed=privateJSON(installationPath),love=privateJSON(nativeLovePath);
 assert.equal(manifest.value.kind,'local-native-candidate-not-installed');assert.equal(manifest.value.inputs_unchanged_after_build,true);
 const bindings=installed.value;assert.equal(bindings.kind,'reviewed-native-installation');assert.equal(bindings.host,'chert-m4d');assert.equal(bindings.candidate_manifest_sha256,manifest.sha256);
 for(const [key,artifact] of [['service_sha256','mac-server'],['helper_sha256','chert-imsg-bridge.dylib']]){assert.match(bindings[key],hex);assert.equal(bindings[key],manifest.value.artifacts?.[artifact]?.sha256);}
 for(const key of ['sender_sha256','recipient_sha256','account_login_sha256','approved_chat_guid_sha256'])assert.match(bindings[key],hex);
 for(const key of ['server_pid','messages_pid'])assert.ok(Number.isSafeInteger(bindings[key])&&bindings[key]>0);
 const proof=privateJSON(targetTextProofPath),proofValue=proof.value;
 assert.equal(proofValue.kind,'readonly-controlled-target-text-proof');assert.equal(proofValue.sends,0);assert.deepEqual(proofValue.exact_decoded_matches,{sender:true,recipient:true});
 assert.equal(typeof proofValue.text,'string');assert.ok(proofValue.text.length>0&&!proofValue.text.includes('\0')&&Buffer.byteLength(proofValue.text,'utf8')<=16384&&Buffer.from(proofValue.text,'utf8').toString('utf8')===proofValue.text);
 assert.equal(proofValue.text_sha256,sha(proofValue.text));for(const key of ['sender_body_sha256','recipient_body_sha256','decoder_sha256','source_export_sha256','original_plan_sha256'])assert.match(proofValue[key],hex);
 assert.deepEqual(proofValue.decoder_format,{sender:'NSArchiver-typedstream-v4',recipient:'NSArchiver-typedstream-v4'});
 const v=love.value;assert.deepEqual(Object.keys(v).sort(),['reaction-native-attempt-receipt.json','reaction-native-post.spent.json','reaction-native-response.json']);
 const attempt=v['reaction-native-attempt-receipt.json'],response=v['reaction-native-response.json'],spent=v['reaction-native-post.spent.json'],ack=response.body;
 for(const key of ['attempted','ack_valid','readonly_ledger_confirmed','event_delivery_passed'])assert.equal(attempt[key],true);
 assert.equal(attempt.native_posts,1);assert.equal(attempt.native_status,202);assert.deepEqual(attempt.exact_reaction_event_sender_recipient,[true,true]);assert.equal(attempt.application_proven,false);assert.equal(attempt.retry_permitted,false);
 assert.equal(attempt.server_pid,bindings.server_pid);assert.equal(attempt.messages_pid,bindings.messages_pid);
 assert.equal(response.status,202);const tuple={origin:ack.origin,from:ack.from,to:ack.to,targetGuid:ack.targetGuid,partIndex:0,reaction:'love',remove:false};
 assert.match(tuple.origin,/^reaction_[a-f0-9]{32}(?![\s\S])/);assert.match(tuple.from,phone);assert.match(tuple.to,phone);assert.match(tuple.targetGuid,uuid);assert.ok(validAck(ack,tuple));
 assert.equal(proofValue.target_guid,tuple.targetGuid);
 assert.equal(sha(tuple.from),bindings.sender_sha256);assert.equal(sha(tuple.to),bindings.recipient_sha256);assert.equal(sha(ack.preparedGuid),attempt.prepared_guid_sha256);
 assert.equal(spent.attempted,true);assert.equal(spent.max_posts,1);assert.equal(spent.origin,tuple.origin);assert.equal(spent.fingerprint,ack.fingerprint);assert.match(spent.plan_sha256,hex);assert.match(spent.request_sha256,hex);
 return{version:2,plan:'one-reviewed-linq-remove-love-v2',host:'chert-m4d',provider:'linq',run,receipt_path:resolve(dirname(installed.path),run+'.reaction.receipt.json'),approved_guid:tuple.targetGuid,target_guid:tuple.targetGuid,target_text:proofValue.text,target_text_sha256:proofValue.text_sha256,target_body_sha256:{sender:proofValue.sender_body_sha256,recipient:proofValue.recipient_body_sha256},prior_reaction_guid:ack.preparedGuid,prior_origin:tuple.origin,reaction:'love',remove:true,part_index:0,bindings,files:{manifest:{path:manifest.path,sha256:manifest.sha256},installation:{path:installed.path,sha256:installed.sha256},native_love:{path:love.path,sha256:love.sha256},proof:{path:proof.path,sha256:proof.sha256}},reviewed_files:REACTION_FILES.map(path=>({path,sha256:sha(readFileSync(resolve(root,path)))})),attempted:false};
}
function pairBinding(plan){return Object.fromEntries(['service_sha256','helper_sha256','server_pid','messages_pid','sender_sha256','recipient_sha256'].map(key=>[key,plan.bindings[key]]));}
export function prepareLikeReactionPlan(manifest,installation,love,proof,options,run=randomUUID()){
 assert.ok(options&&typeof options==='object'&&!Array.isArray(options));assert.equal(options.reaction,'like');assert.equal(typeof options.remove,'boolean');
 assert.deepEqual(Object.keys(options).sort(),options.remove?['priorLikeReceiptPath','reaction','remove']:['reaction','remove']);
 const base=prepareReactionPlan(manifest,installation,love,proof,run);
 let prior;
 if(options.remove){
  prior=privateJSON(options.priorLikeReceiptPath);const receipt=prior.value,claim=receipt.claim,body=claim?.body;
  assert.equal(receipt.attempted,true);assert.equal(receipt.passed,true);assert.equal(receipt.native_http_status,202);assert.deepEqual(receipt.sdk_acceptance,{status:'accepted'});assert.deepEqual(receipt.bindings,pairBinding(base));
  assert.ok(body&&Object.keys(body).sort().join()==='from,origin,partIndex,reaction,remove,targetGuid,to');
  assert.equal(body.targetGuid,base.target_guid);assert.equal(body.reaction,'like');assert.equal(body.remove,false);assert.equal(body.partIndex,0);assert.match(body.origin,/^reaction_[a-f0-9]{32}(?![\s\S])/);assert.equal(claim.operationId,body.origin.slice(9));assert.equal(claim.fingerprint,reactionFingerprint(body));assert.equal(sha(body.from),base.bindings.sender_sha256);assert.equal(sha(body.to),base.bindings.recipient_sha256);assert.match(claim.plan_sha256,hex);assert.match(claim.body_sha256,hex);
  assert.match(receipt.native_guid,uuid);assert.notEqual(receipt.native_guid.toLowerCase(),base.target_guid.toLowerCase());
  assert.deepEqual(receipt.evidence,{complete:true,guid:receipt.native_guid,associated_message_type:2001,associated_message_guid:'p:0/'+base.target_guid,sender_exact:true,recipient_exact:true});
 }
 return{...base,version:3,plan:'one-reviewed-linq-like-v3',reaction:'like',remove:options.remove,receipt_path:resolve(dirname(base.files.installation.path),run+'.like-'+(options.remove?'remove':'add')+'.receipt.json'),...(prior?{prior_like_guid:prior.value.native_guid,prior_like_origin:prior.value.claim.body.origin,files:{...base.files,prior_like:{path:prior.path,sha256:prior.sha256}}}:{})};
}
export function loadReactionPlan(path){const p=privateJSON(path).value;const args=[p.files.manifest.path,p.files.installation.path,p.files.native_love.path,p.files.proof.path];const rebuilt=p.version===3?prepareLikeReactionPlan(...args,{reaction:'like',remove:p.remove,...(p.remove?{priorLikeReceiptPath:p.files.prior_like.path}:{})},p.run):prepareReactionPlan(...args,p.run);assert.deepEqual(p,rebuilt,'Reaction plan source changed');return p;}
function identityMatches(v,p){assert.equal(v.ready,true);for(const key of ['service_sha256','helper_sha256','server_pid','messages_pid'])assert.equal(v[key],p.bindings[key]);for(const key of ['sender','recipient']){assert.match(v[key],phone);assert.equal(sha(v[key]),p.bindings[key+'_sha256']);}assert.notEqual(v.sender,v.recipient);}
function validAck(v,b){return v&&Object.keys(v).sort().join()==='fingerprint,from,origin,partIndex,preparedGuid,reaction,remove,state,targetGuid,to'&&Object.entries(b).every(([k,x])=>v[k]===x)&&v.fingerprint===reactionFingerprint(b)&&v.state==='acknowledged'&&typeof v.preparedGuid==='string'&&uuid.test(v.preparedGuid)&&v.preparedGuid.toLowerCase()!==b.targetGuid.toLowerCase();}
export async function createReactionGateway(plan,journalPath,identity,verifyReservation,execute){
 identityMatches(identity,plan);assert.equal(typeof verifyReservation,'function');assert.equal(typeof execute,'function');privateParent(journalPath);
 persist(journalPath,{run:plan.run,attempted:false,passed:false,plan_sha256:sha(JSON.stringify(plan)),bindings:pairBinding(plan)},true);
 const apiKey=randomBytes(32).toString('hex'),signingSecret=randomBytes(32).toString('hex');let spent=false,receipt=privateJSON(journalPath).value;
 const save=v=>{receipt={...receipt,...v};persist(journalPath,receipt);};
 const failure=()=>Response.json({error:{code:4103,retryable:false,message:'Reaction outcome unconfirmed; never resend'}},{status:502});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){try{
  const url=new URL(request.url);assert.equal(request.method,'POST');assert.equal(url.pathname,'/api/v1/reaction-operations/v1');assert.equal(url.search,'');assert.equal(request.headers.get('authorization'),'Bearer '+apiKey);
  const reader=request.body?.getReader();assert.ok(reader);const chunks=[];let size=0;try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>4096){await reader.cancel();throw Error('Body bound');}chunks.push(next.value);}}finally{reader.releaseLock();}
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));const sig=/^v1,([0-9]+),([a-f0-9]{64})(?![\s\S])/.exec(request.headers.get('x-chert-signature')??'');assert.ok(sig&&Math.abs(Date.now()/1000-Number(sig[1]))<=300);assert.ok(timingSafeEqual(createHmac('sha256',signingSecret).update(`${sig[1]}.${raw}`).digest(),Buffer.from(sig[2],'hex')));
  request.signal.throwIfAborted();const body=JSON.parse(raw);assert.deepEqual(Object.keys(body).sort(),['from','origin','partIndex','reaction','remove','targetGuid','to']);assert.match(body.origin,/^reaction_[a-f0-9]{32}(?![\s\S])/);assert.notEqual(body.origin,plan.prior_origin);assert.notEqual(body.origin,plan.prior_like_origin);assert.equal(body.from,identity.sender);assert.equal(body.to,identity.recipient);assert.equal(body.targetGuid,plan.target_guid);assert.equal(body.partIndex,0);assert.equal(body.reaction,plan.reaction??'love');assert.equal(body.remove,plan.remove??true);assert.equal(spent,false);
  const claim={operationId:body.origin.slice(9),body,fingerprint:reactionFingerprint(body),body_sha256:sha(raw),plan_sha256:sha(JSON.stringify(plan))};
  assert.equal(await verifyReservation(claim),true,'Actual reservation not confirmed');identityMatches(await execute({action:'preflight',plan,claim}),plan);
  assert.equal(await verifyReservation(claim),true);request.signal.throwIfAborted();assert.equal(spent,false);
  persist(journalPath+'.spent',{run:plan.run,...claim},true);spent=true;save({attempted:true,claim,outcome:'spent-before-native-POST'});
  let result;try{result=await execute({action:'send',plan,claim,body,raw});}catch{save({outcome:'unknown-no-resend'});return failure();}
  if(result?.status!==202||!validAck(result.body,body)){save({outcome:'unknown-no-resend'});return failure();}
  save({native_guid:result.body.preparedGuid,native_http_status:202,outcome:'native-dispatch-acknowledged'});return Response.json(result.body,{status:202});
 }catch{return failure();}}});
 return{nativeOrigin:server.url.origin,apiKey,signingSecret,sender:identity.sender,recipient:identity.recipient,targetText:identity.targetText,recordSDKAcceptance(value){assert.equal(spent,true);assert.ok(receipt.native_guid);assert.deepEqual(value,{status:'accepted'});save({sdk_acceptance:{status:'accepted'}});},async observe(guid){assert.ok(spent&&guid===receipt.native_guid);const result=await execute({action:'observe',plan,guid});identityMatches(await execute({action:'identity',plan}),plan);assert.equal(result.complete,true);assert.equal(result.guid,guid);assert.equal(result.associated_message_type,plan.version===3?(plan.remove?3001:2001):3000);assert.equal(result.associated_message_guid,'p:0/'+plan.target_guid);assert.equal(result.sender_exact,true);assert.equal(result.recipient_exact,true);save({passed:true,outcome:plan.version===3?('exact-guid-like-'+(plan.remove?'remove':'add')+'-both-accounts'):'exact-guid-remove-love-both-accounts',observed_at:new Date().toISOString(),evidence:result});return{passed:true,receiptPath:journalPath,receiptSha256:sha(readFileSync(journalPath))};},close:()=>server.stop(true)};
}
// Reuse only the reviewed fixed-host identity/config/HTTP prelude. No text send branch.
const prefixEnd=REMOTE_TEXT_PROGRAM.indexOf('\ndef claim_origin():');
assert.ok(prefixEnd>0);
export const REMOTE_REACTION_PROGRAM=REMOTE_TEXT_PROGRAM.slice(0,prefixEnd)+String.raw`
def exact_pair(guid,kind):
 check(re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',guid))
 for home,outgoing,peer in [('/Users/chert',1,recipient),('/Users/meganavery',0,sender)]:
  db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
  try:
   rows=db.execute('SELECT m.guid,m.is_from_me,m.service,m.associated_message_type,m.associated_message_guid,m.destination_caller_id,h.id,c.chat_identifier,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID),m.error,c.account_login FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid COLLATE BINARY=? LIMIT 2',(guid,)).fetchall()
   if len(rows)!=1:return False
   r=rows[0]
   if not(r[0]==guid and r[1]==outgoing and r[2]=='iMessage' and r[3]==kind and r[4]=='p:0/'+plan['target_guid'] and r[7]==peer and r[8]==1 and r[9]==0 and (r[5]==sender and sha(r[10].encode())==B['account_login_sha256'] if outgoing else r[6]==sender)):return False
  finally:db.close()
 return True
def target_text():
 text=None
 for home,outgoing,peer in [('/Users/chert',1,recipient),('/Users/meganavery',0,sender)]:
  db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
  try:
   rows=db.execute('SELECT m.guid,m.is_from_me,m.service,m.text,m.destination_caller_id,h.id,c.chat_identifier,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID),m.error,m.attributedBody FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid COLLATE BINARY=? LIMIT 2',(plan['target_guid'],)).fetchall();check(len(rows)==1);r=rows[0]
   check(r[0]==plan['target_guid'] and r[1]==outgoing and r[2]=='iMessage' and r[6]==peer and r[7]==1 and r[8]==0 and (r[4]==sender if outgoing else r[5]==sender))
   body=r[9];key='sender' if outgoing else 'recipient'
   check(isinstance(body,bytes) and 0<len(body)<=1048576 and sha(body)==plan['target_body_sha256'][key])
   check(r[3] is None or r[3]==plan['target_text'])
   if not outgoing:text=plan['target_text']
  finally:db.close()
 check(isinstance(text,str) and 0<len(text.encode('utf-8'))<=16384 and chr(0) not in text)
 check(sha(text.encode('utf-8'))==plan['target_text_sha256'])
 return text
def admit():
 if plan['version']!=3:check(exact_pair(plan['prior_reaction_guid'],2000));return
 if plan['remove']:check(exact_pair(plan['prior_like_guid'],2001));return
 for home in ['/Users/chert','/Users/meganavery']:
  db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
  try:
   count=db.execute('SELECT count(*) FROM message WHERE associated_message_type=2001 AND associated_message_guid COLLATE BINARY=?',('p:0/'+plan['target_guid'],)).fetchone()[0];check(count==0)
  finally:db.close()
def claim_body():
 c=p['claim'];body=c['body'];check(set(body)=={'origin','from','to','targetGuid','partIndex','reaction','remove'})
 check(re.fullmatch(r'reaction_[a-f0-9]{32}',body['origin']) and body['origin']!=plan['prior_origin'] and body['origin']!=plan.get('prior_like_origin') and c['operationId']==body['origin'][9:])
 check(body['from']==sender and body['to']==recipient and body['targetGuid']==plan['target_guid'] and type(body['partIndex']) is int and body['partIndex']==0 and body['reaction']==plan['reaction'] and type(body['remove']) is bool and body['remove']==plan['remove'])
 fp=json.dumps(['chert-reaction-once-v1',sender,recipient,body['targetGuid'],0,plan['reaction'],plan['remove']],separators=(',',':'),ensure_ascii=False).replace('/',chr(92)+'/')
 check(c['fingerprint']==sha(fp.encode()) and c['plan_sha256']==sha(json.dumps(plan,separators=(',',':'),ensure_ascii=False).encode()))
 return body
try:
 before=identity();before['targetText']=target_text()
 if action=='identity':out=before
 elif action=='preflight':
  admit()
  body=claim_body();r=request('/api/v1/reaction-operations/v1/'+body['origin']+'?from='+urllib.parse.quote(sender,safe=''));check(r['status']==404 and r['body']=={'origin':body['origin'],'found':False});out=before
 elif action=='send':
  admit()
  body=claim_body();check(p['body']==body);raw=p['raw'].encode();check(json.loads(raw)==body and sha(raw)==p['claim']['body_sha256']);out=request('/api/v1/reaction-operations/v1',raw);check({**identity(),'targetText':target_text()}==before)
 elif action=='observe':
  guid=p['guid'];end=time.monotonic()+40;found=False
  while time.monotonic()<end:
   if exact_pair(guid,(3001 if plan['remove'] else 2001) if plan['version']==3 else 3000):found=True;break
   time.sleep(.5)
  check({**identity(),'targetText':target_text()}==before);out={'complete':found,'guid':guid,'associated_message_type':((3001 if plan['remove'] else 2001) if plan['version']==3 else 3000),'associated_message_guid':'p:0/'+plan['target_guid'],'sender_exact':found,'recipient_exact':found}
 else:raise RuntimeError('unsupported action')
except Exception:out={'ready':False,'complete':False,'outcome':'unknown-no-resend'}
print(json.dumps(out))
`;
async function remoteReaction(payload){return new Promise((yes,no)=>{const child=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','chert-m4d','sudo','-n','python3','-'],{stdio:['pipe','pipe','pipe']});let out='',size=0;const timer=setTimeout(()=>child.kill(),80000);const fail=()=>no(Error('Reaction outcome unavailable; never resend'));child.stdout.on('data',bytes=>{size+=bytes.length;if(size>65536)child.kill();else out+=bytes;});child.stderr.on('data',bytes=>{size+=bytes.length;if(size>65536)child.kill();});child.on('error',()=>{clearTimeout(timer);fail();});child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);yes(JSON.parse(out));}catch{fail();}});child.stdin.end(REMOTE_REACTION_PROGRAM.replace('PAYLOAD',Buffer.from(JSON.stringify(payload)).toString('base64')));});}
export async function startReviewedReactionBroker(planPath,journalPath,flag,verifyReservation){const plan=loadReactionPlan(planPath);assert.equal(flag,plan.version===3?'--live-one-linq-like':'--live-one-linq-remove-love');assert.equal(resolve(realpathSync(dirname(journalPath)),basename(journalPath)),plan.receipt_path);assert.equal(existsSync(journalPath),false);assert.equal(existsSync(journalPath+'.spent'),false);const identity=await remoteReaction({action:'identity',plan});identityMatches(identity,plan);return{plan,...await createReactionGateway(plan,journalPath,identity,verifyReservation,remoteReaction)};}
