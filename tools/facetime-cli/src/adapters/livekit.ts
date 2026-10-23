import { createHash } from 'node:crypto';
import { AccessToken, AgentDispatchClient, JobRestartPolicy, RoomAgentDispatch, RoomServiceClient, ServerError, TrackType,
  type AgentDispatch, type ParticipantInfo, type Room } from 'livekit-server-sdk';
import { setTimeout as pause } from 'node:timers/promises';
import { loopbackOrigin } from '../transport/http.js';
import { Fault, sameOwner } from '../protocol/v1.js';
import type { Agent, Ready } from '../runtime/agent.js';
import type { Budget } from '../runtime/deadline.js';
import type { Entry } from '../runtime/journal.js';
import { AdapterReceipts } from './livekit-receipts.js';
import { mac, type Hook, type HookSnapshot } from './livekit-hook.js';

export interface LiveKitAPI {
  rooms(names: string[]): Promise<Room[]>;
  create(name: string, metadata: string, timeout: number, agent: { name: string; deployment: string; metadata: string }): Promise<Room>;
  dispatch(room: string, name: string, deployment: string, metadata: string, timeout: number): Promise<AgentDispatch>;
  dispatches(room: string): Promise<AgentDispatch[]>;
  participants(room: string): Promise<ParticipantInfo[]>;
  removeDispatch(id: string, room: string): Promise<void>;
  removeRoom(room: string): Promise<void>;
  token(entry: Entry): Promise<string>;
}
import { assertSupportedRuntime, validateLiveKitConfig, validateBeforeSDK, preSendProof, preSendDiagnostic,
  sanitizedFailure, type Operation, type OperationAudit } from './livekit-operation.js';
export { sdkTimeoutSeconds } from './livekit-operation.js';
export function liveKitAPI(url: string, apiKey: string, secret: string, developmentOrigin?: string): LiveKitAPI {
  assertSupportedRuntime(); validateLiveKitConfig(url, apiKey, secret);
  const management = developmentOrigin === undefined ? url : loopbackOrigin(developmentOrigin).origin;
  const rooms = new RoomServiceClient(management, apiKey, secret, { failover: false, requestTimeout: 1 });
  // Absent-room routing can take just over one second before returning not_found.
  // Reads/deletes remain bounded; preparation still rechecks its original deadline.
  const dispatch = new AgentDispatchClient(management, apiKey, secret, { failover: false, requestTimeout: 2 });
  return {
    rooms: names => rooms.listRooms(names), participants: name => rooms.listParticipants(name),
    create: (name, metadata, timeout, agent) => new RoomServiceClient(management, apiKey, secret, { failover: false, requestTimeout: validateBeforeSDK('room', name, timeout) })
      .createRoom({ name, metadata, emptyTimeout: 60, departureTimeout: 2, maxParticipants: 2,
        agents: [new RoomAgentDispatch({ agentName: agent.name, deployment: agent.deployment, metadata: agent.metadata, restartPolicy: JobRestartPolicy.JRP_NEVER })] }),
    dispatch: (room, name, deployment, metadata, timeout) => new AgentDispatchClient(management, apiKey, secret, { failover: false, requestTimeout: validateBeforeSDK('dispatch', room, timeout) })
      .createDispatch(room, name, { deployment, metadata, restartPolicy: JobRestartPolicy.JRP_NEVER }),
    dispatches: room => dispatch.listDispatch(room),
    removeDispatch: (id, room) => dispatch.deleteDispatch(id, room), removeRoom: room => rooms.deleteRoom(room),
    async token(entry) {
      const access = new AccessToken(apiKey, secret, { identity: `bridge_${entry.owner.request_id}`, ttl: Math.max(1, Math.floor((entry.resource_expires_at - Date.now()) / 1000)) });
      access.addGrant({ room: entry.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
      return access.toJwt();
    },
  };
}
export interface AdapterConfig { url: string; name: string; deployment: string; boot: string; project: string; hookSecret: string }
export function marker(entry: Entry): string {
  return JSON.stringify({ adapter: 'chert-probe-v1', marker: entry.marker, operation: entry.job, owner: entry.owner });
}
function matchingSession(entry: Entry, h: HookSnapshot): boolean {
  const s = h.session;
  return !!s && s.operation === entry.job && s.room === entry.room && s.marker === entry.marker && s.nonce === entry.nonce && s.participant === entry.participant;
}
// ListDispatch may omit Job.room (LiveKit's RedisStore strips it). Bind the
// job through the room-scoped dispatch and authenticated SDK worker session.
// A present nested room is corroboration and must never contradict that chain.
// The caller separately verifies current room SID/marker ownership and target.
function matchingJobRoom(entry: Entry, dispatch: AgentDispatch, h: HookSnapshot): boolean {
  const s = h.session, jobs = dispatch.state?.jobs, job = jobs?.[0];
  return !!s && !!job && jobs?.length === 1 && !!dispatch.id && !!job.id &&
    dispatch.room === entry.room && matchingSession(entry, h) &&
    s.dispatch === dispatch.id && job.dispatchId === dispatch.id && s.job === job.id &&
    (job.room === undefined || job.room.name === entry.room);
}
// Boolean-only diagnostics preserve exact checks without storing credentials,
// signed dispatch metadata, participant attributes or SDK error bodies.
export function readinessChecks(entry: Entry, dispatch: AgentDispatch, h: HookSnapshot, participants: ParticipantInfo[]) {
  const s = h.session, jobs = dispatch.state?.jobs, job = jobs?.[0];
  const publisher = participants.find(p => p.identity === entry.participant);
  const audio = participants.flatMap(p => p.tracks.filter(t => t.type === TrackType.AUDIO).map(t => ({ identity: p.identity, track: t })));
  return {
    hook_connected: h.connected === true, not_draining: !h.draining,
    session_matches: matchingSession(entry, h), not_cancelled: !!s && !s.cancelled,
    session_ready: s?.status === 'ready', hook_worker_matches: !!s && s.worker === h.worker,
    one_job: jobs?.length === 1, job_matches: !!s && !!job && job.id === s.job,
    dispatch_matches: !!job && job.dispatchId === dispatch.id,
    job_running: job?.state?.status === 1 /* JS_RUNNING, protocol 1.51.0 */,
    job_room_matches: matchingJobRoom(entry, dispatch, h),
    job_participant_matches: job?.state?.participantIdentity === entry.participant,
    job_worker_matches: !!s && !!job?.state && job.state.workerId === s.worker,
    no_foreign_participants: participants.every(p => p.identity === entry.participant),
    participant_present: !!publisher, nonce_matches: publisher?.attributes['chert.nonce'] === entry.nonce,
    participant_job_matches: !!s && publisher?.attributes['chert.job'] === s.job,
    sole_unmuted_audio: audio.length === 1 && audio[0]!.identity === entry.participant && !audio[0]!.track.muted,
    track_matches: !!s && audio.length === 1 && audio[0]!.track.sid === s.track,
  };
}
export function validateReady(entry: Entry, dispatch: AgentDispatch, h: HookSnapshot, participants: ParticipantInfo[]): boolean {
  return Object.values(readinessChecks(entry, dispatch, h, participants)).every(Boolean);
}

// Provider-free, single-instance adapter. No worker launcher or receiver path.
export class LiveKitAdapter implements Agent {
  lastReadiness?: ReturnType<typeof readinessChecks>;
  constructor(readonly api: LiveKitAPI, readonly hook: Hook, readonly receipts: AdapterReceipts, readonly config: AdapterConfig, private cleanupClock = { now: () => performance.now(), wait: () => pause(50), budget: 8000 }) {}
  private guard(budget: Budget, signal: AbortSignal): void {
    budget.assert(true); if (signal.aborted) throw new Fault('terminal');
  }
  async prepare(entry: Entry, budget: Budget, signal: AbortSignal): Promise<Ready> {
    if (this.receipts.get(entry)) throw new Fault('acceptance_uncertain');
    const { project, name, deployment, boot } = this.config;
    this.receipts.put({ entry, phase: 'intent', target: { project, name, deployment, boot } });
    const cancel = () => {
      void this.hook.call('/cancel', { operation: entry.job }).then(h => this.cancelled(entry, h)).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try { return await this.prepareOnce(entry, budget, signal); }
    finally { signal.removeEventListener('abort', cancel); }
  }
  private async prepareOnce(entry: Entry, budget: Budget, signal: AbortSignal): Promise<Ready> {
    this.guard(budget, signal);
    if ((await this.api.rooms([entry.room])).length) throw new Fault('preparation_failed');
    this.guard(budget, signal);
    const spec = JSON.stringify({ mode: 'chert-connector-probe', operation: entry.job, room: entry.room, marker: entry.marker,
      nonce: entry.nonce, participant: entry.participant, prepare_deadline: (Date.now() + Math.floor(budget.remaining(true))) / 1000,
      expires_at: entry.resource_expires_at, boot: this.config.boot, project: this.config.project,
      name: this.config.name, deployment: this.config.deployment });
    const metadata = JSON.stringify({ spec, signature: mac(this.config.hookSecret, 'dispatch', spec) });
    this.guard(budget, signal);
    // Room creation also launches the configured dispatch: journal both intents
    // before sending this single RPC. Never follow it with CreateDispatch.
    this.receipts.put({ ...this.receipts.get(entry)!, topology: 'room_agent', dispatchDigest: digest(metadata) });
    await this.effect(entry, 'room', budget.remaining(true), timeout => this.api.create(entry.room, marker(entry), timeout,
      { name: this.config.name, deployment: this.config.deployment, metadata }), value => {
      if (value.name !== entry.room || value.metadata !== marker(entry) || !value.sid) throw new Fault('preparation_failed');
      return { roomSid: value.sid };
    });
    while (true) {
      this.guard(budget, signal);
      const [h, dispatches, participants] = await Promise.all([this.hook.call('/health'), this.api.dispatches(entry.room), this.api.participants(entry.room)]);
      this.guard(budget, signal);
      if (await this.inspect(entry) !== 'owned') throw new Fault('readiness_invalid');
      const dispatch = this.discover(entry, dispatches);
      if (dispatch) {
        this.assignment(entry, dispatch, h);
        this.lastReadiness = readinessChecks(entry, dispatch, h, participants);
      }
      if (dispatches.length === 1 && dispatch && validateReady(entry, dispatch, h, participants)) {
        this.guard(budget, signal);
        const token = await this.api.token(entry);
        this.guard(budget, signal);
        this.receipts.put({ ...this.receipts.get(entry)!, phase: 'ready', actualJob: h.session!.job });
        return { room: entry.room, job: entry.job, participant: entry.participant, nonce: entry.nonce, publishers: [entry.participant], prepared: true,
          bridge: { livekit_url: this.config.url, participant_token: token } };
      }
      await pause(Math.min(50, budget.remaining(true)), undefined, { signal });
    }
  }
  private async effect<T>(entry: Entry, operation: Operation, timeout: number, invoke: (timeout: number) => Promise<T>, acknowledge: (value: T) => { roomSid?: string; dispatchId?: string }): Promise<T> {
    const pending: OperationAudit = { operation, phase: 'pending', at: Date.now(), runtime: process.version,
      input_timeout_ms: timeout, effective_timeout_ms: Math.max(0, Math.floor(timeout / 1000) * 1000) };
    const initial = this.receipts.get(entry)!;
    this.receipts.put({ ...initial, phase: operation === 'room' ? 'room_pending' : 'dispatch_pending', audit: [...initial.audit ?? [], pending] });
    try {
      const value = await invoke(timeout);
      const ids = acknowledge(value);
      const current = this.receipts.get(entry)!;
      this.receipts.put({ ...current, ...ids, phase: operation === 'room' ? 'room_ack' : 'dispatch_ack',
        audit: [...current.audit!, { ...pending, phase: 'acknowledged', at: Date.now() }] });
      return value;
    } catch (error) {
      const current = this.receipts.get(entry)!;
      const proof = preSendProof(error, operation, entry.room, timeout);
      this.receipts.put({ ...current, phase: proof ? (operation === 'room' ? 'room_not_sent' : 'dispatch_not_sent') : current.phase,
        audit: [...current.audit!, { ...pending, phase: proof ? 'not_sent' : 'uncertain', at: Date.now(),
          ...(proof ? { validation: proof.reason } : {}), diagnostic: proof ? preSendDiagnostic(error) : sanitizedFailure(error) }] });
      throw error;
    }
  }
  private discover(entry: Entry, dispatches: AgentDispatch[]): AgentDispatch | undefined {
    const r = this.receipt(entry);
    if (!r) throw new Fault('cleanup_pending');
    const matches = dispatches.filter(d => d.room === entry.room && d.agentName === this.config.name &&
      d.deployment === this.config.deployment && (r.dispatchDigest ? digest(d.metadata) === r.dispatchDigest : d.id === r.dispatchId));
    if (matches.length > 1 || dispatches.some(d => !matches.includes(d))) throw new Fault('readiness_invalid');
    const d = matches[0];
    if (d && (d.restartPolicy !== JobRestartPolicy.JRP_NEVER || (d.state?.jobs.length ?? 0) > 1)) throw new Fault('readiness_invalid');
    if (d && (!d.id || r.dispatchId && r.dispatchId !== d.id)) throw new Fault('readiness_invalid');
    if (d && !r.dispatchId) this.receipts.put({ ...r, dispatchId: d.id });
    return d;
  }
  private assignment(entry: Entry, d: AgentDispatch, h: HookSnapshot): void {
    const s = h.session, jobs = d.state?.jobs;
    if (!matchingSession(entry, h) || !s || s.worker !== h.worker || jobs?.length !== 1) return;
    const j = jobs[0]!;
    if (!matchingJobRoom(entry, d, h) ||
      j.state?.workerId !== s.worker || j.state.participantIdentity !== entry.participant) return;
    const r = this.receipt(entry)!;
    if (r.actualJob && (r.actualJob !== s.job || r.actualWorker !== s.worker)) throw new Fault('readiness_invalid');
    if (!r.actualJob) this.receipts.put({ ...r, actualJob: s.job, actualWorker: s.worker });
  }
  private evidence(entry: Entry, kind: 'cancelled' | 'ended' | 'unassigned' | 'dispatch_deleted' | 'room_deleted' | 'absent', h?: HookSnapshot): void {
    const r = this.receipt(entry);
    if (!r) throw new Fault('cleanup_pending');
    if (r.cleanup?.some(e => e.kind === kind)) return;
    this.receipts.put({ ...r, cleanup: [...r.cleanup ?? [], { kind, at: Date.now(), roomSid: r.roomSid,
      dispatchId: r.dispatchId, ...(h ? { observation: h } : {}) }] });
  }
  private has(entry: Entry, kind: string): boolean { return !!this.receipt(entry)?.cleanup?.some(e => e.kind === kind); }
  private cancelled(entry: Entry, h: HookSnapshot): void {
    if (!(matchingSession(entry, h) && h.session?.cancelled) && h.cancelled_operation !== entry.job) throw new Fault('cleanup_pending');
    this.evidence(entry, 'cancelled', h); this.terminal(entry, h);
  }
  private terminal(entry: Entry, h: HookSnapshot): boolean {
    let r = this.receipt(entry)!;
    if (!r.actualJob && r.dispatchId && matchingSession(entry, h) && h.session?.dispatch === r.dispatchId && h.session.worker === h.worker) {
      this.receipts.put({ ...r, actualJob: h.session.job, actualWorker: h.session.worker }); r = this.receipt(entry)!;
    }
    if (matchingSession(entry, h) && h.session?.status === 'ended' && h.session.cancelled &&
        r.actualJob === h.session.job && r.actualWorker === h.session.worker) {
      this.evidence(entry, 'ended', h); return true;
    }
    // Authenticated cancel response acknowledges an operation tombstone even if
    // no assignment exists. DeleteDispatch then prevents future service offers.
    if (!r.actualJob && h.session === null && h.cancelled_operation === entry.job && this.has(entry, 'dispatch_deleted')) {
      this.evidence(entry, 'unassigned', h); return true;
    }
    return false;
  }
  private receipt(entry: Entry) {
    if (!this.receipts.healthy) return undefined;
    const r = this.receipts.get(entry);
    if (!r?.target || Object.entries(r.target).some(([k, v]) => this.config[k as keyof AdapterConfig] !== v) ||
      !sameOwner(entry.owner, r.entry.owner) || r.entry.room !== entry.room || r.entry.job !== entry.job) return undefined;
    return r;
  }
  async settled(entry: Entry): Promise<boolean> {
    const r = this.receipt(entry);
    // No receipt after a crash is unknown, not evidence of zero effects.
    return !!r && !['room_pending', 'dispatch_pending'].includes(r.phase);
  }
  async inspect(entry: Entry): Promise<'owned' | 'absent' | 'unknown' | 'foreign'> {
    try {
      const r = this.receipt(entry);
      if (!r || !sameOwner(entry.owner, r.entry.owner) || r.entry.room !== entry.room || r.entry.job !== entry.job) return 'unknown';
      const rooms = await this.api.rooms([entry.room]);
      if (!rooms.length) {
        if (r.dispatchId || r.topology && r.phase !== 'room_not_sent') {
          if (!this.has(entry, 'room_deleted') || !this.has(entry, 'dispatch_deleted') ||
              !(this.has(entry, 'ended') || this.has(entry, 'unassigned'))) return 'unknown';
          try { if ((await this.api.dispatches(entry.room)).length) return 'unknown'; }
          catch (error) {
            // Only the typed response to this room-specific SDK RPC counts, and
            // only alongside prior terminal/deletion evidence and scoped absence.
            if (!(error instanceof ServerError && error.status === 404 && error.code === 'not_found')) return 'unknown';
          }
          this.evidence(entry, 'absent');
          this.receipts.put({ ...this.receipt(entry)!, phase: 'clean' });
        }
        return 'absent';
      }
      return rooms.length === 1 && rooms[0]!.sid === r.roomSid && rooms[0]!.metadata === marker(entry) ? 'owned' : 'foreign';
    } catch { return 'unknown'; }
  }
  async delete(entry: Entry): Promise<void> {
    let r = this.receipt(entry);
    if (!r || !await this.settled(entry) || await this.inspect(entry) !== 'owned') throw new Fault('cleanup_pending');
    // Independent cleanup budget. Never changes an incoming/commit deadline.
    const end = this.cleanupClock.now() + this.cleanupClock.budget;
    const wait = async () => {
      if (this.cleanupClock.now() >= end) throw new Fault('cleanup_pending');
      await this.cleanupClock.wait();
    };
    if (!this.has(entry, 'room_deleted')) {
      if (r.dispatchId || r.topology === 'room_agent') {
        let cancelled: HookSnapshot | undefined;
        if (!this.has(entry, 'cancelled')) {
          cancelled = await this.hook.call('/cancel', { operation: entry.job });
          this.cancelled(entry, cancelled);
        }
        if (!this.has(entry, 'dispatch_deleted')) {
          const d = this.discover(entry, await this.api.dispatches(entry.room));
          if (d && cancelled) { this.assignment(entry, d, cancelled); this.terminal(entry, cancelled); }
          r = this.receipt(entry)!;
          if (!d || !r.dispatchId) throw new Fault('cleanup_pending');
          if (await this.inspect(entry) !== 'owned') throw new Fault('cleanup_pending');
          await this.api.removeDispatch(r.dispatchId, entry.room);
          this.evidence(entry, 'dispatch_deleted');
        }
        while (!(this.has(entry, 'ended') || this.has(entry, 'unassigned'))) {
          if (this.terminal(entry, await this.hook.call('/cancel', { operation: entry.job }))) break;
          await wait();
        }
        if ((await this.api.dispatches(entry.room)).length) throw new Fault('cleanup_pending');
      }
      if (await this.inspect(entry) !== 'owned') throw new Fault('cleanup_pending');
      await this.api.removeRoom(entry.room);
      this.evidence(entry, 'room_deleted');
    }
    while (true) {
      const state = await this.inspect(entry);
      if (state === 'absent') { this.receipts.put({ ...this.receipt(entry)!, phase: 'clean' }); return; }
      if (state === 'foreign') throw new Fault('cleanup_pending');
      await wait();
    }
  }
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
