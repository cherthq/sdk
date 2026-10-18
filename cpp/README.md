# Chert C++ messaging transport

Unpublished C++20 library for the existing Chert messaging HTTP API. It uses
installed libcurl (curl permissive license) and nlohmann/json (MIT); CMake does
not download dependencies. Locally verified versions: curl 8.21.0 and JSON 3.12.0.
It is separate from the macOS worker and loads no injected Apple frameworks.
A thread-safe libcurl build (7.84+) with asynchronous DNS is required and checked
at startup. Windows/Linux and minimum dependency versions have not been tested.

```cpp
#include <chert/client.hpp>
chert::Client client("https://your-chert.example", your_api_key);
auto result = client.request("/messages/your-recorded-message-id");
// Read actual returned lifecycle evidence; an accepted send is not delivery.
```

Link the CMake target `chert::sdk`. `request(path, optional_json, method)` defaults
to GET without a body or POST with one; an explicit JSON null is a POST body.
HTTP 204 and successful HEAD return an empty optional, distinct from a JSON null result. Other JSON
responses retain their route-specific wire shapes. This is a generic messaging
transport, not provider wrappers, a FaceTime client or full typed resource coverage.

## Typed strict plaintext

```cpp
// Explicit effectful call: use only an authorized recipient.
auto queued = client.send_text("+15550000002", "Exact plaintext", "unique-operation-key");
// QueuedTextReceipt: success, message_id, chat_id, status == "queued".
```

`send_text(phone, text, optional_key)` makes one POST to `/text-operations/v1`
through the same transport. Canonical E.164 and nonblank, lossless UTF-8 text
of at most 16 KiB without NUL are required. An optional key must be nonempty,
lossless UTF-8, at most 200 bytes, and contain no NUL. Payload whitespace and
keys are preserved, not trimmed or normalized. Blankness follows the actual
route's ECMAScript whitespace rules; UTF-8 validity uses the existing JSON
library. The method requires actual HTTP 202 with exactly four receipt fields,
strict Boolean `success=true`, `status="queued"`, a lowercase 32-hex public ID,
and a safe chat ID of 1–160 ASCII letters/digits/colon/underscore/hyphen.

Unexpected successful status or receipt shape raises sanitized
`ApiError(502, "unconfirmed_text_outcome", ...)`; raw response data is explicit
only in `error.data`. Other HTTP/transport errors keep existing behavior. No
native GUID, service, sent/delivered/read state or timestamps are fabricated.
Queued is a cloud operation identity, not physical messaging evidence. Do not
resend or change the operation key after an uncertain outcome without the
server's reconciliation policy. The client never retries itself.

The method is synchronous and adds no cancellation API. Deployment requires
the compatible cloud route and installed native worker/helper; the offline
fixture is not proof of their installation or device acceptance.

## Typed reaction dispatch acknowledgement

```cpp
auto receipt = client.send_reaction(chat_uuid, public_message_id, "love", false,
                                    "unique reaction key");
// ReactionReceipt: operation_id, canonical chat_id, exact message_id,
// status == "acknowledged". This is not recipient application proof.
```

`send_reaction(chat_id, message_id, reaction, remove=false, optional_key)` sends
one POST to `/chats/{chat_id}/messages/{message_id}/reactions` with exactly
`{reaction, remove, part_index:0}`. Only `love`, `like`, `dislike`, `laugh`,
`emphasize` and `question` are supported. The server must establish the owned
single-plaintext target; groups, custom emoji, stickers and other part indices
are not added by this client.

Chat IDs must be dashed UUIDs; their ASCII hex case is canonicalized to lowercase
for the request and receipt. Message IDs preserve case and accept 1–160 ASCII
letters/digits/colon/underscore/dot/hyphen, excluding `.` and `..`; colons are
percent-encoded in the path. No message/native GUID is case-normalized.

Unlike the JSON key in `send_text`, the optional reaction key is an HTTP
`Idempotency-Key` header: 1–200 printable ASCII bytes, with no leading/trailing
space. Internal spaces are preserved; controls, DEL and non-ASCII reject before
HTTP. There is no arbitrary-header override API.

Success requires HTTP202 and exactly four fields: a lowercase 32-hex
`operation_id`, matching canonical `chat_id`, exact requested `message_id`, and
`status:"acknowledged"`. A native UUID, extra fields, inconsistent IDs or another
successful HTTP status raises sanitized `unconfirmed_reaction_outcome` with the
explicit raw response available in `ApiError::data`. Transport and HTTP errors
retain their existing behavior. There is one attempt, no fallback or automatic
resend, and no added cancellation API. An uncertain result must be reconciled;
it does not establish that no reaction occurred. No applied-state, current
reaction, delivery, timestamp or live-device acceptance is claimed.

The origin must be explicit HTTPS or loopback HTTP, with no URL credentials,
query or fragment. A root origin defaults to `/api/v1/`; a deployment prefix is
preserved. Paths stay inside that prefix; encoded separators, double escapes,
dot segments and control characters reject before dispatch. API key/tenant
headers reject whitespace/control characters. Credentials cannot be overridden
per request. Environment proxies and netrc are disabled, TLS verification stays
enabled, and redirects are returned as errors. The automatic large-upload
`Expect` header is disabled to avoid its 417 retry path. There is one request attempt and
no retry or transport fallback. The synchronous operation has a positive finite
timeout (default 15 seconds), an 8 MiB response limit, and no cancellation API.

`ApiError::what()` contains no response content, credentials or endpoint. Its
status, code and request ID support reconciliation; `data` deliberately retains
raw JSON and may contain customer content. A timeout, disconnect or response
limit error is `outcome_unknown`, never proof that a send had no effect.

```sh
cmake -S sdk/cpp -B /tmp/chert-cpp-sdk -DCHERT_SANITIZERS=ON
cmake --build /tmp/chert-cpp-sdk
ctest --test-dir /tmp/chert-cpp-sdk --output-on-failure
```

The loopback fixture exercises real HTTP, authentication/header preservation,
JSON/error handling, response limits, timeout, redirect refusal and single POST
attempts. A separate strict-text gate checks exact 202 receipts, invalid UTF-8,
byte/key boundaries, malformed/UUID receipts and one-attempt fault paths.
The reaction gate adds 30 exact HTTP attempts covering all six names, removal,
encoded IDs, canonical chat case, header keys and malformed/unknown outcomes;
invalid inputs make no HTTP request.
It performs no live messages and does not establish deployed Chert
authentication, actual route compatibility or provider/device acceptance.
No per-Mac installation is required for this customer HTTP client.

The transport settings follow libcurl's official documentation for
[redirects](https://curl.se/libcurl/c/CURLOPT_FOLLOWLOCATION.html),
[explicit proxy disabling](https://curl.se/libcurl/c/CURLOPT_PROXY.html) and
[DNS timeout constraints](https://curl.se/libcurl/c/CURLOPT_NOSIGNAL.html).
