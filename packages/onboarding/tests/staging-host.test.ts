import { test, expect } from 'bun:test';
import { mkdtemp, chmod, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { startStagingHost } from '../src/http/staging-host';
import type { StagingConfig } from '../src/http/staging-config';
import { authenticator } from './webauthn-fixture';
import { startOnboarding, pollOnboarding } from '../../facetime/src/onboard';

async function waitFor(predicate: () => boolean) {
  const end=Date.now()+3000;
  while(!predicate()){if(Date.now()>=end)throw Error('Fixture dispatcher did not reach expected state');await Bun.sleep(20);}
}
test('persistent staging host connects CLI, signed worker contact/callback, passkey and a verified fixture allocation over real HTTP',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'chert-host-test-'));await chmod(directory,0o700);
 const outboundSecret=randomBytes(32).toString('hex'),inboundSecret=randomBytes(32).toString('hex');
 const contacts:{text:string;idempotencyKey:string;to:string}[]=[];let allocations=0,readyStarted=false;let releaseReady!:()=>void;const readyGate=new Promise<void>(resolve=>{releaseReady=resolve;});
 const worker=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const path=new URL(request.url).pathname,raw=await request.text(),timestamp=request.headers.get('X-Chert-Timestamp')!;
  const supplied=Buffer.from(request.headers.get('X-Chert-Signature')??'','hex');
  const expected=createHmac('sha256',outboundSecret).update(timestamp+'.POST.'+path+'.'+raw).digest();
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return new Response('Unsigned',{status:401});
  const body=JSON.parse(raw);expect(request.headers.get('Idempotency-Key')).toBe(body.idempotencyKey);
  if(path==='/v1/onboarding/messages'){contacts.push(body);if(body.idempotencyKey.endsWith(':ready')){readyStarted=true;await readyGate;}return Response.json({data:{accepted:true,providerMessageId:'fixture-message'}});}
  if(path==='/v1/onboarding/allocations'){allocations++;expect(body.plan).toBe('shared');expect(body.checkoutId).toBe('cs_test_host');return Response.json({data:{projectId:'project-host',allocationId:'allocation-host',entitlementId:'entitlement-host',connector:{kind:'hosted-webhook',configuration:{scopedToken:'host-fixture-secret'}}}});}
  return new Response('Missing',{status:404});
 }});
 const config:StagingConfig={publicOrigin:'https://onboarding.staging.invalid',workerOrigin:`http://127.0.0.1:${worker.port}`,mainLine:'+14155550100',recipients:['+14155550123'],dataDirectory:directory,encryptionKey:randomBytes(32),proxySecret:randomBytes(32).toString('hex'),inboundSecret,outboundSecret,stripeSecret:'sk_test_hostfixture',stripeWebhookSecret:'whsec_hostfixture',stripePrices:{shared:'price_shared',dedicated:'price_dedicated'},port:0,faceTimeEnabled:false};
 // Stripe's live transport is not called. This host test deliberately stops before provider test checkout;
 // the separate Stripe adapter suite verifies the raw signed payment reconciliation contract.
 let stripeRequests=0;
 const host=await startStagingHost(config,{dispatcherIntervalMs:20,stripeFetch:(async()=>{stripeRequests++;throw Error('Stripe fixture must not contact network');}) as unknown as typeof fetch});
 const upstream=`http://127.0.0.1:${host.server.port}`;
 const proxy=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){const headers=new Headers(request.headers);headers.set('X-Chert-Proxy-Token',config.proxySecret);headers.set('X-Chert-Client-IP','127.0.0.1');const path=new URL(request.url);return fetch(new Request(upstream+path.pathname+path.search,new Request(request,{headers})),{redirect:'manual'});}});
 const local=`http://127.0.0.1:${proxy.port}`;
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(local+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  expect((await fetch(upstream+'/capabilities',{headers:{'X-Chert-Client-IP':'203.0.113.9'}})).status).toBe(401);
  expect((await fetch(upstream+'/capabilities',{headers:{'X-Chert-Proxy-Token':config.proxySecret,'X-Chert-Client-IP':'not-an-ip'}})).status).toBe(400);
  for(let index=0;index<12;index++)expect((await request('/sessions',{phone:'+14155550124',contactConsent:true,originAgent:'Codex',target:{kind:'project'},resumeStrategy:'poll'})).status).toBe(403);
  const forbidden=await request('/sessions',{phone:'+14155550124',contactConsent:true,originAgent:'Codex',target:{kind:'project'},resumeStrategy:'poll'});
  expect(forbidden.status).toBe(403);expect(contacts).toHaveLength(0);
  const started=await startOnboarding({baseUrl:local,phone:'+14155550123',consent:true,agent:'Codex',target:'project',projectLabel:'actual-http'}, {temporaryRoot:directory});
  const helper=String(started.helperFile),state=JSON.parse(await readFile(helper,'utf8'));
  await waitFor(()=>contacts.some(c=>c.idempotencyKey===state.sessionId+':welcome'));
  const welcome=contacts.find(c=>c.idempotencyKey===state.sessionId+':welcome')!;
  expect(welcome.to).toBe('+14155550123');
  expect((welcome as unknown as {context:unknown}).context).toEqual({sessionId:state.sessionId,originAgent:'Codex',target:{kind:'project',projectLabel:'actual-http'}});
  const link=new URL(/Continue securely: (\S+)/.exec(welcome.text)![1]!);
  expect(link.origin).toBe(config.publicOrigin);
  const inbound={eventId:'worker-fixture-reply',sessionId:state.sessionId,from:'+14155550123',to:config.mainLine,body:/Reply (\d{6})/.exec(welcome.text)![1]};
  const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify(inbound);
  expect((await request('/webhooks/messages',inbound,{'X-Chert-Timestamp':timestamp,'X-Chert-Signature':createHmac('sha256',inboundSecret).update(timestamp+'.'+raw).digest('hex')})).status).toBe(200);
  const base='/onboarding/'+state.sessionId;
  const opened=await request(base+'/open',{token:link.searchParams.get('token')},{Origin:config.publicOrigin});
  expect(opened.status).toBe(200);expect(opened.headers.get('Set-Cookie')).toContain('; Secure');
  const cookie=opened.headers.get('Set-Cookie')!.split(';')[0]!;
  const page=await request(base,undefined,{Cookie:cookie});const html=await page.text();
  const csrf=JSON.parse(/<script id="onboarding-data"[^>]*>([^<]*)<\/script>/.exec(html)![1]!).csrf;
  const browserHeaders={Cookie:cookie,Origin:config.publicOrigin,'X-CSRF-Token':csrf};
  const options=await(await request(base+'/passkey/options',{mode:'register'},browserHeaders)).json();
  const response=authenticator().register(options.data.options.challenge,config.publicOrigin,'onboarding.staging.invalid');
  expect((await request(base+'/passkey/verify',{mode:'register',credential:response},browserHeaders)).status).toBe(200);
  expect((await request(base+'/plan',{plan:'shared'},browserHeaders)).status).toBe(200);
  // Trusted fixture boundary: no purchase is requested. The signed Stripe suite proves this callback separately.
  host.core.reserveCheckout(state.sessionId);host.core.attachCheckout(state.sessionId,{checkoutId:'cs_test_host',url:'https://checkout.stripe.com/c/pay/cs_test_host',plan:'shared'});
  host.core.recordVerifiedPayment({sessionId:state.sessionId,eventId:'fixture-paid',checkoutId:'cs_test_host',plan:'shared'});
  await waitFor(()=>host.store.getSession(state.sessionId)!.state==='ready');
  await waitFor(()=>readyStarted);
  expect(allocations).toBe(1);expect(stripeRequests).toBe(0);
  const finished=await pollOnboarding(helper);expect(finished.status).toBe('complete');
  expect(JSON.stringify(finished)).not.toContain('host-fixture-secret');
  expect(JSON.parse(await readFile(String(finished.completionFile),'utf8')).projectId).toBe('project-host');
  expect((await stat(join(directory,'onboarding.sqlite'))).mode&0o777).toBe(0o600);
  expect((await stat(join(directory,'browser.sqlite'))).mode&0o777).toBe(0o600);
  const drain=host.close();expect(host.close()).toBe(drain);let drained=false;void drain.then(()=>{drained=true;});await Bun.sleep(20);expect(drained).toBe(false);releaseReady();await drain;expect(drained).toBe(true);
 }finally{releaseReady();proxy.stop(true);const closing=host.close();expect(host.close()).toBe(closing);await closing;worker.stop(true);await rm(directory,{recursive:true,force:true});}
});

test('staging host refuses permissive data directories before starting a listener or contacting a worker',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'chert-host-permission-'));await chmod(directory,0o755);
 try{
 const config={dataDirectory:directory} as StagingConfig;
 await expect(startStagingHost(config)).rejects.toThrow('owner-only');
 }finally{await rm(directory,{recursive:true,force:true});}
});
