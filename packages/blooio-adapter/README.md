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
only Chert receives a request. Text sends use Chert-relative `/text-operations/v1`
(default `POST /api/v1/text-operations/v1`) with `{phone,body,idempotency_key?}`.
This is the authenticated cloud route, not the same-path internal Mac endpoint,
which takes a frozen native operation tuple. Direct Mac-only runtimes do not
implement the public recipient-only contract.
Only canonical E.164 recipients and nonempty lossless UTF-8 plaintext up to
16 KiB are supported. The original SDK's `Idempotency-Key` header maps to the
Chert body key (nonempty, at most 200 UTF-8 bytes); upstream HTTP header
normalization still applies. SDK retries are disabled; no legacy `/send` fallback
occurs, including when an older cloud returns 404.

Only a strict HTTP 202 receipt with actual compact public message ID, owned chat
ID, `success:true` and `status:queued` is accepted. Missing, contradictory, extra
or legacy response fields produce an unknown-outcome error after one attempt;
reconcile the recorded ID before any resend. No send or delivery observation,
service, or occurrence timestamp is inferred from acceptance. Error data may
retain an explicit durable public ID for reconciliation; diagnostic strings are
sanitized by the shared client. Attachments, metadata, unknown send fields,
message cancellation and other unsupported operations fail before Chert fetch.

This is an unreleased source candidate. It requires the paired cloud route and
compatible strict native/helper protocol; it does not activate or install either,
and this SDK change is not physical iMessage or production-auth acceptance.

Tests use the actual original SDK with a mocked Chert fetch; no live send or
vendor network request is needed.

## Recorded status and retrieval

`client.messages.getStatus(eventId)` and `client.messages.retrieve(eventId)`
use tenant-scoped Chert `GET /api/v1/messages/{eventId}`. Use a durable ID
returned by the strict cloud text operation (or historical `/send`). Direct Mac runtimes may not implement this read,
and historical cloud records may lack a durable send-event record; those
correctly return the original SDK's NotFoundError. The current branch chat routes
persist their returned IDs, but this does not migrate historical records.

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
SDK error classes, never a fabricated `{valid:false}` success. The real Chert
authenticator normally rejects inactive tenants before this response exists.

API keys, devices, account usage, integrations, metadata and billing plans are
omitted. The Chert route's current fixed plan label is not evidence of a customer
subscription. Unknown paths, body/query overrides and retry overrides reject
before network; cancellation reaches the single Chert request. This is an
identity-check subset, not full Blooio account metadata compatibility.

`tests/whoami-http.test.ts` additionally runs the official SDK through real
loopback HTTP, the actual whoami handler and actual bearer/tenant authentication.
Only database storage is substituted with synthetic tenant rows. Active,
inactive, invalid-key and required-tenant-header cases retain exact SDK outcomes.
This does not establish production database, deployment or credential validity;
it contacts no live cloud, device or provider. No Mac installation is required.
