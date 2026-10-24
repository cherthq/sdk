# FaceTime integration

The [FaceTime HTTP client](../packages/control-plane/README.md) exposes the
documented control-plane methods. It is separate from iMessage and requires its
own credentials and project authorization. A login does not grant every API
permission; consult the method documentation.

The SDK is not a media transport. Call allocation or an accepted action does not
establish connection, audio or video delivery. Use only supported service features
and obtain recipient consent before calling. Never log tokens or room credentials.
