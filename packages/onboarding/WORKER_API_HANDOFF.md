# Concierge worker API handoff

The SDK repository owns the contracts and state machine. A separate worker developer implements provider bridges and deployment. Do not copy old unlicensed CLI code or create a second state-machine source of truth.

## Public agent flow

- `POST /sessions`: JSON `{phone,contactConsent:true,originAgent,target:{kind:'personal'|'project',projectLabel?},resumeStrategy:'poll'|'manual',ttlSeconds?,preferFaceTime?}`. The human must approve being contacted before this request. Return `{sessionId,pollCapability,expiresAt,state}` and the server-owned secure browser continuation URL.
- `GET /sessions/:id`: `Authorization: Bearer <pollCapability>`. Return `PublicSession` from the core. No secret, raw phone or checkout URL; the authenticated browser obtains its own checkout link. No side effects from arbitrary polling state names.
- `POST /sessions/:id/claim`: same capability. Only `ready` can return the single-use `ClaimPayload`. Write it to an owner-only local handoff file and tell the originating agent where it is. Never execute returned configuration or shell text.
- Cancellation should map to `core.cancel`; it cancels pending setup operations, not an existing Stripe subscription. State expiry does not reverse an already completed payment. Payment reconciliation, refunds and resumed allocations require a durable operator/backend recovery process.

The actual HTTP server owns route prefixes, strict schema/body limits, safe error mapping, caller throttling, capability parsing, TLS origin/RP configuration, security headers and browser CSRF/session protections. Core trusted methods are not public routes. Reject unknown fields and executable resume strategies. Only allow `poll` or `manual`; preserve origin-agent name and project label as data.

## Trusted transitions

1. Dispatch durable welcome outbox via the authorized main-line adapter. Advance to `phone_pending` only after provider acceptance. Signed inbound reply with matching phone/session code advances to `passkey_pending`.
2. Display phone-verified account context in a first-party browser page. Verify a new registration or existing passkey authentication cryptographically and bind to the core's user ID. Advance to `plan_pending`.
3. Human chooses plan. Server creates one Stripe checkout with a stable idempotency key and exact server-owned USD monthly price. Save checkout identity/URL before returning it.
4. Verify Stripe's raw-body signed event and exact paid checkout metadata/price/customer/subscription interval. `recordVerifiedPayment` advances only to `provisioning`; repeated event IDs and checkout identity are deduplicated.
5. Allocation adapter atomically confirms entitlement and line capacity, provisions/reuses the authorized project + allocation, and returns scoped connector details. Then `ready` is claimable once. No fallback fictional keys or demo-ready state.
6. Originating agent claims and configures the personal runtime or repository. It explains remaining model/LiveKit/provider requirements and requests an explicitly authorized recipient before actual communication tests. A local process must remain available unless deployed.

## Required adapters

- Main-line authenticated send with stable idempotency semantics, signed inbound events, sender normalization, delivery acceptance semantics and tenant isolation. A provider-specific event-to-session challenge router is needed; never route by caller-controlled session ID alone.
- Optional real FaceTime request with busy/unavailable result. Active-call/media proof is separate. iMessage can continue while a call is busy; do not fake an answered concierge call.
- Authenticated account/project mapping, paid entitlement lifecycle, idempotent line inventory allocation and scoped connector enrollment. Current CLI credentials cannot create owner checkout or invent passkey authorization.
- Stripe checkout creation/recovery, signed webhook validation, durable out-of-order/lifecycle reconciliation and failed allocation/refund recovery. The core is not a Stripe implementation.
- WebAuthn verification against configured RP/origin and persisted expiring one-time challenge; require user approval. Passkeys identify the same account as verified phone, not phone possession forever. Provide account/number recovery and revocation policy before production.

## Reliability limits / staging gates

SQLite transactions/CAS protect state and durable outbox uniqueness. A unique lease token fences completion/retry callbacks so a slow old dispatcher cannot overwrite a newer claim. Provider sends/allocation remain at least once; adapter idempotency MUST cover crash-after-provider-success. A 60-second lease requires bounded provider timeouts and one stable key per operation. Interrupted `ready` allocation is not reallocated. Rate-limit initial contact at edge and per phone. Encrypt backups, protect SQLite files, schedule retention cleanup, document key rotation and recover expired paid sessions without charging again.

Before production: run real-provider staging contact/verification, wrong sender/code, replay, two concurrent sessions, new/existing passkeys, wrong RP/origin, duplicate checkout/payment events, payment success/allocation failure, missing inventory, restart/retry, expiry/cancel, one-time claim, credential leakage, and actual worker configuration acceptance. Physical call audio/video and message delivery require separately authorized real-device tests. Current deterministic tests establish core behavior only. No production provider calls, purchases or database mutations were performed here.
