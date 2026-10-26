# Chert Python SDK (`chert-sdk`)

Python 3.10+ synchronous SDK with no runtime dependencies and no CLI.
The distribution name is **`chert-sdk`**; the import namespace is **`trychert`**.
[`chert-sdk` 0.1.0](https://pypi.org/project/chert-sdk/0.1.0/) is published on PyPI.
The legacy `chert` import and explicit-URL constructor calls remain compatible.

```sh
python -m pip install chert-sdk==0.1.0
# or: uv add chert-sdk==0.1.0
```

This guide matches the published 0.1.0 package. Unreleased APIs are marked as
source preview and are not in 0.1.0.

```python
from trychert import Chert, IMessageConfig, FaceTimeConfig
```

## Explicit independent channels

```python
from trychert import Chert, IMessageConfig, FaceTimeConfig

sdk = Chert(
    imessage=IMessageConfig(
        api_key="your-imessage-key",
        tenant="your-messaging-tenant",  # optional
    ),
    facetime=FaceTimeConfig(
        token="your-facetime-token",
        project_id="your-facetime-project",
    ),
)
# Either channel may be omitted; its attribute will be None.
identity = sdk.facetime.whoami()
```

This wrapper does not bind servers, provision devices, discover origins, share
credentials, or map messaging tenants to FaceTime projects. Project selection is
FaceTime-only. iMessage defaults to `https://console.trychert.com`; FaceTime
defaults to `https://facetime.trychert.com`. `base_url` is an optional validated
override for self-hosting or tests. Omission alone selects the default; explicit
empty/invalid URLs fail instead of falling back. Existing positional
`ChertClient(base_url, api_key, tenant)` calls are preserved; ordinary users can
call `ChertClient(api_key=...)`. Credentials are still required for protected APIs.
Each channel keeps its own credential.
Credentials are excluded from configuration reprs. Explicit successful login and
connector responses contain secrets: do not log those responses.

**Preview limitation:** default origins and offline contract tests do not establish
live service compatibility. Strict text and reaction availability, and billing
availability at the default origin, remain unverified for this candidate.
There is no alternate-host retry or production-readiness claim.

## Single session (proposed unified-v1 preview)

`Chert.connect(access_token, project_id, *, imessage_base_url=..., facetime_base_url=...)`
is an explicit opt-in factory, separate from the independent-channel constructor
above. **The proposed backend contract is not yet implemented/deployed; this is
an offline-tested source preview, not evidence of live support.** Existing
constructors and legacy credential handling are unchanged.

```python
from trychert import Chert, UnsupportedUnifiedBackend

# Obtain a unified session through the CLI when the contract is available.
# Neither a legacy messaging key nor a legacy FaceTime token is interchangeable.
sdk = Chert.connect(access_token, project_id)
```

The token must be `chu_` followed by 43 base64url characters and the project must
be a dashed UUID. Validation happens before network access. The factory makes
one **unauthenticated** GET to the configured messaging origin's
`/api/v1/sdk/capabilities`, with a 15-second socket timeout and 64 KiB response
limit. Default trusted origins are `https://console.trychert.com` and
`https://facetime.trychert.com`; overrides must be explicit HTTPS origins (or
loopback HTTP), without paths, credentials, queries or fragments.

The descriptor must advertise `contract="chert-unified"`, `contract_version=1`,
Bearer authentication, prefix `chu_`, audience `chert.unified-api:v1`, and the
approved FaceTime `/api/v1/cli/logins` URL. Both service URLs must exactly match
their approved origins plus `/api/v1`. All six scopes are required:
`imessage:events:read`, `imessage:webhooks:manage`, `imessage:messages:send`,
`facetime:calls:read`, `facetime:calls:create`, `facetime:calls:control`.
Descriptor URLs never authorize a new host or credential forwarding.

Only after successful discovery do both channel clients receive the same token.
FaceTime retains its project header; messaging has no arbitrary tenant selection.
Every unified request, including SSE, sends
`X-Chert-Contract: chert-unified-v1` and requires that exact response echo before
parsing JSON or yielding frames. Missing, different, or duplicate echoes fail
closed with `UnsupportedUnifiedBackend` (`code="unsupported_unified_backend"`).
Old 404 endpoints, malformed descriptors, or incompatible capabilities also fail
closed. There is no fallback, token conversion, refresh, redirect following,
ambient proxy authentication, or automatic retry. Existing response limits and
socket timeouts still apply after discovery.

The CLI owns device login; this factory does not start it. The unified
`imessage:messages:send` scope authorizes the existing `sdk.imessage.send_text`
operation: POST `/api/v1/text-operations/v1` with `phone`, `body`, and optional
`idempotency_key`. There is no route remapping: the exact HTTP 202 queued receipt
and strict validation described below are unchanged, with the unified token and
contract-header guard added by the factory. FaceTime `logout()` remains POST
`/api/v1/cli/logout`. Advertising a scope does not establish that a particular
deployment is implemented, authorized, or production-ready.

## FaceTime control plane

`ChertControlPlane(base_url='https://facetime.trychert.com', *, token=None, project_id=None, timeout=15.0)` exposes
the FaceTime control-plane API with Python snake_case methods:

| Scope | Methods |
| --- | --- |
| Public (no auth or project header) | `begin_login(device_name)`, `poll_login(device_code)` |
| User (bearer only) | `inspect_login(user_code)`, `approve_login(user_code, project_id)`, `logout()` |
| Project (bearer and `x-chert-project-id`) | `whoami()`, `list_credentials()`, `revoke_credential(credential_id)`, `list_lines(limit=None, offset=None)`, `list_workers(limit=None, offset=None)`, `list_connectors()`, `enroll_connector(enrollment)`, `activate_connector(binding_id, expected_binding_id, assignment_generation)`, `drain_connector(binding_id)`, `revoke_connector(binding_id)` |
| Billing (user bearer and `x-chert-project-id`) | `billing_status()`, `create_checkout(plan=..., coupon_code=None, idempotency_key=...)`, `cancel_subscription(idempotency_key=...)`, `validate_coupon(coupon_code, idempotency_key=...)` |

Pagination parameters and checkout arguments are keyword-only. Enrollment uses
a `ConnectorEnrollment` dictionary. Wire models live in `trychert.models`;
annotations describe server responses, not full runtime schema validation.
Mutating methods can have effects; reconcile uncertain results before retrying.

### Calls: public control-plane methods

These methods work on `sdk.facetime` from `Chert.connect(...)` and on an explicitly
configured `ChertControlPlane`. All require bearer authentication and the selected
project header. Unified sessions additionally enforce the contract echo.

| Method | Route | Return model |
| --- | --- | --- |
| `list_calls(limit=None, offset=None)` | GET `/api/v1/calls` | `CallPage` (`items`, `total`, `limit`, `offset`) |
| `get_call(call_id)` | GET `/api/v1/calls/{id}` | `CallDetail` |
| `get_call_events(call_id)` | GET `/api/v1/calls/{id}/events` | `CallEvents` (`call_id`, `events`) |
| `create_call(body, idempotency_key=...)` | POST `/api/v1/calls` | `CallDetail` |
| `answer_call(call_id, body=None, idempotency_key=...)` | POST `/api/v1/calls/{id}/answer` | `CallDetail` |
| `reject_call(call_id, body=None, idempotency_key=...)` | POST `/api/v1/calls/{id}/reject` | `CallDetail` |
| `end_call(call_id, body=None, idempotency_key=...)` | POST `/api/v1/calls/{id}/end` | `CallDetail` |

Pagination is keyword-only (limit 1–100; offset nonnegative). Mutations require a
keyword-only stable `Idempotency-Key`: 8–200 printable non-space ASCII characters,
preserved exactly, never generated or retried automatically. Action bodies default
to `{}` and may contain `reason`. Call IDs are encoded as one URL segment.

```python
from trychert.models import CreateCall

# Explicit effect: only call authorized recipients with provisioned resources.
request: CreateCall = {
    "direction": "outbound", "mode": "managed", "assistant_id": assistant_id,
    "destination": recipient, "media": {"audio": True, "video": False},
}
call = sdk.facetime.create_call(request, idempotency_key="one-reviewed-call")
timeline = sdk.facetime.get_call_events(call["id"])
```

`CreateCall` models managed calls (assistant required, no room credentials) and
production customer-managed/BYOR calls (line and all three `ByorRoom` fields
required: `livekit_url`, `participant_token`, `remote_participant_identity`; audio
must be enabled). Select a single `destination` with optional `destination_type`,
or `recipients` with an explicit line, never both. Managed calls enable audio or
video; FaceTime links require an explicit line. Bodies pass through unchanged;
these typed models do not replace server validation or provisioning. Keep BYOR
credentials and call payloads out of logs.

`CallDetail.facetime_call_events` contains detail events with `event_type`,
`created_at`, and `payload`. The separate `CallEvents.events` timeline contains
normalized `type`, `at`, nullable `sequence`, and `source`—not detail payloads.
`get_call_events` is one bounded, finite JSON response, **not SSE**, not an HTTP
audio/video stream, and not a subscription to LiveKit tracks. BYOR media uses
LiveKit in the caller's runtime. A queued/accepted control-plane response does
not prove connection, delivery, or media success. Reconcile uncertain outcomes
before an intentional retry. The 15-second socket timeout is not a total deadline.
These additions remain offline-tested source preview, not live deployment proof.

Billing uses `GET /api/v1/billing` for status and `POST /api/v1/billing`
with `action` set to `checkout`, `cancel`, or `validate_coupon`. All billing
requests require a user bearer token and project selection; an API key is not a
substitute. Every POST requires a stable printable-ASCII `Idempotency-Key`
(8–200 characters after surrounding whitespace is removed). The SDK does not
retry. Reuse the same key and inputs only when intentionally retrying the same
operation after reconciling an uncertain result.

Checkout takes `plan='shared'` or `'dedicated'` and an optional `coupon_code`,
and returns `CheckoutSession` containing only `url`. Plan acceptance does not
guarantee availability. Coupon validation requires `coupon_code`; codes must be
nonblank and at most 64 characters after trimming. `CouponValidation` contains
`code`, `percent_off`, `mode` (`live` or `test`), and `currency`; `monthly_total`
is optional. Additional server-returned fields are preserved unchanged.
The server determines coupon eligibility; no coupon is promised by the SDK.
Cancellation returns `BillingCancellation` with `status='cancellation_requested'`
and `message`, not proof of completed cancellation. Refresh status to confirm.
`BillingStatus` contains nullable `entitlement`, `needs_reconciliation`, nullable
`sales_enabled`, `shared_available`, and `dedicated_available`. The entitlement
is preserved as an extensible JSON object, not modeled as a checkout record.

**Pre-release preview compatibility:** `billing_catalog()` and
`current_checkout()` and the `BillingPlan`, `BillingCatalog`, and `Checkout`
models were removed because they described unsupported routes/shapes. Use
`billing_status()` for status, not as a catalog or checkout-record substitute.
`create_checkout(plan_id=..., catalog_version=...)` is replaced by
`create_checkout(plan=..., idempotency_key=...)`; migrate callers explicitly.
There are no aliases that silently change returned data or authentication.

FaceTime requires an HTTPS origin (or loopback HTTP), without a path, credentials,
query, or fragment. Omit `base_url` to use the production default; explicit empty
or invalid overrides are rejected, never silently replaced. Requests append
`/api/v1/` exactly once; successful `{data: ...}` envelopes
are unwrapped, including explicit null. Missing data, invalid JSON, and responses
over 1 MiB fail. Redirects, ambient proxy/netrc credentials, and automatic retries
are disabled. Missing credentials/project fail before HTTP. Headers must be
nonempty printable ASCII. Pagination rejects booleans and non-integers.

`ChertControlPlaneError` exposes sanitized `status` and an allowlisted `code`,
never raw server bodies, URLs, or underlying exception context. Unknown server
codes become `request_failed`; malformed responses use `invalid_response`;
transport failures and redirects use status 0 / `network_error`.
These are control-plane operations, not FaceTime media/calling APIs or evidence
that a connector is provisioned or a call succeeded.

## Existing iMessage transport

The generic `request` operation matches the JavaScript core's raw Chert API
transport. `send_text` adds the strict plaintext reservation contract, and
`send_reaction` adds the explicit standard-reaction dispatch contract.

```python
from trychert import ChertClient, ChertAPIError

client = ChertClient(
    base_url="https://your-messaging-origin.example",
    api_key="your-chert-key",
    tenant="your-tenant",  # optional when server policy permits bearer-only auth
)
identity = client.request("/whoami")
# Explicit requests can have effects; this example is read-only.
```

An origin-only base URL defaults to `/api/v1`. An explicit base path is retained:
`https://host/deployment` plus `/whoami` requests `/deployment/whoami`.
Request paths are relative to that prefix, even though they begin with `/`.
Method defaults to GET without `body`, POST when `body` is supplied.
`body=None` sends JSON `null`; omitted body sends no bytes. HTTP 204 returns
`None`; other successful responses return the actual JSON without fabricated
status, delivery/read evidence, timestamps or IDs. There are no automatic sends,
account selection, callbacks, retries or live-provider compatibility claims.

The actual route and deployment determine which operations are available.
For example, messaging `/send`, `/chats`, `/messages/{id}`, `/typing` and
`/whoami` have different request/response contracts. This client does not pretend
those contracts are the FaceTime API or a complete provider SDK. Availability
and status lookup depend on the service's supported contract.

## Typed strict plaintext

```python
# This explicit method has effects. Run only with an authorized recipient.
receipt = client.send_text(
    "+15550000002", "Exact plaintext", idempotency_key="unique-operation-key"
)
# QueuedTextReceipt: success, message_id, chat_id, status="queued".
```

`send_text(phone, text, *, idempotency_key=None)` sends one POST to
`/text-operations/v1` through the same pinned transport. It requires canonical
E.164, nonblank lossless UTF-8 text of at most 16 KiB without NUL, and an optional
nonempty lossless UTF-8 key of at most 200 bytes without NUL. Text and keys are
not trimmed or normalized. Blankness matches ECMAScript `String.trim`, including
BOM; U+0085 and U+001C remain valid nonblank text. It accepts only HTTP 202 with exactly the four
receipt fields, a lowercase 32-hex public message ID, a bounded safe chat ID,
and strict `success=True`/`status="queued"`. No native GUID, service,
sent/delivered/read state or timestamps are invented.

`QueuedTextReceipt` is exported as a `TypedDict`; the wheel includes `py.typed`.
An unexpected successful status or receipt raises sanitized
`ChertAPIError(502, "unconfirmed_text_outcome")`. Other transport/API errors
keep the existing codes. Raw response data—including any server-returned
reconciliation IDs—is available only through explicit `error.data`; error
formatting does not expose it. A timeout, redirect, malformed response, or
unconfirmed outcome never authorizes a resend or a fresh operation key.
Use the same explicit key for intended idempotent retries only under the
server's documented reconciliation policy; this client never retries itself.

A queued receipt identifies a cloud operation, not physical messaging proof.
Availability depends on a compatible service; neither SDK packaging nor these offline tests prove deployment
or delivery. This synchronous method adds no cancellation token or async API;
existing socket timeout behavior is unchanged.

## Typed standard reactions

```python
# Explicit effect: use an owned chat/message and an authorized target.
reaction = client.send_reaction(
    "11aa0000-0000-4000-8000-000000000001", "recorded:message-id", "like",
    remove=False, idempotency_key="one-reviewed-reaction",
)
# Frozen ReactionReceipt: operation_id, chat_id, message_id, status="acknowledged".
```

`send_reaction(chat_id, message_id, reaction, *, remove=False, idempotency_key=None)`
POSTs exactly `{reaction, remove, part_index: 0}` to
`/chats/{chat_id}/messages/{message_id}/reactions`. It performs no implicit
message lookup. Only `love`, `like`, `dislike`, `laugh`, `emphasize`, and
`question` are supported, with a real boolean `remove`. Chat IDs must be dashed
UUIDs and are canonicalized to lowercase. Message IDs are case-preserved ASCII
`[A-Za-z0-9:_.-]` of 1–160 characters, excluding `.` and `..`, and encoded as one
URL segment. Custom emoji and nonzero parts are outside this subset.

The optional `Idempotency-Key` header accepts 1–200 printable ASCII bytes,
without leading/trailing spaces; internal spaces are preserved. This is narrower
than `send_text`'s UTF-8 JSON key because this key is carried in an HTTP header.
No key or message ID is trimmed or normalized.

Only actual HTTP 202 with exactly `operation_id`, `chat_id`, `message_id`, and
`status="acknowledged"` produces the exported frozen `ReactionReceipt` dataclass.
The public operation ID must be lowercase 32-hex and both returned identities
must match the request. Wrong successful statuses/receipts raise sanitized
`ChertAPIError(502, "unconfirmed_reaction_outcome")`; other API/transport errors
retain existing codes and explicit raw `error.data`. There is one attempt, no
fallback or automatic retry, and no new async cancellation API. An acknowledgement
proves dispatch acceptance, not applied/current reaction state, recipient receipt,
or an SMS-fallback guarantee. Offline package tests do not establish a live Python
reaction or deployment claim; a compatible service remains required.

## Messaging events and webhooks (source preview)

These methods match the public source contract and synthetic loopback tests;
they are **not production-verified**. Use iMessage tenant credentials (the
messaging API key and optional `X-Chert-Tenant`), not a FaceTime bearer token.

```python
from contextlib import closing
from trychert import ChertClient, verify_webhook

client = ChertClient(api_key="your-messaging-key", tenant="your-tenant")
page = client.list_events(type="message.received", limit=100)
record = client.get_event(page["events"][0]["id"])  # database row ID, not event_id

# One connection, no reconnect. closing() releases the socket even on break.
with closing(client.stream_events(since="server-issued-continuation")) as frames:
    for frame in frames:
        if frame["event"] == "close":
            break
        # Handle message/error frames deliberately; data is the actual JSON.
```

`list_events` GETs `/events`, with keyword-only `type`, `status`, `lead_id`,
`since`, `cursor`, and integer `limit` (1–200). It returns `events`, nullable
`next_cursor`, and `count`. `get_event(row_id)` GETs `/events/{row_id}`.
The record's `delivery.status`, attempts and delivered timestamp describe
**webhook delivery**, not the underlying message's sent/delivered/read state.
Event payloads and names are service-defined; models preserve additional fields.

Pass pagination cursors and SSE `since` values back unchanged. Some servers
use timestamps, others composite timestamp/ID continuations. Do not manufacture,
split, normalize, or transfer a continuation between deployments. Timestamp-only
servers may not distinguish events sharing a timestamp; consumers must reconcile
and deduplicate rather than infer lossless/exactly-once delivery.

`stream_events(since=None)` GETs `/events/stream` with `Accept: text/event-stream`.
It yields dictionaries with `event` (default `message`) and JSON `data`, including
named `error` and `close` frames. An error frame does not itself end the stream;
a close frame is yielded and ends this connection. Comments are skipped, UTF-8
fragmentation, multiline data, CR/LF/CRLF are supported, and unterminated frames
are not dispatched. Frames are bounded to 1 MiB; malformed JSON/UTF-8 or oversize
frames raise sanitized `invalid_event_stream`. The existing socket timeout
applies. Explicit iterator `close()` releases the response; this is not concurrent
in-flight cancellation. EOF does not reconnect. No `Last-Event-ID`, implicit
retry, or replay helper is supplied. Reconcile before explicitly opening another
connection, even when a close frame carries `reconnect_with_since`.

Subscription methods preserve the HTTP response envelopes:

| Method | Route / result |
| --- | --- |
| `list_webhook_subscriptions()` | GET `/webhook-subscriptions`; `{subscriptions: [...]}` |
| `get_webhook_subscription(id)` | GET `/webhook-subscriptions/{id}`; `{subscription: ...}` |
| `create_webhook_subscription(body)` | POST collection; `{subscription: ...}` including `secret` |
| `update_webhook_subscription(id, body)` | PATCH item; `{subscription: ...}` |
| `delete_webhook_subscription(id)` | DELETE item; `{deleted: true, id: ...}` |

Create bodies require `url`, with optional `events` and `version`. Update bodies
allow `url`, `events`, `version`, and `is_active`. Returned subscriptions include
`id`, `url`, `events`, `version`, `is_active`, `created_at`, and optional failure
counters/timestamps. Store the creation secret securely; do not log it. Mutations
are explicit and never retried. There is no replay method because targeting is
not portable between services.

Use `verify_webhook(raw_body, signature, secret)` **before** JSON parsing. Prefer
the exact HTTP body bytes; a string is UTF-8 encoded without normalization. It
returns a boolean for `v1,timestamp,hex` HMAC-SHA256 over the ASCII timestamp,
`.` and the exact body, with a ±300-second window and constant-time digest
comparison. Re-serializing JSON invalidates the signature. This helper does not
parse JSON or maintain a replay store; deduplicate authenticated event IDs in
your application. Keep the host clock synchronized.

Messaging SSE is not FaceTime audio/video. BYOR (bring your own runtime) media
uses LiveKit, not these HTTP event streams.

## Transport boundaries

- Explicit HTTPS, or HTTP on `localhost`, `127.0.0.1` or `::1` only. URL user
  information, base queries/fragments, control characters, path traversal and
  encoded separators are rejected before network. URLs are capped at 16,384
  characters before parsing and after canonicalization. Authentication headers and
  tenant are pinned; requests cannot override headers or destinations.
- TLS uses Python's default certificate verification. Ambient proxies and
  netrc authentication are unused. Redirects are never followed, including
  a 307 after a POST. A redirect is an unknown outcome, not proof no action ran.
- Exactly one attempt. `timeout` defaults to 15 seconds and must be finite and
  positive. This is synchronous socket I/O timeout behavior, not a total operation
  deadline or in-flight cancellation. There is no async/AbortSignal equivalent.
- JSON response reads are capped at `max_response_bytes` (default 8 MiB); exceeding it
  raises `response_too_large`. Request and response JSON reject NaN/Infinity, including exponent overflow.
- `ChertAPIError` exposes `status`, string `code`, `request_id` and explicit raw
  `data`. Its string/repr and exception context omit credentials and response
  content. Raw `data` can contain customer information; access it deliberately.
  Transport failures have status 0 and code `timeout` or `transport_error`.
  Invalid JSON uses `invalid_response`; redirects use `redirect_blocked`.
  Neither errors nor a timeout authorize resending an uncertain mutation.

## Local checks and packaging

```sh
uv venv .amp/in/python-tooling
uv pip install --python .amp/in/python-tooling/bin/python build twine 'setuptools>=80.10.2'
.amp/in/python-tooling/bin/python -m unittest discover -s python/tests -v
.amp/in/python-tooling/bin/python -m build --installer uv --outdir .amp/in/artifacts/python-unified python
.amp/in/python-tooling/bin/python -m twine check --strict .amp/in/artifacts/python-unified/*.whl .amp/in/artifacts/python-unified/*.tar.gz
```

Tests use a real loopback `ThreadingHTTPServer`, never cloud/device/provider
access. They cover auth/body/tenant mapping, null/204, errors and sanitization,
redirect rejection, timeout single attempts, bounded reads and parser/encoder recursion faults, ambient proxy/netrc
isolation, input rejection, strict text receipt/status/UTF-8 validation, reaction identity/status/HTTP-header
validation and six-kind add/remove payloads, and
importing a built wheel in an isolated process.
Python 3.14 was exercised locally; the source targets 3.10+, but this does not
claim a tested interpreter matrix or production/deployment acceptance.

Run these commands from the repository root. Tooling lives in an isolated venv;
do not modify system Python. Setuptools is a build-only dependency.
The unified loopback tests cover all 19 FaceTime operations, explicit auth scopes,
cross-channel credential isolation, redaction, response bounds, and one-attempt
transport behavior. Existing messaging tests retain their original contracts.

MIT metadata follows the existing `@cherthq/imessage` manifest. This work adds no
invented copyright attribution. Building and checking do not publish the package.
