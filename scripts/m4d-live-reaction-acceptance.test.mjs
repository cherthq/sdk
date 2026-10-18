import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {createReactionGateway,reactionFingerprint,prepareReactionPlan,prepareLikeReactionPlan,loadReactionPlan,REMOTE_REACTION_PROGRAM} from './m4d-live-reaction-acceptance.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),target='11111111-2222-4333-8444-555555555555',guid='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const identity={ready:true,sender:'+15550000001',recipient:'+15550000002',server_pid:1,messages_pid:2,service_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64)};
function plan(){return{version:2,reaction:'love',remove:true,run:'11000000-0000-4000-8000-000000000001',target_guid:target,prior_origin:'reaction_'+'0'.repeat(32),bindings:{...identity,sender_sha256:sha(identity.sender),recipient_sha256:sha(identity.recipient)}};}
function folder(){const p=mkdtempSync(join(tmpdir(),'chert-reaction-offline-'));chmodSync(p,0o700);return p;}
function json(path,value){writeFileSync(path,JSON.stringify(value),{mode:0o600});}
async function setup({verify=async()=>true,mode='good',customPlan}={}){let effects=0;const path=join(folder(),'receipt.json');const p=customPlan??plan();const broker=await createReactionGateway(p,path,identity,verify,async({action,body,guid:g})=>{if(action==='send'){effects++;if(mode==='throw')throw Error('private');return{status:202,body:{...body,...(mode==='wrongkind'?{reaction:'love'}:{}),fingerprint:reactionFingerprint(body),preparedGuid:mode==='wrong'?target:guid,state:'acknowledged'}};}if(action==='observe')return{complete:true,guid:g,associated_message_type:p.version===3?(p.remove?3001:2001):3000,associated_message_guid:'p:0/'+target,sender_exact:true,recipient_exact:true};return identity;});return{broker,path,effects:()=>effects};}
async function send(broker,bodyOverrides={},headerOverrides={}){const body={origin:'reaction_'+'c'.repeat(32),from:identity.sender,to:identity.recipient,targetGuid:target,partIndex:0,reaction:'love',remove:true,...bodyOverrides};const raw=JSON.stringify(body),ts=Math.floor(Date.now()/1000);return fetch(broker.nativeOrigin+'/api/v1/reaction-operations/v1',{method:'POST',headers:{Authorization:'Bearer '+broker.apiKey,'x-chert-signature':`v1,${ts},${createHmac('sha256',broker.signingSecret).update(`${ts}.${raw}`).digest('hex')}`,...headerOverrides},body:raw});}
test('remove-love claim is durable before one executor call and repeated request cannot resend',async()=>{const f=await setup();try{const r=await send(f.broker);expect(r.status).toBe(202);expect(existsSync(f.path+'.spent')).toBe(true);expect(JSON.parse(readFileSync(f.path)).attempted).toBe(true);f.broker.recordSDKAcceptance({status:'accepted'});expect(JSON.parse(readFileSync(f.path)).sdk_acceptance).toEqual({status:'accepted'});expect(()=>f.broker.recordSDKAcceptance({status:'applied'})).toThrow();expect((await f.broker.observe(guid)).passed).toBe(true);expect((await send(f.broker)).status).toBe(502);expect(f.effects()).toBe(1);}finally{f.broker.close();}});
test('invalid tuple/auth/unconfirmed reservation makes zero effects and no spent claim',async()=>{for(const change of [{remove:false},{targetGuid:guid},{partIndex:1},{reaction:'like'}]){const f=await setup();try{expect((await send(f.broker,change)).status).toBe(502);expect(f.effects()).toBe(0);expect(existsSync(f.path+'.spent')).toBe(false);}finally{f.broker.close();}}const f=await setup({verify:async()=>false});try{expect((await send(f.broker)).status).toBe(502);expect(f.effects()).toBe(0);expect(existsSync(f.path+'.spent')).toBe(false);}finally{f.broker.close();}const a=await setup();try{expect((await send(a.broker,{}, {Authorization:'Bearer wrong'})).status).toBe(502);expect(a.effects()).toBe(0);}finally{a.broker.close();}});
test('unknown or malformed ACK stays spent and cannot repeat',async()=>{for(const mode of ['throw','wrong']){const f=await setup({mode});try{expect((await send(f.broker)).status).toBe(502);expect((await send(f.broker)).status).toBe(502);expect(f.effects()).toBe(1);expect(JSON.parse(readFileSync(f.path)).passed).toBe(false);}finally{f.broker.close();}}});
test('two concurrent requests share one permanent claim',async()=>{let n=0,release;const ready=new Promise(resolve=>release=resolve);const f=await setup({verify:async()=>{if(++n===2)release();if(n<=2)await ready;return true;}});try{const results=await Promise.all([send(f.broker),send(f.broker)]);expect(results.filter(r=>r.status===202)).toHaveLength(1);expect(f.effects()).toBe(1);}finally{f.broker.close();}});
test('plan validates actual first-love export and source mutation invalidates loaded plan',()=>{const dir=folder(),m=join(dir,'manifest.json'),i=join(dir,'installation.json'),l=join(dir,'love.json'),p=join(dir,'plan.json'),proof=join(dir,'proof.json');const manifest={kind:'local-native-candidate-not-installed',inputs_unchanged_after_build:true,artifacts:{'mac-server':{sha256:identity.service_sha256},'chert-imsg-bridge.dylib':{sha256:identity.helper_sha256}}};json(m,manifest);chmodSync(m,0o644);json(i,{kind:'reviewed-native-installation',host:'chert-m4d',candidate_manifest_sha256:sha(readFileSync(m)),...plan().bindings,account_login_sha256:'e'.repeat(64),approved_chat_guid_sha256:'f'.repeat(64)});const body={origin:'reaction_'+'0'.repeat(32),from:identity.sender,to:identity.recipient,targetGuid:target,partIndex:0,reaction:'love',remove:false};const ack={...body,fingerprint:reactionFingerprint(body),preparedGuid:guid,state:'acknowledged'};json(l,{'reaction-native-attempt-receipt.json':{attempted:true,ack_valid:true,readonly_ledger_confirmed:true,event_delivery_passed:true,native_posts:1,native_status:202,exact_reaction_event_sender_recipient:[true,true],application_proven:false,retry_permitted:false,server_pid:1,messages_pid:2,prepared_guid_sha256:sha(guid)},'reaction-native-response.json':{status:202,body:ack},'reaction-native-post.spent.json':{attempted:true,max_posts:1,origin:body.origin,fingerprint:ack.fingerprint,plan_sha256:'a'.repeat(64),request_sha256:'b'.repeat(64)}});json(proof,{kind:'readonly-controlled-target-text-proof',sends:0,target_guid:target,text:'actual target text',text_sha256:sha('actual target text'),sender_body_sha256:'a'.repeat(64),recipient_body_sha256:'b'.repeat(64),decoder_sha256:'c'.repeat(64),source_export_sha256:'d'.repeat(64),original_plan_sha256:'e'.repeat(64),exact_decoded_matches:{sender:true,recipient:true},decoder_format:{sender:'NSArchiver-typedstream-v4',recipient:'NSArchiver-typedstream-v4'}});expect(()=>prepareReactionPlan(m,i,l)).toThrow();const prepared=prepareReactionPlan(m,i,l,proof);json(p,prepared);expect(loadReactionPlan(p)).toEqual(prepared);const like=prepareLikeReactionPlan(m,i,l,proof,{reaction:'like',remove:false});expect(like.version).toBe(3);expect(like.remove).toBe(false);const likeReceipt=join(dir,'like-passed.json');const likeBody={...body,origin:'reaction_'+'c'.repeat(32),reaction:'like',remove:false};const bindingKeys=['service_sha256','helper_sha256','server_pid','messages_pid','sender_sha256','recipient_sha256'];const passed={attempted:true,passed:true,native_http_status:202,native_guid:guid,sdk_acceptance:{status:'accepted'},bindings:Object.fromEntries(bindingKeys.map(k=>[k,like.bindings[k]])),claim:{operationId:likeBody.origin.slice(9),body:likeBody,fingerprint:reactionFingerprint(likeBody),plan_sha256:'a'.repeat(64),body_sha256:'b'.repeat(64)},evidence:{complete:true,guid,associated_message_type:2001,associated_message_guid:'p:0/'+target,sender_exact:true,recipient_exact:true}};json(likeReceipt,passed);const removal=prepareLikeReactionPlan(m,i,l,proof,{reaction:'like',remove:true,priorLikeReceiptPath:likeReceipt});expect(removal.prior_like_guid).toBe(guid);expect(()=>prepareLikeReactionPlan(m,i,l,proof,{reaction:'like',remove:true})).toThrow();json(likeReceipt,{...passed,sdk_acceptance:undefined});expect(()=>prepareLikeReactionPlan(m,i,l,proof,{reaction:'like',remove:true,priorLikeReceiptPath:likeReceipt})).toThrow();const originalProof=JSON.parse(readFileSync(proof));json(proof,{...originalProof,text:'changed'});expect(()=>loadReactionPlan(p)).toThrow();json(proof,originalProof);json(p,{...prepared,remove:false});expect(()=>loadReactionPlan(p)).toThrow();expect(REMOTE_REACTION_PROGRAM).toContain("if exact_pair(guid,");expect(REMOTE_REACTION_PROGRAM).not.toContain("action=='send':\n  body=p['body'];check(set(body)=={'origin','from','to','text'}");});
test('remote Python claim validation uses the same exact frozen fingerprint without running remote code',()=>{const body={origin:'reaction_'+'c'.repeat(32),from:identity.sender,to:identity.recipient,targetGuid:target,partIndex:0,reaction:'love',remove:true},p=plan();const claim={operationId:body.origin.slice(9),body,fingerprint:reactionFingerprint(body),plan_sha256:sha(JSON.stringify(p))};const python=String.raw`import ast,json,hashlib,re,sys
source,payload=json.load(sys.stdin)
tree=ast.parse(source)
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='claim_body')
ns={'p':payload,'plan':payload['plan'],'sender':payload['claim']['body']['from'],'recipient':payload['claim']['body']['to'],'json':json,'re':re,'sha':lambda x:hashlib.sha256(x).hexdigest(),'check':lambda x:None if x else (_ for _ in ()).throw(ValueError('refused'))}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<claim-only>','exec'),ns)
assert ns['claim_body']()==payload['claim']['body']
`;const result=Bun.spawnSync(['python3','-c',python],{stdin:Buffer.from(JSON.stringify([REMOTE_REACTION_PROGRAM,{plan:p,claim}]))});expect(result.exitCode).toBe(0);expect(result.stdout.length).toBe(0);expect(result.stderr.length).toBe(0);});

test('aborted local request cannot forward and existing receipt cannot start a second broker',async()=>{const f=await setup();try{const controller=new AbortController();controller.abort();await expect(fetch(f.broker.nativeOrigin+'/api/v1/reaction-operations/v1',{method:'POST',signal:controller.signal})).rejects.toThrow();expect(f.effects()).toBe(0);await expect(createReactionGateway(plan(),f.path,identity,async()=>true,async()=>identity)).rejects.toThrow();expect(f.effects()).toBe(0);}finally{f.broker.close();}});
test('remote target proof requires both exact pinned blobs and refuses conflicting scalar text',()=>{const python=String.raw`import ast,json,hashlib,sys
source=json.load(sys.stdin)
fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='target_text')
text='  exact / Café\r\n  ';blob=b'fixed-own-test-blob';sender='+15550000001';recipient='+15550000002';target='11111111-2222-4333-8444-555555555555';bad_blob=False;bad_text=False
class DB:
 def __init__(self,path):self.outgoing='/Users/chert/' in path
 def execute(self,sql,args=None):return self
 def fetchall(self):
  peer=recipient if self.outgoing else sender
  return [(target,int(self.outgoing),'iMessage','wrong' if bad_text else None,sender,peer,peer,1,0,b'changed' if bad_blob else blob)]
 def close(self):pass
class SQLite:
 @staticmethod
 def connect(path,**kwargs):return DB(path)
sha=lambda x:hashlib.sha256(x).hexdigest()
ns={'plan':{'target_guid':target,'target_text':text,'target_text_sha256':sha(text.encode()),'target_body_sha256':{'sender':sha(blob),'recipient':sha(blob)}},'sender':sender,'recipient':recipient,'sqlite3':SQLite,'sha':sha,'check':lambda x:None if x else (_ for _ in ()).throw(ValueError('refused'))}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<target-only>','exec'),ns)
assert ns['target_text']()==text
for mode in ['blob','text']:
 bad_blob=mode=='blob';bad_text=mode=='text'
 try:ns['target_text']();raise AssertionError('accepted conflicting proof')
 except ValueError:pass
`;const result=Bun.spawnSync(['python3','-c',python],{stdin:Buffer.from(JSON.stringify(REMOTE_REACTION_PROGRAM))});expect(result.exitCode).toBe(0);expect(result.stdout.length).toBe(0);expect(result.stderr.length).toBe(0);});
test('remote observation does not require the add record that Apple removes, but admission does',()=>{const python=String.raw`import ast,json,sys
source=json.load(sys.stdin)
branch=next(n for n in ast.parse(source).body if isinstance(n,ast.Try))
prior_present=False;prior_checks=0
def pair(guid,kind):
 global prior_checks
 if kind==2000:prior_checks+=1;return prior_present
 return guid=='removal' and kind==3000
class Clock:
 @staticmethod
 def monotonic():return 0
 @staticmethod
 def sleep(x):raise AssertionError('unexpected observation retry')
def run(action):
 ns={'action':action,'plan':{'version':2,'prior_reaction_guid':'prior','target_guid':'target'},'p':{'guid':'removal'},'identity':lambda:{'ready':True},'target_text':lambda:'exact','admit':lambda:None if pair('prior',2000) else (_ for _ in ()).throw(ValueError('missing prior')),'exact_pair':pair,'check':lambda x:None if x else (_ for _ in ()).throw(ValueError('refused')),'time':Clock,'claim_body':lambda:(_ for _ in ()).throw(AssertionError('missing add reached request'))}
 exec(compile(ast.Module(body=[branch],type_ignores=[]),'<remote-dispatch-only>','exec'),ns)
 return ns['out']
assert run('observe')['complete'] is True
assert run('identity')['ready'] is True
assert prior_checks==0
assert run('preflight')['ready'] is False
assert run('send')['ready'] is False
assert prior_checks==2
`;const result=Bun.spawnSync(['python3','-c',python],{stdin:Buffer.from(JSON.stringify(REMOTE_REACTION_PROGRAM))});expect(result.exitCode).toBe(0);expect(result.stdout.length).toBe(0);expect(result.stderr.length).toBe(0);});
test('fresh like add/remove each freezes one tuple and observes only its own event kind',async()=>{for(const remove of [false,true]){const f=await setup({customPlan:{...plan(),version:3,reaction:'like',remove}});try{expect((await send(f.broker,{reaction:'like',remove})).status).toBe(202);f.broker.recordSDKAcceptance({status:'accepted'});expect((await f.broker.observe(guid)).passed).toBe(true);expect((await send(f.broker,{reaction:'like',remove})).status).toBe(502);expect(f.effects()).toBe(1);}finally{f.broker.close();}}});
test('actual remote admission refuses a preexisting like or missing prior add',()=>{const python=String.raw`import ast,json,sys
source=json.load(sys.stdin);fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='admit')
count=0;prior=False;queries=0
class DB:
 def execute(self,sql,args=None):
  global queries
  if args is not None:assert args==('p:0/target',);queries+=1
  return self
 def fetchone(self):return (count,)
 def close(self):pass
class SQLite:
 @staticmethod
 def connect(*a,**k):return DB()
plan={'version':3,'remove':False,'target_guid':'target'}
ns={'plan':plan,'sqlite3':SQLite,'check':lambda x:None if x else (_ for _ in ()).throw(ValueError('refused')),'exact_pair':lambda guid,kind:prior and guid=='like-guid' and kind==2001}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<admit-only>','exec'),ns)
ns['admit']();assert queries==2
count=1
try:ns['admit']();raise AssertionError('existing like accepted')
except ValueError:pass
plan.update(remove=True,prior_like_guid='like-guid')
try:ns['admit']();raise AssertionError('missing prior accepted')
except ValueError:pass
prior=True;ns['admit']()
`;const result=Bun.spawnSync(['python3','-c',python],{stdin:Buffer.from(JSON.stringify(REMOTE_REACTION_PROGRAM))});expect(result.exitCode).toBe(0);expect(result.stdout.length).toBe(0);expect(result.stderr.length).toBe(0);});

test('like ACK with wrong reaction kind is unknown and cannot repeat',async()=>{const f=await setup({customPlan:{...plan(),version:3,reaction:'like',remove:false},mode:'wrongkind'});try{expect((await send(f.broker,{reaction:'like',remove:false})).status).toBe(502);expect((await send(f.broker,{reaction:'like',remove:false})).status).toBe(502);expect(f.effects()).toBe(1);}finally{f.broker.close();}});
