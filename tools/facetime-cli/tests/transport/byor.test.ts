import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ByorConnector } from '../../src/byor/connector.js';
import { ByorJournal } from '../../src/byor/journal.js';
import type { ByorHandler, ApplicationDecision } from '../../src/byor/contract.js';
import { ownerOf, incomingSchema, type Incoming, type Receipt, type Lifecycle, type Scope } from '../../src/protocol/v1.js';
import { ManualClock, deferred, settle } from '../fixtures/clock.js';
const scope: Scope = { project_id:'project',line_id:'line',binding_id:'binding',binding_epoch:1,instance_id:'instance',connection_generation:1,session_mode:'byor' };
const identity = { id:'app-v1',module:'/explicit/application.js' };
function incoming(clock: ManualClock): Incoming {
 return { ...scope,v:1,type:'call.incoming',message_id:'message',call_id:'call',request_id:'request',integration_revision_id:'revision',created_at:clock.wall(),sent_at:clock.wall(),deadline_at:clock.wall()+5000,prepare_deadline_at:clock.wall()+4000,remaining_ms:5000,resource_expires_at:clock.wall()+7200000,media:{audio:true,video:false} };
}
function accept(clock: ManualClock): ApplicationDecision {
 const claims = {sub:'bridge',nbf:Math.floor(clock.wall()/1000),exp:Math.floor(clock.wall()/1000)+3600,video:{room:'customer-room',roomJoin:true,canPublish:true,canSubscribe:true}};
 return {action:'accept',ready:true,session_ref:'app-session',session_expires_at:clock.wall()+600000,livekit_url:'wss://example.test',participant_token:`e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,remote_participant_identity:'agent'};
}
function receipt(i: Incoming, action: 'accept'|'decline'='accept'): Receipt { return {...ownerOf(i),v:1,type:'decision.committed',message_id:'receipt',action,call_version:1,resource_expires_at:i.resource_expires_at}; }
function ended(i: Incoming): Lifecycle { return {...ownerOf(i),v:1,type:'call.lifecycle',message_id:'terminal',event_id:'event',cursor:1,call_version:3,transition:'ended'}; }
function fixture(handler?: Partial<ByorHandler>, path?: string) {
 const clock=new ManualClock(); const journal=new ByorJournal(scope,identity,path);
 const calls={prepare:0,recover:0,lifecycle:0};
 const app: ByorHandler={version:1,async prepare(){calls.prepare++;return accept(clock);},async lifecycle(){calls.lifecycle++;return {acknowledged:true};},async recover(){calls.recover++;return {settled:true,cleanup:'clean'};},...handler};
 return {clock,journal,calls,app,connector:new ByorConnector(scope,journal,app,clock)};
}
test('BYOR coalesces preparation, carries 600s lifetime, rejects conflicts and records no wrapper resources or credentials',async()=>{
 const held=deferred<ApplicationDecision>(); const f=fixture({prepare:async()=>{f.calls.prepare++;return held.promise;}}); const i=incoming(f.clock);
 const a=f.connector.incoming(i), b=f.connector.incoming({...i,message_id:'duplicate'}); await settle();assert.equal(f.calls.prepare,1);
 await assert.rejects(f.connector.incoming({...i,deadline_at:i.deadline_at+1}),/request_conflict/);
 held.resolve(accept(f.clock)); assert.deepEqual(await a,await b); await settle();
 const saved=JSON.stringify(f.journal.snapshot());for(const banned of ['customer-room','signature','participant_token','job','dispatch','livekit_url']) assert.ok(!saved.includes(banned),banned);
 f.connector.committed(receipt(i));f.clock.advance(61000);await f.connector.tick(async()=>({status:'unknown'}));
 assert.equal(f.journal.get(i)!.cancel_requested,false);assert.equal(f.connector.debt(),1);
 f.connector.lifecycle(ended(i)); await f.connector.tick(async()=>({status:'unknown'}));assert.equal(f.connector.debt(),0);
 f.clock.advance(8000000);await f.connector.tick(async()=>{throw Error('offline');});assert.equal(f.connector.debt(),0);
});
test('late preparation after timeout stays uncertain, never prepares twice, and can clean after terminal recovery',async()=>{
 const held=deferred<ApplicationDecision>(); let settled=false;const f=fixture({prepare:async()=>{f.calls.prepare++;return held.promise;},recover:async()=>({settled,cleanup:settled?'clean':'unknown'})});const i=incoming(f.clock);
 const decision=f.connector.incoming(i);await settle();f.clock.advance(4000);assert.equal((await decision).action,'decline');
 await f.connector.tick(async()=>({status:'known',receipt:receipt(i,'decline'),terminal:true}));assert.equal(f.connector.debt(),1);
 held.resolve(accept(f.clock));await settle();assert.equal(f.journal.get(i)!.session_ref,'app-session');
 assert.equal((await f.connector.incoming(i)).action,'decline');assert.equal(f.calls.prepare,1);
 settled=true;await f.connector.tick(async()=>({status:'known',receipt:receipt(i,'decline'),terminal:true}));assert.equal(f.connector.debt(),0);
});
test('rejected local preparation and absent resources do not establish operation settlement',async()=>{
 const f=fixture({prepare:async()=>{throw Error('secret response');},recover:async()=>({settled:false,cleanup:'clean'})});const i=incoming(f.clock);
 assert.equal((await f.connector.incoming(i)).action,'decline');await settle();
 await f.connector.tick(async()=>({status:'known',receipt:receipt(i,'decline'),terminal:true}));assert.equal(f.connector.debt(),1);assert.equal(f.connector.check(),'cleanup_pending');
 assert.ok(!JSON.stringify(f.journal.snapshot()).includes('secret response'));
});
test('lost acceptance and journal reopen reconcile original operation; lifecycle ack alone leaves cleanup debt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'byor-journal-'));const path=join(dir,'journal.json');let clean=false;
 const f=fixture({recover:async()=>({settled:true,cleanup:clean?'clean':'unknown'})},path);const i=incoming(f.clock);
 try {
  await f.connector.incoming(i);await settle();const original=f.journal.get(i)!.call.operation_id;
  f.connector.disconnect();f.connector.close();f.journal.close();
  const journal=new ByorJournal(scope,identity,path);const c=new ByorConnector(scope,journal,f.app,f.clock);
  try {
   assert.equal((await c.incoming(i)).action,'decline');assert.equal(f.calls.prepare,1);
   await c.tick(async()=>({status:'known',receipt:receipt(i),terminal:false}));assert.equal(journal.get(i)!.acceptance,'accept');
   const ack=c.lifecycle(ended(i));assert.equal(ack.type,'lifecycle.ack');assert.equal(journal.get(i)!.events[0]!.acknowledged,false);
   await c.tick(async()=>({status:'unknown'}));assert.equal(c.debt(),1);assert.equal(journal.get(i)!.events[0]!.acknowledged,true);
   clean=true;await c.tick(async()=>({status:'unknown'}));assert.equal(c.debt(),0);assert.equal(journal.get(i)!.call.operation_id,original);
   c.lifecycle(ended(i));await c.tick(async()=>({status:'unknown'}));assert.equal(f.calls.lifecycle,1);
  } finally {c.close();journal.close();}
  const reopened=new ByorJournal(scope,identity,path);const recovered=new ByorConnector(scope,reopened,f.app,f.clock);
  f.clock.advance(8000000);await recovered.tick(async()=>{throw Error('offline');});assert.equal(recovered.debt(),0);recovered.close();reopened.close();
  assert.ok(!readFileSync(path,'utf8').includes('participant_token'));
  assert.throws(()=>new ByorJournal(scope,{...identity,id:'replacement'},path),/journal_unavailable/);
  assert.throws(()=>new ByorJournal({...scope,binding_id:'replacement'},identity,path),/journal_unavailable/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('missing recovery and application acknowledgment retain exact limitations; foreign and stale frames fail closed',async()=>{
 const f=fixture({recover:undefined,lifecycle:undefined});const i=incoming(f.clock);await f.connector.incoming(i);await settle();f.connector.committed(receipt(i));f.connector.lifecycle(ended(i));
 await f.connector.tick(async()=>({status:'unknown'}));assert.equal(f.connector.debt(),1);assert.ok(f.connector.diagnostics.includes('application_recovery_missing'));assert.ok(f.connector.diagnostics.includes('application_lifecycle_pending'));
 await assert.rejects(f.connector.incoming({...i,project_id:'foreign'}),/forbidden/);
 await assert.rejects(f.connector.incoming({...i,connection_generation:0}),/stale_generation/);
 assert.throws(()=>f.connector.lifecycle({...ended(i),instance_id:'foreign'}),/forbidden/);
});
test('invalid credentials decline without persisting secret values or assuming cleanup',async()=>{
 const f=fixture({prepare:async()=>({...accept(f.clock),participant_token:'secret-invalid'}) as ApplicationDecision});const i=incoming(f.clock);
 const d=await f.connector.incoming(i);assert.equal(d.action,'decline');if(d.action==='decline')assert.equal(d.reason,'credentials_invalid');assert.equal(f.connector.debt(),1);
 assert.ok(!JSON.stringify(f.journal.snapshot()).includes('secret-invalid'));
});
test('expiry during failed reconciliation never clears uncertain acceptance or invents terminal state',async()=>{
 const f=fixture();const i=incoming(f.clock);await f.connector.incoming(i);await settle();f.clock.advance(601000);
 await f.connector.tick(async()=>{throw Error('offline');});assert.equal(f.connector.debt(),1);assert.equal(f.journal.get(i)!.authoritative_terminal,false);assert.equal(f.journal.get(i)!.cancel_requested,true);
});
test('authoritative terminal before incoming suppresses preparation and remains debt-free',async()=>{
 const f=fixture();const i=incoming(f.clock);f.connector.lifecycle(ended(i));assert.equal((await f.connector.incoming(i)).action,'decline');assert.equal(f.calls.prepare,0);f.connector.committed(receipt(i,'decline'));assert.equal(f.connector.debt(),0);
});
test('terminal cleanup during an in-flight reconciliation is not undone by its stale accepted result',async()=>{
 const f=fixture();const i=incoming(f.clock);await f.connector.incoming(i);await settle();f.connector.committed(receipt(i));
 const held=deferred<{status:'known';receipt:Receipt;terminal:boolean}>();const ongoing=f.connector.tick(()=>held.promise);
 f.connector.lifecycle(ended(i));await f.connector.tick(async()=>({status:'unknown'}));assert.equal(f.connector.debt(),0);
 held.resolve({status:'known',receipt:receipt(i),terminal:false});await ongoing;assert.equal(f.connector.debt(),0);
});
test('application lifecycle replay after reopen uses the durable event identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'byor-replay-')),path=join(dir,'journal.json');const seen:string[]=[];let acknowledge=false;
 const f=fixture({lifecycle:async(_call,event)=>{seen.push(event.event_id);return {acknowledged:acknowledge};}},path);const i=incoming(f.clock);
 try {
  await f.connector.incoming(i);await settle();f.connector.committed(receipt(i));f.connector.lifecycle(ended(i));await f.connector.tick(async()=>({status:'unknown'}));assert.equal(f.connector.debt(),1);
  f.connector.close();f.journal.close();acknowledge=true;
  const journal=new ByorJournal(scope,identity,path),c=new ByorConnector(scope,journal,f.app,f.clock);
  await c.tick(async()=>({status:'unknown'}));assert.deepEqual(seen,['event','event']);assert.equal(c.debt(),0);c.close();journal.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('completed preparation duplicates cannot reuse credentials after the original deadline',async()=>{
 const f=fixture();const i=incoming(f.clock);assert.equal((await f.connector.incoming(i)).action,'accept');await settle();
 f.clock.advance(5001);const late=await f.connector.incoming({...i,message_id:'late'});assert.equal(late.action,'decline');assert.equal(f.calls.prepare,1);
});

test('BYOR preserves video through callback and journal reopen; conflicting media cannot reuse a claim',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'byor-video-'));const path=join(dir,'journal.json');
 const f=fixture({prepare:async call=>{assert.deepEqual(call.media,{audio:true,video:true});return accept(f.clock);}},path);
 const i={...incoming(f.clock),media:{audio:true,video:true}} as unknown as Incoming;
 try {
  assert.equal((await f.connector.incoming(i)).action,'accept');
  await assert.rejects(f.connector.incoming({...i,media:{audio:true,video:false}}),/request_conflict/);
  f.connector.close();f.journal.close();
  const reopened=new ByorJournal(scope,identity,path);
  try {assert.deepEqual(reopened.get(i)!.call.media,{audio:true,video:true});} finally {reopened.close();}
 } finally {f.connector.close();f.journal.close();rmSync(dir,{recursive:true,force:true});}
});

test('BYOR declines a call whose timing it cannot honour instead of failing the connection', async () => {
  const f = fixture(); const i = incoming(f.clock);
  const decision = await f.connector.incoming({ ...i, deadline_at: f.clock.wall() + 60_000, prepare_deadline_at: f.clock.wall() + 59_000, remaining_ms: 60_000 });
  assert.equal(decision.action, 'decline');
  assert.equal(decision.action === 'decline' && decision.reason, 'invalid_deadline');
  assert.equal(f.calls.prepare, 0);
  assert.deepEqual(Object.keys(f.journal.snapshot().entries), [], 'nothing is recorded for a call that was never admitted');
});
test('BYOR prepares a call that arrives with a ten-second window', async () => {
  const f = fixture(); const i = incoming(f.clock);
  const decision = await f.connector.incoming({ ...i, deadline_at: f.clock.wall() + 10_000, prepare_deadline_at: f.clock.wall() + 9_000, remaining_ms: 10_000 });
  assert.equal(decision.action, 'accept'); assert.equal(f.calls.prepare, 1);
});

for (const from of [{type:'phone_number',value:'+14155550123'},{type:'email',value:'caller@example.test'},{type:'email',value:'caller!tag@example.x'},null]) {
 test(`caller identity survives preparation, immutable retries and journal reopen: ${from?.type ?? 'unknown'}`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'caller-journal-'));const path=join(dir,'journal.json');
  try {
   let observed:unknown;
   const f=fixture({prepare:async(call)=>{observed=call;return accept(f.clock);}},path);
   const i=incomingSchema.parse({...incoming(f.clock),from});
   await f.connector.incoming(i);await settle();
   assert.deepEqual((observed as {from:unknown}).from,from);
   await assert.rejects(f.connector.incoming({...i,from:from===null?{type:'email',value:'other@example.test'}:null} as Incoming),/request_conflict/);
   f.connector.close();f.journal.close();
   const reopened=new ByorJournal(scope,identity,path);
   assert.deepEqual((reopened.get(i)!.call as {from?:unknown}).from,from);
   reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
}
test('caller field remains absent for legacy frames and malformed identities fail parsing',()=>{
 const i=incoming(new ManualClock());assert.ok(!Object.hasOwn(incomingSchema.parse(i),'from'));
 for(const from of [{type:'phone_number',value:'5551234'},{type:'email',value:'not-an-email'},{type:'email',value:'caller@example.test',extra:true}])assert.throws(()=>incomingSchema.parse({...i,from}));
});
