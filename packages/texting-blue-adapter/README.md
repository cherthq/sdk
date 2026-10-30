# @cherthq/texting-blue-adapter

Private Fetch-compatible replacement for the Texting Blue send endpoint, backed
by Chert. It is not the `@textingblue/node` SDK or a full provider replacement.
It never contacts Texting Blue, forwards the `x-api-key` header, retries, or adds
telemetry/dependencies beyond `@cherthq/imessage`.

```ts
import {createTextingBlueFetch} from '@cherthq/texting-blue-adapter';
const textingBlueFetch = createTextingBlueFetch({chert: {
  baseURL: 'https://messaging.example.com', apiKey: process.env.CHERT_API_KEY!,
}});
await textingBlueFetch('https://api.texting.blue/v1/messages/send', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({to: '+14155551234', from: ownedChertLine, content: 'Hello'}),
});
```

| Operation | Status |
| --- | --- |
| `POST /v1/messages/send` | Supported subset: exactly `{to,from,content}`; E.164 `to`/`from` (distinct); lossless nonblank UTF-8, at most 5,000 UTF-16 units and 16 KiB, no NUL. Calls Chert explicit-sender `POST /chats` once. An exact HTTP 202 queued receipt with matching text/peer becomes HTTP 202 `{id,status:'queued',to,from,content,media_url:null,created_at}`. |
| `media_url` | Unsupported (501), including `null`. |
| `GET /v1/messages`, `GET /v1/messages/:id` | Unsupported: Chert records lack the sender phone and `delivered_at` clock that response requires. |
| `/v1/numbers*` | Unsupported: `label`, `verified`, `device_name`, `last_seen_at`, `messages_today` are not Chert facts. |
| `/v1/webhooks*`, webhook signature verification | Unsupported. |

Field gaps: `id` is the actual 32-hex Chert public message ID, not `msg_…`.
`status:"queued"` is Chert queue acceptance, never sent/delivered evidence; there
is no `polling` state. The adapter does not initiate SMS fallback; device-level
fallback prevention is not established.

Errors use the documented `{error:{code,message}}` shape with sanitized text:
`invalid_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
`rate_limited` 429. `unsupported_feature` 501 and `outcome_unknown` 502 are
adapter codes. The documented `internal_error` ("retry the request") is never
emitted, because an uncertain send must be reconciled, not retried. For an
actual Chert 4103 nonretryable 502 with validated IDs, `X-Chert-Message-Id` and
`X-Chert-Chat-Id` headers carry reconciliation identity.

Source: [Texting Blue messages API](https://docs.texting.blue/api/messages),
retrieved 2026-10-19. No physical device acceptance has been performed. No Mac
installation change is required.
