import { randomUUID } from 'node:crypto';
import { Fault, digest, decisionSchema, incomingSchema, key, ownerOf, scopeOf, sameOwner, sameScope, type Ack, type Cancel, type Code, type Decision, type Incoming, type Lifecycle, type Owner, type Receipt, type Scope } from '../protocol/v1.js';
import { Budget, type Scheduler } from './deadline.js';
import type { Journal, Entry } from './journal.js';
import type { Agent } from './agent.js';
import type { Availability } from './availability.js';
import type { Reconciliation } from './reconciliation.js';

interface Preparation { abort: AbortController; finish: (decision: Decision) => void; stopTimer: () => void }
function completed(entry: Entry): boolean {
  // Local expiry/departure is terminal too, but still carries reconciliation
  // debt. Only a terminal entry with every obligation settled is complete.
  return entry.terminal && !entry.create_pending && !entry.cleanup_debt && !entry.reconcile_debt;
}
export class Connector {
  connected = true;
  role: 'active' | 'standby' | 'draining' = 'active';
  private tasks = new Set<Promise<void>>();
  private pending = new Map<string, Promise<Decision>>();
  private preparing = new Map<string, Preparation>();
  private cleanups = new Map<string, Promise<void>>();
  private expiry = new Map<string, number>();
  private bridgeAbsent = new Map<string, number>();
  private stopPeriodic?: () => void;
  readonly diagnostics: Code[] = [];
  constructor(public scope: Scope, readonly journal: Journal, readonly agent: Agent, readonly availability: Availability, readonly clock: Scheduler) {
    for (const entry of Object.values(journal.snapshot().entries)) {
      this.expiry.set(key(entry.owner), clock.mono() + Math.max(0, entry.resource_expires_at - clock.wall()));
    }
  }
  check(): Code | 'available' {
    if (!this.journal.healthy) return 'journal_unavailable';
    if (!this.connected) return 'relay_unavailable';
    if (this.role === 'standby') return 'binding_standby';
    if (this.role === 'draining') return 'binding_draining';
    const entries = Object.values(this.journal.snapshot().entries);
    if (entries.some(e => e.cleanup_debt || e.reconcile_debt)) return 'cleanup_pending';
    if (entries.some(e => !e.terminal && !['declined'].includes(e.state))) return 'agent_capacity_exhausted';
    return this.availability.check();
  }
  private decline(incoming: Owner, reason: Code): Decision {
    return { ...ownerOf(incoming), v: 1, type: 'call.decision', message_id: randomUUID(), action: 'decline', reason };
  }
  async incoming(raw: Incoming): Promise<Decision> {
    const parsed = incomingSchema.safeParse(raw);
    if (!parsed.success) throw new Fault('invalid_frame');
    const incoming = parsed.data;
    if (!sameScope(this.scope, incoming, false)) throw new Fault('forbidden');
    if (!sameScope(this.scope, incoming)) throw new Fault('stale_generation');
    const tombstone = this.journal.snapshot().tombstones[key(incoming)];
    if (tombstone) {
      if (!sameOwner(tombstone.owner, incoming, false)) throw new Fault('forbidden');
      return this.decline(incoming, 'terminal');
    }
    const existing = this.journal.get(incoming);
    if (existing) {
      if (!sameOwner(existing.owner, incoming, false)) throw new Fault('forbidden');
      if (existing.digest !== digest(incoming)) throw new Fault('request_conflict');
      if (existing.terminal) return this.decline(incoming, 'terminal');
      const underway = this.pending.get(key(incoming));
      if (underway) return underway;
      return this.decline(incoming, 'acceptance_uncertain');
    }
    if (incoming.media.video) return this.decline(incoming, 'readiness_invalid');
    const gate = this.check();
    if (gate !== 'available') { this.diagnostics.push(gate); return this.decline(incoming, gate); }
    let budget: Budget;
    try { budget = new Budget(this.clock, incoming); budget.assert(true); }
    catch (error) { return this.decline(incoming, error instanceof Fault ? error.code : 'invalid_deadline'); }
    const entry: Entry = {
      owner: ownerOf(incoming), digest: digest(incoming), room: randomUUID(), job: randomUUID(), marker: randomUUID(), nonce: randomUUID(), participant: randomUUID(),
      resource_expires_at: incoming.resource_expires_at, state: 'intent', version: 0, terminal: false,
      cleanup_debt: false, reconcile_debt: false, create_pending: true, bridge_seen: false,
    };
    if (incoming.resource_expires_at <= incoming.deadline_at || incoming.resource_expires_at > incoming.created_at + 60_000) throw new Fault('invalid_deadline');
    this.journal.write(entry); // Ownership intent is durable before any side effect.
    const id = key(incoming);
    this.expiry.set(id, this.clock.mono() + budget.resourceRemaining(incoming.resource_expires_at));
    let finish!: (decision: Decision) => void;
    const result = new Promise<Decision>(resolve => { finish = resolve; });
    this.pending.set(id, result);
    const preparation: Preparation = { abort: new AbortController(), finish, stopTimer: () => undefined };
    this.preparing.set(id, preparation);
    preparation.stopTimer = this.clock.schedule(budget.remaining(true), () => this.stopPreparation(incoming, 'deadline_exceeded'));
    const task = this.prepare(entry, incoming, budget, preparation).catch(() => {
      this.diagnostics.push('journal_unavailable'); preparation.stopTimer(); preparation.finish(this.decline(incoming, 'journal_unavailable'));
    }).finally(() => { this.pending.delete(id); this.preparing.delete(id); this.tasks.delete(task); });
    this.tasks.add(task);
    return result;
  }
  private async prepare(entry: Entry, incoming: Incoming, budget: Budget, p: Preparation): Promise<void> {
    let response: Decision;
    try {
      const ready = await this.agent.prepare(entry, budget, p.abort.signal);
      budget.assert(true);
      const current = this.journal.get(entry.owner)!;
      if (current.terminal || p.abort.signal.aborted || !sameScope(this.scope, incoming)) throw new Fault('terminal');
      if (!ready.prepared || ready.room !== entry.room || ready.job !== entry.job || ready.participant !== entry.participant || ready.nonce !== entry.nonce ||
          ready.publishers.length !== 1 || ready.publishers[0] !== entry.participant) throw new Fault('readiness_invalid');
      const bridge = decisionSchema.parse({ ...ownerOf(incoming), v: 1, type: 'call.decision', message_id: randomUUID(), action: 'accept',
        livekit_url: ready.bridge.livekit_url, participant_token: ready.bridge.participant_token, remote_participant_identity: entry.participant });
      this.journal.write({ ...current, create_pending: false, state: 'prepared' });
      budget.assert(true);
      this.journal.write({ ...this.journal.get(entry.owner)!, state: 'decision_sent', reconcile_debt: true });
      response = bridge;
    } catch (error) {
      const current = this.journal.get(entry.owner)!;
      // A local rejection does not settle the remote create; cleanup must verify it.
      this.journal.write({ ...current, state: current.terminal ? current.state : 'declined', terminal: true, cleanup_debt: true });
      response = this.decline(incoming, error instanceof Fault ? error.code : 'preparation_failed');
      this.queueCleanup(entry.owner);
    }
    p.stopTimer(); p.finish(response);
  }
  private stopPreparation(owner: Owner, reason: Code): void {
    const p = this.preparing.get(key(owner)); if (!p) return;
    const entry = this.journal.get(owner)!;
    if (entry.state === 'decision_sent' || entry.state === 'accepted') return;
    try {
      this.journal.write({ ...entry, terminal: true, state: 'declined', cleanup_debt: true });
      p.abort.abort(); p.stopTimer(); p.finish(this.decline(owner, reason));
      this.queueCleanup(owner);
    } catch { p.abort.abort(); p.stopTimer(); p.finish(this.decline(owner, 'journal_unavailable')); }
  }
  private entryFor(owner: Owner): Entry {
    if (!sameScope(this.scope, owner, false)) throw new Fault('forbidden');
    const entry = this.journal.get(owner);
    if (!entry || !sameOwner(entry.owner, owner, false)) throw new Fault('forbidden');
    return entry;
  }
  committed(receipt: Receipt): void {
    if (!sameScope(this.scope, receipt, false)) throw new Fault('forbidden');
    // Health/standby gates decline before creating an ownership intent. A central
    // decline can safely tombstone that request; an unknown accept cannot.
    if (!this.journal.get(receipt) && receipt.action === 'decline') {
      this.journal.tombstone(ownerOf(receipt), receipt.call_version);
      return;
    }
    const entry = this.entryFor(receipt);
    if (receipt.resource_expires_at !== entry.resource_expires_at) throw new Fault('request_conflict');
    if (receipt.call_version < entry.version || entry.terminal) return;
    this.journal.write({ ...entry, state: receipt.action === 'accept' ? 'accepted' : 'declined', version: receipt.call_version,
      terminal: receipt.action === 'decline', reconcile_debt: false, cleanup_debt: receipt.action === 'decline' });
    if (receipt.action === 'decline') this.queueCleanup(receipt);
  }
  cancel(cancel: Cancel): Ack {
    if (!sameScope(this.scope, cancel, false)) throw new Fault('forbidden');
    if (!this.journal.get(cancel)) {
      this.journal.tombstone(ownerOf(cancel), cancel.call_version);
      return { ...ownerOf(cancel), v: 1, type: 'cancel.ack', message_id: randomUUID(), event_id: cancel.message_id, cursor: 0 };
    }
    const entry = this.entryFor(cancel);
    if (cancel.call_version >= entry.version && cancel.terminal) {
      this.journal.write({ ...entry, terminal: true, state: 'terminal', version: cancel.call_version, cleanup_debt: true, reconcile_debt: false });
      const p = this.preparing.get(key(cancel));
      p?.abort.abort(); p?.stopTimer(); p?.finish(this.decline(cancel, 'terminal'));
      this.queueCleanup(cancel);
    } else if (!cancel.terminal) this.stopPreparation(cancel, 'terminal');
    return { ...ownerOf(cancel), v: 1, type: 'cancel.ack', message_id: randomUUID(), event_id: cancel.message_id, cursor: 0 };
  }
  lifecycle(event: Lifecycle): Ack {
    if (!sameScope(this.scope, event, false)) throw new Fault('forbidden');
    if (!this.journal.get(event)) {
      if (event.transition !== 'started') this.journal.tombstone(ownerOf(event), event.call_version);
      this.journal.receipt(event.cursor, event.event_id);
      return { ...ownerOf(event), v: 1, type: 'lifecycle.ack', message_id: randomUUID(), event_id: event.event_id, cursor: event.cursor };
    }
    const entry = this.entryFor(event);
    if (event.call_version >= entry.version && event.transition !== 'started') {
      this.journal.write({ ...entry, terminal: true, state: 'terminal', version: event.call_version, cleanup_debt: true, reconcile_debt: false });
      const p = this.preparing.get(key(event)); p?.abort.abort(); p?.stopTimer(); p?.finish(this.decline(event, 'terminal'));
    } else if (!entry.terminal && event.call_version > entry.version) this.journal.write({ ...entry, version: event.call_version });
    this.journal.receipt(event.cursor, event.event_id); // Both state and receipt precede acknowledgment.
    this.queueCleanup(event);
    return { ...ownerOf(event), v: 1, type: 'lifecycle.ack', message_id: randomUUID(), event_id: event.event_id, cursor: event.cursor };
  }
  private queueCleanup(owner: Owner): void {
    const id = key(owner); if (this.cleanups.has(id)) return;
    const task = this.cleanup(owner).catch(() => { this.diagnostics.push('cleanup_pending'); }).finally(() => { this.cleanups.delete(id); });
    this.cleanups.set(id, task);
  }
  private async cleanup(owner: Owner): Promise<void> {
    let entry = this.journal.get(owner);
    if (!entry?.cleanup_debt) return;
    if (entry.create_pending) {
      if (!await this.agent.settled(entry)) return;
      entry = { ...this.journal.get(owner)!, create_pending: false };
      this.journal.write(entry);
    }
    const inspected = await this.agent.inspect(entry);
    if (inspected === 'owned') await this.agent.delete(entry);
    if (inspected === 'unknown' || inspected === 'foreign' || await this.agent.inspect(entry) !== 'absent') return;
    entry = this.journal.get(owner)!;
    this.journal.write({ ...entry, cleanup_debt: false });
  }
  async flushCleanup(): Promise<void> {
    await Promise.all(this.cleanups.values());
    for (const entry of Object.values(this.journal.snapshot().entries)) this.queueCleanup(entry.owner);
    await Promise.all(this.cleanups.values());
  }
  async reconcile(read: (owner: Owner) => Promise<Reconciliation>): Promise<void> {
    for (const entry of Object.values(this.journal.snapshot().entries)) {
      if (completed(entry)) continue;
      try {
        const result = await read(entry.owner);
        if (result.status !== 'known') continue;
        if (!sameOwner(result.receipt, entry.owner, false) || result.receipt.resource_expires_at !== entry.resource_expires_at) throw new Fault('forbidden');
        // A lifecycle handler may finish cleanup while the authority read waits.
        if (completed(this.journal.get(entry.owner)!)) continue;
        if (result.terminal || result.receipt.action === 'decline') {
          const current = this.journal.get(entry.owner)!;
          // Provider operation settlement, not process-local promise presence, settles create debt.
          this.journal.write({ ...current, state: 'terminal', terminal: true, version: Math.max(current.version, result.receipt.call_version),
            cleanup_debt: true, reconcile_debt: false, create_pending: current.create_pending });
          const p = this.preparing.get(key(entry.owner)); p?.abort.abort(); p?.stopTimer(); p?.finish(this.decline(entry.owner, 'terminal'));
          this.queueCleanup(entry.owner);
        } else {
          // Local expiry/departure still needs a central terminal outcome.
          if (this.journal.get(entry.owner)!.terminal) continue;
          this.committed(result.receipt);
          const current = this.journal.get(entry.owner)!;
          this.journal.write({ ...current, reconcile_debt: false });
        }
      } catch { this.diagnostics.push('acceptance_uncertain'); }
    }
    await this.flushCleanup();
  }
  disconnect(): void {
    this.connected = false;
    for (const entry of Object.values(this.journal.snapshot().entries)) this.stopPreparation(entry.owner, 'relay_unavailable');
  }
  reconnect(scope: Scope, role: Connector['role']): void {
    if (!sameScope(scope, this.scope, false)) throw new Fault('forbidden');
    this.scope = scopeOf(scope); this.role = role; this.connected = true;
  }
  drain(): void { this.role = 'draining'; }
  debt(): number {
    return Object.values(this.journal.snapshot().entries).filter(e => e.cleanup_debt || e.reconcile_debt || e.create_pending || !e.terminal).length;
  }
  bridge(owner: Owner, identity: string, observation: 'present' | 'absent' | 'unknown'): void {
    const entry = this.entryFor(owner); if (identity !== `bridge_${owner.request_id}`) throw new Fault('forbidden');
    const id = key(owner);
    if (observation === 'present') { this.journal.write({ ...entry, bridge_seen: true }); this.bridgeAbsent.delete(id); }
    else if (observation === 'unknown') this.bridgeAbsent.delete(id);
    else if (entry.bridge_seen) {
      const since = this.bridgeAbsent.get(id);
      if (since === undefined) this.bridgeAbsent.set(id, this.clock.mono());
      else if (this.clock.mono() - since >= 250) {
        this.journal.write({ ...entry, state: 'terminal', terminal: true, cleanup_debt: true, reconcile_debt: true }); this.queueCleanup(owner);
      }
    }
  }
  async tick(read: (owner: Owner) => Promise<Reconciliation>): Promise<void> {
    for (const entry of Object.values(this.journal.snapshot().entries)) {
      if (completed(entry)) continue;
      if (this.clock.wall() >= entry.resource_expires_at || this.clock.mono() >= (this.expiry.get(key(entry.owner)) ?? Infinity)) {
        this.journal.write({ ...entry, terminal: true, state: 'terminal', cleanup_debt: true, reconcile_debt: true });
        this.stopPreparation(entry.owner, 'deadline_exceeded'); this.queueCleanup(entry.owner);
      }
    }
    await this.reconcile(read);
  }
  startPeriodic(read: (owner: Owner) => Promise<Reconciliation>): void {
    this.stopPeriodic?.();
    let stopped = false;
    let cancel: () => void = () => undefined;
    const schedule = () => { if (!stopped) cancel = this.clock.schedule(1000, () => { void this.tick(read).catch(() => { this.diagnostics.push('journal_unavailable'); }).finally(schedule); }); };
    schedule(); this.stopPeriodic = () => { stopped = true; cancel(); };
  }
  async settleLocalWork(): Promise<void> {
    await Promise.all(this.tasks);
    await this.flushCleanup();
  }
  close(): void { this.stopPeriodic?.(); this.disconnect(); }
}
