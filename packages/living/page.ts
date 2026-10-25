/**
 * Page-side runtime for a living service: runs inside the developer's HTML/React frontend.
 * Framework-neutral and dependency-free. The page never receives project credentials or media grants.
 */
import { assertJson, isEventName, LIMITS, parseHostMessage, PROTOCOL,
  type HealthStatus, type InputKind, type Json, type LivingCallEvent, type LivingInput, type PageMessage, type Viewport } from './protocol';

export type LivingPageState = 'connecting' | 'starting' | 'live' | 'stopped';
export interface LivingStart<S extends Json = Json> { sessionId: string; viewport: Viewport; fps: number; input: InputKind[]; state: S; revision: number }
export interface LivingPageHandlers<S extends Json = Json> {
  /** Render the initial state. Resolve when the first frame is drawn; `ready` is sent afterwards. */
  onStart?(start: LivingStart<S>): void | Promise<void>;
  /** New state from the developer's backend. Revisions strictly increase; stale updates are dropped. */
  onState?(state: S, revision: number): void;
  onEvent?(event: string, data: Json): void;
  onCallEvent?(event: LivingCallEvent): void;
  onInput?(input: LivingInput): void;
  /** Release resources. Resolve when done; `stopped` is sent afterwards. */
  onStop?(reason: string): void | Promise<void>;
}
export interface LivingPageOptions {
  /** Defaults to globalThis. Injected for tests. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /**
   * The only accepted sender of the connect message. Defaults to the page's own window and origin,
   * which is how the service host connects. Set `{ source: window.parent, origin }` for local preview.
   */
  trusted?: { source: unknown; origin: string };
  heartbeatMs?: number;
}
export interface LivingPage {
  readonly state: LivingPageState;
  /** Sends a message to the developer's backend, delivered as a signed webhook (≤16 KiB JSON). Never send credentials. */
  send(message: string, data?: Json): void;
  health(status: HealthStatus, code?: string): void;
  /** Detaches listeners and the port without notifying the host. */
  dispose(): void;
}

const SDK = '@trychert/sdk/living@1';

/** Waits for the host's `chert.living.v1` connect message, then drives the lifecycle through `handlers`. */
export function connectLivingPage<S extends Json = Json>(handlers: LivingPageHandlers<S>, options: LivingPageOptions = {}): LivingPage {
  const target = options.target ?? (globalThis as unknown as Window);
  const heartbeatMs = options.heartbeatMs ?? LIMITS.heartbeatMs;
  let state: LivingPageState = 'connecting';
  let port: MessagePort | null = null;
  let revision = -1;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let input: InputKind[] = [];

  const post = (m: PageMessage) => { try { port?.postMessage(m); } catch { /* port closed */ } };
  const call = <A extends unknown[]>(fn: ((...a: A) => unknown) | undefined, ...args: A) => {
    try { const r = fn?.(...args); if (r instanceof Promise) r.catch(() => post({ type: 'health', status: 'degraded', code: 'handler_failed' })); }
    catch { post({ type: 'health', status: 'degraded', code: 'handler_failed' }); }
  };
  const finish = () => { clearInterval(heartbeat); port?.close(); port = null; state = 'stopped'; };

  async function onHost(event: MessageEvent) {
    const m = parseHostMessage(event.data);
    if (!m) return;   // malformed host messages are ignored, never thrown into the page
    if (m.type === 'start') {
      if (state !== 'starting') return;
      revision = m.revision; input = m.input;
      try { await handlers.onStart?.({ sessionId: m.session_id, viewport: m.viewport, fps: m.fps, input: m.input, state: m.state as S, revision: m.revision }); }
      catch { post({ type: 'health', status: 'degraded', code: 'start_failed' }); return; }
      if (state !== 'starting') return;
      state = 'live';
      post({ type: 'ready' });
      heartbeat = setInterval(() => post({ type: 'heartbeat' }), heartbeatMs);
      return;
    }
    if (m.type === 'stop') {
      if (state === 'stopped') return;
      state = 'stopped';
      clearInterval(heartbeat);
      try { await handlers.onStop?.(m.reason); } catch { /* still acknowledge */ }
      post({ type: 'stopped' });
      finish();
      return;
    }
    if (state !== 'live') return;
    if (m.type === 'state') { if (m.revision <= revision) return; revision = m.revision; call(handlers.onState, m.state as S, m.revision); }
    else if (m.type === 'event') call(handlers.onEvent, m.event, m.data);
    else if (m.type === 'call_event') call(handlers.onCallEvent, m.event);
    else if (m.type === 'input' && input.includes(m.input.kind)) call(handlers.onInput, m.input);
  }

  const own = globalThis as unknown as { location?: { origin: string } };
  const trusted = options.trusted ?? { source: options.target ?? globalThis, origin: own.location?.origin ?? '' };
  const onWindow = (event: MessageEvent) => {
    const d = event.data as Record<string, unknown> | null;
    // Accept the connect only from the trusted window and exact origin; other frames cannot hijack the bridge.
    if (event.source !== trusted.source || event.origin !== trusted.origin) return;
    if (state !== 'connecting' || !d || d.protocol !== PROTOCOL || d.type !== 'connect') return;
    const delivered = event.ports?.[0];
    if (!delivered) return;
    target.removeEventListener('message', onWindow as EventListener);
    port = delivered;
    port.onmessage = e => void onHost(e);
    port.start?.();
    state = 'starting';
    post({ type: 'hello', sdk: SDK });
  };
  target.addEventListener('message', onWindow as EventListener);
  // Pages may subscribe after the host's first connect (e.g. inside a React effect): announce readiness
  // so the host re-sends `connect`. Hosts also retry until `hello`, so this is an optimisation.
  try { (trusted.source as { postMessage?: (m: unknown, o: string) => void }).postMessage?.({ protocol: PROTOCOL, type: 'request' }, trusted.origin); }
  catch { /* no reachable host window */ }

  return {
    get state() { return state; },
    send(message, data = null) {
      if (state !== 'live') throw new Error('The living service is not live.');
      if (!isEventName(message)) throw new TypeError('Message names are 1-64 chars: lowercase letter, then [a-z0-9_.-].');
      assertJson(data, LIMITS.maxMessageBytes, 'Message data');
      post({ type: 'message', message, data });
    },
    health(status, code) {
      if (status !== 'ok' && status !== 'degraded') throw new TypeError('Health is ok or degraded.');
      if (code !== undefined && !isEventName(code)) throw new TypeError('Health codes use the event-name format.');
      post({ type: 'health', status, ...(code ? { code } : {}) });
    },
    dispose() { target.removeEventListener('message', onWindow as EventListener); finish(); },
  };
}
