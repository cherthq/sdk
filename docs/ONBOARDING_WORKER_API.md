# Onboarding worker HTTP contract (v1)

This is the SDK-owned contract to implement in the communications worker. These are new bridge routes, not existing Chert platform endpoints. The caller is `ChertOnboardingWorkerBridge`; the staging host uses it for persisted outbox work. The worker developer owns actual provider effects, hosted concierge, account mapping and line inventory.

## Authentication and retries

All three worker routes below require HTTPS (loopback HTTP is only for local fixtures), POST and JSON. The caller sends:

- `X-Chert-Timestamp`: decimal Unix seconds.
- `X-Chert-Signature`: lowercase hex HMAC-SHA256 with the **outbound** worker secret over `timestamp + ".POST." + path + "." + exactRawJSONBody`.
- `Idempotency-Key`: identical to `body.idempotencyKey`.

Verify the raw body and timestamp (at most five minutes old or future), constant-time signature, expected method/path and body/header key binding before effects. Enforce strict schema/body bounds. Persist the key with a digest of the immutable request before contacting a provider. An exact retry must return the original result; reject the same key with different contents. A fresh HTTP timestamp on a retry does not mean a new send. Uncertain transport outcomes must be reconciled with the provider; never send twice just because the caller timed out.

The client times out after ten seconds, refuses redirects, bounds responses to64KiB and performs no immediate transport retries. The core outbox retries later with the same effect key. Return `Content-Type: application/json`, `{ "data": ... }` on success and a non-2xx status for failures. Do not reflect raw phone numbers, credentials, message bodies or provider errors into error text or logs.

## POST /v1/onboarding/messages

Request:

```ts
{
  to: string; from: string; text: string; idempotencyKey: string;
  context?: {
    sessionId: string; originAgent: string;
    target: { kind: 'personal' | 'project'; projectLabel?: string };
  };
}
```

`to`/`from` are E.164. Core-generated requests always include context; it is data, never an executable prompt/callback. A welcome effect key is `<sessionId>:welcome`; keep its sender/recipient/session association for routing replies. The already-authenticated service appends the first-party browser link to the welcome. Preserve it and the verification code; do not log either. Main-line effects must use only the configured authorized main number and allowlisted staging recipients.

Response: `{ "data": { "accepted": true, "providerMessageId": "..." } }` only after actual provider acceptance or recovery of that same effect. This is not delivery/read evidence. Unavailable or refused sends must not return a fictional accepted ID.

## POST /v1/onboarding/facetime

Request:

```ts
{
  to: string; from: string; sessionId: string; idempotencyKey: string;
  context?: { sessionId: string; originAgent: string;
    target: { kind: 'personal' | 'project'; projectLabel?: string } };
}
```

Response: `{ "data": { "status": "requested" | "busy" | "unavailable" } }`.

Use a configured hosted assistant/LiveKit/provider runtime. The initiating agent must have obtained contact consent and the user must have selected FaceTime onboarding (`chert onboard --prefer-facetime`). Disabled FaceTime configuration refuses that request; the service does not invent a call. `requested` means accepted for dialing, not connected audio/video. `busy` or `unavailable` makes the core queue a message continuation. The assistant explains the originating agent/project context, browser passkey, plan choice and next steps. It must not ask for passwords or private keys in messages or a call.

## POST /v1/onboarding/allocations

Request:

```ts
{
  sessionId: string; userId: string; phone: string;
  plan: 'shared' | 'dedicated'; checkoutId: string;
  target: { kind: 'personal' | 'project'; projectLabel?: string };
  idempotencyKey: string;
}
```

The service invokes this only after verified initial Stripe payment. Independently confirm actual current entitlement, stable mapping of this verified identity to the existing platform account, project ownership and line inventory. Reuse a matching project/allocation when appropriate. The SQLite user ID is not automatically a Supabase/auth user ID: implement an explicit durable bridge, never an accidental duplicate account or owner bypass. Different staging recipients must not share inbound routing state.

Shared is USD25/month (rate-limited messages and the intended 100-minute daily allowance); dedicated is USD250/month per line for the agreed inbound/outbound messaging and FaceTime capabilities. Enforce actual backend limits and accurately report unsupported capacity rather than marking ready. There is no free plan. Prices alone do not establish the entitlement policy.

Response:

```ts
{ data: {
  projectId: string; allocationId: string; entitlementId: string;
  connector: {
    kind: 'existing-connector' | 'hosted-webhook';
    configuration: Record<string, string>;
  };
} }
```

Return only narrowly scoped connector configuration for the intended project/agent. No global worker, Stripe, LiveKit or provider master credentials. Configuration is data, never shell text for the CLI to execute. The adapter permits at most32configuration entries with bounded strings and excludes prototype keys. Persist allocation/idempotency before responding; late results may arrive after the helper expires and are retained for recovery. Worker readiness and a scoped receipt remain separate from physical media proof.

## Worker → service: POST /webhooks/messages

Authenticate the original provider event first, normalize its numbers, recover the correct welcome-session association, then send:

```ts
{ eventId: string; sessionId: string; from: string; to: string; body: string }
```

Use the independent **inbound** secret and the existing service protocol: `X-Chert-Timestamp`, `X-Chert-Signature = hex(HMAC-SHA256(inboundSecret, timestamp + "." + rawJSONBody))`. This differs deliberately from outbound method/path signing; never reuse the keys. The service checks the main-line recipient, sender, challenge and expiry and stores event/body/session bindings. Exact retries are acknowledged after advancement; changed event bindings are rejected.

Do not call passkey or payment trusted methods from a public worker callback. Browser WebAuthn and Stripe signatures are verified by their own service boundaries. There is no public arbitrary `verified:true`, allocation-complete or execute-agent endpoint.

## Recovery and acceptance

The host dispatches one outbox item per tick and runs expiry recovery. `store.pendingPaymentRecoveries()` is a trusted operator/worker inbox for paid sessions that could not allocate or deliver a claimed receipt. Reconcile the real entitlement/allocation or an authorized refund, including any in-flight allocation, then record a concrete resolution through `store.resolvePaymentRecovery`. Do not duplicate payment or silently discard paid sessions. Renewals, cancellation, disputes, refunds, recovery and credential revocation require backend lifecycle integration.

`staging-host.test.ts` proves a local authenticated proxy, service and worker fixture exchange the signed worker requests/callback and produce a CLI receipt using disposable data and a trusted payment fixture. It does not contact iMessage/FaceTime, buy a subscription or prove real inventory. Real provider staging, Stripe test checkout, hardware/browser passkey approval and authorized physical media checks remain release gates in [the main handoff](ONBOARDING_WORKER_HANDOFF.md).
