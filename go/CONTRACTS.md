# Go API coverage and contracts

The HTTP SDK uses module `github.com/cherthq/sdk/go`, package `chert`, Go 1.23+,
and the MIT license, with no third-party dependencies. It does not implement a
media runtime. Endpoint defaults do not establish service availability.

## Implemented route matrix

All paths are relative to `/api/v1`. `Result[T].Response` preserves full JSON and
HTTP metadata. FaceTime success responses require the server's `data` envelope and
nonempty `request_id`; modeled fields are decoded, unknown fields retained raw.

| Go methods | Route and success status | Credential / limit |
| --- | --- | --- |
| SendText | POST text-operations/v1, 202 | Legacy iMessage key + optional tenant, or unified session with imessage:messages:send and contract echo; exact queued receipt; body key |
| SendReaction | POST chats/:chat/messages/:message/reactions, 202 | iMessage key + optional tenant; exact acknowledged receipt; header key; part zero |
| ListEvents, GetEvent | GET events, events/:rowID | iMessage key + optional tenant; list limit 1–200; webhook delivery status |
| ListWebhookSubscriptions, GetWebhookSubscription | GET webhook-subscriptions, webhook-subscriptions/:id | iMessage key + optional tenant |
| CreateWebhookSubscription, UpdateWebhookSubscription, DeleteWebhookSubscription | POST collection, PATCH/DELETE item | iMessage key + optional tenant; creation returns one-time secret; no replay helper |
| StreamEvents | GET events/stream, SSE | iMessage key + optional tenant; one connection; 1 MiB frame cap; context and configured timeout |
| ListCalls, GetCall | GET calls, calls/:id, 200 | FaceTime project read |
| CreateCall | POST calls, 201 | Project write; required stable key; managed or BYOR |
| CallAction | POST calls/:id/answer, /reject, /end, 202 | Project write; required key; optional reason has no guaranteed effect |
| GetCallEvents, GetTranscript | GET calls/:id/events, /transcript, 200 | Project read; transcripts excluded from CLI-token allowlist |
| ListLines, ListWorkers | GET lines, workers, 200 | Project read; single page, no GET detail methods |
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
| BillingStatus | GET billing, 200 | Signed-in user + project; entitlement preserved as JSON |
| CreateCheckout, CancelSubscription, ValidateCoupon | POST billing `{action: checkout\|cancel\|validate_coupon}`, 200 | Signed-in user + project; stable key required; returns URL / cancellation request / coupon assessment |

Billing support is a preview contract, not a guarantee of availability or live
payments. Check `BillingStatus` before initiating checkout.

## Deliberate limits

- No binary iMessage media upload/download, signed URL consumption, provider
  adapters, SMS fallback, lifecycle polling, chat/history/contacts/read-state
  convenience models are claimed. Use raw JSON access
  for authorized uncovered JSON routes; use a separately reviewed transport for
  binary media. Strict text and reaction receipts prove acceptance only.
- iMessage event/subscription/SSE support is a source preview, not deployment
  evidence. List cursors/time filters and opaque stream continuations differ.
  Delivery metadata describes webhooks, not recipient delivery. SSE never
  reconnects automatically or sends Last-Event-ID. VerifyWebhook checks exact raw
  bytes using Chert v1 HMAC-SHA256 and ±300-second freshness; deduplicate separately.
- FaceTime GetCallEvents returns snapshots, not an SSE stream. Customer LiveKit
  integration carries media; no event response establishes working audio/video.
- FaceTime account/project administration, API-key lifecycle, integrations,
  webhooks, previews, activation and connector runtime are not typed here.
  Raw access does not add server permissions.
- Assistant configuration, nullable patch bindings and evolving connector response
  payloads deliberately retain JSON. This is not complete schema validation;
  server validation and authorization remain authoritative. Call status strings
  stay open for forward compatibility. New fields are available in raw responses.
- The SDK does not auto-approve sign-in, allocate lines, manage billing migrations,
  bind projects across services, fetch a room URL, start an agent or connect media.
- Local tests use synthetic HTTP responses. They establish SDK wire behavior,
  not deployed route compatibility, live payments, delivery or working audio/video.

## Reproducible verification

Run `bash scripts/check-go.sh` at the repository root for formatting, vet, unit and
loopback contract tests, race tests, module verification/tidy/build, and an isolated
external consumer with network module resolution disabled. The consumer imports
the copied module payload with a local replacement, not a published registry tag.
`example_test.go` compiles and executes documentation examples without production
traffic. No live send, call or payment is performed.
