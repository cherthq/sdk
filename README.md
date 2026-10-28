# Chert SDKs

Open-source clients for Chert messaging and FaceTime control-plane services.
This repository contains JavaScript/TypeScript, Python, Rust, C#/.NET, C++ and Go
clients. **Language coverage and release status differ:** JavaScript is published;
the other clients are source previews, with unified channel support under review.

**New here? Start with the [setup guide](docs/SETUP.md).** Coding agents can read
[`llms.txt`](llms.txt) or run `chert-sdk context`.

## Languages and release status

| Language | Available on `main` | Release / unified-channel work | Documentation |
| --- | --- | --- | --- |
| JavaScript / TypeScript | iMessage, FaceTime control plane, provider adapters, CLI | This guide targets `@trychert/sdk@0.2.2`; see [npm](https://www.npmjs.com/package/@trychert/sdk) for available versions. Binary: `chert-sdk` | [Quickstart below](#javascript--typescript) |
| Python 3.10+ | iMessage and FaceTime control plane (`trychert`); legacy `chert` imports retained | [`chert-sdk` 0.2.2 on PyPI](https://pypi.org/project/chert-sdk/0.2.2/): `pip install chert-sdk==0.2.2` | [Python guide](python/README.md) |
| Rust 1.88+ | Async iMessage and FaceTime clients (`trychert_sdk`) | Unpublished `chert-sdk`; source preview only | [Rust guide](rust/README.md) |
| C# / .NET 8 | iMessage and FaceTime HTTP clients (`TryChert`) | Unpublished `chert-sdk` NuGet package; source preview only | [.NET guide](dotnet/README.md) |
| C++20 | iMessage and FaceTime HTTP clients (`trychert`, CMake `trychert::trychert`) | Unpublished `chert-sdk` archives; no C++ registry release | [C++ guide](cpp/README.md) |
| Go 1.23+ | Standard-library iMessage and FaceTime clients (`chert`) | Source preview on `main`; no tagged release | [Go guide](go/README.md) |

Only `@trychert/sdk` (npm) and `chert-sdk` (PyPI) are published. Other
package names describe proposed distributions, not packages available from
crates.io, NuGet or a C++ package registry. Follow the language guide to
build/test source; do not substitute a similarly named registry package.

## Channels and credentials

- **iMessage** clients use a Chert API key and optional messaging tenant.
  JavaScript defaults to `https://console.trychert.com` with an optional service
  URL override. A queued receipt does not mean sent, delivered or read.
- **FaceTime control-plane** coverage differs by language. The JavaScript 0.1.0
  client inspects identity, assigned lines, workers, credentials and connectors;
  it is not an outbound-call API. JavaScript 0.2.x and the native source previews
  include typed calls and related resources as documented in their language guides.
  None is a media runtime. Route availability and permissions depend on the backend.
- Legacy channel credentials are **separate**. The SDK does not prove that an iMessage
  key belongs to a FaceTime project, map tenants to projects, or convert provider
  credentials. In the JavaScript wrapper, `projectId` is sent to FaceTime only;
  it is application context, not an authorization check, for iMessage.
- Keep secrets outside source control. Explicit login/enrollment responses may
  contain credentials; do not log them. Constructors do not contact services.
  Use only authorized recipients and reconcile uncertain outcomes before retrying.

## JavaScript / TypeScript

The examples below target **`@trychert/sdk@0.2.2`**. The
[npm package page](https://www.npmjs.com/package/@trychert/sdk) lists available
versions. Package availability does not establish live backend support.

```sh
npm install @trychert/sdk@0.2.2
# Alternatives:
pnpm add @trychert/sdk@0.2.2
bun add @trychert/sdk@0.2.2

npx --package=@trychert/sdk@0.2.2 chert-sdk --help
bunx --package @trychert/sdk@0.2.2 chert-sdk --help
```

ESM and declarations are shipped for Node 22.12+, current Bun and Deno 2 with
npm compatibility. Deno imports use `npm:@trychert/sdk@0.2.2` (append subpaths
after the version). CommonJS `require()` is not a supported migration target.
The npm package is `@trychert/sdk`; the CLI binary remains `chert-sdk`.

```ts
import { ChertSDK } from '@trychert/sdk';

const sdk = new ChertSDK({
  projectId: process.env.CHERT_PROJECT_ID!,
  imessage: {
    apiKey: process.env.CHERT_API_KEY!,
  },
  facetime: {
    token: process.env.CHERT_FACETIME_TOKEN!,
  },
});
const lines = await sdk.facetime.listLines(); // Existing assignments; no provisioning.
// Only send with recipient consent:
// await sdk.imessage.sendText({ phone: '+15555550123', body: 'Hello' });
```

The default export remains the iMessage `ChertClient`. Explicit subpaths include
`imessage`, `facetime`, `control-plane`, `adopt`, and each provider adapter:
`linq`, `sendblue`, `blooio`, `blooio-v4`, `loopmessage`, `missblue`,
`texting-blue`, `contiguity`, `bluereacher`, `jared` (append `-adapter`).

```ts
import ChertClient from '@trychert/sdk';
import { ChertControlPlane } from '@trychert/sdk/facetime';
import Sendblue from '@trychert/sdk/sendblue-adapter';
```

### Unified session preview

The new backend contract supports one approved session and project across both
services. This is **source-preview functionality, not a deployed availability
claim**. Obtain the session from the unified onboarding flow; an existing
FaceTime CLI credential or messaging key cannot be relabeled as a unified token.

```ts
const sdk = await ChertSDK.connect({
  accessToken: approvedSession.access_token,
  projectId: approvedSession.project.id,
});
const events = await sdk.imessage.listEvents({limit: 20});
const calls = await sdk.facetime.listCalls();
```

`connect` validates a `chu_` session and project UUID, then reads the messaging
service's unauthenticated `/api/v1/sdk/capabilities` descriptor **before sending
the token**. It requires `chert-unified` version 1, the expected Bearer audience
and service URLs, and the required scope vocabulary. Every subsequent request
sends `X-Chert-Contract: chert-unified-v1` and requires that exact response echo.
Old backends, malformed descriptors and missing version echoes fail closed;
there is no legacy fallback, token conversion or automatic login/refresh.

Optional `imessageBaseURL` and `facetimeBaseURL` are explicitly trusted HTTPS
origins (loopback HTTP for tests), not arbitrary URLs advertised by a server.
The descriptor must match them exactly. Do not choose these overrides from
untrusted content. Scope enforcement and project membership remain server-side;
discovery does not prove the supplied session has permission for an operation.
Call creation, call control, message send, events and webhook management have
separate permissions. BYOR still uses separate customer LiveKit credentials.

The existing `new ChertSDK({projectId,imessage,facetime})` constructor and
standalone clients retain their explicit, separate-credential behavior.

Channel commands require `CHERT_PROJECT_ID` as application context and only their
own channel credentials. Help, `context` and `adopt` need neither. iMessage uses `CHERT_API_KEY`
and optional `CHERT_TENANT`, defaulting to `https://console.trychert.com`.
`CHERT_BASE_URL` optionally overrides it: root origins get `/api/v1`, while
explicit deployment prefixes (including `/api/v1`) are preserved without duplication.
FaceTime uses `CHERT_FACETIME_TOKEN` and defaults to
`https://facetime.trychert.com`. `CHERT_FACETIME_URL` is an optional origin-only
override; `/api/v1` is composed once by the client.

Defaults apply only when a URL option is omitted/undefined. Explicit empty or
null values are invalid, not a request to fall back to production. No host
fallback or request retries are added. Event-stream reconnection is explicit
and uses only the continuation returned by the server.

**Backend verification required:** verify feature availability for your project
before production use. Default-origin reaction support is not yet verified.
No endpoint fallback or automatic retries are performed; a queued receipt is
not proof of delivery. Package publication and backend availability are separate.

Billing uses a signed-in user session and project UUID. Only the terminal-billing
draft below also accepts a CLI credential with the `billing` scope (owner/admin).
Use `billingStatus()` to inspect entitlement and availability. Refusals keep their code,
for example `billing_sales_disabled`, `billing_subscription_exists`,
`billing_dedicated_no_inventory` or `shared_no_capacity`. The 0.2.0 preview
removes the obsolete catalog and checkout-row APIs; see the
[billing migration guide](https://github.com/cherthq/sdk/blob/main/packages/control-plane/BACKEND_COVERAGE.md#preview-migration).

**Terminal billing (draft, unreleased; the backend does not serve it yet).**
`purchase({ plan }, key)` and `changePlan({ plan }, key)` charge the saved card;
`paymentMethodSetup(key)` returns `{ status: 'requires_payment_method', url }` for
adding or replacing it. Purchases and plan changes return `{ status: 'active',
entitlement }`, `{ status: 'pending' }` (the payment was accepted but the
entitlement is not committed yet: retry with the same idempotency key), or
`{ status: 'requires_payment_method' | 'requires_action', url }`, where `url` is a
Stripe-hosted page for card entry or authentication: card details are never
entered in the terminal. The CLI equivalents are
`chert-sdk billing status | card | buy --plan P | switch --plan P | cancel`;
mutations need `--idempotency-key` and `--confirm`. The CLI credential needs the
`billing` scope and an owner/admin role. Dedicated purchases stay unavailable
(`billing_dedicated_unqualified`) until dedicated fulfilment is enabled.

```sh
bunx --package @trychert/sdk@0.2.2 chert-sdk context
bunx --package @trychert/sdk@0.2.2 chert-sdk facetime status
bunx --package @trychert/sdk@0.2.2 chert-sdk facetime lines
bunx --package @trychert/sdk@0.2.2 chert-sdk facetime workers
bunx --package @trychert/sdk@0.2.2 chert-sdk adopt ./my-app          # Dry-run migration report
bunx --package @trychert/sdk@0.2.2 chert-sdk adopt ./my-app --write  # Applies supported rewrites
```

`context` prints JSON with the SDK version, which credentials are set (never
their values), your FaceTime identity and lines when `CHERT_FACETIME_TOKEN` and
`CHERT_PROJECT_ID` are set, and docs links. It needs no variables; `--offline`
skips every request. The `facetime` commands only inspect access. To sign in
from a terminal and put a LiveKit voice or video agent on a FaceTime line, use
the separate `chert` CLI from
[`@trychert/facetime`](https://www.npmjs.com/package/@trychert/facetime).

`adopt --install` additionally uses the target project's package manager.
Replace legacy `@cherthq/sdk` imports with `@trychert/sdk` and
`@cherthq/<adapter>` with `@trychert/sdk/<adapter>`. Bare legacy package names do
not resolve from this archive. Provider call shapes and refusal boundaries are
preserved. `chert-adopt` becomes `chert-sdk adopt`.

### Upgrading from `@trychert/sdk@0.1.0`

The published scoped package remains available and is not unpublished or
deprecated by this change. Existing installs and imports keep working without
migration. To upgrade, update the dependency to `@trychert/sdk@0.2.2`
(published, `latest`), regenerate your consumer lockfile and rerun tests.
No import rename is needed: root imports stay `@trychert/sdk` and subpaths
stay `@trychert/sdk/<subpath>`.

### Migrating from accidental unscoped `chert-sdk@0.1.0`

The canonical npm package is `@trychert/sdk`, not `chert-sdk`. If you installed
the accidental unscoped 0.1.0 package (since unpublished from npm), remove that
dependency and install `@trychert/sdk@0.2.2`. Change root imports
from `chert-sdk` to `@trychert/sdk` and preserve subpath suffixes (for example,
`chert-sdk/facetime` becomes `@trychert/sdk/facetime`). Regenerate your consumer
lockfile and rerun tests. The identity correction does not change the default
export, named exports, provider contracts or `chert-sdk` CLI binary. The scoped
archive does not alias unscoped imports. `adopt` migrates supported provider
usage; do not rely on it to rename existing SDK imports. This documentation
does not deprecate any registry package; registry actions require separate approval.

The published CLI commands are `imessage send`, `facetime status|lines|workers`,
`adopt` and `context`. Since 0.2.1, unknown commands and subcommands exit with
`unknown_command` before any credential lookup. Published 0.1.0, 0.2.0, 0.2.1 and 0.2.2
do not include `login`, `onboard`, `new`, `doctor` or `dev`. Browser login and the
agent onboarding CLI live in the separate `chert` CLI from `@trychert/facetime`.

### Custom video sources (source preview, unreleased)

`@trychert/sdk/media` lets you send your own frames into a FaceTime call, and
receive caller video, over standard WebRTC. LiveKit is not required. The core
works without a network connection and has no dependencies: frame validation,
a bounded video source, capability parsing and WHIP/WHEP signaling.

Until the hosted backend serves these routes, the control-plane calls for
custom video, living services, screen sharing and call video composition fail
with `ChertApiError` status 404, code `endpoint_unavailable`, and
`startScreenStream` fails with `capability_missing`. Check capabilities first.

- **Capabilities are explicit.** Read `media_capabilities` from a line, call or
  worker returned for that line or call, and parse it with
  `parseMediaCapabilities`. A missing field or unknown version means
  unsupported. The SDK never infers support from `supports_video` or `media.video`.
- **Sessions.** `client.createMediaSession(callId, { direction, codecs })` mints
  a short-lived session for one call. `publish` returns a WHIP
  ([RFC 9725](https://www.rfc-editor.org/rfc/rfc9725)) endpoint. `subscribe`
  returns an experimental WHEP
  ([draft-ietf-wish-whep-05](https://datatracker.ietf.org/doc/draft-ietf-wish-whep/05/))
  endpoint. Treat `endpoint` and `token` as opaque secrets.
- **One publish slot per call.** Custom camera video, a living surface, a
  screen share and a call video composition are mutually exclusive. Requesting a second publish while one is
  active returns `media_session_conflict`.
- **Signaling.** `publishWhip`/`receiveWhep` take any spec-compliant
  `RTCPeerConnection` (the browser's built-in one, or a Node/Bun/Deno WebRTC
  library). They send the same bearer token on `POST`, and on `PATCH`
  (trickle ICE, `restartIce`) and `DELETE` to the returned session URL.
- **Frames.** Supported formats are `i420`, `nv12`, `rgba` and `bgra`, with an
  explicit stride per plane. Width and height must be even, from 16 up to
  1920×1080. Frames are limited to 30 fps and 8 MiB, with microsecond
  timestamps that must strictly increase. Frames carry rotation and color-space
  metadata.
- **Pushing frames.** `pushFrame` copies its input, so you can reuse your buffer
  right away. It never blocks: when the queue (2 frames by default) is full, the
  oldest frame is dropped. Encoded H.264/VP8 chunks can be pushed with
  `pushEncoded`. After a chunk is lost, frames are dropped until the next
  keyframe and a `keyframe-request` event is emitted.
- **Lifecycle.** `idle → starting → live → stopping → stopped`, or `failed`.
  Errors carry stable codes (`session_expired`, `session_conflict`,
  `call_not_active`, `call_ended`, `capability_missing`, …) and never include
  tokens, URLs, SDP or media bytes.

- **LiveKit stays optional.** If you already use LiveKit,
  `@trychert/sdk/media/livekit` exports `liveKitVideoTransport(rtc, videoSource)`.
  It feeds the same source into a `@livekit/rtc-node` `VideoSource` that you
  create and publish yourself. The SDK has no LiveKit dependency: you pass the
  module in.

See [`packages/media/examples/publish-whip.ts`](packages/media/examples/publish-whip.ts).
Limitations: v1 is video only (audio stays on the existing call paths), and the
SDK does not include a video encoder for Node. Remote keyframe requests are not
guaranteed to arrive, and the SDK does not promise any bitrate. Caller video is
capped at 1280×720 and 30 fps. These APIs require a backend that reports these
capabilities. The code ships in 0.2.2, but the hosted backend does not serve
these routes yet: calls fail with `404 endpoint_unavailable`.

### Living services (draft, unreleased)

A living service is a web page you host, which Chert renders as the call's video.
Voice keeps working on the existing call path, and your backend updates the page
through the API. Everything the page renders is visible to the caller.

**Server side** (`@trychert/sdk/facetime`):
- `parseLivingServices(call.living_services)` checks the explicit, versioned
  capability. A missing field, unknown version or `supported: false` means
  unavailable. It is never inferred from custom video.
- `createLivingService({ name, entry_url, entry_digest?, viewport, fps, input? }, idempotencyKey)` /
  `deployLivingService` create immutable revisions. `entry_url` must be HTTPS with
  no credentials or fragment, and must serve fixed content for each revision.
  Viewport sizes are even, up to 1920×1080; fps is 1–30. `input` is any of
  `pointer`, `keyboard` and `text`.
- `attachLivingService(callId, { deployment_id, initial_state, viewport?, fps? }, idempotencyKey)`
  returns the effective viewport and fps, which are min(requested, manifest, grant limits).
  A living surface uses the call's single publish slot, shared with custom camera
  video and screen sharing. If another publish is active on that call, attach fails
  with `living_surface_conflict`. While a surface is attached,
  `createMediaSession(publish)` fails with `media_session_conflict`.
- `getLivingSession` returns lifecycle and health: `starting | ready | live |
  stopping | stopped | failed`, plus a sanitized `error_code`.
- `setLivingState` takes revisions that must strictly increase (stale:
  `living_state_conflict`; 64 KiB JSON). `sendLivingEvent` takes a named event with
  up to 16 KiB of JSON. `sendLivingInput` relays only declared input kinds, with
  pointer x/y normalized to 0..1. `detachLivingService` removes the page.
- Messages the page sends arrive as a signed, durable `living_service.message`
  webhook (`LivingServiceMessageWebhook`). The call timeline only records payload-free
  lifecycle events (`living_service.ready|failed|stopped`).
  `X-Chert-Signature: sha256=<hex>` is an HMAC-SHA256 of the exact raw body with the
  call's living-service signing secret; `X-Chert-Signature-Version` names which
  secret version signed it. Pick the secret with `livingSignatureVersion(header)`,
  check `await verifyLivingServiceWebhook(rawBody, signatureHeader, secret)` before
  parsing, then de-duplicate on `event_id`. There is no timestamp, and this is not
  the iMessage `v1,<timestamp>,<hex>` format.

**Page side** (`@trychert/sdk/living`, no dependencies, no framework required):
`connectLivingPage({ onStart, onState, onEvent, onCallEvent, onInput, onStop })`
handles the `chert.living.v1` bridge.
- The connect message is accepted only from the page's own window and origin.
- `ready` is sent after `onStart` resolves and must arrive within 15 s.
- Heartbeats are sent every 5 s.
- Stale state revisions are dropped. State that arrives during `onStart` is
  applied right after `ready`.
- `page.send(name, json)` and `page.health('ok' | 'degraded', code)` report back.
- The page never receives project credentials, media grants or service internals.
  Never put secrets in state, events or messages.

`startLivingPreview(frame, { origin, viewport, fps, state })` drives a page locally
through the same bridge, without a call. Examples: a
[framework-neutral HTML page](packages/living/examples/html/index.html), a
[React app](packages/living/examples/react/App.tsx), and a
[developer backend](packages/living/examples/server.ts).

Limitations: these routes are a draft contract and require a backend that reports
`living_services`. There is no audio from the page, and no uploaded bundles yet.
Input is relayed to the page, not injected as OS events. Not in any published
package version.

### Screen sharing (draft, unreleased)

Screen sharing uses the same media sessions and WHIP/WHEP signaling as custom
video. There is no second transport.

- **Agent screen into the call.** `createMediaSession(callId, { direction:
  'publish', content: 'screen' })` mints a WHIP session whose grant echoes
  `content: 'screen'` and caps `limits.max_fps` at 15. `startScreenStream(client,
  callId, { width, height, createTransport })` checks the capability, mints the
  grant and starts a `ChertVideoSource` at no more than the grant's fps. Give the
  WebRTC track `contentHint = 'detail'`. Stopping sends the WHIP `DELETE`.
- **One publish slot per call.** Camera video, a screen, a living surface and a
  call video composition are mutually exclusive. A second active publish fails with `media_session_conflict`
  (`session_conflict` from signaling).
- **Agent tools.** `SCREEN_SHARE_TOOLS` defines `share_screen` and
  `stop_screen_share` with JSON Schema parameters, usable as MCP `inputSchema` or
  a function tool. `new ScreenShareController(() => startScreenStream(...))`
  runs them: one stream at a time, repeated starts reuse it, stop is idempotent,
  and results carry only stable codes.
- **Caller's shared screen as context.** `createMediaSession(callId, { direction:
  'subscribe', content: 'caller_screen' })` returns a WHEP session for the
  caller's shared screen as its own track, never composited into caller video.
  It is issued only while the caller is sharing; otherwise it fails with
  `409 caller_screen_not_shared`.
- **Capabilities.** `custom_video.contents` lists `screen` when an agent may
  stream a screen; `inbound_caller_video.contents` lists `screen` when the
  caller's shared screen is available as a separate track. Absent means camera
  only. A line whose FaceTime source cannot provide a separate screen track does
  not advertise it.
- **Denials.** Minting fails with `409 media_content_unsupported` when the line
  does not advertise the requested content, `409 caller_screen_unsupported` when
  the caller's screen is not available as a separate track, and
  `422 media_limit_exceeded` when the backend rejects the session against the
  line's media limits.
- **Events and consent.** Call events `agent_screen_started`,
  `agent_screen_stopped`, `caller_screen_share_started`,
  `caller_screen_share_ended`, `screen_control_granted` and
  `screen_control_revoked` carry no payload. `call.screen_control` (`none`,
  `requested`, `granted`) is read-only consent state. The public API has no
  screen-control operations.

See [`packages/media/examples/screen-share.ts`](packages/media/examples/screen-share.ts).

### Call video composition (draft, unreleased)

Not in any published package version, and not served by the backend yet. The
call's video can be a page, or a page layered over live video, composed
server-side into the one track the caller sees.

```ts
// The call video is this page. The SDK deploys the URL, waits for it to be ready,
// then sets the call video to that immutable deployment.
await client.setCallVideo(callId, { page: 'https://agent.example/live.html' }, 'video-1-call-7');

// Captions over the agent's camera.
const video = await client.setCallVideo(callId, { layers: [
  { id: 'base', source: { kind: 'camera' } },
  { id: 'captions', z: 1, page: { deployment_id }, region: { x: 0, y: 0.75, width: 1, height: 0.25 },
    background: 'transparent', opacity: 0.9, input: ['pointer'] },
] }, 'video-2-call-7');
// Publish base frames over video.layers[0].publish with ChertVideoSource + WHIP, as for custom video.
```

- **Layers.** v1 allows two: an optional base at z 0 (`camera`, or `managed`
  where `video_composition.bases` lists it) and a page layer at z ≥ 1. Each page
  layer is a living session, so `setLivingState`, `sendLivingEvent` and
  `sendLivingInput` take its `living_session.session_id`. Without a base, the page
  must be opaque, full frame and at opacity 1.
- **Placement and alpha.** `region` is normalized to the output frame.
  `background: 'transparent'` will be blended (premultiplied source-over) with
  `opacity` by the server compositor, and is accepted only where the capability
  reports `page_alpha`.
- **Pages.** The backend only accepts deployment IDs. URL pages are deployed by
  the SDK first (`living_deployment_not_ready` if the deployment fails or is not
  ready within 60 s); to reuse a page across calls, deploy it once.
- **Frame rate.** Output fps is the lowest of the base fps, the grant limit and
  the capability's measured `max_fps`; page layers render at or below it.
- **One publish slot.** A composition occupies the call's single publish slot. Its
  camera grant and page sessions belong to it; standalone camera, living and
  screen sessions conflict with it (`media_session_conflict`,
  `living_surface_conflict`). A live standalone camera session cannot be adopted
  as the base: republish to the composition's grant.
- **LiveKit base.** Chert never joins your LiveKit room. Feed a subscribed track
  through the camera grant with `liveKitTrackFrames(rtc, new rtc.VideoStream(track))`
  from `@trychert/sdk/media/livekit`.
- **Input.** Only agent-relayed input, with pointer coordinates normalized to the
  output frame; `compositionInputTarget(video, x, y)` finds the layer under a point.
  The caller cannot click the page.
- **Capability and errors.** `parseVideoComposition(line.video_composition)`.
  Errors: `video_composition_unsupported`, `composition_invalid`,
  `composition_revision_conflict`, `composition_base_unavailable`. Timeline events
  `call_video.live | updated | failed | stopped` carry no payload.

Contract: [`docs/proposals/CALL_VIDEO_COMPOSITION.md`](docs/proposals/CALL_VIDEO_COMPOSITION.md).

### iMessage events and webhooks (source preview)

The 0.2.0 preview adds `listEvents`, `getEvent`, `streamEvents`, and
`listWebhookSubscriptions`, `getWebhookSubscription`, `createWebhookSubscription`,
`updateWebhookSubscription`, `deleteWebhookSubscription`. These require messaging
tenant credentials; a FaceTime project token or CLI login is not a substitute.
**Console-host availability is not verified.** Do not treat local contract tests
or the presence of these methods as a deployed subscription service.

```ts
import { ChertClient, verifyWebhook } from '@trychert/sdk';
const messages = new ChertClient({apiKey: authorizedMessagingKey});
const page = await messages.listEvents({limit: 50, since: startTimestamp});
// Read older pages with page.next_cursor; do not use it as an SSE cursor.
const stop = new AbortController();
for await (const frame of messages.streamEvents({since: startTimestamp, signal: stop.signal, reconnect: true})) {
  if (frame.event === 'message') await handleRecordedEvent(frame.data);
  if (frame.event === 'error') await handleStreamWarning(frame.data);
  // 'close' carries reconnect_with_since. Persist checkpoints only after handling.
  // Break or stop.abort() closes the connection. Do not log sensitive payloads.
}
```

`listEvents` accepts `type`, `status`, `lead_id`, `since`, `cursor`, and `limit`
(1–200). `status` and returned `delivery` describe **webhook delivery**, not
recipient message delivery. Event-row `id` and producer `event_id` are distinct;
`getEvent` takes the row ID. Payloads and event names remain unmodified, including
unknown future events. Different compatible services use dotted or underscored
event names; do not silently translate one into the other.

SSE uses authenticated fetch, not browser `EventSource` or WebSocket. It emits
`{event,data}` frames: unnamed records become `message`, while named `error` and
`close` frames are preserved. Comments/heartbeats are ignored. A frame is limited
to 1 MiB. Without `since`, the server normally starts at connection time.
`reconnect: true` waits one second and reconnects only after a server close frame
supplies `reconnect_with_since`; unexpected EOF, malformed frames and transport
failure stop the iterator. Reconcile with event history before manually resuming.
There is no `Last-Event-ID`, automatic resend, exactly-once delivery or lossless
replay guarantee. Continuations are opaque: some services use timestamps and
others composite cursors. Timestamp-only services can omit ties at batch boundaries.
Deduplicate persisted row IDs, reject self-generated events, validate sender and
conversation ownership, and require explicit authorization before replying.

Subscription creation returns a signing `secret` once; subsequent reads omit it.
Persist that secret securely. Do not log creation results. Mutation requests are
never retried. For incoming Chert callbacks, read the exact raw body first:

```ts
const rawBody = await request.text();
if (!await verifyWebhook(rawBody, request.headers.get('x-chert-signature') ?? '', subscriptionSecret)) {
  return new Response('Unauthorized', {status: 401});
}
const event = JSON.parse(rawBody); // Apply schema, deduplication and policy checks next.
```

The verifier accepts Chert `v1,timestamp,hex` HMAC-SHA256 signatures with a
five-minute clock window. It is not Linq's Standard Webhooks verifier and does
not validate payload schemas or prevent replay within that window. Webhook
redelivery is a side effect, not stream catch-up; no portable replay helper is
provided because targeting differs between services.

For a personal-agent app, pass the messaging credential resolved by its authorized
onboarding integration; this library does not mint one from a FaceTime session.
Keep the app's existing project/line and LiveKit configuration. Fail closed if
the integration cannot resolve messaging access. Call-event snapshots are not
media streams: BYOR audio/video uses the customer's LiveKit SDK and separate
customer participant credentials. Chert call responses do not issue managed-room
join tokens. Requesting `media.video` does not prove video availability or receipt.

## Source-preview quickstarts

These examples describe the APIs in this source tree, after following the linked
language guide's local build setup. Apart from Python, they are not registry
installation commands; other draft PRs may propose different unified APIs.

**Python** — `pip install chert-sdk==0.2.2` (or `python/` on the module path for
unreleased source):

```python
import os
from trychert import Chert, IMessageConfig, FaceTimeConfig

sdk = Chert(
    imessage=IMessageConfig(api_key=os.environ['CHERT_API_KEY']),
    facetime=FaceTimeConfig(token=os.environ['CHERT_FACETIME_TOKEN'],
                           project_id=os.environ['CHERT_PROJECT_ID']),
)
# identity = sdk.facetime.whoami()  # Explicit read-only request.
# Either channel can be omitted. Legacy `from chert import ChertClient` still works.
```

Python defaults to `https://console.trychert.com` for iMessage and
`https://facetime.trychert.com` for FaceTime; explicit `base_url` overrides remain
available for tests/self-hosting. **Published 0.2.2 on PyPI:** default origins
and offline tests do not establish live service compatibility. Strict text,
default-origin reactions, and billing availability require separate verification.
No host fallback or automatic retries are performed; publication remains separate.

**Rust** — use Rust 1.88+ and a Tokio runtime with the local `rust/` crate:

```toml
[dependencies]
chert-sdk = { path = "../sdk/rust" }
```

```rust
use trychert_sdk::{ChertSdk, IMessageConfig, FaceTimeConfig};

let sdk = ChertSdk::new(
    Some(IMessageConfig::new("messaging-key")),
    Some(FaceTimeConfig::new("facetime-key", "project-id")),
)?;
```

The distribution is `chert-sdk`; the library import stays `trychert_sdk` for
preview source compatibility. `ChertClient` remains messaging-only; `ChertSdk` accepts independent
`IMessageConfig` and `FaceTimeConfig` values for either or both channels.
FaceTime includes typed calls, events, transcripts, lines, assistants and settings.
Messaging tenant and FaceTime project credentials remain separate; no shared
server binding is inferred. See the [Rust guide](rust/README.md) for the unified
example and API limits. `publish = false` remains enforced: this is not a
crates.io installation command, and call snapshots do not prove connection.

URLs default to `https://console.trychert.com` and `https://facetime.trychert.com`,
with `/api/v1` once. Explicit `base_url` overrides support tests/self-hosting;
empty or invalid values reject. **Rust publication hold:** production feature
availability, including default-origin reactions, requires separate verification.
This is an untagged source preview, not a published package. There are no typed
billing wrappers; generic billing transport is not a release promise.

**C# / .NET** — reference `dotnet/Chert.Sdk/Chert.Sdk.csproj` locally:

```csharp
using TryChert;

using var client = new ChertClient(
    iMessage: new IMessageOptions { ApiKey = "replace-with-your-key" },
    faceTime: new FaceTimeOptions {
        Token = "replace-with-your-token",
        ProjectId = "22000000-0000-4000-8000-000000000002" // Replace with your project UUID.
    });
// Either channel may be omitted. Construction makes no requests.
```

NuGet package `chert-sdk` retains the `TryChert` assembly and namespace. It
provides typed iMessage text/reactions and FaceTime calls, events, transcripts,
inventory, login, connectors and billing status/actions. Billing requires a
signed-in user token and project UUID; messaging and FaceTime credentials remain
independent. This is an HTTP client, not a media runtime or server implementation.

Defaults are `https://console.trychert.com/api/v1` and
`https://facetime.trychert.com/api/v1`; explicit validated overrides preserve
custom prefixes. **Unpublished source preview:** default origins and offline
tests do not establish live feature availability, including reactions and billing.
No fallback or automatic retries are performed. Run
`bash dotnet/verify-package.sh /tmp/chert-sdk-review` for the exact-package and
empty-cache consumer gate. See the [.NET guide](dotnet/README.md) for API limits
and breaking preview migration. Publication requires separate approval.

**C++20** — build/install from `cpp/`, then use
`find_package(trychert 0.1 CONFIG REQUIRED)` and link `trychert::trychert`:

```cpp
#include <trychert/client.hpp>

trychert::Client sdk({
    {.api_key = imessage_key, .tenant = imessage_tenant},
    {.api_key = facetime_key, .project_id = facetime_project_uuid}
});
// auto lines = sdk.facetime.list_lines(); // Explicit read-only request.
```

Omitted URLs default to `https://console.trychert.com` (iMessage) and
`https://facetime.trychert.com` (FaceTime), using `/api/v1` exactly once.
Explicit validated overrides remain available for self-hosting and tests.
**C++ publication hold:** production feature availability, including default-origin
reactions, requires separate verification. This is an untagged source
preview, not a published package. Generic billing transport is not a release promise.

The channels use separate Bearer credentials: iMessage has an optional tenant,
while FaceTime requires a project UUID. There is no automatic server-side binding.
Legacy `<chert/client.hpp>` remains an iMessage-only alias; rebuild existing
binaries. See the [C++ guide](cpp/README.md) for dependencies, install commands,
typed coverage and tests. Other administration APIs remain JSON-based; native
media and live-device acceptance are not covered.

**Go** — import the source module `github.com/cherthq/sdk/go`:

```go
client, err := chert.NewClient(chert.Config{
    BaseURL: "https://messaging.example.test",
    APIKey: "replace-with-your-key",
})
// Check err before using client; construction makes no request.
```

## Repository layout and contributing

`packages/` contains TypeScript clients, adapters, migration tooling and the
unified CLI. `python/`, `rust/`, `dotnet/`, `cpp/` and `go/` contain language
clients and their tests. `tests/` and `scripts/` contain distribution and
local HTTP contract fixtures; `docs/` records API and verification boundaries.

```sh
# JavaScript release gates (Node, Bun and Deno must be installed):
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:distribution
bun run test:package
```

Run each native language's checks from its guide. Python packaging requires the
declared setuptools build backend in an isolated environment, not an arbitrary
system setuptools. CI runs all language suites; packed-artifact checks cover
clean consumers rather than relying only on workspace imports.

Contributions should preserve channel contracts, credential isolation, failure
semantics and legacy compatibility. Keep implementation, tests, packaging and
documentation changes reviewable. Include reproduction steps and tests for
observable behavior; never commit secrets. See the
[integration guide](INTEGRATION.md) for local contract checks. Real messages,
calls, purchases and other external effects require explicit authorization and
are not part of the SDK test suite.

## Compatibility and limits

[COMPATIBILITY.md](COMPATIBILITY.md) defines the supported provider subsets.
Adapters are not full vendor replacements; unsupported operations reject before
dispatch. Provider IDs and credentials do not transfer to Chert. Sends are not
automatically retried. Local tests do not establish live-device delivery or
cross-service project authorization.

Assigned lines can be inspected; shared/dedicated availability and allocation
remain backend/admin managed. No automatic line allocation, plan entitlement,
concierge service, checkout automation, native media connector or delivery
guarantee is included in the published SDK. Billing client methods require a
separately enabled backend. Repository source, package publication and backend
deployment are independent release steps.

MIT licensed. Third-party dependencies retain their own licenses.
