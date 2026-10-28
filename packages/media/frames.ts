/** Portable raw video frames (v1 is video-only). Validation copies caller memory so buffers may be reused after a push returns. */
export type PixelFormat = 'i420' | 'nv12' | 'rgba' | 'bgra';
export type Rotation = 0 | 90 | 180 | 270;
export type ColorSpace = 'bt709-limited' | 'bt601-limited' | 'srgb-full';
export interface Plane { data: Uint8Array; stride: number }
export interface VideoFrameInit {
  format: PixelFormat; width: number; height: number; planes: Plane[];
  /** Monotonic presentation time in microseconds from the source clock. */
  timestampUs: bigint;
  durationUs?: number; rotation?: Rotation; colorSpace?: ColorSpace;
}
export interface VideoFrame extends Readonly<Omit<VideoFrameInit, 'planes'>> {
  readonly planes: readonly Readonly<Plane>[]; readonly rotation: Rotation; readonly colorSpace: ColorSpace;
}
export type VideoCodec = 'h264' | 'vp8';
export interface EncodedVideoChunk {
  codec: VideoCodec; keyFrame: boolean; timestampUs: bigint;
  /** H.264 uses Annex B byte streams. */
  data: Uint8Array;
}

export const LIMITS = Object.freeze({ maxWidth: 1920, maxHeight: 1080, minDimension: 16, maxFps: 30,
  maxFrameBytes: 8 * 1024 * 1024 });

export class MediaFrameError extends TypeError {
  constructor(public readonly code: 'invalid_frame' | 'frame_mismatch' | 'frame_too_large' | 'timestamp_regressed', message: string) {
    super(message); this.name = 'MediaFrameError';
  }
}

const planeLayout = (format: PixelFormat, width: number, height: number): { rowBytes: number; rows: number }[] => {
  const cw = width / 2, ch = height / 2;
  switch (format) {
    case 'rgba': case 'bgra': return [{ rowBytes: width * 4, rows: height }];
    case 'i420': return [{ rowBytes: width, rows: height }, { rowBytes: cw, rows: ch }, { rowBytes: cw, rows: ch }];
    case 'nv12': return [{ rowBytes: width, rows: height }, { rowBytes: width, rows: ch }];
  }
};

export function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2
    || width < LIMITS.minDimension || height < LIMITS.minDimension || width > LIMITS.maxWidth || height > LIMITS.maxHeight)
    throw new MediaFrameError('invalid_frame', `Dimensions must be even integers between ${LIMITS.minDimension} and ${LIMITS.maxWidth}x${LIMITS.maxHeight}.`);
}

/** Validates and deep-copies a raw frame into tightly owned buffers (strides preserved). */
export function copyVideoFrame(input: VideoFrameInit): VideoFrame {
  const { format, width, height, planes, timestampUs } = input;
  const layout = planeLayout(format, width, height);
  if (!layout) throw new MediaFrameError('invalid_frame', 'Unsupported pixel format.');
  checkDimensions(width, height);
  if (typeof timestampUs !== 'bigint' || timestampUs < 0n) throw new MediaFrameError('invalid_frame', 'timestampUs must be a non-negative bigint.');
  if (input.durationUs !== undefined && !(Number.isInteger(input.durationUs) && input.durationUs > 0)) throw new MediaFrameError('invalid_frame', 'durationUs must be a positive integer.');
  if (input.rotation !== undefined && ![0, 90, 180, 270].includes(input.rotation)) throw new MediaFrameError('invalid_frame', 'Unsupported rotation.');
  if (input.colorSpace !== undefined && !['bt709-limited', 'bt601-limited', 'srgb-full'].includes(input.colorSpace)) throw new MediaFrameError('invalid_frame', 'Unsupported color space.');
  if (!Array.isArray(planes) || planes.length !== layout.length) throw new MediaFrameError('invalid_frame', `${format} requires ${layout.length} plane(s).`);
  let total = 0;
  const copied = planes.map((plane, i) => {
    const { rowBytes, rows } = layout[i]!;
    if (!(plane?.data instanceof Uint8Array) || !Number.isInteger(plane.stride) || plane.stride < rowBytes || plane.stride > rowBytes + 256)
      throw new MediaFrameError('invalid_frame', `Plane ${i} stride must be between ${rowBytes} and ${rowBytes + 256} bytes.`);
    const needed = plane.stride * (rows - 1) + rowBytes;
    if (plane.data.byteLength < needed) throw new MediaFrameError('invalid_frame', `Plane ${i} needs at least ${needed} bytes.`);
    total += needed;
    if (total > LIMITS.maxFrameBytes) throw new MediaFrameError('frame_too_large', 'Frame exceeds 8 MiB.');
    return Object.freeze({ data: plane.data.slice(0, needed), stride: plane.stride });
  });
  const yuv = format === 'i420' || format === 'nv12';
  return Object.freeze({ format, width, height, timestampUs, planes: Object.freeze(copied),
    ...(input.durationUs === undefined ? {} : { durationUs: input.durationUs }),
    rotation: input.rotation ?? 0, colorSpace: input.colorSpace ?? (yuv ? 'bt709-limited' : 'srgb-full') });
}

export function copyEncodedChunk(input: EncodedVideoChunk): EncodedVideoChunk {
  if (input.codec !== 'h264' && input.codec !== 'vp8') throw new MediaFrameError('invalid_frame', 'Unsupported codec.');
  if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0 || input.data.byteLength > LIMITS.maxFrameBytes)
    throw new MediaFrameError('frame_too_large', 'Encoded chunk must be 1 byte to 8 MiB.');
  if (typeof input.timestampUs !== 'bigint' || input.timestampUs < 0n) throw new MediaFrameError('invalid_frame', 'timestampUs must be a non-negative bigint.');
  return Object.freeze({ codec: input.codec, keyFrame: input.keyFrame === true, timestampUs: input.timestampUs, data: input.data.slice() });
}
