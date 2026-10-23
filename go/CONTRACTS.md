# Go coverage and source audit — 2026-10-23

This is an HTTP SDK source audit, not deployment or physical acceptance evidence.
The Go module stays `github.com/cherthq/sdk/go`, package `chert`, Go 1.23+, MIT,
with no third-party dependencies. Nothing here implements a media runtime.

## Branch, PR and history inventory

The audit used `git fetch origin`, `git branch -avv`, `git ls-remote --heads`,
`git log --all -- go`, per-ref `go` tree comparisons, and all 11 GitHub PRs then
present (open/closed/merged). No Go-specific remote branch or PR existed. The
local `unified-go-sdk` branch began at the shared orb-setup commit; current public
`origin/main` was merged before implementation, preserving that existing setup.

Go history before this work has two substantive commits:

- [`5cd380a`](https://github.com/cherthq/sdk/commit/5cd380ae4664a0f7fa957025f578cff6955adb19): initial Go/.NET transport and HTTP checks.
- [`ed19d7d`](https://github.com/cherthq/sdk/commit/ed19d7d41d9a6492c17bbffda29b8c74019d8c72): module naming aligned to `cherthq/sdk`; package `chert` retained.

All inspected refs containing `go/` had the same pre-change Go tree: main,
the archived pre-history main, public-sdk-release-main, trychert-sdk-release,
codex/cherthq-scope, codex/chert-adopt, codex/more-provider-adapters,
codex/agent-onboarding-cli, feat/unify-facetime-cli, fix/adopt-unresolved-rewrites,
and unified Python/Rust/C++/C# branches. The SDK-foundation ref predates Go.
Local setup/review/provider-audit/release worktrees likewise had the same Go tree.
There was no alternative Go implementation to cherry-pick or discard.

PRs #1–4 are historical scope/adoption/provider fixes; #5–6 are onboarding/CLI
previews; merged #10 establishes the public JS baseline; open drafts #7–9 and #11
are the C++, Rust, C# and Python unified clients. They are comparison material,
not authority to merge their work or claim their releases/acceptance.

## Contract sources and cross-language differences

- Public SDK baseline: main at
  [`70558c6`](https://github.com/cherthq/sdk/commit/70558c6), particularly
  `packages/imessage/src/index.ts`, strict reaction tests, and
  `packages/control-plane/{index.ts,BACKEND_COVERAGE.md}`.
- Executable FaceTime server routes, `http.ts`, `schemas.ts`, `store.ts`,
  `cli-login.ts`, `connectors.ts`, `billing-owner.ts`, and destination schemas
  inspected in the backend checkout at HEAD
  `b5e0de5ddec188cbe872f48e58fba331092a5ecb` **plus local uncommitted/untracked changes**.
  The committed tree supplies call, assistant, line, settings, login and connector
  routes. Billing routes, `billing.ts`, `billing-owner.ts` and the billing migration
  are local draft files absent from that commit; `data-access.ts` and `store.ts`
  also have local modifications. Billing support is therefore a draft wire
  contract, also reflected in the public JS client, not a reproducible contract
  at that backend SHA or a claim of deployment. No backend changes were imported,
  committed or published by this work.
- Production endpoint evidence: messaging attachment API documentation uses
  `console.trychert.com`; FaceTime's `auth-urls.ts` and public SDK guide use
  `facetime.trychert.com`. Defaults are configuration, not availability checks.
- JS and Python's initial unified draft emphasize login/inventory/connectors/billing.
  Rust/C++/C# drafts additionally model call control, assistants and settings.
  This Go API covers both groups while retaining raw JSON for unstable schemas.
  The Go client does not copy the JS facade's shared-project assumption.

The pre-change Go client already had bounded strict JSON, no redirect/proxy/retry,
strict text and reaction receipts, and context-aware HTTP. It lacked FaceTime,
default production URLs, raw header idempotency, and independent unified
configuration. The audit also found typed iMessage receipt errors discarded a
deadline/cancellation cause after receiving HTTP headers; that cause is preserved.

## Implemented route matrix

All paths are relative to `/api/v1`. `Result[T].Response` preserves full JSON and
HTTP metadata. FaceTime success responses require the server's `data` envelope and
nonempty `request_id`; modeled fields are decoded, unknown fields retained raw.

| Go methods | Route and success status | Credential / limit |
| --- | --- | --- |
| SendText | POST text-operations/v1, 202 | iMessage key + optional tenant; exact queued receipt; body key |
| SendReaction | POST chats/:chat/messages/:message/reactions, 202 | iMessage key + optional tenant; exact acknowledged receipt; header key; part zero |
| ListCalls, GetCall | GET calls, calls/:id, 200 | FaceTime project read |
| CreateCall | POST calls, 201 | Project write; required stable key; production managed or BYOR |
| CallAction | POST calls/:id/answer, /reject, /end, 202 | Project write; required key; server currently discards optional reason |
| GetCallEvents, GetTranscript | GET calls/:id/events, /transcript, 200 | Project read; transcripts excluded from CLI-token allowlist |
| ListLines, ListWorkers | GET lines, workers, 200 | Project read; single page, no invented GET detail routes |
| UpdateLine | PATCH lines/:id, 200 | Project write; nullable bindings; not activation |
| ListAssistants, GetAssistant | GET assistants, assistants/:id, 200 | Project read |
| CreateAssistant, UpdateAssistant | POST assistants, 201; PATCH assistants/:id, 200 | Project write; update requires expected draft revision; configuration stays JSON |
| PublishAssistant | POST assistants/:id/publish, 201 | Project write; no idempotency guarantee |
| GetSettings, UpdateSettings | GET/PUT settings, 200 | Project read/write; replace LiveKit hostname allowlist |
| BeginLogin, PollLogin | POST cli/logins, 201; cli/logins/token, 202 pending / 200 approved | Public; no auth headers; token returned once; caller controls poll interval |
| InspectLogin, ApproveLogin | POST cli/logins/inspect, /approve, 200 | Signed-in user; approval requires human authorization and owner/admin membership |
| WhoAmI, Logout | GET cli/whoami; POST cli/logout, 200 | Project user/CLI identity; logout requires CLI token and no project header |
| ListCredentials, RevokeCredential | GET cli/credentials; DELETE cli/credentials/:id, 200 | Owner/admin browser user + project; not CLI/project-key authorization |
| ListConnectors, EnrollConnector, ActivateConnector, DrainConnector, RevokeConnector | GET/POST connectors, 200 | Owner/admin user principal; permitted CLI owner/admin may manage; no runtime provided |
| GetBillingCatalog | GET billing/catalog, 200 | Public, no credentials; exposes test/disabled state |
| CurrentCheckout, CreateCheckout | GET/POST billing/checkout, 200 | Owner browser user + project; creation requires stable key; current may be null |

## Deliberate limits

- No binary iMessage media upload/download, signed URL consumption, provider
  adapters, SMS fallback, lifecycle polling, chat/history/contacts/read-state
  convenience models, or webhook verification is claimed. Use raw JSON access
  for authorized uncovered JSON routes; use a separately reviewed transport for
  binary media. Strict text and reaction receipts prove acceptance only.
- FaceTime project/bootstrap, account/membership, API-key lifecycle, integrations,
  webhooks, previews, activation, development, worker/admin/internal routes and
  connector runtime are not typed here. Raw access does not add server permissions.
- Assistant configuration, nullable patch bindings and evolving connector response
  payloads deliberately retain JSON. This is not complete schema validation;
  server validation and authorization remain authoritative. Call status strings
  stay open for forward compatibility. New fields are available in raw responses.
- The SDK does not auto-approve sign-in, allocate lines, migrate billing, bind
  projects across services, fetch a room URL, start an agent or connect media.
- Local tests use synthetic HTTP responses and do not execute the backend's
  database/native boundaries. They establish SDK wire behavior, not deployed
  route compatibility, live payments, delivery or physical audio/video acceptance.

## Reproducible verification

Run `bash scripts/check-go.sh` at the repository root for formatting, vet, unit and
loopback contract tests, race tests, module verification/tidy/build, and an isolated
external consumer with network module resolution disabled. The consumer imports
the copied module payload with a local replacement, not a published registry tag.
`example_test.go` compiles and executes documentation examples without production
traffic. Existing strict iMessage tests remain in place. No deployment or Mac
installation is required, and no live send/call/payment is performed.
