import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { AccessToken, RoomAgentDispatch, RoomServiceClient, ServerError } from 'livekit-server-sdk';
import type { ApplicationCall, ApplicationDecision, ByorHandler, RecoveryContext } from '../byor/contract.js';

/** Participant evidence used by generic membership checks and explicit Muse preparation. */
export interface DispatchParticipant {
  identity: string; kind: 'agent' | 'standard'; attributes?: Record<string, string>;
  /** `type` is 0 for audio and 1 for video, as LiveKit numbers them. */
  tracks?: { source: number; muted: boolean; type?: number }[];
}
export interface DispatchAPI {
  /** One request creates the room and dispatches the named agent into it. */
  createRoom(name: string, options: { metadata: string; maxParticipants: number; emptyTimeout: number; departureTimeout?: number; agentName: string; agentMetadata: string }): Promise<{ name: string; sid: string }>;
  listParticipants(room: string): Promise<DispatchParticipant[]>;
  updateMetadata?(room: string, metadata: string): Promise<void>;
  deleteRoom(room: string): Promise<void>;
}
const AGENT_KIND = 4; // ParticipantInfo_Kind.AGENT, protocol 1.x
export function liveKitDispatchAPI(url: string, apiKey: string, apiSecret: string): DispatchAPI {
  // Measured: room creation alone takes 1.4 to 1.9 s on LiveKit Cloud, so the request limit must exceed that.
  const rooms = new RoomServiceClient(url, apiKey, apiSecret, { failover: false, requestTimeout: 4 });
  return {
    createRoom: async (name, options) => {
      const room = await rooms.createRoom({ name, metadata: options.metadata, maxParticipants: options.maxParticipants, emptyTimeout: options.emptyTimeout, departureTimeout: options.departureTimeout ?? 2,
        agents: [new RoomAgentDispatch({ agentName: options.agentName, metadata: options.agentMetadata })] });
      return { name: room.name, sid: room.sid };
    },
    listParticipants: async room => {
      // A room LiveKit has already closed has no participants; that is an answer, not a failure.
      try { return (await rooms.listParticipants(room)).map(p => ({ identity: p.identity, kind: Number(p.kind) === AGENT_KIND ? 'agent' as const : 'standard' as const,
        ...(Object.keys(p.attributes).length ? { attributes: p.attributes } : {}),
        ...(p.tracks.length ? { tracks: p.tracks.map(t => ({ source: Number(t.source), muted: t.muted, type: Number(t.type) })) } : {}) })); }
      catch (error) { if (error instanceof ServerError && error.status === 404) return []; throw error; }
    },
    async updateMetadata(room, metadata) { await rooms.updateRoomMetadata(room, metadata); },
    deleteRoom: async room => {
      try { await rooms.deleteRoom(room); }
      catch (error) { if (!(error instanceof ServerError && error.status === 404)) throw error; }
    },
  };
}

/** What the Mac's bridge will take from a call's room. See `assessMedia`. */
export type MediaVerdict =
  | { state: 'ok' | 'no_video' | 'video_unused' | 'several_tracks'; publisher: string }
  | { state: 'video_elsewhere'; publisher: string; from: string }
  | { state: 'several_audio'; publishers: string[] }
  | { state: 'no_audio' };
export type DevEvent = { call_id: string; event: 'incoming' | 'accepted' | 'declined' | 'ended' | 'media' | 'bridge_ready'; ms?: number; remaining_ms?: number; warm?: boolean; reason?: 'livekit_unreachable' | 'agent_did_not_join' | 'cancelled' | 'muse_not_ready';
  /** True for a FaceTime Video call. On `incoming` and `media`. */
  video?: boolean;
  /** On `bridge_ready`: whether the room now carries the signal, so the agent can greet. */
  room_signal?: boolean;
  /** On `media`: the verdict, and who publishes what. `from` is the participant whose video the Mac will not take. */
  state?: MediaVerdict['state']; publisher?: string; publishers?: string[]; from?: string };
const BRIDGE_PREFIX = 'chert-bridge-';
/**
 * Judge a call's room the way the Mac's bridge does: it takes audio from the one participant that publishes an
 * unmuted audio track, refuses the call when there are several, and shows video only from that same participant.
 * So an agent that publishes its own voice and camera passes, and so does a silent agent whose avatar service
 * joins as a third participant and publishes both. The bridge's own participant is never counted.
 */
export function assessMedia(participants: DispatchParticipant[], videoCall: boolean): MediaVerdict {
  const others = participants.filter(p => !p.identity.startsWith(BRIDGE_PREFIX));
  const live = (p: DispatchParticipant, type: number) => (p.tracks ?? []).filter(t => t.type === type && !t.muted).length;
  const speaking = others.filter(p => live(p, 0) > 0);
  if (!speaking.length) return { state: 'no_audio' };
  if (speaking.length > 1) return { state: 'several_audio', publishers: speaking.map(p => p.identity) };
  const one = speaking[0]!, publisher = one.identity;
  if (live(one, 0) > 1) return { state: 'several_tracks', publisher };
  const elsewhere = others.find(p => p !== one && live(p, 1) > 0);
  if (live(one, 1) > 0) return { state: videoCall ? 'ok' : 'video_unused', publisher };
  if (elsewhere) return videoCall ? { state: 'video_elsewhere', publisher, from: elsewhere.identity } : { state: 'video_unused', publisher };
  return { state: videoCall ? 'no_video' : 'ok', publisher };
}
export interface DevOptions {
  livekitUrl: string; apiKey: string; apiSecret: string; agentName: string; api: DispatchAPI; pollMs?: number;
  /** Keep one room ready with the agent already inside, so a call is answered without waiting for a join. */
  prewarm?: boolean; warmTimeoutMs?: number; warmMaxAgeMs?: number;
  /** How long after a call starts its tracks are looked at. An agent opens its model session only once the caller is in the room. */
  mediaCheckMs?: number;
  /** Chert's view of a call: `ready` once the Mac reported `bridge_ready` for it (claim.ts `callReadiness`). */
  readCall?(call: ApplicationCall): Promise<'waiting' | 'ready' | 'terminal'>;
  /** How often an answered call is read for `bridge_ready`, and for how long at most. */
  bridgePollMs?: number; bridgeWaitMs?: number;
  log?: (event: DevEvent) => void;
}
export const BRIDGE_POLL_MS = 500, BRIDGE_WAIT_MS = 30_000;
export interface DevHandler extends ByorHandler {
  /** Resolves when a warm room is ready (or could not be prepared). No-op without prewarm. */
  warm(): Promise<void>;
  /** Checks that the warm room still holds the agent, replaces it if not, and reports the result. */
  refresh(): Promise<'warm' | 'cold'>;
  /** Removes the unused warm room. */
  close(): Promise<void>;
}
const MAX_TOKEN_MS = 7200_000;
export function roomName(call: ApplicationCall): string { return `chert-${call.operation_id}`.slice(0, 100); }

/** Built-in handler for `chert dev --agent NAME`: one room per call with the named agent dispatched;
 * accept only once the agent is in the room, so the worker can bind to its exact identity. */
export function devHandler(options: DevOptions): DevHandler {
  const { api, agentName } = options;
  const poll = options.pollMs ?? 100;
  const log = (event: DevEvent) => { try { options.log?.(event); } catch { /* logging never affects a call */ } };
  const remove = async (room: string) => { try { await api.deleteRoom(room); return true; } catch { return false; } };
  // Cleanup that must not delay a decision. close() waits for it; LiveKit's empty timeout is the backstop.
  const background = new Set<Promise<unknown>>();
  const removeLater = (room: string) => { const task = remove(room).finally(() => background.delete(task)); background.add(task); };
  const maxAge = options.warmMaxAgeMs ?? 300_000;
  const agentIn = async (room: string) => (await api.listParticipants(room)).find(p => p.kind === 'agent')?.identity;
  const create = (room: string, call?: ApplicationCall) => api.createRoom(room, { metadata: JSON.stringify(call ? { chert_call: call.call_id } : { chert_warm: true }),
    // LiveKit closes a room that only an agent has joined once emptyTimeout passes (observed at 58 s with 60).
    // A warm room must therefore outlive its own maximum age; a call room only has to outlive the answer.
    // Measured on LiveKit Cloud (9 October 2026): the limit does not count the dispatched agent, and an avatar
    // service that joins as an agent is admitted beside the Mac's bridge. So two is enough for avatars too.
    maxParticipants: 2, emptyTimeout: call ? 60 : Math.ceil(maxAge / 1000) + 120, agentName, agentMetadata: JSON.stringify(call ? { chert_call: call.call_id, media: call.media } : { chert_warm: true }) });

  async function accept(call: ApplicationCall, room: string, identity: string): Promise<ApplicationDecision | undefined> {
    const now = Date.now();
    const expires = Math.min(call.maximum_session_expires_at, now + MAX_TOKEN_MS);
    const ttl = Math.floor((expires - now) / 1000);
    if (ttl < 1) return undefined;
    const token = new AccessToken(options.apiKey, options.apiSecret, { identity: `chert-bridge-${call.call_id}`.slice(0, 120), ttl });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
    const jwt = await token.toJwt();
    // The token's exp is whole seconds; the session must not outlive it.
    const exp = (JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as { exp: number }).exp * 1000;
    return { action: 'accept', ready: true, session_ref: room, session_expires_at: Math.min(expires, exp),
      livekit_url: options.livekitUrl, participant_token: jwt, remote_participant_identity: identity };
  }

  // Warm room: prepared outside any call. Only one is offered at a time, but an aged room keeps
  // serving while its replacement is prepared, so replacement never opens a gap with no warm room.
  // A room is trusted until well before LiveKit closes it (created with emptyTimeout = maxAge + 120 s).
  const usableFor = maxAge + 60_000;
  const usable = (entry: { at: number }) => Date.now() - entry.at <= usableFor;
  let ready: { room: string; identity: string; at: number } | undefined;
  let warming: Promise<void> | undefined;
  let closed = false;
  function warm(): Promise<void> {
    if (!options.prewarm || closed) return Promise.resolve();
    if (ready && Date.now() - ready.at <= maxAge) return Promise.resolve();
    warming ??= (async () => {
      const room = `chert-warm-${randomBytes(9).toString('base64url')}`;
      try {
        await create(room);
        const end = performance.now() + (options.warmTimeoutMs ?? 20_000);
        while (performance.now() < end && !closed) {
          const identity = await agentIn(room);
          if (identity) {
            // Replace, then remove: the aged room is dropped only once the new one is ready.
            // If a call took the aged room meanwhile, it belongs to that call now: its lifecycle removes it,
            // or prepare() does when the caller leaves before the room is used.
            const replaced = ready;
            ready = { room, identity, at: Date.now() };
            if (replaced) removeLater(replaced.room);
            return;
          }
          await pause(poll);
        }
      } catch { /* fall through to cleanup; calls use the cold path */ }
      await remove(room);
    })().finally(() => { warming = undefined; });
    return warming;
  }
  async function takeWarm(): Promise<{ room: string; identity: string; at: number } | undefined> {
    const candidate = ready; ready = undefined;
    if (!candidate) return undefined;
    try {
      // The agent may have left or been replaced while waiting; trust only what is in the room now.
      const identity = usable(candidate) ? await agentIn(candidate.room) : undefined;
      if (identity) return { room: candidate.room, identity, at: candidate.at };
    } catch { /* treat as stale */ }
    removeLater(candidate.room);
    return undefined;
  }

  // Once per call, after it starts: say what the Mac will take from the room. It reads and reports, nothing more:
  // a read that fails, or a call that ends first, says nothing, and the call is never touched.
  const checks = new Map<string, AbortController>();
  function checkMedia(call: ApplicationCall, room: string): void {
    if (checks.has(call.call_id) || closed) return;
    const stop = new AbortController(); checks.set(call.call_id, stop);
    const wait = options.mediaCheckMs ?? 6000;
    const task = (async () => {
      let verdict: MediaVerdict | undefined;
      // The agent may still be opening its model session or publishing its camera at the first look: a verdict
      // that a moment more could change is looked at once more, and only the last one is said.
      const early = (state: MediaVerdict['state']) => state === 'no_audio' || state === 'no_video' || state === 'video_elsewhere';
      for (let look = 0; look < 2 && (!verdict || early(verdict.state)); look++) {
        await pause(wait, undefined, { signal: stop.signal });
        const participants = await api.listParticipants(room);
        // An empty room is a room that is gone: the call is over, and that is not a fault of the agent's audio.
        if (!participants.length) return;
        verdict = assessMedia(participants, call.media.video);
      }
      if (!verdict || stop.signal.aborted) return;
      log({ call_id: call.call_id, event: 'media', ...verdict, video: call.media.video });
    })().catch(() => {}).finally(() => { background.delete(task); if (checks.size > 64) checks.delete(checks.keys().next().value!); });
    background.add(task);
  }

  // Once per answered call: read the call from Chert until the Mac reports bridge_ready, then put it in the room's
  // metadata, where any agent can see it without the call API. The Mac ends a call whose agent sends no audible audio
  // within 10 s of bridge_ready (remote_audio_timeout), so the agent greets on this. The first read is at the answer,
  // the next ones start one interval apart, and they stop at bridge_ready, when the call ends, or at the end of the
  // window. A warm room has no call, so it is never told.
  const watches = new Map<string, AbortController>();
  function watchBridge(call: ApplicationCall, room: string): void {
    const read = options.readCall, update = api.updateMetadata;
    if (!read || !update || watches.has(call.call_id) || closed) return;
    const stop = new AbortController(); watches.set(call.call_id, stop);
    if (watches.size > 64) watches.delete(watches.keys().next().value!);
    const every = options.bridgePollMs ?? BRIDGE_POLL_MS, started = performance.now(), end = started + (options.bridgeWaitMs ?? BRIDGE_WAIT_MS);
    const task = (async () => {
      let seen = false;
      while (!stop.signal.aborted) {
        const at = performance.now();
        // A read that fails says nothing about the call; the next one may.
        const state = await read(call).catch(() => 'waiting' as const);
        if (stop.signal.aborted || state === 'terminal') return;
        if (state === 'ready') {
          seen = true;
          const metadata = JSON.stringify({ chert_call: call.call_id, chert_bridge_ready: true, at: new Date().toISOString() });
          // A refused update is tried again after the next read, so a call that ended meanwhile is not written to.
          if (await update.call(api, room, metadata).then(() => true, () => false)) {
            log({ call_id: call.call_id, event: 'bridge_ready', ms: Math.round(performance.now() - started), room_signal: true });
            return;
          }
        }
        // The next read starts one interval after this one started, and only inside the window. Timers take whole
        // milliseconds, so the wait is rounded up: never sooner than the interval.
        const next = at + every;
        if (next >= end) break;
        await pause(Math.max(0, Math.ceil(next - performance.now())), undefined, { signal: stop.signal });
      }
      if (seen && !stop.signal.aborted) log({ call_id: call.call_id, event: 'bridge_ready', ms: Math.round(performance.now() - started), room_signal: false });
    })().catch(() => {}).finally(() => background.delete(task));
    background.add(task);
  }

  return {
    version: 1,
    // A room no call would be given is not a warm room, however long the agent stays in it.
    async health() { return ready && usable(ready) ? 'available' : 'unknown'; },
    async prepare(call, { signal, remaining_ms }) {
      const started = performance.now();
      // Keep a margin so cleanup and the decision frame fit inside the window.
      const stopAt = started + Math.max(0, remaining_ms - Math.min(300, remaining_ms / 3));
      log({ call_id: call.call_id, event: 'incoming', remaining_ms: Math.round(remaining_ms), video: call.media.video });
      if (signal.aborted) { log({ call_id: call.call_id, event: 'declined', reason: 'cancelled' }); return { action: 'decline' }; }
      const warmRoom = await takeWarm();
      if (warmRoom && signal.aborted) {
        // The caller left while the warm room was being checked: keep it, as old as it is, for the next call.
        // If its replacement became ready meanwhile, or close() has already run, nothing else will ever remove it, so do that here.
        if (ready || closed) removeLater(warmRoom.room); else ready = warmRoom;
        log({ call_id: call.call_id, event: 'declined', reason: 'cancelled' });
        return { action: 'decline' };
      }
      if (warmRoom) {
        const decision = await accept(call, warmRoom.room, warmRoom.identity);
        if (signal.aborted) {
          // Stopped while the answer was made: the connector has declined already, so the room serves the next call.
          if (ready || closed) removeLater(warmRoom.room); else ready = warmRoom;
          log({ call_id: call.call_id, event: 'declined', reason: 'cancelled' });
          return { action: 'decline' };
        }
        if (decision) {
          log({ call_id: call.call_id, event: 'accepted', ms: Math.round(performance.now() - started), warm: true });
          watchBridge(call, warmRoom.room);
          void warm();
          return decision;
        }
        removeLater(warmRoom.room);
      }
      const room = roomName(call);
      try { await create(room, call); }
      catch { log({ call_id: call.call_id, event: 'declined', reason: 'livekit_unreachable' }); void warm(); return { action: 'decline' }; }
      try {
        while (performance.now() < stopAt && !signal.aborted) {
          const identity = await agentIn(room);
          // A read that returns after the connector stopped the call must not answer it.
          if (signal.aborted) break;
          if (identity) {
            const decision = await accept(call, room, identity);
            if (!decision || signal.aborted) break;
            log({ call_id: call.call_id, event: 'accepted', ms: Math.round(performance.now() - started), warm: false });
            watchBridge(call, room);
            void warm();
            return decision;
          }
          await pause(Math.max(0, Math.min(poll, stopAt - performance.now())), undefined, { signal }).catch(() => {});
        }
      } catch { /* fall through to cleanup and decline */ }
      removeLater(room);
      log({ call_id: call.call_id, event: 'declined', reason: signal.aborted ? 'cancelled' : 'agent_did_not_join' });
      void warm();
      return { action: 'decline' };
    },
    async lifecycle(call, event, context) {
      const room = context.session_ref ?? roomName(call);
      if (event.transition === 'started') checkMedia(call, room);
      else { checks.get(call.call_id)?.abort(); watches.get(call.call_id)?.abort(); await remove(room); log({ call_id: call.call_id, event: 'ended' }); }
      return { acknowledged: true };
    },
    async recover(call: ApplicationCall, context: RecoveryContext) {
      // Recovery also runs for live calls and uncertain acceptance. Only terminal
      // authority or cancellation (including connector-enforced expiry) permits deletion.
      if (!context.authoritative_terminal && !context.cancel_requested) {
        // Preparation may still be choosing a warm room; do not pin a cold-room fallback.
        return { settled: true, cleanup: 'pending', session_ref: context.session_ref };
      }
      const room = context.session_ref ?? roomName(call);
      checks.get(call.call_id)?.abort(); watches.get(call.call_id)?.abort();
      return { settled: true, cleanup: await remove(room) ? 'clean' : 'unknown', session_ref: room };
    },
    warm,
    async refresh() {
      if (!options.prewarm || closed) return 'cold';
      const current = ready;
      if (current) {
        // An error here says nothing about the room, so only a definite "no agent" or an age past use discards it.
        const identity = await agentIn(current.room).catch(() => current.identity);
        if (ready === current) {
          if (identity && usable(current)) current.identity = identity;
          else { ready = undefined; removeLater(current.room); }
        }
      }
      await warm();
      return ready && usable(ready) ? 'warm' : 'cold';
    },
    async close() {
      closed = true;
      for (const check of [...checks.values(), ...watches.values()]) check.abort();
      await warming?.catch(() => {});
      const unused = ready; ready = undefined;
      if (unused) await remove(unused.room);
      await Promise.all(background);
    },
  };
}
