/**
 * Call video composition (draft, unreleased): the call's video as a stack of layers, composed server-side and
 * published through the call's single publish slot. A base layer (z 0) carries camera frames over a #17 publish
 * grant, or a backend-managed source; page layers (z >= 1) are #18 living sessions. No other transport.
 */
import { validateInitialState, validateLivingSession, validateManifest, type LivingInputKind, type LivingJson, type LivingServiceManifest, type LivingSession, type LivingViewport } from './living';
import type { MediaSessionGrant } from './index';

/** SDK v1 bound. The capability's `max_layers` is the backend's real limit. */
export const COMPOSITION_MAX_LAYERS = 2;

export type CompositionBaseKind = 'camera' | 'managed';
/**
 * `camera`: the response carries a publish grant; push frames with ChertVideoSource + WHIP (or a LiveKit track via
 * `liveKitTrackFrames`). `managed`: a backend-provided source, only where `video_composition.bases` lists it.
 */
export interface CompositionBase { kind: CompositionBaseKind }
/** Normalized to the output frame: 0..1, width/height > 0, and x+width, y+height <= 1. */
export interface CompositionRegion { x: number; y: number; width: number; height: number }
/**
 * A page: an existing ready #18 deployment, or an HTTPS URL that the SDK deploys first (create, wait ready) so the
 * call-video resource only ever receives an immutable `deployment_id`. The backend never loads a URL directly.
 * URL pages take an optional viewport/fps for the deployment manifest (default 1280x720 at 30; the effective values
 * are clamped server-side) and a name (default: the URL host).
 */
export type CompositionPage = string | { url: string; digest?: string; name?: string; viewport?: LivingViewport; fps?: number } | { deployment_id: string };
export type CompositionBackground = 'opaque' | 'transparent';

export interface BaseLayerInput { id: string; source: CompositionBase }
export interface PageLayerInput {
  id: string;
  /** Unique, >= 1; paints in ascending order above the base. */
  z: number;
  page: CompositionPage;
  /** Default: full frame. */
  region?: CompositionRegion;
  /** `transparent` renders the page with alpha (premultiplied source-over). Default `opaque`. */
  background?: CompositionBackground;
  /** Layer multiplier 0..1. Default 1. */
  opacity?: number;
  /** Agent-relayed input kinds; omit for a non-interactive layer. */
  input?: LivingInputKind[];
  initial_state?: LivingJson;
}
export type VideoLayerInput = BaseLayerInput | PageLayerInput;
/** Optional `revision` makes the PUT compare-and-set; it must equal the current revision. */
export type SetCallVideo =
  | { page: CompositionPage; input?: LivingInputKind[]; initial_state?: LivingJson; revision?: number }
  | { layers: VideoLayerInput[]; revision?: number };

export type CompositionStatus = 'starting' | 'live' | 'stopping' | 'stopped' | 'failed';
export interface BaseLayer { id: string; z: 0; source: CompositionBase; /** Camera bases only, when the backend issues one. */ publish?: MediaSessionGrant }
export interface PageLayer {
  id: string; z: number; living_session: LivingSession; region: CompositionRegion;
  background: CompositionBackground; opacity: number; input: LivingInputKind[];
}
export type VideoLayer = BaseLayer | PageLayer;
export interface CallVideoComposition {
  composition_id: string; call_id: string; revision: number; status: CompositionStatus;
  /** Effective output: fps = min(base fps, grant limit); page layers render at or below it. */
  output: { width: number; height: number; fps: number };
  layers: VideoLayer[];
  error_code: string | null;
  [key: string]: unknown;
}

/** Explicit, versioned `video_composition` capability. Never inferred from custom_video or living_services. */
export interface VideoCompositionCapability {
  version: 1; supported: true; max_layers: number; bases: CompositionBaseKind[];
  page_alpha: boolean; regions: boolean; max_width: number; max_height: number; max_fps: number;
}

const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const posInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const KINDS: readonly LivingInputKind[] = ['pointer', 'keyboard', 'text'];

/** Parses `video_composition`. Absent, malformed, unknown-version or unsupported input returns null. */
export function parseVideoComposition(input: unknown): VideoCompositionCapability | null {
  const raw = record(input);
  if (!raw || raw.version !== 1 || raw.supported !== true || !Array.isArray(raw.bases)) return null;
  if (!posInt(raw.max_layers) || !posInt(raw.max_width) || !posInt(raw.max_height) || !posInt(raw.max_fps)) return null;
  // Unknown bases are ignored and larger limits clamp to SDK v1 bounds, so newer services stay usable.
  const bases = [...new Set(raw.bases.filter((b): b is CompositionBaseKind => b === 'camera' || b === 'managed'))];
  return { version: 1, supported: true, max_layers: Math.min(raw.max_layers, COMPOSITION_MAX_LAYERS), bases,
    page_alpha: raw.page_alpha === true, regions: raw.regions === true,
    max_width: Math.min(raw.max_width, 1920), max_height: Math.min(raw.max_height, 1080), max_fps: Math.min(raw.max_fps, 30) };
}

const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const FULL: CompositionRegion = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const EPS = 1e-9;
function regionOk(r: unknown): r is CompositionRegion {
  const v = record(r);
  return !!v && unit(v.x) && unit(v.y) && unit(v.width) && unit(v.height) && (v.width as number) > 0 && (v.height as number) > 0
    && (v.x as number) + (v.width as number) <= 1 + EPS && (v.y as number) + (v.height as number) <= 1 + EPS;
}
const fullFrame = (r: CompositionRegion) => r.x === 0 && r.y === 0 && r.width === 1 && r.height === 1;
const inputsOk = (v: unknown) => Array.isArray(v) && v.every(k => KINDS.includes(k)) && new Set(v).size === v.length;

/** A URL page resolves to this manifest; the client deploys it and substitutes the ready `deployment_id`. */
export type PageRef = { deployment_id: string } | { manifest: LivingServiceManifest };
function pageRef(page: CompositionPage): PageRef {
  const p = typeof page === 'string' ? { url: page } : page;
  if (p && typeof p === 'object' && 'deployment_id' in p) {
    if (typeof p.deployment_id !== 'string' || !p.deployment_id || p.deployment_id.length > 128) throw new TypeError('deployment_id is required.');
    return { deployment_id: p.deployment_id };
  }
  const u = p as Exclude<CompositionPage, string | { deployment_id: string }>;
  let host = '';
  try { host = new URL(u?.url).host; } catch { /* validateManifest reports it */ }
  const manifest = validateManifest({ name: u?.name ?? (host || 'page'), entry_url: u?.url, viewport: u?.viewport ?? { width: 1280, height: 720 }, fps: u?.fps ?? 30,
    ...(u?.digest !== undefined ? { entry_digest: u.digest } : {}) });
  return { manifest };
}

/**
 * @internal Validates locally and returns the PUT body. The page shortcut is one opaque full-frame page layer.
 * Page layers carry a `PageRef`; the client replaces each `{ manifest }` with a ready `deployment_id` before the PUT.
 */
export function compositionBody(input: SetCallVideo): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new TypeError('setCallVideo needs { page } or { layers }.');
  const layers: VideoLayerInput[] = 'page' in input && !('layers' in input)
    ? [{ id: 'page', z: 1, page: input.page, ...(input.input ? { input: input.input } : {}), ...(input.initial_state !== undefined ? { initial_state: input.initial_state } : {}) }]
    : (input as { layers: VideoLayerInput[] }).layers;
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > COMPOSITION_MAX_LAYERS) throw new TypeError(`A composition has 1-${COMPOSITION_MAX_LAYERS} layers.`);
  if (input.revision !== undefined && !(Number.isSafeInteger(input.revision) && input.revision >= 0)) throw new TypeError('revision must be a non-negative integer.');
  const ids = new Set<string>(), zs = new Set<number>();
  let bases = 0;
  const out = layers.map(layer => {
    if (!layer || typeof layer.id !== 'string' || !ID.test(layer.id) || ids.has(layer.id)) throw new TypeError('Layer ids are unique, 1-32 chars: lowercase letter, then [a-z0-9_-].');
    ids.add(layer.id);
    if ('source' in layer) {
      if (++bases > 1 || (layer as { z?: unknown }).z !== undefined && (layer as { z?: unknown }).z !== 0) throw new TypeError('At most one base layer, always at z 0.');
      if (layer.source?.kind !== 'camera' && layer.source?.kind !== 'managed') throw new TypeError('A base source is camera or managed.');
      return { id: layer.id, z: 0, source: { kind: layer.source.kind } };
    }
    if (!Number.isInteger(layer.z) || layer.z < 1 || layer.z > 64 || zs.has(layer.z)) throw new TypeError('Page layer z values are unique integers 1..64.');
    zs.add(layer.z);
    const region = layer.region ?? FULL;
    if (!regionOk(region)) throw new TypeError('region is normalized 0..1 and must stay inside the frame.');
    const background = layer.background ?? 'opaque';
    if (background !== 'opaque' && background !== 'transparent') throw new TypeError('background is opaque or transparent.');
    const opacity = layer.opacity ?? 1;
    if (!unit(opacity)) throw new TypeError('opacity must be 0..1.');
    if (layer.input !== undefined && !inputsOk(layer.input)) throw new TypeError('input must be a unique subset of pointer, keyboard, text.');
    if (layer.initial_state !== undefined) validateInitialState(layer.initial_state);
    return { id: layer.id, z: layer.z, page: pageRef(layer.page), region: { x: region.x, y: region.y, width: region.width, height: region.height },
      background, opacity, ...(layer.input ? { input: [...layer.input] } : {}), ...(layer.initial_state !== undefined ? { initial_state: layer.initial_state } : {}) };
  });
  if (!bases) {
    // Nothing below the bottom page: it must fill the frame without showing through.
    const bottom = out.reduce((a, b) => (b.z < a.z ? b : a)) as { region: CompositionRegion; background: string; opacity: number };
    if (!fullFrame(bottom.region) || bottom.background !== 'opaque' || bottom.opacity !== 1) throw new TypeError('Without a base, the bottom page layer must be opaque, full frame and opacity 1.');
  }
  return { ...(input.revision !== undefined ? { revision: input.revision } : {}), layers: out };
}

const STATUSES: readonly CompositionStatus[] = ['starting', 'live', 'stopping', 'stopped', 'failed'];
const even = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 16 && (v as number) <= max && (v as number) % 2 === 0;

/** @internal Throws on any response outside the contract. `checkGrant` validates a camera base's publish grant. */
export function validateComposition(c: CallVideoComposition, checkGrant: (g: MediaSessionGrant) => MediaSessionGrant): CallVideoComposition {
  const fail = () => { throw new TypeError('invalid composition'); };
  if (!record(c) || typeof c.composition_id !== 'string' || !c.composition_id || typeof c.call_id !== 'string' || !c.call_id) fail();
  if (!Number.isSafeInteger(c.revision) || c.revision < 0 || !STATUSES.includes(c.status)) fail();
  if (!(c.error_code === null || typeof c.error_code === 'string')) fail();
  const o = record(c.output);
  if (!o || !even(o.width, 1920) || !even(o.height, 1080) || !Number.isInteger(o.fps) || (o.fps as number) < 1 || (o.fps as number) > 30) fail();
  if (!Array.isArray(c.layers) || c.layers.length > COMPOSITION_MAX_LAYERS) fail();
  const ids = new Set<string>(), zs = new Set<number>();
  let base = false;
  for (const layer of c.layers) {
    if (!record(layer) || typeof layer.id !== 'string' || ids.has(layer.id) || zs.has(layer.z)) fail();
    ids.add(layer.id); zs.add(layer.z);
    if ('source' in layer) {
      if (base || layer.z !== 0 || (layer.source?.kind !== 'camera' && layer.source?.kind !== 'managed')) fail();
      base = true;
      if (layer.publish !== undefined) {
        if (layer.source.kind !== 'camera') fail();
        checkGrant(layer.publish);
        if (c.output.fps > layer.publish.limits.max_fps) fail();
      }
      continue;
    }
    const p = layer as PageLayer;
    if (!Number.isInteger(p.z) || p.z < 1 || !regionOk(p.region) || (p.background !== 'opaque' && p.background !== 'transparent') || !unit(p.opacity) || !inputsOk(p.input)) fail();
    validateLivingSession(p.living_session);
    if (p.living_session.call_id !== c.call_id || p.living_session.fps > c.output.fps) fail();
  }
  return c;
}

/**
 * The topmost page layer accepting pointer input under an output-frame point (x, y normalized 0..1), or null.
 * Relay with `sendLivingInput(callId, layer.living_session.session_id, { kind: 'pointer', ... })` using the same
 * output-frame coordinates; the backend maps them into the page and rejects points outside the region.
 */
export function compositionInputTarget(composition: CallVideoComposition, x: number, y: number): PageLayer | null {
  if (!unit(x) || !unit(y)) return null;
  const pages = composition.layers.filter((l): l is PageLayer => !('source' in l) && l.input.includes('pointer'));
  pages.sort((a, b) => b.z - a.z);
  return pages.find(({ region: r }) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) ?? null;
}
