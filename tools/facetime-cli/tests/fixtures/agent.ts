import { Fault } from '../../src/protocol/v1.js';
import type { Agent, Ready } from '../../src/runtime/agent.js';
import type { Budget, Scheduler } from '../../src/runtime/deadline.js';
import type { Entry } from '../../src/runtime/journal.js';
export class FakeAgent implements Agent {
  counts = { rooms: 0, jobs: 0, providers: 0, deleted: 0 };
  resources = new Map<string, { entry: Entry; expiresMono: number; job: boolean }>();
  beforeCreate?: () => Promise<void>;
  beforeReady?: () => Promise<void>;
  beforeDelete?: () => Promise<void>;
  readinessPatch: Partial<Ready> = {};
  ambiguous = false;
  inspectionUnknown = false;
  deleteFails = false;
  private operations = new Map<string, boolean>();
  private timers = new Map<string, () => void>();
  constructor(private clock: Scheduler) {}
  async settled(entry: Entry): Promise<boolean> {
    return !this.inspectionUnknown && this.operations.get(entry.marker) !== false;
  }
  async prepare(entry: Entry, budget: Budget, signal: AbortSignal): Promise<Ready> {
    this.operations.set(entry.marker, false);
    try { return await this.create(entry, budget, signal); }
    finally { this.operations.set(entry.marker, true); }
  }
  private async create(entry: Entry, budget: Budget, signal: AbortSignal): Promise<Ready> {
    budget.assert(true); if (signal.aborted) throw new Fault('terminal');
    if (this.resources.has(entry.room)) throw new Fault('preparation_failed');
    // Deliberately uncancellable external create to exercise late completion.
    await this.beforeCreate?.();
    if (this.resources.has(entry.room)) throw new Fault('preparation_failed');
    const expiresMono = this.clock.mono() + budget.resourceRemaining(entry.resource_expires_at);
    this.resources.set(entry.room, { entry: structuredClone(entry), expiresMono, job: false });
    this.counts.rooms++;
    this.timers.set(entry.room, this.clock.schedule(budget.resourceRemaining(entry.resource_expires_at), () => this.expire()));
    budget.assert(true); if (signal.aborted) throw new Fault('terminal');
    this.counts.jobs++; this.counts.providers++;
    this.resources.get(entry.room)!.job = true;
    if (this.ambiguous) throw new Fault('preparation_failed');
    await this.beforeReady?.();
    budget.assert(true); if (signal.aborted) throw new Fault('terminal');
    return { room: entry.room, job: entry.job, participant: entry.participant, nonce: entry.nonce, publishers: [entry.participant], prepared: true, bridge: { livekit_url: 'wss://synthetic.invalid', participant_token: 'SYNTHETIC_BRIDGE_SECRET_SENTINEL' }, ...this.readinessPatch };
  }
  async inspect(entry: Entry): Promise<'owned' | 'absent' | 'unknown' | 'foreign'> {
    if (this.inspectionUnknown) return 'unknown';
    const resource = this.resources.get(entry.room);
    if (!resource) return 'absent';
    return resource.entry.marker === entry.marker && resource.entry.job === entry.job ? 'owned' : 'foreign';
  }
  async delete(entry: Entry): Promise<void> {
    await this.beforeDelete?.();
    if (this.deleteFails) throw new Fault('cleanup_pending');
    if (await this.inspect(entry) !== 'owned') return;
    this.resources.delete(entry.room); this.counts.deleted++;
    this.timers.get(entry.room)?.(); this.timers.delete(entry.room);
  }
  expire(): void {
    for (const [id, resource] of this.resources) {
      if (this.clock.wall() >= resource.entry.resource_expires_at || this.clock.mono() >= resource.expiresMono) {
        this.resources.delete(id); this.counts.deleted++; this.timers.get(id)?.(); this.timers.delete(id);
      }
    }
  }
  close(): void { for (const cancel of this.timers.values()) cancel(); this.timers.clear(); }
}
