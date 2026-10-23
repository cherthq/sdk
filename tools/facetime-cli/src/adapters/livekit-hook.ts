import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { Fault } from '../protocol/v1.js';
import { boundedText } from '../transport/http.js';
import { Availability } from '../runtime/availability.js';

export const sessionSchema = z.strictObject({
  operation: z.string(), room: z.string(), marker: z.string(), nonce: z.string(), participant: z.string(),
  job: z.string(), dispatch: z.string().optional(), worker: z.string(), status: z.enum(['reserved', 'ready', 'ended']),
  cancelled: z.boolean(), track: z.string().optional(),
});
export const hookSchema = z.strictObject({
  project: z.string(), name: z.string(), deployment: z.string(), boot: z.string(), worker: z.string(),
  sequence: z.number().int().positive(), observed_at: z.number().int(), challenge: z.string(),
  connected: z.boolean().nullable(), draining: z.boolean(), capacity: z.number().int().min(0).max(1).nullable(),
  session: sessionSchema.nullable(), cancelled_operation: z.string().optional(),
});
export type HookSnapshot = z.infer<typeof hookSchema>;
export interface Hook {
  call(path: '/health' | '/cancel' | '/drain', payload?: Record<string, string>): Promise<HookSnapshot>;
}
export function projectFingerprint(url: string): string {
  return createHash('sha256').update(new URL(url).host.toLowerCase()).digest('hex');
}
export function mac(secret: string, domain: string, body: string): string {
  return createHmac('sha256', secret).update(`chert-adapter-v1:${domain}\n${body}`).digest('hex');
}
export class AuthenticatedHook implements Hook {
  private sequence = 0;
  constructor(private origin: string, private secret: string,
    readonly expected: Pick<HookSnapshot, 'project' | 'name' | 'deployment' | 'boot'>) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Fault('forbidden');
  }
  async call(path: '/health' | '/cancel' | '/drain', payload: Record<string, string> = {}): Promise<HookSnapshot> {
    const challenge = randomUUID(); const started = performance.now();
    const body = JSON.stringify({ challenge, issued: Date.now(), payload });
    try {
      const response = await fetch(`${this.origin}${path}`, { method: 'POST', body, redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-chert-mac': mac(this.secret, path, body) }, signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error();
      const raw = await boundedText(response, 8192);
      if (raw.length > 8192) throw new Error();
      const signature = response.headers.get('x-chert-mac') ?? '';
      const expected = mac(this.secret, 'response', raw);
      if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
      const h = hookSchema.parse(JSON.parse(raw));
      if (Object.entries(this.expected).some(([k, v]) => h[k as keyof HookSnapshot] !== v) || h.challenge !== challenge ||
        h.sequence <= this.sequence || Math.abs(Date.now() - h.observed_at) > 250 || performance.now() - started >= 1000) throw new Error();
      this.sequence = h.sequence; return h;
    } catch { throw new Fault('agent_availability_unknown'); }
  }
  async refresh(availability: Availability, credential: string): Promise<void> {
    try {
      const h = await this.call('/health');
      availability.challenge(h.challenge);
      const { worker: _worker, session: _session, cancelled_operation: _cancelled, ...health } = h;
      availability.observe(credential, health);
    } catch {
      // Invalidating an earlier observation is necessary: a failed sample must
      // not keep the previous healthy observation eligible for five seconds.
      try { availability.observe('', null); } catch { /* fail closed */ }
    }
  }
}
