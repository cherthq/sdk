# @cherthq/blooio-v4-adapter

Private, unpublished **Blooio v4 HTTP method subset** for Chert messaging. This exports a fetch replacement, not an invented official JavaScript SDK interface. Published `@blooio/sdk@0.0.2` uses v1 routes and remains a separate adapter.

```ts
import { createBlooioV4Fetch } from '@cherthq/blooio-v4-adapter';
const fetch = createBlooioV4Fetch({ chert: {
  baseURL: 'https://your-chert.example', apiKey: process.env.CHERT_API_KEY!,
} });
const response = await fetch('https://api.blooio.com/v4/messages', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: '+15551234567', to: '+15557654321', text: 'Hello' }),
});
const result = await response.json(); // Actual Chert id, chat_id, lifecycle status.
```

Supported HTTP contracts:

- `GET /v4/contacts/{contactId}`: actual owned Chert DM/contact ID and nullable recorded name only (`{data:{id,name}}`). Use the contact ID returned by this adapter's chat getter. Unmigrated vendor IDs, groups, filters and overrides are unsupported; identities, tags and timestamps are omitted.
- `GET /v4/chats/{chatId}`: owned direct-phone-chat contact subset; actual Chert chat/contact identity and recorded name/target only (details below).

- `POST /v4/messages`: explicit canonical E.164 `from` and `to`, nonempty `text`. Maps to Chert `POST /chats` with its pinned-sender authorization checks.
- `POST /v4/chats/{chatId}/messages`: `{text}` only, maps to the existing Chert chat. Use an actual Chert chat ID, not an unmigrated Blooio chat ID.
- `GET /v4/chats/{chatId}/messages`: recorded plaintext and strict single-media history with `order=asc|desc`, `limit=1..200` (official default 50), and an opaque Chert cursor. Returns `{data:[MessageSubset],has_more,next_cursor}` after validating every ID/chat/part and the pagination metadata. One provider GET makes one Chert GET; pages are never fetched eagerly.
- `GET /v4/chats/{chatId}/messages/{messageId}`: maps to the same tenant-authenticated recorded-message GET with exact message ID and chat membership checks. Returns `{data:{id,chat_id,status?,text?,direction?,attachments?}}`; text and direction require explicit flat recorded fields. Validated strict media adds ordered `{url,media_type,size,caption?}` attachments. This is a recorded-message subset, not complete `Message` metadata.
- `GET /v4/chats/{chatId}/messages/{messageId}/status`: maps to tenant-authenticated Chert `GET /messages/{messageId}` and returns `{data:{id,status?}}`. The returned `lead_id` must exactly match the requested chat and the returned `id` must match the requested message before any message data is exposed. Unknown/absent lifecycle evidence stays absent; no delivery, read receipt, protocol or timestamp is inferred.

- `POST /v4/chats/{chatId}/typing`: optional `{state:"started"|"stopped"}`; omitted body/state defaults to started, matching the pinned OpenAPI. Maps to Chert typing/stopped.
- `DELETE /v4/chats/{chatId}/typing`: stops typing; a body is rejected. Both verbs return `{data:{chat_id,state}}` only after Chert returns the same chat ID and expected state. No `at` timestamp is fabricated.

Typing requires a tenant-owned, pinned one-to-one Chert chat and an IMCore-capable native worker. Groups, unknown fields, invalid IDs, query parameters, idempotency and unsupported methods reject without dispatch. Native errors are preserved through the cloud error response; network or incompatible response is outcome unknown, with no automatic retry. This is a control acknowledgement, not a message receipt. The current M4D worker has not been physically validated for typing. No support for other-channel typing is implied.

Successful sends return HTTP 201 and the actual message `id`, `chat_id` and `status`, matching the pinned OpenAPI `MessageSendResult` properties. That schema has no required fields; unsupported optional channel/protocol/routing/sender fields remain absent. IDs are the Chert IDs, not invented Blooio-prefixed identities. `queued` means accepted, not sent or delivered. No creation or delivery timestamps are fabricated.

Status lookup requires a message actually recorded under the authenticated Chert tenant, either a cloud send-event ID or a message GUID in that tenant's recorded conversation. A returned send ID is queryable only when its server route persisted the corresponding cloud record; an isolated native outbox ID or an unmigrated Blooio ID is insufficient. Legacy records without a matching `lead_id` cannot establish chat membership and return 404. Not-found does not mean failed or unsent. Encoded separators, double-encoded escapes, control characters and unrecognized GET paths reject before Chert is contacted. Vendor headers cannot override the explicitly configured Chert credentials or tenant.

**Native SMS fallback may occur under the existing Chert server policy.** This adapter covers a subset of an iMessage provider's API; it does not guarantee the eventual wire transport is iMessage. Explicit protocol, channel, `preferred_service` or no-fallback requirements are rejected before sending because the current cloud routes cannot enforce them. The existing server's observed status is preserved; no response is labelled iMessage without evidence.

Unsupported: other channel APIs (SMS/RCS/WhatsApp/Apple Messages for Business), automatic routing/priorities, sender aliases/channel IDs, fan-out/groups, other media/rich content, dry runs, webhook conversion and all other endpoints. Unknown fields reject before any side effect. Vendor authorization headers are never forwarded. There are zero automatic retries. Abort signals pass through the Chert transport. Incomplete/mismatched response or network uncertainty returns `502 outcome_unknown`; reconcile before any manual retry.

Contract: [official OpenAPI](https://docs.blooio.com/openapi.json), version `4.0.0-beta`, checked 2026-10-17, SHA-256 `069fa87a9702f802607bcf7341df4d6ae237ac52658eece5d4b4e6378ba40f73`. `fixtures/contract.json` preserves relevant structural schemas and operation IDs without descriptive prose. Reference: [v4 send endpoint](https://docs.blooio.com/reference/v4/messages/sendMessage), [existing-chat endpoint](https://docs.blooio.com/reference/v4/messages/sendMessageToChat).

The status operation and `MessageStatus` structure are also pinned from that same OpenAPI snapshot; its response uses a `data` envelope, unlike the top-level send result. This adapter returns only the actual ID and recognized recorded lifecycle status, leaving the schema's optional error, protocol and integer timestamps absent.

`bun test` checks schema-pinned successful/error responses, sender mapping, status/chat isolation, typing defaults/start/stop, encoded IDs, unsupported rejection, cancellation and uncertain outcomes without live sends. Actual device/provider interoperability remains a separate acceptance gate. No Mac installation is required for the SDK itself.

The `getChatMessage` operation and optional `Message` structure are pinned from
the same unchanged OpenAPI artifact/hash. Retrieve omits protocol even when a
service label exists: this initial subset has no unambiguous native-provenance
flag. It also omits integer timestamps (unit mapping unestablished), channel/contact
metadata and all unobserved fields. It never converts a delivered boolean into a
lifecycle status. Single-media records require canonical `[media]` or `[text,media]`
parts and complete owned attachment metadata; retrieve also requires any caption
to match the explicit recorded text exactly. It never substitutes request text
for a missing recorded caption.
Unknown lifecycle/direction values remain absent. Stored content is not proof
of physical delivery.

Single-record/status GETs accept no body, query, idempotency or unsupported
headers. List GET accepts only the three documented query keys, without duplicates. Only Authorization, Accept, Content-Type and X-Chert-Tenant headers are
recognized; vendor auth/tenant values cannot override configured Chert values.
Identifiers are decoded once, bounded to 160 characters and validated before
Chert is contacted. Errors are sanitized, abort signals propagate, and each
read has one attempt. Missing records or wrong-chat binding return 404 without
record content; mismatched returned message identity returns 502. These checks
do not establish live provider or production-cloud compatibility. History requires the compatible cloud cursor contract; older responses lacking a
usable cursor fail rather than silently exposing only the former 200-row cap.

## Recorded text and single-media history

The pinned `listChatMessages` schema has optional `data`, `has_more` and
`next_cursor` properties. This adapter requires a consistent actual cloud page:
all records belong to the requested chat, have unique valid IDs and supported
canonical parts, and the row count is at most the requested limit. Plaintext parts
join with the same double-newline rule as Chert sends. Strict attachment v1/v2
ledger records are joined by the owned cloud route with a complete 1000-media-row
cap; over-cap, malformed or conflicting inventory fails the whole page. Current
owned uploaded metadata must match the frozen file identity before the server
issues a fresh one-hour download capability. The adapter validates that capability
structure and projects its actual URL, MIME type and byte size; an exact v2 caption
is preserved. No URL is fetched by the adapter. Missing, changed, foreign or
expired metadata fails rather than inventing an attachment or dropping it.
Unsupported/malformed records reject the entire page; none are silently skipped.
Unknown lifecycle/direction stay absent; protocol, timestamps and private metadata
remain omitted. Queued intent and dispatch ACK do not prove delivery: stronger
media lifecycle requires the existing complete stored exact-GUID evidence.
This covers recorded cloud conversation entries plus strict single-media intents,
not the complete provider message ledger or device database.

The first page defaults to descending order and limit 50. Every request sends
its explicit or default 50 limit; a continuation may change that limit without
rewriting the cursor. The Chert cursor is a membership snapshot bound to the
tenant, chat and order, using stable IDs/creation times. Appends beyond that
membership are excluded; structural changes cause a restart error. Current text,
status and read evidence can change between pages: this is not a transactional
snapshot of record values. Tokens are canonical base64url strings up to 2048
characters and are treated as opaque, never decoded or synthesized by the adapter.

On a continuation with omitted `order`, the adapter omits it from the Chert call
so the cursor's order is retained. This is the Chert continuation convention;
the pinned provider specification describes a descending default but does not
specify order inheritance. Explicit incompatible order is rejected by the cloud.
A 409 snapshot restart or other server error is propagated without retry. On a
terminal page, `has_more` is false and `next_cursor` is null; inconsistent metadata
fails rather than claiming completion. No live history/device acceptance or
complete provider parity is implied by the local tests.

### Assigned channel lookup

`GET /v4/channels/{channel}` supports a canonical lowercase Chert line UUID or
canonical E.164 phone (encode `+` as `%2B`). Aliases and provider `ch_` IDs are
unsupported. One request reads the authenticated Chert `/phone-numbers`
inventory and selects exactly one actual assigned line; no match returns 404.
Malformed IDs/phones or duplicate inventory identities reject the whole response
with 502. It returns only `{data:{id,address}}`, using the actual database line
ID and assigned phone number. No provider channel type, status, capabilities,
worker readiness, profile, settings or timestamp is inferred. The UUID boundary
follows the existing `phone_lines(id)` UUID foreign-key contract. Unsupported
query/body/header overrides reject before network; errors, cancellation and
no-retry behavior follow the other recorded reads. This is assigned-line lookup,
not number purchase, full channel management or a live-device capability probe.

`POST /v4/chats/{chatId}/read` remains unsupported (501 before any Chert request).
The pinned `markChatRead` operation promises to send a read receipt. Chert's
`mark-read` acknowledgement confirms native invocation only, including empty
unread snapshots; receipt emission depends on account settings and is not
observed. It cannot truthfully supply that promise or an observed `read`/`at`
result. An invocation-only substitute is not exposed under this operation.

### Owned direct-chat contact lookup

`GET /v4/chats/{chatId}` maps to the authenticated Chert chat GET and returns
only `{data:{id,contact:{contact_id,identifier,name},group:null}}`. The actual
Chert lead ID identifies both this chat and its stored contact record; these are
Chert identities, not portable Blooio `chat_`/`ct_` IDs. The identifier must be the
single actual canonical E.164 direct-chat target, and the name is the recorded
string or null. Groups return 501; missing or malformed identity, name, group
flag or handles reject the entire response. Email chats remain unsupported.

Channel identity/type, protocol, state, timestamps, capabilities and readiness
remain absent. Query parameters, request bodies, custom headers and unsafe IDs
reject before Chert dispatch. Cancellation propagates and each read makes one
attempt. This requires the compatible cloud target-override mapping and does
not establish device membership, remote delivery or full provider chat parity.
The unchanged official OpenAPI artifact pins `getChat`, `Chat` and its required
`ContactSummary` fields in `fixtures/contract.json`.


### Branch webhook transport work

The cloud candidate supports manually configured Chert subscriptions tagged
`blooio-v4/2026-10-01` for unique nonempty sets of `message_received`,
`message_queued`, `message_sent`, `message_delivered`, `read_receipt` and `message_failed`. It signs immutable received-plaintext
or qualified single-send sent/delivery/read envelopes. These are Chert subscription routes, not this
adapter's vendor registration operation: the vendor's all-event contract is
still unsupported. Native proof, ownership, timing, retry and replay HTTP checks
are described in `sdk/tests/ROUTE_HTTP.md`. The completed comparison against the old CRM baseline is not a paired deployment claim. Complete event
coverage and installed-worker callback acceptance remain required.

Qualified `message_failed` supports only an exactly owned singleton bridge
outbox reporting native 4103, mapped to documented `delivery_unconfirmed`.
It may have sent: do not automatically resend. It neither invents an Apple
message GUID nor claims nondelivery. Other failures remain unsupported.

Qualified `message.queued` reflects an explicitly evidenced native outbox enqueue
for one owned plaintext bridge send. It carries the actual public send identity;
no native GUID, protocol or occurrence timestamp is invented. Missing ledger
correlation is retryable, while compound/media/native-SMS-owned queues remain
observations. Matching native producer installation and paired release acceptance
remain pending. This does not enable vendor all-event subscriptions.

## Single uploaded image source candidate

Existing-chat `POST /v4/chats/{chatId}/messages` additionally accepts exactly one
PNG/JPEG image as `attachments: [canonicalChertDownloadURL]`, without any `text` key. Captions (including empty/null values) reject before metadata lookup. The URL must be HTTPS under the configured Chert
origin and use the actual `/api/v1/attachments/{48hex}/download?tenant=...&signature=...`
capability shape. No supplied URL is fetched. An authenticated metadata GET must
confirm the exact ID and download URL, uploaded timestamp, a positive byte size no larger than 100 MiB,
PNG/JPEG MIME and matching filename before one message POST sends the actual
attachment ID alone. Server-side ownership and
existing-DM pinned-line validation remain authoritative at send time.

Foreign URLs, opaque/vendor IDs, multiple images, audio/video, live photos,
carousel/format/rich options and unknown fields reject before dispatch. Metadata
failures cause no send; uncertain send outcomes require reconciliation and are
never automatically resent. Results contain only actual Chert public message ID,
chat ID and status; no protocol or delivery receipt is manufactured.

This is a locally tested source candidate, not installed/physical acceptance.
The old-version CRM comparison is complete; matching native attachment/evidence
support and feature-specific acceptance remain separate release prerequisites. Provider attachment creation/upload is still documented as planned
501 and remains unsupported. Existing text-only sends retain their prior path.

`GET /v4/channels` now lists the complete assigned Chert line identity inventory
when it fits the official default page size of 50. Each item contains only the
actual Chert UUID `id` and canonical phone `address`, using the same namespace as
`getChannel`; `has_more:false` and `next_cursor:null` describe the complete
inventory. No channel type, availability, status, protocol or capability is
inferred. Tenant/project assignment and a valid tenant line pin remain enforced
by the actual Chert `/phone-numbers` route. This is an identity inventory, not a
probe that iMessage is currently registered.

Filters, explicit limits/cursors, unsupported headers or request bodies are
rejected before a Chert request. More than 50 assigned lines, malformed IDs or
numbers, or ambiguous inventory reject the entire response with 502; the
adapter never truncates or invents a pagination cursor. The official current
OpenAPI was rechecked on 2026-10-18 and retains the pinned SHA256 above.

The caption refusal is an adapter-only safety repair: generic Chert legacy media APIs are unchanged. It requires no additional Mac installation beyond the matching strict media server/helper requirements; the completed old-version CRM comparison adds no paired release hold.

## Idempotent supported sends

All supported sends accept an optional `Idempotency-Key`: explicit-from direct
plaintext, existing-chat plaintext and one owned canonical uploaded image in an
existing chat. Keys must be nonempty, lossless UTF-8, at most 200 bytes and contain
no NUL. This is a bounded Chert-compatible subset of the provider header contract.
Vendor authorization and headers are never forwarded.

The adapter freezes the canonical provider route and hashes the original JSON
body (recursively sorted object keys, exact strings and array order). The complete
image URL participates in the body hash: replacing its signature or other
accepted URL bytes changes the request identity even when the attachment ID is
unchanged. The context and key pass to Chert in `message.idempotency_request`
and `message.idempotency_key`; only the hash, not the raw image URL, is persisted
by the matching cloud reservation.

An authenticated read-only `POST /idempotency/lookup` precedes routing and image
metadata reads. A validated historical receipt returns HTTP 200 with the same
public message/chat IDs, even when current sender health or the old capability
would prevent a fresh send. A missing reservation proceeds through normal
metadata/ownership checks to one message POST. If media metadata then fails,
one additional read-only lookup can recover a concurrent accepted reservation;
it never retries dispatch. A fresh queued receipt maps to HTTP 201. Conflicting
requests preserve HTTP 409. Missing or malformed replay metadata is an unknown
outcome, never a reason to send again.

A nonretryable Chert 4103 exposes only validated public reconciliation IDs in
`error.details`; unknown outcomes are never retried automatically. This identity
projection also applies to unkeyed direct plaintext and image uncertainty.
The cloud must support the versioned context, lookup and replay indicator before
using keyed sends. Chert currently retains keyed reservations permanently: this
is stronger deduplication, not proof of Blooio key-expiration parity. Official v4
[idempotency documentation](https://docs.blooio.com/idempotency) does not state
expiration/reuse semantics; older v2 guides describe a 24-hour replay guarantee.
This adapter-only change needs no additional Mac installation.

### Existing qualified webhook management

GET, PATCH and DELETE `/v4/webhooks/{id}` support existing Chert subscriptions
using `blooio-v4/2026-10-01` and a unique supported event set. PATCH accepts only
HTTPS `url`, `status` (`active` or `disabled`), and confirmation of
`api_version: "2026-10-01"`; it preserves filters and version. Responses omit
secrets and unverified clocks. URL bytes are preserved.

Retired narrow `event_types` filters return 422. New all-event registration,
listing, secret rotation, delivery logs and replay remain 501. This subset does
not establish all-event webhook parity or provider-native payload conversion.

Profile qualification and mutation are separate Chert requests. The adapter does not make qualification atomic against another same-tenant administrator changing the subscription profile between them. Mutation responses are checked, but these checks do not add a database compare-and-swap guard.

## External image sources

An existing-chat media-only request may use one public HTTPS image URL. The
adapter sends that exact URL to Chert's authenticated `/attachments/import`,
validates the owned PNG/JPEG record, then uses the strict single-image send path.
It never fetches the source in the caller runtime. Server-side DNS/IP pinning,
redirect, MIME, size and ownership checks remain authoritative; Workers currently
refuse external imports where that pinning is unavailable.

With `Idempotency-Key`, the original URL remains part of the frozen provider
request identity. A historical receipt is looked up before import. Concurrent
imports are reconciled before dispatch and after a dispatch conflict; no send is
retried. Concurrent fresh imports can leave extra owned blobs, so this is not
transactional import deduplication. Cancellation remains cancellation during
reconciliation. Local HTTPS route tests substitute database, Storage, downloader
and native effects; they do not establish fresh physical external-image delivery.
