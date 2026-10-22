import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateRegistrationOptions, generateAuthenticationOptions,
  verifyRegistrationResponse, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { OnboardingCore, OnboardingError, type OnboardingStore, type Session } from '../core/index';
import type { MessagingProvider } from '../providers/types';
import type { StripeTestBilling } from '../providers/stripe';
import { SqliteBrowserStore } from './store';
import { renderOnboardingPage } from './browser';

export interface VerifiedInbound { eventId: string; sessionId: string; from: string; to: string; body: string }
export interface ServiceOptions {
  core: OnboardingCore;
  store: OnboardingStore;
  browserStore: SqliteBrowserStore;
  secretKey: Uint8Array;
  origin: string;
  rpId: string;
  mainLine: string;
  billing?: Pick<StripeTestBilling, 'createCheckout' | 'verifyPayment'>;
  verifyInbound?: (rawBody: string, headers: Headers) => Promise<VerifiedInbound>;
  /** The HTTP host supplies the socket address. Never trust arbitrary forwarded headers here. */
  sourceKey: (request: Request) => string;
  now?: () => number;
  /** Capability reporting only; the host is responsible for supplying real adapters. */
  mode: 'local-fixture' | 'staging';
  contactConfigured: boolean;
  faceTimeConfigured: boolean;
}
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const cookieName = 'chert_onboarding';
const openingToken = (key: Uint8Array, id: string) => digest(key, 'browser-opening', id);
function digest(key: Uint8Array, domain: string, text: string): string {
  return createHmac('sha256', key).update(domain + '\0' + text).digest('base64url');
}
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function originURL(value: string): URL {
  let url: URL; try { url = new URL(value); } catch { throw new Error('Invalid service origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an explicit HTTPS origin or loopback HTTP origin');
  }
  return url;
}
/** Append a first-party single-use browser link to the persisted welcome, never to CLI stdout. */
export function withBrowserLinks(provider: MessagingProvider, options: { origin: string; secretKey: Uint8Array }): MessagingProvider {
  const origin = originURL(options.origin).origin;
  if (options.secretKey.length !== 32) throw new Error('A 32-byte service key is required');
  return {
    sendMessage: input => {
      const [sessionId, kind] = input.idempotencyKey.split(':');
      const text = kind === 'welcome' && /^[A-Za-z0-9_-]{8,160}$/.test(sessionId ?? '')
        ? `${input.text}\nContinue securely: ${origin}/onboarding/${sessionId}?token=${openingToken(options.secretKey, sessionId!)}`
        : input.text;
      return provider.sendMessage({ ...input, text });
    },
    ...(provider.requestFaceTime ? { requestFaceTime: input => provider.requestFaceTime!(input) } : {}),
  };
}
/** Explicit bridge protocol for worker developers. Adapt provider-native signatures before this boundary. */
export function hmacInboundVerifier(options: { secret: string; now?: () => number }): NonNullable<ServiceOptions['verifyInbound']> {
  if (Buffer.byteLength(options.secret) < 32) throw new Error('A strong worker webhook secret is required');
  return async (raw, headers) => {
    const timestamp = headers.get('x-chert-timestamp') ?? '';
    const signature = headers.get('x-chert-signature') ?? '';
    if (!/^\d{10,12}$/.test(timestamp) || Math.abs(Math.floor((options.now ?? Date.now)() / 1000) - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) throw new HttpError(401, 'invalid_webhook');
    const expected = createHmac('sha256', options.secret).update(timestamp + '.' + raw).digest('hex');
    if (!equal(signature, expected)) throw new HttpError(401, 'invalid_webhook');
    let body: Record<string, unknown>; try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid_json'); }
    object(body, ['eventId', 'sessionId', 'from', 'to', 'body']);
    for (const key of ['eventId', 'sessionId', 'from', 'to', 'body']) if (typeof body[key] !== 'string') throw new HttpError(422, 'invalid_webhook');
    if ((body.eventId as string).length > 200 || (body.body as string).length > 1000) throw new HttpError(422, 'invalid_webhook');
    return body as unknown as VerifiedInbound;
  };
}
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(422, 'invalid_request');
}
async function rawBody(request: Request): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'json_required');
  const reader = request.body?.getReader(); if (!reader) return '{}';
  const chunks: Uint8Array[] = []; let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel(); }, 10_000);
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 65_536) { await reader.cancel(); throw new HttpError(413, 'body_too_large'); }
      chunks.push(part.value);
    }
    if (timedOut) throw new HttpError(408, 'request_timeout');
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
async function bodyJSON(request: Request): Promise<Record<string, unknown>> {
  const text = await rawBody(request);
  let result: unknown; try { result = JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new HttpError(422, 'invalid_request');
  return result as Record<string, unknown>;
}

export function createOnboardingHandler(options: ServiceOptions): (request: Request) => Promise<Response> {
  const origin = originURL(options.origin);
  if (options.secretKey.length !== 32 || options.rpId !== origin.hostname || !/^\+[1-9]\d{7,14}$/.test(options.mainLine)) throw new Error('Invalid onboarding security configuration');
  if (options.mode === 'local-fixture' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Fixture mode must stay on loopback');
  const now = options.now ?? Date.now;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
  const json = (data: unknown, status = 200) => Response.json({ data }, { status, headers });
  function session(id: string): Session {
    const value = options.store.getSession(id);
    if (!value) throw new HttpError(404, 'session_not_found');
    if (value.expiresAt <= now()) {options.core.expireSessions();throw new HttpError(410, 'session_expired');}
    return value;
  }
  function browser(request: Request, id: string, mutate = false): Session {
    const grant = options.browserStore.get(id);
    const cookies = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName + '='));
    const cookie = cookies.length === 1 ? cookies[0]!.slice(cookieName.length + 1) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(cookie) || !grant?.cookieHash || !equal(grant.cookieHash, digest(options.secretKey, 'cookie', cookie))) throw new HttpError(401, 'browser_auth_required');
    if(grant.expiresAt<=now()){options.core.expireSessions();throw new HttpError(410,'session_expired');}
    if (mutate && (request.headers.get('Origin') !== origin.origin || !equal(request.headers.get('X-CSRF-Token') ?? '', digest(options.secretKey, 'csrf', cookie)))) throw new HttpError(403, 'csrf_failed');
    return session(id);
  }
  function capability(request: Request): string {
    const value = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_-]{32,1024}$/.test(value)) throw new HttpError(401, 'unauthorized');
    return value.slice(7);
  }
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin.origin) throw new HttpError(400, 'origin_mismatch');
      const browserOrigin = request.headers.get('Origin');
      if (browserOrigin && browserOrigin !== origin.origin) throw new HttpError(403, 'origin_mismatch');
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'origin_mismatch');
      if (request.method === 'GET' && url.pathname === '/capabilities') return json({ mode: options.mode, messaging: options.contactConfigured, faceTime: options.faceTimeConfigured, passkeys: true, billing: options.billing ? 'stripe-test' : 'unconfigured', productionReady: false });
      if (request.method === 'POST' && url.pathname === '/sessions') {
        if (!options.contactConfigured || !options.verifyInbound) throw new HttpError(503, 'contact_unconfigured');
        const source = options.sourceKey(request);
        if (!source || !options.browserStore.allow(digest(options.secretKey, 'source', source), now(), 3_600_000, 10)) throw new HttpError(429, 'rate_limited');
        const body = await bodyJSON(request);
        object(body, ['phone', 'contactConsent', 'originAgent', 'target', 'resumeStrategy', 'ttlSeconds', 'preferFaceTime']);
        object(body.target, ['kind', 'projectLabel']);
        if (typeof body.phone !== 'string' || body.contactConsent !== true || typeof body.originAgent !== 'string' || !['personal', 'project'].includes(String(body.target.kind)) || (body.target.projectLabel !== undefined && typeof body.target.projectLabel !== 'string') || !['poll', 'manual'].includes(String(body.resumeStrategy)) || (body.ttlSeconds !== undefined && typeof body.ttlSeconds !== 'number') || (body.preferFaceTime !== undefined && typeof body.preferFaceTime !== 'boolean')) throw new HttpError(422, 'invalid_request');
        const created = options.core.createSession(body as unknown as Parameters<OnboardingCore['createSession']>[0]);
        try {
          options.browserStore.create({ sessionId: created.sessionId, openingHash: digest(options.secretKey, 'opening-hash', openingToken(options.secretKey, created.sessionId)), cookieHash: null, expiresAt: created.expiresAt });
        } catch { options.core.cancel(created.sessionId, created.pollCapability); throw new HttpError(503, 'session_unavailable'); }
        return json(created, 201);
      }
      const cli = /^\/sessions\/([A-Za-z0-9_-]{8,160})(\/claim|\/cancel)?$/.exec(url.pathname);
      if (cli) {
        const id = cli[1]!, cap = capability(request);
        if (request.method === 'GET' && !cli[2]) return json(options.core.getSession(id, cap));
        if (request.method === 'POST' && ['/claim', '/cancel'].includes(cli[2] ?? '')) {
          object(await bodyJSON(request), []);
          if (cli[2] === '/claim') return json(options.core.claim(id, cap));
          options.core.cancel(id, cap); options.browserStore.revoke(id); return json({ sessionId: id, state: 'cancelled' });
        }
        throw new HttpError(405, 'method_not_allowed');
      }
      if (request.method === 'POST' && url.pathname === '/webhooks/messages') {
        if (!options.verifyInbound) throw new HttpError(503, 'contact_unconfigured');
        let verified: VerifiedInbound; try { verified = await options.verifyInbound(await rawBody(request), request.headers); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(401, 'invalid_webhook'); }
        if (verified.to !== options.mainLine) throw new HttpError(403, 'wrong_recipient');
        return json(options.core.acceptVerifiedInbound(verified));
      }
      if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
        if (!options.billing) throw new HttpError(503, 'billing_unconfigured');
        let payment; try { payment = await options.billing.verifyPayment(await rawBody(request), request.headers.get('Stripe-Signature') ?? ''); } catch { throw new HttpError(400, 'invalid_payment'); }
        if (!payment) return json({ received: true });
        const current = options.store.getSession(payment.sessionId);
        if (!current || current.userId !== payment.userId || current.checkoutId !== payment.checkoutId || current.plan !== payment.plan) throw new HttpError(403, 'payment_identity_mismatch');
        if (!current.paymentEvent && (current.expiresAt <= now() || ['cancelled','expired','failed'].includes(current.state))) {
          options.core.queueVerifiedPaymentRecovery(payment);
          return json({received:true,reconciliationRequired:true});
        }
        return json(options.core.recordVerifiedPayment(payment));
      }
      const route = /^\/onboarding\/([A-Za-z0-9_-]{8,160})(?:\/(open|status|passkey\/options|passkey\/verify|plan|checkout|cancel))?$/.exec(url.pathname);
      if (!route) throw new HttpError(404, 'not_found');
      const id = route[1]!, action = route[2];
      if (request.method === 'GET' && !action && url.searchParams.has('token')) {
        const token = url.searchParams.get('token') ?? '', grant = options.browserStore.get(id);
        session(id);
        if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !grant?.openingHash || !equal(grant.openingHash,digest(options.secretKey,'opening-hash',token))) throw new HttpError(401,'browser_link_expired');
        const nonce=randomBytes(24).toString('base64url');
        // A link preview must not consume the grant or establish an authenticated session.
        const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Continue Chert setup</title><style nonce="${nonce}">body{background:#f4f2e9;color:#263c30;font:17px/1.6 system-ui;max-width:560px;margin:12vh auto;padding:28px}.logo{font:44px Georgia}h1{font:46px/1.1 Georgia;letter-spacing:-1.5px}button{border:0;border-radius:40px;background:#294e35;color:#fff;padding:14px 24px;font:inherit;cursor:pointer}p{color:#637166}</style><span class="logo">chert</span><h1>Continue your setup.</h1><p>Only continue if you asked your agent to connect with Chert. You will verify your number, approve a passkey and choose a plan before paying.</p><button id="continue">Continue setup</button><p id="message" role="status"></p><script nonce="${nonce}">document.getElementById('continue').onclick=async()=>{const button=document.getElementById('continue');button.disabled=true;try{const response=await fetch('/onboarding/${id}/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}})});if(!response.ok)throw Error();location.replace('/onboarding/${id}');}catch{document.getElementById('message').textContent='This link could not open. It may have expired or already been used. Return to your agent for help.';button.disabled=false;}};</script></html>`;
        return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`}});
      }
      if(request.method==='POST'&&action==='open'){
        if(request.headers.get('Origin')!==origin.origin)throw new HttpError(403,'origin_mismatch');
        const body=await bodyJSON(request);object(body,['token']);
        const cookie=randomBytes(32).toString('base64url');
        const current=session(id);
        if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token)||!options.browserStore.exchange(id,digest(options.secretKey,'opening-hash',body.token),digest(options.secretKey,'cookie',cookie),now()))throw new HttpError(401,'browser_link_expired');
        const remaining=Math.max(0,Math.floor((current.expiresAt-now())/1000));
        return Response.json({data:{opened:true}},{headers:{...headers,'Set-Cookie':`${cookieName}=${cookie}; Path=/onboarding/${id}; HttpOnly; SameSite=Lax; Max-Age=${remaining}${origin.protocol==='https:'?'; Secure':''}`}});
      }
      const current = browser(request, id, request.method !== 'GET');
      if (request.method === 'GET' && action === 'status') return json({ sessionId: id, state: current.state, phoneVerified: current.phoneVerified, passkeyRegistered: current.passkeyRegistered, plan: current.plan, checkoutStarted: current.checkoutStarted === true || Boolean(current.checkoutId), passkeyMode: current.phoneVerified && options.store.getPasskeys(current.userId).length ? 'authenticate' : 'register' });
      if (request.method === 'GET' && !action) {
        const cookie = (request.headers.get('Cookie') ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))!.slice(cookieName.length + 1);
        const nonce = randomBytes(24).toString('base64url');
        const html = renderOnboardingPage({ environmentLabel: options.mode === 'local-fixture' ? 'Local fixture — no messages or charges' : 'Staging — Stripe test mode', sessionId: id, agent: current.originAgent, targetLabel: current.target.kind === 'project' ? current.target.projectLabel ?? 'Your project' : 'Your personal agent', csrf: digest(options.secretKey, 'csrf', cookie), state: current.state, phoneVerified: current.phoneVerified, passkeyRegistered: current.passkeyRegistered, passkeyMode: current.phoneVerified && options.store.getPasskeys(current.userId).length ? 'authenticate' : 'register', nonce });
        return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` } });
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const body = await bodyJSON(request);
      if (action === 'cancel') {
        object(body, []);
        // Trusted browser cancellation cannot acquire or disclose the CLI poll capability.
        options.core.cancelVerifiedSession(id); options.browserStore.revoke(id);
        return json({ sessionId: id, state: 'cancelled' });
      }
      if (action === 'passkey/options') {
        object(body, ['mode']);
        if (!['register', 'authenticate'].includes(String(body.mode))) throw new HttpError(422, 'invalid_request');
        if (!options.browserStore.allow('passkey:' + id, now(), 60_000, 10)) throw new HttpError(429, 'rate_limited');
        const identity = options.core.registrationContext(id);
        const credentials = options.store.getPasskeys(identity.userId);
        if (body.mode === 'register' && credentials.length) throw new HttpError(403, 'existing_passkey_required');
        if (body.mode === 'authenticate' && !credentials.length) throw new HttpError(409, 'no_passkey');
        const webOptions = body.mode === 'register'
          ? await generateRegistrationOptions({ rpName: 'Chert', rpID: options.rpId, userID: new Uint8Array(Buffer.from(identity.userId)), userName: 'Chert account', attestationType: 'none', excludeCredentials: credentials.map(c => ({ id: c.credentialId })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' } })
          : await generateAuthenticationOptions({ rpID: options.rpId, allowCredentials: credentials.map(c => ({ id: c.credentialId })), userVerification: 'required' });
        options.browserStore.putChallenge({ sessionId: id, mode: body.mode as 'register' | 'authenticate', challenge: webOptions.challenge, expiresAt: Math.min(current.expiresAt, now() + 300_000) });
        return json({ mode: body.mode, options: webOptions });
      }
      if (action === 'passkey/verify') {
        object(body, ['mode', 'credential']);
        if (!['register', 'authenticate'].includes(String(body.mode)) || !body.credential || typeof body.credential !== 'object') throw new HttpError(422, 'invalid_request');
        const identity = options.core.registrationContext(id);
        const challenge = options.browserStore.takeChallenge(id, body.mode as 'register' | 'authenticate', now());
        if (!challenge) throw new HttpError(403, 'challenge_expired');
        try {
          if (body.mode === 'register') {
            const registration = body.credential as RegistrationResponseJSON;
            // The browser requested anonymous attestation; reject certificate-bearing formats before
            // entering verifier paths that may fetch revocation/metadata services.
            const attestation = decodeAttestationObject(new Uint8Array(Buffer.from(registration.response.attestationObject,'base64url')));
            if(attestation.get('fmt')!=='none'||attestation.get('attStmt').size!==0) throw new Error();
            const result = await verifyRegistrationResponse({ response: registration, expectedChallenge: challenge.challenge, expectedOrigin: origin.origin, expectedRPID: options.rpId, requireUserVerification: true });
            if (!result.verified || !result.registrationInfo) throw new Error();
            const credential = result.registrationInfo.credential;
            options.core.registerVerifiedPasskey({ sessionId: id, userId: identity.userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter });
          } else {
            const response = body.credential as AuthenticationResponseJSON;
            const credential = options.store.getPasskey(response.id);
            if (!credential || credential.userId !== identity.userId || (response.response.userHandle && response.response.userHandle !== Buffer.from(identity.userId).toString('base64url'))) throw new Error();
            const result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin.origin, expectedRPID: options.rpId, credential: { id: credential.credentialId, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter }, requireUserVerification: true });
            if (!result.verified) throw new Error();
            options.core.acceptVerifiedPasskey({ sessionId: id, userId: identity.userId, credentialId: credential.credentialId, counter: result.authenticationInfo.newCounter });
          }
        } catch { throw new HttpError(403, 'passkey_verification_failed'); }
        return json({ verified: true });
      }
      if (action === 'plan') {
        object(body, ['plan']);
        if (body.plan !== 'shared' && body.plan !== 'dedicated') throw new HttpError(422, 'invalid_plan');
        return json(options.core.choosePlan(id, body.plan));
      }
      if (action === 'checkout') {
        object(body, []);
        if (!options.billing) throw new HttpError(503, 'billing_unconfigured');
        if (current.state !== 'payment_pending' || !current.plan) throw new HttpError(409, 'invalid_state');
        if (current.checkoutId && current.checkoutUrl) return json({ url: current.checkoutUrl });
        if(current.expiresAt-now()<1_800_000) throw new HttpError(409,'session_near_expiry');
        const reservation=options.core.reserveCheckout(id);
        const checkout = await options.billing.createCheckout({ sessionId: id, userId: reservation.userId, plan: reservation.plan, expiresAt:current.expiresAt, successPath: `/onboarding/${id}`, cancelPath: `/onboarding/${id}` });
        options.core.attachCheckout(id, { ...checkout, plan: current.plan });
        return json({ url: checkout.url });
      }
      throw new HttpError(404, 'not_found');
    } catch (error) {
      const status = error instanceof HttpError || error instanceof OnboardingError ? error.status : 503;
      const code = error instanceof HttpError || error instanceof OnboardingError ? error.code : 'service_unavailable';
      return Response.json({ error: { code } }, { status, headers });
    }
  };
}
