# Blooio legacy SDK adapter

This subclasses the actual Apache-2.0 `@blooio/sdk@0.0.2` package. Its API is
the legacy `/v1/api/messages` SDK, **not** Blooio v4. The pinned original has no
runtime dependencies or outbound telemetry integration. Its resource classes,
APIPromise and APIError behavior remain the original SDK's.

```ts
import Blooio from '@cherthq/blooio-adapter';

const client = new Blooio({
  chert: { baseURL: 'https://your-chert-host', apiKey: process.env.CHERT_API_KEY! },
});
await client.messages.send({
  to: '+15551234567', text: 'hello', 'Idempotency-Key': 'one-logical-send',
});
```

Explicit Chert connection options are mandatory. Vendor credentials are unused:
the original client receives a stub token and virtual `.invalid` base URL;
only Chert receives a request. Text sends use `ChertClient.sendText`, which calls Chert-relative `/send`
(default `POST /api/v1/send`) with `{phone,body,idempotency_key?}`.
Use the public Chert service, not a device-local endpoint.
Only canonical E.164 recipients and nonempty lossless UTF-8 plaintext up to
16 KiB are supported. The original SDK's `Idempotency-Key` header maps to the
Chert body key (nonempty, at most 200 UTF-8 bytes); upstream HTTP header
normalization still applies. SDK retries are disabled; no legacy `/send` fallback
occurs, including when an older cloud returns 404.

Only a confirmed Chert receipt is accepted: HTTP 202 `status:queued`, or HTTP 200
`status:sent`/`duplicate`, with a safe `message_id` and `chat_id`; the send response
carries that `message_id` and `status`. Anything else produces an unknown-outcome error after one attempt;
reconcile the recorded ID before any resend. No send or delivery observation,
service, or occurrence timestamp is inferred from acceptance. Error data may
retain an explicit durable public ID for reconciliation; diagnostic strings are
sanitized by the shared client. Attachments, metadata, unknown send fields,
message cancellation and other unsupported operations fail before Chert fetch.

Service availability is separate from SDK support. Local tests do not establish
production authentication or physical message delivery.

Tests use the actual original SDK with a mocked Chert fetch; no live send or
vendor network request is needed.

## Recorded status and retrieval

`client.messages.getStatus(eventId)` and `client.messages.retrieve(eventId)`
use tenant-scoped Chert `GET /api/v1/messages/{eventId}`. Use a durable ID
returned by the strict cloud text operation (or historical `/send`). Direct Mac runtimes may not implement this read,
and historical records may be unavailable; those return the original SDK's
NotFoundError. This SDK does not migrate historical records.

Both methods return actual `message_id` and a supported observed lifecycle state.
A recorded `sent` with explicit `delivered: true` becomes `delivered`; queued
never becomes sent or delivered. Unsupported `received`, `read`, `duplicate` or
unknown statuses stay absent rather than being relabelled. This is not read-receipt
support. Retrieve additionally maps actual `phone` to recipient `external_id`,
explicit direction, and confirmed returned service to protocol. Creation time is
not a send timestamp: `time_sent` is omitted. Raw request bodies, credentials and
unobserved metadata are not returned. Returned identity must match the requested
ID. Both reads preserve cancellation and never retry; cross-tenant authorization
remains the server's responsibility and its 404/403 errors retain SDK error classes.

## Authenticated identity subset

`client.me.retrieve()` uses the actual SDK's `GET /v1/api/me` operation and maps
to Chert `GET /api/v1/whoami`. It returns only `{valid: true}` or `{valid: false}`
from an explicitly boolean `is_active` observation. Missing or incompatible
identity evidence returns an SDK error; authentication errors remain the original
SDK error classes, never a fabricated `{valid:false}` success.

API keys, devices, account usage, integrations, metadata and billing plans are
omitted. Unknown paths, body/query overrides and retry overrides reject
before network; cancellation reaches the single Chert request. This is an
identity-check subset, not full Blooio account metadata compatibility.

Run `bun test packages/blooio-adapter` for synthetic SDK contract checks.
