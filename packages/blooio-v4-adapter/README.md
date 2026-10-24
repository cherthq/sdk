# @trychert/sdk/blooio-v4-adapter

A restricted Blooio v4 HTTP fetch replacement, not an official JavaScript SDK.
The legacy `@blooio/sdk@0.0.2` API uses a separate adapter.

```ts
import { createBlooioV4Fetch } from '@trychert/sdk/blooio-v4-adapter';
const fetch = createBlooioV4Fetch({ chert: { apiKey: process.env.CHERT_API_KEY! } });
const response = await fetch('https://api.blooio.com/v4/messages', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: '+15551234567', to: '+15557654321', text: 'Hello' }),
});
```

Chert defaults to `https://console.trychert.com`; `chert.baseURL` is an optional
explicit override. Vendor credentials are never forwarded. Use actual Chert IDs,
not vendor-prefixed IDs. Obtain consent before real communications.

## Supported HTTP subset

| Path under `/v4` | Contract |
| --- | --- |
| `POST /messages` | Explicit canonical E.164 `from`, `to`, nonempty text. |
| `POST /chats/{id}/messages` | Existing-chat text or one PNG/JPEG image, without captions. |
| `GET /chats/{id}/messages` | Recorded text/single-media history; order asc/desc, limit 1–200 (default 50), opaque cursor. |
| `GET /chats/{id}/messages/{messageId}` | Owned recorded subset with exact message/chat identity. |
| `GET /chats/{id}/messages/{messageId}/status` | Actual ID and known recorded status only. |
| `POST /chats/{id}/typing` | Optional started/stopped state, default started. |
| `DELETE /chats/{id}/typing` | Stop; no body. Acknowledgement does not prove visible typing. |
| `GET /chats/{id}` / `/contacts/{id}` | Owned direct-phone-chat/contact identity and recorded nullable name. No group/provider metadata. |
| `GET /channels` / `/channels/{id}` | Assigned Chert UUID/phone identity. Listing requires a complete inventory of at most 50; no pagination/filter overrides. |
| `GET`, `PATCH`, `DELETE /webhooks/{id}` | Existing qualified subscriptions only; see below. |

Successful fresh sends return HTTP 201 with actual message/chat IDs and status.
Queued is acceptance, not delivery. Unknown lifecycle fields remain absent;
missing required identity or incompatible metadata fails, never partial success.
Not-found is not evidence that a message was unsent.

Other channels, groups, aliases, routing options, scheduling, rich content,
read-receipt requests, reactions and unlisted endpoints are unsupported. Explicit
protocol/no-fallback requirements cannot be guaranteed by this adapter and reject
before sending. Do not infer eventual wire transport from provider API shape.
Queries, bodies and headers are limited to each documented method. Vendor headers
cannot override Chert authorization. Cancellation propagates; retries are disabled.

## Images and idempotency

Existing-chat media sends accept `attachments:[url]` with no `text` key, including
no empty/null caption. Use one owned configured-origin Chert download capability
or a public HTTPS image URL for server-side import. Metadata must establish an
uploaded PNG/JPEG of at most 100 MiB. The caller runtime does not fetch the URL.
Multiple images, audio/video and provider upload operations are unsupported.

All supported sends accept an optional `Idempotency-Key`: nonempty lossless UTF-8,
at most 200 bytes, no NUL. Equivalent keyed replay returns HTTP 200 with the
original IDs; changed requests conflict with HTTP 409. The full image URL is
part of request identity. No provider key-expiration parity is promised. A replay
does not renew old media URLs or guarantee continued download availability.
Concurrent imports may leave additional attachments; import deduplication is not
transactional. No send is automatically retried.

Network or incompatible mutation receipts produce `502 outcome_unknown`.
Validated Chert reconciliation IDs may appear in `error.details`; reconcile
before manual retry. Missing IDs are never guessed.

## Existing qualified webhooks

Management supports existing subscriptions using `blooio-v4/2026-10-01` with
a supported unique event set. PATCH permits HTTPS `url`, `status` active/disabled
and confirmation of `api_version:'2026-10-01'`; responses omit secrets and
unverified clocks. Profile qualification and mutation are separate requests,
not an atomic guard against concurrent administrative changes.

New all-event registration, listing, secret rotation, delivery logs, replay and
provider payload conversion remain unsupported. Retired narrow `event_types`
filters return 422; unsupported operations return 501.

Contract: [official OpenAPI](https://docs.blooio.com/openapi.json),
`4.0.0-beta`; selected structural schemas are in `fixtures/contract.json`.
Run `bun test packages/blooio-v4-adapter`. Local synthetic tests do not establish
deployed service availability, provider parity or physical delivery.
