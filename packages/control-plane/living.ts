/** Living services: a developer-hosted web frontend rendered as the call's video while voice continues. Draft contract. */
export type LivingInputKind = 'pointer' | 'keyboard' | 'text';
export interface LivingViewport { width: number; height: number }
export type LivingJson = null | boolean | number | string | LivingJson[] | { [key: string]: LivingJson };

/**
 * Explicit, versioned `living_services` capability on line, call and scoped worker. Never inferred from
 * custom video or generic video flags. Supported only when the service reports it, including a usable publish path.
 */
export interface LivingServicesCapability { version: 1; supported: true; max_width: number; max_height: number; max_fps: number; input: LivingInputKind[] }

export interface LivingServiceManifest {
  name: string;
  /** Developer-hosted HTTPS entry point. No credentials or fragment. Must serve immutable content per revision. */
  entry_url: string;
  /** Optional content pin for the entry document, `sha256-<base64>`; the service may require one. */
  entry_digest?: string;
  viewport: LivingViewport;
  fps: number;
  input?: LivingInputKind[];
  /** Optional developer-defined schema version carried with each deployment. */
  state_schema_version?: number;
}
export type LivingDeploymentStatus = 'pending' | 'ready' | 'failed';
export interface LivingDeployment {
  service_id: string; deployment_id: string; revision: number; status: LivingDeploymentStatus;
  error_code: string | null; [key: string]: unknown;
}
export interface AttachLivingService {
  deployment_id: string; initial_state?: LivingJson;
  /** Optional request; the effective value is min(requested, manifest, grant limits). */
  viewport?: LivingViewport; fps?: number;
}
export type LivingSessionStatus = 'starting' | 'ready' | 'live' | 'stopping' | 'stopped' | 'failed';
export interface LivingSession {
  session_id: string; call_id: string; deployment_id: string; status: LivingSessionStatus;
  /** Effective values: min(requested, manifest, grant limits), even and aspect-preserving. */
  viewport: LivingViewport; fps: number;
  ready_at: string | null; last_heartbeat_at: string | null; error_code: string | null; [key: string]: unknown;
}
export type LivingInputEvent =
  | { kind: 'pointer'; action: 'down' | 'move' | 'up'; x: number; y: number }
  | { kind: 'keyboard'; action: 'down' | 'up'; key: string }
  | { kind: 'text'; text: string };

const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Parses the `living_services` field. Absent, malformed, unknown-version or `supported: false` input returns null. */
export function parseLivingServices(input: unknown): LivingServicesCapability | null {
  const raw = record(input);
  if (!raw || raw.version !== 1 || raw.supported !== true) return null;
  const kinds = raw.input;
  const int = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
  if (!int(raw.max_width) || !int(raw.max_height) || !int(raw.max_fps) || !Array.isArray(kinds)) return null;
  // Unknown input kinds are ignored and larger limits clamp to SDK v1 bounds, so newer services stay usable.
  return { version: 1, supported: true, max_width: Math.min(raw.max_width, 1920), max_height: Math.min(raw.max_height, 1080), max_fps: Math.min(raw.max_fps, 30),
    input: [...new Set(kinds.filter((k): k is LivingInputKind => k === 'pointer' || k === 'keyboard' || k === 'text'))] };
}

const NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;
function plainJson(v: unknown, max: number, label: string): void {
  let nodes = 0;   // bounds work for shared references
  const walk = (x: unknown, d: number): boolean => d <= 64 && ++nodes <= max && (x === null || typeof x === 'string' || typeof x === 'boolean'
    || (typeof x === 'number' && Number.isFinite(x))
    || (Array.isArray(x) ? x.every(y => walk(y, d + 1))
      : !!x && typeof x === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(x)) && Object.values(x).every(y => walk(y, d + 1))));
  let ok = false; try { ok = walk(v, 0); } catch { /* cycles overflow depth */ }
  if (!ok) throw new TypeError(`${label} must be plain JSON.`);
  if (bytes(v) > max) throw new TypeError(`${label} exceeds ${max} bytes.`);
}
const evenDim = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 16 && (v as number) <= max && (v as number) % 2 === 0;
const inputs = (v: unknown) => Array.isArray(v) && v.every(k => k === 'pointer' || k === 'keyboard' || k === 'text') && new Set(v).size === v.length;

/** @internal */
export function validateManifest(m: LivingServiceManifest): LivingServiceManifest {
  if (!m || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) throw new TypeError('A service name of 1-120 characters is required.');
  let url: URL;
  try { url = new URL(m.entry_url); } catch { throw new TypeError('entry_url must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('entry_url must be HTTPS without credentials or fragment.');
  if (!m.viewport || !evenDim(m.viewport.width, 1920) || !evenDim(m.viewport.height, 1080)) throw new TypeError('viewport must be even, 16..1920 x 16..1080.');
  if (!Number.isInteger(m.fps) || m.fps < 1 || m.fps > 30) throw new TypeError('fps must be 1..30.');
  if (m.input !== undefined && !inputs(m.input)) throw new TypeError('input must be a unique subset of pointer, keyboard, text.');
  if (m.entry_digest !== undefined && !/^sha256-[A-Za-z0-9+/]{43}=$/.test(m.entry_digest)) throw new TypeError('entry_digest must be sha256-<base64>.');
  if (m.state_schema_version !== undefined && !(Number.isInteger(m.state_schema_version) && m.state_schema_version >= 0)) throw new TypeError('state_schema_version must be a non-negative integer.');
  return { name: m.name, entry_url: url.href, viewport: { width: m.viewport.width, height: m.viewport.height }, fps: m.fps,
    ...(m.entry_digest ? { entry_digest: m.entry_digest } : {}), ...(m.input ? { input: [...m.input] } : {}), ...(m.state_schema_version !== undefined ? { state_schema_version: m.state_schema_version } : {}) };
}
/** @internal */
export function validateState(revision: number, state: unknown): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('revision must be a non-negative integer.');
  plainJson(state, 64 * 1024, 'State');
}
/** @internal */
export function validateEvent(type: string, data: unknown): void {
  if (!NAME.test(type)) throw new TypeError('Event names are 1-64 chars: lowercase letter, then [a-z0-9_.-].');
  plainJson(data, 16 * 1024, 'Event data');
}
/** @internal */
export function validateInput(i: LivingInputEvent): LivingInputEvent {
  const unit = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1;
  if (i?.kind === 'pointer' && ['down', 'move', 'up'].includes(i.action) && unit(i.x) && unit(i.y)) return { kind: 'pointer', action: i.action, x: i.x, y: i.y };
  if (i?.kind === 'keyboard' && ['down', 'up'].includes(i.action) && typeof i.key === 'string' && i.key.length >= 1 && i.key.length <= 32) return { kind: 'keyboard', action: i.action, key: i.key };
  if (i?.kind === 'text' && typeof i.text === 'string' && i.text.length <= 1024) return { kind: 'text', text: i.text };
  throw new TypeError('Invalid input event.');
}
/** @internal */
export function validateInitialState(state: unknown): void { plainJson(state, 64 * 1024, 'initial_state'); }

/**
 * Signed, durable webhook carrying a page-to-developer message. Draft: verify the configured
 * signature over the exact received bytes before trusting it, and de-duplicate on `event_id`
 * (delivery is at-least-once). Message data never appears in the call timeline.
 */
export interface LivingServiceMessageWebhook {
  event_id: string; type: 'living_service.message'; created_at: string;
  data: { call_id: string; session_id: string; deployment_id: string; message: string; data: LivingJson; occurred_at: string };
}

/** @internal Checks the effective viewport/fps returned by attach and status. */
export function validateLivingSession(session: LivingSession): LivingSession {
  const s = session as unknown as Record<string, unknown>, v = s?.viewport as Record<string, unknown> | undefined;
  const statuses = ['starting', 'ready', 'live', 'stopping', 'stopped', 'failed'];
  if (!s || typeof s.session_id !== 'string' || !s.session_id || !statuses.includes(s.status as string)
    || !v || !evenDim(v.width, 1920) || !evenDim(v.height, 1080) || !Number.isInteger(s.fps) || (s.fps as number) < 1 || (s.fps as number) > 30)
    throw new TypeError('invalid_response');
  return session;
}
/** @internal */
export function validateAttach(input: AttachLivingService): Record<string, unknown> {
  if (!input || typeof input.deployment_id !== 'string' || !input.deployment_id) throw new TypeError('deployment_id is required.');
  if (input.initial_state !== undefined) validateInitialState(input.initial_state);
  if (input.viewport !== undefined && !(evenDim(input.viewport?.width, 1920) && evenDim(input.viewport?.height, 1080))) throw new TypeError('viewport must be even, 16..1920 x 16..1080.');
  if (input.fps !== undefined && !(Number.isInteger(input.fps) && input.fps >= 1 && input.fps <= 30)) throw new TypeError('fps must be 1..30.');
  return { deployment_id: input.deployment_id, ...(input.initial_state !== undefined ? { initial_state: input.initial_state } : {}),
    ...(input.viewport ? { viewport: { width: input.viewport.width, height: input.viewport.height } } : {}), ...(input.fps !== undefined ? { fps: input.fps } : {}) };
}
