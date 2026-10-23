import { test, expect } from 'bun:test';
import { mkdtemp, readFile, stat, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startOnboarding, pollOnboarding, watchOnboarding, cancelOnboarding } from '../src/onboard.js';
const deliveryId='d'.repeat(43);
const receipt=()=>({sessionId,deliveryId,projectId:'project-123',connector:{kind:'existing-connector',configuration:{token:'CONNECTOR_SECRET'}}});
const acknowledgement=()=>({sessionId,deliveryId,state:'claimed'});
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
  const fetch=api([session(),{sessionId,state:'awaiting_payment',phoneVerified:true,passkeyRegistered:true},{sessionId,state:'ready'},receipt(),acknowledgement()],seen);
  const start=await startOnboarding(input,{temporaryRoot:root,fetch}),file=String(start.helperFile);
  expect((await pollOnboarding(file,{fetch})).state).toBe('awaiting_payment');
  const result=await pollOnboarding(file,{fetch});expect(result.status).toBe('complete');
  expect(await readFile(String(result.completionFile),'utf8')).toContain(secret);expect((await stat(String(result.completionFile))).mode&0o777).toBe(0o600);
  expect(await readFile(String(result.handoffFile),'utf8')).toContain('Do not print its credentials');
  expect(JSON.stringify(result)).not.toContain(secret);expect(await readFile(file,'utf8')).not.toContain(capability);
  expect((await pollOnboarding(file,{fetch})).status).toBe('complete');expect(seen).toHaveLength(5);
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

test('hosted FaceTime preference is forwarded only when explicitly selected',async()=>fixture(async root=>{
 const seen:{url:string;init?:RequestInit}[]=[];
 await startOnboarding({...input,preferFaceTime:true},{temporaryRoot:root,fetch:api([session()],seen)});
 expect(JSON.parse(String(seen[0]!.init?.body)).preferFaceTime).toBe(true);
 const plain:{url:string;init?:RequestInit}[]=[];
 await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],plain)});
 expect(JSON.parse(String(plain[0]!.init?.body)).preferFaceTime).toBeUndefined();
}));

test('lost claim response retries the existing ready receipt without starting another setup',async()=>fixture(async root=>{
 const seen:{url:string;init?:RequestInit}[]=[];
 const start=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],seen)}),file=String(start.helperFile);
 let attempted=false;
 const lost=(async(url:RequestInfo|URL,init?:RequestInit)=>{seen.push({url:String(url),init});if(String(url).endsWith('/claim')){attempted=true;throw Error('response lost');}return Response.json({sessionId,state:'ready'});}) as unknown as typeof fetch;
 await expect(pollOnboarding(file,{fetch:lost})).rejects.toThrow('unavailable');expect(attempted).toBe(true);
 expect(await readFile(file,'utf8')).toContain(capability);
 expect((await pollOnboarding(file,{fetch:api([{sessionId,state:'ready'},receipt(),acknowledgement()],seen)})).status).toBe('complete');
 expect(seen.filter(x=>x.url.endsWith('/sessions'))).toHaveLength(1);
}));
test('lost acknowledgement response resumes saved handoff and does not fetch or claim again',async()=>fixture(async root=>{
 const start=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],[])}),file=String(start.helperFile);
 const initial=api([{sessionId,state:'ready'},receipt()],[]);
 const lost=(async(url:RequestInfo|URL,init?:RequestInit)=>{if(String(url).endsWith('/ack'))throw Error('response lost');return initial(url,init);}) as unknown as typeof fetch;
 await expect(pollOnboarding(file,{fetch:lost})).rejects.toThrow('unavailable');
 expect(JSON.parse(await readFile(file,'utf8'))).toMatchObject({state:'handoff_saved',capability});
 const seen:{url:string;init?:RequestInit}[]=[];
 expect((await pollOnboarding(file,{fetch:api([acknowledgement()],seen)})).status).toBe('complete');
 expect(seen).toHaveLength(1);expect(seen[0]!.url.endsWith('/claim/ack')).toBe(true);expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({deliveryId});
 expect(await readFile(file,'utf8')).not.toContain(capability);
}));
test('saved handoff rejects tampering and mismatched acknowledgement while preserving capability',async()=>fixture(async root=>{
 const start=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],[])}),file=String(start.helperFile);
 const initial=api([{sessionId,state:'ready'},receipt(),{...acknowledgement(),deliveryId:'x'.repeat(43)}],[]);
 await expect(pollOnboarding(file,{fetch:initial})).rejects.toThrow('did not match');
 const completion=join(file,'..','completion.json');
 await writeFile(completion,JSON.stringify({...receipt(),sessionId:'wrong-session'}));
 let requests=0;const noHTTP=(async()=>{requests++;throw Error('unexpected');}) as unknown as typeof fetch;
 await expect(pollOnboarding(file,{fetch:noHTTP})).rejects.toThrow('Invalid completion');expect(requests).toBe(0);
 await writeFile(completion,JSON.stringify(receipt()));await chmod(completion,0o644);
 await expect(pollOnboarding(file,{fetch:noHTTP})).rejects.toThrow('unavailable');expect(requests).toBe(0);
 expect(await readFile(file,'utf8')).toContain(capability);
}));

test('handoff write failure never acknowledges and can retry the existing receipt',async()=>fixture(async root=>{
 const start=await startOnboarding(input,{temporaryRoot:root,fetch:api([session()],[])}),file=String(start.helperFile);
 const blocked=join(file,'..','continuation.md');await mkdir(blocked);
 const seen:{url:string;init?:RequestInit}[]=[];
 await expect(pollOnboarding(file,{fetch:api([{sessionId,state:'ready'},receipt()],seen)})).rejects.toThrow();
 expect(seen.some(x=>x.url.endsWith('/ack'))).toBe(false);expect(await readFile(file,'utf8')).toContain(capability);
 await rm(blocked,{recursive:true});
 expect((await pollOnboarding(file,{fetch:api([{sessionId,state:'ready'},receipt(),acknowledgement()],seen)})).status).toBe('complete');
 expect(seen.filter(x=>x.url.endsWith('/claim'))).toHaveLength(2);
}));
