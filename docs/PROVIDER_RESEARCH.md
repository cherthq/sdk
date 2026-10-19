# Provider research

## Photon / Spectrum and additional provider review — 2026-10-19

Current primary-source web/package research identifies separate Photon surfaces,
not one interchangeable SDK. Official registry versions observed today:

| Boundary | Observed version | Integration implication |
| --- | --- | --- |
| `spectrum-ts` / `@spectrum-ts/imessage` | 12.11.0 / 12.11.0 | Spectrum is Photon's framework; its iMessage provider uses the Advanced gRPC client. A Chert custom provider would integrate the framework without claiming Photon wire compatibility. |
| `@spectrum-ts/core` | 12.12.0 | Independently versioned; do not assume lockstep package versions. |
| `@photon-ai/advanced-imessage` | 2.3.0 | Root defaults to HTTP; `./grpc` is separate. HTTP uses protobuf JSON and action routes such as `/v1/messages:sendText`; durable catch-up/subscription belongs to gRPC. Public client options do not expose per-client fetch injection. |
| `@photon-ai/chat-adapter-imessage` | 3.2.0 | Separate Chat SDK boundary; this release pins Spectrum core/iMessage 10.0.0. Current Spectrum 12 is not automatically its tested contract. |
| `@photon-ai/imessage-kit` | 3.0.0 | Local Mac chat.db/AppleScript API, not a hosted HTTP client. Do not substitute remote records for claimed local database access. |
| `@photon-ai/advanced-imessage-kit` | 1.16.0 | Legacy HTTP/Socket.IO boundary; keep migration coverage separate from Advanced 2.3. |

Official sources: [Spectrum repository](https://github.com/photon-hq/spectrum-ts),
[Advanced package](https://www.npmjs.com/package/@photon-ai/advanced-imessage),
[local SDK](https://github.com/photon-hq/imessage-kit),
[Chat SDK adapter](https://www.npmjs.com/package/@photon-ai/chat-adapter-imessage).
Read-only extracted declarations are retained in
`/private/tmp/chert-photon-research-20261019/`. No package runtime was executed.
Spectrum's dependency closure includes `@photon-ai/otel`; it has not been added
as a Chert dependency or allowed to emit telemetry.

Chert's existing signed HTTP event poll and `chert.imsg.v1.IMessageProvider`
protobuf names are not Photon gRPC compatibility. Reuse canonical events,
ownership and durable cursor services behind an explicitly tested translation.
Candidate boundaries are a Chert Spectrum custom provider, a separately tested
Photon HTTP wire gateway for the genuine SDK, and a direct Chert Chat SDK
adapter. These are proposed integration boundaries, not implemented packages.
Only iMessage behavior is in scope; Spectrum's other transports are excluded.

Additional primary-source candidates:

- [BlueBubbles REST/webhooks](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks): self-hosted REST envelopes, server-password query authentication and event subscriptions form a distinct compatibility target.
- [Miss Blue API](https://missblue.dev/docs): currently public project-scoped bearer API for messages, conversations, numbers and delivery. Older comparison pages saying its reference is gated are stale.
- [Claw Messenger docs](https://www.clawmessenger.com/docs): REST sends plus persistent WebSocket replies and sync; acceptance and confirmed delivery are separate states. Do not copy its non-iMessage fallback behavior.
- [Contiguity iMessage](https://contiguity.com/products/imessage) and [webhook documentation](https://docs.contiguity.co/api-reference/webhook/overview): iMessage is a channel in its broader communications API; an iMessage-only contract needs separate current schema/security verification before implementation.

[Sendara](https://www.sendara.io/) was found as a CRM/iMessage product, but this
review did not establish a complete public API schema. Product marketing alone
is insufficient for a drop-in adapter. No new provider above has passed Chert
route/device acceptance or is represented as full compatibility.

## BlueBubbles message-read contract audit — 2026-10-19

No BlueBubbles adapter package was added. The audited server revision is
`f2e2286241a7c3b6617a82b37d4afaab4df3a6b9`; this is a contract finding, not
implemented compatibility or device acceptance.

`GET /api/v1/message/:guid` returns the serialized native message, and
`POST /api/v1/message/query` returns those same records plus offset/limit/total/count.
The optional `with` expansions add nested data; they do not select a reduced
field schema. See the pinned [message router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts#L73),
[serializer](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/serializers/MessageSerializer.ts#L117)
and [required response type](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/types.ts#L23).

Chert's owned message GET has native GUID, text, direction and qualified lifecycle
facts, but lacks required native `originalROWID`, `handleId`, `otherHandle`,
`subject`, numeric `error`, `isArchived`, `itemType`, `groupActionType` and
balloon/associated/expressive metadata. Its resource `created_at` is not always
the Apple message creation timestamp required by `dateCreated`. Public resource
IDs, nulls, zeros and queue clocks cannot replace those facts. Returning only
GUID/text would omit required fields rather than satisfy the documented read
contract. Query pagination additionally needs complete qualified native inventory
and genuine count/filter semantics.

A useful compatible read implementation first needs a tenant/account-bound,
read-only native-message metadata projection exposing those exact typed facts,
including actual Apple creation/delivery/read clocks and native row/handle IDs.
Ownership must remain bound to the selected line and exact GUID; unavailable
facts must refuse the projection. This is a backend prerequisite, not a proposed
SDK placeholder. Sends also remain unsupported: Chert queue acceptance cannot
stand in for BlueBubbles' completed send result.

Typing has a small success envelope, but its route identifies a native chat GUID.
Chert's typing route currently identifies an owned public lead/chat and a pinned
line; no authenticated native-chat-GUID-to-owned-chat/account mapping is exposed.
Parsing a phone from that GUID would discard the missing ownership binding.
No typing facade was added. The pinned [typing router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/chatRouter.ts#L293)
and [HTTP route definitions](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/httpRoutes.ts#L362)
were inspected without calling a provider or device.

### Photon HTTP send-result boundary

The inspected official `@photon-ai/advanced-imessage@2.3.0` declaration's
`Message` requires an actual native `guid`, original `dateCreated: Date`,
`chatGuids`, `content`, reaction/sticker arrays and numerous native flags
(`isArchived`, `isAutoReply`, `isCorrupt`, `isDelayed`, `didNotifyRecipient`,
`sendErrorCode`, among others). A Chert public queued ID and outbox creation
clock cannot establish that record. Returning empty arrays, zero error or false
flags would assert facts the present public response does not supply.

This is an additional reason that replacing only Photon HTTP send action URLs
would not be faithful SDK compatibility. A future native projection must supply
and validate those facts for an owned message, or an explicitly different
Chert API must expose queue receipts. This audit adds no Photon adapter or gRPC/
event compatibility claim. Source: the published 2.3.0 `Message` declaration in
`dist/groups-D5YRVJAL.d.ts`, read alongside the official
[client repository](https://github.com/photon-hq/advanced-imessage-ts).

## iMessage provider inventory — 2026-10-19

Scope: products that expose iMessage (blue-bubble) messaging to developers.
SMS-only, WhatsApp-only, RCS-only and Apple Messages for Business vendors are out
of scope. Sources are official docs, OpenAPI files or source repositories read
on 2026-10-19; fetched content was treated as data. No provider API was called
and no credential was used. "Adapter" means a `@cherthq/<id>-adapter` package
in this repository; see [COMPATIBILITY.md](../COMPATIBILITY.md) for per-operation
status.

Adapter rule used below: the provider's documented *success* contract for an
operation must be satisfiable by facts Chert actually returns (queue acceptance,
owned line inventory, typing acknowledgement). Operations whose success means
"completed by device", that need native GUIDs, scheduling, SMS fallback,
auto-expiring typing, or provider-only identity models are rejected or the
provider gets no adapter.

### Inventory

| Provider | Kind / maturity | Official docs | Auth | Base URL | Text / media | Reactions | Typing | Read receipts | Groups | Webhooks | Rate limits / restrictive terms | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linq | Hosted SaaS; SDK 0.78 | [docs.linqapp.com](https://docs.linqapp.com/) | Bearer | `https://api.linqapp.com/api/partner` (SDK default) | See adapter README | | | | | | | Existing adapter `linq` |
| Sendblue | Hosted SaaS; SDK 3.20 | [docs.sendblue.com](https://docs.sendblue.com/) | `sb-api-key-id` / `sb-api-secret-key` | `https://api.sendblue.co` (SDK default) | See adapter README | | | | | | SMS/RCS fallback product | Existing adapter `sendblue` |
| Blooio | Hosted SaaS | [docs.blooio.com](https://docs.blooio.com/) | Bearer | legacy SDK `https://backend.blooio.com`; v4 `https://api.blooio.com/v4` | See adapter READMEs | | | | | | | Existing adapters `blooio`, `blooio-v4` |
| LoopMessage | Hosted SaaS | [loopmessage.com/apidocs](https://loopmessage.com/apidocs/send-message/) | Raw `Authorization` key | `https://a.loopmessage.com/api/v1` | See adapter README | | | | | | | Existing adapter `loopmessage` |
| MissBlue | Hosted SaaS; OpenAPI 1.0.0 | [missblue.dev/docs](https://missblue.dev/docs) | Bearer | `https://api.missblue.dev/v1` | See adapter README | | | | | | | Existing adapter `missblue` |
| **Texting Blue** | Hosted relay through the customer's own iPhone (Shortcut polling); ToS dated 2026-02-01, test keys "coming soon" | [docs.texting.blue](https://docs.texting.blue/) | `x-api-key: tb_live_…` (scoped permissions) | `https://api.texting.blue/v1` | `POST /messages/send` `{to,from,content,media_url?}` → **202 queued**; content ≤5,000 chars; media Standard plan+ | No | No | Implied (device) | No | `message.received/sent/delivered/failed`, `x-textingblue-signature: sha256=` HMAC of body | 60–5,000 req/min, 5–200 msg/min, monthly caps; 402 on plan limit. ToS bans spam/bulk without consent | **New adapter `texting-blue`** |
| **Contiguity** | Hosted multi-product API; iMessage is a dedicated `/send/imessage` surface; API `v2026.9.27` | [docs.contiguity.com](https://docs.contiguity.com/api-reference/product/imessage/send) | `Authorization: Token …` | `https://api.contiguity.com/send` | `POST /imessage` `{to,from?,message,fallback?,attachments?,effect?,fast_track?}` → 200 `{id,timestamp,api_version,object,data:{message_id}}`; markdown-style formatting | `POST /imessage/reactions` (matches by message *content*) | `POST /imessage/typing` `{to,from?,action}` | `POST /imessage/read` | — | HMAC-SHA256 `Contiguity-Signature` | Rate limited per second (unspecified); opt-in SMS/RCS `fallback`; `fast_track` needs separate terms | **New adapter `contiguity`** |
| **Blue Reacher** | Hosted SaaS, CRM-first, dedicated lines | [bluereacher.com/docs](https://bluereacher.com/docs) | `Authorization: Bearer brk_live_…` | `https://api.bluereacher.com/v1` | `POST /messages`; `drip` (default, scheduled ~10 min) or `instant` (`status:"dispatched"`, `device_id`) | `POST/DELETE /reactions` | `POST /typing` (auto-expiring window, `expires_at`) | `POST /read` | Yes | Signed, `event_id` | Instant 10/min/key; 50 opted-in / 30 cold new contacts per line per day; **automatic RCS then SMS fallback** | **New adapter `bluereacher`** (instant 1:1 text only) |
| **Jared** (open source) | Self-hosted macOS bot, MIT; last commit 2023-01-02 (`969f145`) | [REST API doc](https://github.com/ZekeSnider/Jared/blob/master/Documentation/restapi.md) | None (loopback) | `http://localhost:3005` per docs; code default 3000 | `POST /message` `{body:{message},recipient:{handle}}` → empty 200 once parsed and handed to sender | No | No | No | Group GUID handle | Outbound webhooks | Runs as the signed-in Apple ID; unmaintained | **New adapter `jared`** |
| BlueBubbles (open source) | Self-hosted macOS server | [REST/webhooks](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) | `?password=` query | User host `/api/v1` | Send returns completed native message | Private API | Private API | Private API | Yes | Yes | Some features need SIP disabled | No adapter — audit above: completed-send/native-record contracts |
| imessage-rs (open source) | Rust/Swift BlueBubbles-compatible server, 0.1.0 | [docs.rs/imessage-rs](https://docs.rs/imessage-rs) | BlueBubbles | BlueBubbles | BlueBubbles | — | — | — | — | BlueBubbles | macOS 15+, Full Disk Access | No adapter — same contract as BlueBubbles |
| Photon / Spectrum | Hosted + SDKs | See Photon section above | Token | gRPC / protobuf-JSON HTTP | Native `Message` records | Yes | Yes | Yes | Yes | gRPC streams | Telemetry dependency | No adapter — see above |
| MessageBlue | Hosted gateway to Mac agents; OpenAPI 1.0.0 | [docs.messageblue.ai](https://docs.messageblue.ai/welcome), [spec](https://api.messageblue.ai/docs) | HMAC request signing (`X-App-Id`, `X-Timestamp`, `X-Nonce`, `Authorization: HMAC`) | `https://api.messageblue.ai` | `POST /sendIndividualMessage` → **200 "Completed by agent"** with `messageGuid`/`chatGuid` | `/reactToMessage` (native GUID) | `/sendTypingIndicator` with `typingDuration` 1–20 s | `/sendReadReceipt` | Yes | `X-MB-Signature` | Automatic SMS fallback | No adapter — success means native completion with Apple GUIDs; typing auto-expires |
| Inkbox | Hosted agent-identity platform | [inkbox.ai/docs/api/imessage](https://inkbox.ai/docs/api/imessage) | `X-API-Key` | `https://inkbox.ai/api/v1/imessage` | `POST /messages` → 201 envelope requiring `assignment_id`, `service`, per-recipient lifecycle | Yes | Yes | Yes | Dedicated lines | Yes | 100 sends/identity/24 h; pre-reply 159-char, 3-message limits; router-number connection model | No adapter — identity/router/assignment facts Chert does not have |
| Claw Messenger | Hosted agent relay | [clawmessenger.com/docs](https://www.clawmessenger.com/docs) | Bearer (REST), `?key=` (WebSocket) | `https://claw-messenger.onrender.com` | Send only over **WebSocket** `{type:"send"}` | — | — | — | `chatId` | WebSocket push | `selectedService:auto`, `fallbackAllowed:true` | No adapter — not an HTTP send contract; fallback by default |
| SendiMessage | Hosted SaaS, PHP SDK | [sendimessage.com](https://www.sendimessage.com/), [SDK](https://github.com/sendimessage/sendimessage-php) | `X-API-Key` + `X-API-Secret` | `https://api.sendimessage.com/v1` | `POST /send-message` `{number,content}` → `message_handle`, `QUEUED` | — | — | — | — | Signed | **Routing is automatic; no channel field**; opt-out enforced | No adapter — SMS fallback cannot be disabled; schema only in SDK README |
| Tuco AI | Hosted CRM automation | [docs.tuco.ai](https://docs.tuco.ai/) | API key | `https://app.tuco.ai/api` | Lead-based sends (iMessage/SMS/email) | Yes | — | — | — | 9 event types | ~50 new / ~150 total per line per day; refuses cold lists | No adapter — lead/workspace model, multi-channel |
| Zernio | Unified inbox (WhatsApp/SMS/social + iMessage) | [zernio.com](https://zernio.com/blog/imessage-for-business-api) | API key | Shared inbox API | Via unified conversations | Yes | Yes | Yes | Yes | Yes | Resold Apple-registered numbers | No adapter — not an iMessage-specific contract |
| Courio | Hosted SaaS + MCP | [courio.app](https://www.courio.app/) | — | — | — | — | — | — | — | HMAC | Free sandbox 100 msgs | No adapter — public API reference not retrievable (JS-only site) |
| TextLink / Blububl | SMS gateway with managed iMessage "virtual SIMs" | [docs.textlinksms.com/imessage](https://docs.textlinksms.com/imessage) | Bearer | `https://textlinksms.com/api` | Sends use the generic SMS API; iMessage-specific calls are capability check and media | — | — | — | — | SMS webhooks | Custom onboarding only | No adapter — send contract is SMS API with implicit routing |
| Mobile Text Alerts | SMS platform with iMessage sender identities | [developers.mobile-text-alerts.com](https://developers.mobile-text-alerts.com/tutorials/message-sending/send-an-imessage/send-imessages) | API key | `/send` | Subscriber-list sends routed automatically | — | — | — | — | Delivery webhooks | Opt-in per sender identity; SMS fallback | No adapter — SMS-first routing |
| Beeper Desktop API | Local multi-network client API | [developers.beeper.com/desktop-api](https://developers.beeper.com/desktop-api/) | Bearer / OAuth (local) | `http://localhost:23373` | Send by Beeper/Matrix `chatID` | Yes | — | — | Yes | WebSocket `/v1/ws` | iMessage only on macOS; local-only by default | No adapter — opaque multi-network chat IDs with no owned-chat mapping |
| mautrix-imessage / beeper/imessage | Matrix bridges | [mautrix/imessage](https://github.com/mautrix/imessage), [beeper/imessage](https://github.com/beeper/imessage) | Matrix appservice | Matrix | Matrix events | Matrix | Matrix | Matrix | Matrix | — | Go bridge relies on reverse-engineered Apple registration | No adapter — Matrix protocol, not a provider HTTP API; reverse-engineered transport out of scope |
| AirMessage | Self-hosted server + proprietary client protocol | [airmessage-server](https://github.com/airmessage/airmessage-server) | Password / Connect | Custom TCP/WebSocket | — | — | — | — | — | — | Firebase/Sentry configuration in build | No adapter — no public REST contract |
| danikhan632/iMessage-API | Hobby Flask script | [repo](https://github.com/danikhan632/iMessage-API) | `api_key` header | User host `/send` | Text | — | — | — | — | — | — | No adapter — too thin to pin |

### New adapter notes

- **Texting Blue**: the documented 202 `queued` receipt is exactly Chert queue
  acceptance. `from` is an explicit connected number, mapped to Chert's
  explicit-sender `/chats` route. Message IDs are Chert public IDs, not `msg_…`.
- **Contiguity**: `from` is optional ("random iMessage number of yours"), mapped
  to Chert's recipient-only strict text route when omitted. The response `id`
  and `timestamp` describe the adapter's own response (`req_`/`err_` + 16 random
  hex), not a Contiguity or Chert request ID. Markdown-style formatting is
  interpreted by Contiguity but not by Chert, so text containing those markers is
  rejected rather than delivered with literal asterisks. The `typing` response
  example shows only `started`; `stopped` for `action:"stop"` is inferred.
- **Blue Reacher**: only `send_mode:"instant"` with explicit `device_id` maps —
  drip scheduling, auto-balanced lines and SMS/RCS fallback do not. `dispatched`
  is reported for Chert queue acceptance. The error envelope is not published;
  the adapter emits `{success:false,error,message}`.
- **Jared**: target origin is caller-configured loopback. The upstream 200 has
  an empty body, which Chert queue acceptance satisfies.

Observed SHA-256 of fetched pages (HTML may change without notice): Texting Blue
messages `8e5bc9e7…11a49f`; Contiguity send.md `abc0e12e…9622ea`, typing.md
`9cf18f16…32f78f`; Blue Reacher send-message `e0ec78a6…84997f57`.
