import { mkdir, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { OnboardingCore, SqliteOnboardingStore } from '../core/index';
import { ChertOnboardingWorkerBridge } from '../providers/worker-bridge';
import { StripeTestBilling } from '../providers/stripe';
import { createOnboardingHandler, hmacInboundVerifier, withBrowserLinks } from './server';
import { SqliteBrowserStore } from './store';
import type { StagingConfig } from './staging-config';

async function privateDatabase(path: string): Promise<void> {
  try { const file = await open(path, 'wx', 0o600); await file.close(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('Staging database must be an owner-only regular file');
}
export interface StagingHostOptions {
  /** Fixture injection only; the command-line host always uses Stripe's fixed API origin. */
  stripeFetch?: typeof fetch;
  dispatcherIntervalMs?: number;
  onDispatcherError?: () => void;
}
/** Persistent loopback listener for a separately configured HTTPS reverse proxy. No production mode. */
export async function startStagingHost(config: StagingConfig, options: StagingHostOptions = {}) {
  await mkdir(config.dataDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(config.dataDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) || (process.getuid && directory.uid !== process.getuid())) throw new Error('Staging data directory must be owner-only');
  const corePath = join(config.dataDirectory, 'onboarding.sqlite'), browserPath = join(config.dataDirectory, 'browser.sqlite');
  await privateDatabase(corePath); await privateDatabase(browserPath);
  const bridge = new ChertOnboardingWorkerBridge({ origin: config.workerOrigin, outboundSecret: config.outboundSecret });
  const billing = new StripeTestBilling({ secretKey: config.stripeSecret, webhookSecret: config.stripeWebhookSecret, prices: config.stripePrices, origin: config.publicOrigin, fetch: options.stripeFetch });
  const store = new SqliteOnboardingStore({ path: corePath });
  let browserStore: SqliteBrowserStore;
  try { browserStore = new SqliteBrowserStore(browserPath); } catch (error) { store.close(); throw error; }
  const core = new OnboardingCore({ store, secretKey: config.encryptionKey, mainLine: config.mainLine, messaging: withBrowserLinks(bridge, { origin: config.publicOrigin, secretKey: config.encryptionKey }), allocator: bridge });
  const sourceAddresses = new WeakMap<Request, string>();
  let handler: ReturnType<typeof createOnboardingHandler> | undefined;
  let server;
  try {
    server = Bun.serve({
      hostname: '127.0.0.1', port: config.port, maxRequestBodySize: 65_536, idleTimeout: 30,
      fetch(request) {
        if (!handler) return new Response('Starting', { status: 503 });
        const supplied=Buffer.from(request.headers.get('X-Chert-Proxy-Token')??''),expected=Buffer.from(config.proxySecret);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return new Response('Proxy authorization required',{status:401,headers:{'Cache-Control':'no-store'}});
        const source=request.headers.get('X-Chert-Client-IP')??'';
        if(!isIP(source))return new Response('Proxy client address required',{status:400,headers:{'Cache-Control':'no-store'}});
        const received = new URL(request.url);
        // Only the authenticated TLS proxy may supply a validated client IP; ignore other forwarding headers.
        const canonical = new Request(config.publicOrigin + received.pathname + received.search, request);
        sourceAddresses.set(canonical,source);
        return handler(canonical);
      },
      error() { return Response.json({ error: { code: 'service_unavailable' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); },
    });
  } catch (error) { store.close(); browserStore.close(); throw error; }
  const allowed = new Set(config.recipients);
  try { handler = createOnboardingHandler({
    core, store, browserStore, secretKey: config.encryptionKey, origin: config.publicOrigin,
    rpId: new URL(config.publicOrigin).hostname, mainLine: config.mainLine,
    sourceKey: request => sourceAddresses.get(request) ?? 'unknown-socket',
    mode: 'staging', contactConfigured: true, faceTimeConfigured: config.faceTimeEnabled,
    allowContact: phone => allowed.has(phone), billing,
    verifyInbound: hmacInboundVerifier({ secret: config.inboundSecret }),
  }); } catch(error) {await server.stop(true);store.close();browserStore.close();throw error;}
  let pending: Promise<void> | undefined, closing = false, closePromise:Promise<void>|undefined;
  function dispatch(): Promise<void> {
    if (pending || closing) return pending ?? Promise.resolve();
    pending = core.flushOutbox(1).then(() => {}, () => { options.onDispatcherError?.(); }).finally(() => { pending = undefined; });
    return pending;
  }
  const intervalMs = options.dispatcherIntervalMs ?? 1000;
  if (!Number.isInteger(intervalMs) || intervalMs < 20 || intervalMs > 60_000) {
    await server.stop(true); store.close(); browserStore.close(); throw new Error('Invalid staging dispatcher interval');
  }
  const timer = setInterval(() => { void dispatch(); }, intervalMs);
  return {
    server, core, store, browserStore,
    close(): Promise<void> {
      if(closePromise)return closePromise; closing=true;clearInterval(timer);
      closePromise=(async()=>{await server.stop(false);await pending;store.close();browserStore.close();})();
      return closePromise;
    },
  };
}
