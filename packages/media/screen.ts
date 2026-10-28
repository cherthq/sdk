import { parseMediaCapabilities } from './capabilities';
import { checkDimensions, type VideoCodec } from './frames';
import { ChertVideoSource, MediaError, type MediaTransport, type VideoSourceOptions } from './source';

/** Screen streams are capped at 15 fps by the service; the SDK never asks for more. */
export const SCREEN_MAX_FPS = 15;

/** The subset of a publish grant a screen transport needs. Treat `endpoint` and `token` as secrets. */
export interface ScreenGrant {
  endpoint: string; token: string; connect_by: string;
  ice_servers: { urls: string | string[]; username?: string; credential?: string; credentialType?: 'password' }[];
  codecs: VideoCodec[];
  limits: { max_width: number; max_height: number; max_fps: number; max_frame_bytes: number };
}
/** Structural view of `ChertControlPlane`, so this module does not depend on the HTTP client. */
export interface ScreenShareClient {
  getCall(callId: string): Promise<{ media_capabilities?: unknown }>;
  createMediaSession(callId: string, input: { direction: 'publish'; content: 'screen'; codecs?: VideoCodec[] }): Promise<ScreenGrant>;
}
export interface ScreenStreamOptions {
  /** Frame size you will push. Must fit the grant's limits. */
  width: number; height: number;
  /** At most 15 and at most the grant's `max_fps`. Default: the lower of the two. */
  maxFps?: number;
  codecs?: VideoCodec[];
  /**
   * Builds the transport for this grant, typically an RTCPeerConnection whose video track has
   * `contentHint = 'detail'`, signalled with `publishWhip(pc, { endpoint, token, connectBy })`.
   */
  createTransport(grant: ScreenGrant): MediaTransport;
  queue?: VideoSourceOptions['queue'];
  signal?: AbortSignal;
}
export interface ScreenStream {
  /** Push screen frames here. */
  readonly source: ChertVideoSource;
  /** Stops the stream and releases the call's publish slot (WHIP DELETE via the transport). Idempotent. */
  stop(): Promise<void>;
}

/**
 * Streams an agent's screen into a call over the same WHIP media session as custom video, with
 * `content: 'screen'`. A call has one publish slot: an active camera, screen or living surface makes
 * minting fail with `ChertApiError` code `media_session_conflict` (signaling reports `session_conflict`).
 * All local checks run before the session is minted, so invalid options never create one.
 */
export async function startScreenStream(client: ScreenShareClient, callId: string, options: ScreenStreamOptions): Promise<ScreenStream> {
  if (!options || typeof options.createTransport !== 'function') throw new TypeError('createTransport is required.');
  const video = parseMediaCapabilities((await client.getCall(callId)).media_capabilities).custom_video;
  if (!video?.transports.includes('whip') || !video.contents.includes('screen')) throw new MediaError('capability_missing');
  checkDimensions(options.width, options.height);
  if (options.width > video.max_width || options.height > video.max_height) throw new TypeError(`Screen size must fit ${video.max_width}x${video.max_height}.`);
  const requested = options.maxFps;
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > Math.min(SCREEN_MAX_FPS, video.max_fps)))
    throw new TypeError(`maxFps must be 1..${Math.min(SCREEN_MAX_FPS, video.max_fps)}.`);
  if (options.signal?.aborted) throw new MediaError('aborted');
  const grant = await client.createMediaSession(callId, { direction: 'publish', content: 'screen', ...(options.codecs ? { codecs: options.codecs } : {}) });
  // The grant can only narrow what the capability allowed; never exceed it.
  const maxFps = Math.min(requested ?? SCREEN_MAX_FPS, SCREEN_MAX_FPS, grant.limits.max_fps);
  if (options.width > grant.limits.max_width || options.height > grant.limits.max_height) throw new MediaError('capability_missing');
  const source = new ChertVideoSource({ transport: options.createTransport(grant), width: options.width, height: options.height, maxFps,
    ...(options.queue ? { queue: options.queue } : {}) });
  await source.start(options.signal);
  return { source, stop: () => source.stop('screen_share_stopped') };
}

/** Framework-neutral tool definitions (JSON Schema parameters; use as MCP `inputSchema` or a function tool). */
export const SCREEN_SHARE_TOOLS = Object.freeze([
  Object.freeze({ name: 'share_screen', description: 'Start showing your screen to the person on this FaceTime call. Fails if your camera or other video is already being shown.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false }) }),
  Object.freeze({ name: 'stop_screen_share', description: 'Stop showing your screen on this FaceTime call.',
    parameters: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false }) }),
] as const);
export type ScreenShareToolName = typeof SCREEN_SHARE_TOOLS[number]['name'];
export type ScreenShareToolResult = { status: 'sharing' | 'stopped' } | { status: 'error'; code: string };

/**
 * Runs the two tools against one call. Operations run one at a time in arrival order, so a share
 * never races a stop's release. Holds at most one stream; sharing while live is a no-op, stop is
 * idempotent, and a stream that failed is replaced on the next share. Results carry only stable codes.
 */
export class ScreenShareController {
  #stream: ScreenStream | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly start: () => Promise<ScreenStream>) {}

  get active(): boolean { return this.#stream !== undefined && this.#stream.source.state === 'live'; }

  async handleTool(name: string, _input?: unknown): Promise<ScreenShareToolResult> {
    const op = name === 'share_screen' ? () => this.#share() : name === 'stop_screen_share' ? () => this.#stop() : undefined;
    if (!op) return { status: 'error', code: 'unknown_tool' };
    const result = this.#queue.then(op);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #share(): Promise<ScreenShareToolResult> {
    if (this.active) return { status: 'sharing' };
    // A previous stream that failed or ended on its own is released before a new one starts.
    const stale = this.#stream; this.#stream = undefined;
    await stale?.stop().catch(() => {});
    try {
      this.#stream = await this.start();
      return { status: 'sharing' };
    } catch (error) {
      const code = error instanceof MediaError ? error.code : codeOf(error);
      return { status: 'error', code: code === 'media_session_conflict' ? 'session_conflict' : code };
    }
  }

  async #stop(): Promise<ScreenShareToolResult> {
    const stream = this.#stream; this.#stream = undefined;
    await stream?.stop().catch(() => {});
    return { status: 'stopped' };
  }
}

function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'screen_share_failed';
}
