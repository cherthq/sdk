import { createHmac } from 'node:crypto';
import type { AllocationProvider, MessagingProvider } from './types';

type MessageInput = Parameters<MessagingProvider['sendMessage']>[0];
type FaceTimeInput = Parameters<NonNullable<MessagingProvider['requestFaceTime']>>[0];
type AllocationInput = Parameters<AllocationProvider['allocate']>[0];
type Allocation = Awaited<ReturnType<AllocationProvider['allocate']>>;
export interface ChertOnboardingWorkerBridgeOptions {
  origin: string;
  outboundSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
}
const failure = () => new Error('onboarding_worker_request_failed');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const phone = (value: unknown) => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const identifier = (value: unknown): value is string => bounded(value, 200) && /^[A-Za-z0-9_:.\-]+$/.test(value);

/** Proposed authenticated bridge routes for the onboarding worker, not existing platform APIs.
 * A successful message response means provider acceptance only, never delivery/read or connected media.
 * The worker must persist idempotency before effects and reject stale/replayed or differently bound requests.
 * Use a distinct outbound key; never reuse this key for inbound webhook verification.
 */
export class ChertOnboardingWorkerBridge implements MessagingProvider, AllocationProvider {
  private readonly origin: string;
  constructor(private readonly options: ChertOnboardingWorkerBridgeOptions) {
    let url: URL;
    try { url = new URL(options.origin); } catch { throw new Error('invalid_onboarding_worker_configuration'); }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      Buffer.byteLength(options.outboundSecret) < 32) throw new Error('invalid_onboarding_worker_configuration');
    this.origin = url.origin;
  }
  private async request(path: string, input: { idempotencyKey: string }): Promise<Record<string, unknown>> {
    if (!identifier(input.idempotencyKey)) throw failure();
    let raw: string;
    try { raw = JSON.stringify(input); } catch { throw failure(); }
    if (Buffer.byteLength(raw) > 65_536) throw failure();
    const time = (this.options.now ?? Date.now)();
    if (!Number.isSafeInteger(time) || time < 0) throw failure();
    const timestamp = String(Math.floor(time / 1000));
    const signature = createHmac('sha256', this.options.outboundSecret).update(`${timestamp}.POST.${path}.${raw}`).digest('hex');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      const response = await (this.options.fetch ?? fetch)(this.origin + path, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Chert-Timestamp': timestamp, 'X-Chert-Signature': signature, 'Idempotency-Key': input.idempotencyKey },
        body: raw,
      });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') || Number(response.headers.get('Content-Length') ?? 0) > 65_536) throw failure();
      const reader = response.body?.getReader(); if (!reader) throw failure();
      let length = 0; const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > 65_536) { await reader.cancel(); throw failure(); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!record(envelope) || !record(envelope.data)) throw failure();
      return envelope.data;
    };
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(failure()); }, 10_000);
      })]);
    } catch { throw failure(); } finally { if (timer) clearTimeout(timer); }
  }
  private context(input: MessageInput | FaceTimeInput) {
    const value=input.context;if(value===undefined)return {};
    if(!record(value)||!identifier(value.sessionId)||!bounded(value.originAgent,80)||!record(value.target)||!['personal','project'].includes(String(value.target.kind))||(value.target.projectLabel!==undefined&&!bounded(value.target.projectLabel,200))||input.idempotencyKey.split(':')[0]!==value.sessionId||('sessionId' in input&&input.sessionId!==value.sessionId))throw failure();
    return {context:{sessionId:value.sessionId,originAgent:value.originAgent,target:{kind:value.target.kind,...(value.target.projectLabel?{projectLabel:value.target.projectLabel}:{})}}};
  }
  async sendMessage(input: MessageInput): Promise<void> {
    if (!phone(input.to) || !phone(input.from) || typeof input.text !== 'string' || !input.text || input.text.length > 16_000) throw failure();
    const data = await this.request('/v1/onboarding/messages', { to: input.to, from: input.from, text: input.text, idempotencyKey: input.idempotencyKey, ...this.context(input) } as MessageInput);
    if (data.accepted !== true || !bounded(data.providerMessageId, 200)) throw failure();
  }
  async requestFaceTime(input: FaceTimeInput): Promise<'requested' | 'busy' | 'unavailable'> {
    if (!phone(input.to) || !phone(input.from) || !identifier(input.sessionId)) throw failure();
    const data = await this.request('/v1/onboarding/facetime', { to: input.to, from: input.from, sessionId: input.sessionId, idempotencyKey: input.idempotencyKey, ...this.context(input) } as FaceTimeInput);
    if (!['requested', 'busy', 'unavailable'].includes(String(data.status))) throw failure();
    return data.status as 'requested' | 'busy' | 'unavailable';
  }
  async allocate(input: AllocationInput): Promise<Allocation> {
    if (!identifier(input.sessionId) || !identifier(input.userId) || !identifier(input.checkoutId) || !phone(input.phone) ||
      !['shared', 'dedicated'].includes(input.plan) || !record(input.target) || !['personal', 'project'].includes(String(input.target.kind)) ||
      (input.target.projectLabel !== undefined && !bounded(input.target.projectLabel, 200))) throw failure();
    const target = { kind: input.target.kind, ...(input.target.projectLabel ? { projectLabel: input.target.projectLabel } : {}) };
    const data = await this.request('/v1/onboarding/allocations', { sessionId: input.sessionId, userId: input.userId, phone: input.phone, plan: input.plan, checkoutId: input.checkoutId, target, idempotencyKey: input.idempotencyKey } as AllocationInput);
    if (!identifier(data.projectId) || !identifier(data.allocationId) || !identifier(data.entitlementId) || !record(data.connector) ||
      !['existing-connector', 'hosted-webhook'].includes(String(data.connector.kind)) || !record(data.connector.configuration)) throw failure();
    const entries = Object.entries(data.connector.configuration);
    if (!entries.length || entries.length > 32 || entries.some(([key, value]) => !bounded(key, 100) || key === '__proto__' || key === 'constructor' || key === 'prototype' || !bounded(value, 8192))) throw failure();
    // Select only receipt fields: do not forward arbitrary provider metadata or master credentials.
    return { projectId: data.projectId, allocationId: data.allocationId, entitlementId: data.entitlementId,
      connector: { kind: data.connector.kind as Allocation['connector']['kind'], configuration: Object.fromEntries(entries) as Record<string, string> } };
  }
}
