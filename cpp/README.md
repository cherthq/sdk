# chert-sdk for C++

Unpublished C++20 HTTP library for Chert iMessage and FaceTime. It uses
installed libcurl (curl permissive license) and nlohmann/json (MIT); CMake does
not download dependencies. Locally verified versions: curl 8.21.0 and JSON 3.12.0.
It depends only on public HTTP APIs, libcurl and nlohmann/json.
A thread-safe libcurl build (7.84+) with asynchronous DNS is required and checked
at startup. Linux CI and local macOS builds are tested; Windows and minimum
dependency versions have not been tested.

```cpp
#include <trychert/client.hpp>
trychert::Client sdk({
    {.api_key = imessage_key, .tenant = imessage_tenant},
    {.api_key = facetime_key, .project_id = facetime_project_uuid}
});
auto lines = sdk.facetime.list_lines({50, 0});
auto& client = sdk.imessage;
auto result = client.request("/messages/your-recorded-message-id");
// Read actual returned lifecycle evidence; an accepted send is not delivery.
```

Omitted `base_url` selects `https://console.trychert.com` for iMessage and
`https://facetime.trychert.com` for FaceTime. Root origins receive `/api/v1`
exactly once, never `/api`. To use a test or self-hosted server, set `.base_url`
before `.api_key` in the designated initializer. Explicit prefixes are preserved;
empty/invalid overrides reject rather than falling back. Constructors are offline.

**Publication hold:** this is an untagged source preview. Local contract tests
do not establish production service availability. No production default
reaction-routing claim is made. Generic billing transport is not a promise of
billing availability. Verify the APIs needed by your application before use.

**Credentials remain separate.** iMessage sends its Bearer key and optional
`X-Chert-Tenant`; FaceTime sends its own Bearer key and required UUID
`X-Chert-Project-Id`. There is no common credential, token fallback, automatic
tenant/project derivation, environment lookup, or claim of server-side binding.
Construct `IMessageClient(IMessageOptions)` or `FaceTimeClient(FaceTimeOptions)`
directly when only one channel is needed. A FaceTime project API key needs the
route's read/write scope; CLI login tokens do not acquire call-write or
browser-session permissions merely by being supplied here.

## Build, install and consume

```sh
cmake -S cpp -B /tmp/trychert-build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build /tmp/trychert-build --parallel
cmake --install /tmp/trychert-build --prefix /tmp/trychert-install
cmake -S cpp/examples -B /tmp/trychert-example -DCMAKE_PREFIX_PATH=/tmp/trychert-install
cmake --build /tmp/trychert-example
/tmp/trychert-example/trychert-example  # offline: constructs clients, sends nothing
```

Consumers use `find_package(trychert 0.1 CONFIG REQUIRED)` and
`target_link_libraries(app PRIVATE trychert::trychert)`. Installed dependencies
are required at consumer configure time; no machine-specific dependency paths
are exported. Set `CURL_ROOT`/`CMAKE_PREFIX_PATH` when dependencies are not on
the normal CMake search path. Both static (default) and `BUILD_SHARED_LIBS=ON`
builds are supported on the verified platform. No ABI stability is promised at 0.1.

The public distribution identity is **`chert-sdk`**: source archives are named
`chert-sdk-0.1.0-Source.tar.gz`, and binary archives use
`chert-sdk-0.1.0-<system>-<architecture>-static.tar.gz` (or `-shared.tar.gz`).
The C++ namespace, headers, library filename and CMake discovery/target remain
`trychert` to preserve consumer source and build compatibility. Distribution
names are not C++ identifiers; use `find_package(trychert)`, not
`find_package(chert-sdk)`. No registry package or publication is implied.

`<chert/client.hpp>` and `chert::Client` remain source-compatible aliases for
the iMessage-only client, not the new facade. The old `cherthq::imessage` target
is available for source builds only; installed consumers use `trychert::trychert`.
Existing binaries must be rebuilt after the namespace change.

`examples/inspect.cpp` performs only construction by default. With any argument,
it requires `CHERT_IMESSAGE_KEY`, `CHERT_FACETIME_KEY`, and `CHERT_FACETIME_PROJECT`,
accepts optional `CHERT_IMESSAGE_TENANT`, `CHERT_IMESSAGE_URL` and
`CHERT_FACETIME_URL` overrides, and performs read-only identity/line requests.
The SDK itself never reads these environment variables.

## FaceTime coverage and contracts

| Surface | C++ API | Return / semantics |
|---|---|---|
| Call list/detail | `list_calls`, `get_call` | `Result<Page<Call>>`, `Result<Call>` |
| Outbound audio/video | `create_call(CreateCall, key)` | HTTP 201 call snapshot; not call completion |
| Managed / BYOR | `CallMode`, optional `RoomCredentials` | Managed requires assistant; production BYOR requires line and all room fields |
| Phone/email/Apple ID/link/group | `destination`, `destination_type`, `recipients` | Destination or recipient list, never both; server canonicalizes/admit-checks |
| Answer/reject/end | `act_on_call(id, CallAction, key, reason)` | HTTP 202 current call; command queued, not completed |
| Call events/transcripts | `get_call_events`, `get_transcript` | Typed ordered records; optional event sequence is preserved |
| Lines/worker health | `list_lines`, `list_workers` | Typed paginated records with additional server fields retained |
| Line configuration | `update_line(id, UpdateLine)` | PATCH; distinguish omitted, null and assigned references |
| Other customer JSON routes | `request(path, body, method, key)` | `Result<Json>` escape hatch, not full typed management coverage |

`Result<T>` contains `data`, `request_id`, and HTTP `status`. FaceTime unwraps
the required `{data, request_id}` envelope. iMessage does not unwrap responses.
Typed FaceTime operations reject missing/malformed fields, wrong statuses,
wrong call IDs/projects, malformed pages and Boolean-as-integer transcript
versions with sanitized `ApiError(502, "invalid_response", ...)`. A malformed
successful mutation response remains an uncertain outcome, never permission to
redial. API failures retain server code/status and envelope request ID, and raw
data is deliberately available only for explicit inspection.

Request enums are closed; response status strings are open for forward
compatibility. `Call::fields`, `Line::fields`, and `Worker::fields` retain the
original JSON, including optional/additive lifecycle and media fields, without
inventing defaults. Do not log these objects indiscriminately. A call status alone
does not prove media readiness. This HTTP client does not relay audio/video,
verify incoming webhook signatures, or provide provider-compatibility adapters.
Assistant/integration/webhook administration and account/billing/device-login
flows currently use the JSON escape hatch where the credential is authorized;
they do not have dedicated typed C++ wrappers.

```cpp
trychert::CreateCall call;
call.line_id = authorized_line_uuid;
call.destination = authorized_recipient;
call.destination_type = trychert::DestinationType::phone;
call.room = trychert::RoomCredentials{livekit_url, participant_token, agent_identity};
// Explicit effectful call. Preserve this key and reconcile uncertain results.
auto accepted = sdk.facetime.create_call(call, stable_operation_key);
```

FaceTime idempotency keys are 8–200 printable ASCII bytes, without surrounding
spaces. Typed calls validate IDs, enum values, bounded text and mutually exclusive
request shapes before HTTP; the server remains authoritative for destinations,
JWT validity, ownership, feature flags and capabilities. Text fields are bounded
in UTF-8 bytes (conservative versus some server character-count limits).
Pagination is explicit: limit 1–100, nonnegative safe-integer offset; no hidden
auto-pagination, polling, retries or cancellation. Calls are synchronous and
independent; const methods may be used concurrently while their client stays alive.

## iMessage generic requests

`IMessageClient::request(path, optional_json, method)` defaults
to GET without a body or POST with one; an explicit JSON null is a POST body.
HTTP 204 and successful HEAD return an empty optional, distinct from a JSON null result. Other JSON
responses retain their route-specific wire shapes. Beyond the strict typed text
and reaction APIs below, this is a generic messaging transport, not full typed
resource coverage.

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
keys are preserved, not trimmed or normalized. Blankness follows
ECMAScript whitespace rules; UTF-8 validity uses the existing JSON
library. The method requires actual HTTP 202 with exactly four receipt fields,
strict Boolean `success=true`, `status="queued"`, a lowercase 32-hex public ID,
and a safe chat ID of 1–160 ASCII letters/digits/colon/underscore/hyphen.

Unexpected successful status or receipt shape raises sanitized
`ApiError(502, "unconfirmed_text_outcome", ...)`; raw response data is explicit
only in `error.data`. Other HTTP/transport errors keep existing behavior. No
identifiers, sent/delivered/read state or timestamps are fabricated.
Queued is an operation identity, not delivery evidence. Do not
resend or change the operation key after an uncertain outcome without the
server's reconciliation policy. The client never retries itself.

The method is synchronous and adds no cancellation API. Loopback tests verify
client HTTP behavior, not production availability or message delivery.

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
percent-encoded in the path. Message IDs are not case-normalized.

Unlike the JSON key in `send_text`, the optional reaction key is an HTTP
`Idempotency-Key` header: 1–200 printable ASCII bytes, with no leading/trailing
space. Internal spaces are preserved; controls, DEL and non-ASCII reject before
HTTP. There is no arbitrary-header override API.

Success requires HTTP202 and exactly four fields: a lowercase 32-hex
`operation_id`, matching canonical `chat_id`, exact requested `message_id`, and
`status:"acknowledged"`. A UUID in place of the operation ID, extra fields, inconsistent IDs or another
successful HTTP status raises sanitized `unconfirmed_reaction_outcome` with the
explicit raw response available in `ApiError::data`. Transport and HTTP errors
retain their existing behavior. There is one attempt, no fallback or automatic
resend, and no added cancellation API. An uncertain result must be reconciled;
it does not establish that no reaction occurred. No applied-state, current
reaction, delivery or timestamp is claimed.

An origin override must be HTTPS or loopback HTTP, with no URL credentials,
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
cmake -S cpp -B /tmp/chert-cpp-sdk -DCHERT_SANITIZERS=ON -DCMAKE_BUILD_TYPE=Debug
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
The unified gate checks two distinct origins and credentials, all typed FaceTime
methods, exact JSON/null/PATCH/key behavior, malformed success envelopes/models,
401/403/404/409/422/429/503, redirects, disconnects, body limits and timeouts.
The clean-consumer gate installs and relocates the package, rejects checkout paths
in exported metadata, builds `find_package` consumers and executes the example.
All five gates are self-contained: no separate service source checkout, credentials
or Bun runtime is required. Tests perform no live messages/calls and do not
establish production authentication or delivery. Platform/dependency matrices and
service compatibility remain release checks; coverage is bounded by the contracts above.

## Artifact review before publication

Use a clean non-sanitized Release build, then `cpack --config
/tmp/trychert-build/CPackSourceConfig.cmake -B /tmp/trychert-artifacts` for source
and `cpack --config /tmp/trychert-build/CPackConfig.cmake -B /tmp/trychert-artifacts`
for the platform binary. Review the exact tar file list and SHA-256, extract the
source into a new directory, build/test it, and consume the relocated binary with
`find_package`. Do not publish until those exact artifacts receive release review.
Binary packages do not bundle libcurl or nlohmann/json; dependencies and platform
ABI must match. No registry upload, push, release or deployment is performed by
CMake/CPack or the tests.

The transport settings follow libcurl's official documentation for
[redirects](https://curl.se/libcurl/c/CURLOPT_FOLLOWLOCATION.html),
[explicit proxy disabling](https://curl.se/libcurl/c/CURLOPT_PROXY.html) and
[DNS timeout constraints](https://curl.se/libcurl/c/CURLOPT_NOSIGNAL.html).
