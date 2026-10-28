import { checkDimensions, copyEncodedChunk, copyVideoFrame, LIMITS, MediaFrameError,
  type EncodedVideoChunk, type VideoFrame, type VideoFrameInit } from './frames';

export type MediaErrorCode = 'transport_unavailable' | 'credentials_rejected' | 'session_expired' | 'session_conflict'
  | 'call_not_active' | 'call_ended' | 'invalid_signaling' | 'codec_unsupported' | 'capability_missing' | 'invalid_state' | 'aborted' | 'transport_failed'
  | 'caller_screen_not_shared';
/** Messages are fixed per code; tokens, endpoints, SDP and media bytes are never included. */
export class MediaError extends Error {
  constructor(public readonly code: MediaErrorCode, message = `Media operation failed (${code}).`) { super(message); this.name = 'MediaError'; }
}

export type OutboundItem = { kind: 'video'; frame: VideoFrame } | { kind: 'encoded'; chunk: EncodedVideoChunk };
/**
 * Transport-neutral video sink. A transport receives owned, validated items one at a time.
 * `send` resolving means the transport accepted the item; it may still drop it later under congestion.
 */
export interface MediaTransport {
  /** Adapter-defined identifier, for diagnostics only. */
  readonly kind: string;
  /** Item kinds this transport can carry: raw frames ('video'), encoded chunks ('encoded'), or both. */
  readonly accepts: readonly OutboundItem['kind'][];
  connect(signal: AbortSignal): Promise<void>;
  send(item: OutboundItem): Promise<void>;
  close(reason?: string): Promise<void>;
  /** Optional: remote keyframe requests, where the path forwards them. Delivery is not guaranteed. */
  onKeyframeRequest?(listener: () => void): () => void;
  /** Optional: transport-initiated failure after connect. */
  onFailure?(listener: (error: MediaError) => void): () => void;
}

export type SourceState = 'idle' | 'starting' | 'live' | 'stopping' | 'stopped' | 'failed';
export type PushResult = 'queued' | 'dropped';
export interface VideoSourceOptions {
  transport: MediaTransport;
  width: number; height: number; maxFps: number;
  queue?: { maxItems?: number; overflow?: 'drop-oldest' | 'drop-newest' };
}
export interface VideoSourceStats { delivered: number; dropped: number; rejected: number; keyframeRequests: number; lastTimestampUs: bigint | null }
type Events = { state: (state: SourceState) => void; error: (error: MediaError) => void; 'keyframe-request': () => void };

/** One outbound video source with a bounded queue. Pushes copy input and never block. */
export class ChertVideoSource {
  #state: SourceState = 'idle';
  #listeners: { [K in keyof Events]: Set<Events[K]> } = { state: new Set(), error: new Set(), 'keyframe-request': new Set() };
  #items: OutboundItem[] = [];
  #delivered = 0; #dropped = 0; #rejected = 0; #keyframeRequests = 0; #last: bigint | null = null;
  #awaitingKey = false; #pumping = false;
  #abort = new AbortController(); #detach: (() => void)[] = [];
  readonly #options: VideoSourceOptions; readonly #max: number; readonly #overflow: 'drop-oldest' | 'drop-newest'; readonly #minIntervalUs: bigint;

  constructor(options: VideoSourceOptions) {
    if (!options?.transport) throw new TypeError('A media transport is required.');
    checkDimensions(options.width, options.height);
    if (!Number.isInteger(options.maxFps) || options.maxFps < 1 || options.maxFps > LIMITS.maxFps) throw new TypeError(`maxFps must be 1..${LIMITS.maxFps}.`);
    const max = options.queue?.maxItems ?? 2, overflow = options.queue?.overflow ?? 'drop-oldest';
    if (!Number.isInteger(max) || max < 1 || max > 8) throw new TypeError('queue.maxItems must be 1..8.');
    if (overflow !== 'drop-oldest' && overflow !== 'drop-newest') throw new TypeError('Unsupported overflow policy.');
    this.#options = options; this.#max = max; this.#overflow = overflow;
    // Allow 10% jitter before treating a frame as exceeding maxFps.
    this.#minIntervalUs = BigInt(Math.floor(900_000 / options.maxFps));
  }

  get state(): SourceState { return this.#state; }

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    this.#listeners[event].add(listener); return () => this.#listeners[event].delete(listener);
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.#state !== 'idle') throw new MediaError('invalid_state', 'Sources start once.');
    this.#set('starting');
    const onAbort = () => this.#abort.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) throw new MediaError('aborted');
      const { transport } = this.#options;
      if (!transport.accepts.includes('video') && !transport.accepts.includes('encoded')) throw new MediaError('codec_unsupported');
      await transport.connect(this.#abort.signal);
      if (this.#abort.signal.aborted) {
        // Connected after stop/abort: release the just-opened session before reporting.
        await transport.close('aborted').catch(() => {});
        throw new MediaError('aborted');
      }
      const offKey = transport.onKeyframeRequest?.(() => { this.#keyframeRequests++; this.#emit('keyframe-request'); });
      const offFail = transport.onFailure?.(error => void this.#fail(error));
      for (const off of [offKey, offFail]) if (off) this.#detach.push(off);
      if (this.state !== 'starting') return; // stopped or failed concurrently
      this.#set('live');
      this.#pump();
    } catch (error) {
      const failure = error instanceof MediaError ? error : new MediaError(this.#abort.signal.aborted ? 'aborted' : 'transport_unavailable');
      await this.#fail(failure);
      throw failure;
    } finally { signal?.removeEventListener('abort', onAbort); }
  }

  /** Copies the frame before returning. Throws MediaFrameError for invalid or mismatched frames. */
  pushFrame(input: VideoFrameInit): PushResult {
    this.#accepting();
    if (!this.#options.transport.accepts.includes('video')) throw new MediaError('codec_unsupported', 'This transport accepts encoded video only.');
    const frame = this.#guard(() => copyVideoFrame(input));
    if (frame.width !== this.#options.width || frame.height !== this.#options.height) { this.#rejected++; throw new MediaFrameError('frame_mismatch', 'Frame dimensions differ from the source configuration.'); }
    this.#ordered(frame.timestampUs);
    if (this.#last !== null && frame.timestampUs - this.#last < this.#minIntervalUs) { this.#dropped++; return 'dropped'; }
    return this.#enqueue({ kind: 'video', frame });
  }

  /** Copies the chunk before returning. After any encoded loss, deltas drop until the next keyframe. */
  pushEncoded(input: EncodedVideoChunk): PushResult {
    this.#accepting();
    if (!this.#options.transport.accepts.includes('encoded')) throw new MediaError('codec_unsupported', 'This transport accepts raw frames only.');
    const chunk = this.#guard(() => copyEncodedChunk(input));
    this.#ordered(chunk.timestampUs);
    if (this.#awaitingKey && !chunk.keyFrame) { this.#dropped++; this.#last = chunk.timestampUs; return 'dropped'; }
    return this.#enqueue({ kind: 'encoded', chunk });
  }

  /** Idempotent. Pending queued items are discarded, not drained. */
  async stop(reason?: string): Promise<void> {
    if (this.#state === 'stopped' || this.#state === 'failed' || this.#state === 'stopping') return;
    this.#set('stopping');
    this.#abort.abort();
    this.#teardown();
    try { await this.#options.transport.close(reason); } catch { /* closing is best effort */ }
    this.#set('stopped');
  }

  stats(): VideoSourceStats {
    return { delivered: this.#delivered, dropped: this.#dropped, rejected: this.#rejected, keyframeRequests: this.#keyframeRequests, lastTimestampUs: this.#last };
  }

  #accepting() {
    if (this.#state !== 'starting' && this.#state !== 'live') throw new MediaError('invalid_state', `Cannot push media while ${this.#state}.`);
  }
  #guard<T>(copy: () => T): T { try { return copy(); } catch (error) { this.#rejected++; throw error; } }
  #ordered(ts: bigint) {
    if (this.#last !== null && ts <= this.#last) { this.#rejected++; throw new MediaFrameError('timestamp_regressed', 'Timestamps must strictly increase.'); }
  }
  #enqueue(item: OutboundItem): PushResult {
    const key = item.kind === 'encoded' && item.chunk.keyFrame;
    this.#last = item.kind === 'encoded' ? item.chunk.timestampUs : item.frame.timestampUs;
    if (key) {
      // A keyframe restarts the decode chain: queued encoded items are obsolete.
      this.#awaitingKey = false;
      const kept = this.#items.filter(i => i.kind !== 'encoded');
      this.#dropped += this.#items.length - kept.length;
      this.#items = kept;
    }
    if (this.#items.length >= this.#max) {
      this.#dropped++;
      if (this.#overflow === 'drop-newest') {
        // Queued items precede the dropped chunk and stay decodable; later deltas do not.
        if (item.kind === 'encoded') this.#requestKey();
        return 'dropped';
      }
      const evicted = this.#items.shift()!;
      if (evicted.kind === 'encoded') this.#breakChain();
      if (this.#awaitingKey && item.kind === 'encoded') { this.#dropped++; return 'dropped'; }
    }
    this.#items.push(item);
    if (this.#state === 'live') this.#pump();
    return 'queued';
  }
  /** Losing an encoded chunk breaks the decode chain: keep only a queued keyframe and what follows it. */
  #breakChain() {
    const key = this.#items.findIndex(i => i.kind === 'encoded' && i.chunk.keyFrame);
    const kept = key < 0 ? [] : this.#items.slice(key);
    this.#dropped += this.#items.length - kept.length;
    this.#items = kept;
    if (!kept.length) this.#requestKey();
  }
  #requestKey() {
    if (this.#awaitingKey) return;
    this.#awaitingKey = true; this.#keyframeRequests++; this.#emit('keyframe-request');
  }
  #pump() {
    if (this.#pumping) return;
    this.#pumping = true;
    void (async () => {
      try {
        while (this.#state === 'live' && this.#items.length) {
          await this.#options.transport.send(this.#items.shift()!);
          this.#delivered++;
        }
      } catch (error) {
        await this.#fail(error instanceof MediaError ? error : new MediaError('transport_failed'));
      } finally { this.#pumping = false; }
    })();
  }
  async #fail(error: MediaError) {
    // A failure observed while stopping is the expected result of closing, not an error.
    if (this.#state === 'failed' || this.#state === 'stopped' || this.#state === 'stopping') return;
    this.#abort.abort(); this.#teardown();
    this.#set('failed');
    this.#emit('error', error);
    try { await this.#options.transport.close('failed'); } catch { /* best effort */ }
  }
  #teardown() { for (const off of this.#detach.splice(0)) off(); this.#items = []; }
  #set(state: SourceState) { this.#state = state; this.#emit('state', state); }
  #emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    for (const listener of this.#listeners[event]) try { (listener as (...a: unknown[]) => void)(...args); } catch { /* listener errors are isolated */ }
  }
}
