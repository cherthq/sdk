import { randomUUID } from 'node:crypto';
import { Fault, digest, key, ownerOf, sameOwner, sameScope, type Ack, type Cancel, type Decision, type Incoming, type Lifecycle, type Owner, type Receipt, type Scope } from '../../src/protocol/v1.js';
import { Budget, type Clock } from '../../src/runtime/deadline.js';

export type Reconciliation = { status: 'unknown' | 'forbidden' | 'not_found' } |
  { status: 'known'; receipt: Receipt; terminal: boolean };
interface Grant { scope: Scope; revoked: boolean; recovery: boolean }
interface Call { incoming: Incoming; budget: Budget; decision?: Receipt; terminal: boolean; version: number }
export class ControlPlane {
  private grants = new Map<string, Grant>();
  private active = new Map<string, Scope>();
  private draining = new Set<string>();
  private drained = new Set<string>();
  private calls = new Map<string, Call>();
  private tail: Promise<unknown> = Promise.resolve();
  private cursors = new Map<string, number>();
  readonly events: Lifecycle[] = [];
  readonly acks = new Set<string>();
  commitCount = 0;
  persistReceipt?: (receipt: Receipt) => void;
  beforeCommit?: () => Promise<void>;
  constructor(readonly clock: Clock) {}
  enroll(token: string, scope: Scope, recovery = false): void {
    this.grants.set(token, { scope: { ...scope }, revoked: false, recovery });
  }
  private grant(token: string, recoveryAllowed = false): Grant {
    const grant = this.grants.get(token);
    if (!grant || grant.revoked || (grant.recovery && !recoveryAllowed)) throw new Fault('forbidden');
    return grant;
  }
  authenticate(token: string, scope?: Scope, generation = true, recoveryAllowed = false): Scope {
    const grant = this.grant(token, recoveryAllowed);
    if (scope && !sameScope(grant.scope, scope, false)) throw new Fault('forbidden');
    if (scope && generation && scope.connection_generation !== grant.scope.connection_generation) throw new Fault('stale_generation');
    return { ...grant.scope };
  }
  activate(token: string, expectedEpoch: number): void {
    const grant = this.grant(token); const scope = grant.scope;
    const line = `${scope.project_id}:${scope.line_id}`; const old = this.active.get(line);
    if ((old?.binding_epoch ?? 0) !== expectedEpoch || (old && !this.drained.has(old.binding_id))) throw new Fault('binding_conflict');
    this.active.set(line, { ...scope });
  }
  role(scope: Scope): 'active' | 'standby' | 'draining' {
    if (this.draining.has(scope.binding_id)) return 'draining';
    const active = this.active.get(`${scope.project_id}:${scope.line_id}`);
    return active && sameScope(active, scope, false) ? 'active' : 'standby';
  }
  connect(token: string): Scope {
    const grant = this.grant(token); const old = grant.scope;
    const next = { ...old, connection_generation: old.connection_generation + 1 };
    for (const value of this.grants.values()) if (sameScope(value.scope, old, false)) value.scope = { ...next };
    // An interrupted, still undecided request is conservatively declined, never rerouted.
    for (const call of this.calls.values()) if (sameScope(call.incoming, old, false) && !call.decision) this.decline(call);
    return next;
  }
  revoke(token: string): void { this.grant(token, true).revoked = true; }
  drain(token: string): void { this.draining.add(this.grant(token).scope.binding_id); }
  finishDrain(token: string, debt: number): void {
    const scope = this.grant(token).scope;
    if (!this.draining.has(scope.binding_id) || debt !== 0 || [...this.calls.values()].some(c => sameScope(c.incoming, scope, false) && !c.terminal && c.decision?.action !== 'decline')) throw new Fault('binding_conflict');
    this.drained.add(scope.binding_id);
  }
  register(token: string, callId = randomUUID(), media: Incoming['media'] = { audio: true, video: false }): Incoming {
    const scope = this.authenticate(token);
    if (this.role(scope) !== 'active') throw new Fault('binding_conflict');
    const now = this.clock.wall();
    const incoming: Incoming = { ...scope, v: 1, type: 'call.incoming', message_id: randomUUID(), call_id: callId, request_id: `req_${callId}`,
      integration_revision_id: 'revision_1', created_at: now, sent_at: now, deadline_at: now + 5000, prepare_deadline_at: now + 4000,
      remaining_ms: 5000, resource_expires_at: now + (scope.session_mode === 'byor' ? 7200000 : 60_000), media };
    const existing = this.calls.get(key(incoming));
    if (existing) return structuredClone(existing.incoming);
    this.calls.set(key(incoming), { incoming, budget: new Budget(this.clock, incoming), terminal: false, version: 0 });
    return structuredClone(incoming);
  }
  verifyIncoming(incoming: Incoming): void {
    const call = this.calls.get(key(incoming));
    if (!call || !sameOwner(call.incoming, incoming) || digest(call.incoming) !== digest(incoming)) throw new Fault('forbidden');
    if (call.terminal) throw new Fault('terminal');
    call.budget.assert();
  }
  private owned(token: string, owner: Owner, generation: boolean, recovery = false): Call {
    this.authenticate(token, owner, generation, recovery);
    const call = this.calls.get(key(owner));
    if (!call || !sameOwner(call.incoming, owner, generation)) throw new Fault('forbidden');
    return call;
  }
  async commit(token: string, decision: Decision): Promise<Receipt> {
    // Precheck prevents unauthenticated clients from joining the commit queue.
    this.owned(token, decision, true);
    const operation = this.tail.then(async () => {
      await this.beforeCommit?.();
      const call = this.owned(token, decision, true);
      if (call.terminal) throw new Fault('terminal');
      if (call.decision) {
        if (call.decision.action !== decision.action) throw new Fault('request_conflict');
        return structuredClone(call.decision);
      }
      if (decision.action === 'accept') call.budget.assert();
      const nextVersion = call.version + 1;
      const receipt: Receipt = { ...ownerOf(call.incoming), v: 1, type: 'decision.committed', message_id: randomUUID(), action: decision.action,
        call_version: nextVersion, resource_expires_at: call.incoming.resource_expires_at };
      this.persistReceipt?.(receipt);
      call.version = nextVersion;
      call.decision = receipt;
      this.commitCount++;
      return structuredClone(call.decision);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  private decline(call: Call): void {
    call.version++;
    call.decision = { ...ownerOf(call.incoming), v: 1, type: 'decision.committed', message_id: randomUUID(), action: 'decline', call_version: call.version, resource_expires_at: call.incoming.resource_expires_at };
  }
  async reconcile(token: string, owner: Owner): Promise<Reconciliation> {
    const call = this.owned(token, owner, false, true);
    if (!call.terminal && call.budget.resourceRemaining(call.incoming.resource_expires_at) <= 0) { call.terminal = true; call.version++; }
    if (!call.decision && call.budget.remaining() <= 0) this.decline(call);
    if (!call.decision) return { status: 'unknown' };
    return { status: 'known', receipt: { ...call.decision, call_version: call.version }, terminal: call.terminal };
  }
  cancel(token: string, owner: Owner): Cancel {
    const call = this.owned(token, owner, false); call.terminal = true;
    if (!call.decision) this.decline(call); else call.version++;
    return { ...ownerOf(call.incoming), v: 1, type: 'call.cancel', message_id: randomUUID(), call_version: call.version, terminal: true, reason: 'caller_cancelled' };
  }
  lifecycle(token: string, owner: Owner, transition: Lifecycle['transition']): Lifecycle {
    const call = this.owned(token, owner, false, true);
    if (!call.terminal) { call.version++; if (transition !== 'started') call.terminal = true; }
    if (!call.decision) this.decline(call);
    const binding = owner.binding_id; const cursor = (this.cursors.get(binding) ?? 0) + 1; this.cursors.set(binding, cursor);
    const event: Lifecycle = { ...ownerOf(call.incoming), v: 1, type: 'call.lifecycle', message_id: randomUUID(), event_id: randomUUID(), cursor, call_version: call.version, transition };
    this.events.push(event); return event;
  }
  acknowledge(token: string, ack: Ack): void {
    this.owned(token, ack, false, true);
    if (ack.type === 'lifecycle.ack' && !this.events.some(e => e.event_id === ack.event_id && e.cursor === ack.cursor && sameOwner(e, ack, false))) throw new Fault('forbidden');
    this.acks.add(ack.event_id);
  }
  replay(token: string, _cursor: number): Lifecycle[] {
    const scope = this.authenticate(token, undefined, false, true);
    return this.events.filter(e => sameScope(e, scope, false) && !this.acks.has(e.event_id));
  }
}
