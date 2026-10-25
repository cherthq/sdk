/**
 * Local preview host: drives a living page through the same `chert.living.v1` bridge the service uses,
 * so pages can be developed and tested without a call. For an iframe preview, the page must opt in with
 * `connectLivingPage(handlers, { trusted: { source: window.parent, origin: '<preview origin>' } })`.
 */
import { assertJson, isEventName, isInputList, isViewport, LIMITS, PROTOCOL,
  type HealthStatus, type InputKind, type Json, type LivingCallEvent, type LivingInput, type Viewport } from './protocol';

export interface PreviewOptions {
  /** Exact origin of the page being previewed; never '*'. */
  origin: string;
  viewport: Viewport; fps: number; input?: InputKind[]; state?: Json; sessionId?: string; readyTimeoutMs?: number }
export interface PreviewEvents {
  ready(): void; heartbeat(): void; health(status: HealthStatus, code?: string): void;
  message(message: string, data: Json): void; stopped(): void; failed(code: 'living_ready_timeout' | 'living_protocol_error'): void;
}
export interface LivingPreview {
  setState(state: Json): number;
  sendEvent(event: string, data?: Json): void;
  sendCallEvent(event: LivingCallEvent): void;
  sendInput(input: LivingInput): void;
  stop(reason?: string): void;
  on<K extends keyof PreviewEvents>(event: K, listener: PreviewEvents[K]): () => void;
}

/** Anything with window-style `postMessage(message, targetOrigin, transfer)`, e.g. `iframe.contentWindow`. */
export interface LivingFrame { postMessage(message: unknown, targetOrigin: string, transfer: MessagePort[]): void }
/** `frame` is the page's window (e.g. `iframe.contentWindow`). */
export function startLivingPreview(frame: LivingFrame, options: PreviewOptions): LivingPreview {
  if (typeof options.origin !== 'string' || options.origin === '*' || !/^https?:\/\/[^/]+$/.test(options.origin)) throw new TypeError('origin must be an exact http(s) origin.');
  if (!isViewport(options.viewport)) throw new TypeError('viewport must be even, 16..1920 x 16..1080.');
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > LIMITS.maxFps) throw new TypeError('fps must be 1..30.');
  const input = options.input ?? [];
  if (!isInputList(input)) throw new TypeError('input must be a unique subset of pointer, keyboard, text.');
  const initial = options.state ?? null;
  assertJson(initial, LIMITS.maxStateBytes, 'State');
  const listeners: { [K in keyof PreviewEvents]: Set<PreviewEvents[K]> } =
    { ready: new Set(), heartbeat: new Set(), health: new Set(), message: new Set(), stopped: new Set(), failed: new Set() };
  const emit = <K extends keyof PreviewEvents>(k: K, ...a: Parameters<PreviewEvents[K]>) => { for (const l of listeners[k]) (l as (...x: unknown[]) => void)(...a); };
  const channel = new MessageChannel();
  let port = channel.port1;
  let revision = 0, phase: 'connecting' | 'starting' | 'live' | 'stopping' | 'done' = 'connecting';
  const timer = setTimeout(() => { if (phase === 'connecting' || phase === 'starting') fail('living_ready_timeout'); }, options.readyTimeoutMs ?? LIMITS.readyTimeoutMs);
  const fail = (code: 'living_ready_timeout' | 'living_protocol_error') => { phase = 'done'; clearInterval(retry); clearTimeout(timer); port.close(); emit('failed', code); };
  port.onmessage = ({ data: m }) => {
    if (!m || typeof m !== 'object') return fail('living_protocol_error');
    if (m.type === 'hello' && phase === 'connecting') {
      phase = 'starting'; clearInterval(retry);
      port.postMessage({ type: 'start', session_id: options.sessionId ?? 'preview', viewport: options.viewport, fps: options.fps, input, state: initial, revision });
    } else if (m.type === 'ready' && phase === 'starting') { phase = 'live'; clearTimeout(timer); emit('ready'); }
    else if (m.type === 'heartbeat') emit('heartbeat');
    else if (m.type === 'health' && (m.status === 'ok' || m.status === 'degraded')) emit('health', m.status, typeof m.code === 'string' ? m.code : undefined);
    else if (m.type === 'message' && phase === 'live' && isEventName(m.message)) {
      try { assertJson(m.data, LIMITS.maxMessageBytes, 'Message'); emit('message', m.message, m.data); } catch { fail('living_protocol_error'); }
    } else if (m.type === 'stopped' && phase === 'stopping') { phase = 'done'; port.close(); emit('stopped'); }
  };
  // Re-send `connect` with a fresh channel until the page says hello, so late subscribers still connect.
  let current = channel;
  const offer = () => { if (phase !== 'connecting') return; frame.postMessage({ protocol: PROTOCOL, type: 'connect' }, options.origin, [current.port2]); };
  const retry = setInterval(() => {
    if (phase !== 'connecting') return clearInterval(retry);
    current.port1.close(); current = new MessageChannel(); current.port1.onmessage = port.onmessage; port = current.port1; offer();
  }, 250);
  offer();
  const live = () => { if (phase !== 'live') throw new Error('The preview is not live.'); };
  return {
    setState(state) { live(); assertJson(state, LIMITS.maxStateBytes, 'State'); port.postMessage({ type: 'state', revision: ++revision, state }); return revision; },
    sendEvent(event, data = null) { live(); if (!isEventName(event)) throw new TypeError('Invalid event name.'); assertJson(data, LIMITS.maxEventBytes, 'Event data'); port.postMessage({ type: 'event', event, data }); },
    sendCallEvent(event) { live(); port.postMessage({ type: 'call_event', event }); },
    sendInput(value) { live(); if (!input.includes(value.kind)) throw new TypeError('Input kind not enabled.'); port.postMessage({ type: 'input', input: value }); },
    stop(reason = 'preview_stopped') { if (phase === 'done' || phase === 'stopping') return; clearInterval(retry); clearTimeout(timer);
      if (phase === 'connecting') { phase = 'done'; port.close(); emit('stopped'); return; }
      phase = 'stopping'; port.postMessage({ type: 'stop', reason }); },
    on(event, listener) { listeners[event].add(listener); return () => listeners[event].delete(listener); },
  };
}
