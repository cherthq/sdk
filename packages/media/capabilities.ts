import type { VideoCodec } from './frames';

/** Explicit, versioned media capabilities reported by the service. Never inferred from generic video flags. */
export interface MediaCapabilities {
  version: 1;
  custom_video: { supported: boolean; transports: ('whip' | 'livekit')[]; codecs: VideoCodec[];
    max_width: number; max_height: number; max_fps: number } | null;
  inbound_caller_video: { supported: boolean; transports: ('whep' | 'livekit')[];
    max_width: number; max_height: number; max_fps: number } | null;
}

export const UNSUPPORTED: Readonly<MediaCapabilities> = Object.freeze({ version: 1, custom_video: null, inbound_caller_video: null });

const positive = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
const list = <T extends string>(v: unknown, allowed: readonly T[]): T[] | null =>
  Array.isArray(v) && v.every(x => allowed.includes(x)) ? [...new Set(v as T[])] : null;
const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/**
 * Parses the service's `media_capabilities` object. Absent, malformed or unknown-version input is
 * unsupported. A malformed section disables only that section. Bounds are capped at SDK v1 limits.
 */
export function parseMediaCapabilities(input: unknown): MediaCapabilities {
  const raw = record(input);
  if (!raw || raw.version !== 1) return { ...UNSUPPORTED };
  const out: MediaCapabilities = { version: 1, custom_video: null, inbound_caller_video: null };
  const cv = record(raw.custom_video);
  if (cv && cv.supported === true) {
    const transports = list(cv.transports, ['whip', 'livekit'] as const), codecs = list(cv.codecs, ['h264', 'vp8'] as const);
    if (transports?.length && codecs?.length && positive(cv.max_width, 1920) && positive(cv.max_height, 1080) && positive(cv.max_fps, 30))
      out.custom_video = { supported: true, transports, codecs, max_width: cv.max_width, max_height: cv.max_height, max_fps: cv.max_fps };
  }
  const iv = record(raw.inbound_caller_video);
  if (iv && iv.supported === true) {
    const transports = list(iv.transports, ['whep', 'livekit'] as const);
    if (transports?.length && positive(iv.max_width, 1280) && positive(iv.max_height, 720) && positive(iv.max_fps, 30))
      out.inbound_caller_video = { supported: true, transports, max_width: iv.max_width, max_height: iv.max_height, max_fps: iv.max_fps };
  }
  return out;
}
