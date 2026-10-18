# Chert C# / .NET client

A source candidate for .NET 8 with no NuGet or runtime package dependencies.
It uses `HttpClient` and `System.Text.Json`. No package has been published.
The local checks use SDK 8.0.129 and runtime 8.0.29; they do not establish device
acceptance or compatibility with every deployment.

Reference `Chert.Sdk/Chert.Sdk.csproj` from a .NET 8 application:

```csharp
using Chert.Sdk;
using var chert = new ChertClient(
    "https://your-messaging-origin.example", "your-chert-key",
    tenant: "your-tenant");
var identity = await chert.RequestAsync("/whoami", cancellationToken: cancellation);
```

Construction performs no requests. The base URL must use HTTPS, except explicit
`http://localhost`, `http://127.0.0.1` or `http://[::1]` for local testing. An
origin-only URL defaults to `/api/v1`; an explicit deployment prefix is retained.
Paths are Chert-relative and cannot override the origin or escape that prefix.
There are no custom authentication headers, environment credentials, cookies,
ambient proxies, redirect following, automatic retries or provider fallback.
Dispose the client when its application lifetime ends.

`RequestAsync(path, body, method, cancellationToken)` returns the actual JSON as
an owned `JsonElement?`. An omitted body sends no bytes and defaults to GET;
a supplied `JsonElement` defaults to POST. To send JSON `null`, supply
`JsonSerializer.SerializeToElement<object?>(null)`. HTTP 204 and successful HEAD
return C# null; a JSON-null response has `ValueKind.Null`. List query strings
are retained after validation. GET/HEAD bodies are rejected before HTTP.

## Strict plaintext

```csharp
// Explicit effect: use only an authorized recipient.
var queued = await chert.SendTextAsync(
    "+15550000002", "Exact plaintext", idempotencyKey: "one-operation",
    cancellationToken: cancellation);
```

This makes one POST to `/text-operations/v1` with `phone`, `body` and optional
JSON `idempotency_key`. It validates canonical E.164, nonblank lossless UTF-8 text
up to 16 KiB without NUL, and an optional nonempty lossless UTF-8 key up to 200
bytes without NUL. Text and key bytes are preserved. Blankness follows the cloud's
ECMAScript whitespace set, including BOM; NEL and U+001C are nonblank.

Only HTTP 202 with exactly `success:true`, a lowercase 32-hex public `message_id`,
a safe public `chat_id`, and `status:"queued"` produces `QueuedTextReceipt`.
Queued identifies a cloud reservation. It does not assert a native GUID, service,
sent/delivered/read state or occurrence time.

## Standard reaction acknowledgement

```csharp
// Explicit effect against an owned public message, not a native GUID receipt.
var ack = await chert.SendReactionAsync(
    chatId, messageId, "like", remove: false, idempotencyKey: "reaction-operation",
    cancellationToken: cancellation);
```

One POST goes to `/chats/{chatId}/messages/{messageId}/reactions` with exactly
`{reaction,remove,part_index:0}`. Only `love`, `like`, `dislike`, `laugh`,
`emphasize` and `question` are accepted. A dashed chat UUID is canonicalized to
lowercase. Message IDs preserve case and accept 1–160 ASCII letters, digits,
colon, underscore, dot or hyphen, excluding `.` and `..`; they are encoded as one
path segment. The optional HTTP `Idempotency-Key` accepts 1–200 printable ASCII
bytes without leading/trailing spaces; internal spaces remain unchanged.

Only HTTP 202 with exactly `operation_id` (lowercase 32 hex), matching canonical
`chat_id`, exact `message_id`, and `status:"acknowledged"` produces
`ReactionReceipt`. It is dispatch acknowledgement, not applied/current reaction
state or recipient proof. Custom emoji, groups and nonzero parts are unsupported.

## Failure and cancellation

The default total request deadline is 15 seconds, including reading the response.
The default response bound is 8 MiB; both are constructor options. Advertised and
streamed body sizes are checked. Caller cancellation throws a sanitized
`OperationCanceledException`; deadline expiry raises `ChertApiException` with
`Code == "timeout"`. A cancellation or lost reply can occur after an effect and
never authorizes a resend or replacement key.

`ChertApiException.Status`, `Code`, `RequestId` and `ResponseData` are explicit
machine-readable data. Error/client/receipt formatting does not print credentials,
URL query tokens or response bodies. No raw transport exception is attached.
Malformed successful typed receipts produce `unconfirmed_text_outcome` or
`unconfirmed_reaction_outcome`, with HTTP status 502 and explicit raw response
data where available. Follow the actual server's reconciliation policy; the SDK
never retries on its own.

This is a generic messaging transport plus two strict typed methods. It does not
provide vendor SDK wrappers, FaceTime methods, media upload, callbacks or full
resource parity. Matching cloud/native deployment remains necessary.

## Offline checks and packaging

Use the installed .NET 8 SDK; `NuGet.Config` clears remote package sources, and
these projects need no packages. Disable CLI telemetry explicitly:

```sh
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet run --project dotnet/Tests
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet build dotnet/Chert.Sdk -c Release
DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet pack dotnet/Chert.Sdk -c Release -o /your/task/output
```

The dependency-free test executable uses task-owned `TcpListener` HTTP peers and
synthetic credentials only. It exercises headers, methods, exact receipts,
pre-effect validation, Unicode, redirects, error privacy, lost replies, limits,
cancellation and total stream deadlines. It sends no device messages. MIT license
text is included in the local package; packing does not publish it.
