import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Fault, digest, id, incomingSchema, key, ownerOf, sameOwner, sameScope, scopeOf, type Ack, type Cancel, type Code, type Decision, type Incoming, type Lifecycle, type Owner, type Receipt, type Scope } from '../protocol/v1.js';
import { Budget, type Scheduler } from '../runtime/deadline.js';
import type { Reconciliation } from '../runtime/reconciliation.js';
import type { ApplicationEvent, ByorHandler, RecoveryContext } from './contract.js';
import { ByorJournal, complete, type ByorEntry } from './journal.js';
import { validateDecision } from './handler.js';
interface Preparation { abort: AbortController; finish(d: Decision): void; stop(): void }
export class ByorConnector {
  connected = true;
  role: 'active' | 'standby' | 'draining' = 'active';
  health: 'available' | 'unavailable' | 'unknown' = 'unknown';
  readonly diagnostics: Code[] = [];
  private alive = true;
  private pending = new Map<string, Promise<Decision>>();
  private decisionTimers = new Map<string, () => void>();
  private preparing = new Map<string, Preparation>();
  private work = new Map<string, Promise<void>>();
  private expiries = new Map<string, number>();
  constructor(public scope: Scope, readonly journal: ByorJournal, readonly handler: ByorHandler, readonly clock: Scheduler) {
    if (scope.session_mode !== 'byor') throw new Fault('mode_mismatch');
    for (const e of Object.values(journal.snapshot().entries)) this.expiries.set(key(e.owner), clock.mono() + Math.max(0, (e.session_expires_at ?? e.call.maximum_session_expires_at) - clock.wall()));
  }
  check(): Code | 'available' {
    if (!this.journal.healthy) return 'journal_unavailable';
    if (!this.connected) return 'relay_unavailable';
    if (this.role !== 'active') return this.role === 'standby' ? 'binding_standby' : 'binding_draining';
    if (this.debt()) return 'cleanup_pending';
    return this.health === 'unavailable' ? 'agent_unavailable' : 'available';
  }
  debt(): number { return Object.values(this.journal.snapshot().entries).filter(e => !complete(e)).length; }
  private decline(owner: Owner, reason: Code): Decision {
    return { ...ownerOf(owner), v: 1, type: 'call.decision', message_id: randomUUID(), action: 'decline', reason };
  }
  private entry(owner: Owner): ByorEntry {
    const e = this.journal.get(owner);
    if (!sameScope(this.scope, owner, false) || !e || !sameOwner(e.owner, owner, false)) throw new Fault('forbidden');
    return e;
  }
  private context(e: ByorEntry): RecoveryContext {
    return { session_ref: e.session_ref, authoritative_terminal: e.authoritative_terminal, acceptance: e.acceptance, cancel_requested: e.cancel_requested };
  }
  async incoming(raw: Incoming): Promise<Decision> {
    const incoming = incomingSchema.parse(raw);
    if (!sameScope(this.scope, incoming, false)) throw new Fault('forbidden');
    if (!sameScope(this.scope, incoming)) throw new Fault('stale_generation');
    const existing = this.journal.get(incoming);
    if (existing) {
      this.entry(incoming);
      if (existing.digest === '0'.repeat(64) && existing.authoritative_terminal) return this.decline(incoming, 'terminal');
      if (existing.digest !== digest(incoming)) throw new Fault('request_conflict');
      if (existing.authoritative_terminal) return this.decline(incoming, 'terminal');
      if (this.clock.wall() >= existing.call.deadline_at) return this.decline(incoming, 'deadline_exceeded');
      return this.pending.get(key(incoming)) ?? this.decline(incoming, 'acceptance_uncertain');
    }
    const gate = this.check();
    // A call whose timing cannot be honoured is declined. Throwing here would close the
    // connection, and the relay would redeliver the same frame until its deadline passed.
    let budget: Budget;
    try {
      budget = new Budget(this.clock, incoming);
      if (incoming.resource_expires_at <= incoming.deadline_at || incoming.resource_expires_at > incoming.created_at + 7200000) throw new Fault('invalid_deadline');
    } catch { return this.decline(incoming, 'invalid_deadline'); }
    const e: ByorEntry = { owner: ownerOf(incoming), digest: digest(incoming),
      call: { operation_id: randomUUID(), project_id: incoming.project_id, line_id: incoming.line_id, call_id: incoming.call_id, request_id: incoming.request_id,
        deadline_at: incoming.deadline_at, prepare_deadline_at: incoming.prepare_deadline_at, maximum_session_expires_at: incoming.resource_expires_at, media: incoming.media,
        ...(incoming.from !== undefined ? { from: incoming.from } : {}) },
      invoked: false, acceptance: 'unknown', authoritative_terminal: false, version: 0,
      cancel_requested: false, settled: true, cleanup: 'clean', events: [] };
    this.journal.write(e);
    this.decisionTimers.set(key(incoming), this.clock.schedule(budget.remaining(), () => { this.pending.delete(key(incoming)); this.decisionTimers.delete(key(incoming)); }));
    if (gate !== 'available' || budget.remaining(true) <= 0) {
      const decision = this.decline(incoming, gate !== 'available' ? gate : 'deadline_exceeded');
      this.pending.set(key(incoming), Promise.resolve(decision)); return decision;
    }
    this.journal.write({ ...e, invoked: true, settled: false, cleanup: 'unknown' });
    let finish!: (decision: Decision) => void;
    const result = new Promise<Decision>(resolve => { finish = resolve; });
    this.pending.set(key(incoming), result);
    const p: Preparation = { abort: new AbortController(), finish, stop: () => undefined };
    this.preparing.set(key(incoming), p);
    p.stop = this.clock.schedule(budget.remaining(true), () => this.stopPreparation(incoming, 'deadline_exceeded'));
    // Never await unbounded application preparation during shutdown. Intent is already durable.
    void Promise.resolve().then(() => this.handler.prepare(e.call, { signal: p.abort.signal, remaining_ms: budget.remaining(true) })).then(raw => {
      if (!this.alive) return;
      const ref = typeof raw === 'object' && raw !== null && 'session_ref' in raw ? id.safeParse(raw.session_ref) : undefined;
      if (ref?.success) this.journal.write({ ...this.entry(incoming), session_ref: ref.data });
      const response = validateDecision(raw, this.clock.wall(), incoming.resource_expires_at);
      budget.assert(true);
      if (p.abort.signal.aborted || !sameScope(this.scope, incoming) || this.entry(incoming).authoritative_terminal) throw new Fault('terminal');
      if (response.action === 'decline') {
        this.journal.write({ ...this.entry(incoming), cancel_requested: true });
        finish(this.decline(incoming, 'agent_unavailable'));
      } else {
        this.journal.write({ ...this.entry(incoming), session_ref: response.session_ref, session_expires_at: response.session_expires_at });
        this.expiries.set(key(incoming), this.clock.mono() + budget.resourceRemaining(response.session_expires_at));
        finish({ ...ownerOf(incoming), v: 1, type: 'call.decision', message_id: randomUUID(), action: 'accept',
          livekit_url: response.livekit_url, participant_token: response.participant_token, remote_participant_identity: response.remote_participant_identity, session_expires_at: response.session_expires_at });
      }
    }).catch(error => {
      if (!this.alive) return;
      const code = error instanceof Fault ? error.code : 'preparation_failed'; this.diagnostics.push(code);
      try { this.journal.write({ ...this.entry(incoming), cancel_requested: true }); }
      catch { this.diagnostics.push('journal_unavailable'); }
      finish(this.decline(incoming, code));
    }).finally(() => { p.stop(); this.preparing.delete(key(incoming)); });
    return result;
  }
  private stopPreparation(owner: Owner, code: Code): void {
    const p = this.preparing.get(key(owner));
    if (!p || this.journal.get(owner)?.session_expires_at) return;
    this.journal.write({ ...this.entry(owner), cancel_requested: true });
    p.abort.abort(); p.stop(); p.finish(this.decline(owner, code));
  }
  private event(owner: Owner, event: ApplicationEvent): void {
    const e = this.entry(owner);
    if (!e.invoked) return;
    const old = e.events.find(x => x.event.event_id === event.event_id);
    if (old && old.event.transition !== event.transition) throw new Fault('request_conflict');
    if (!old) this.journal.write({ ...e, events: [...e.events, { event, acknowledged: false }] });
  }
  private tombstone(owner: Owner, maximum: number, version: number): void {
    if (!sameScope(this.scope, owner, false)) throw new Fault('forbidden');
    this.journal.write({ owner: ownerOf(owner), digest: '0'.repeat(64),
      call: { operation_id: randomUUID(), project_id: owner.project_id, line_id: owner.line_id, call_id: owner.call_id, request_id: owner.request_id,
        deadline_at: 0, prepare_deadline_at: 0, maximum_session_expires_at: maximum, media: { audio: true, video: false } },
      invoked: false, acceptance: 'decline', authoritative_terminal: true, version, cancel_requested: true, settled: true, cleanup: 'clean', events: [] });
  }
  committed(receipt: Receipt): void {
    if (!this.journal.get(receipt) && receipt.action === 'decline') { this.tombstone(receipt, receipt.resource_expires_at, receipt.call_version); return; }
    const e = this.entry(receipt);
    // A terminal-before-incoming tombstone has no allocation or original bound.
    // A subsequent authoritative decline cannot introduce a resource obligation.
    if (!e.invoked && e.digest === '0'.repeat(64) && e.authoritative_terminal && receipt.action === 'decline') return;
    if (receipt.resource_expires_at !== e.call.maximum_session_expires_at) throw new Fault('request_conflict');
    if (complete(e)) return;
    if (e.acceptance !== 'unknown' && e.acceptance !== receipt.action) throw new Fault('request_conflict');
    this.journal.write({ ...e, acceptance: receipt.action, version: Math.max(e.version, receipt.call_version),
      authoritative_terminal: e.authoritative_terminal || receipt.action === 'decline', cancel_requested: e.cancel_requested || receipt.action === 'decline' });
    if (receipt.action === 'decline') this.event(receipt, { event_id: `${e.call.operation_id}_decline`, transition: 'cancelled' });
  }
  lifecycle(event: Lifecycle): Ack {
    if (!sameScope(this.scope, event, false)) throw new Fault('forbidden');
    const e = this.journal.get(event);
    if (e) {
      this.entry(event);
      if (event.call_version >= e.version) {
        if (event.transition !== 'started') {
          this.journal.write({ ...e, authoritative_terminal: true, cancel_requested: true, version: event.call_version });
          this.stopPreparation(event, 'terminal'); this.pending.delete(key(event));
        } else this.journal.write({ ...e, version: event.call_version });
        this.event(event, { event_id: event.event_id, transition: event.transition });
      }
    }
    else if (event.transition !== 'started') this.tombstone(event, 0, event.call_version);
    this.journal.receipt(event.cursor, event.event_id);
    return { ...ownerOf(event), v: 1, type: 'lifecycle.ack', message_id: randomUUID(), event_id: event.event_id, cursor: event.cursor };
  }
  cancel(frame: Cancel): Ack {
    if (!sameScope(this.scope, frame, false)) throw new Fault('forbidden');
    const e = this.journal.get(frame);
    if (e) {
      this.entry(frame);
      if (frame.terminal && frame.call_version >= e.version) this.journal.write({ ...e, authoritative_terminal: true, cancel_requested: true, version: frame.call_version });
      this.stopPreparation(frame, 'terminal');
      this.event(frame, { event_id: frame.message_id, transition: 'cancelled' });
    }
    else if (frame.terminal) this.tombstone(frame, 0, frame.call_version);
    return { ...ownerOf(frame), v: 1, type: 'cancel.ack', message_id: randomUUID(), event_id: frame.message_id, cursor: 0 };
  }
  private async bounded(work: Promise<void>): Promise<void> {
    let stop!: () => void;
    const timeout = new Promise<void>(resolve => { stop = this.clock.schedule(1000, resolve); });
    try { await Promise.race([work, timeout]); } finally { stop(); }
  }
  private application(owner: Owner): Promise<void> {
    const k = key(owner); const underway = this.work.get(k); if (underway) return underway;
    const job = (async () => {
      for (const delivery of this.entry(owner).events) {
        if (delivery.acknowledged) continue;
        if (!this.handler.lifecycle) { this.diagnostics.push('application_lifecycle_pending'); break; }
        const e = this.entry(owner);
        const ack = await this.handler.lifecycle(e.call, delivery.event, this.context(e));
        if (!this.alive) return;
        if (ack?.acknowledged === true) {
          const current = this.entry(owner);
          this.journal.write({ ...current, events: current.events.map(x => x.event.event_id === delivery.event.event_id ? { ...x, acknowledged: true } : x) });
        }
      }
      const e = this.entry(owner);
      if (!e.invoked || complete(e)) return;
      if (!this.handler.recover) { this.diagnostics.push('application_recovery_missing'); return; }
      const raw = await this.handler.recover(e.call, this.context(e));
      if (!this.alive) return;
      const proof = z.strictObject({ settled: z.boolean(), cleanup: z.enum(['clean', 'pending', 'unknown']), session_ref: id.optional() }).parse(raw);
      const current = this.entry(owner);
      if (proof.session_ref && current.session_ref && proof.session_ref !== current.session_ref) throw new Fault('request_conflict');
      // Local preparation may still complete after the recovery lookup. Keep debt then.
      this.journal.write({ ...current, ...(proof.session_ref ? { session_ref: proof.session_ref } : {}),
        settled: proof.settled && !this.preparing.has(k), cleanup: this.preparing.has(k) ? 'unknown' : proof.cleanup });
    })().catch(() => { this.diagnostics.push('cleanup_pending'); }).finally(() => this.work.delete(k));
    this.work.set(k, job); return job;
  }
  async tick(read: (owner: Owner) => Promise<Reconciliation>): Promise<void> {
    for (const saved of Object.values(this.journal.snapshot().entries)) {
      if (complete(saved)) continue;
      let e = this.entry(saved.owner);
      if (e.invoked && (this.clock.wall() >= (e.session_expires_at ?? e.call.maximum_session_expires_at) || this.clock.mono() >= (this.expiries.get(key(e.owner)) ?? Infinity))) {
        this.journal.write({ ...e, cancel_requested: true }); this.stopPreparation(e.owner, 'deadline_exceeded');
      }
      try {
        const result = await read(e.owner);
        if (!this.alive) return;
        e = this.entry(e.owner);
        if (!complete(e) && result.status === 'known') {
          if (!sameOwner(result.receipt, e.owner, false)) throw new Fault('forbidden');
          this.committed(result.receipt);
          if (result.terminal) {
            e = this.entry(e.owner);
            this.journal.write({ ...e, authoritative_terminal: true, cancel_requested: true });
            this.stopPreparation(e.owner, 'terminal');
            if (!e.events.some(x => x.event.transition !== 'started')) this.event(e.owner, { event_id: `${e.call.operation_id}_terminal`, transition: 'reconciled_terminal' });
          }
        }
      } catch { this.diagnostics.push('acceptance_uncertain'); }
      await this.bounded(this.application(e.owner));
    }
  }
  disconnect(): void { for (const stop of this.decisionTimers.values()) stop(); this.decisionTimers.clear(); this.connected = false; for (const e of Object.values(this.journal.snapshot().entries)) this.stopPreparation(e.owner, 'relay_unavailable'); this.pending.clear(); }
  reconnect(scope: Scope, role: ByorConnector['role']): void { if (!sameScope(scope, this.scope, false)) throw new Fault('forbidden'); this.scope = scopeOf(scope); this.role = role; this.connected = true; }
  drain(): void { this.role = 'draining'; }
  close(): void { this.disconnect(); this.alive = false; }
}
