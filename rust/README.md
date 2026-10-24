# Chert Rust SDK — `chert-sdk`

One async Rust crate for iMessage and FaceTime, using the public `chert-sdk` identity.
The library import remains `trychert_sdk` for preview source compatibility.
This untagged source preview is **unpublished** and retains
`publish = false` until exact archive review and separate publication authorization.
Use a path dependency (`chert-sdk = { path = "../sdk/rust" }`) while reviewing.
Requires Rust 1.88+ and a Tokio runtime. No device installation is required for this client.

**Publication hold:** the confirmed production defaults are `https://console.trychert.com`
for iMessage and `https://facetime.trychert.com` for FaceTime, with `/api/v1` once.
Service compatibility still requires verification before publication.
Default origins do not guarantee that every API route is enabled for your account.
Production reaction routing has not been verified by the local test suite.
This source preview has no typed billing wrappers; generic billing transport is not
a release promise. Source availability is separate from publication and service availability.

## Two channels, separate credentials

Legacy `ChertSdk::new` accepts either or both channel configurations. It does not load environment
variables, discover endpoints, fall back to another channel, or infer a project binding.
The iMessage tenant and FaceTime project ID are **not interchangeable**.
The server must establish any future shared credential/project binding first.

```rust,no_run
use trychert_sdk::{ChertSdk, IMessageConfig, FaceTimeConfig};
use trychert_sdk::facetime::{CallExecution, CallTarget, CreateCall, DestinationType, Media};
# async fn example() -> Result<(), trychert_sdk::ChertError> {
let sdk = ChertSdk::new(
    Some(IMessageConfig::new("messaging-key")),
    Some(FaceTimeConfig::new("ftk_explicit-key", "00000000-0000-4000-8000-000000000001")),
)?;
let messaging = sdk.imessage.as_ref().expect("configured above");
let queued = messaging.send_text("+15550000001", "hello", Some("stable-text-key")).await?;
let facetime = sdk.facetime.as_ref().expect("configured above");
let calls = facetime.list_calls(20, 0).await?;
let request = CreateCall {
    line_id: "00000000-0000-4000-8000-000000000002".into(),
    execution: CallExecution::Managed {
        assistant_id: "00000000-0000-4000-8000-000000000003".into(),
    },
    target: CallTarget::Destination {
        destination: "+15550000001".into(), destination_type: DestinationType::Phone,
    },
    media: Media { audio: true, video: false },
};
// Creates a real call when run against a service: obtain recipient authorization first.
let call = facetime.create_call(&request, "caller-stable-call-key").await?;
// Queue acceptance and a returned call snapshot do not prove delivery or connection.
# let _ = (queued, calls, call);
# Ok(()) }
```

Configuration constructors select official defaults without requiring URLs.
Set `base_url` explicitly for tests or self-hosting, for example
`FaceTimeConfig { base_url: "http://127.0.0.1:8080/custom/v2", ..FaceTimeConfig::new("key", "project") }`.
Only omission selects the default: empty or invalid overrides fail client construction,
never fall back. Root origins and trailing slashes yield `/api/v1` once; explicit
prefixes such as `/api/v1` or `/custom/v2` are retained. `tenant` and `limits` remain
explicit configurable fields. The legacy explicit-URL `ChertClient::new` is unchanged.

## Supported surface and boundaries

### Proposed unified session v1 (not deployed)

`ChertSdk::connect(UnifiedSessionOptions::new(access_token, project_uuid)).await`
opts into the proposed `chert-unified` version 1 contract. This source preview is
not a deployment or service-availability claim. Existing `ChertSdk::new` and
channel constructors retain their independent-credential behavior unchanged.
Device login is CLI-owned: this factory accepts an existing token and implements
no device flow, token storage, refresh, retries, or legacy fallback.

The token must be `chu_` followed by exactly 43 ASCII base64url characters; the
project must be a dashed UUID. Before transmitting the token, `connect` makes an
unauthenticated GET to the approved messaging origin's `/api/v1/sdk/capabilities`
(total timeout is the smaller of the caller timeout and 15 seconds; 64 KiB body limit).
It validates contract/version,
Bearer scheme, `chu_` prefix, `chert.unified-api:v1` audience, both service URLs,
the FaceTime `/api/v1/cli/logins` URL, and all six scopes:
`imessage:events:read`, `imessage:webhooks:manage`, `imessage:messages:send`,
`facetime:calls:read`, `facetime:calls:create`, `facetime:calls:control`.
Scopes must be unique strings; additional unique strings are allowed for forward compatibility.

`imessage_base_url` and `facetime_base_url` default to the official origins.
Explicit overrides are caller-approved trust decisions, validated using the
existing HTTPS/loopback rules. Unified overrides must be root origins (an optional
trailing slash is accepted); non-root paths are rejected before network I/O.
Legacy constructors still support custom deployment prefixes. Descriptor URLs must exactly match those approved endpoints and
cannot redirect credentials to another host. Both clients use the same bearer
token and send `X-Chert-Contract: chert-unified-v1`. FaceTime also sends the project
header; messaging does not accept or send a caller tenant. Every authenticated
response must echo the exact contract header before JSON or SSE body consumption,
including error responses. Missing/wrong echoes and unsupported discovery
responses fail with `unsupported_unified_backend`; malformed credentials fail
with `invalid_unified_session`. Redirects and ambient proxies remain disabled.

`imessage:messages:send` authorizes the existing strict
`POST /api/v1/text-operations/v1` route. `send_text` retains its request body and
exact HTTP 202 queue-acceptance receipt contract; no route remapping occurs.
Successful discovery is not proof of live message delivery. Logout remains POST
and is CLI-owned, like the device-login lifecycle.

```rust,no_run
use trychert_sdk::{ChertSdk, UnifiedSessionOptions};
# async fn example(token: &str) -> Result<(), trychert_sdk::ChertError> {
let sdk = ChertSdk::connect(UnifiedSessionOptions::new(
    token, "00000000-0000-4000-8000-000000000001",
)).await?;
let events = sdk.imessage.as_ref().expect("connect supplies both channels")
    .list_events(&Default::default()).await?;
# let _ = events;
# Ok(()) }
```

### Channel surface

| Surface | Contract |
| --- | --- |
| iMessage | Strict typed text queue acceptance, standard reaction acknowledgement, recorded events, webhook subscription CRUD and single-connection SSE; raw typed JSON transport for other messaging routes |
| FaceTime calls | List/get, managed and BYOR outbound creation, phone/email/Apple ID/link/group targets, answer/reject/end, events and transcripts |
| FaceTime resources | Typed line list/update, assistant list/get/create/update/publish, project settings read/update; raw `request<T>` for additional control-plane routes |
| Errors | Shared `ChertError`: status, wire code, request ID, explicit raw data; redacted formatting |
| Authentication | Independent bearer credentials; `X-Chert-Tenant` only for messaging, `X-Chert-Project-Id` only for FaceTime |
| Media/runtime | No LiveKit streaming, worker enrollment, connector runtime or physical-device acceptance claim |
| Provider compatibility | No third-party provider SDK emulation |

FaceTime responses retain `{ data, request_id }` in `ApiResponse<T>`. List methods
return `Page<T>` and never auto-paginate. Unknown call states and additional fields
are preserved rather than interpreted as success. Typed methods require the route's
exact success status (200 read, 201 create, 202 action). Malformed envelopes fail.
Call mutations require caller-supplied 8–200-byte printable ASCII idempotency keys
without outer spaces. Nothing generates keys or retries. BYOR secrets are sent only
to the explicitly configured FaceTime endpoint; `Debug` omits tokens and customer content.
Server-side authorization, room-token validation and media readiness remain authoritative.

For BYOR, use `CallExecution::CustomerManaged { room: RoomCredentials { ... } }`.
It cannot contain a managed assistant. Use `CallTarget::Group { recipients }` for
groups and `DestinationType::FacetimeLink` for links. Group/destination exclusivity
is enforced by the Rust type. Production BYOR requires audio and a line; video
readiness is separate. Call actions accept a reason, but callers must not assume
it is retained or included in subsequent responses.

`ChertClient` remains the messaging-only compatibility name; `IMessageClient`
names that role explicitly. Existing imports migrate from `cherthq_imessage` to
`trychert_sdk`. The fixture executable names remain unchanged.

Assistant draft configuration remains versioned JSON validated by the server.
`UpdateAssistant` requires `expected_draft_revision`; conflicts are returned without
retry. Nullable patch fields use `Option<Option<T>>`: `None` preserves, `Some(None)`
clears, and `Some(Some(value))` replaces. Line activation, account/billing/admin,
FaceTime webhook management and connector protocols have no dedicated typed helpers in this
candidate; use the explicit generic transport for JSON routes, with the required
server permissions. No browser authentication or elevated scope is invented.

`cargo run --example unified` is a read-only example using explicitly supplied
`CHERT_IMESSAGE_KEY`, optional `CHERT_IMESSAGE_TENANT`, `CHERT_FACETIME_KEY`,
and `CHERT_FACETIME_PROJECT_ID`. `CHERT_IMESSAGE_URL` and `CHERT_FACETIME_URL`
are optional overrides; present empty/invalid values reject rather than select defaults.
It prints counts/status only, not credentials or customer content.

## iMessage acceptance contract

Messaging `request<T>` decodes the actual response without unwrapping envelopes.
Use `serde_json::Value` to preserve every wire field.

```rust,no_run
use trychert_sdk::{ChertClient, IMessageConfig};
# async fn example() -> Result<(), trychert_sdk::ChertError> {
let client = ChertClient::from_config(IMessageConfig::new("explicit-key"))?;
let receipt = client.send_text("+15550000001", "hello",
    Some("caller-stable-key")).await?;
assert_eq!(receipt.status, "queued");
# Ok(()) }
```

`send_text(phone, text, key)` makes one request to `/text-operations/v1` and
requires actual HTTP 202 with exactly `success:true`, a 32-character lowercase
hex public `message_id`, a validated `chat_id` and `status:"queued"`. Its
`QueuedTextReceipt` preserves those four fields; it establishes no delivery or
read state. Invalid input fails before HTTP. Text and
an optional caller key are preserved exactly (lossless UTF8, no NUL, text at
most 16KiB, key at most 200 bytes). No key is generated automatically.
Unexpected success statuses or receipt shapes fail with
`unconfirmed_text_outcome`; reconcile the explicit error data before retrying.
Non-2xx Chert error codes and raw data remain available without automatic retry.
Generic `request<T>` remains an explicit raw transport, including legacy routes;
it does not acquire this strict policy or route requests to FaceTime.

The authenticated messaging API accepts `{phone,body,...}`. Local HTTP tests
verify request and response handling, not message delivery. Timeout and dropping
the future only cancel waiting and cannot retract an accepted operation.

Root bases use `/api/v1`; explicit deployment prefixes stay pinned. Paths must be
relative API paths starting with `/`, with optional query parameters (8192-byte total limit), without fragment, traversal, control
characters or encoded separators/nested encodings. HTTPS is mandatory except
parsed `localhost`/`127.0.0.1`/`[::1]` HTTP for local testing. Credentials and optional
tenant are explicit. Ambient proxy settings and redirects are disabled. There
are no automatic retries, including reqwest protocol retries. No telemetry is
added; no vendor fallback exists.

`None` body omits JSON; `Some(Value::Null)` sends JSON null. Messaging HTTP 204 decodes null
(use `()` or `Option<T>`); FaceTime requires its JSON envelope. Timeout covers request and response consumption;
response bodies have an explicit byte ceiling. Drop the request future to cancel
local waiting. Cancellation, timeout, dropped responses, redirects and decoding
errors cannot retract an accepted operation: reconcile durable IDs before retry.
The client never invents idempotency keys or replays a request.

Errors expose status, string/numeric wire code, request ID and raw JSON as explicit
fields. Those fields can contain customer data. Display, Debug and source chains
omit server text, identifiers, URLs, credentials and transport internals. Client
Debug also omits credentials and configuration. Do not indiscriminately log raw
error fields. JSON/type errors do not retain parser source chains.

Pinned direct dependencies: reqwest 0.13.4 (MIT OR Apache-2.0, rustls + JSON,
default features disabled), serde 1.0.228 and serde_json 1.0.145 (MIT OR Apache-2.0),
test-only tokio 1.48.0 (MIT). Cargo.lock fixes transitive versions. Cached package
manifest license review found permissive license choices throughout (including
Unicode-3.0 data, ISC/BSD crypto and CDLA-Permissive root certificates); no
copyleft-only dependency. No custom TLS or JSON parser is implemented.

Local verification (no cloud/device requests):

```sh
cargo fmt --check
cargo test --offline --locked --all-targets
cargo test --offline --locked --doc
cargo clippy --offline --locked --all-targets --all-features -- -D warnings
cargo package --offline --locked --allow-dirty
```

From the repository root, run `bash scripts/verify-rust-package.sh /absolute/path/to/artifacts`
with an output directory outside the source tree. The gate compares every archive source
file with the reviewed tree, rejects unexpected members and path/git dependencies,
tests the unpacked archive and a fresh consumer, and records its SHA-256. The exact
artifact still needs human release approval; this script never publishes.

Run `cargo fetch --locked` first on a machine without the dependencies cached.
Tests use std TCP listeners for exact request bytes, tenant/project/auth/body/prefix,
redirect sink refusal, errors/redaction, 204, response limits, timeout and
pre-network namespace validation and dropped-future cancellation.
The lockfile requires Rust 1.88 or newer (ICU dependencies); the suite passes on
Rust 1.88 and the installed stable compiler. HTTPS handshake/platform trust integration and
cross-platform runtime behavior remain unverified. No package has been published.

Malformed JSON, response type mismatches and oversized bodies on successful HTTP
responses report status 502; unsuccessful HTTP statuses are preserved. Query
values reject raw/encoded controls before network dispatch. Escaped percent signs
are allowed in queries as literal data, without recursive decoding; path escape
restrictions remain unchanged.

`send_reaction(chat_id, message_id, reaction, remove, idempotency_key).await`
uses the authenticated nested Chert reaction operation endpoint. It accepts six
standard names (`love`, `like`, `dislike`, `laugh`, `emphasize`, `question`) on
part zero. Chat IDs must be dashed UUIDs and are canonicalized to lowercase;
message IDs retain exact case and use ASCII `[A-Za-z0-9:_.-]`, 1–160 bytes,
excluding `.` and `..`. Path segments are encoded, never treated as URLs.

The optional key is a Chert-specific `Idempotency-Key` header: 1–200 printable
ASCII bytes, no leading/trailing spaces; internal spaces remain unchanged. It is
marked sensitive and is never generated. A `ReactionReceipt` requires exact HTTP
202 and the four matching public fields. It means dispatch acknowledged, not
applied/current UI state or recipient delivery. Unknown outcomes never retry;
inspect the explicit error data for reconciliation. Dropping the future cancels
local waiting but cannot retract a server-side effect. This typed generic Chert
method is not a provider SDK or live reaction acceptance claim.

## Messaging events and webhook subscriptions (preview)

These routes require service/account availability; local contract tests are not
production acceptance. `events` exports the public wire types. `list_events`
accepts optional `type` (Rust `r#type`), `status`, `lead_id`, `since`, `cursor` and
`limit` (1–200). It returns `events`, `next_cursor` and `count`, without automatic
pagination. Keep cursors opaque and reuse the same filters; do not infer ordering,
retention, resumability or unlimited history from a cursor. Existing transport
query safety rules and the 8192-byte path limit still apply. `get_event(row_id)`
uses the recorded row ID, not the payload's event ID.

`delivery.status` and attempts describe webhook delivery, not recipient message
delivery/read state. Event names, payloads and status strings remain service-defined.
Webhook subscriptions support list/get/create/update/delete and retain the wire
envelopes. Creation exposes the secret only as explicit data; all new types have
redacted `Debug`. Omitted update fields are not serialized. Protect the returned
secret, and reconcile uncertain writes rather than retrying. No replay helper is
provided, and no subscription targeting semantics are inferred.

Typed event and subscription helpers retain only their declared fields, plus
arbitrary JSON within the event `payload`; unknown metadata fields are discarded.
For additional response metadata, use the existing generic raw JSON transport:
`client.request::<serde_json::Value>("/events?limit=50", trychert_sdk::HttpMethod::GET, None).await?`.
It retains the complete JSON response, without unwrapping envelopes.

```rust,no_run
use std::ops::ControlFlow;
use trychert_sdk::{ChertClient, IMessageConfig, events::EventListOptions};
# async fn example() -> Result<(), trychert_sdk::ChertError> {
let client = ChertClient::from_config(IMessageConfig::new("explicit-key"))?;
let page = client.list_events(&EventListOptions {
    limit: Some(50), ..Default::default()
}).await?;
client.stream_events(None, |frame| {
    // Handle frame.event and frame.data without logging customer content.
    if frame.event == "close" { ControlFlow::Break(()) }
    else { ControlFlow::Continue(()) }
}).await?;
# let _ = page;
# Ok(()) }
```

`stream_events(since, callback)` consumes one authenticated SSE connection using
the same credentials, prefix, no-proxy/no-redirect/no-retry policy and total
transport timeout. `since` is opaque. It does not send `Last-Event-ID`, reconnect,
or interpret continuation tokens. Unnamed frames are `message`; named `error`
frames do not terminate consumption, while `close` is delivered and then releases
the connection. Comments are ignored; JSON data supports multiline, UTF-8 and
CR/LF/CRLF boundaries, with a 1 MiB frame ceiling. Incomplete frames at EOF are not
delivered. Invalid streams fail with sanitized errors. Return `ControlFlow::Break`
or drop the consumption future to release resources; callbacks must not block.
An EOF does not establish delivery or durable resume position.

No webhook signature verifier is included: existing direct dependencies do not
provide an HMAC API and no crypto dependency was added. Before parsing webhook
JSON, use a vetted HMAC-SHA256 implementation to verify `v1,timestamp,hex` against
the exact `timestamp + "." + raw_body` bytes, with constant-time verification and
a timestamp within ±300 seconds. Reject malformed signatures and empty secrets.

FaceTime `call_events` and `transcript` remain HTTP snapshots. Live call media and
realtime room events belong to LiveKit, not this iMessage SSE stream; this crate
does not include a LiveKit runtime or promise a FaceTime event-stream endpoint.
