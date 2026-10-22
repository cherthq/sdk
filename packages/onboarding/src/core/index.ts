import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import type {OnboardingStore,Session,State,Plan,Target,ResumeStrategy,PublicSession,ClaimPayload,Outbox} from './types';
import {OnboardingError} from './types';
import type {MessagingProvider,AllocationProvider} from '../providers/types';
export * from './types';export * from './sqlite-store';export type * from '../providers/types';
const terminal=new Set<State>(['claimed','cancelled','expired','failed']);
export interface CoreOptions {store:OnboardingStore;secretKey:Uint8Array;mainLine:string;messaging:MessagingProvider;allocator?:AllocationProvider;now?:()=>number}
export interface CreateSession {phone:string;contactConsent:true;originAgent:string;target:Target;resumeStrategy:ResumeStrategy;ttlSeconds?:number;preferFaceTime?:boolean}
/** Trusted server orchestration; HTTP handlers must authenticate callbacks and browser actions separately. */
export class OnboardingCore {
 private readonly store:OnboardingStore;private readonly key:Buffer;private readonly now:()=>number;
 constructor(private readonly options:CoreOptions){if(options.secretKey.length!==32)throw new Error('A 32-byte server encryption key is required');this.key=Buffer.from(options.secretKey);this.store=options.store;this.now=options.now??Date.now;this.normalizePhone(options.mainLine);}
 private hash(domain:string,value:string){return createHmac('sha256',this.key).update(domain+'\0'+value).digest('hex');}
 private seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
 private open<T>(sealed:string):T{const bytes=Buffer.from(sealed,'base64url'),cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')) as T;}
 private normalizePhone(phone:string){if(typeof phone!=='string'||!/^\+[1-9]\d{7,14}$/.test(phone))throw new OnboardingError('invalid_phone',422);return phone;}
 private session(id:string){const s=this.store.getSession(id);if(!s)throw new OnboardingError('session_not_found',404);return s;}
 private active(id:string){const s=this.session(id);if(s.expiresAt<=this.now()||s.state==='expired')throw new OnboardingError('session_expired',410);if(terminal.has(s.state))throw new OnboardingError('session_closed');return s;}
 private requireState(s:Session,...states:State[]){if(!states.includes(s.state))throw new OnboardingError('invalid_state');}
 private save(s:Session){const version=s.version;s.version++;if(!this.store.saveSession(s,version))throw new OnboardingError('concurrent_update');}
 private authorize(s:Session,capability:string){const expected=Buffer.from(s.capabilityHash,'hex'),actual=Buffer.from(this.hash('poll',capability),'hex');if(!timingSafeEqual(expected,actual))throw new OnboardingError('unauthorized',401);}
 private snapshot(s:Session):PublicSession{return {sessionId:s.id,version:s.version,state:s.state,expiresAt:s.expiresAt,originAgent:s.originAgent,target:s.target,resumeStrategy:s.resumeStrategy,phoneVerified:s.phoneVerified,passkeyRegistered:s.passkeyRegistered,...(s.plan?{plan:s.plan}:{}),...(s.failure?{failure:s.failure}:{})};}
 private enqueue(s:Session,suffix:string,kind:Outbox['kind'],payload:unknown){this.store.addOutbox({id:s.id+':'+suffix,sessionId:s.id,kind,sealedPayload:this.seal(payload),status:'pending',attempts:0,availableAt:this.now(),leaseUntil:0});}
 createSession(input:CreateSession){
  if(input.contactConsent!==true)throw new OnboardingError('contact_consent_required',422);
  const phone=this.normalizePhone(input.phone);
  if(!input.originAgent||input.originAgent.length>80||/[\x00-\x1f]/.test(input.originAgent)||!['personal','project'].includes(input.target?.kind)||!['poll','manual'].includes(input.resumeStrategy)||(input.target.projectLabel!==undefined&&(input.target.projectLabel.length>200||/[\x00-\x1f]/.test(input.target.projectLabel))))throw new OnboardingError('invalid_context',422);
  const ttl=input.ttlSeconds??7200;if(!Number.isInteger(ttl)||ttl<300||ttl>7200)throw new OnboardingError('invalid_expiry',422);
  return this.store.transaction(()=>{
   const now=this.now(),phoneHash=this.hash('phone',phone);if(!this.store.consumeRate('contact:'+phoneHash,now,3600000,3))throw new OnboardingError('rate_limited',429);
   let user=this.store.getUser(phoneHash);if(!user){user={id:randomUUID(),phoneHash,phoneSealed:this.seal(phone),verifiedAt:null};this.store.putUser(user);}
   const id=randomUUID(),capability=randomBytes(32).toString('base64url'),code=String(randomInt(100000,1000000));
   const session:Session={id,version:0,state:'contact_pending',createdAt:now,expiresAt:now+ttl*1000,capabilityHash:this.hash('poll',capability),phoneHash,phoneSealed:this.seal(phone),userId:user.id,originAgent:input.originAgent,target:{...input.target},resumeStrategy:input.resumeStrategy,challengeHash:this.hash('challenge',id+':'+code),challengeExpiresAt:Math.min(now+600000,now+ttl*1000),challengeAttempts:0,phoneVerified:false,passkeyRegistered:false};
   this.store.insertSession(session);
   this.enqueue(session,'welcome','message',{text:`Chert setup for ${input.originAgent}. Reply ${code} to verify this number. Code expires in 10 minutes. You asked us to contact you; no payment or call has been made.`,welcome:true});
   if(input.preferFaceTime)this.enqueue(session,'facetime','facetime',{});
   return {sessionId:id,pollCapability:capability,expiresAt:session.expiresAt,state:session.state};
  });
 }
 getSession(id:string,capability:string){return this.store.transaction(()=>{const s=this.session(id);this.authorize(s,capability);if(s.expiresAt<=this.now()&&!terminal.has(s.state)){s.state='expired';s.checkoutUrl=undefined;s.readySealed=undefined;this.save(s);this.store.cancelOutbox(id);}return this.snapshot(s);});}
 /** Use only after authenticating the provider signature and replay timestamp on raw webhook bytes. */
 acceptVerifiedInbound(input:{eventId:string;sessionId:string;from:string;body:string}){
  const result=this.store.transaction(()=>{const s=this.active(input.sessionId);this.requireState(s,'phone_pending');if(!input.eventId||input.eventId.length>200)throw new OnboardingError('invalid_event',422);if(!this.store.putEvent('inbound:'+input.eventId))return {accepted:false,replayed:true};
   if(this.hash('phone',this.normalizePhone(input.from))!==s.phoneHash)return {accepted:false,error:'sender_mismatch'};
   if(this.now()>=s.challengeExpiresAt)return {accepted:false,error:'challenge_expired'};
   if(s.challengeAttempts>=5)return {accepted:false,error:'challenge_locked'};
   s.challengeAttempts++;if(this.hash('challenge',s.id+':'+input.body.trim())!==s.challengeHash){this.save(s);return {accepted:false,error:'invalid_code'};}
   s.phoneVerified=true;s.state='passkey_pending';const user=this.store.getUser(s.phoneHash)!;user.verifiedAt=this.now();this.store.putUser(user);this.save(s);
   this.enqueue(s,'phone-verified','message',{text:'Number verified. Continue in your secure browser page to create or use a passkey, then choose your plan. Never send passwords or passkeys here.'});return {accepted:true};
  });return result;
 }
 registrationContext(id:string){const s=this.active(id);this.requireState(s,'passkey_pending');return {userId:s.userId,phoneVerified:s.phoneVerified,state:s.state};}
 /** This callback is not WebAuthn verification. The server must verify RP ID, origin, challenge, user presence and attestation first. */
 registerVerifiedPasskey(input:{sessionId:string;userId:string;credentialId:string;publicKey:string;counter:number}){return this.store.transaction(()=>{const s=this.active(input.sessionId);this.requireState(s,'passkey_pending');if(!s.phoneVerified||input.userId!==s.userId||!input.credentialId||!input.publicKey||!Number.isSafeInteger(input.counter)||input.counter<0)throw new OnboardingError('identity_mismatch',403);const existing=this.store.getPasskey(input.credentialId);if(existing&&existing.userId!==s.userId)throw new OnboardingError('credential_already_bound',403);if(existing)throw new OnboardingError('credential_exists');this.store.putPasskey({credentialId:input.credentialId,userId:s.userId,publicKey:input.publicKey,counter:input.counter,createdAt:this.now()});s.passkeyRegistered=true;s.state='plan_pending';this.save(s);return {userId:s.userId};});}
 acceptVerifiedPasskey(input:{sessionId:string;userId:string;credentialId:string;counter:number}){return this.store.transaction(()=>{const s=this.active(input.sessionId);this.requireState(s,'passkey_pending');const credential=this.store.getPasskey(input.credentialId);if(!s.phoneVerified||s.userId!==input.userId||credential?.userId!==s.userId||!Number.isSafeInteger(input.counter)||input.counter<0||(credential.counter!==0&&input.counter<=credential.counter))throw new OnboardingError('identity_mismatch',403);credential.counter=input.counter;this.store.putPasskey(credential);s.passkeyRegistered=true;s.state='plan_pending';this.save(s);return {userId:s.userId};});}
 choosePlan(id:string,plan:Plan){return this.store.transaction(()=>{const s=this.active(id);this.requireState(s,'plan_pending');if(!['shared','dedicated'].includes(plan))throw new OnboardingError('invalid_plan',422);s.plan=plan;s.state='payment_pending';this.save(s);return {plan,currency:'usd' as const,amount:plan==='shared'?2500:25000,interval:'month' as const};});}
 attachCheckout(id:string,input:{checkoutId:string;url:string;plan:Plan}){return this.store.transaction(()=>{const s=this.active(id);this.requireState(s,'payment_pending');if(input.plan!==s.plan||!input.checkoutId||(s.checkoutId&&s.checkoutId!==input.checkoutId))throw new OnboardingError('checkout_mismatch');let url:URL;try{url=new URL(input.url);}catch{throw new OnboardingError('invalid_checkout');}if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw new OnboardingError('invalid_checkout');s.checkoutId=input.checkoutId;s.checkoutUrl=input.url;this.save(s);});}
 /** Call after Stripe raw-body signature, amount/currency/interval, customer and session metadata validation. */
 recordVerifiedPayment(input:{sessionId:string;eventId:string;checkoutId:string;plan:Plan}){return this.store.transaction(()=>{const s=this.active(input.sessionId);if(!input.eventId||input.eventId.length>200)throw new OnboardingError('invalid_event',422);if(s.checkoutId!==input.checkoutId||s.plan!==input.plan)throw new OnboardingError('checkout_mismatch');if(!this.store.putEvent('stripe:'+input.eventId))return {replayed:true};if(s.state==='provisioning'||s.state==='ready')return {replayed:true};this.requireState(s,'payment_pending');s.paymentEvent=input.eventId;s.checkoutUrl=undefined;s.state='provisioning';this.save(s);this.enqueue(s,'allocation','allocate',{});return {replayed:false};});}
 completeProvisioning(id:string,payload:Omit<ClaimPayload,'sessionId'|'userId'|'target'|'originAgent'|'resumeStrategy'>){return this.store.transaction(()=>{const s=this.active(id);this.requireState(s,'provisioning');if(!payload.projectId||!payload.allocationId||!payload.entitlementId||!['existing-connector','hosted-webhook'].includes(payload.connector?.kind)||!payload.connector.configuration||Object.values(payload.connector.configuration).some(v=>typeof v!=='string'))throw new OnboardingError('allocation_invalid');const ready:ClaimPayload={...payload,sessionId:id,userId:s.userId,target:s.target,originAgent:s.originAgent,resumeStrategy:s.resumeStrategy};s.readySealed=this.seal(ready);s.state='ready';this.save(s);this.enqueue(s,'ready','message',{text:`Chert is ready for ${s.originAgent}. Return to your original agent to claim the setup securely. Keep the local agent and connector running unless you deploy them.`});});}
 claim(id:string,capability:string){return this.store.transaction(()=>{const s=this.active(id);this.authorize(s,capability);this.requireState(s,'ready');const result=this.open<ClaimPayload>(s.readySealed!);s.readySealed=undefined;s.state='claimed';this.save(s);return result;});}
 cancel(id:string,capability:string){return this.store.transaction(()=>{const s=this.session(id);this.authorize(s,capability);if(terminal.has(s.state))return; s.state='cancelled';s.readySealed=undefined;s.checkoutUrl=undefined;this.save(s);this.store.cancelOutbox(id);});}
 failSession(id:string,reason:'provider_unavailable'|'allocation_rejected'|'payment_failed'){return this.store.transaction(()=>{const s=this.active(id);if(!['provider_unavailable','allocation_rejected','payment_failed'].includes(reason))throw new OnboardingError('invalid_failure',422);s.state='failed';s.failure=reason;s.readySealed=undefined;s.checkoutUrl=undefined;this.save(s);this.store.cancelOutbox(id);});}
 async flushOutbox(limit=20){let delivered=0;for(const item of this.store.dueOutbox(this.now(),Math.min(100,Math.max(1,limit)))){
  const lease=this.store.transaction(()=>{const s=this.session(item.sessionId);if(s.expiresAt<=this.now()||terminal.has(s.state)){item.status='cancelled';this.store.saveOutbox(item);return undefined;}return this.store.claimOutbox(item.id,this.now(),this.now()+60000);});if(!lease)continue;
  try{const s=this.active(item.sessionId),phone=this.open<string>(s.phoneSealed),payload=this.open<{text?:string;welcome?:boolean}>(item.sealedPayload);
   let faceTime:'requested'|'busy'|'unavailable'|undefined;
   let allocation:Omit<ClaimPayload,'sessionId'|'target'|'originAgent'|'resumeStrategy'|'userId'>|undefined;
   if(item.kind==='message')await this.options.messaging.sendMessage({to:phone,from:this.options.mainLine,text:payload.text!,idempotencyKey:item.id});
   else if(item.kind==='facetime')faceTime=await this.options.messaging.requestFaceTime?.({to:phone,from:this.options.mainLine,sessionId:s.id,idempotencyKey:item.id})??'unavailable';
   else if(s.state!=='ready'){if(!this.options.allocator)throw new Error('allocator_unavailable');allocation=await this.options.allocator.allocate({sessionId:s.id,userId:s.userId,phone,plan:s.plan!,checkoutId:s.checkoutId!,target:s.target,idempotencyKey:item.id});}
   const completed=this.store.transaction(()=>{
    if(!this.store.ownsOutboxLease(item.id,lease))return false;
    const current=this.session(item.sessionId);
    if(current.expiresAt<=this.now()||terminal.has(current.state)){item.status='cancelled';return this.store.saveOutbox(item,lease);}
    if(allocation)this.completeProvisioning(current.id,allocation);
    if(faceTime&&faceTime!=='requested')this.enqueue(current,'facetime-fallback','message',{text:'FaceTime is busy or unavailable. We can continue setup here by iMessage and in your secure browser page.'});
    if(payload.welcome&&current.state==='contact_pending'){current.state='phone_pending';this.save(current);}
    item.status='done';item.leaseUntil=0;return this.store.saveOutbox(item,lease);
   });if(completed)delivered++;
  }catch{this.store.transaction(()=>{item.attempts++;item.status='pending';item.leaseUntil=0;item.availableAt=this.now()+Math.min(300000,1000*2**Math.min(item.attempts,8));this.store.saveOutbox(item,lease);});}
 }return {delivered};}
}
