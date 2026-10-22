/** Disposable loopback-only browser fixture. No live provider calls, payments or installed account changes. */
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { OnboardingCore, SqliteOnboardingStore } from '../core/index';
import { createOnboardingHandler, hmacInboundVerifier, withBrowserLinks } from './server';
import { SqliteBrowserStore } from './store';

const directory = await mkdtemp(join(tmpdir(), 'chert-service-preview-'));
await chmod(directory, 0o700);
const store = new SqliteOnboardingStore({ path: join(directory, 'onboarding.sqlite') });
const browserStore = new SqliteBrowserStore(join(directory, 'browser.sqlite'));
const key = randomBytes(32), webhookSecret = randomBytes(32).toString('base64url');
const fixtureToken = randomBytes(32).toString('base64url');
const messages: { text: string; idempotencyKey: string }[] = [];
let service: (request: Request) => Promise<Response>;
let core: OnboardingCore;
let origin: string;
let session: { sessionId: string; pollCapability: string } | undefined;
const html = () => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chert local fixture</title><style>body{font:17px/1.6 system-ui;background:#f4f2e9;color:#263c30;max-width:700px;margin:8vh auto;padding:24px}button,a{font:inherit;color:inherit}button{padding:12px 20px;border:1px solid #263c30;border-radius:40px;background:transparent;cursor:pointer}a{display:block;margin:24px 0}pre{white-space:pre-wrap}</style><h1>Chert local fixture</h1><p>No real phone, call, payment or production account is used. All data is disposable.</p><button id="start">Start a test setup</button><button id="verify">Simulate the inbound phone reply</button><p>Then create a passkey in the test browser. Production requires real user approval and signed provider events.</p><a id="open" hidden>Open onboarding</a><pre id="result" role="status"></pre><script>for(const action of ['start','verify'])document.getElementById(action).onclick=async()=>{const response=await fetch('/fixture/'+action,{method:'POST',headers:{'X-Fixture-Token':'${fixtureToken}','Content-Type':'application/json'},body:'{}'});const data=await response.json();document.getElementById('result').textContent=data.message;if(data.url){const link=document.getElementById('open');link.href=data.url;link.hidden=false;}}</script></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const server = Bun.serve({
  hostname: 'localhost', port: Number(process.env.CHERT_PREVIEW_PORT ?? 4192),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/fixture')) {
      if (request.method === 'GET' && url.pathname === '/fixture') return html();
      if (request.method !== 'POST' || request.headers.get('Origin') !== origin || request.headers.get('X-Fixture-Token') !== fixtureToken) return Response.json({ message: 'Fixture authorization required' }, { status: 403 });
      if (url.pathname === '/fixture/start') {
        if (!session) {
          const created = await service(new Request(origin + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+14155550123', contactConsent: true, originAgent: 'Codex preview', target: { kind: 'project', projectLabel: 'Local demonstration' }, resumeStrategy: 'manual' }) }));
          const result = await created.json();
          if (!created.ok) return Response.json({ message: 'Fixture setup unavailable' }, { status: created.status });
          session = result.data;
          await core.flushOutbox();
        }
        const welcome = messages.find(message => message.idempotencyKey === session!.sessionId + ':welcome')!;
        const link = /Continue securely: (\S+)/.exec(welcome.text)![1];
        return Response.json({ message: 'Disposable test session created. Open the page, then simulate the inbound reply here.', url: link });
      }
      if (url.pathname === '/fixture/verify' && session) {
        const welcome = messages.find(message => message.idempotencyKey === session!.sessionId + ':welcome')!;
        const code = /Reply (\d{6})/.exec(welcome.text)![1]!;
        const result = core.acceptVerifiedInbound({ sessionId: session.sessionId, eventId: 'fixture-inbound-' + session.sessionId, from: '+14155550123', body: code });
        return Response.json({ message: result.accepted ? 'Test phone reply verified. Continue in the onboarding page.' : 'The fixture already advanced or expired.' });
      }
      return Response.json({ message: 'Fixture step unavailable' }, { status: 409 });
    }
    return service(request);
  },
});
origin = `http://localhost:${server.port}`;
core = new OnboardingCore({ store, secretKey: key, mainLine: '+14155550100', messaging: withBrowserLinks({ sendMessage: async input => { messages.push(input); } }, { origin, secretKey: key }) });
service = createOnboardingHandler({ core, store, browserStore, secretKey: key, origin, rpId: 'localhost', mainLine: '+14155550100', sourceKey: request => server.requestIP(request)?.address ?? 'loopback', mode: 'local-fixture', contactConfigured: true, faceTimeConfigured: false, verifyInbound: hmacInboundVerifier({ secret: webhookSecret }) });
console.log(`Local fixture only: ${origin}/fixture`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.stop(true); store.close(); browserStore.close();
  await rm(directory, { recursive: true, force: true }); process.exit(0);
}
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
