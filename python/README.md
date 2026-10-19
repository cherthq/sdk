# Chert Python transport

Private, unpublished Python 3.10+ JSON client with no runtime dependencies.
Its generic `request` operation matches the JavaScript core's raw Chert API
transport. `send_text` adds the strict plaintext reservation contract; provider
SDK wrappers and FaceTime methods are not implemented. `send_reaction` adds an
explicit standard-reaction dispatch contract.

```python
from chert import ChertClient, ChertAPIError

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
those contracts are the FaceTime API or a complete provider SDK. Status lookup
also depends on the installed native worker and durable cloud record.

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
Availability depends on the compatible cloud route and installed native
server/helper; neither SDK packaging nor these offline tests prove deployment
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
reaction or deployment claim; compatible cloud/native installation remains required.

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
PYTHONPATH=sdk/python python3 -m unittest discover -s sdk/python/tests -v
```

Tests use a real loopback `ThreadingHTTPServer`, never cloud/device/provider
access. They cover auth/body/tenant mapping, null/204, errors and sanitization,
redirect rejection, timeout single attempts, bounded reads and parser/encoder recursion faults, ambient proxy/netrc
isolation, input rejection, strict text receipt/status/UTF-8 validation, reaction identity/status/HTTP-header
validation and six-kind add/remove payloads, and
importing a built wheel in an isolated process.
Python 3.14 was exercised locally; the source targets 3.10+, but this does not
claim a tested interpreter matrix or production/deployment acceptance.

The package uses setuptools, already present in the development environment,
as its build-only backend; runtime dependencies are empty. A wheel can be built
without downloading dependencies with the installed backend:

```sh
cd sdk/python
python3 -c 'import setuptools.build_meta as b; b.build_wheel("dist")'
```

MIT metadata follows the existing `@cherthq/imessage` manifest. This work adds no
invented copyright attribution and does not publish or install the package.
