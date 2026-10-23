// Greet the caller once, when FaceTime is ready.
//
// When the Chert Mac reports bridge_ready for the call, chert dev sets the room's metadata to
// {"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"}. The Mac ends a call whose agent sends
// no audible audio within 10 seconds of bridge_ready (remote_audio_timeout), so the agent greets then.
// Participant arrival is not enough: FaceTime may still be connecting. Without the signal there is no
// greeting, and the caller speaks first.

// RoomEvent.RoomMetadataChanged in @livekit/rtc-node. The room's metadata is already updated when it fires.
const METADATA_CHANGED = 'roomMetadataChanged';

/**
 * True when the room metadata carries chert dev's bridge_ready signal.
 * @param {string | undefined} metadata
 */
export function bridgeReady(metadata) {
  try { return JSON.parse(metadata || '{}')?.chert_bridge_ready === true; } catch { return false; }
}

/**
 * Calls greet() once: at once if the signal is already in the room, otherwise when it arrives.
 * Returns a function that stops waiting.
 * @param {{ metadata?: string, on(event: string, listener: () => void): unknown, off(event: string, listener: () => void): unknown }} room
 * @param {() => unknown} greet
 * @returns {() => void}
 */
export function greetOnBridgeReady(room, greet) {
  let done = false;
  const stop = () => { done = true; room.off(METADATA_CHANGED, check); };
  function check() {
    if (done || !bridgeReady(room.metadata)) return;
    stop();
    try { greet(); } catch { /* the call ended first */ }
  }
  room.on(METADATA_CHANGED, check);
  check();
  return stop;
}
