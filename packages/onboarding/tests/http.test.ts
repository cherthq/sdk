import { test, expect } from 'bun:test';
import { mkdtemp, chmod, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { OnboardingCore, SqliteOnboardingStore } from '../src/core';
import { SqliteBrowserStore } from '../src/http/store';
import { createOnboardingHandler, withBrowserLinks, hmacInboundVerifier } from '../src/http/server';
import { startOnboarding, pollOnboarding } from '../../facetime/src/onboard';
import { authenticator } from './webauthn-fixture';

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { f.server.stop(true); f.store.close(); f.browserStore.close(); await rm(f.directory, { recursive: true, force: true }); }
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'chert-http-test-')); await chmod(directory, 0o700);
  const store = new SqliteOnboardingStore({ path: join(directory, 'core.sqlite') });
  const browserStore = new SqliteBrowserStore(join(directory, 'browser.sqlite'));
  let handler: (r: Request) => Promise<Response>;
  const server = Bun.serve({ hostname: 'localhost', port: 0, fetch: r => handler(r) });
  const origin = `http://localhost:${server.port}`;
  let clock=Date.now(); const now=()=>clock;
  const key = randomBytes(32), webhookSecret = randomBytes(32).toString('hex');
  const messages: { text: string; idempotencyKey: string }[] = [];
  const core = new OnboardingCore({ now,store, secretKey: key, mainLine: '+14155550100', messaging: withBrowserLinks({ sendMessage: async input => { messages.push(input); } }, { origin, secretKey: key }), allocator: { allocate: async () => ({ projectId: 'project-one', allocationId: 'allocation-one', entitlementId: 'entitlement-one', connector: { kind: 'hosted-webhook', configuration: { scopedToken: 'test-receipt-private' } } }) } });
  let verifiedPayment: { sessionId: string; userId: string; eventId: string; checkoutId: string; plan: 'shared' } | null = null;
  let checkoutCalls = 0;
  handler = createOnboardingHandler({ core, store, browserStore, secretKey: key, now,origin, rpId: 'localhost', mainLine: '+14155550100', sourceKey: () => 'socket-fixture', mode: 'local-fixture', contactConfigured: true, faceTimeConfigured: false, verifyInbound: hmacInboundVerifier({ secret: webhookSecret,now }), billing: {
    createCheckout: async () => { checkoutCalls++; return { checkoutId: 'cs_test_one', url: 'https://checkout.stripe.com/c/pay/cs_test_one' }; },
    verifyPayment: async () => verifiedPayment,
  } });
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function start(phone = '+14155550123', existing?: {sessionId:string;pollCapability:string}) {
    const response = existing ? undefined : await request('/sessions', { phone, contactConsent: true, originAgent: 'Codex', target: { kind: 'project', projectLabel: 'test-app' }, resumeStrategy: 'poll' });
    if(response) expect(response.status).toBe(201); const data = existing ?? (await response!.json()).data;
    await core.flushOutbox();
    const welcome = messages.find(m => m.idempotencyKey === data.sessionId + ':welcome')!;
    const code = /Reply (\d{6})/.exec(welcome.text)![1];
    const link = /Continue securely: (\S+)/.exec(welcome.text)![1]!;
    const landing = await fetch(link,{redirect:'manual'}); expect(landing.status).toBe(200);
    expect(landing.headers.has('Set-Cookie')).toBe(false);
    const exchange=await request(`/onboarding/${data.sessionId}/open`,{token:new URL(link).searchParams.get('token')},{Origin:origin});
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers.get('Set-Cookie')!.split(';')[0]!;
    expect(exchange.headers.get('Referrer-Policy')).toBe('no-referrer');
    const page = await request(`/onboarding/${data.sessionId}`, undefined, { Cookie: cookie });
    const html = await page.text();
    const csrf = JSON.parse(/<script id="onboarding-data"[^>]*>([^<]*)<\/script>/.exec(html)![1]!).csrf as string;
    const browserHeaders = { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf };
    const inbound = { eventId: randomBytes(16).toString('hex'), sessionId: data.sessionId, from: phone, to: '+14155550100', body: code };
    const raw = JSON.stringify(inbound), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', webhookSecret).update(timestamp + '.' + raw).digest('hex');
    const verify = await request('/webhooks/messages', inbound, { 'x-chert-timestamp': timestamp, 'x-chert-signature': signature });
    expect(verify.status).toBe(200);
    return { ...data, cookie, csrf, browserHeaders, link, html, page, inbound, webhookHeaders:{'x-chert-timestamp':timestamp,'x-chert-signature':signature} };
  }
  return { directory, server, core, store, browserStore, messages, origin, request, start,advance:(ms:number)=>{clock+=ms;}, setPayment: (value: typeof verifiedPayment) => { verifiedPayment = value; }, checkoutCalls: () => checkoutCalls };
}

test('real HTTP: signed inbound proof, WebAuthn registration, payment gate, allocation and acknowledged CLI handoff', () => fixture(async f => {
  const session = await f.start();
  expect(session.page.headers.get('Content-Security-Policy')).toContain("script-src 'nonce-");
  expect(session.html).toContain('test-app'); expect(session.html).not.toContain(session.pollCapability);
  expect((await fetch(session.link, { redirect: 'manual' })).status).toBe(401);
  const base = `/onboarding/${session.sessionId}`;
  const opts = await (await f.request(base + '/passkey/options', { mode: 'register' }, session.browserHeaders)).json();
  const auth = authenticator();
  const response = await f.request(base + '/passkey/verify', { mode: 'register', credential: auth.register(opts.data.options.challenge, f.origin) }, session.browserHeaders);
  expect(response.status).toBe(200);
  expect((await f.request('/webhooks/messages',session.inbound,session.webhookHeaders)).status).toBe(200);
  const identity = f.store.getSession(session.sessionId)!;
  expect(f.store.getPasskeys(identity.userId)).toHaveLength(1);
  const plan = await f.request(base + '/plan', { plan: 'shared' }, session.browserHeaders);
  expect((await plan.json()).data.amount).toBe(2500);
  expect((await f.request(base + '/checkout', {}, session.browserHeaders)).status).toBe(200);
  await f.request(base + '/checkout', {}, session.browserHeaders); expect(f.checkoutCalls()).toBe(1);
  expect((await f.request(base+'/cancel',{},session.browserHeaders)).status).toBe(409);
  expect((await f.request(base,undefined,{Cookie:session.cookie,'Sec-Fetch-Site':'cross-site'})).status).toBe(200);
  const cliHeaders = { Authorization: `Bearer ${session.pollCapability}` };
  expect((await f.request(`/sessions/${session.sessionId}/claim`, {}, cliHeaders)).status).toBe(409);
  f.setPayment({ sessionId: session.sessionId, userId: identity.userId, eventId: 'evt_test', checkoutId: 'cs_test_one', plan: 'shared' });
  expect((await f.request('/webhooks/stripe', {})).status).toBe(200);
  expect((await f.request(`/sessions/${session.sessionId}`, undefined, cliHeaders)).status).toBe(200);
  expect(f.store.getSession(session.sessionId)!.state).toBe('provisioning');
  await f.core.flushOutbox(); expect(f.store.getSession(session.sessionId)!.state).toBe('ready');
  const claimed = await f.request(`/sessions/${session.sessionId}/claim`, {}, cliHeaders);
  expect(claimed.status).toBe(200); const receipt=(await claimed.json()).data;expect(receipt.connector.configuration.scopedToken).toBe('test-receipt-private');
  expect((await(await f.request(`/sessions/${session.sessionId}/claim`, {}, cliHeaders)).json()).data).toEqual(receipt);
  expect((await f.request(`/sessions/${session.sessionId}/claim/ack`, {deliveryId:'wrong'}, cliHeaders)).status).toBe(403);
  expect((await f.request(`/sessions/${session.sessionId}/claim/ack`, {deliveryId:receipt.deliveryId}, cliHeaders)).status).toBe(200);
  expect((await f.request(`/sessions/${session.sessionId}/claim/ack`, {deliveryId:receipt.deliveryId}, cliHeaders)).status).toBe(200);
  expect((await f.request(`/sessions/${session.sessionId}/claim`, {}, cliHeaders)).status).toBe(409);
  expect((await f.request('/webhooks/stripe',{})).status).toBe(200);
  f.advance(3*60*60*1000);
  expect((await f.request('/webhooks/stripe',{})).status).toBe(200);
}));

test('WebAuthn refuses wrong origin, absent user verification and replayed challenge; existing passkey signs in same verified identity', () => fixture(async f => {
  const session = await f.start(); const base = `/onboarding/${session.sessionId}`, auth = authenticator();
  for (const mode of ['wrong-origin', 'no-uv']) {
    const opts = await (await f.request(base + '/passkey/options', { mode: 'register' }, session.browserHeaders)).json();
    const credential = auth.register(opts.data.options.challenge, mode === 'wrong-origin' ? 'https://attacker.example' : f.origin, 'localhost', mode !== 'no-uv');
    expect((await f.request(base + '/passkey/verify', { mode: 'register', credential }, session.browserHeaders)).status).toBe(403);
    expect((await f.request(base + '/passkey/verify', { mode: 'register', credential }, session.browserHeaders)).status).toBe(403);
  }
  const opts = await (await f.request(base + '/passkey/options', { mode: 'register' }, session.browserHeaders)).json();
  expect((await f.request(base + '/passkey/verify', { mode: 'register', credential: auth.register(opts.data.options.challenge, f.origin) }, session.browserHeaders)).status).toBe(200);
  const next = await f.start(); const nextBase = `/onboarding/${next.sessionId}`;
  expect((await f.request(nextBase + '/passkey/options', {mode:'register'}, next.browserHeaders)).status).toBe(403);
  const existing = await (await f.request(nextBase + '/passkey/options', { mode: 'authenticate' }, next.browserHeaders)).json();
  const userId = f.store.getSession(session.sessionId)!.userId;
  expect(f.store.getSession(next.sessionId)!.userId).toBe(userId);
  const credential = auth.authenticate(existing.data.options.challenge, f.origin, userId);
  expect((await f.request(nextBase + '/passkey/verify', { mode: 'authenticate', credential }, next.browserHeaders)).status).toBe(200);
  expect(f.store.getSession(next.sessionId)!.state).toBe('plan_pending');
}));

test('HTTP fails closed on CSRF, cross-origin, capability separation, malformed schema, unsigned callbacks and cancellation', () => fixture(async f => {
  expect((await f.request('/sessions', { phone: '+14155550123', contactConsent: false })).status).toBe(422);
  expect((await f.request('/sessions', {}, { Origin: 'https://attacker.example' })).status).toBe(403);
  expect((await f.request('/sessions', { contactConsent: true, target: {}, unexpected: 'bad' })).status).toBe(422);
  expect((await f.request('/webhooks/messages', { verified: true })).status).toBe(401);
  expect((await f.request('/sessions',{phone:'+14155550123',contactConsent:true,originAgent:'Codex',target:{kind:'project'},resumeStrategy:'poll',preferFaceTime:true})).status).toBe(503);
  const session = await f.start(), base = `/onboarding/${session.sessionId}`;
  expect((await f.request(base + '/passkey/options', { mode: 'register' }, { Cookie: session.cookie, Origin: f.origin })).status).toBe(403);
  expect((await f.request(base + '/status', undefined, { Authorization: `Bearer ${session.pollCapability}` })).status).toBe(401);
  expect((await f.request(`/sessions/${session.sessionId}`, undefined, { Cookie: session.cookie })).status).toBe(401);
  expect((await f.request(base + '/cancel', {}, session.browserHeaders)).status).toBe(200);
  expect(f.store.getSession(session.sessionId)!.state).toBe('cancelled');
  expect((await f.request(base + '/status', undefined, { Cookie: session.cookie })).status).toBe(401);
}));


test('CLI runs against the actual HTTP server and consumes the paid allocated receipt without leaking its capability', () => fixture(async f => {
  const outputs: unknown[] = [];
  const started = await startOnboarding({baseUrl:f.origin,phone:'+14155550123',consent:true,agent:'Codex',target:'project',projectLabel:'http-client'}, {temporaryRoot:f.directory,emit:value=>outputs.push(value),detach:()=>{}});
  const helper = String(started.helperFile);
  const state = JSON.parse(await readFile(helper,'utf8'));
  expect(JSON.stringify(outputs)).not.toContain(state.capability);
  const session = await f.start('+14155550123',{sessionId:state.sessionId,pollCapability:state.capability});
  expect((await pollOnboarding(helper)).status).toBe('pending');
  const base=`/onboarding/${session.sessionId}`, auth=authenticator();
  const opts=await(await f.request(base+'/passkey/options',{mode:'register'},session.browserHeaders)).json();
  expect((await f.request(base+'/passkey/verify',{mode:'register',credential:auth.register(opts.data.options.challenge,f.origin)},session.browserHeaders)).status).toBe(200);
  await f.request(base+'/plan',{plan:'shared'},session.browserHeaders);
  await f.request(base+'/checkout',{},session.browserHeaders);
  f.setPayment({sessionId:session.sessionId,userId:f.store.getSession(session.sessionId)!.userId,eventId:'evt_cli',checkoutId:'cs_test_one',plan:'shared'});
  await f.request('/webhooks/stripe',{}); await f.core.flushOutbox();
  // Drop successful responses at the transport boundary: server state must remain recoverable.
  let dropClaim=true,dropAck=true;
  const flaky=(async(input:RequestInfo|URL,init?:RequestInit)=>{const response=await fetch(input,init);const path=new URL(String(input)).pathname;if(path.endsWith('/claim')&&dropClaim){dropClaim=false;await response.arrayBuffer();throw Error('lost claim response');}if(path.endsWith('/claim/ack')&&dropAck){dropAck=false;await response.arrayBuffer();throw Error('lost acknowledgement response');}return response;})as typeof fetch;
  await expect(pollOnboarding(helper,{fetch:flaky})).rejects.toThrow('unavailable');
  expect(f.store.getSession(session.sessionId)!.state).toBe('ready');
  const storedDelivery=f.store.getSession(session.sessionId)!.claimId;
  const reopened=new SqliteOnboardingStore({path:join(f.directory,'core.sqlite')});
  expect(reopened.getSession(session.sessionId)!.claimId).toBe(storedDelivery);expect(reopened.getSession(session.sessionId)!.readySealed).toBeTruthy();reopened.close();
  await expect(pollOnboarding(helper,{fetch:flaky})).rejects.toThrow('unavailable');
  expect(f.store.getSession(session.sessionId)!.state).toBe('claimed');
  expect(JSON.parse(await readFile(helper,'utf8')).state).toBe('handoff_saved');
  const completed=await pollOnboarding(helper,{fetch:flaky});
  expect(completed.status).toBe('complete');
  const receipt=JSON.parse(await readFile(String(completed.completionFile),'utf8'));
  expect(receipt.projectId).toBe('project-one'); expect(receipt.target.kind).toBe('project');
  expect(receipt.originAgent).toBe('Codex');
  expect((await stat(String(completed.completionFile))).mode&0o777).toBe(0o600);
  expect(JSON.stringify(completed)).not.toContain('test-receipt-private');
  expect(JSON.parse(await readFile(helper,'utf8')).capability).toBe('');
}));


test('verified payment arriving after helper expiry is durably queued for reconciliation, not silently discarded or marked ready', () => fixture(async f=>{
 const session=await f.start(),base=`/onboarding/${session.sessionId}`,auth=authenticator();
 const opts=await(await f.request(base+'/passkey/options',{mode:'register'},session.browserHeaders)).json();
 await f.request(base+'/passkey/verify',{mode:'register',credential:auth.register(opts.data.options.challenge,f.origin)},session.browserHeaders);
 await f.request(base+'/plan',{plan:'shared'},session.browserHeaders);await f.request(base+'/checkout',{},session.browserHeaders);
 f.setPayment({sessionId:session.sessionId,userId:f.store.getSession(session.sessionId)!.userId,eventId:'evt_late',checkoutId:'cs_test_one',plan:'shared'});
 f.advance(3*60*60*1000);
 expect((await f.request('/webhooks/stripe',{})).status).toBe(200);
 expect((await f.request('/webhooks/stripe',{})).status).toBe(200);
 expect(f.store.pendingPaymentRecoveries()).toHaveLength(1);
 expect(f.store.pendingPaymentRecoveries()[0]!.reason).toBe('expired_session');
 expect(f.store.getSession(session.sessionId)!.paymentEvent).toBe('evt_late');
 const reopened=new SqliteOnboardingStore({path:join(f.directory,'core.sqlite')});
 expect(reopened.pendingPaymentRecoveries()).toHaveLength(1);
 expect(reopened.resolvePaymentRecovery('cs_test_one','operator-fixture-reference')).toBe(true);
 expect(reopened.resolvePaymentRecovery('cs_test_one','duplicate')).toBe(false);
 expect(reopened.pendingPaymentRecoveries()).toHaveLength(0);reopened.close();
 expect((await f.request(`/sessions/${session.sessionId}/claim`,{},{Authorization:`Bearer ${session.pollCapability}`})).status).toBe(410);
}));
