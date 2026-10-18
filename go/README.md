# Chert Go client

Standard-library-only transport for the Chert API, licensed MIT. This is a
Chert client, not a drop-in vendor SDK or full iMessage-provider parity.
No telemetry, environment credentials, redirects, ambient proxy or automatic
request retry. Construction makes no HTTP requests.

```go
client, err := chert.NewClient(chert.Config{
    BaseURL: "https://your-chert-host.example/api/v1",
    APIKey: apiKey,
    Tenant: "your-tenant",
})
if err != nil { return err }
key := "caller-owned-operation-key"
receipt, err := client.SendText(ctx, chert.TextRequest{
    Phone: "+15550000002", Body: "Exact plaintext", IdempotencyKey: &key,
})
```

Import `github.com/cherthq/chert-sdk/go` as `chert`. Requires Go 1.23 or later;
no third-party modules. A root base URL defaults to `/api/v1`; explicit deployment
prefixes are retained. HTTPS is required except literal `localhost`, `127.0.0.1`
or `::1` HTTP test origins. Client configuration is private and safe to share
between concurrent callers. Each call requires a non-nil `context.Context`.
The default total timeout is 15 seconds and response cap is 8 MiB; positive
`Config.Timeout` and `Config.MaxResponseBytes` override these bounds.

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

`APIError` exposes status, machine code, request ID and bounded `Data` explicitly.
Error/client formatting redacts raw data and credentials. Non-2xx errors retain
public reconciliation IDs in `Data`; there is no raw server-message forwarding.
Malformed successful typed responses become `unconfirmed_text_outcome` or
`unconfirmed_reaction_outcome` (502). Cancellation and transport failure can follow
an effect: reconcile before any caller-directed retry. Neither method retries,
changes an operation key, uses a fallback, or polls native/provider state.

## Local checks

```sh
cd go
gofmt -l .
go test ./...
go test -race ./...
go vet ./...
```

The `httptest` tests exercise local HTTP only. They do not establish deployment,
provider compatibility or physical device acceptance. No Mac installation is
required for this client-only package.
