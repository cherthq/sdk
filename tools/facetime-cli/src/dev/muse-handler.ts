import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { AccessToken } from 'livekit-server-sdk';
import type { ApplicationCall, ApplicationDecision } from '../byor/contract.js';
import type { DevEvent, DevHandler, DevOptions, DispatchParticipant } from './dispatch-handler.js';

export interface MuseOptions extends DevOptions {
  readCall(call: ApplicationCall): Promise<'waiting' | 'ready' | 'terminal'>;
  report(code: string, message: string): void;
  /** Durable, non-secret receipt for operator recovery, written before dispatch. */
  save(receipt: Record<string, unknown>): void;
  now?: () => number;
}

/** One explicitly requested preparation, no automatic retries or refill. */
export function museHandler(options: MuseOptions): DevHandler {
  const { api } = options;
  if (!api.updateMetadata) throw new Error('Muse requires room metadata management');
  const now = options.now ?? Date.now;
  const id = randomBytes(16).toString('hex'), room = `chert-muse-${id}`;
  const started = now(), waitUntil = started + 120_000, expiresAt = started + 600_000;
  const spec = { mode: 'chert-muse-v1', version: 1, required_profile: 'muse', preparation_id: id, room,
    prepare_deadline: (started + 25_000) / 1000, wait_until: waitUntil, expires_at: expiresAt };
  let preparing = false;
  let warming: Promise<void> | undefined, created = false, stopped = false, clean = false, ready = false;
  let agent: string | undefined, call: ApplicationCall | undefined, sessionExpiresAt: number | undefined;
  let bridgeDeadline = Infinity;
  let state: 'waiting' | 'bound' | 'active' | 'terminal' = 'waiting', lastWrite = 0, lastRead = 0, lastFresh = 0;
  let readFailed = false, agentClean = false;
  let previous: { identity: string; video: number; audio: number } | undefined;
  let cleanupTask: Promise<boolean> | undefined;
  const report = (code: string, message: string) => options.report(code, message);
  const log = (event: DevEvent) => { try { options.log?.(event); } catch { /* logging never affects a call */ } };
  // The connector reports every handler decline as agent_unavailable; the reason is only known here.
  const decline = (incoming: ApplicationCall, signal: AbortSignal): ApplicationDecision => {
    log({ call_id: incoming.call_id, event: 'declined', reason: signal.aborted ? 'cancelled' : 'muse_not_ready' });
    return { action: 'decline' };
  };
  const save = () => options.save({ version: 1, room, preparation_id: id, state, clean, agent,
    call_id: call?.call_id, project_id: call?.project_id, line_id: call?.line_id, expires_at: expiresAt, agent_clean: agentClean });
  const metadata = () => JSON.stringify({ chert_muse: { version: 1, preparation_id: id, state,
    valid_until: now() + 12_000,
    ...(call ? { call_id: call.call_id, bridge_identity: `chert-bridge-${call.call_id}`.slice(0, 120), session_expires_at: sessionExpiresAt } : {}) } });
  const write = async () => { await api.updateMetadata!(room, metadata()); lastWrite = now(); };
  function mediaReady(participants: DispatchParticipant[]): boolean {
    const candidates = participants.filter(p => p.kind === 'agent');
    const p = candidates.length === 1 ? candidates[0] : undefined;
    const a = p?.attributes;
    if (!p || !a || (agent && agent !== p.identity) || a['chert.muse.preparation'] !== id ||
        a['chert.muse.profile'] !== 'muse' || a['chert.muse.ready'] !== '1' ||
        !Number.isFinite(Number(a['chert.muse.heartbeat'])) || Math.abs(now() - Number(a['chert.muse.heartbeat'])) > 3000 ||
        ![1, 2].every(source => p.tracks?.some(t => t.source === source && !t.muted))) { previous = undefined; return false; }
    const video = Number(a['chert.muse.video']), audio = Number(a['chert.muse.audio']);
    const fresh = !!previous && previous.identity === p.identity && video > previous.video && audio > previous.audio;
    if (!Number.isSafeInteger(video) || !Number.isSafeInteger(audio) || video < 1 || audio < 1) return false;
    previous = { identity: p.identity, video, audio };
    if (fresh) { agent = p.identity; lastFresh = now(); }
    return fresh;
  }
  async function cleanup(): Promise<boolean> {
    if (clean) return true;
    if (!created) return false;
    if (cleanupTask) return cleanupTask;
    stopped = true; ready = false; state = 'terminal'; save();
    cleanupTask = (async () => {
      if (!agentClean) {
        await write();
        const p = (await api.listParticipants(room)).find(p => p.kind === 'agent' && (!agent || p.identity === agent) && p.attributes?.['chert.muse.preparation'] === id);
        // Absence alone cannot prove that the provider/private room was cleaned.
        if (p?.attributes?.['chert.muse.cleanup'] !== 'clean') return false;
        agentClean = true; save();
      }
      // Retain the agent's cleanup receipt if deletion succeeds but its response
      // is lost. An idempotent delete retry must not require the departed agent.
      await api.deleteRoom(room);
      clean = true; save();
      report('muse_clean', 'Muse cleanup verified: provider session and private room closed; caller room removed. Run chert dev --muse again for another call.');
      return true;
    })().catch(() => false).finally(() => { cleanupTask = undefined; });
    return cleanupTask;
  }
  async function warm(): Promise<void> {
    if (warming || created || stopped) return warming;
    options.save({ version: 1, room, preparation_id: id, state, clean: false, expires_at: expiresAt });
    created = true; preparing = true;
    report('muse_warming', 'Warming Muse audio and avatar for one call. Provider billing can begin now; no automatic refill.');
    warming = (async () => {
      try {
        await api.createRoom(room, { metadata: metadata(), maxParticipants: 2, emptyTimeout: 180, departureTimeout: 60,
          agentName: options.agentName, agentMetadata: JSON.stringify(spec) });
        const end = performance.now() + (options.warmTimeoutMs ?? 25_000);
        while (!stopped && performance.now() < end && now() < waitUntil) {
          if (now() - lastWrite >= 2000) await write();
          const fresh = mediaReady(await api.listParticipants(room));
          if (stopped) break;
          if (fresh) {
            ready = true; save();
            report('muse_ready', 'Muse media ready: model audio prepared, avatar frames and silent audio published. Waiting for one caller; greeting remains gated.');
            return;
          }
          await pause(options.pollMs ?? 250);
        }
      } catch { /* Failure is terminal for this paid preparation; never refill. */ }
      stopped = true;
      report('muse_failed', 'Muse did not become media ready. Cleaning this preparation; no paid retry will start.');
      await cleanup();
    })().finally(() => { preparing = false; });
    return warming;
  }
  return {
    version: 1, warm,
    async health() { return ready && !call && !stopped && now() - lastFresh <= 3000 && now() < waitUntil ? 'available' : 'unavailable'; },
    async refresh() {
      if (!created) await warm();
      if (clean) return 'cold';
      if (stopped || now() >= expiresAt || (!call && now() >= waitUntil)) { await cleanup(); return 'cold'; }
      if (!call && ready) {
        const participants = await api.listParticipants(room);
        // Preparation may bind the room while this idle health read is pending.
        if (call || stopped) return 'cold';
        mediaReady(participants);
        if (now() - lastFresh > 3000) {
          report('muse_media_lost', 'Muse media readiness expired. Cleaning this preparation; no automatic refill.');
          await cleanup(); return 'cold';
        }
      }
      if (!call && now() - lastWrite >= 2000) await write();
      return ready && !call ? 'warm' : 'cold';
    },
    async prepare(incoming, { signal, remaining_ms }) {
      log({ call_id: incoming.call_id, event: 'incoming', remaining_ms: Math.round(remaining_ms) });
      // A failure in here reaches the connector as a decline as well, so it is reported like one.
      try {
        if (!ready || stopped || signal.aborted || call || now() >= waitUntil) return decline(incoming, signal);
        const participants = await api.listParticipants(room);
        const p = participants.find(p => p.identity === agent && p.kind === 'agent');
        if (signal.aborted || stopped || call || now() >= waitUntil || now() - lastFresh > 3000 || p?.attributes?.['chert.muse.ready'] !== '1' || !Number.isFinite(Number(p.attributes['chert.muse.heartbeat'])) ||
            ![1, 2].every(source => p.tracks?.some(t => t.source === source && !t.muted)) ||
            Math.abs(now() - Number(p.attributes['chert.muse.heartbeat'])) > 3000) return decline(incoming, signal);
        call = incoming; ready = false;
        const limit = Math.min(expiresAt, incoming.maximum_session_expires_at);
        const ttl = Math.floor((limit - now()) / 1000);
        if (ttl < 1) { await cleanup(); return decline(incoming, signal); }
        const token = new AccessToken(options.apiKey, options.apiSecret, { identity: `chert-bridge-${incoming.call_id}`.slice(0, 120), ttl });
        token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
        const jwt = await token.toJwt();
        if (signal.aborted || stopped) { await cleanup(); return decline(incoming, signal); }
        sessionExpiresAt = Math.min(limit, (JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { exp: number }).exp * 1000);
        state = 'bound'; bridgeDeadline = now() + 60_000; save(); await write();
        if (signal.aborted) { await cleanup(); return decline(incoming, signal); }
        report('muse_bound', 'Prepared Muse media bound to this call; acceptance requested. Waiting for FaceTime bridge readiness before greeting.');
        return { action: 'accept', ready: true, session_ref: room, session_expires_at: sessionExpiresAt,
          livekit_url: options.livekitUrl, participant_token: jwt, remote_participant_identity: agent! };
      } catch (error) { decline(incoming, signal); throw error; }
    },
    async lifecycle(_call, event) {
      if (event.transition !== 'started') await cleanup();
      return { acknowledged: true };
    },
    async recover(incoming, context) {
      if (call && call.operation_id !== incoming.operation_id) return { settled: true, cleanup: 'clean' };
      if (context.authoritative_terminal || context.cancel_requested || (sessionExpiresAt !== undefined && now() >= sessionExpiresAt)) await cleanup();
      else if (call && context.acceptance === 'accept' && !stopped && now() - lastRead >= 1000) {
        lastRead = now();
        try {
          const status = await options.readCall(call);
          readFailed = false;
          if (stopped) return { settled: !preparing, cleanup: clean ? 'clean' : 'unknown', session_ref: room };
          if (state !== 'active' && now() >= bridgeDeadline) { await cleanup(); return { settled: !preparing, cleanup: clean ? 'clean' : 'unknown', session_ref: room }; }
          if (status === 'terminal') await cleanup();
          else if (status === 'ready') {
            const first = state !== 'active'; state = 'active'; await write();
            if (first) report('muse_connected', 'Call connected: Chert reports FaceTime bridge ready. Muse may greet the matching bridge participant.');
          }
          else if (state === 'bound') await write();
          // Unknown/failed reads never open or renew an active speech lease.
        } catch {
          if (!readFailed) report('muse_bridge_unknown', 'Could not verify FaceTime bridge readiness. Speech lease will expire unless verification recovers.');
          readFailed = true;
        }
      }
      return { settled: !preparing, cleanup: clean ? 'clean' : stopped ? 'unknown' : 'pending', ...(call ? { session_ref: room } : {}) };
    },
    async close() {
      stopped = true;
      await warming;
      if (!created) return;
      for (let n = 0; n < 10; n++) { if (await cleanup()) return; await pause(500); }
      save(); throw new Error('Muse cleanup pending');
    },
  };
}
