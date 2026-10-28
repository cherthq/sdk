/**
 * Screen sharing in a FaceTime call, using the same media sessions as custom video.
 * Browser example: an agent's page streams a canvas it renders (its "screen"), exposed to the model as
 * two tools, and it can watch the caller's shared screen while the caller is sharing.
 */
import { ChertControlPlane } from '@cherthq/control-plane';
import { MediaError, parseMediaCapabilities, publishWhip, receiveWhep, SCREEN_SHARE_TOOLS, ScreenShareController, startScreenStream,
  type MediaTransport } from '@cherthq/media';

export function screenShareTools(client: ChertControlPlane, callId: string, screen: HTMLCanvasElement) {
  const controller = new ScreenShareController(async () => {
    const stream = await startScreenStream(client, callId, {
      width: screen.width, height: screen.height,
      createTransport(grant) {
        const pc = new RTCPeerConnection({ iceServers: grant.ice_servers });
        const track = screen.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        track.contentHint = 'detail'; // Keep text sharp rather than motion smooth.
        pc.addTransceiver(track, { direction: 'sendonly' });
        let signaling: Awaited<ReturnType<typeof publishWhip>> | undefined;
        const transport: MediaTransport = {
          kind: 'browser-canvas-screen', accepts: ['video'],
          async connect(signal) {
            try { signaling = await publishWhip(pc, { endpoint: grant.endpoint, token: grant.token, connectBy: grant.connect_by }, { signal }); }
            catch (error) { pc.close(); track.stop(); throw error; }
          },
          // The canvas is already the screen: each accepted frame just asks the track for a new picture.
          async send() { track.requestFrame(); },
          async close() { await signaling?.close(); pc.close(); track.stop(); }, // WHIP DELETE frees the call's publish slot.
        };
        return transport;
      },
    });
    // Tick the source at up to the granted fps (15 at most); the frame body is unused by this transport.
    const pixels = new Uint8Array(screen.width * screen.height * 4), started = performance.now();
    const timer = setInterval(() => {
      if (stream.source.state !== 'live') return clearInterval(timer);
      stream.source.pushFrame({ format: 'rgba', width: screen.width, height: screen.height,
        timestampUs: BigInt(Math.round((performance.now() - started) * 1000)), planes: [{ data: pixels, stride: screen.width * 4 }] });
    }, 1000 / 15);
    return { source: stream.source, stop: async () => { clearInterval(timer); await stream.stop(); } };
  });
  // Register SCREEN_SHARE_TOOLS with your agent framework and route its calls here.
  return { tools: SCREEN_SHARE_TOOLS, run: (name: string, input?: unknown) => controller.handleTool(name, input) };
}

/** Receives the caller's shared screen as its own track. Call after a `caller_screen_share_started` event. */
export async function watchCallerScreen(client: ChertControlPlane, callId: string, video: HTMLVideoElement): Promise<(() => Promise<void>) | null> {
  const inbound = parseMediaCapabilities((await client.getCall(callId)).media_capabilities).inbound_caller_video;
  if (!inbound?.transports.includes('whep') || !inbound.contents.includes('screen')) return null;
  let grant;
  try { grant = await client.createMediaSession(callId, { direction: 'subscribe', content: 'caller_screen' }); }
  catch (error) { if ((error as { code?: string }).code === 'caller_screen_not_shared') return null; throw error; }
  const pc = new RTCPeerConnection({ iceServers: grant.ice_servers });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addEventListener('track', event => { video.srcObject = new MediaStream([event.track]); });
  try {
    const session = await receiveWhep(pc, { endpoint: grant.endpoint, token: grant.token, connectBy: grant.connect_by });
    return () => session.close();
  } catch (error) {
    pc.close();
    if (error instanceof MediaError && error.code === 'caller_screen_not_shared') return null;
    throw error;
  }
}
