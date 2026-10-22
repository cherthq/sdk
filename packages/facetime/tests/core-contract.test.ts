import { test, expect } from 'bun:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OnboardingCore, SqliteOnboardingStore } from '../../onboarding/src/core';
import type { MessagingProvider } from '../../onboarding/src/providers/types';
import { startOnboarding, pollOnboarding } from '../src/onboard';

/** Real core/storage + JSON wire serialization; trusted provider callbacks are fixtures, not live verification. */
test('concierge CLI claims a real persisted onboarding-core receipt over the serialized route contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chert-core-cli-contract-'));
  const store = new SqliteOnboardingStore({ path: join(directory, 'onboarding.sqlite') });
  const messages: { text: string; idempotencyKey: string }[] = [];
  const messaging: MessagingProvider = { async sendMessage(input) { messages.push(input); } };
  const clock = Date.now();
  const core = new OnboardingCore({ store, secretKey: new Uint8Array(32).fill(31), mainLine: '+14155550100', messaging, now: () => clock });
  const routes: { method: string; path: string }[] = [];
  let sessionId = '', capability = '';
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    routes.push({ method, path: url.pathname });
    try {
      let data: unknown;
      if (method === 'POST' && url.pathname === '/sessions') {
        data = core.createSession(JSON.parse(String(init?.body)));
        const started = data as { sessionId: string; pollCapability: string };
        sessionId = started.sessionId; capability = started.pollCapability;
      } else {
        const parts = url.pathname.split('/').filter(Boolean);
        const headers = new Headers(init?.headers), bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        if (parts[0] !== 'sessions' || parts[1] !== sessionId) return Response.json({ error: 'not_found' }, { status: 404 });
        if (method === 'GET' && parts.length === 2) data = core.getSession(parts[1], bearer);
        else if (method === 'POST' && parts[2] === 'claim') data = core.claim(parts[1], bearer);
        else return Response.json({ error: 'not_found' }, { status: 404 });
      }
      // Response.json forces the same Date/string/undefined serialization boundary as an HTTP worker.
      return Response.json({ data });
    } catch { return Response.json({ error: 'invalid_state_or_capability' }, { status: 409 }); }
  }) as unknown as typeof globalThis.fetch;
  try {
    const emitted: unknown[] = [];
    const start = await startOnboarding({ baseUrl: 'https://onboarding.example', phone: '+14155550123', consent: true, agent: 'codex', target: 'project', projectLabel: 'demo' }, { temporaryRoot: directory, fetch, now: () => clock, emit: event => emitted.push(event) });
    const helper = String(start.helperFile);
    const pending = await pollOnboarding(helper, { fetch, now: () => clock });
    expect(pending.status).toBe('pending');
    expect(pending.phoneVerified).toBe(false);
    await core.flushOutbox();
    const challenge = messages.find(message => message.idempotencyKey === sessionId + ':welcome')?.text.match(/Reply (\d+)/)?.[1];
    expect(challenge).toBeTruthy();
    core.acceptVerifiedInbound({ sessionId, eventId: 'verified-inbound-contract', from: '+14155550123', body: challenge! });
    const { userId } = core.registrationContext(sessionId);
    core.registerVerifiedPasskey({ sessionId, userId, credentialId: 'contract-passkey', publicKey: 'fixture-public-key', counter: 0 });
    expect(store.getPasskey('contract-passkey')?.userId).toBe(userId);
    core.choosePlan(sessionId, 'dedicated');
    core.attachCheckout(sessionId, { checkoutId: 'cs_test_contract', url: 'https://checkout.stripe.com/c/pay/fixture', plan: 'dedicated' });
    core.recordVerifiedPayment({ sessionId, eventId: 'verified-payment-contract', checkoutId: 'cs_test_contract', plan: 'dedicated' });
    expect((await pollOnboarding(helper, { fetch, now: () => clock })).status).toBe('pending');
    const credential = 'scoped-contract-connector-secret';
    core.completeProvisioning(sessionId, { projectId: 'contract-project', allocationId: 'contract-line', entitlementId: 'contract-entitlement', connector: { kind: 'existing-connector', configuration: { token: credential } } });
    const result = await pollOnboarding(helper, { fetch, now: () => clock });
    expect(result.status).toBe('complete');
    const receipt = JSON.parse(await readFile(String(result.completionFile), 'utf8'));
    expect(receipt).toMatchObject({ sessionId, userId, projectId: 'contract-project', allocationId: 'contract-line', connector: { kind: 'existing-connector', configuration: { token: credential } } });
    expect((await stat(String(result.completionFile))).mode & 0o777).toBe(0o600);
    expect((await stat(String(result.handoffFile))).mode & 0o777).toBe(0o600);
    const continuation = await readFile(String(result.handoffFile), 'utf8');
    expect(continuation).toContain('Do not print its credentials');
    expect(continuation).not.toContain(credential);
    expect(JSON.stringify([start, pending, result, ...emitted])).not.toContain(capability);
    expect(JSON.stringify([start, pending, result, ...emitted])).not.toContain(credential);
    expect(await readFile(helper, 'utf8')).not.toContain(capability);
    expect(() => core.claim(sessionId, capability)).toThrow('session_closed');
    expect((await pollOnboarding(helper, { fetch, now: () => clock })).status).toBe('complete');
    expect(routes.filter(route => route.path.endsWith('/claim'))).toHaveLength(1);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
