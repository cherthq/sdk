/**
 * Optional LiveKit adapter. Feeds ChertVideoSource frames into a `@livekit/rtc-node` VideoSource
 * that the caller created and published. The SDK has no LiveKit dependency: pass the module in.
 */
import type { MediaTransport } from './source';
import type { PixelFormat, Rotation, VideoFrame, VideoFrameInit } from './frames';

/** Structural subset of `@livekit/rtc-node` used by the adapter. */
export interface LiveKitRtcModule {
  VideoFrame: new (data: Uint8Array, width: number, height: number, type: number) => unknown;
  VideoBufferType: { RGBA: number; BGRA: number; I420: number; NV12: number };
  VideoRotation: { VIDEO_ROTATION_0: number; VIDEO_ROTATION_90: number; VIDEO_ROTATION_180: number; VIDEO_ROTATION_270: number };
}
export interface LiveKitVideoSourceLike { captureFrame(frame: unknown, timestampUs?: bigint, rotation?: number): void }

/** Repacks strided planes into the tightly packed layout LiveKit buffers expect. */
function packed(frame: VideoFrame): Uint8Array {
  const { width: w, height: h } = frame;
  const rows: Record<PixelFormat, [number, number][]> = {
    rgba: [[w * 4, h]], bgra: [[w * 4, h]], i420: [[w, h], [w / 2, h / 2], [w / 2, h / 2]], nv12: [[w, h], [w, h / 2]],
  };
  const layout = rows[frame.format];
  const out = new Uint8Array(layout.reduce((n, [r, c]) => n + r * c, 0));
  let offset = 0;
  layout.forEach(([rowBytes, count], i) => {
    const { data, stride } = frame.planes[i]!;
    if (stride === rowBytes) { out.set(data.subarray(0, rowBytes * count), offset); offset += rowBytes * count; return; }
    for (let y = 0; y < count; y++) { out.set(data.subarray(y * stride, y * stride + rowBytes), offset); offset += rowBytes; }
  });
  return out;
}

export function liveKitVideoTransport(rtc: LiveKitRtcModule, source: LiveKitVideoSourceLike): MediaTransport {
  const types: Record<PixelFormat, number> = { rgba: rtc.VideoBufferType.RGBA, bgra: rtc.VideoBufferType.BGRA, i420: rtc.VideoBufferType.I420, nv12: rtc.VideoBufferType.NV12 };
  const rotations: Record<Rotation, number> = { 0: rtc.VideoRotation.VIDEO_ROTATION_0, 90: rtc.VideoRotation.VIDEO_ROTATION_90,
    180: rtc.VideoRotation.VIDEO_ROTATION_180, 270: rtc.VideoRotation.VIDEO_ROTATION_270 };
  return {
    kind: 'livekit', accepts: ['video'],
    async connect() { /* The caller owns room connection and track publication. */ },
    async send(item) {
      if (item.kind !== 'video') return;
      const f = item.frame;
      source.captureFrame(new rtc.VideoFrame(packed(f), f.width, f.height, types[f.format]), f.timestampUs, rotations[f.rotation]);
    },
    async close() { /* The caller owns track unpublication and room disconnect. */ },
  };
}

/** Structural subset of an `@livekit/rtc-node` VideoFrame. */
export interface LiveKitVideoFrameLike {
  data: Uint8Array; width: number; height: number; type: number;
  convert?(type: number): LiveKitVideoFrameLike;
}
/** Structural subset of `@livekit/rtc-node` VideoStream events. */
export interface LiveKitVideoFrameEvent { frame: LiveKitVideoFrameLike; timestampUs: bigint; rotation: number }

/**
 * Turns a subscribed LiveKit track into SDK frames, so a customer's LiveKit video can be the `camera` base of a call
 * video composition: `for await (const f of liveKitTrackFrames(rtc, new rtc.VideoStream(track))) source.pushFrame(f)`.
 * Chert never joins the customer's room. Frames in other buffer types are converted to I420 when the frame allows it.
 */
export async function* liveKitTrackFrames(rtc: LiveKitRtcModule, stream: AsyncIterable<LiveKitVideoFrameEvent>): AsyncGenerator<VideoFrameInit> {
  const formats = new Map<number, PixelFormat>([[rtc.VideoBufferType.RGBA, 'rgba'], [rtc.VideoBufferType.BGRA, 'bgra'],
    [rtc.VideoBufferType.I420, 'i420'], [rtc.VideoBufferType.NV12, 'nv12']]);
  const rotations = new Map<number, Rotation>([[rtc.VideoRotation.VIDEO_ROTATION_0, 0], [rtc.VideoRotation.VIDEO_ROTATION_90, 90],
    [rtc.VideoRotation.VIDEO_ROTATION_180, 180], [rtc.VideoRotation.VIDEO_ROTATION_270, 270]]);
  for await (const event of stream) {
    let frame = event.frame;
    if (!formats.has(frame.type)) {
      if (!frame.convert) throw new TypeError('Unsupported LiveKit buffer type.');
      frame = frame.convert(rtc.VideoBufferType.I420);
    }
    const format = formats.get(frame.type);
    if (!format) throw new TypeError('Unsupported LiveKit buffer type.');
    const { width: w, height: h, data } = frame;
    // LiveKit buffers are tightly packed; split them into planes with exact strides.
    const layout: [number, number][] = format === 'i420' ? [[w, h], [w / 2, h / 2], [w / 2, h / 2]]
      : format === 'nv12' ? [[w, h], [w, h / 2]] : [[w * 4, h]];
    let offset = 0;
    const planes = layout.map(([stride, rows]) => { const plane = { data: data.subarray(offset, offset + stride * rows), stride }; offset += stride * rows; return plane; });
    yield { format, width: w, height: h, planes, timestampUs: event.timestampUs, rotation: rotations.get(event.rotation) ?? 0 };
  }
}
