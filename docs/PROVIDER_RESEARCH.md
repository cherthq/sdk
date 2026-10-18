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
