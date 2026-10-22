import { test, expect } from 'bun:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startOnboarding, pollOnboarding, watchOnboarding, cancelOnboarding } from '../src/onboard.js';
const origin='https://chert.example',capability='SECRET_CAPABILITY_'.repeat(3),sessionId='session_123456';
async function fixture(action:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chert-onboard-test-'));try{await action(root);}finally{await rm(root,{recursive:true,force:true});}}
function api(replies:unknown[],seen:{url:string;init?:RequestInit}[]):typeof fetch{return(async(url:RequestInfo|URL,init?:RequestInit)=>{seen.push({url:String(url),init});const reply=replies.shift();if(!reply)throw new Error('Unexpected HTTP');return Response.json(reply);})as unknown as typeof fetch;}
const input={baseUrl:origin,phone:'+14155550123',consent:true,agent:'codex',target:'project' as const,projectLabel:'website'};
const session=()=>({sessionId,pollCapability:capability,expiresAt:Date.now()+60000,state:'awaiting_phone_verification'});
test('consent, phone and unsafe origin fail before HTTP',async()=>{
  const fetch=(()=>{throw new Error('No HTTP');})as unknown as typeof globalThis.fetch;
  await expect(startOnboarding({...input,consent:false},{fetch})).rejects.toThrow('consent');
  await expect(startOnboarding({...input,phone:'123'},{fetch})).rejects.toThrow('E.164');
  for(const baseUrl of ['http://example.com','https://name:password@example.com','https://example.com/path'])await expect(startOnboarding({...input,baseUrl},{fetch})).rejects.toThrow('HTTPS');
});
test('short-lived protected helper contains capability, output never does',async()=>fixture(async root=>{
  const output:unknown[]=[],seen:{url:string;init?:RequestInit}[]=[];
  const result=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],seen),emit:x=>output.push(x)});
  const file=String(result.helperFile);
  expect((await stat(file)).mode&0o777).toBe(0o600);expect((await stat(join(file,'..'))).mode&0o777).toBe(0o700);
  expect(await readFile(file,'utf8')).toContain(capability);expect(JSON.stringify([result,...output])).not.toContain(capability);expect(JSON.stringify(result)).not.toContain(input.phone);
  const body=JSON.parse(String(seen[0].init?.body));expect(body.contactConsent).toBe(true);expect(body.target).toEqual({kind:'project',projectLabel:'website'});expect(body.ttlSeconds).toBe(7200);
}));
test('pending then ready claims once and creates atomic protected handoff without secret stdout',async()=>fixture(async root=>{
  const seen:{url:string;init?:RequestInit}[]=[],secret='CONNECTOR_SECRET';
  const fetch=api([session(),{sessionId,state:'awaiting_payment',phoneVerified:true,passkeyRegistered:true},{sessionId,state:'ready'},{sessionId,projectId:'project-123',connector:{kind:'existing-connector',configuration:{token:secret}}}],seen);
  const start=await startOnboarding(input,{temporaryRoot:root,fetch}),file=String(start.helperFile);
  expect((await pollOnboarding(file,{fetch})).state).toBe('awaiting_payment');
  const result=await pollOnboarding(file,{fetch});expect(result.status).toBe('complete');
  expect(await readFile(String(result.completionFile),'utf8')).toContain(secret);expect((await stat(String(result.completionFile))).mode&0o777).toBe(0o600);
  expect(await readFile(String(result.handoffFile),'utf8')).toContain('Do not print its credentials');
  expect(JSON.stringify(result)).not.toContain(secret);expect(await readFile(file,'utf8')).not.toContain(capability);
  expect((await pollOnboarding(file,{fetch})).status).toBe('complete');expect(seen).toHaveLength(4);
  expect((seen[1].init?.headers as Record<string,string>).Authorization).toBe(`Bearer ${capability}`);
}));
test('expiry erases capability and cancel stops local polling',async()=>fixture(async root=>{
  let clock=100;
  const data={sessionId,pollCapability:capability,expiresAt:200,state:'waiting'};
  const start=await startOnboarding(input,{temporaryRoot:root,now:()=>clock,fetch:api([data],[])});clock=201;
  expect((await pollOnboarding(String(start.helperFile),{now:()=>clock})).status).toBe('expired');
  await expect(readFile(String(start.helperFile))).rejects.toThrow();
  const next=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],[])}),file=String(next.helperFile);
  expect((await cancelOnboarding(file,{fetch:api([{sessionId,state:'cancelled'}],[])})).status).toBe('cancelled');expect((await pollOnboarding(file)).status).toBe('cancelled');expect(await readFile(file,'utf8')).not.toContain(capability);
}));
test('detached helper uses explicit adapter and watcher finishes pending sequence',async()=>fixture(async root=>{
  let detached='';const fetch=api([session(),{sessionId,state:'waiting'},{sessionId,state:'failed'}],[]);
  const start=await startOnboarding({...input,detached:true},{temporaryRoot:root,fetch,detach:file=>{detached=file;}});
  expect(start.detached).toBe(true);expect(detached).toBe(String(start.helperFile));
  expect((await watchOnboarding(detached,{fetch,pause:async()=>{}})).status).toBe('failed');
}));

test('remote cancellation authenticates and confirms the session before reporting success',async()=>fixture(async root=>{
  const seen:{url:string;init?:RequestInit}[]=[];
  const fetch=api([session(),{sessionId,state:'cancelled'}],seen);
  const start=await startOnboarding(input,{temporaryRoot:root,fetch}),file=String(start.helperFile);
  const result=await cancelOnboarding(file,{fetch});expect(result).toMatchObject({status:'cancelled',remoteCancellation:true});
  expect(seen[1].url).toBe(origin+'/sessions/'+sessionId+'/cancel');expect(seen[1].init?.method).toBe('POST');expect(seen[1].init?.body).toBe('{}');
  expect((seen[1].init?.headers as Record<string,string>).Authorization).toBe('Bearer '+capability);
  expect(await readFile(file,'utf8')).not.toContain(capability);expect(JSON.stringify(result)).not.toContain(capability);
}));
test('failed remote cancellation still stops local polling without claiming remote contact ceased',async()=>fixture(async root=>{
  const start=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],[])}),file=String(start.helperFile);
  const unavailable=(async()=>Response.json({error:'unavailable'},{status:503}))as unknown as typeof fetch;
  const result=await cancelOnboarding(file,{fetch:unavailable});expect(result).toMatchObject({status:'cancelled',remoteCancellation:false});expect(String(result.message)).toContain('contact may continue');
  expect(await readFile(file,'utf8')).not.toContain(capability);expect((await pollOnboarding(file,{fetch:unavailable})).status).toBe('cancelled');
}));
