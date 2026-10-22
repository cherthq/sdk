import { describe, test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { ChertOnboardingWorkerBridge } from '../src/providers/worker-bridge';
const now = 1_800_000_000_000, secret = 'outbound-worker-test-key-32-bytes-minimum';
const message = { to: '+14155550123', from: '+14155550100', text: 'Chert setup. Reply 123456.', idempotencyKey: 'session-one:welcome' };
const allocation = { sessionId: 'session-one', userId: 'user-one', phone: message.to, plan: 'shared' as const, checkoutId: 'cs_test_one', target: { kind: 'project' as const, projectLabel: 'demo' }, idempotencyKey: 'session-one:allocation' };
const receipt = { projectId: 'project-one', allocationId: 'line-one', entitlementId: 'entitlement-one', connector: { kind: 'hosted-webhook' as const, configuration: { endpoint: 'https://agent.example/hooks', scopedToken: 'scoped-fixture-token' } } };
type Wire = (url: string, init: RequestInit) => Response | Promise<Response>;
function bridge(wire: Wire) { return new ChertOnboardingWorkerBridge({ origin: 'https://worker.example', outboundSecret: secret, now: () => now, fetch: ((url: unknown, init: RequestInit) => wire(String(url), init)) as unknown as typeof fetch }); }
function verifyWire(url: string, init: RequestInit, path: string, expected: unknown) {
  expect(url).toBe('https://worker.example' + path); expect(init.method).toBe('POST'); expect(init.redirect).toBe('error');
  const headers = new Headers(init.headers); const raw = init.body as string;
  expect(JSON.parse(raw)).toEqual(expected); expect(headers.get('Content-Type')).toBe('application/json');
  expect(headers.get('X-Chert-Timestamp')).toBe(String(now / 1000));
  expect(headers.get('X-Chert-Signature')).toBe(createHmac('sha256', secret).update(`${now / 1000}.POST.${path}.${raw}`).digest('hex'));
  expect(headers.get('Idempotency-Key')).toBe((expected as {idempotencyKey:string}).idempotencyKey);
  expect(headers.has('Authorization')).toBe(false); expect(raw).not.toContain(secret); expect(init.signal).toBeInstanceOf(AbortSignal);
}
describe('authenticated onboarding worker bridge', () => {
  test('message wire uses exact signed body and returns acceptance without claiming delivery', async () => {
    const client = bridge((url, init) => { verifyWire(url, init, '/v1/onboarding/messages', message); return Response.json({ data: { accepted: true, providerMessageId: 'msg-one', delivered: false } }); });
    expect(await client.sendMessage(message)).toBeUndefined();
  });
  test('passes bounded agent context as data and rejects a mismatched session binding',async()=>{
    const context={sessionId:'session-one',originAgent:'Codex',target:{kind:'project' as const,projectLabel:'example'}};
    const client=bridge((url,init)=>{verifyWire(url,init,'/v1/onboarding/messages',{...message,context});return Response.json({data:{accepted:true,providerMessageId:'context-one'}});});
    await client.sendMessage({...message,context});
    await expect(client.sendMessage({...message,context:{...context,sessionId:'different'}})).rejects.toThrow('onboarding_worker_request_failed');
  });
  test('FaceTime returns worker requested/busy/unavailable statuses', async () => {
    const input = { to: message.to, from: message.from, sessionId: 'session-one', idempotencyKey: 'session-one:facetime' };
    for (const status of ['requested', 'busy', 'unavailable'] as const) {
      const client = bridge((url, init) => { verifyWire(url, init, '/v1/onboarding/facetime', input); return Response.json({ data: { status } }); });
      expect(await client.requestFaceTime(input)).toBe(status);
    }
  });
  test('allocation selects only validated receipt fields', async () => {
    const client = bridge((url, init) => { verifyWire(url, init, '/v1/onboarding/allocations', allocation); return Response.json({ data: { ...receipt, ignoredInternalField: 'do-not-forward' } }); });
    expect(await client.allocate(allocation)).toEqual(receipt);
  });
  test('repeated explicit calls retain stable idempotency and body without hidden retries', async () => {
    const seen: {key:string|null;body:BodyInit|null|undefined}[] = [];
    const client = bridge((_url, init) => { seen.push({ key: new Headers(init.headers).get('Idempotency-Key'), body: init.body }); return Response.json({ data: { accepted: true, providerMessageId: 'msg-one' } }); });
    await client.sendMessage(message); await client.sendMessage(message); expect(seen).toHaveLength(2); expect(seen[0]).toEqual(seen[1]);
    let calls = 0; const failed = bridge(() => { calls++; throw new Error('private provider response'); });
    await expect(failed.sendMessage(message)).rejects.toThrow('onboarding_worker_request_failed'); expect(calls).toBe(1);
  });
  test('configuration rejects untrusted origins and weak keys; HTTP only loopback', () => {
    for (const origin of ['http://remote.example', 'https://u:p@worker.example', 'https://worker.example/path', 'https://worker.example?key=secret', 'https://worker.example#secret', 'file:///tmp/socket']) expect(() => new ChertOnboardingWorkerBridge({ origin, outboundSecret: secret })).toThrow('invalid_onboarding_worker_configuration');
    expect(() => new ChertOnboardingWorkerBridge({ origin: 'https://worker.example', outboundSecret: 'weak' })).toThrow();
    for (const origin of ['http://localhost:9000', 'http://127.0.0.1:9000', 'http://[::1]:9000']) expect(() => new ChertOnboardingWorkerBridge({ origin, outboundSecret: secret })).not.toThrow();
  });
  test('invalid request data cannot create outbound effects', async () => {
    let calls = 0; const client = bridge(() => { calls++; throw new Error(); });
    for (const input of [{...message,idempotencyKey:'header\r\ninjection'}, {...message,to:'invalid'}, {...message,text:'x'.repeat(16001)}]) await expect(client.sendMessage(input)).rejects.toThrow('onboarding_worker_request_failed');
    await expect(client.allocate({...allocation,plan:'free' as 'shared'})).rejects.toThrow(); expect(calls).toBe(0);
  });
  test('rejects redirects, nonJSON, oversized declared/streamed bodies and safe provider failures', async () => {
    for (const response of [new Response('private response',{status:500}), new Response(null,{status:302,headers:{location:'https://evil.example'}}), new Response('{}',{headers:{'Content-Type':'text/plain'}}), new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'65537'}}), new Response('x'.repeat(65537),{headers:{'Content-Type':'application/json'}})]) {
      let calls=0; const client=bridge(()=>{calls++;return response;});
      try { await client.sendMessage(message); throw new Error('unexpected success'); } catch (error) { expect((error as Error).message).toBe('onboarding_worker_request_failed'); expect(String(error)).not.toContain('private response'); }
      expect(calls).toBe(1);
    }
  });
  test('rejects malformed envelopes, message acceptance and FaceTime status', async () => {
    for (const value of [{}, {data:[]}, {data:{accepted:false,providerMessageId:'msg-one'}}, {data:{accepted:true}}, {data:{accepted:true,providerMessageId:'x'.repeat(201)}}]) await expect(bridge(()=>Response.json(value)).sendMessage(message)).rejects.toThrow();
    await expect(bridge(()=>Response.json({data:{status:'connected'}})).requestFaceTime({to:message.to,from:message.from,sessionId:'session-one',idempotencyKey:'session-one:facetime'})).rejects.toThrow();
  });
  test('allocation rejects missing identity, arbitrary connector kinds and unsafe configuration', async () => {
    for (const data of [{...receipt,projectId:''}, {...receipt,connector:{kind:'admin',configuration:{token:'x'}}}, {...receipt,connector:{kind:'hosted-webhook',configuration:{}}}, {...receipt,connector:{kind:'hosted-webhook',configuration:{token:42}}}, {...receipt,connector:{kind:'hosted-webhook',configuration:JSON.parse('{"__proto__":"unsafe"}')}}]) await expect(bridge(()=>Response.json({data})).allocate(allocation)).rejects.toThrow();
  });
  test('ten-second timeout aborts fetch, has no retry and does not leak details', async () => {
    let calls=0,aborted=false;
    const client=bridge((_url,init)=>new Promise((_resolve,reject)=>{calls++;init.signal!.addEventListener('abort',()=>{aborted=true;reject(new Error('private timeout details'));});}));
    await expect(client.sendMessage(message)).rejects.toThrow('onboarding_worker_request_failed'); expect(calls).toBe(1); expect(aborted).toBe(true);
  },11000);
});
