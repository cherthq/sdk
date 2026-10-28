/**
 * Optional LiveKit adapter. Feeds ChertVideoSource frames into a `@livekit/rtc-node` VideoSource
 * that the caller created and published. The SDK has no LiveKit dependency: pass the module in.
 */
import type { MediaTransport } from './source';
import type { PixelFormat, Rotation, VideoFrame } from './frames';

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
