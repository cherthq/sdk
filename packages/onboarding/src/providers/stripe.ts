import {createHmac, timingSafeEqual} from 'node:crypto';
import type {Plan} from '../core/types';

type Json = Record<string, any>;
export interface StripeTestBillingOptions {secretKey:string;webhookSecret:string;prices:Record<Plan,string>;origin:string;fetch?:typeof fetch;now?:()=>number}
export interface VerifiedPayment {sessionId:string;userId:string;eventId:string;checkoutId:string;plan:Plan}
const fail=()=>new Error('stripe_verification_failed');
const id=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}[A-Za-z0-9_]{1,180}$`).test(v);
const ref=(v:any)=>typeof v==='string'?v:v?.id;
const empty=(v:any)=>v==null||(Array.isArray(v)&&v.length===0);
const one=(v:any)=>v&&v.has_more===false&&Array.isArray(v.data)&&v.data.length===1?v.data[0]:null;
/** Initial TEST-MODE onboarding only. The host must deduplicate event IDs transactionally.
 * Renewals, cancellation, refunds, disputes and entitlement revocation require a separate lifecycle reconciler.
 * Fields follow https://docs.stripe.com/api/checkout/sessions/object and /api/subscriptions/object.
 */
export class StripeTestBilling {
 private readonly options:StripeTestBillingOptions;private readonly origin:string;
 constructor(options:StripeTestBillingOptions){
  if(!/^sk_test_[A-Za-z0-9_]+$/.test(options.secretKey)||!/^whsec_[A-Za-z0-9_]+$/.test(options.webhookSecret)||!id(options.prices.shared,'price_')||!id(options.prices.dedicated,'price_')||options.prices.shared===options.prices.dedicated)throw new Error('invalid_stripe_test_configuration');
  const u=new URL(options.origin);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new Error('invalid_stripe_origin');
  this.options=options;this.origin=u.origin;
 }
 private path(path:string){if(!/^\/[A-Za-z0-9/_-]*$/.test(path)||path.startsWith('//'))throw new Error('invalid_stripe_return_path');return this.origin+path;}
 private async request(path:string,body?:URLSearchParams,key?:string):Promise<Json>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await (this.options.fetch??fetch)('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${this.options.secretKey}`,'Stripe-Version':'2025-06-30.basil',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},body});
   if(!response.ok||Number(response.headers.get('content-length')??0)>1048576)throw fail();
   const reader=response.body?.getReader();if(!reader)throw fail();let n=0;const chunks:Uint8Array[]=[];while(true){const r=await reader.read();if(r.done)break;n+=r.value.byteLength;if(n>1048576){await reader.cancel();throw fail();}chunks.push(r.value);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw fail();return data;
  }catch{throw new Error('stripe_request_failed');}finally{clearTimeout(timer);}
 }
 async createCheckout(input:{sessionId:string;userId:string;plan:Plan;successPath:string;cancelPath:string;expiresAt:number}){
  this.binding(input);
  // Stripe permits Checkout expiry 30 minutes to 24 hours after creation.
  // https://docs.stripe.com/api/checkout/sessions/create#checkout_session_create-expires_at
  const now=(this.options.now??Date.now)(),expires=Math.floor(input.expiresAt/1000);
  if(!Number.isSafeInteger(input.expiresAt)||input.expiresAt-now>86_400_000||expires*1000-now<1_800_000||expires*1000-now>86_400_000)throw new Error('invalid_stripe_checkout_expiry');
  const body=new URLSearchParams({expires_at:String(expires),mode:'subscription','line_items[0][price]':this.options.prices[input.plan],'line_items[0][quantity]':'1',success_url:this.path(input.successPath),cancel_url:this.path(input.cancelPath),allow_promotion_codes:'false'});
  for(const [key,value] of Object.entries({sessionId:input.sessionId,userId:input.userId,plan:input.plan})){body.set(`metadata[${key}]`,value);body.set(`subscription_data[metadata][${key}]`,value);}
  const result=await this.request('checkout/sessions',body,`${input.sessionId}:${input.plan}`);
  if(result.livemode!==false||!id(result.id,'cs_test_')||result.mode!=='subscription')throw fail();let url:URL;try{url=new URL(result.url);}catch{throw fail();}if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw fail();return {checkoutId:result.id as string,url:url.href};
 }
 private binding(meta:any):asserts meta is {sessionId:string;userId:string;plan:Plan}{if(!meta||typeof meta.sessionId!=='string'||!/^[-A-Za-z0-9_]{1,180}$/.test(meta.sessionId)||typeof meta.userId!=='string'||!/^[-A-Za-z0-9_]{1,180}$/.test(meta.userId)||!['shared','dedicated'].includes(meta.plan))throw fail();}
 private price(price:any,plan:Plan){if(!price||price.id!==this.options.prices[plan]||price.livemode!==false||price.currency!=='usd'||price.unit_amount!==(plan==='shared'?2500:25000)||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring?.interval_count!==1||!empty(price.recurring?.trial_period_days)||price.billing_scheme!=='per_unit'||price.transform_quantity!=null)throw fail();}
 async verifyPayment(rawBody:string,signature:string):Promise<VerifiedPayment|null>{
  if(Buffer.byteLength(rawBody)>1048576||signature.length>2048)throw fail();const parts=signature.split(',');const times=parts.filter(p=>p.startsWith('t='));if(times.length!==1||!/^t=\d{1,12}$/.test(times[0]!))throw fail();const timestamp=Number(times[0]!.slice(2));if(Math.abs(Math.floor((this.options.now??Date.now)()/1000)-timestamp)>300)throw fail();const expected=createHmac('sha256',this.options.webhookSecret).update(`${timestamp}.${rawBody}`).digest();if(!parts.some(p=>/^v1=[a-fA-F0-9]{64}$/.test(p)&&timingSafeEqual(expected,Buffer.from(p.slice(3),'hex'))))throw fail();
  let event:Json;try{event=JSON.parse(rawBody);}catch{throw fail();}if(!event||event.livemode!==false||!id(event.id,'evt_'))throw fail();if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return null;
  const snapshot=event.data?.object;if(!snapshot||!id(snapshot.id,'cs_test_')||snapshot.livemode!==false||snapshot.mode!=='subscription')throw fail();if(snapshot.payment_status==='unpaid'&&event.type==='checkout.session.completed')return null;if(snapshot.payment_status!=='paid')throw fail();this.binding(snapshot.metadata);
  const query=new URLSearchParams();query.append('expand[]','line_items.data.price');query.append('expand[]','subscription.latest_invoice');query.append('expand[]','subscription.items.data.price');const session=await this.request(`checkout/sessions/${encodeURIComponent(snapshot.id)}?${query}`);
  this.binding(session.metadata);for(const key of ['sessionId','userId','plan'] as const)if(session.metadata[key]!==snapshot.metadata[key])throw fail();const plan=session.metadata.plan as Plan;const amount=plan==='shared'?2500:25000;
  if(session.id!==snapshot.id||session.livemode!==false||session.mode!=='subscription'||session.status!=='complete'||session.payment_status!=='paid'||session.currency!=='usd'||session.amount_total!==amount||session.amount_subtotal!==amount||session.total_details?.amount_discount!==0||!empty(session.discounts)||!id(ref(session.customer),'cus_')||ref(session.customer)!==ref(snapshot.customer)||ref(session.subscription)!==ref(snapshot.subscription))throw fail();
  const line=one(session.line_items);if(!line||line.quantity!==1||line.amount_total!==amount||line.amount_subtotal!==amount||line.currency!=='usd'||!empty(line.discounts))throw fail();this.price(line.price,plan);
  const sub=session.subscription;this.binding(sub?.metadata);for(const key of ['sessionId','userId','plan'] as const)if(sub.metadata[key]!==session.metadata[key])throw fail();if(!id(sub.id,'sub_')||sub.livemode!==false||sub.status!=='active'||ref(sub.customer)!==ref(session.customer)||sub.currency!=='usd'||sub.trial_start!=null||sub.trial_end!=null||!empty(sub.discounts)||sub.pause_collection!=null)throw fail();const item=one(sub.items);if(!item||item.quantity!==1)throw fail();this.price(item.price,plan);
  const invoice=sub.latest_invoice;const invoiceSub=ref(invoice?.subscription)??ref(invoice?.parent?.subscription_details?.subscription);if(!invoice||!id(invoice.id,'in_')||invoice.livemode!==false||invoice.status!=='paid'||invoice.currency!=='usd'||invoice.amount_paid!==amount||invoice.amount_due!==amount||invoice.amount_remaining!==0||invoice.total!==amount||invoiceSub!==sub.id||ref(invoice.customer)!==ref(session.customer)||!empty(invoice.discounts)||!empty(invoice.total_discount_amounts))throw fail();
  return {sessionId:session.metadata.sessionId,userId:session.metadata.userId,eventId:event.id,checkoutId:session.id,plan};
 }
}
