/**
 * Publish custom video into an active FaceTime call over WHIP, with no LiveKit dependency.
 * Runs in browsers (native RTCPeerConnection). In Node, pass any spec-compliant RTCPeerConnection
 * implementation and a MediaTransport that feeds its video track.
 */
import { ChertControlPlane } from '@cherthq/control-plane';
import { ChertVideoSource, parseMediaCapabilities, publishWhip, type MediaTransport } from '@cherthq/media';

export async function publishCustomVideo(client: ChertControlPlane, callId: string, canvas: HTMLCanvasElement): Promise<() => Promise<void>> {
  // 1. Capabilities are explicit and versioned; never infer them from the generic video flag.
  const capabilities = parseMediaCapabilities((await client.getCall(callId)).media_capabilities);
  const video = capabilities.custom_video;
  if (!video?.transports.includes('whip')) throw new Error('This call does not support custom video over WHIP.');

  // 2. Mint a short-lived, call-scoped publish session. Treat endpoint and token as opaque secrets.
  const grant = await client.createMediaSession(callId, { direction: 'publish', codecs: ['h264', 'vp8'] });
  const width = Math.min(1280, grant.limits.max_width), height = Math.min(720, grant.limits.max_height);
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;

  // 3. A transport turns validated frames into a WebRTC track. Here: draw RGBA into a canvas stream.
  const pc = new RTCPeerConnection({ iceServers: grant.ice_servers });
  const track = canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  pc.addTransceiver(track, { direction: 'sendonly' });
  let signaling: Awaited<ReturnType<typeof publishWhip>> | undefined;
  const transport: MediaTransport = {
    kind: 'browser-canvas', accepts: ['video'],
    async connect(signal) { signaling = await publishWhip(pc, { endpoint: grant.endpoint, token: grant.token, connectBy: grant.connect_by }, { signal }); },
    async send(item) {
      if (item.kind !== 'video' || item.frame.format !== 'rgba') return;
      const { data, stride } = item.frame.planes[0]!;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) pixels.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      track.requestFrame();
    },
    async close() { await signaling?.close(); },
  };

  // 4. Push frames from any renderer. Pushes copy input, never block, and drop the oldest frame when full.
  const source = new ChertVideoSource({ transport, width, height, maxFps: Math.min(30, video.max_fps) });
  source.on('error', error => console.warn('custom video failed:', error.code));
  await source.start();
  const rgba = new Uint8Array(width * height * 4);
  const started = performance.now();
  const timer = setInterval(() => {
    const t = performance.now() - started;
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = (t / 10) & 255; rgba[i + 1] = 64; rgba[i + 2] = 160; rgba[i + 3] = 255; }
    source.pushFrame({ format: 'rgba', width, height, timestampUs: BigInt(Math.round(t * 1000)), planes: [{ data: rgba, stride: width * 4 }] });
  }, 1000 / 30);
  return async () => { clearInterval(timer); await source.stop(); };
}
