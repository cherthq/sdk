# chert-sdk/linq-adapter

Experimental, unpublished **restricted** compatibility adapter for `@linqapp/sdk@0.78.0`. Reuses the official SDK's types, method objects and APIError classes. Supported operations: `chats.messages.send(chatId, {message:{parts:[{type:'text',value}]}})` with exactly one nonempty, unmodified text part, direct-chat `chats.typing.start(chatId)` / `chats.typing.stop(chatId)`, conditional recorded-metadata history reads, and attachment registration/metadata retrieval described below.

```ts
import Linq from 'chert-sdk/linq-adapter';
const client = new Linq({
  chert: { apiKey: process.env.CHERT_API_KEY! },
  maxRetries: 0,
});
await client.chats.messages.send('existing-chert-chat-id', {
  message: { parts: [{ type: 'text', value: 'Hello' }] },
});
await client.chats.typing.start('existing-chert-chat-id');
await client.chats.typing.stop('existing-chert-chat-id');
await client.chats.markAsRead('existing-chert-chat-id');
```

Use an existing Chert chat ID; vendor chat IDs are not migrated. Explicit Chert credentials are required. The endpoint defaults to `https://console.trychert.com`; an optional `chert.baseURL` overrides it for tests/self-hosting. Vendor credentials are not forwarded. Network requests go exclusively through the configured Chert client. SDK retries are disabled and nonzero constructor/per-request retry overrides are rejected. Custom headers, streaming, default headers and default query parameters are unsupported rather than silently ignored. Idempotency is supported only for the existing-chat send subset described below.

Send and control methods share decoded chat-ID validation before dispatch.
IDs over 128 characters, malformed escapes, separators, percent signs,
query/fragment characters, ASCII controls or spaces, and dot segments are rejected.
Valid IDs are encoded once for Chert and reused for response identity checks;
inherited low-level requests cannot bypass these guards with an absolute URL.

The adapter maps actual returned message ID, chat ID, created timestamp, status and text. `sent_at` and text-part reactions are `null` because current Chert responses do not supply those observations; it does not substitute creation time for sent time or claim delivery from queue acceptance. An incompatible response becomes `APIError` status 502 with code `outcome_unknown`; the message may have been sent. Reconcile before manually retrying.

Typing uses Chert `POST /chats/{id}/typing` with `state: "typing"` or `"stopped"`. A matching chat ID and state acknowledgement becomes the official SDK’s empty 204 response (typed `void`; its runtime parser returns `null`). This acknowledges the control request, not visible delivery or a guaranteed duration. The chat must have a pinned line and a supported native IMCore path. Group typing remains unsupported and Chert errors propagate; the adapter does not suppress them. Abort signals reach Chert, and typing requests are never automatically retried. Invalid acknowledgements report an unknown outcome rather than success. Custom request bodies, queries and headers are rejected.

`chats.markAsRead(chatID)` uses Chert `POST /chats/{id}/mark-read` without a
body. Only the exact canonical chat ID and explicit `applied: true` become the
official empty 204/void response. This acknowledges native application, not an
observed remote read receipt. Ownership, native identity, selector/count and
lookup completeness are checked by Chert. Failure or uncertainty propagates
without retries; request overrides and unsafe IDs are rejected before dispatch.
The native candidate refuses snapshots above 10,000 unread messages before any
mark operation. Its installation and physical acceptance remain pending under
FT-INSTALL-085; the SDK mapping does not upgrade an installed worker.

## Assigned phone numbers

The deprecated `client.phonenumbers.list()` returns `{phone_numbers: [{id,
phone_number}]}` from Chert's authenticated, project-assigned active/inbound-only
line inventory. IDs are actual Chert line IDs. Missing, invalid or duplicate IDs
or numbers fail closed. Empty inventory returns an empty list. No capabilities,
provider reputation or sending eligibility is inferred from local configuration.

The modern `client.phoneNumbers.list()` remains unsupported before network access:
its required provider reputation data is unavailable. The narrower deprecated
contract is verified against [official Linq 0.78.0 source](https://github.com/linq-team/linq-node/blob/v0.78.0/src/resources/phonenumbers.ts).
The actual-route fixture exercises Bearer/HMAC authentication with a substituted
local database, without device requests or writes. This is branch-only shared
API behavior; the old-version CRM comparison is complete, without a paired
deployment claim. It requires no Mac installation.

## Conditional recorded history

`chats.messages.list(chatId, {limit?, cursor?})` and top-level
`messages.retrieve(messageId)` use the real official resources and pagination
objects. They require actual valid `created_at` **and** `updated_at`, a stable
ID, canonical chat identity, known lifecycle state and explicit direction for
every record. Missing legacy metadata returns HTTP 502 `incompatible_history`;
creation time is never substituted for modification time. An incompatible row
refuses the whole page, without partial results or skipped rows. No timestamp
writer changes are supplied by this adapter.

This is a metadata subset. Absent optional parts are not reconstructed from flat
text or stored requests. Explicit parts must all be unmodified text. The entire
optional `parts` field is omitted if any part lacks reaction evidence; it is
emitted only when every part explicitly has `reactions: null`. Non-null reaction
arrays and rich/unsupported parts reject rather than silently lose content.
No provider handle IDs, sender, service or missing receipt times are invented.
The deprecated `is_delivered`/`is_read` booleans follow the official status-enum
definitions; `is_from_me` follows observed direction.

List accepts only integer limit 1–200 and an opaque cursor of at most 2,048
base64url characters. The official SDK supplies no limit default; Chert defaults
to descending pages of 200. Its membership snapshot excludes later appends while
serving current fields; structural changes require restart with 409. Original
query/signal options survive automatic SDK iteration. Chert's terminal null
cursor becomes the official required empty string, stopping iteration. There is
no custom `order` query in this official Linq method. Retrieve accepts the exact
stored ID/alias and uses actual `chat_id` or `lead_id`; both must agree when
present. Unsafe IDs, request-body/header overrides and retry overrides reject
before Chert access. Authentication errors and cancellation retain official SDK
behavior; reads are never automatically retried.

These methods do not make older records compatible, establish deployed cloud
coverage or claim full history/content parity. The package requires no Mac
installation; database application and deployed cloud coverage remain separate.

## Explicitly unsupported

Chat creation, direct auto-selected messages, group management, other media, services, effects, replies, custom/sticker or nonzero-part reactions, edits, webhook conversion and all other methods reject before side effects (HTTP-style status 501). Official SDK method availability is not a compatibility claim for those methods.

Current Chert `/api/v1/chats` returns separate `{chat,message}`. Linq 0.78 `chats.create` requires `{chat:{...,message,health_status}}` and complete participant handle IDs/joined timestamps; these cannot be invented. `chats.messages.send` in this version takes nested `{message:{parts}}`, despite older examples showing flat parts. Chert direct `/send` cannot supply all modern auto-selection metadata.

Sources: [published chat declarations](https://unpkg.com/@linqapp/sdk@0.78.0/resources/chats/chats.d.ts), [published chat-message declarations](https://unpkg.com/@linqapp/sdk@0.78.0/resources/chats/messages.d.ts), [published typing implementation](https://unpkg.com/@linqapp/sdk@0.78.0/src/resources/chats/typing.ts), and repository `imessage-server/lib/api-shape/types.ts` (checked 2026-10-17).

Run `bun test` after workspace installation. No provider credentials, live sends
or live read operations are needed for tests. The package itself requires no
Mac installation. The matching reaction pair is installed on M4D; other feature
and fleet activation gates remain separate.


### Recorded attachment metadata

`attachments.retrieve(actualChertAttachmentId)` maps the official GET method to
Chert's tenant-authenticated attachment metadata route. IDs are actual lowercase
48-hex Chert IDs, not portable Linq UUIDs. The result includes only actual ID,
filename, recognized pinned MIME type, byte size and recorded creation time.
A null `uploaded_at` maps to `pending`; a valid observed upload timestamp maps to
`complete` (binary upload completion, not message delivery). No failed state,
download URL, receipt or creation timestamp is fabricated. When the server
provides an actual download URL, retrieval validates the same configured origin,
attachment path and capability query as registration before returning it unchanged;
a malformed present URL rejects the whole response. An absent legacy URL is omitted. Legacy records with
missing creation metadata and malformed responses fail as 502, without partial
metadata. This requires the compatible cloud metadata response; it does not
backfill old records or establish that a database migration is installed.

Binary upload is performed by the caller, not the official SDK. Delete remains unsupported. The bounded media-send source candidate below requires
complete frozen metadata from its actual send response. Reads
accept no query/body/custom headers/idempotency/streaming, preserve cancellation,
and make one attempt. Vendor credentials never reach Chert. No Mac installation
is needed for this adapter; compatible cloud/native contracts remain required.


### Attachment registration

`attachments.create({filename, content_type, size_bytes})` supports whole-file
registration for the intersection of pinned Linq/Chert MIME types, with positive
integer sizes up to 100 MiB. Unknown fields, URL imports, chunking, lifetime
extensions and request overrides reject before registration. The actual Chert
48-hex ID is returned, never a portable provider ID. Persistent download URLs
remain usable after upload until attachment deletion, tenant deactivation or key
rotation revokes them; pending bytes may return 404. No ephemeral retention or
provider CDN hostname is claimed.

The response requires actual same-configured-origin upload/download paths bound
to that returned ID, a canonical tenant UUID and signature on the download URL,
and an actual unexpired upload deadline. Only after validation does the adapter
substitute configured Chert Bearer credentials and the optional tenant-slug header
into `required_headers`. The tenant slug is not the download capability's tenant
UUID. Caller PUTs raw bytes once to the returned `upload_url`; no binary upload or
message send occurs inside this method. `http_method` is PUT. Upload authorization
expires after 15 minutes; the separate download capability has no time expiry.

Registration makes one attempt, passes cancellation, and never retries uncertain
results. A 502 after registration may mean an attachment row exists; reconcile
before manual retry. These calls require the compatible cloud download contract;
no remote database, storage or Mac installation is established by package tests.

The branch cloud candidate can now supply modern outbound retrieval clocks
after migration 24. It uses real row-write and applicable canonical database
event-creation clocks; missing/null legacy values remain unknown. A precise
missing-column fallback keeps the old schema readable. Real official Linq
retrieval passes for complete rows through the actual HTTP route fixture.
Migration 24 has only been tested locally, not applied to shared databases.
This does not supply the distinct identity, health, protocol and occurrence-time
metadata required by Linq webhooks.

## One uploaded attachment send candidate

`chats.messages.send(existingChatId, {message:{parts:[{type:'media',attachment_id}]}})`
accepts exactly one existing uploaded Chert attachment ID (48 lowercase hex).
Captions, URLs, multiple parts, modifiers and new-chat sends remain unsupported.
Unkeyed sends use one authenticated message POST; keyed sends first perform a read-only lookup. There is no automatic retry and no post-send
metadata/download request. The backend must bind the uploaded attachment to the
owned existing DM and freeze complete metadata before dispatch.

Only an actual queued response with matching actual public ID (compact 32-hex or dashed UUID), chat/part/attachment
identity, creation time, filename, MIME, byte count and a canonical configured-origin
one-hour download URL maps to Linq `MediaPartResponse`. Its signed URL expiry must
match the returned expiry ISO timestamp. `reactions:null` means unknown;
`sent_at:null` follows queued state. No native send/delivery/read observation is
inferred. Missing or contradictory metadata after the POST is `outcome_unknown`:
reconcile before retrying. Unexpected terminal states are not downgraded to queued.

This is source-only compatibility with deterministic checks. Matching cloud/native
installation and scoped physical media acceptance remain separate from SDK
tests; this SDK does not install or activate a worker. The old-version CRM
comparison is complete, without a paired deployment claim.

For a supported plaintext or media POST that returns Chert HTTP 502/code 4103
with an explicitly nonretryable outcome and matching owned chat/public message
identity, the
adapter exposes `x-chert-message-id` and `x-chert-chat-id` together through the
official `APIError.headers`. These are **Chert diagnostic response headers**,
not Linq vendor error fields. Native IDs and raw upstream errors are never
forwarded, and the Linq error body stays unchanged. Missing or inconsistent
identity omits both headers. Plaintext requires the actual compact lowercase
32-hex public ID; native-looking UUIDs are not accepted as plaintext reconciliation
IDs. The existing media public-ID contract is unchanged. A network failure
without a server response may
have neither header.

Do not resend on this error. Use the actual header ID with
`client.messages.retrieve(messageId)` (when complete recorded metadata is
available), or authenticated Chert
`GET /api/v1/messages/{messageId}`, to reconcile the reserved send. The adapter
performs no automatic lookup or retry. Authenticated Chert retrieval can renew
an expired URL after verifying current attachment ownership and unchanged file
metadata, without changing the stored send snapshot or evidence clocks. Missing
or changed metadata can still make media content incompatible while the
underlying Chert status remains readable.

### Standard reaction acceptance

`messages.addReaction(id, {operation: 'add' | 'remove', type})` supports the six
standard tapbacks on part zero only. The adapter first reads the owned Chert
message, then uses its actual chat identity with the durable nested reaction
route. A validated dispatch acknowledgement maps to HTTP 200 `{status:'accepted'}`;
it does not claim current UI application or recipient state. This requires the
matching reaction-enabled native pair and candidate cloud ledger migration 25.
Custom emoji/stickers, nonzero parts and request overrides reject before effects.
Cancellation propagates; `maxRetries:0` is mandatory. An unknown POST outcome is
not retried and must be reconciled before another operation. Ordinary tests are
local. Separately, two fresh M4D R8 plans passed genuine Linq LIKE add/removal,
actual authenticated Chert GET/nested POST, disposable PG25 reservation before
effect, durable SDK `{status:'accepted'}` capture, and exact reaction GUID/type/
target/iMessage event observation on both accounts. The first remove-love run
remains failed/spent with separate no-send reconciliation; it was never retried.

LIKE-add run `9195c2cb-eb8d-4ca3-8857-ff0911a396d9` receipt SHA256
`3a0e0d2c1e578b68b835ab614cc68a7b826a35308d83b42751d02071f0cca5ee`;
LIKE-remove run `0e19b2c7-29e9-4bdb-b85f-404110c52560` receipt SHA256
`caac6e05d376a4b9163297d6767e5f1c8f3bd54508d540b5717202f874f3d13c`.
Current R9 has no-send preflight acceptance; these physical observations were on
R8. Neither establishes current UI reaction state, arbitrary targets, custom
reactions, endurance or full provider parity. See [device evidence](../../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md).

Current combined SDK verification is 434 tests / 4,260 assertions / 76 files,
with typecheck passing; it is not 434 physical tests.

Existing-chat single text and uploaded attachment-ID sends support `message.idempotency_key` or the official SDK `idempotencyKey` request option. Matching values are accepted; conflicting values fail before Chert HTTP. Keys are lossless, NUL-free, nonempty strings of at most 255 Unicode codepoints and 1020 UTF-8 bytes. Keyed sends return HTTP 200 for both fresh acceptance and original-receipt replay; unkeyed sends retain HTTP 202. Retries remain disabled.

A Linq-specific frozen request hash binds the canonical chat route and complete normalized body, including the key. Read-only lookup precedes dispatch; a changed request conflicts, and an uncertain prior attempt is never resent. Chert currently retains its tenant/key fence permanently: no undocumented Linq expiry or cross-chat key scope is promised. A media replay preserves the original frozen metadata and URL even after that URL expires or its blob is deleted. It does not fetch, renew, or promise continued download access; current attachment retrieval is a separate operation.


Controlled keyed text and PNG checks now pass on M4D through actual Chert HTTP
routes and disposable PostgreSQL; PNG also uses official isolated Storage and
the existing helper through a temporary native HTTP resolver. Each returns
fresh200/replay200/conflict409 with one native send. Exact text and decoded image
pixels pass across two accounts on that Mac; PNG bytes differ after Messages
re-encoding. This is not deployed-cloud, independent-phone or upstream vendor
acceptance. See [source-bound evidence](../../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md#linq-keyed-receipts-legacy-blooio-device-gate-and-race-repair--2026-10-18).
No Mac reinstall is required for this SDK/cloud change.

### Local webhook signature verification

The adapter inherits the pinned official SDK's `client.webhooks.unwrap(rawBody, {headers})`. Supply the exact raw request body and Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`), with an explicit `webhookSecret` or per-call `key`. Verification is local and makes no Chert HTTP request. Tests cover exact-byte tampering, missing headers, wrong secrets, and stale/future timestamps. A valid repeated event still verifies: consumers must persist event IDs for deduplication.

Bypassing the TypeScript-required `headers` field at runtime invokes upstream **parse-only** behavior; it does not authenticate the payload. `unwrap` also does not validate the event schema at runtime. This verifier support does not enable subscription registration or convert Chert callbacks into Linq callbacks. Required authoritative participant membership and chat-health metadata remain separate prerequisites; no live Linq-compatible callback delivery is claimed.
