# Concierge onboarding: worker and API handoff

## Scope and current boundary

The SDK repository owns the CLI, onboarding state machine, provider interfaces and this runbook. Another developer must implement the hosted HTTP service and worker/provider integration described here. No production authentication, billing, database migration, message or call is performed by this change. Existing platform auth is not yet passkey/phone onboarding. The packages remain private and unpublished.

The CLI automates context detection, starting a consented session, protected temporary state, bounded background polling, one-time receipt retrieval and a continuation file. It cannot authorize a payment, create a passkey without user presence, or safely inject a prompt into arbitrary agent processes.

## CLI-facing HTTP contract

Use HTTPS and `Cache-Control: no-store`; localhost HTTP is development only. JSON responses may be a direct object or `{ "data": object }`. Errors must be bounded, sanitized and must not include secrets. Never redirect capability-bearing requests. All timestamps use epoch milliseconds or ISO strings; prefer epoch milliseconds consistently.

| Route | Authentication | Request | Response / behavior |
| --- | --- | --- | --- |
| `POST /sessions` | Public, rate-limited; explicit contact consent | `{phone, contactConsent:true, originAgent, target:{kind:"project"|"personal", projectLabel?}, resumeStrategy:"poll"|"manual", ttlSeconds:7200}` | `{sessionId,pollCapability,expiresAt,state}`. Random capability returned once; hash at rest. Max two-hour TTL. Do not log phone or capability. |
| `GET /sessions/:id` | `Authorization: Bearer <pollCapability>` | none | `{sessionId,state,phoneVerified,passkeyRegistered}`. No raw phone, credentials, checkout secrets or executable instructions. `ready` only after verified identity, payment and allocation. |
| `POST /sessions/:id/claim` | Same capability | `{}` | One-time `{sessionId,userId,projectId,allocationId,entitlementId,connector:{kind,configuration},target,originAgent,resumeStrategy}` receipt. Scope any credentials to the chosen project and intended connector; never return admin/provider master secrets. Atomic claim, reject replay. |

Local cancellation currently erases the helper capability and stops polling; no remote cancellation route is called. Add an authenticated remote cancellation contract and CLI support together before promising that cancellation stops contact. The server must enforce expiry even when the helper is gone.

## Hosted browser and trusted callback routes to implement

These are proposed server routes, not existing supported platform endpoints. Finalize them with the core interfaces and add integration tests before release.

| Route | Required behavior |
| --- | --- |
| `GET /onboarding/:id` | Safe user-facing context, originating agent/project label, current step; separate expiring browser token, never expose CLI polling capability in URLs. |
| `POST /webhooks/messages` | Validate provider signature over raw body, timestamp and replay ID before calling `acceptVerifiedInbound`. Match sender plus challenge/session; inbound iMessage proof is separate from payment and passkey presence. |
| `POST /onboarding/:id/passkey/options` | Bind server-generated, single-use WebAuthn challenge to phone-verified session, RP ID, expected origin and account/user ID; short expiry. |
| `POST /onboarding/:id/passkey/verify` | Verify real WebAuthn attestation/assertion using maintained server tooling; check origin/RP/user verification/challenge and replay. Only then call trusted core passkey method. Never trust a client `verified:true`. |
| `POST /onboarding/:id/plan` | CSRF/browser-session protected selection: shared USD25/month or dedicated USD250/month/line. Do not accept a client-controlled Stripe price or amount. |
| `POST /onboarding/:id/checkout` | Server creates a Stripe subscription checkout using configured price IDs, session/account/plan metadata and idempotency key. Return a hosted checkout URL; user completes it. Test mode until staging gate passes. |
| `POST /webhooks/stripe` | Verify raw-body Stripe signature and deduplicate event IDs. Reconcile subscription/payment status, currency, amount/price, customer and session binding. Success redirect is not payment proof. |
| internal provision/reconcile job | Reuse or provision authorized project and shared/dedicated allocation idempotently. Validate entitlement before issuing scoped connector credentials. Call `completeProvisioning` only after actual allocation. No public unauthenticated provisioning endpoint. |

## What the communications worker must provide

- A configured Chert main number and an outbound-message adapter accepting an idempotency key, recipient and context-safe message. Return provider acceptance separately from delivered/read evidence. Retry via persisted outbox without duplicate contact.
- Signed inbound events with stable event ID, sender, recipient, message body and timestamp. Route replies to the correct unexpired challenge. Never treat outbound acceptance as phone verification.
- A hosted onboarding assistant with a real FaceTime/LiveKit session adapter, busy/declined handling and message-only continuation. If no hosted assistant is configured, use messages honestly; do not fabricate a call URL or claim a connected session.
- The assistant explains who initiated setup, what the user must do, plan pricing and what happens next. It supplies bounded passkey/payment links tied to that session and can resume after interruption.
- An allocation adapter that atomically reuses/provisions the project and correct line type after entitlement, returns stable project/line IDs, and reports capacity/payment failures without marking ready.
- A connector receipt appropriate to personal agent or project integration, with explicit runtime instructions and narrowly scoped credentials. Keep LiveKit/provider master credentials server-side. Existing project settings must not be overwritten silently.
- Worker readiness and media evidence as separate signals: fresh heartbeat/accepting state is not proof of connected audio/video, camera response or message delivery.

## Identity, state and persistence

Read `packages/onboarding/src/core` for the actual exported contract. The core is a library, not an HTTP deployment. It uses an injected store and provider adapters; the SQLite store targets a Bun server. A Cloudflare Worker cannot import `bun:sqlite`: provide a D1/Durable Object implementation of the store contract or deploy the Bun service separately. Preserve atomic transitions, outbox persistence and one-time claims under concurrent requests.

Phone verification, passkey and account must reference the same stable user ID; a device-login token is not a passkey. Define an explicit bridge to the existing platform account system before rollout. No silent duplicate account or project creation. Encrypt phone and receipt secrets at rest; keep server encryption/HMAC keys in deployment secrets and document rotation/recovery. Poll capabilities are hashed; browser challenges are single-use and expiring. Rate-limit session creation by phone HMAC and source, enforce consent, cap verification attempts, and suppress logs containing phone, codes, tokens or payment URLs.

## Acceptance / release gates

1. Local disposable database: exercise consent refusal, bad/expired code, wrong sender/session, replayed webhook, duplicate dispatch, concurrent claim, expired helper, invalid origin, bad passkey challenge and payment/plan mismatch. Test real HTTP serialization against the CLI, not only mocked fetch.
2. Staging: connect actual message provider + test number, verify inbound ownership and passkey association on the same account. Exercise interrupted onboarding and existing-account/project reuse.
3. Stripe test mode: complete both subscription prices, verify signatures/replays, failed/cancelled checkout, delayed webhook and allocation failure. Payment alone must never yield a ready receipt.
4. Staging worker: complete a real FaceTime session and message-only fallback; prove media independently from session/queue acceptance. Continue into both personal-agent and project integration without repeated payment.
5. Review concrete production target, secrets, price IDs, account migration and rollback before production approval. Rollback disables new sessions/contact, drains or pauses outbox and preserves existing paid allocations; do not delete identity or billing records.

Publishing/merging is also required: `https://trychert.com/setup` should redirect to `https://github.com/cherthq/sdk/blob/main/setup.md` after the file is merged and the repo is publicly readable. Until then anonymous agents cannot follow it. Do not switch repository visibility as part of this PR.

## Deployment configuration to supply

These are required configuration categories, not implemented environment-variable names. The worker owner should choose names in a checked-in secret-free example and validate them at startup:

| Configuration | Purpose |
| --- | --- |
| Public onboarding origin, allowed browser origins, WebAuthn RP ID | First-party links, challenge/origin verification and CSRF policy |
| Persistent transactional store, encryption/HMAC key and rotation version | Session/outbox durability and protected identity/receipt storage |
| Chert main-line identity, provider credentials, inbound signing secret | Consent-based contact and authenticated inbound proof |
| Hosted assistant/LiveKit configuration and credentials | Optional real FaceTime concierge, with busy/message fallback |
| Stripe test secret, webhook signing secret, shared/dedicated monthly USD price IDs | Test checkout and verified subscription lifecycle |
| Existing account/project service authorization and line allocator | Stable identity bridge, entitlement, capacity and scoped connector issuance |
| Request/contact limits, challenge TTL, two-hour maximum session TTL | Abuse protection and bounded helper lifetime |

Do not put provider secrets into the website bundle, CLI prompt, Git history or completion receipt. The marketing `/setup` route is a documentation redirect, not the onboarding service API origin.
