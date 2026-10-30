# @cherthq/contiguity-adapter

Private Fetch-compatible replacement for Contiguity's iMessage send and typing
endpoints (API `v2026.9.27`), backed by Chert. It is not the `contiguity` SDK or a
full Contiguity replacement: SMS, email, OTP, identity, FaceTime and leasing are
outside scope. It never contacts Contiguity, forwards the `Authorization: Token`
header, retries, or adds telemetry/dependencies.

```ts
import {createContiguityFetch} from '@cherthq/contiguity-adapter';
const contiguityFetch = createContiguityFetch({chert: {
  baseURL: 'https://messaging.example.com', apiKey: process.env.CHERT_API_KEY!,
}});
await contiguityFetch('https://api.contiguity.com/send/imessage', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({to: '+14155551234', from: ownedChertLine, message: 'Hello'}),
});
```

| Operation | Status |
| --- | --- |
| `POST /send/imessage` | Partial: keys limited to `{to,from?,message}`. E.164 phone `to`; `from` E.164 or omitted/`null`; lossless nonblank text ≤16 KiB, no NUL. With `from`: Chert explicit-sender `POST /chats`. Without: Chert recipient-only `POST /send` via `ChertClient.sendText` (owned line policy, existing Apple DM). Confirmed receipt (202 `queued` or 200 `sent`/`duplicate`) → HTTP 200 envelope `{id,timestamp,api_version,object:'response',data:{message_id}}`. |
| `fallback`, `attachments`, `effect`, `fast_track` | Unsupported (501), including explicit `null`. The adapter does not initiate SMS/RCS fallback; this does not prove device-level fallback is disabled. |
| iCloud email `to` | Rejected (400). |
| Markdown-style formatting | Text matching `**…**`, `__…__`, `~~…~~`, `*…*` or `_…_` is rejected (501): Contiguity renders it, Chert would deliver it literally. This is deliberately conservative (e.g. `snake_case_name` matches). |
| `POST /send/imessage/typing` | Supported subset: exactly `{to,from,action}` with explicit E.164 `from`; maps to Chert `POST /typing` once and requires an applied receipt. `data.status` is `started`/`stopped` (`stopped` is inferred; the docs only show `started`). |
| `/send/imessage/reactions` | Unsupported: targets the latest message matching *content*, which Chert cannot resolve to an owned message ID. |
| `/send/imessage/read`, history, message fetch, cancel, availability, webhooks | Unsupported. |

Field gaps: `id` (`req_`/`err_` + 16 hex) and `timestamp` identify the adapter's
own response; they are not Contiguity or Chert request IDs. `message_id` is the
actual 32-hex Chert public ID, not `imsg_…`, and means queue acceptance only.

Errors use the documented `{…,object:'error',data:{error,status}}` envelope with
sanitized text; 501 marks unsupported subsets and 502 an unconfirmed outcome that
must be reconciled, not retried. For an actual Chert 4103 nonretryable 502 with
a validated message ID, `X-Chert-Message-Id` (and `X-Chert-Chat-Id` when Chert
returns one) carry reconciliation identity.

Sources: [Send iMessage](https://docs.contiguity.com/api-reference/product/imessage/send),
[typing](https://docs.contiguity.com/api-reference/product/imessage/typing),
[authentication](https://docs.contiguity.com/api-reference/introduction),
retrieved 2026-10-19. No physical device acceptance has been performed. No Mac
installation change is required.
