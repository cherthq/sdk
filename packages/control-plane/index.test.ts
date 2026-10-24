import {describe,it,expect} from 'bun:test';
import {ChertControlPlane,ChertApiError} from './index';
const project = '11111111-1111-4111-8111-111111111111';
function fixture(data:unknown,status=200){const requests:{url:string;init:RequestInit}[]=[];const client=new ChertControlPlane({baseUrl:'https://control.example',token:'user-fixture',projectId:project,fetch:(async(url: Parameters<typeof fetch>[0],init?: RequestInit)=>{requests.push({url:String(url),init:init!});return Response.json({data}, {status});}) as typeof fetch});return {client,requests};}
describe('control-plane wire contracts',()=>{
 it('defaults to the canonical origin and keeps public login separate from authenticated billing',async()=>{
  const requests:{url:string;headers:Headers}[]=[];
  const fetcher=(async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{requests.push({url:String(url),headers:new Headers(init?.headers)});return Response.json({data:{}});}) as typeof fetch;
  const client=new ChertControlPlane({token:'user-fixture',projectId:project,fetch:fetcher});
  await client.beginLogin({device_name:'Test'});await client.pollLogin({device_code:'code'});await client.billingStatus();await client.whoami();
  expect(requests.map(r=>r.url)).toEqual(['cli/logins','cli/logins/token','billing','cli/whoami'].map(path=>`https://facetime.trychert.com/api/v1/${path}`));
  for(const request of requests.slice(0,2)){expect(request.headers.has('Authorization')).toBe(false);expect(request.headers.has('x-chert-project-id')).toBe(false);}
  for(const request of requests.slice(2)){expect(request.headers.get('Authorization')).toBe('Bearer user-fixture');expect(request.headers.get('x-chert-project-id')).toBe(project);}
  await expect(new ChertControlPlane({fetch:fetcher}).billingStatus()).rejects.toMatchObject({status:401});
  await expect(new ChertControlPlane({token:'user-fixture',fetch:fetcher}).billingStatus()).rejects.toMatchObject({status:400,code:'project_required'});
  expect(requests).toHaveLength(4);
 });
 it('validates explicit overrides rather than falling back to production',async()=>{
  for(const baseUrl of ['', 'https://facetime.trychert.com/api/v1', 'https://control.example/#fragment', 'http://control.example'])expect(()=>new ChertControlPlane({baseUrl})).toThrow();
  for(const baseUrl of ['https://override.example/', 'http://localhost:3000/']){
   let requested='';const client=new ChertControlPlane({baseUrl,fetch:(async(url:Parameters<typeof fetch>[0])=>{requested=String(url);return Response.json({data:{}});}) as typeof fetch});
   await client.beginLogin({device_name:'Test'});expect(requested).toBe(`${new URL(baseUrl).origin}/api/v1/cli/logins`);
  }
 });
 it('starts and polls device auth without sending existing credentials',async()=>{const {client,requests}=fixture({status:'pending'},202);expect(await client.pollLogin({device_code:'device-fixture'})).toEqual({status:'pending'});await client.beginLogin({device_name:'Local laptop'});expect(requests[0]!.url).toBe('https://control.example/api/v1/cli/logins/token');expect(requests[0]!.init.headers).toEqual({Accept:'application/json','Content-Type':'application/json'});expect(requests[0]!.init.body).toBe('{"device_code":"device-fixture"}');expect(requests[1]!.init.redirect).toBe('error');});
 it('sends scoped credentials in headers and paginates',async()=>{const {client,requests}=fixture({items:[],total:0,limit:10,offset:20});await client.listLines({limit:10,offset:20});expect(requests[0]!.url).toBe('https://control.example/api/v1/lines?limit=10&offset=20');expect(requests[0]!.init.headers).toEqual({Accept:'application/json',Authorization:'Bearer user-fixture','x-chert-project-id':project});});
 it('preserves connector enrollment and browser approval boundaries',async()=>{const {client,requests}=fixture({});await client.enrollConnector({line_id:'line',name:'Agent',environment:'development',session_mode:'byor'});await client.approveLogin({user_code:'ABCD-EFGH',project_id:project});expect(JSON.parse(requests[0]!.init.body as string)).toEqual({action:'enroll',line_id:'line',name:'Agent',environment:'development',session_mode:'byor'});expect(requests[1]!.init.headers).not.toHaveProperty('x-chert-project-id');});
 it('returns entitlement status including no entitlement, never a checkout lifecycle',async()=>{
  for(const entitlement of [null,{plan:'dedicated',status:'active',valid_until:'2027-01-01T00:00:00Z',fulfillment_status:'pending'}] as const){
   const status={entitlement,needs_reconciliation:true,sales_enabled:true,shared_available:false,dedicated_available:true};
   const {client,requests}=fixture(status);expect(await client.billingStatus()).toEqual(status);expect(requests[0]!.init.method).toBe('GET');expect(requests[0]!.init.body).toBeUndefined();
  }
 });
 it('posts each billing action once with the exact body, credentials and caller-owned key',async()=>{
  const replies=[{url:'https://checkout.example/session/shared'},{url:'https://checkout.example/session/dedicated'},{status:'cancellation_requested',message:'Refresh billing status.'},{code:'EXAMPLE',percent_off:10,mode:'test',monthly_total:2250,currency:'usd'}] as const;
  const requests:{url:string;init:RequestInit}[]=[];
  const client=new ChertControlPlane({token:'user-fixture',projectId:project,fetch:(async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{requests.push({url:String(url),init:init!});return Response.json({data:replies[requests.length-1]});}) as typeof fetch});
  expect(await client.createCheckout({plan:'shared'},' checkout-1 ')).toEqual(replies[0]);
  expect(await client.createCheckout({plan:'dedicated',coupon_code:'EXAMPLE'},'checkout-2')).toEqual(replies[1]);
  expect(await client.cancelSubscription('cancel-123')).toEqual(replies[2]);
  expect(await client.validateCoupon('EXAMPLE','coupon-123')).toEqual(replies[3]);
  expect(requests.map(r=>JSON.parse(r.init.body as string))).toEqual([{action:'checkout',plan:'shared'},{action:'checkout',plan:'dedicated',coupon_code:'EXAMPLE'},{action:'cancel'},{action:'validate_coupon',coupon_code:'EXAMPLE'}]);
  expect(requests.map(r=>new Headers(r.init.headers).get('Idempotency-Key'))).toEqual(['checkout-1','checkout-2','cancel-123','coupon-123']);
  for(const r of requests){expect(r.url).toBe('https://facetime.trychert.com/api/v1/billing');expect(r.init.method).toBe('POST');expect(new Headers(r.init.headers).get('Authorization')).toBe('Bearer user-fixture');expect(new Headers(r.init.headers).get('x-chert-project-id')).toBe(project);expect(r.init.redirect).toBe('error');}
 });
 it('preserves time-limited coupon results without inventing a monthly total',async()=>{
  const result={code:'EXAMPLE',percent_off:100,mode:'test' as const,currency:'usd',due_now:0,access_hours:24,plans:['shared' as const]};
  const {client}=fixture(result);
  expect(await client.validateCoupon('EXAMPLE','coupon-123')).toEqual(result);
 });
 it('rejects obsolete checkout inputs and invalid keys without sending',()=>{
  const {client,requests}=fixture({});
  // @ts-expect-error The preview catalog contract cannot be silently translated.
  expect(()=>client.createCheckout({plan_id:'shared',catalog_version:'2026-10-22'},'checkout-1')).toThrow();
  for(const key of ['short','x'.repeat(201),'valid-key\r\ninjected']){expect(()=>client.createCheckout({plan:'shared'},key)).toThrow();expect(()=>client.cancelSubscription(key)).toThrow();expect(()=>client.validateCoupon('EXAMPLE',key)).toThrow();}
  expect(requests).toHaveLength(0);
 });
});
describe('safe failures',()=>{
 it('bounds response bytes and attaches a request deadline',async()=>{let signal:AbortSignal|undefined;const client=new ChertControlPlane({fetch:(async(_url: Parameters<typeof fetch>[0],init?: RequestInit)=>{signal=init?.signal??undefined;return new Response('x'.repeat(1_048_577));}) as typeof fetch});await expect(client.beginLogin({device_name:'Test'})).rejects.toMatchObject({code:'invalid_response'});expect(signal).toBeInstanceOf(AbortSignal);});
 it('preserves permission failures without retry or leaking server data',async()=>{let calls=0;const client=new ChertControlPlane({token:'private',projectId:project,fetch:(async()=>{calls++;return Response.json({error:{code:'forbidden',message:'private token',details:{secret:'bad'}}},{status:403});}) as unknown as typeof fetch});try{await client.createCheckout({plan:'shared'},'stable-key');throw Error('expected');}catch(error){expect(error).toBeInstanceOf(ChertApiError);expect((error as ChertApiError).code).toBe('forbidden');expect(String(error)).not.toContain('private');expect(JSON.stringify(error)).not.toContain('secret');}expect(calls).toBe(1);});
 it('rejects invalid JSON and missing envelopes',async()=>{for(const response of [new Response('private HTML'),Response.json({hello:'world'})]){const client=new ChertControlPlane({fetch:(async()=>response) as unknown as typeof fetch});await expect(client.beginLogin({device_name:'Test'})).rejects.toMatchObject({code:'invalid_response'});}});
 it('redacts transport errors and arbitrary server codes',async()=>{for(const fetcher of [async()=>{throw Error('private token');},async()=>Response.json({error:{code:'private-token'}},{status:500})]){const client=new ChertControlPlane({fetch:fetcher as unknown as typeof fetch});await expect(client.beginLogin({device_name:'Test'})).rejects.toBeInstanceOf(ChertApiError);}});
 it('refuses credentialed/insecure origins and requires auth locally',async()=>{for(const baseUrl of ['https://secret@control.example','http://control.example','https://control.example/path','https://control.example/?token=private'])expect(()=>new ChertControlPlane({baseUrl})).toThrow();await expect(new ChertControlPlane({baseUrl:'http://localhost:3000'}).whoami()).rejects.toMatchObject({status:401});});
});
