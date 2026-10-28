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
