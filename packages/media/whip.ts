import { MediaError, type MediaErrorCode } from './source';

/**
 * Standards-based WebRTC HTTP signaling: WHIP (RFC 9725) for publishing and WHEP
 * (draft-ietf-wish-whep-05, experimental) for receiving. This module only exchanges SDP; the caller supplies the
 * RTCPeerConnection (browser native, or a Node/Bun/Deno WebRTC implementation).
 */
export interface SignalingCredentials {
  /** Opaque HTTPS endpoint issued for one session; never constructed by callers. Local HTTP only on loopback. */
  endpoint: string;
  /** Session-bound bearer credential, sent on POST and on PATCH/DELETE to the returned session resource. */
  token: string;
  /** RFC 3339 deadline for the initial connection. */
  connectBy?: string;
}
/** Minimal subset of RTCPeerConnection used for signaling, so any spec-compliant implementation fits. */
type SdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';
export interface PeerConnectionLike {
  createOffer(): Promise<{ type: SdpType; sdp?: string }>;
  setLocalDescription(description: { type: SdpType; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: 'answer'; sdp: string }): Promise<void>;
  readonly localDescription: { type: string; sdp: string } | null;
  readonly iceGatheringState: string;
  addEventListener(type: 'icegatheringstatechange', listener: () => void): void;
  removeEventListener(type: 'icegatheringstatechange', listener: () => void): void;
  close(): void;
}
export interface IceServer { urls: string | string[]; username?: string; credential?: string; credentialType?: 'password' }
export interface SignalingOptions {
  fetch?: typeof globalThis.fetch;
  /** Milliseconds to wait for non-trickle ICE gathering before sending the offer. Default 5000. */
  iceGatheringTimeoutMs?: number;
  signal?: AbortSignal;
}
export interface SignalingSession {
  readonly protocol: 'whip' | 'whep';
  /** ICE servers advertised by the endpoint via Link headers (RFC 9725 §4.6), if any. */
  readonly iceServers: readonly IceServer[];
  /** Sends a trickle-ICE SDP fragment. Resolves false if the server does not support trickle. */
  patch(sdpFragment: string): Promise<boolean>;
  /**
   * Sends an ICE-restart fragment (new ice-ufrag/ice-pwd) and resolves with the server's answer fragment,
   * which the caller applies to its peer connection. Uses If-Match with the current entity tag.
   */
  restartIce(sdpFragment: string): Promise<string>;
  /** Terminates the session resource. Idempotent and best effort. */
  close(): Promise<void>;
}

const MAX_SDP_BYTES = 64 * 1024;
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function endpointURL(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new MediaError('transport_unavailable', 'Invalid signaling endpoint.'); }
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname))))
    throw new MediaError('transport_unavailable', 'Signaling endpoints must be HTTPS (or loopback HTTP) without credentials or fragments.');
  return url;
}

const serviceCodes: Record<string, MediaErrorCode> = { media_session_expired: 'session_expired', unauthorized: 'credentials_rejected',
  media_session_conflict: 'session_conflict', call_not_active: 'call_not_active', call_ended: 'call_ended',
  media_capability_unsupported: 'capability_missing', invalid_sdp: 'invalid_signaling', invalid_ice_fragment: 'invalid_signaling',
  media_transport_unavailable: 'transport_unavailable' };

/** Maps a failed signaling response to a stable code using only the status and a bounded JSON `error.code`. */
async function statusError(response: Response): Promise<MediaError> {
  let code: unknown;
  try {
    if (/^application\/(problem\+)?json\b/i.test(response.headers.get('Content-Type') ?? '')) {
      const text = await response.text();
      if (text.length <= 4096) { const body = JSON.parse(text); code = body?.error?.code ?? body?.code; }
    } else await response.body?.cancel();
  } catch { /* fall back to status */ }
  const mapped = typeof code === 'string' ? serviceCodes[code] : undefined;
  if (mapped) return new MediaError(mapped);
  const s = response.status;
  if (s === 401 || s === 403) return new MediaError('credentials_rejected');
  if (s === 409) return new MediaError('session_conflict');
  if (s === 410) return new MediaError('call_ended');
  if (s === 400) return new MediaError('invalid_signaling');
  if (s === 406 || s === 415 || s === 422) return new MediaError('codec_unsupported');
  return new MediaError('transport_unavailable');
}

/** Parses `Link: <turn:...>; rel="ice-server"; username="u"; credential="c"` entries. Invalid entries are ignored. */
export function parseIceServerLinks(header: string | null): IceServer[] {
  if (!header) return [];
  const servers: IceServer[] = [];
  for (const match of header.matchAll(/<([^>]+)>((?:\s*;\s*[a-zA-Z-]+(?:=(?:"[^"]*"|[^;,]*))?)*)/g)) {
    const params = new Map<string, string>();
    for (const p of match[2]!.matchAll(/;\s*([a-zA-Z-]+)(?:=(?:"([^"]*)"|([^;,]*)))?/g)) params.set(p[1]!.toLowerCase(), (p[2] ?? p[3] ?? '').trim());
    if (params.get('rel') !== 'ice-server' || !/^(stun|stuns|turn|turns):/i.test(match[1]!)) continue;
    servers.push({ urls: [match[1]!], ...(params.has('username') ? { username: params.get('username')! } : {}),
      ...(params.has('credential') ? { credential: params.get('credential')! } : {}) });
  }
  return servers;
}

async function gathered(pc: PeerConnectionLike, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); signal?.removeEventListener('abort', abort); };
    const check = () => { if (pc.iceGatheringState === 'complete') { done(); resolve(); } };
    const abort = () => { done(); reject(new MediaError('aborted')); };
    // Gathering timeouts are tolerated: the offer carries the candidates gathered so far.
    const timer = setTimeout(() => { done(); resolve(); }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function negotiate(protocol: 'whip' | 'whep', pc: PeerConnectionLike, credentials: SignalingCredentials, options: SignalingOptions = {}): Promise<SignalingSession> {
  const endpoint = endpointURL(credentials.endpoint);
  if (!credentials.token || /[\r\n]/.test(credentials.token)) throw new MediaError('credentials_rejected', 'A session credential is required.');
  if (credentials.connectBy && Date.parse(credentials.connectBy) <= Date.now()) throw new MediaError('session_expired');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (options.signal?.aborted) throw new MediaError('aborted');
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, options.iceGatheringTimeoutMs ?? 5000, options.signal);
  const offer = pc.localDescription?.sdp;
  if (!offer) throw new MediaError('transport_unavailable', 'The peer connection produced no offer.');
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: options.signal,
      headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp', Authorization: `Bearer ${credentials.token}` }, body: offer });
  } catch { throw new MediaError(options.signal?.aborted ? 'aborted' : 'transport_unavailable'); }
  if (response.status !== 201) throw await statusError(response);
  const location = response.headers.get('Location');
  let resource: URL;
  try { resource = new URL(location ?? '', endpoint); } catch { throw new MediaError('transport_unavailable'); }
  // The bearer is replayed to the session resource, so it must stay on the issuing origin.
  if (!location || resource.origin !== endpoint.origin) { await response.body?.cancel(); throw new MediaError('transport_unavailable', 'Session resource must share the endpoint origin.'); }
  if (!/^application\/sdp\b/i.test(response.headers.get('Content-Type') ?? '')) { await response.body?.cancel(); throw new MediaError('transport_unavailable'); }
  const answer = await response.text();
  if (!answer.startsWith('v=0') || new TextEncoder().encode(answer).byteLength > MAX_SDP_BYTES) throw new MediaError('transport_unavailable');
  const iceServers = Object.freeze(parseIceServerLinks(response.headers.get('Link')));
  let etag = response.headers.get('ETag');
  let closed = false;
  const authorized = (extra: Record<string, string>) => ({ Authorization: `Bearer ${credentials.token}`, ...extra });
  try { await pc.setRemoteDescription({ type: 'answer', sdp: answer }); }
  catch { await fetcher(resource, { method: 'DELETE', redirect: 'error', headers: authorized({}) }).then(r => r.body?.cancel(), () => {}); throw new MediaError('codec_unsupported'); }
  return {
    protocol, iceServers,
    async patch(fragment) {
      if (closed) throw new MediaError('invalid_state');
      const r = await fetcher(resource, { method: 'PATCH', redirect: 'error', body: fragment,
        headers: authorized({ 'Content-Type': 'application/trickle-ice-sdpfrag', ...(etag ? { 'If-Match': etag } : {}) }) })
        .catch(() => { throw new MediaError('transport_unavailable'); });
      if (r.status === 204 || r.status === 200) { await r.body?.cancel(); return true; }
      if (r.status === 405 || r.status === 501) { await r.body?.cancel(); return false; }
      throw await statusError(r);
    },
    async restartIce(fragment) {
      if (closed) throw new MediaError('invalid_state');
      const r = await fetcher(resource, { method: 'PATCH', redirect: 'error', body: fragment,
        headers: authorized({ 'Content-Type': 'application/trickle-ice-sdpfrag', Accept: 'application/trickle-ice-sdpfrag', 'If-Match': etag ?? '*' }) })
        .catch(() => { throw new MediaError('transport_unavailable'); });
      if (r.status !== 200 || !/^application\/trickle-ice-sdpfrag\b/i.test(r.headers.get('Content-Type') ?? '')) throw await statusError(r);
      const answer = await r.text();
      if (!answer || new TextEncoder().encode(answer).byteLength > MAX_SDP_BYTES) throw new MediaError('invalid_signaling');
      etag = r.headers.get('ETag') ?? etag;
      return answer;
    },
    async close() {
      if (closed) return;
      closed = true;
      // Release the server resource first so it is not left waiting for ICE timeout.
      await fetcher(resource, { method: 'DELETE', redirect: 'error', headers: authorized({}) }).then(r => r.body?.cancel(), () => {});
      try { pc.close(); } catch { /* already closed */ }
    },
  };
}

/** Publishes the peer connection's send tracks via WHIP (RFC 9725). Add tracks/transceivers before calling. */
export const publishWhip = (pc: PeerConnectionLike, credentials: SignalingCredentials, options?: SignalingOptions) => negotiate('whip', pc, credentials, options);
/** Receives media via WHEP. Add recvonly transceivers before calling. WHEP is an IETF draft; treat as experimental. */
export const receiveWhep = (pc: PeerConnectionLike, credentials: SignalingCredentials, options?: SignalingOptions) => negotiate('whep', pc, credentials, options);
