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
