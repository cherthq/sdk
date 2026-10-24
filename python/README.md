# Chert Python SDK (`chert-sdk`)

Unpublished Python 3.10+ synchronous SDK with no runtime dependencies and no CLI.
The distribution name is **`chert-sdk`**; the import namespace is **`trychert`**.
Install the built wheel and import `trychert`. The legacy `chert`
import and explicit-URL constructor calls remain compatible.

```sh
# Install a locally built artifact; no PyPI release is claimed yet.
python -m pip install ./chert_sdk-0.1.0-py3-none-any.whl
```

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
`code`, `percent_off`, `mode` (`live` or `test`), `monthly_total`, and `currency`.
The server determines coupon eligibility; no coupon is promised by the SDK.
Cancellation returns `BillingCancellation` with `status='cancellation_requested'`
and `message`, not proof of completed cancellation. Refresh status to confirm.
`BillingStatus` contains nullable `entitlement`, `needs_reconciliation`, nullable
`sales_enabled`, `shared_available`, and `dedicated_available`. The entitlement
is preserved as an extensible JSON object, not modeled as a checkout record.

**Unpublished preview compatibility:** `billing_catalog()` and
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
- Response reads are capped at `max_response_bytes` (default 8 MiB); exceeding it
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
