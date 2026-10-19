# @cherthq/sendblue-adapter

A limited Chert transport for the real `sendblue@3.20.1` SDK. This package
subclasses the official SDK and retains its resources, APIPromise helpers,
types and API error classes. It is not a complete Sendblue replacement.

```ts
import SendblueAPI from '@cherthq/sendblue-adapter';
const client = new SendblueAPI({
  chert: { baseURL: 'https://your-chert-host', apiKey: 'your-chert-key' },
  maxRetries: 0,
});
await client.messages.send({
  from_number: '+15550000001', number: '+15550000002', content: 'hello',
});
```

| Surface | Support |
| --- | --- |
| `messages.send({from_number, number, content})` | Direct text only; explicit tenant-assigned sender |
| `messages.send({from_number, number, media_url})` | Server-side public HTTPS import, then one durable media operation; optional `content` uses experimental caption v2 |
| Response helpers and official API errors | Retained from Sendblue SDK |
| Request cancellation | Forwarded to Chert transport |
| Automatic retries | Disabled; nonzero constructor/request retry settings rejected |
| `messages.getStatus({handle})`, `messages.retrieve(id)` | Tenant-scoped recorded reads; retrieve additionally exposes one validated owned media URL |
| `typingIndicators.send({from_number, number, state?})` | Existing pinned DM; explicit sender, default/start or stop, confirmed native application only |
| `messages.list(query?)` | One tenant-wide recorded GET with bounded filters and offset pagination; facts must exist |
| Every other API | HTTP 501 before any Chert network request |
| Callbacks, app cards, reply/effect/seat/other send fields | HTTP 501 before any Chert network request |

The adapter still requires an explicit sender. Upstream 3.20.1 makes
`from_number` optional for some provider accounts; automatic sender selection
is outside this adapter subset and is rejected before Chert requests. Earlier
physical receipts used 3.20.0; the 3.20.1 upgrade has local verification only.

Sender and recipient must be canonical E.164 numbers; normalization is not
performed implicitly. Sends translate to Chert `POST /api/v1/chats` with `from`, a single `to`, and one text
or media part, or the exact `[text, media]` caption shape. That route validates the active sender line against the authenticated
tenant. Vendor keys, tokens and headers are never forwarded to Chert; explicit
Chert connection configuration is required. Custom vendor base URLs and fetch
options do not bypass the isolated adapter transport.

Chert message ID and creation time map to `message_handle` and `date_created`
only when present. Status mapping is `queued→QUEUED`, `sent→SENT`,
`delivered/read→DELIVERED`, `failed→ERROR`. Read implies delivery; the Sendblue
response type has no READ state. Acceptance remains QUEUED until Chert reports
something stronger. Other unavailable optional fields are omitted, including
account email, update time, delivery diagnostics and provider-only metadata.
`from_number` and `number` reflect the explicit pinned send request. Chert failures retain HTTP status/code in the official SDK error.

No messages or typing mutations are performed by package tests. Source-bound
controlled M4D text and isolated PNG receipts are recorded in the root evidence.
Isolated URL-media acceptance and the separate caption fidelity failure are
documented below. Full production provider interoperability remains unverified
and no SDK was published.

## Explicit-sender typing

The official `typingIndicators.send()` method maps to Chert `POST /typing`
with canonical E.164 sender/recipient and `typing`/`stopped` state. Omitted state
means start. The route requires one existing direct chat pinned to that active,
tenant-owned sender line; it never creates a chat, writes a lead or sends a
message. Ambiguity, a different actual recipient override and routing changes
fail before native dispatch. Direct address lookup currently requires canonical
stored targets; existing chat-ID routes retain legacy normalization support.

Only exact returned sender, recipient and state with `applied: true` produce
`{number, status: 'SENT'}`. This acknowledges native application, not a visible
indicator or duration guarantee. `max_duration_ms`, extra fields and request
overrides reject before effects. Unknown outcomes are not retried. Native
installation and physical typing acceptance remain pending; an old bridge
worker's `applied: false` is an error, not success.

The [published 3.20.0 source](https://github.com/sendblue-api/sendblue-ts/blob/v3.20.0/src/resources/typing-indicators.ts)
defines these method parameters. Its installed typing source, runtime and
declarations were checked byte-for-byte against the integrity-verified npm
artifact; no third-party runtime was changed.

## Recorded status and retrieval

The actual Sendblue SDK emits `GET /api/status?handle={id}` for getStatus and
`GET /api/v2/messages/{id}` for retrieve. Both translate to tenant-scoped Chert
`GET /api/v1/messages/{id}`. GetStatus returns supported observed optional fields;
retrieve uses the SDK's `{data: ...}` envelope. Only actual message ID, known
queued/sent/delivered/failed state, phone, direct text and explicit direction are
mapped. Explicit `read` with outbound direction becomes DELIVERED for both read
methods. An inbound local read becomes RECEIVED only for retrieve; read with
unknown/missing direction omits status. No READ enum or peer receipt is invented.
Explicit `received` also becomes RECEIVED only inside retrieve's
`MessageRetrieveResponse.Data`; getStatus omits it because its official
`MessageResponse` schema excludes RECEIVED. `sent` with explicit `delivered:true`
becomes DELIVERED, but queued stays QUEUED even with that flag. Unknown/duplicate
states remain absent; direction or a timestamp alone never creates a status.
No sender, date_sent, date_updated, provider metadata or missing timestamp is
invented, and raw stored request bodies are not returned.

Use durable cloud `/send` event IDs or another ID demonstrably recorded by the
cloud service. The branch `/chats` routes now persist each returned ID; that
correction is not deployed. Older/direct Mac runtimes (including tested
1.9) may not implement the same recorded-message endpoint. Missing records return
SDK NotFoundError; the adapter does not pretend they were delivered. Returned
identity must equal the requested ID. Encoded route separators and traversal
reject before contacting Chert. Extra status query fields are unsupported.
Cancellation, no retries and Chert-only credential routing apply to both reads.

## Explicit Chert webhook conversion

```ts
import { unwrapChert } from '@cherthq/sendblue-adapter';
const { eventId, message } = await unwrapChert(await request.text(), request.headers, {
  secret: configuredChertSubscriptionSecret,
});
// Atomically claim eventId in durable storage before processing message.
```

This helper verifies **Chert's direct Mac or tenant-cloud subscription signature**, not a
Sendblue/provider signature. Supply the original UTF-8 request body without
parsing or reserialization and the secret for the expected subscription. It
uses WebCrypto HMAC-SHA256 over `timestamp.rawBody`, accepts the native
`X-Webhook-Signature: t=...,v1=<hex>` or `x-chert-signature: v1,...,<hex>`,
and requires agreement when both exist. Authentication precedes JSON parsing;
signatures outside a ±300-second window and contradictory event headers reject.
The receiver must associate the secret with its configured subscription and
atomically deduplicate the returned signed `eventId` in durable storage.
The time window alone does not prevent replays; this stateless helper deliberately
does not claim or store event IDs.

Only native `message_received` events with matching `recv:<guid>` identity,
explicit inbound/received state, a single unmodified plaintext part and an E.164
peer are converted. Known group messages, media, multipart messages, email peers
and other event types reject. The official optional `MessageContent` fields
returned are `message_handle`, `content`, `status: 'RECEIVED'`,
`is_outbound: false` and `from_number` (the observed peer). No local sender,
service, timestamp, delivery/read evidence or provider identity is invented.
No messages are sent by conversion. Actual tenant-cloud plaintext fanout is
supported: its signed `event`, `type`, native `recv:<guid>` event identity,
chat ID, top/message line binding and callback timestamp must agree. The
configured subscription secret supplies tenant authentication; this envelope
contains no tenant ID, so the helper does not invent or return one. The caller
must select the secret using trusted subscription configuration. Cloud callback
event IDs remain native source IDs, not messaging-events database row UUIDs.
This is explicit Chert conversion, not Sendblue webhook registration or native
Sendblue signature compatibility. Requires standard `crypto.subtle` (Node, Bun
and Deno).

## Recorded single-media retrieval

`messages.retrieve(id)` preserves `data.media_url` for exactly one recorded
outbound uploaded attachment, matched to its actual request part and frozen
public metadata. A shared provider-neutral validator checks ID, filename, MIME,
byte size and a configured-origin one-hour Chert capability with coherent future
expiry. This is structural validation; the authenticated server establishes
ownership and signature authority. No supplied/download URL is fetched, and the
SDK never renews a capability or sends a message. The server may refresh only its
public response using current owned attachment metadata; the ledger snapshot
stays immutable. Multi-attachment messages, conflicting/inbound parts and
foreign-origin URLs, expired capabilities or invalid returned metadata fail with
sanitized 502 once.

The returned URL is a Chert capability, not a Sendblue CDN/media-object identity.
No service, lifecycle timestamp or delivery proof is inferred from media. The
`getStatus` schema remains unchanged and omits media URLs. Direct uploads and provider-native callbacks remain unsupported. Actual joined
HTTP tests retain the real GET, authentication and capability renewal with only
the database substituted; they perform no native action, URL fetch or write.
These remain branch source candidates under paired release and physical gates.

Current-row deletion, ownership changes or metadata mismatch prevent server-side
renewal; they do not by themselves make the SDK reject an unexpired retained
snapshot. The SDK performs structural validation only. The download endpoint
independently checks current ownership and the active signing key, so a returned
URL can be revoked and fail when used. The expiry/ownership failure HTTP cases
advance beyond the old capability's expiry before asserting SDK rejection.


## External media sends

```ts
await client.messages.send({
  from_number: '+15550000001', number: '+15550000002',
  media_url: 'https://your-cdn.example/Photo.png',
});
```

The adapter asks Chert to import the URL; it never downloads the URL on the
client's machine. The authenticated server accepts public HTTPS on port 443,
rejects redirects and private/reserved DNS answers, pins the TLS connection to
a validated address, and forwards no Chert, Storage or vendor credentials to
the CDN. Downloads have a 15-second total deadline, a 100 MiB cap, the existing
Chert MIME allowlist and canonical filename handling. A usable filename with a
file extension is required. Successful import alone does not send a message.

The subsequent send uses an uploaded owned attachment ID and the durable
single-attachment native operation. It does not retry or fall back to legacy
sending. A queued receipt exposes the validated Chert download capability as
`media_url`; it does not claim sent/delivered or byte-preserved recipient media.
Post-dispatch receipt validation failures are non-retryable uncertainty and
preserve a validated public message ID when available. An import can leave an
owned orphan blob if the database write fails; that failure never sends.

Optional `content` uses canonical `[text, media]` parts and native
`attachment-operations/v2`: one reservation, native operation and GUID. The
caption input retains its exact lossless UTF-8 bytes (1–16,384 bytes, no NUL),
including whitespace and line endings, through dispatch and sender construction. Its SHA-256 is frozen before dispatch and verified
in the acknowledgement and recorded GET context. Retrieval returns `content`
only when it matches that validated frozen caption. The matching new native
server/helper pair is required; old workers fail closed without legacy fallback.
On M4D, one controlled v2 caption/image operation was delivered to both accounts.
The sender attributed body matched exactly, but the recipient converted edge
ASCII spaces to nonbreaking spaces and CRLF to two line feeds. The exact received
caption gate therefore failed; it remains an open fidelity issue. Image pixels
matched after PNG re-encoding. This is experimental caption support, not full
provider parity or a guarantee of exact recipient text.

Signed-URL media-object handling and the other unsupported options remain separate work. Sendblue's current
[sending contract](https://docs.sendblue.com/getting-started/sending-messages)
also permits combined content/media; this adapter does not claim full parity.

### Explicit HTTP reaction subset

The pinned Sendblue 3.20 SDK has no reaction method. The named export
`createSendblueReactionFetch` separately translates the documented HTTP endpoint:

```ts
import { createSendblueReactionFetch } from '@cherthq/sendblue-adapter';

const reactionFetch = createSendblueReactionFetch({
  baseURL: 'https://your-chert-server.example',
  apiKey: process.env.CHERT_API_KEY!,
});
const response = await reactionFetch('https://api.sendblue.com/api/send-reaction', {
  method: 'POST',
  body: JSON.stringify({
    from_number: '+15551234567',
    message_handle: 'A50E8400-E29B-41D4-A716-446655440000',
    reaction: '-like',
  }),
});
```

Only `love`, `like`, `dislike`, `laugh`, `emphasize`, `question` and their
leading-minus removals are supported, with omitted or zero `part_index`. Custom
emoji and multipart targets remain unsupported. The target must be a primary
received plaintext iMessage with protected original receiving context, owned by
this tenant and still pinned to the same active sending line. Historical records
without proof, outbound messages, App Cards, SMS/RCS and ambiguous inventory fail
before a native reaction request. No mutable CRM field can establish eligibility. The POST binds the original primary
GUID, receiving line and receiver to the protected ledger again before reserving
an effect, so a CRM alias edit between lookup and dispatch cannot redirect it.

Matching FT-INSTALL-099 native support, cloud migration 026 and explicit
`CHERT_RECEIVED_CONTEXT_V1=1` on the receiving worker are prerequisites. Native
wire emission is default off.
A 200 response means the exact native request was acknowledged, not that a
reaction is visibly applied. Unknown outcomes are not retried automatically.
The authenticated real-PostgreSQL fixture covers 40 cases using synthetic native
acknowledgements. One fresh `like` ADD has now passed on both M4D GUI accounts
through actual authenticated Chert routes, disposable PostgreSQL/PostgREST and
one native HTTP request (202), followed by SDK HTTP200 and exact tapback GUID/type
observations in both databases. The native event came from the actual reviewed
producer over a verified complete read-only SQLite snapshot, then was reingested
with a private fixture MAC; original live webhook transport and UI rendering were
not validated. Other reaction types/removals remain physically unverified.
See [the dated device evidence](../../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md#ft099-r2-received-target-and-sendblue-http-like--2026-10-18).
See the [compatibility matrix](../../COMPATIBILITY.md) for other boundaries.


## Account-wide recorded history

`messages.list()` uses the hosted Chert `GET /api/v1/messages`, rather than treating
a phone number as a chat ID or fetching each chat on the client. It supports
canonical number/from/to/owned-line filters, direction, known message status,
iMessage service, direct-message filtering, created/updated/sent clock bounds,
ordering and offset pagination when the stored facts can answer the query.
Account email, worker metadata, groups and provider-only status values remain501
before any HTTP request. Chert defaults are limit50, offset0, created-time descending;
these are explicit adapter/backend defaults, not asserted Sendblue defaults.

Frozen strict-text and strict-media application intents supply historical endpoints. Legacy conversation
records retain unknown endpoints/group facts as null and the adapter omits those
vendor fields. A filter or sort requiring unavailable facts returns422 rather
than silently dropping potentially matching records. Reservation creation time
never becomes `date_sent`; no currently stored sent occurrence clock is invented.
The official list response has no `date_created` field, so creation time is used
for backend ordering/filtering without adding a provider field.

Filters run before stable ordering and pagination. Limit is1–200 and offset0–10000.
The loader reads small batches, enforces a10000-source-work budget, rejects
incomplete/conflicting inventories and rechecks tenant ownership before returning.
Budget exhaustion returns an error, never a truncated success. Offset pages
reflect the current inventory and are not a frozen snapshot across requests.
No native poll, message send, CRM write or callback is triggered. Actual official
SDK → authenticated HTTP → disposable PostgreSQL/PostgREST checks cover this
path; no production deployment or new device delivery is claimed.


Account-inventory completeness boundary: the projection qualifies
plaintext conversation records and strict text/media intents. An owned send row using
an unhandled media/legacy protocol must fail the inventory rather than disappear
from a successful list. Such accounts remain unsupported until that source is
projected safely; unqualified legacy history and full media lifecycle parity remain open.


### Owned media and captions in history

Strict `attachment-operations/v1` media-only and v2 caption/media reservations now
appear in account history. A qualified row carries one uploaded attachment;
the server batches current tenant-owned metadata reads, verifies immutable
filename/type/size/blob identity, and returns a newly signed one-hour download
capability. Neither server nor adapter fetches the file. Missing or changed
ownership/metadata rejects the inventory; stale stored URLs never become a
fallback. Fresh capabilities do not mutate the send ledger or its clocks.

The official list maps the validated URL to `media_url` and preserves a v2
caption exactly as stored. This does not repair the separate physical recipient
caption-fidelity failure. Media endpoints reflect the frozen application
reservation; unlike strict text, media does not retain a complete from/to
fingerprint. Older stronger scalar-only media caches lack persisted bound receipt
proof, so history exposes their status/service as unknown and omits provider delivery
fields rather than inventing delivery or downgrading it to queued. Queued intent
remains QUEUED. Send occurrence time remains unknown.

The hosted single-message GET also now pins both recipient and request during
v1 media cache writes, matching v2. Actual-handler recipient/request race tests
prove a stale observation cannot overwrite a changed row. No Mac reinstall,
new physical send or production deployment is included in these changes.


Bound media lifecycle proof: single-message status polling now retains private,
versioned exact-GUID native evidence bound to the tenant, lead, public message,
line, canonical request, attachment and optional caption hash. Account history
can report sent/delivered/read from a fully matching stored proof, including
actual delivery/read clocks. Missing or contradictory proof remains unknown;
`sent_at` remains null. Lost acknowledgements do not become dispatch acknowledgements,
and later status reads still poll for newer evidence. Private proof is stripped
from both public response levels. The cache update pins the lead as well as the
recipient, request, line and previous payload. This uses existing JSON storage;
no schema migration or Mac package change is required. It establishes no new
physical caption-fidelity result.
