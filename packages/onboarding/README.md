# Chert concierge onboarding

Original server-side TypeScript core with durable Bun SQLite storage and injectable providers. This package is the SDK repository's source of truth for onboarding state and worker integration. It does not claim that unconfigured messaging, FaceTime, Stripe or entitlement infrastructure works end to end.

## Core

```ts
import {OnboardingCore, SqliteOnboardingStore} from './src/core';
const store = new SqliteOnboardingStore({path: '/private/chert/onboarding.sqlite'});
const core = new OnboardingCore({store, secretKey, mainLine: '+14155550100', messaging, allocator});
const session = core.createSession({phone: '+14155550123', contactConsent: true,
  originAgent: 'Codex', target: {kind: 'project', projectLabel: 'my-app'}, resumeStrategy: 'poll'});
await core.flushOutbox();
```

`secretKey` is a stable 32-byte server key; load it from an authorized secret store, never source control. Store the database and its WAL/SHM files in an owner-only directory and exclude them from logs/source control. Phones, message bodies/challenges and one-time ready credentials are AES-256-GCM encrypted at rest. Phone lookup/rate keys and polling capabilities use domain-separated HMACs. User IDs, states, project labels and public passkey material are stored in clear; do not put secrets in labels. Keep backups and the encryption key separately protected. Key rotation/migration and retention cleanup require deployment work.

State sequence: `contact_pending` → `phone_pending` → `passkey_pending` → `plan_pending` → `payment_pending` → `provisioning` → `ready` → `claimed`. Cancellation, expiry and explicit trusted failure are terminal. Sessions expire within two hours. Phone codes expire within ten minutes, permit five matched-sender attempts, and are tied to their session. Contact initiation is limited to three sessions per phone per hour; the HTTP edge must additionally rate-limit caller/IP to prevent abuse across arbitrary numbers. Existing phone identities are reused, but each session still proves control. Passkeys bind to that same identity.

`createSession` requires explicit human contact consent. Polling exposes context and state without phone, user ID, checkout links or credentials. Claim returns configuration exactly once, then deletes its encrypted copy. Capability possession authorizes polling/cancellation/claim only; it must never authorize a browser identity registration or payment callback. Poll capabilities belong in Authorization headers and owner-only local files, not query strings, logs or third-party resources.

## Providers and server responsibility

`MessagingProvider.sendMessage` receives main-line `from`, recipient `to`, `text`, and a stable `idempotencyKey`. It MUST deduplicate uncertain outcomes on that key: an at-least-once outbox cannot guarantee unique external sends by itself. `requestFaceTime` is optional and returns `requested`, `busy` or `unavailable`; busy/unavailable queues an iMessage continuation. Requested means accepted, not connected or verified media. FaceTime requests require explicit opted-in preference. The adapter never invents a call. Provider requests must have bounded network timeouts shorter than the 60-second outbox lease.

`AllocationProvider.allocate` must check durable active entitlement, authorized account/project association, actual inventory, recipient routing isolation and idempotent allocation. It returns project, allocation, entitlement and scoped connector configuration; it must not return global provider/LiveKit master credentials. A payment receipt alone only advances to `provisioning`. No allocator means the session remains there with retryable outbox work. There is no automatic purchase retry.

After verifying raw provider webhook signature, timestamp and event authenticity, the trusted HTTP server calls `acceptVerifiedInbound({eventId,sessionId,from,body})`. Route the reply to its pending challenge; do not trust a client-supplied session ID as identity. The core checks sender + code + expiry, hashes code attempts and durably deduplicates event IDs. It never authenticates a provider signature itself.

After actual WebAuthn verification, the trusted server calls `registerVerifiedPasskey` or `acceptVerifiedPasskey`. `registrationContext` returns the expected verified user ID. The server owns one-time registration/authentication challenges, RP ID, exact origin, user presence/verification, attestation/signature validation and replay prevention. `store.getPasskey`/`getPasskeys` provide public key and counter material. The core rejects another identity's credential and non-increasing nonzero counters. Never expose these trusted callbacks directly as arbitrary client event APIs.

Plans are USD25/month shared or USD250/month dedicated. `choosePlan` reports minor-unit price; `attachCheckout` accepts only a validated Stripe-hosted HTTPS checkout URL and a stable matching checkout ID. The server must create a purchase idempotently and validate exact product/price, subscription interval, currency, customer and session metadata against server-owned configuration. Only an authenticated Stripe webhook may call `recordVerifiedPayment`. No payment receipt implies inventory or ready access. Production payment/authentication rollout requires staging verification and explicit approval.

## Verification

`bun test packages/onboarding/tests/core.test.ts` exercises isolated SQLite persistence/reopen, CAS, stale outbox lease fencing, contact consent, expiry, provider retries, deduplication, attempts, cross-session/cross-identity rejection, encrypted data at rest and delivery-bound receipt acknowledgement. It does not contact a provider, charge, mutate a production database, or prove a physical FaceTime call. See [WORKER_API_HANDOFF.md](./WORKER_API_HANDOFF.md) for the implementation boundary and missing staging gates.


## HTTP service and browser preview

`createOnboardingHandler` implements the CLI session routes, separately authenticated first-party browser pages, signed inbound webhook bridge, actual SimpleWebAuthn registration/authentication and Stripe test-only checkout/webhook coordination. Build with `bun run build`; the package root exports the core, HTTP handler, browser store and Stripe adapter. The service does not enable production payments or supply a live communications worker.

Run `bun packages/onboarding/src/http/preview.ts` from repository root for a disposable loopback-only demonstration. It does not contact phones, charge money or create an installed account. See the [canonical worker/API handoff](../../docs/ONBOARDING_WORKER_HANDOFF.md) for complete routes, signature protocol, host configuration, dispatcher, recovery queue and outstanding staging gates.

Browser grants are distinct from CLI capabilities. Link-preview GETs do not consume them; a same-origin POST creates an HttpOnly SameSite=Lax cookie. Mutations require Origin and CSRF. Passkeys require user verification and anonymous attestation, one-time challenges and exact RP/origin. Existing verified identities use their bound passkey; phone possession cannot add a replacement key. Checkout reservation prevents plan/cancel races. Expired-session payments enter a durable reconciliation inbox; no paid receipt is silently discarded or treated as an allocated line.

## Persistent staging entry

The secret-free `.env.example` lists required settings. Validate with `bun packages/onboarding/src/http/staging.ts --check-config`; after the root build, `bun packages/onboarding/dist/staging.js` runs the persistent staging host behind a separately configured HTTPS proxy. It permits only explicitly allowlisted test recipients and test Stripe keys, authenticates its TLS proxy and uses independent worker signing keys, runs the durable dispatcher and preserves owner-only databases on shutdown. The worker must implement the [v1 bridge contract](../../docs/ONBOARDING_WORKER_API.md). No provider endpoint, public staging origin or real test-recipient authorization was supplied in this change, so no live staging traffic was sent.

Receipt retrieval remains in `ready` until a capability- and delivery-bound `POST /sessions/:id/claim/ack`. The CLI saves its protected handoff before acknowledgement; retrying lost claim/ack responses cannot repeat allocation. Unacknowledged delivery expires into the existing paid recovery inbox.
