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
| SendText | POST text-operations/v1, 202 | iMessage key + optional tenant; exact queued receipt; body key |
| SendReaction | POST chats/:chat/messages/:message/reactions, 202 | iMessage key + optional tenant; exact acknowledged receipt; header key; part zero |
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
| GetBillingCatalog | GET billing/catalog, 200 | Public, no credentials; exposes test/disabled state |
| CurrentCheckout, CreateCheckout | GET/POST billing/checkout, 200 | Owner browser user + project; creation requires stable key; current may be null |

Billing support is a preview contract, not a guarantee of availability or live
payments. Check the catalog's test/disabled state before initiating checkout.

## Deliberate limits

- No binary iMessage media upload/download, signed URL consumption, provider
  adapters, SMS fallback, lifecycle polling, chat/history/contacts/read-state
  convenience models, or webhook verification is claimed. Use raw JSON access
  for authorized uncovered JSON routes; use a separately reviewed transport for
  binary media. Strict text and reaction receipts prove acceptance only.
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
