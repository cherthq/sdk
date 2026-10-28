/**
 * Public page bridge for FaceTime living services (`chert.living.v1`).
 * The host posts `{protocol, type:'connect'}` with one MessagePort to the page's window using the page's exact
 * origin (never '*'), and re-offers with a fresh port until the page replies `hello` on any of them or the ready
 * deadline passes. Hosts keep every offered port open until then, adopt the one that said hello and close the rest.
 * Pages may post `{protocol, type:'request'}` to ask for a connect. Every message below travels over the port.
 * Hosts should hold state, events and input until `ready`; the page also keeps the latest state sent during startup.
 * Trust model: any script running in the page itself can win the handshake; the page's own code is trusted.
 * Nothing here describes how the host renders or transports the page.
 */
export const PROTOCOL = 'chert.living.v1';
export const LIMITS = Object.freeze({
  maxStateBytes: 64 * 1024, maxEventBytes: 16 * 1024, maxMessageBytes: 16 * 1024,
  heartbeatMs: 5_000, readyTimeoutMs: 15_000, maxWidth: 1920, maxHeight: 1080, maxFps: 30,
});

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type InputKind = 'pointer' | 'keyboard' | 'text';
export interface Viewport { width: number; height: number }
export type HealthStatus = 'ok' | 'degraded';

/** Public normalized call event types forwarded to the page. */
export type LivingCallEvent = { type: string; at: string };
export type PointerInput = { kind: 'pointer'; action: 'down' | 'move' | 'up'; x: number; y: number };
export type KeyboardInput = { kind: 'keyboard'; action: 'down' | 'up'; key: string };
export type TextInput = { kind: 'text'; text: string };
export type LivingInput = PointerInput | KeyboardInput | TextInput;

export type HostMessage =
  | { type: 'start'; session_id: string; viewport: Viewport; fps: number; input: InputKind[]; state: Json; revision: number }
  | { type: 'state'; revision: number; state: Json }
  | { type: 'event'; event: string; data: Json }
  | { type: 'call_event'; event: LivingCallEvent }
  | { type: 'input'; input: LivingInput }
  | { type: 'stop'; reason: string };
export type PageMessage =
  | { type: 'hello'; sdk: string }
  | { type: 'ready' }
  | { type: 'heartbeat' }
  | { type: 'health'; status: HealthStatus; code?: string }
  | { type: 'message'; message: string; data: Json }
  | { type: 'stopped' };

const NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
export const isEventName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v);
export const jsonBytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).byteLength;

/** Throws TypeError unless `value` is plain JSON within `max` encoded bytes. */
export function assertJson(value: unknown, max: number, label: string): asserts value is Json {
  const seen = new Set<object>();
  let nodes = 0;   // bounds work for shared references, which structured clone preserves
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 64 || ++nodes > max) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    const ok = Array.isArray(v) ? v.every(x => walk(x, depth + 1))
      : Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null
        ? Object.values(v as object).every(x => walk(x, depth + 1)) : false;
    seen.delete(v);
    return ok;
  };
  if (!walk(value, 0)) throw new TypeError(nodes > max ? `${label} exceeds ${max} bytes.` : `${label} must be plain JSON.`);
  if (jsonBytes(value) > max) throw new TypeError(`${label} exceeds ${max} bytes.`);
}

export function isViewport(v: unknown): v is Viewport {
  const r = v as Record<string, unknown> | null;
  return !!r && typeof r === 'object' && [r.width, r.height].every(n => Number.isInteger(n) && (n as number) >= 16 && (n as number) % 2 === 0)
    && (r.width as number) <= LIMITS.maxWidth && (r.height as number) <= LIMITS.maxHeight;
}
const inputKinds: readonly InputKind[] = ['pointer', 'keyboard', 'text'];
export const isInputList = (v: unknown): v is InputKind[] =>
  Array.isArray(v) && v.every(k => inputKinds.includes(k)) && new Set(v).size === v.length;

function isInput(v: unknown): v is LivingInput {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return false;
  const unit = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1;
  switch (r.kind) {
    case 'pointer': return ['down', 'move', 'up'].includes(r.action as string) && unit(r.x) && unit(r.y);
    case 'keyboard': return ['down', 'up'].includes(r.action as string) && typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 32;
    case 'text': return typeof r.text === 'string' && r.text.length <= 1024;
    default: return false;
  }
}

/** Strictly parses a host message; returns null for anything malformed or oversized. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return null;
  const json = (v: unknown, max: number) => { try { assertJson(v, max, 'value'); return true; } catch { return false; } };
  switch (m.type) {
    case 'start':
      return typeof m.session_id === 'string' && m.session_id.length > 0 && m.session_id.length <= 128 && isViewport(m.viewport)
        && Number.isInteger(m.fps) && (m.fps as number) >= 1 && (m.fps as number) <= LIMITS.maxFps && isInputList(m.input)
        && Number.isInteger(m.revision) && (m.revision as number) >= 0 && json(m.state, LIMITS.maxStateBytes)
        ? { type: 'start', session_id: m.session_id, viewport: { width: (m.viewport as Viewport).width, height: (m.viewport as Viewport).height },
          fps: m.fps as number, input: [...(m.input as InputKind[])], state: m.state as Json, revision: m.revision as number } : null;
    case 'state':
      return Number.isInteger(m.revision) && (m.revision as number) >= 0 && json(m.state, LIMITS.maxStateBytes)
        ? { type: 'state', revision: m.revision as number, state: m.state as Json } : null;
    case 'event':
      return isEventName(m.event) && json(m.data, LIMITS.maxEventBytes) ? { type: 'event', event: m.event, data: m.data as Json } : null;
    case 'call_event': {
      const e = m.event as Record<string, unknown> | null;
      return e && typeof e === 'object' && isEventName(e.type) && typeof e.at === 'string' && e.at.length <= 64
        ? { type: 'call_event', event: { type: e.type, at: e.at } } : null;
    }
    case 'input': return isInput(m.input) ? { type: 'input', input: { ...m.input } as LivingInput } : null;
    case 'stop': return typeof m.reason === 'string' && m.reason.length <= 64 ? { type: 'stop', reason: m.reason } : null;
    default: return null;
  }
}
