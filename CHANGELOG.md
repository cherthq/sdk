# Changelog

## 0.3.0

`@trychert/sdk` 0.3.0 (npm). Python source is versioned 0.3.0, but this release
does **not** publish it: `chert-sdk` remains 0.2.3 on PyPI.

- **Inspect FaceTime error codes without retaining server messages.** JavaScript
  `ChertApiError.serverCode` exposes recognized codes, maps unrecognized or
  malformed codes to `unknown`, and is `undefined` when no code is provided.
  The existing `code` and default error text remain unchanged. Raw server
  messages and response bodies are not retained in the error.
- **Add public resource helpers.** JavaScript adds project discovery,
  integration metadata and recorded call transcripts, plus chat creation,
  recorded chat history and message status. Chat creation requires a stable
  idempotency key; replay outcomes must be reconciled rather than treated as
  delivery receipts. Project discovery uses a signed-in user bearer.
- **Add Better Auth phone transport alongside email.** The optional server-only
  `@trychert/sdk/better-auth` subpath sends phone verification messages through
  Chert. Better Auth owns code storage, verification and expiry. This transport
  does not guarantee iMessage-only delivery or prevent SMS fallback. Codes can
  remain in the recipient's message history after they expire.
- **Add direct-media request fields.** Customer-managed calls can describe
  `media_transport: "direct"`, `media_url`, `media_token` and an optional remote
  participant identity. Existing LiveKit request bodies are unchanged. These
  fields do not establish hosted service availability or media interoperability.
- **Preserve deployment URLs and replay details.** Integration helpers retain
  inherited host configuration and recorded chat replay outcomes. Setup guides
  distinguish package availability from service support.

Other language clients remain source previews, not new registry releases.
Custom video, living services, screen sharing, call video composition and
terminal billing retain their documented service-availability limits.

## 0.2.3

See the [0.2.3 release notes](https://github.com/cherthq/sdk/releases/tag/v0.2.3)
for the npm and PyPI release, including the text-send route correction and
unchanged limits on unavailable services.
