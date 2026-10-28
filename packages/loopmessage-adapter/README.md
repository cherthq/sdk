# @cherthq/loopmessage-adapter

Private ESM Fetch-compatible adapter for a narrow LoopMessage Conversation HTTP
contract, verified against official documentation on 2026-10-18. This is not an
upstream JavaScript SDK or full provider replacement. No provider dependency,
credential forwarding, automatic retries or telemetry is added.

```ts
import { createLoopMessageFetch } from '@cherthq/loopmessage-adapter';
const transport = createLoopMessageFetch({chert:{baseURL:'https://your-chert.example',apiKey:'your-chert-key'}});
const response = await transport('https://a.loopmessage.com/api/v1/message/send/', {
  method:'POST', headers:{'content-type':'application/json'},
  body:JSON.stringify({contact:'+15550000002',text:'Hello',channel:'imessage'}),
});
```

Only that exact URL/method and three-key body are accepted. Contact must be
canonical E164; text must be nonempty, lossless UTF8, no NUL, at most 16 KiB and fewer than 10,000 UTF16 code units (a conservative subset of the documented character limit). Input is never truncated.
Explicit `channel:'imessage'` is required. An authorized sender and existing
direct conversation are required. This does not establish that device-level
SMS fallback is disabled.
Do not treat the channel field as an end-to-end no-SMS guarantee before that
prevention mechanism and physical acceptance are established. Provider sender IDs, emails, automatic channel
selection, attachments, markup/options, groups, replies, typing, edits,
webhooks and idempotency headers are unsupported before any Chert request.
Only authorization/content-type/accept input headers are allowed; input vendor
credentials never replace configured Chert credentials.

The sole dispatch is Chert `POST /send` through `ChertClient.sendText`. A confirmed
Chert receipt (202 `queued`, or 200 `sent`/`duplicate`) maps to HTTP 200
`{message_id,contact,text}` using the actual Chert message ID. This is acceptance,
never delivery evidence. The endpoint-specific official
example uses `contact`; a generic example on the same page inconsistently uses
`recipient`. This adapter pins the endpoint-specific shape and does not emit both.

Errors use the documented generic `{success:false,code:100,message}` shape with
sanitized static text; HTTP 501 identifies unsupported subsets. Provider-specific
billing, retry advice and lifecycle error codes are not fabricated. Unknown
outcomes must be reconciled, never automatically resent. For an actual Chert 4103
nonretryable 502 carrying validated public IDs, response headers
`x-chert-message-id` and `x-chert-chat-id` preserve reconciliation identity. These
are Chert-only diagnostics, not vendor fields. Abort signals propagate; malformed
success responses fail 502 after exactly one attempt.

Sources: [sending](https://loopmessage.com/apidocs/send-message/),
[raw Authorization key](https://loopmessage.com/apidocs/credentials/),
[error codes](https://loopmessage.com/apidocs/error-codes).

Node/Bun/Deno distribution checks are synthetic local transport verification,
not evidence of production service availability or physical delivery.

## Recorded status subset

Exact bodyless GET `/api/v1/message/status/{32lowerhex}/` maps one authenticated
Chert `/messages/{id}` read. No query, alternate IDs or custom headers are allowed.
Returned ID must match and direction must be outbound. Output is HTTP 200
`{message_id,status,contact?,text?}` using actual optional canonical phone/flat text.
Queued/pending/sent map to `processing`. Delivery requires explicit delivered=true,
consistent delivered/read status and affirmative service=imessage. Read alone,
unknown service and 4103 uncertainty do not prove delivery; failed/unknown rows map
to `unknown`. Conflicting flat/nested evidence, SMS/RCS and malformed fields fail 502.
No `failed` lifecycle, provider error code or `last_update` is invented. Read errors
use the documented status shape `{error_code:100,message}` (send errors use `code`).
Status reads never POST or retry a send from this adapter.
See [official status documentation](https://loopmessage.com/apidocs/statuses/).
