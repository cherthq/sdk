# Chert Rust messaging transport

Unpublished async HTTP client with strict text queue acceptance; no provider compatibility methods, FaceTime
credentials, delivery guarantees or installed-device claims. `request<T>` decodes
the actual JSON response into a caller-selected serde type without unwrapping route
specific envelopes. Use `serde_json::Value` when preserving all wire fields.

```rust,no_run
use cherthq_imessage::ChertClient;
use std::time::Duration;
# async fn example() -> Result<(), cherthq_imessage::ChertError> {
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
it does not acquire this strict policy. No provider SDK or FaceTime API is added.

Use the authenticated cloud messaging origin, whose body is `{phone,body,...}`;
the same-path internal Mac endpoint has a different frozen-tuple contract.
Strict text needs the matching cloud/native operation and installed
FT-INSTALL-095 pair. Local HTTP tests do not establish installation or device
delivery; no package is published. Timeout and dropping the future only cancel
waiting and cannot retract an accepted operation.

Root bases use `/api/v1`; explicit deployment prefixes stay pinned. Paths must be
relative API paths starting with `/`, with optional query parameters (8192-byte total limit), without fragment, traversal, control
characters or encoded separators/nested encodings. HTTPS is mandatory except
parsed localhost/127.0.0.1/[::1] HTTP for local testing. Credentials and optional
tenant are explicit. Ambient proxy settings and redirects are disabled. There
are no automatic retries, including reqwest protocol retries. No telemetry is
added; no vendor fallback exists.

`None` body omits JSON; `Some(Value::Null)` sends JSON null. HTTP 204 decodes null
(use `()` or `Option<T>`). Timeout covers request and response consumption;
response bodies have an explicit byte ceiling. Drop the request future to cancel
local waiting. Cancellation, timeout, dropped responses, redirects and decoding
errors cannot retract an accepted operation: reconcile durable IDs before retry.
The client never invents idempotency keys or replays a request.

Errors expose status, string/numeric wire code, request ID and raw JSON as explicit
fields. Those fields can contain customer data. Display, Debug and source chains
omit server text, identifiers, URLs, credentials and transport internals. Client
Debug also omits credentials and configuration. Do not indiscriminately log raw
error fields. JSON/type errors do not retain parser source chains.

Pinned cached direct dependencies: reqwest 0.13.4 (MIT OR Apache-2.0, rustls + JSON,
default features disabled), serde 1.0.228 and serde_json 1.0.145 (MIT OR Apache-2.0),
test-only tokio 1.48.0 (MIT). Cargo.lock fixes transitive versions. Cached package
manifest license review found permissive license choices throughout (including
Unicode-3.0 data, ISC/BSD crypto and CDLA-Permissive root certificates); no
copyleft-only dependency. No custom TLS or JSON parser is implemented.

Local verification (no cloud/device requests):

```sh
cargo fmt --check
cargo test --offline --locked
cargo clippy --offline --locked --all-targets --all-features -- -D warnings
```

Tests use std TCP listeners for exact request bytes, tenant/auth/body/prefix,
redirect sink refusal, errors/redaction, 204, response limits, timeout and
pre-network namespace validation and dropped-future cancellation.
The lockfile requires Rust 1.88 or newer (ICU dependencies); tests ran on the
installed compiler, not the minimum toolchain. HTTPS handshake/platform trust integration and
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
