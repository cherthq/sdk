# Concierge onboarding: worker and API handoff

## Scope and current boundary

The SDK repository owns the CLI, onboarding state machine, provider interfaces and this runbook. The SDK now supplies a runnable HTTP handler, first-party browser flow, WebAuthn verification and a Stripe test-mode adapter. Another developer must connect and stage the worker/provider integrations described here. No production authentication, billing, database migration, message or call is performed by this change. Existing platform auth is not yet passkey/phone onboarding. The packages remain private and unpublished.

The CLI automates context detection, starting a consented session, protected temporary state, bounded background polling, one-time receipt retrieval and a continuation file. It cannot authorize a payment, create a passkey without user presence, or safely inject a prompt into arbitrary agent processes.

## CLI-facing HTTP contract

Use HTTPS and `Cache-Control: no-store`; localhost HTTP is development only. JSON responses may be a direct object or `{ "data": object }`. Errors must be bounded, sanitized and must not include secrets. Never redirect capability-bearing requests. All timestamps use epoch milliseconds or ISO strings; prefer epoch milliseconds consistently.

| Route | Authentication | Request | Response / behavior |
| --- | --- | --- | --- |
| `POST /sessions` | Public, rate-limited; explicit contact consent | `{phone, contactConsent:true, originAgent, target:{kind:"project"|"personal", projectLabel?}, resumeStrategy:"poll"|"manual", ttlSeconds:7200}` | `{sessionId,pollCapability,expiresAt,state}`. Random capability returned once; hash at rest. Max two-hour TTL. Do not log phone or capability. |
| `GET /sessions/:id` | `Authorization: Bearer <pollCapability>` | none | `{sessionId,state,phoneVerified,passkeyRegistered}`. No raw phone, credentials, checkout secrets or executable instructions. `ready` only after verified identity, payment and allocation. |
| `POST /sessions/:id/claim` | Same capability | `{}` | One-time `{sessionId,userId,projectId,allocationId,entitlementId,connector:{kind,configuration},target,originAgent,resumeStrategy}` receipt. Scope any credentials to the chosen project and intended connector; never return admin/provider master secrets. Atomic claim, reject replay. |

`POST /sessions/:id/cancel` uses the same bearer capability and `{}` body. The CLI attempts it under its helper lock. Only a matching confirmed response reports remote cancellation; otherwise local polling still stops and the result explicitly says remote contact may continue. The core refuses cancellation after checkout reservation; stopping a helper never cancels a subscription. The server enforces expiry independently.

## Browser routes and trusted callbacks

These routes are implemented by `createOnboardingHandler` in `packages/onboarding/src/http/server.ts`, independently of the existing platform API. Local HTTP fixtures exercise them; live provider/account integration and staging deployment remain required.

| Route | Required behavior |
| --- | --- |
| `GET /onboarding/:id?token=...`, `POST /onboarding/:id/open` | The first GET shows a non-consuming landing page so link previews cannot burn the grant. A same-origin JSON POST exchanges the one-time token for an HttpOnly, path-scoped SameSite=Lax browser cookie. The URL is then stripped. Never use the CLI poll capability as a browser token. |
| `GET /onboarding/:id`, `GET /onboarding/:id/status` | Browser-cookie authenticated context and safe status. The page uses CSP nonces, no external resources, no-store and no-referrer. |
| `POST /webhooks/messages` | Inject a provider-native signature verifier, or use the documented HMAC worker bridge below. Validate raw body/timestamp before `acceptVerifiedInbound`. Match recipient main line, sender and challenge/session; event bindings acknowledge exact retries after advancement. |
| `POST /onboarding/:id/passkey/options` | Bind server-generated, single-use WebAuthn challenge to phone-verified session, RP ID, expected origin and account/user ID; short expiry. |
| `POST /onboarding/:id/passkey/verify` | Verify WebAuthn anonymous attestation/assertion using pinned MIT SimpleWebAuthn server tooling; check origin/RP/user verification/challenge and replay. Only then call trusted core passkey method. Never trust a client `verified:true`. |
| `POST /onboarding/:id/plan` | CSRF/browser-session protected selection: shared USD25/month or dedicated USD250/month/line. Do not accept a client-controlled Stripe price or amount. |
| `POST /onboarding/:id/checkout` | Server creates a Stripe subscription checkout using configured price IDs, session/account/plan metadata and idempotency key. Return a hosted checkout URL; user completes it. The included adapter rejects live keys/events entirely. Checkout expiry is bounded to the session; remaining time below Stripe's 30-minute minimum refuses new checkout. |
| `POST /webhooks/stripe` | Verify raw-body Stripe signature and deduplicate event IDs. Reconcile subscription/payment status, currency, amount/price, customer and session binding. Success redirect is not payment proof. Signed payment arriving after session expiry or closure is stored in the durable reconciliation inbox, not lost or marked ready. |
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

Read `packages/onboarding/src/index.ts` for exported core, HTTP and provider contracts. The handler is a library deployment entry point; it does not start a public service automatically. It uses an injected store and provider adapters; the SQLite store targets a Bun server. This entry is Bun-specific and imports `bun:sqlite`. A Cloudflare port needs a worker-safe module entry and compatible transactional stores (the core contract is synchronous, so an async D1 wrapper is not a drop-in adapter). Alternatively deploy this Bun service separately. Preserve atomic transitions, outbox persistence and one-time claims under concurrent requests.

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


## Running the local service and integrating a host

Run `bun packages/onboarding/src/http/preview.ts` for a disposable loopback-only UI at `http://localhost:4192/fixture`. It uses reserved example phone numbers, no network provider, no billing adapter, an in-memory encryption key and owner-only temporary databases. Its fixture controls simulate a phone reply; they are not a production phone-verification API. Stop it with SIGINT/SIGTERM to remove those databases. Never expose the fixture publicly.

A staging host creates `SqliteOnboardingStore` and `SqliteBrowserStore` in an owner-only data directory, loads a stable 32-byte server key, wraps its messaging adapter with `withBrowserLinks`, creates `OnboardingCore`, then calls `createOnboardingHandler`. Supply exact public `origin`, matching `rpId`, main line, a socket-derived `sourceKey`, provider verifier, mode `staging` and truthful configured capability flags. `GET /capabilities` reports test/unconfigured billing and `productionReady:false` explicitly. Do not treat those flags as physical media proof.

The host must run and await a durable dispatcher calling `core.flushOutbox()`; requests only persist work. Do not start untracked promises in a serverless request. Configure adapters with timeouts shorter than the outbox lease and stable idempotency keys. A Bun host can schedule a single-flight dispatcher; a Cloudflare host requires a compatible store/dispatcher implementation. WebAuthn is pinned to required user verification, anonymous attestation (`none`), exact RP/origin and one-time five-minute challenges. Existing phone identities must use their already-bound passkey; possession of the phone alone does not authorize adding a new passkey. Account recovery is a separate unreleased process.

## Signed worker-to-service bridge

`hmacInboundVerifier({secret})` expects JSON `{eventId,sessionId,from,to,body}`, `Content-Type: application/json`, `X-Chert-Timestamp` as Unix seconds and `X-Chert-Signature` as lowercase hex HMAC-SHA256 of `timestamp + "." + rawBody`. It accepts timestamps within five minutes and the core stores an HMAC binding for event ID/session/sender/body. The worker must authenticate its provider-native event before signing this bridge envelope; never forward arbitrary caller-supplied `verified` fields. `to` must match the configured main line. Use a separate secret of at least 32 random bytes, never the browser/poll token. Exact retries are acknowledged even after state advances; changed bindings are rejected.

## Payment recovery and remaining lifecycle work

`reserveCheckout` atomically fixes the selected plan before the Stripe request. Cancellation and plan changes are then refused until payment reconciliation; a transport failure is retried with the same Stripe idempotency key, not a second purchase. The test adapter creates a USD monthly subscription for a configured server-owned price and validates signed events against freshly retrieved Checkout, subscription, line price, customer and paid invoice. No trial, discount, mismatched price or live-mode event yields readiness. A success/cancel GET from Stripe remains a permitted browser navigation; all browser mutations still require exact Origin and CSRF.

`store.pendingPaymentRecoveries()` returns durable verified paid checkouts whose helper/session expired or closed before recording payment. The worker/operator must bind them to the existing account, reconcile paid entitlement/allocation or arrange an authorized refund, and only then call `store.resolvePaymentRecovery(checkoutId, concreteReference)`. No public route exposes or resolves this inbox. Recovered paid accounts need a fresh authenticated agent handoff; never duplicate checkout because the original helper expired. The core sweeper also records paid provisioning/ready sessions before clearing expired credentials, including allocations that finish after expiry. Run `core.expireSessions()` periodically; `flushOutbox()` invokes it too. Claimed sessions are not reallocated. The local tests prove persistence/deduplication of this inbox, not a real refund or entitlement change.

Renewals, cancellation, dunning, disputes, refunds, account recovery, stable existing-platform user mapping, hosted media and real line inventory remain integration work. Production is not ready until those are staged and reviewed. The local HTTP tests use a software authenticator with real COSE keys and signed assertions; they do not prove Touch ID or a physical browser authenticator. The in-app test browser does not expose the virtual WebAuthn DevTools methods, so hardware/browser passkey acceptance is explicitly pending.

## Configured staging host

The SDK now includes `staging-config.ts`, `staging-host.ts` and the `staging.ts` command. Copy the secret-free names from `packages/onboarding/.env.example` into an authorized staging secret manager. Keep the data directory outside the checkout, owned by the service user with mode0700; database files must be regular owner-only files. Existing permissive directories/files are refused rather than silently changed. The host retains persistent data on shutdown.

From the checkout run `bun packages/onboarding/src/http/staging.ts --check-config` to validate configuration without a listener, filesystem mutations or provider traffic. Build with `bun run build`, then run `bun packages/onboarding/dist/staging.js` after the staging environment and test-recipient contact authorization are ready. The host binds only `127.0.0.1:4193` by default. A separately configured restricted HTTPS reverse proxy must terminate TLS for the exact public origin; never expose the loopback listener directly. The host rewrites URLs from the configured public origin and ignores forwarded host/protocol headers. Every upstream request must carry the independent `X-Chert-Proxy-Token` matching `CHERT_PROXY_SECRET`, plus `X-Chert-Client-IP` set from the proxy's actual client socket. The proxy must strip and overwrite client-supplied versions of both headers; never copy a visitor's arbitrary forwarding header. Only after proxy authentication does the host accept the validated IP for rate limits. Direct loopback requests without that proxy token are refused, and malformed/disallowed sessions do not consume the contact allowance.

`CHERT_DEPLOYMENT_ENV=staging`, explicit E.164 test-recipient allowlist (maximum20), independent proxy and inbound/outbound worker secrets, stable32-byte base64url encryption key, HTTPS public origin and test-only Stripe settings are mandatory. No production mode or free plan is enabled. FaceTime defaults off; enable it only when its hosted worker runtime is staged. `GET /capabilities` reports configured adapters rather than proof of live media. The worker bridge and exact routes/signatures are in [ONBOARDING_WORKER_API.md](ONBOARDING_WORKER_API.md).

The dispatcher runs single-flight, one durable effect per tick. A completed HTTP request is not a delivery acknowledgement; look for actual provider acceptance, inbound proof, allocation and media evidence separately. SIGINT/SIGTERM shares one shutdown promise across repeated signals, stops the listener, waits for the in-flight dispatcher and closes databases without deleting paid/account state. The check-config subprocess tests block network/listener APIs; host tests use loopback proxy, application and worker HTTP servers, signed worker requests, a blocked in-flight dispatch during repeated shutdown, and a trusted payment fixture. They are local integration evidence, not deployed staging.
