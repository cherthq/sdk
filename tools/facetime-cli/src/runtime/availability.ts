import { z } from 'zod';
import { Fault, id, type Code } from '../protocol/v1.js';
import type { Clock } from './deadline.js';
const healthSchema = z.strictObject({
  project: id, name: id, deployment: id, boot: id, challenge: id,
  sequence: z.number().int().positive(), observed_at: z.number().int().positive(),
  connected: z.boolean().nullable(), draining: z.boolean(), capacity: z.number().int().min(0).max(1).nullable(),
});
export type Health = z.infer<typeof healthSchema>;
export class Availability {
  private observation?: Health;
  private at = 0;
  private sequences = new Map<string, number>();
  private challenges = new Map<string, number>();
  private invalid = false;
  constructor(private clock: Clock, private credential: string, readonly expected: Pick<Health, 'project' | 'name' | 'deployment'>) {}
  challenge(value: string): void { this.challenges.clear(); this.challenges.set(value, this.clock.mono()); }
  observe(credential: string, raw: unknown): void {
    const parsed = healthSchema.safeParse(raw);
    if (credential !== this.credential || !parsed.success) { this.observation = undefined; throw new Fault('forbidden'); }
    const h = parsed.data;
    if (h.project !== this.expected.project || h.name !== this.expected.name || h.deployment !== this.expected.deployment) {
      this.observation = undefined; throw new Fault('forbidden');
    }
    const challengeAt = this.challenges.get(h.challenge);
    if (challengeAt === undefined || this.clock.mono() - challengeAt >= 5000 || h.sequence <= (this.sequences.get(h.boot) ?? 0) ||
        Math.abs(h.observed_at - this.clock.wall()) > 250) {
      this.invalid = true; throw new Fault('health_replay');
    }
    this.challenges.delete(h.challenge); this.sequences.set(h.boot, h.sequence);
    this.observation = h; this.at = this.clock.mono(); this.invalid = false;
  }
  check(): Code | 'available' {
    const h = this.observation;
    if (!h) return 'agent_availability_unknown';
    if (this.invalid || this.clock.mono() - this.at >= 5000 || this.clock.wall() - h.observed_at >= 5000) return 'agent_availability_stale';
    if (h.draining) return 'agent_draining';
    if (h.connected === null) return 'agent_availability_unknown';
    if (!h.connected) return 'agent_unavailable';
    if (h.capacity === null) return 'agent_availability_unknown';
    if (h.capacity === 0) return 'agent_capacity_exhausted';
    return 'available';
  }
}
