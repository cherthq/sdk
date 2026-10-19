# @cherthq/bluereacher-adapter

Private Fetch-compatible replacement for Blue Reacher's instant 1:1 text send,
backed by Chert. It is not a Blue Reacher SDK or full replacement. It never
contacts Blue Reacher, forwards the `brk_…` bearer key, retries, or adds
telemetry/dependencies.

```ts
import {createBlueReacherFetch} from '@cherthq/bluereacher-adapter';
const blueReacherFetch = createBlueReacherFetch({chert: {
  baseURL: 'https://messaging.example.com', apiKey: process.env.CHERT_API_KEY!,
}});
await blueReacherFetch('https://api.bluereacher.com/v1/messages', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({to: '+16465550119', message: 'Hello', send_mode: 'instant', device_id: ownedChertLineUUID}),
});
```

| Operation | Status |
| --- | --- |
| `POST /v1/messages` (instant, 1:1, text) | Partial: exactly `{to,message,send_mode:'instant',device_id}` where `device_id` is an owned Chert line UUID. Reads Chert `/phone-numbers` (line must be unique, iMessage, active, `send`), then explicit-sender `POST /chats` once. Exact HTTP 202 queued receipt → HTTP 200 `{success:true,message_id,mode:'instant',status:'dispatched',device_id}`. |
| `send_mode:'drip'` (the provider default), `delay_minutes`, send windows | Unsupported: Chert has no scheduled/paced send. |
| `device_id:'auto_load_balanced'/'auto_round_robin'` or omitted | Unsupported: the response must name the actual line. |
| `media_urls`, `message_effect`, `lock`, `metadata`, groups | Unsupported. |
| `Idempotency-Key` header | Unsupported (rejected rather than ignored). |
| `/v1/status/{id}`, `/v1/conversations` | Unsupported: `device_name`, `scheduled_for` and per-message `delivery_channel` are not Chert facts. |
| `/v1/typing` | Unsupported: auto-expiring window and `expires_at` / `keepalive_interval_ms` cannot be represented by Chert start/stop typing. |
| `/v1/reactions`, `/v1/read`, `/v1/voice-memos`, `/v1/capability`, contacts, devices, webhooks | Unsupported. |

Field gaps: `message_id` is the actual 32-hex Chert public ID (not `i_…`).
`status:'dispatched'` reports Chert queue acceptance, not a native send. Blue
Reacher falls back to RCS then SMS; Chert never does. The device-to-phone lookup
and send are not an atomic line-identity guard under concurrent reassignment.

Blue Reacher does not publish an error envelope; this adapter emits
`{success:false,error,message}` using documented codes where they apply
(`invalid_json`, `invalid_phone`, `message_required`, `invalid_api_key`,
`device_not_owned`, `no_online_device`, `rate_limited`) plus adapter codes
`unsupported_feature` (501), `incompatible_response` and `outcome_unknown` (502).
For an actual Chert 4103 nonretryable 502 with validated IDs,
`X-Chert-Message-Id` / `X-Chert-Chat-Id` headers carry reconciliation identity.

Sources: [send a message](https://bluereacher.com/docs/api-reference/send-message),
[status](https://bluereacher.com/docs/api-reference/messages),
[rich messaging](https://bluereacher.com/docs/api-reference/rich-messaging),
retrieved 2026-10-19. No physical device acceptance has been performed. No Mac
installation change is required.
