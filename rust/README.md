# Chert Rust SDK — `chert-sdk`

One async Rust crate for iMessage and FaceTime, using the public `chert-sdk` identity.
The library import remains `trychert_sdk` for preview source compatibility.
This release candidate is **unpublished** and retains
`publish = false` until exact archive review and separate publication authorization.
Use a path dependency (`chert-sdk = { path = "../sdk/rust" }`) while reviewing.
Requires Rust 1.88+ and a Tokio runtime. No device installation is required for this client.

## Two channels, separate credentials

`ChertSdk` accepts either or both channel configurations. It does not load environment
variables, discover endpoints, fall back to another channel, or infer a project binding.
The iMessage tenant and FaceTime project ID are **not interchangeable**.
The server must establish any future shared credential/project binding first.

```rust,no_run
use trychert_sdk::{ChertSdk, IMessageConfig, FaceTimeConfig, TransportLimits};
use trychert_sdk::facetime::{CallExecution, CallTarget, CreateCall, DestinationType, Media};
# async fn example() -> Result<(), trychert_sdk::ChertError> {
let sdk = ChertSdk::new(
    Some(IMessageConfig {
        base_url: "https://messaging.example.test", api_key: "messaging-key",
        tenant: Some("messaging-tenant"), limits: TransportLimits::default(),
    }),
    Some(FaceTimeConfig {
        base_url: "https://facetime.example.test", api_key: "ftk_explicit-key",
        project_id: "00000000-0000-4000-8000-000000000001",
        limits: TransportLimits::default(),
    }),
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

## Supported surface and boundaries

| Surface | Contract |
| --- | --- |
| iMessage | Strict typed text queue acceptance and standard reaction acknowledgement; raw typed JSON transport for other messaging routes |
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
readiness is separate. Call actions accept a reason, but the current server only
validates that reason; it does not persist it in the queued command.

`ChertClient` remains the messaging-only compatibility name; `IMessageClient`
names that role explicitly. Existing imports migrate from `cherthq_imessage` to
`trychert_sdk`. The fixture executable names remain unchanged.

Assistant draft configuration remains versioned JSON validated by the server.
`UpdateAssistant` requires `expected_draft_revision`; conflicts are returned without
retry. Nullable patch fields use `Option<Option<T>>`: `None` preserves, `Some(None)`
clears, and `Some(Some(value))` replaces. Line activation, account/billing/admin,
webhook management and connector protocols have no dedicated typed helpers in this
candidate; use the explicit generic transport for JSON routes, with the required
server permissions. No browser authentication or elevated scope is invented.

`cargo run --example unified` is a read-only example using explicitly supplied
`CHERT_IMESSAGE_URL`, `CHERT_IMESSAGE_KEY`, optional `CHERT_IMESSAGE_TENANT`,
`CHERT_FACETIME_URL`, `CHERT_FACETIME_KEY`, and `CHERT_FACETIME_PROJECT_ID`.
It prints counts/status only, not credentials or customer content.

## iMessage acceptance contract

Messaging `request<T>` decodes the actual response without unwrapping envelopes.
Use `serde_json::Value` to preserve every wire field.

```rust,no_run
use trychert_sdk::ChertClient;
use std::time::Duration;
# async fn example() -> Result<(), trychert_sdk::ChertError> {
let client = ChertClient::new("https://messaging.example.test", "explicit-key",
    Some("tenant"), Duration::from_secs(20), 1024 * 1024)?;
let receipt = client.send_text("+15550000001", "hello",
    Some("caller-stable-key")).await?;
assert_eq!(receipt.status, "queued");
# Ok(()) }
```

`send_text(phone, text, key)` makes one request to `/text-operations/v1` and
requires actual HTTP 202 with exactly `success:true`, a 32-character lowercase
hex public `message_id`, a validated `chat_id` and `status:"queued"`. Its
`QueuedTextReceipt` preserves those four fields; it establishes no service,
delivery, read state or native GUID. Invalid input fails before HTTP. Text and
an optional caller key are preserved exactly (lossless UTF8, no NUL, text at
most 16KiB, key at most 200 bytes). No key is generated automatically.
Unexpected success statuses or receipt shapes fail with
`unconfirmed_text_outcome`; reconcile the explicit error data before retrying.
Non-2xx Chert error codes and raw data remain available without automatic retry.
Generic `request<T>` remains an explicit raw transport, including legacy routes;
it does not acquire this strict policy or route requests to FaceTime.

Use the authenticated cloud messaging origin, whose body is `{phone,body,...}`;
the same-path internal Mac endpoint has a different frozen-tuple contract.
Strict text needs the matching cloud/native operation and installed
FT-INSTALL-095 pair. Local HTTP tests do not establish installation or device
delivery; no package is published. Timeout and dropping the future only cancel
waiting and cannot retract an accepted operation.

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

From the repository root, run `bash scripts/verify-rust-package.sh "$PWD/.amp/in/artifacts"`
after ensuring `/.amp/in/` is excluded locally. The gate compares every archive source
file with the reviewed tree, rejects unexpected members and path/git dependencies,
tests the unpacked archive and a fresh consumer, and records its SHA-256. The exact
artifact still needs human release approval; this script never publishes.

Run `cargo fetch --locked` first on a machine without the dependencies cached.
Tests use std TCP listeners for exact request bytes, tenant/project/auth/body/prefix,
redirect sink refusal, errors/redaction, 204, response limits, timeout and
pre-network namespace validation and dropped-future cancellation.
The lockfile requires Rust 1.88 or newer (ICU dependencies); the suite passes on
Rust 1.88 and the installed stable compiler. HTTPS handshake/platform trust integration and
cross-platform runtime behavior remain unverified. No per-Mac install is needed
for this customer-side SDK source; no package has been published.

Malformed JSON, response type mismatches and oversized bodies on successful HTTP
responses report status 502; unsuccessful HTTP statuses are preserved. Query
values reject raw/encoded controls and nested encodings before network dispatch.

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
