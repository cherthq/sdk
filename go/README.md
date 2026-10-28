# Chert unified Go SDK (source preview)

Standard-library-only iMessage and FaceTime HTTP clients, licensed MIT. This is a
Chert client, not a drop-in vendor SDK, full iMessage-provider parity, or a LiveKit
media runtime. No tagged unified Go release is claimed. See [API coverage and contracts](CONTRACTS.md).
No telemetry, environment credentials, redirects, ambient proxy or automatic
request retry. Legacy constructors make no HTTP requests; the opt-in
`ConnectUnified` factory performs unauthenticated capability discovery.

## Installation and configuration

Import `github.com/cherthq/sdk/go` as `chert`. Go 1.23+ is required. The module path
and existing `NewClient`, `SendText`, `SendReaction`, and `Request` API remain intact.
For this source preview, select a reviewed revision of this repository:

```sh
go get github.com/cherthq/sdk/go@<reviewed-revision>
```

For reproducible builds, pin the resulting pseudo-version in your `go.mod`.
A future semantic release of this nested module would use a `go/vX.Y.Z` Git tag;
this change does not create a tag, publish a package or change production.

No base URLs are needed:

```go
import chert "github.com/cherthq/sdk/go"

sdk, err := chert.New(chert.SDKConfig{
    IMessage: &chert.Config{APIKey: imessageKey, Tenant: imessageTenant},
    FaceTime: &chert.FaceTimeConfig{Token: facetimeToken, ProjectID: facetimeProjectID},
})
if err != nil { return err }
// sdk.IMessage and sdk.FaceTime have independent credentials and transports.
```

Either channel can be omitted. `NewClient(Config{APIKey: key})` constructs only
iMessage; `NewFaceTimeClient(FaceTimeConfig{})` permits only public device-login
operations until an explicitly configured authenticated client is constructed.
Credentials are never inferred, exchanged, or inherited across channels.
`Tenant` and `ProjectID` are **not a verified shared server binding**.

| Channel | Default endpoint | Authenticated scope |
| --- | --- | --- |
| iMessage | `https://console.trychert.com/api/v1` | Bearer API key; optional `X-Chert-Tenant` |
| FaceTime | `https://facetime.trychert.com/api/v1` | Separate Bearer token; project routes require `X-Chert-Project-ID` |

Use optional `EndpointOverride` only for tests, self-hosting or advanced environments.
The legacy iMessage `BaseURL` override remains supported; setting both overrides
is rejected. An origin-only override appends `/api/v1`; an explicit path preserves
that API prefix. Credentials, queries, fragments and traversal are refused in
endpoint URLs. HTTPS is required except literal `localhost`, `127.0.0.1`, or `::1`
HTTP test origins. No environment variable changes these defaults or credentials.

Each call requires a non-nil `context.Context`. The default total timeout is 15
seconds and response cap is 8 MiB; positive `Timeout` and `MaxResponseBytes` override
these bounds on each channel. Context cancellation and deadlines remain detectable
with `errors.Is`. Clients are safe for concurrent use after construction.

### Proposed single-session connection (unpublished)

```go
sdk, err := chert.ConnectUnified(ctx, chert.UnifiedSessionConfig{
    AccessToken: unifiedSessionToken, // chu_ followed by 43 base64url characters
    ProjectID: projectUUID,
})
if err != nil { return err }
```

This is a proposed version-gated protocol, not proof of deployed backend support.
The CLI owns device login; this factory accepts an already-issued token and does
not log in, refresh, provision, retry or fall back to legacy credentials.
`New`, `NewClient` and `NewFaceTimeClient` retain their explicit, separate credential
behavior. The single-session factory is an opt-in exception to credential isolation.

Before transmitting any token, the factory GETs the messaging origin's
`/api/v1/sdk/capabilities` without authorization, tenant or project headers.
Discovery is capped at 64 KiB and 15 seconds (or lower configured bounds). It
requires contract `chert-unified`, version 1, Bearer `chu_` authentication, audience
`chert.unified-api:v1`, the exact approved service URLs and FaceTime login URL, and
all six scopes: `imessage:events:read`, `imessage:webhooks:manage`,
`imessage:messages:send`, `facetime:calls:read`, `facetime:calls:create`, and
`facetime:calls:control`. Invalid credentials/configuration fail before discovery.

Optional `IMessageOrigin` and `FaceTimeOrigin` are caller-approved origins, not API
paths. Defaults are `https://console.trychert.com` and `https://facetime.trychert.com`.
Only HTTPS or existing literal-loopback HTTP rules are accepted. Discovery cannot
choose a new credential destination. A 404, redirect, malformed descriptor or
contract mismatch fails closed with `unsupported_unified_backend`.

Both authenticated channels use the same token. FaceTime project requests send
`X-Chert-Project-ID`; messaging has no caller-selected tenant. All requests from
these clients, including SSE and public FaceTime requests, send
`X-Chert-Contract: chert-unified-v1` and require its exact response echo before
consuming data. A missing/wrong echo closes the response and fails closed; it is
not proof a mutation had no effect. Public/user FaceTime authentication scopes
still omit credentials/project headers as documented for those scopes.

The unified `imessage:messages:send` scope authorizes the existing
`POST /api/v1/send` route. `SendText` is not remapped: its body remains
`{phone,body,idempotency_key?}` and its receipt check is the same as for key clients.
`Logout` remains `POST /api/v1/cli/logout`. These are source contracts; no live
sending or deployed cross-service authorization was verified.

## iMessage operations

```go
client, err := chert.NewClient(chert.Config{
    APIKey: apiKey,
    Tenant: "your-tenant",
})
if err != nil { return err }
key := "caller-owned-operation-key"
receipt, err := client.SendText(ctx, chert.TextRequest{
    Phone: "+15550000002", Body: "Exact plaintext", IdempotencyKey: &key,
})
```

`Request(ctx, method, relativePath, body)` returns actual HTTP status, request ID
and explicit bounded raw JSON in `Response`. Nil body means no body. Paths cannot
escape the configured prefix; authentication and tenant headers cannot be
overridden. JSON responses reject invalid UTF-8, duplicate keys, trailing data
and nesting beyond 128 levels. Empty 204/HEAD responses are supported.

`SendText(ctx, TextRequest)` calls only `/send`. It preserves exact
lossless UTF-8 text (nonblank under the cloud's ECMAScript whitespace policy,
no NUL, at most 16 KiB). Optional text keys are nonempty, lossless UTF-8, no NUL,
at most 200 bytes, without leading/trailing ECMAScript whitespace (the CRM trims
keys), preserved in the JSON body. Accepted receipts are HTTP 202
`queued` or HTTP 200 `sent`/`duplicate` JSON objects with `message_id` and
`chat_id` (`[A-Za-z0-9:_-]{1,160}`); extra fields are ignored and anything else
is `unconfirmed_text_outcome` (502, never retried). `sent` means dispatched to a
line, `duplicate` means the line's duplicate check already had this message;
`message_id` is a new record. **None of these is delivery proof.**

`SendReaction(ctx, chatID, messageID, ReactionRequest)` calls the nested reaction
operation route with exact `{reaction,remove,part_index:0}`. Standard reactions:
`love`, `like`, `dislike`, `laugh`, `emphasize`, `question`. Only dashed chat UUIDs
are normalized to lowercase. Message IDs preserve case, match
`[A-Za-z0-9:_.-]{1,160}`, exclude `.`/`..`, and are path encoded. Optional reaction
keys use the `Idempotency-Key` header: printable ASCII, 1–200 bytes, no leading or
trailing spaces; internal spaces are preserved. Only an exact matching four-field
HTTP 202 acknowledgement is accepted. **Acknowledged is not applied state.**

### Recorded events, webhooks and SSE (source preview)

`ListEvents(ctx, EventListOptions)` reads one page with `Type`, `Status`, `LeadID`,
`Since`, `Cursor`, and optional `Limit` (pointer to 1–200; nil uses the server default).
Empty string filters are omitted. `GetEvent(ctx, rowID)` uses the record's `id`,
not its `event_id`. Results retain typed `Data` and original JSON/HTTP metadata.
Typed event structs decode only modeled metadata; arbitrary unknown metadata is
available in `Result.Response.Data`, not in `Result.Data`. The event's `Payload`
map retains every payload field as raw JSON, including unknown nested data.
`Status` and `Delivery` describe **webhook delivery**, not recipient delivery.
List `NextCursor` belongs in list `Cursor`; list `Since` is a time filter. Neither
is interchangeable with the opaque SSE `Since` continuation.

`ListWebhookSubscriptions`, `GetWebhookSubscription`, `CreateWebhookSubscription`,
`UpdateWebhookSubscription`, and `DeleteWebhookSubscription` use the public
`/webhook-subscriptions` collection and item routes. Creation accepts URL, optional
events and version; PATCH also accepts `IsActive`. Pointer fields distinguish
omission from false or an empty array (use a pointer to `[]string{}`, not a nil slice).
Creation returns a one-time secret: store it securely. No replay helper is provided.
Server validation and authorization remain authoritative; these models are not
complete response-schema validation. Never infer that a failed mutation had no effect.

```go
err = client.StreamEvents(ctx, chert.StreamEventsOptions{Since: continuation},
    func(frame chert.MessagingStreamFrame) error {
        // Inspect frame.Event and frame.Data without logging private payloads.
        // Return an error to stop; keep the callback bounded and context-aware.
        return nil
    })
```

`StreamEvents` opens a single authenticated SSE connection. Named `message`,
`error`, `close` and future frames retain their JSON; an error frame does not
itself end the connection. Comments are ignored, fragmented UTF-8, multiline data
and CR/LF/CRLF are supported, and each decoded frame is bounded to 1 MiB.
The configured total `Timeout` still applies (15 seconds by default); choose a
larger positive timeout for longer streams and use context cancellation to stop.
Callbacks run synchronously; cancellation cannot interrupt your callback code.
Close frames are delivered before cleanup. EOF discards any unterminated frame
and ends the call; it does not prove delivery. There is no auto-reconnect, retry,
`Last-Event-ID`, or automatic use of `reconnect_with_since`. Reconcile before any
caller-directed reconnection. Bodies close on every return path.

`VerifyWebhook(rawBody, signature, secret)` verifies the exact raw bytes before
JSON parsing. The signature is `v1,<Unix-seconds>,<64 hex characters>`: HMAC-SHA256
over timestamp + `.` + raw body, compared in constant time, with a ±300-second
clock tolerance. Do not reserialize JSON before verification. Verification does
not deduplicate deliveries; bound incoming request bodies and track event IDs.

These APIs are source-preview contracts with synthetic local tests, not a claim
that routes are deployed or live delivery has been verified. FaceTime call events
remain HTTP snapshots (`GetCallEvents`), not this iMessage stream. FaceTime media
runs through the customer's LiveKit integration, not through this SDK or SSE.

## FaceTime control and management

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
result, err := sdk.FaceTime.ListLines(ctx, chert.PageOptions{Limit: 25})
if err != nil { return err }
for _, line := range result.Data.Items {
    // Select an already-authorized line; status does not verify working media.
    _ = line.ID
}
```

Typed methods cover calls (list/get/create, answer/reject/end, events, transcript),
lines (list/update), workers (list), assistants (list/get/create/update/publish),
settings (get/replace), device login and credential management, connector management,
and billing (status, checkout, cancel, coupon validation). See the [route and authorization matrix](CONTRACTS.md).
No automatic polling, pagination, browser approval, URL opening or provisioning occurs.

`Result[T]` contains typed `Data` and the complete original `Response`, preserving
HTTP status, request ID, unknown fields and exact JSON. Mutable assistant configuration
and evolving connector management results intentionally remain JSON, not invented
stable schemas. Nullable PATCH fields represented by `json.RawMessage` distinguish
nil (omit), `json.RawMessage("null")` (clear), and a JSON string (replace).

Outbound creation always sends `direction: outbound`. Managed calls require an
assistant; customer-managed/BYOR calls require an explicit line, audio and all
three call-scoped room credentials. Choose a single destination or a recipient
group, never both. The server owns scope, destination, room-token, quota and media
validation. **HTTP 201/202 is control acceptance, not a connected call, completed
hangup, active connector runtime, or verified two-way media.**

Call creation/actions require a caller-owned 8–200 byte printable
ASCII idempotency key without surrounding spaces. Retain the key and exact body
for reconciliation. Other management mutations have no general idempotency guarantee.
`PublishAssistant` can create another version if manually repeated. Billing
actions require an 8–200 character printable-ASCII key (surrounding spaces trimmed).

CLI `ftu_` credentials have a restricted server allowlist: they do not gain call-write,
transcript, assistant, billing or browser-user permissions from this SDK. Login
inspection/approval and credential management need the documented signed-in user
authorization. Billing requires a signed-in user token with project membership;
check `BillingStatus` (`sales_enabled`, availability) before initiating checkout.
The SDK never opens the checkout URL. `CancelSubscription` is a request, not
confirmation. Do not treat checkout completion as line allocation.

**Breaking change from earlier source previews:** `GetBillingCatalog`,
`CurrentCheckout` and `CheckoutRequest{PlanID, CatalogVersion}` targeted removed
`billing/catalog` and `billing/checkout` routes and were removed. Use
`BillingStatus` and `CreateCheckout(ctx, CheckoutInput{Plan: "shared"}, key)`.

Connector management does not provide a connector or media runtime.

### Custom video sessions (v1, video-only; source preview, unreleased)

Check explicit capabilities first; never infer support from `SupportsVideo`:

```go
caps := chert.ParseMediaCapabilities(line.MediaCapabilities) // also on Call and scoped Worker
if caps.CustomVideo == nil { return errors.New("custom video unsupported") }
grant, err := sdk.FaceTime.CreateMediaSession(ctx, callID, chert.CreateMediaSessionRequest{
    Direction: chert.MediaPublish, Codecs: []chert.VideoCodec{chert.H264}, // Codecs optional
})
if err != nil { return err } // e.g. media_capability_unsupported, call_not_active, call_ended
// Hand grant.Data.Endpoint, grant.Data.Token and grant.Data.ICEServers to any
// standards WHIP client (RFC 9725), e.g. one built on pion/webrtc.
```

`CreateMediaSession` mints one session for an active call. `MediaPublish` grants a WHIP
endpoint; `MediaSubscribe` grants an experimental WHEP endpoint
(draft-ietf-wish-whep-05) capped at 1280x720. Treat `Endpoint` as opaque, connect
before `ConnectBy`, and send the same `Authorization: Bearer <Token>` on the POST and
on PATCH/DELETE to the returned `Location`. The grant prints as redacted; never log
`Token`. A malformed grant fails with `invalid_response`; server error codes
(`unauthorized`, `call_not_found`, `media_capability_unsupported`,
`media_session_conflict`, `caller_screen_not_shared`,
`media_content_unsupported`, `caller_screen_unsupported`, `media_limit_exceeded`, `call_not_active`, `call_ended`,
`media_session_expired`, `media_transport_unavailable`) surface without server text.
Requests are never retried.

Screen sharing: set `Content: chert.MediaContentScreen` on a publish request to stream
an agent's screen (the grant echoes `Content` and caps `Limits.MaxFPS` at 15), or
`chert.MediaContentCallerScreen` on a subscribe request to receive the caller's shared
screen (only while they share; otherwise `caller_screen_not_shared`). Other
combinations fail with `invalid_request` before any request; an empty `Content` is
omitted from the body. Capability sections list `Contents` (`camera`, `screen`;
unknown entries ignored, default `camera`). `Call.ScreenControl` is read-only
consent state (`none`/`requested`/`granted`); screen events such as
`agent_screen_started` and `caller_screen_share_started` are payload-free. There are
no control operations.

`CopyVideoFrame` validates a raw `i420`/`nv12`/`rgba`/`bgra` frame (even sizes from
16x16 to 1920x1080, per-plane strides, 8 MiB total) and copies only the required
bytes so buffers can be reused; failures are `*MediaFrameError` with `Code`
`invalid_frame` or `frame_too_large`.

Limitations: no audio; the SDK has no built-in media engine, encoder or WebRTC
stack; keyframe requests (PLI/FIR) are not guaranteed to reach your source, so send
periodic keyframes.

### Call video composition (draft, unreleased)

A call's video can be a stack of layers that the backend composes server-side and
publishes through the call's single publish slot (so it conflicts with other publish
sessions: `media_session_conflict`). Check `chert.ParseVideoComposition(line.VideoComposition)`
first; it returns nil unless the explicit, versioned capability is present.

```go
video, err := sdk.FaceTime.SetCallVideo(ctx, callID, chert.SetCallVideoRequest{Layers: []chert.VideoLayerInput{
    {ID: "base", Source: &chert.CompositionBase{Kind: chert.CompositionCamera}},
    {ID: "captions", Z: 1, Page: chert.CompositionPage{DeploymentID: "dep_123"},
        Region: &chert.CompositionRegion{X: 0, Y: 0.75, Width: 1, Height: 0.25}, Background: chert.CompositionTransparent},
}}, "video-key-1")
// video.Data.Layers[0].Publish is a camera base's publish grant: push frames over WHIP.
```

`SetCallVideo` PUTs `/api/v1/calls/{id}/video` (the page shortcut is
`SetCallVideoRequest{Page: &chert.CompositionPage{DeploymentID: ...}}`); `GetCallVideo` and
`ClearCallVideo` read and stop it. v1 allows at most two layers: one base (`camera` or
`managed`) at z 0 and page layers at z ≥ 1 with a normalized `Region` (default full
frame), `Background` (opaque default or transparent), `Opacity` (0–1, default 1),
optional `Input` (pointer, keyboard, text) and `InitialState`. A non-nil `Revision` makes
the PUT compare-and-set. `CompositionInputTarget` returns the topmost pointer-accepting
page layer under an output-frame point. Invalid compositions fail with `invalid_request`
before any request; responses outside the contract fail with `invalid_response`. Server
codes `video_composition_unsupported`, `composition_invalid`,
`composition_revision_conflict` and `composition_base_unavailable` surface without
server text.

Pages are ready deployment IDs only; URL pages cannot be expressed. This SDK cannot
deploy pages or drive page state, events or input; those living-service operations are
TypeScript SDK only.

## Raw access and failures

`RequestWithOptions` adds an optional iMessage header idempotency key for uncovered
routes. `FaceTimeClient.Request` returns the unmodified envelope and accepts
`FaceTimeRequestOptions{Auth: ProjectAuth|UserAuth|PublicAuth}` (default project).
Public calls omit both credential and project headers; user calls omit project.
An idempotency header alone does not establish a route's server-side idempotency.
Binary upload/download, signed media URL fetching and foreign-origin requests
are not provided by these JSON transports. iMessage SSE uses `StreamEvents`.

`APIError` exposes status, machine code, request ID and bounded `Data` explicitly.
Error/client formatting redacts raw data and credentials. Non-2xx errors retain
public reconciliation IDs in `Data`; there is no raw server-message forwarding.
Malformed successful typed responses become `unconfirmed_text_outcome` or
`unconfirmed_reaction_outcome` (502). Cancellation and transport failure can follow
an effect: reconcile before any caller-directed retry. Neither method retries,
changes an operation key, uses a fallback, or polls delivery state.
FaceTime malformed typed data/status yields `invalid_response` for reads or
`unconfirmed_facetime_outcome` for mutations, retaining the observed HTTP status.
Malformed/truncated/oversized successful mutation bodies also produce an
unconfirmed outcome. Failures before response headers retain their transport code;
cancellation identity is preserved in both cases.
Do not interpret any error as proof that a mutation had no effect.
Error/config/client/result formatting is redacted, but explicitly accessing or
JSON-encoding models, raw responses, tokens, transcripts or error fields is **not**
redaction. Treat them as sensitive application data.

## Local checks

```sh
bash scripts/check-go.sh  # from the repository root
```

The `httptest` tests exercise local HTTP only. They do not establish deployment,
provider compatibility or working audio/video. No service installation is required
for this client-only package.
