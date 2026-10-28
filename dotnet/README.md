# chert-sdk C# / .NET SDK

NuGet package **`chert-sdk`**, assembly and namespace **`TryChert`**, targeting .NET 8 with no
third-party dependencies. Uses `HttpClient` and `System.Text.Json`.
`0.2.0-preview.1` is an unpublished review candidate, not a live NuGet release.
Local checks do not establish device acceptance or compatibility with every deployment.

Reference `Chert.Sdk/Chert.Sdk.csproj`, or install the reviewed artifact from a local feed:

```sh
dotnet add package chert-sdk --version 0.2.0-preview.1 --source /absolute/review/feed
```

The distribution name aligns with the other Chert SDKs. The `TryChert` assembly
and namespace remain unchanged for source and binary compatibility with the preview;
a hyphenated package ID is not a C# namespace. Replace any preview package reference
to `TryChert` with `chert-sdk`; do not install both.

The source directory retains its historical name; public symbols do not.
Migration from the old source candidate: replace `using Chert.Sdk` with
`using TryChert`, and use `IMessageClient` in place of the old messaging-only
`ChertClient`. `Cherthq.IMessage` is not an alias or a second package.

Configure either channel independently, or both:

```csharp
using TryChert;
using var chert = new ChertClient(
    iMessage: new IMessageOptions {
        ApiKey = messagingKey, Tenant = messagingTenant
    },
    faceTime: new FaceTimeOptions {
        Token = faceTimeToken, ProjectId = faceTimeProjectId
    });
var lines = await chert.FaceTime!.ListLinesAsync(limit: 10, cancellationToken: cancellation);
```

iMessage defaults to `https://console.trychert.com/api/v1` and FaceTime to
`https://facetime.trychert.com/api/v1`. Ordinary callers provide credentials/project,
not URLs. Explicit `BaseUrl` overrides remain available for tests and self-hosting;
only omission selects a default, while null, empty and invalid overrides reject.
**Merge/publication remain held for live contract verification.** Canonical
defaults do not establish route compatibility or production readiness.
Credentials above come from caller configuration.
The SDK never reads environment variables, logs in, allocates a project or sends
a communication during construction. Omitted channels are null. The unified
client owns and disposes both configured channels; standalone `IMessageClient`
and `FaceTimeClient` are also available. Reuse clients for application lifetime.

**The explicit-credentials constructor keeps authentication separate.** iMessage uses its own bearer key
and optional `x-chert-tenant`; FaceTime uses its own bearer token and
`x-chert-project-id`. Neither key, project nor tenant is inferred from the other
channel. Even equal URLs do not merge their credentials. There is no global key.

### Unified session connection (proposed contract, source preview)

```csharp
// The CLI owns login/device approval and supplies this session; the SDK does not log in.
using var connected = await ChertClient.ConnectAsync(new UnifiedSessionOptions {
    AccessToken = sessionToken,
    ProjectId = selectedProjectId
}, cancellation);
var events = await connected.IMessage!.ListEventsAsync(cancellationToken: cancellation);
```

`ConnectAsync` is an explicit opt-in, not a replacement for the legacy constructor.
It validates a `chu_` token with exactly 43 base64url characters and a dashed project
UUID before network activity. It then makes one **unauthenticated** GET to the
approved messaging origin's `/api/v1/sdk/capabilities`. Discovery is bounded to
64 KiB and the smaller of the configured `Timeout` and 15 seconds. Subsequent
channel requests retain the configured timeout.

The descriptor must contain `data.contract = "chert-unified"`,
`contract_version = 1`, bearer authentication with prefix `chu_` and audience
`chert.unified-api:v1`, and the exact approved service `/api/v1` base URLs and
FaceTime `/api/v1/cli/logins` login URL. It must advertise all six scopes:
`imessage:events:read`, `imessage:webhooks:manage`, `imessage:messages:send`,
`facetime:calls:read`, `facetime:calls:create`, and `facetime:calls:control`.
Scope entries must be unique strings; additional unique strings are accepted for
forward compatibility.
This is capability negotiation, not proof of the token's permissions.

Only after validation does the factory bind the same session to both transports.
FaceTime keeps the selected project header; messaging has no arbitrary tenant
override. Every subsequent request includes `X-Chert-Contract: chert-unified-v1`;
every response, including errors and SSE, must echo that exact value before JSON
is parsed or a frame yielded. Old servers (including discovery 404), malformed
descriptors, and missing/wrong echoes fail closed with
`UnsupportedUnifiedBackendException` (`Code = "unsupported_unified_backend"`).
There is no fallback, refresh, redirect following, retry, or implicit device flow.
Caller cancellation remains `OperationCanceledException`.

`IMessageBaseUrl` and `FaceTimeBaseUrl` explicitly approve alternate origins for
self-hosting/tests; defaults are the console and FaceTime HTTPS origins above.
Only origins (optionally ending in `/`) are accepted; non-root paths such as
`/deployment` and `/api/v1` reject before network activity. Legacy constructors
continue to support deployment prefixes. The fixed `/api/v1` namespace is used
after unified origin validation. Advertised
URLs cannot change these approved destinations or forward the session elsewhere.
Do not approve an origin you do not trust with the session. Existing per-channel
body bounds, no ambient proxy/cookies, and request deadlines remain in force.

This is a **proposed version-1 contract**, not a statement of deployed support.
No SDK login, token conversion, permission elevation, or route remapping occurs.
`imessage:messages:send` authorizes the existing strict
`POST /api/v1/text-operations/v1` used by `SendTextAsync`, with its unchanged JSON
body and HTTP 202 queued receipt validation. `LogoutAsync` remains
`POST /api/v1/cli/logout`. Neither operation implies recipient delivery or a
guarantee of deployed contract availability.

Construction performs no requests. The base URL must use HTTPS, except explicit
`http://localhost`, `http://127.0.0.1` or `http://[::1]` for local testing. An
origin-only URL defaults to `/api/v1`; an explicit deployment prefix is retained.
Paths are Chert-relative and cannot override the origin or escape that prefix.
There are no custom authentication headers, environment credentials, cookies,
ambient proxies, redirect following, automatic retries or provider fallback.
Dispose the client when its application lifetime ends.

`IMessage.RequestAsync(path, body, method, cancellationToken)` returns the actual JSON as
an owned `JsonElement?`. An omitted body sends no bytes and defaults to GET;
a supplied `JsonElement` defaults to POST. To send JSON `null`, supply
`JsonSerializer.SerializeToElement<object?>(null)`. HTTP 204 and successful HEAD
return C# null; a JSON-null response has `ValueKind.Null`. List query strings
are retained after validation. GET/HEAD bodies are rejected before HTTP.

## Strict plaintext

```csharp
// Explicit effect: use only an authorized recipient.
var queued = await chert.IMessage!.SendTextAsync(
    "+15550000002", "Exact plaintext", idempotencyKey: "one-operation",
    cancellationToken: cancellation);
```

This makes one POST to `/text-operations/v1` with `phone`, `body` and optional
JSON `idempotency_key`. It validates canonical E.164, nonblank lossless UTF-8 text
up to 16 KiB without NUL, and an optional nonempty lossless UTF-8 key up to 200
bytes without NUL. Text and key bytes are preserved. Blankness follows the cloud's
ECMAScript whitespace set, including BOM; NEL and U+001C are nonblank.

Only HTTP 202 with exactly `success:true`, a lowercase 32-hex public `message_id`,
a safe public `chat_id`, and `status:"queued"` produces `QueuedTextReceipt`.
Queued identifies a cloud reservation. It does not assert a native GUID, service,
sent/delivered/read state or occurrence time.

## Standard reaction acknowledgement

```csharp
// Explicit effect against an owned public message, not a native GUID receipt.
var ack = await chert.IMessage!.SendReactionAsync(
    chatId, messageId, "like", remove: false, idempotencyKey: "reaction-operation",
    cancellationToken: cancellation);
```

One POST goes to `/chats/{chatId}/messages/{messageId}/reactions` with exactly
`{reaction,remove,part_index:0}`. Only `love`, `like`, `dislike`, `laugh`,
`emphasize` and `question` are accepted. A dashed chat UUID is canonicalized to
lowercase. Message IDs preserve case and accept 1–160 ASCII letters, digits,
colon, underscore, dot or hyphen, excluding `.` and `..`; they are encoded as one
path segment. The optional HTTP `Idempotency-Key` accepts 1–200 printable ASCII
bytes without leading/trailing spaces; internal spaces remain unchanged.

Only HTTP 202 with exactly `operation_id` (lowercase 32 hex), matching canonical
`chat_id`, exact `message_id`, and `status:"acknowledged"` produces
`ReactionReceipt`. It is dispatch acknowledgement, not applied/current reaction
state or recipient proof. Custom emoji, groups and nonzero parts are unsupported.

## Messaging events and webhooks (source preview)

`ListEventsAsync(new EventListOptions { Type = "message.received", Limit = 100 })`
returns page JSON (`events`, `next_cursor`, `count`); `GetEventAsync(rowId)` returns
recorded event JSON. Optional filters are `Type`, `Status`, `LeadId`, `Since`,
`Cursor` and `Limit` (1–200). Delivery status describes webhook delivery, not a
recipient's sent/delivered/read status. Cursors and stream `since` values are
opaque, deployment-specific tokens: do not synthesize them from timestamps or
assume they transfer between list and stream endpoints.

`ListWebhookSubscriptionsAsync`, `GetWebhookSubscriptionAsync`,
`CreateWebhookSubscriptionAsync`, `UpdateWebhookSubscriptionAsync` and
`DeleteWebhookSubscriptionAsync` preserve response JSON, including collection/item
wrappers and the create-only secret. Store secrets securely; never log responses.
Create/update use `CreateWebhookSubscription` / `UpdateWebhookSubscription`.
There is no replay helper: console and fleet targeting differ.

```csharp
await foreach (var frame in chert.IMessage!.StreamEventsAsync(
    since: savedStreamToken, cancellationToken: cancellation))
{
    // frame.Event preserves message/error/close; frame.Data is owned JSON.
    // Persist only continuation tokens actually supplied by this deployment.
}
```

One enumeration opens one authenticated connection. No automatic reconnect,
`Last-Event-ID`, or hidden retry is sent, even after a close frame or uncertain EOF.
Comments are skipped; JSON frames are bounded to 1 MiB. The configured timeout
bounds response headers; the ongoing stream lasts until EOF, caller cancellation,
or enumerator disposal (including `break`). Reconcile uncertain gaps yourself.

Before parsing webhook JSON, call `ChertWebhook.Verify(rawBodyBytes, signature,
secret)`. It verifies `v1,timestamp,hex` HMAC-SHA256 over the exact timestamp,
a period, and unmodified body bytes with constant-time digest comparison and
a ±300-second window. Keep clocks synchronized and deduplicate event IDs yourself;
verification does not prevent replay within that window.
These source-preview contracts are not guarantees of deployed route availability.
FaceTime has no HTTP media event stream here: customer media uses LiveKit.

## FaceTime calls and control-plane operations

```csharp
// Explicit effect: obtain consent for this destination first. Persist the operation key.
var call = await chert.FaceTime!.CreateCallAsync(new CreateCallRequest {
    Mode = "customer_managed",
    LineId = assignedLineId,
    Destination = authorizedDestination,
    Media = new MediaOptions { Audio = true, Video = false },
    LivekitUrl = roomUrl,
    ParticipantToken = callScopedRoomToken,
    RemoteParticipantIdentity = agentIdentity
}, idempotencyKey: persistedOperationKey, cancellationToken: cancellation);
var observed = await chert.FaceTime.GetCallAsync(call.Id, cancellation);
// Separate explicit effect, with a separately persisted operation key:
var ending = await chert.FaceTime.EndCallAsync(call.Id, endOperationKey,
    cancellationToken: cancellation);
```

Managed calls use `Mode = "managed"` and `AssistantId` instead of room credentials.
FaceTime links use `DestinationType = "facetime_link"`; groups use typed
`CallRecipient[]` instead of `Destination`. Links and groups require an assigned
line. Server permissions, worker capabilities and deployment feature flags still
decide whether each destination/media combination can run.

Typed operations cover calls (create/list/get/answer/reject/end/events/transcript),
lines and workers (paged lists), device login (start/poll/inspect/approve), identity,
logout, credential list/revocation, connector enrollment, and billing status/actions.
Connector list/activate/drain/revoke preserve their versioned results as JSON.
`FaceTime.RequestAsync` is a project-authenticated JSON escape hatch. It unwraps
`data` from the FaceTime envelope, unlike iMessage's unwrapped response format.
A FaceTime response must have an envelope, including for generic requests;
204/HEAD-with-no-envelope are not valid FaceTime typed results.

Every call and action needs a stable 8–200 printable-ASCII-character idempotency
key without outer whitespace. Nothing retries or generates a replacement key.
Create requires HTTP 201; answer/reject/end require HTTP 202. A returned call
is server state, not proof of ringing, answering, delivery, two-way audio or video.
Query events/state to reconcile an uncertain outcome before deciding to resend.
Pagination is explicit (`limit` 1–100, `offset` ≥ 0); there is no hidden page fetch.
Unknown state strings and additional model fields are retained for forward compatibility.

Public login start/poll send **no authorization or project
headers**, even on an authenticated client. Inspect/approve/logout send the token
but not a project header. Other methods require both token and project locally.
The server decides credential permissions: an `ftu_` CLI credential does not gain
call-write, transcript, credential-management or billing privileges merely because
a method exists. Login approval requires human consent. Polling is one request per
invocation; respect `Interval` and `ExpiresIn`, verify approval URLs before opening
them, and securely store approved credentials yourself. No browser is launched.
Connector enrollment returns secrets and does not activate routing. Activation
requires the expected binding (including explicit null) and assignment generation.
Checkout creation and cancellation are explicit financial actions, not proof of
live entitlement or allocation.

### Custom video sessions (v1, video-only; source preview, unreleased)

Check explicit capabilities first; never infer support from `SupportsVideo`:

```csharp
var caps = MediaCapabilities.Parse(line.MediaCapabilities); // also on FaceTimeCall and scoped FaceTimeWorker
if (caps.CustomVideo is null) return; // unsupported
var grant = await chert.FaceTime!.CreateMediaSessionAsync(callId, MediaDirection.Publish,
    codecs: [VideoCodec.H264], cancellationToken: cancellation); // codecs optional
// Hand grant.Endpoint, grant.Token and grant.IceServers to any standards WHIP client (RFC 9725).
```

`CreateMediaSessionAsync` mints one session for an active call. `Publish` grants a WHIP
endpoint; `Subscribe` grants an experimental WHEP endpoint (draft-ietf-wish-whep-05)
capped at 1280x720. Treat `Endpoint` as opaque, connect before `ConnectBy`, and send the
same `Authorization: Bearer <Token>` on the POST and on PATCH/DELETE to the returned
`Location`. `ToString()` redacts the grant; never log `Token`. A malformed grant throws
`ChertApiException` with `Code == "invalid_response"`; server codes (`unauthorized`,
`call_not_found`, `media_capability_unsupported`, `media_session_conflict`,
`caller_screen_not_shared`,
`media_content_unsupported`, `caller_screen_unsupported`, `media_limit_exceeded`, `call_not_active`, `call_ended`, `media_session_expired`,
`media_transport_unavailable`) surface without server text. Requests are never retried.

Screen sharing: pass `content: MediaSessionContent.Screen` with `Publish` to stream an
agent's screen (the grant echoes `Content` and caps `Limits.MaxFps` at 15), or
`MediaSessionContent.CallerScreen` with `Subscribe` to receive the caller's shared
screen (only while they share; otherwise `caller_screen_not_shared`). Other
combinations throw `ArgumentException` before any request. Capability sections expose
`Contents` (`Camera`, `Screen`; unknown entries ignored, default `[Camera]`).
`FaceTimeCall.ScreenControl` is read-only consent state (`none`/`requested`/`granted`);
screen events such as `agent_screen_started` and `caller_screen_share_started` are
payload-free. There are no control operations.

`VideoFrame.Copy(VideoFrameInit)` validates a raw I420/NV12/RGBA/BGRA frame (even sizes
from 16x16 to 1920x1080, per-plane strides, 8 MiB total) and copies only the required
bytes so buffers can be reused; failures throw `MediaFrameException` with `Code`
`invalid_frame` or `frame_too_large`.

Limitations: no audio; the SDK has no built-in media engine, encoder or WebRTC stack;
keyframe requests (PLI/FIR) are not guaranteed to reach your source, so send periodic
keyframes.

## Billing and preview migration

All billing methods use `/api/v1/billing` and require a **signed-in user bearer
token** in `FaceTimeOptions.Token` plus a project UUID in `ProjectId`. They never
reuse the iMessage key or tenant. A CLI credential is not a substitute for a
signed-in user token; the server enforces membership and permissions.

| Method | HTTP contract | Result |
| --- | --- | --- |
| `GetBillingStatusAsync()` | GET | `BillingStatus`: nullable entitlement, reconciliation/sales flags, shared/dedicated availability |
| `CreateBillingCheckoutAsync(plan, idempotencyKey, couponCode?)` | POST `{action:"checkout",plan:"shared"\|"dedicated",coupon_code?}` | `BillingCheckout.Url` |
| `CancelBillingAsync(idempotencyKey)` | POST `{action:"cancel"}` | `BillingCancellation.Status` and `Message` |
| `ValidateBillingCouponAsync(couponCode, idempotencyKey)` | POST `{action:"validate_coupon",coupon_code}` | `BillingCoupon`: code, percent off, mode, nullable monthly total and currency |

Every POST requires a stable 8–200 printable-ASCII-character idempotency key.
Coupon codes are trimmed and must contain 1–64 characters; the server decides
which codes and plans are available. Responses use the normal `data` envelope.
Coupon offers may have different total/validity shapes. `MonthlyTotal` is null
when absent or explicitly null; it must not be interpreted as a zero monthly price.
Variant fields such as `due_now`, `access_hours` and `plans` are retained in
`AdditionalData` as JSON. Inspect the returned fields rather than assuming a fixed
offer, access duration or recurring price.
The client returns checkout URLs without opening them. Cancellation acknowledges
a request; refresh status to observe its eventual effect. A null entitlement is
valid, but missing status fields or malformed envelopes are errors.

**Breaking unpublished-preview correction:** `GetBillingCatalogAsync`,
`GetCurrentCheckoutAsync`, `CreateCheckoutAsync`, `BillingCatalog`, `BillingPlan`
and `Checkout` have been removed. The former `/billing/catalog` and
`/billing/checkout` subpaths are unsupported. Replace reads with
`GetBillingStatusAsync`, and purchases with `CreateBillingCheckoutAsync`; remove
the catalog-version argument and consume `Url` instead of checkout state/IDs.
There is no public unauthenticated catalog or current-checkout equivalent.
The new purchase method has a distinct name to prevent old positional arguments
from silently becoming an idempotency key or coupon. No billing request is made
automatically, and no purchase/cancellation is exercised by local tests.

## Failure and cancellation

The default total request deadline is 15 seconds, including reading the response.
The default response bound is 8 MiB for iMessage and 1 MiB for FaceTime; both are options. Advertised and
streamed body sizes are checked. Caller cancellation throws a sanitized
`OperationCanceledException`; deadline expiry raises `ChertApiException` with
`Code == "timeout"`. A cancellation or lost reply can occur after an effect and
never authorizes a resend or replacement key.

`ChertApiException.Status`, `Code`, `RequestId` and `ResponseData` are explicit
machine-readable data. Error/client/receipt formatting does not print credentials,
URL query tokens or response bodies. No raw transport exception is attached.
Malformed successful typed receipts produce `unconfirmed_text_outcome` or
`unconfirmed_reaction_outcome`, with HTTP status 502 and explicit raw response
data where available. Invalid FaceTime envelopes, required fields, duplicate JSON
properties or typed statuses produce `invalid_response`. FaceTime's envelope
`request_id` is preserved when no HTTP request-ID header exists. Server-provided
codes, explicit response data, model properties and JSON serialization can contain
sensitive information: do not log them indiscriminately. `ToString()` is redacted;
it is not a replacement for careful logging. Follow the actual server's
reconciliation policy; the SDK never retries on its own.

This package does not include vendor compatibility adapters, iMessage media
upload/download helpers, a LiveKit/media relay, connector runtime, webhook server,
account signup/passkeys, or typed wrappers for every administration resource.
Use the raw channel request APIs for supported deployment-specific JSON routes.
Do not use these APIs to bypass permissions. See `COVERAGE.md` in the source tree
for public contract coverage and explicit boundaries.

## Offline checks and packaging

Use the installed .NET 8 SDK; `NuGet.Config` clears remote package sources, and
these projects need no packages. Disable CLI telemetry explicitly:

```sh
bash dotnet/verify-package.sh .amp/in/artifacts/nuget
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet run --project dotnet/Examples
```

The dependency-free test executable uses task-owned `TcpListener` HTTP peers and
synthetic credentials only. It exercises headers, methods, exact receipts,
pre-effect validation, Unicode, redirects, error privacy, lost replies, limits,
cancellation and total stream deadlines. It sends no device messages. MIT license
text is included in the local package; packing does not publish it. The artifact
gate inspects the package allowlist, identity, license and absence of dependencies,
then restores a clean consumer from only that exact local package with an empty
NuGet cache. It reruns the entire contract suite against the installed DLL and
builds/runs the safe example. It records package SHA-256 and logs. Do not publish
until exact-artifact review and separate release authorization are complete.
