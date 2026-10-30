# FaceTime integration

The [FaceTime HTTP client](../packages/control-plane/README.md) exposes the
documented control-plane methods. It is separate from iMessage and requires its
own credentials and project authorization. A login does not grant every API
permission; consult the method documentation.

The SDK is not a media transport. Call allocation or an accepted action does not
establish connection, audio or video delivery. Use only supported service features
and obtain recipient consent before calling. Never log tokens or room credentials.

## Voice and video

FaceTime calls can carry both; a call can also be audio-only. Calls have `media: { audio, video }`, lines report
`supports_audio` and `supports_video`, and call events include
`remote_video_ready`, `remote_video_unavailable` and `caller_video_published`.
Managed calls can request video, and assistants can present video
(`video.mode`: `test_pattern` or `avatar`). A customer-managed LiveKit agent
needs a FaceTime Video call and a camera track from the speaking agent to show
video. Requesting video is not proof of video: check `supports_video`
and the call's `media_status`. See the [setup guide](SETUP.md#voice-and-video).

## Direct audio transport

Not available yet: the SDKs can send it, but the hosted backend does not accept
it. A customer-managed call can skip LiveKit and move raw call audio over one
WebSocket to your server. Send `media_transport: "direct"`, `media_url` and
`media_token` instead of `livekit_url` and `participant_token`;
`remote_participant_identity` is an optional diagnostics label. Omitting
`media_transport` or sending `media_transport: "livekit"` keeps LiveKit;
managed calls must omit it.

| Field | Rule |
| --- | --- |
| `media_url` | `wss://` (`ws://` only for `localhost`, `127.0.0.1`, `[::1]`), at most 2048 bytes of printable ASCII (`0x21`–`0x7E`, no spaces), no userinfo or fragment. Scheme and host compare case-insensitively |
| `media_token` | Opaque bearer, 16–4096 bytes of printable ASCII (`0x21`–`0x7E`) |
| `remote_participant_identity` | Optional for direct, required for LiveKit; at most 240 UTF-8 bytes after trimming, not blank |
| `media.audio` | Must be `true`. Video still uses the existing video paths; direct carries audio only |

Mixing LiveKit and direct fields is rejected. The worker connects to `media_url`
with `Authorization: Bearer <media_token>` and subprotocol `chert-audio.v1`; your
server must select that subprotocol. The worker sends a `hello` text frame
(`{"type":"hello","v":1,"call_id","direction","format":"s16le","sample_rate":48000,"channels":1,"frame_ms":20}`)
and waits up to 10 s for `{"type":"ready"}`. Then both sides exchange binary
frames of exactly 1920 bytes (20 ms mono s16le at 48 kHz): worker to server is
the FaceTime party's audio, server to worker is what they hear. Wrong-size
frames are dropped. Ping at least every 10 s; the worker closes after 30 s
without a frame or ping. Either side ends with `{"type":"end","reason"}` and
close code 1000, which ends the call. Never echo a caller's own audio back.
Treat `media_token` like a room token: call-scoped, never logged.
