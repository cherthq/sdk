import { mkdtemp, chmod, open, readFile, rename, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export interface OnboardInput { baseUrl: string; phone: string; consent: boolean; agent: string; target: 'project'|'personal'; projectLabel?: string; detached?: boolean; preferFaceTime?: boolean }
interface HelperState { schema: 1; baseUrl: string; sessionId: string; capability: string; expiresAt: number; createdAt: number; state: string; agent: string; target: 'project'|'personal'; remoteCancellation?: boolean }
export interface OnboardDeps { fetch?: typeof fetch; now?: () => number; pause?: (ms:number)=>Promise<void>; temporaryRoot?: string; emit?: (event:Record<string,unknown>)=>void; detach?: (file:string)=>void; scheduleExpiry?: (file:string)=>Promise<void>|void }
const TTL = 2 * 60 * 60 * 1000;
export class OnboardError extends Error {}
export function trustedOrigin(input:string):string {
  let url:URL; try { url=new URL(input); } catch { throw new OnboardError('Supply a trusted --base-url HTTPS origin.'); }
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new OnboardError('Use a trusted HTTPS origin, or localhost HTTP, with no path or credentials.');
  return url.origin;
}
async function atomic(file:string,value:string):Promise<void>{
  const temp=`${file}.${randomUUID()}.tmp`;const handle=await open(temp,'wx',0o600);
  try{
    try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
    await rename(temp,file);
  }finally{await rm(temp,{force:true});}
}
async function stateFile(file:string):Promise<HelperState>{
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>16384||(process.platform!=='win32'&&(info.mode&0o077)))throw new OnboardError('Helper state must be an owner-only regular file.');
  const parent=await lstat(resolve(file,'..'));if(!parent.isDirectory()||parent.isSymbolicLink()||(process.platform!=='win32'&&(parent.mode&0o077)))throw new OnboardError('Helper directory must be owner-only.');
  const state=JSON.parse(await readFile(file,'utf8')) as HelperState;
  if(state.schema!==1||typeof state.sessionId!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(state.sessionId)||typeof state.capability!=='string'||(!['complete','cancelled'].includes(state.state)&&(state.capability.length<32||state.capability.length>1024))||!Number.isFinite(state.expiresAt)||!Number.isFinite(state.createdAt)||state.expiresAt>state.createdAt+TTL)throw new OnboardError('Invalid helper state.');
  trustedOrigin(state.baseUrl);return state;
}
async function request(base:string,path:string,options:RequestInit,deps:OnboardDeps):Promise<Record<string,unknown>>{
  let response:Response;
  try{response=await(deps.fetch??fetch)(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...options.headers}});}catch{throw new OnboardError('Onboarding service is unavailable. Check status before starting another session.');}
  const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
  if(reader){try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw new OnboardError('Onboarding response exceeded its limit.');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}
  if(!response.ok)throw new OnboardError(`Onboarding service refused the step (HTTP ${response.status}). Use status to inspect the existing session; no connection is claimed.`);
  let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new OnboardError('Invalid onboarding service response.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new OnboardError('Invalid onboarding service response.');
  const envelope=parsed as Record<string,unknown>;return (envelope.data&&typeof envelope.data==='object'?envelope.data:envelope) as Record<string,unknown>;
}
function safeState(value:unknown):string{return typeof value==='string'&&/^[a-z][a-z0-9_-]{0,60}$/.test(value)?value:'unknown';}
function expiration(value:unknown):number {return typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;}
export async function startOnboarding(input:OnboardInput,deps:OnboardDeps={}):Promise<Record<string,unknown>>{
  const baseUrl=trustedOrigin(input.baseUrl);
  if(!/^\+[1-9]\d{7,14}$/.test(input.phone))throw new OnboardError('Supply --phone in E.164 form, such as +14155550123.');
  if(!input.consent)throw new OnboardError('Explain that Chert will contact this phone for onboarding, then obtain --consent-contact from the user.');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/.test(input.agent))throw new OnboardError('Supply a short --agent name for the originating agent.');
  const label=input.projectLabel?.replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,100);
  const data=await request(baseUrl,'/sessions',{method:'POST',body:JSON.stringify({phone:input.phone,contactConsent:true,originAgent:input.agent,target:{kind:input.target,...(label?{projectLabel:label}:{})},resumeStrategy:input.detached?'poll':'manual',ttlSeconds:TTL/1000,...(input.preferFaceTime?{preferFaceTime:true}:{})})},deps);
  const createdAt=(deps.now??Date.now)(),end=Math.min(expiration(data.expiresAt),createdAt+TTL);
  if(typeof data.sessionId!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(data.sessionId)||typeof data.pollCapability!=='string'||data.pollCapability.length<32||data.pollCapability.length>1024||!Number.isFinite(end)||end<=createdAt)throw new OnboardError('Server did not return a valid session capability. Do not start a second session without checking with Chert.');
  const directory=await mkdtemp(join(deps.temporaryRoot??tmpdir(),'chert-onboarding-'));await chmod(directory,0o700);
  const file=join(directory,'state.json');
  const state:HelperState={schema:1,baseUrl,sessionId:data.sessionId,capability:data.pollCapability,expiresAt:end,createdAt,state:safeState(data.state),agent:input.agent,target:input.target};
  await atomic(file,JSON.stringify(state)+'\n');
  if(deps.scheduleExpiry){try{await deps.scheduleExpiry(file);}catch{throw new OnboardError(`Could not start automatic expiry cleanup. Keep the saved helper at ${file}; run onboard-cleanup after use.`);}}
  const summary={automaticCleanup:!!deps.scheduleExpiry,status:'pending',sessionId:state.sessionId,state:state.state,helperFile:file,expiresAt:new Date(end).toISOString(),message:'Chert will guide the user on the consented phone. Keep the helper running, or use onboard-status with this file. Completion writes a protected handoff; it does not inject instructions into another agent.'};
  deps.emit?.(summary);
  if(input.detached){
    if(deps.detach)deps.detach(file);else{await new Promise<void>((done,fail)=>{const child=spawn(process.execPath,[process.argv[1],'onboard-watch','--state',file],{detached:true,stdio:'ignore'});child.once('error',()=>fail(new OnboardError('Could not detach the helper. Run onboard-watch with the saved helper path.')));child.once('spawn',()=>{child.unref();done();});});}
    return {...summary,detached:true};
  }
  return summary;
}
async function pollUnlocked(file:string,deps:OnboardDeps={}):Promise<Record<string,unknown>>{
  const state=await stateFile(file),now=(deps.now??Date.now)();
  if(now>=state.expiresAt){await eraseHelper(file);return {status:'expired',message:'The local helper expired and its capability and handoff were removed. The remote session must also enforce its TTL.'};}
  if(state.state==='complete')return {status:'complete',handoffFile:join(resolve(file,'..'),'continuation.md'),completionFile:join(resolve(file,'..'),'completion.json')};
  if(state.state==='cancelled')return {status:'cancelled'};
  if(state.state==='handoff_saved')return acknowledgeSavedHandoff(file,state,deps);
  const data=await request(state.baseUrl,`/sessions/${encodeURIComponent(state.sessionId)}`,{method:'GET',headers:{Authorization:`Bearer ${state.capability}`}},deps);
  const phase=safeState(data.state);
  if(data.sessionId!==state.sessionId)throw new OnboardError('Onboarding session identity mismatch.');
  if(['failed','expired','cancelled','denied'].includes(phase)){await rm(file,{force:true});return {status:phase,message:'Onboarding stopped. No connected worker is claimed.'};}
  if(phase!=='ready')return {status:'pending',state:phase,phoneVerified:data.phoneVerified===true,passkeyRegistered:data.passkeyRegistered===true,next:'The user should follow the instructions sent by Chert. Run onboard-status again or keep onboard-watch running.'};
  const completion=await request(state.baseUrl,`/sessions/${encodeURIComponent(state.sessionId)}/claim`,{method:'POST',headers:{Authorization:`Bearer ${state.capability}`},body:'{}'},deps);
  validateCompletion(completion,state);
  const directory=resolve(file,'..'),completionFile=join(directory,'completion.json'),handoffFile=join(directory,'continuation.md');
  await atomic(completionFile,JSON.stringify(completion,null,2)+'\n');
  const prompt=`# Continue Chert setup\n\nThe user completed Chert concierge onboarding for this ${state.target}. Read the protected completion.json beside this file. Do not print its credentials. Reuse the confirmed project and line; do not repeat signup, payment or allocation. Inspect the returned connector kind and follow its supported runtime instructions. Configure only the intended project or persistent agent, keep secrets outside source control, and run read-only readiness checks first. Ask the user before any real call or message. Report the exact remaining runtime or provider requirements; a receipt is not proof of working media.\n`;
  await atomic(handoffFile,prompt);
  const saved={...state,state:'handoff_saved'};
  await atomic(file,JSON.stringify(saved)+'\n');
  return acknowledgeSavedHandoff(file,saved,deps);
}
function validateCompletion(completion:Record<string,unknown>,state:HelperState):void {
  if(!completion||typeof completion!=='object'||Array.isArray(completion)||completion.sessionId!==state.sessionId||typeof completion.deliveryId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(completion.deliveryId)||typeof completion.projectId!=='string'||!completion.projectId||!completion.connector||typeof completion.connector!=='object'||Array.isArray(completion.connector)||!['existing-connector','hosted-webhook'].includes(String((completion.connector as Record<string,unknown>).kind)))throw new OnboardError('Invalid completion receipt. Retry the existing helper; do not start another paid setup.');
}
async function protectedHandoff(file:string):Promise<string>{
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536||(process.platform!=='win32'&&(info.mode&0o077)))throw new OnboardError('Saved handoff must be an owner-only regular file.');
  return readFile(file,'utf8');
}
async function acknowledgeSavedHandoff(file:string,state:HelperState,deps:OnboardDeps):Promise<Record<string,unknown>>{
  const directory=resolve(file,'..'),completionFile=join(directory,'completion.json'),handoffFile=join(directory,'continuation.md');
  let completion:Record<string,unknown>;
  try{completion=JSON.parse(await protectedHandoff(completionFile));}catch{throw new OnboardError('Saved completion receipt is unavailable. Keep this helper and request reconciliation.');}
  validateCompletion(completion,state);
  await protectedHandoff(handoffFile);
  const acknowledged=await request(state.baseUrl,`/sessions/${encodeURIComponent(state.sessionId)}/claim/ack`,{method:'POST',headers:{Authorization:`Bearer ${state.capability}`},body:JSON.stringify({deliveryId:completion.deliveryId})},deps);
  if(acknowledged.sessionId!==state.sessionId||acknowledged.state!=='claimed'||acknowledged.deliveryId!==completion.deliveryId)throw new OnboardError('Completion acknowledgement did not match. Retry this helper; its saved handoff is protected.');
  await atomic(file,JSON.stringify({...state,state:'complete',capability:''})+'\n');
  return {status:'complete',completionFile,handoffFile,message:'Read continuation.md in the originating agent. No arbitrary shell command or automatic agent injection was executed.'};
}
export async function watchOnboarding(file:string,deps:OnboardDeps={}):Promise<Record<string,unknown>>{
  for(let attempt=0;attempt<1441;attempt++){
    const result=await pollOnboarding(file,deps);if(result.status!=='pending')return result;
    await(deps.pause??(ms=>delay(ms)))(5000);
  }
  throw new OnboardError('Helper reached its polling bound; inspect its status.');
}
async function cancelUnlocked(file:string,deps:OnboardDeps):Promise<Record<string,unknown>>{
  const state=await stateFile(file);
  if((deps.now??Date.now)()>=state.expiresAt){await eraseHelper(file);return {status:'expired',remoteCancellation:false,message:'Expired local helper and handoff removed. Remote cancellation was not confirmed; the service must enforce its session expiry.'};}
  if(state.state==='complete')return {status:'complete',remoteCancellation:false,message:'The completion receipt is already available; cancelling setup does not revoke an allocated line or subscription.'};
  if(state.state==='cancelled')return {status:'cancelled',remoteCancellation:state.remoteCancellation===true,message:state.remoteCancellation===true?'Local polling stopped and the service confirmed cancellation.':'Local polling stopped. Remote cancellation was not confirmed; contact may continue until the service expires or stops the session.'};
  // Erase the persisted capability before HTTP; the lock fences concurrent polling/claiming.
  const cancelled={...state,state:'cancelled',capability:'',remoteCancellation:false};
  await atomic(file,JSON.stringify(cancelled)+'\n');
  let remoteCancellation=false;
  try{
    const response=await request(state.baseUrl,`/sessions/${encodeURIComponent(state.sessionId)}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${state.capability}`},body:'{}'},deps);
    remoteCancellation=response.sessionId===state.sessionId&&response.state==='cancelled';
  }catch{/* Local cancellation remains effective even when the remote request is unavailable or uncertain. */}
  await atomic(file,JSON.stringify({...cancelled,remoteCancellation})+'\n');
  return {status:'cancelled',remoteCancellation,message:remoteCancellation?'Local polling stopped, its capability was erased, and the service confirmed cancellation.':'Local polling stopped and its capability was erased. Remote cancellation was not confirmed; contact may continue until the service expires or stops the session.'};
}

async function eraseHelper(file:string):Promise<void>{for(const name of ['completion.json','continuation.md','state.json'])await rm(join(resolve(file,'..'),name),{force:true});}
async function cleanupUnlocked(file:string):Promise<Record<string,unknown>>{await stateFile(file);await eraseHelper(file);return {status:'cleaned',message:'Local helper state and protected handoff removed. No remote account or line was changed.'};}

async function withLock(file:string,operation:()=>Promise<Record<string,unknown>>):Promise<Record<string,unknown>>{
  await stateFile(file);const lock=join(resolve(file,'..'),'poll.lock');let handle;
  try{handle=await open(lock,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return {status:'pending',state:'helper_busy',message:'Another helper is polling or claiming this session.'};throw error;}
  try{return await operation();}finally{await handle.close();await rm(lock,{force:true});}
}

export async function pollOnboarding(file:string,deps:OnboardDeps={}):Promise<Record<string,unknown>>{return withLock(file,()=>pollUnlocked(file,deps));}
export async function cancelOnboarding(file:string,deps:OnboardDeps={}):Promise<Record<string,unknown>>{return withLock(file,()=>cancelUnlocked(file,deps));}
export async function cleanupOnboarding(file:string):Promise<Record<string,unknown>>{return withLock(file,()=>cleanupUnlocked(file));}

/** Local-only expiry watcher. It never polls a service or cancels paid resources. */
export async function reapExpiredOnboarding(file:string,deps:OnboardDeps={}):Promise<Record<string,unknown>>{
  let deadline:number|undefined,announced=false,busyAttempts=0;
  for(;;){
    let state:HelperState;
    try{state=await stateFile(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {status:'cleaned'};throw error;}
    if(!announced){deps.emit?.({type:'expiry-ready'});announced=true;}
    deadline=Math.min(deadline??state.expiresAt,state.expiresAt);
    const remaining=deadline-(deps.now??Date.now)();
    if(remaining>0){await(deps.pause??(ms=>delay(ms)))(Math.min(60000,remaining));continue;}
    const result=await withLock(file,async()=>{await eraseHelper(file);return {status:'expired'};});
    if(result.state!=='helper_busy')return result;
    if(++busyAttempts>=60)return {status:'cleanup_blocked',message:'Another helper holds the local lock. Inspect that process before retrying cleanup.'};
    // Let an already-running bounded poll finish; do not race its credential writes.
    await(deps.pause??(ms=>delay(ms)))(1000);
  }
}
