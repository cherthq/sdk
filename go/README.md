# Chert unified Go SDK (source preview)

Standard-library-only iMessage and FaceTime HTTP clients, licensed MIT. This is a
Chert client, not a drop-in vendor SDK, full iMessage-provider parity, or a LiveKit
media runtime. No tagged unified Go release is claimed. See [API coverage and contracts](CONTRACTS.md).
No telemetry, environment credentials, redirects, ambient proxy or automatic
request retry. Construction makes no HTTP requests.

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
iMessage; `NewFaceTimeClient(FaceTimeConfig{})` permits only public login/catalog
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

`SendText(ctx, TextRequest)` calls only `/text-operations/v1`. It preserves exact
lossless UTF-8 text (nonblank under the cloud's ECMAScript whitespace policy,
no NUL, at most 16 KiB). Optional text keys are nonempty, lossless UTF-8, no NUL,
at most 200 bytes, preserved in the JSON body. Only an exact four-field HTTP 202
queued receipt is accepted. **Queued is not sent or delivered.**

`SendReaction(ctx, chatID, messageID, ReactionRequest)` calls the nested reaction
operation route with exact `{reaction,remove,part_index:0}`. Standard reactions:
`love`, `like`, `dislike`, `laugh`, `emphasize`, `question`. Only dashed chat UUIDs
are normalized to lowercase. Message IDs preserve case, match
`[A-Za-z0-9:_.-]{1,160}`, exclude `.`/`..`, and are path encoded. Optional reaction
keys use the `Idempotency-Key` header: printable ASCII, 1–200 bytes, no leading or
trailing spaces; internal spaces are preserved. Only an exact matching four-field
HTTP 202 acknowledgement is accepted. **Acknowledged is not applied state.**

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
and billing catalog/checkout. See the [route and authorization matrix](CONTRACTS.md).
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

Call creation/actions and checkout require a caller-owned 8–200 byte printable
ASCII idempotency key without surrounding spaces. Retain the key and exact body
for reconciliation. Other management mutations have no general idempotency guarantee.
`PublishAssistant` can create another version if manually repeated.

CLI `ftu_` credentials have a restricted server allowlist: they do not gain call-write,
transcript, assistant, billing or browser-user permissions from this SDK. Login
inspection/approval and credential management need the documented signed-in user
authorization. Checkout requires the project owner's browser session. Billing is a
preview contract; check the catalog's test/disabled state before initiating checkout.
Do not treat checkout completion as line allocation. Connector management does not
provide a connector or media runtime.

## Raw access and failures

`RequestWithOptions` adds an optional iMessage header idempotency key for uncovered
routes. `FaceTimeClient.Request` returns the unmodified envelope and accepts
`FaceTimeRequestOptions{Auth: ProjectAuth|UserAuth|PublicAuth}` (default project).
Public calls omit both credential and project headers; user calls omit project.
An idempotency header alone does not establish a route's server-side idempotency.
Binary upload/download, streaming, signed media URL fetching and foreign-origin
requests are not provided by these JSON transports.

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
