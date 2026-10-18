# @chert/missblue-adapter

Explicit, limited Miss Blue HTTP fetch replacement backed by Chert. This is not
an official Miss Blue JavaScript SDK, full drop-in replacement or live-device
acceptance claim. It never contacts Miss Blue, invents an Apple GUID, or adds
telemetry/dependencies beyond the existing Chert client.

**Source-line limitation:** sending resolves `number_id` through owned Chert
inventory, validates its exact UUID/phone/iMessage/send capability, then sends
with explicit `from`. That lookup and mutation are not an atomic UUID-line guard:
a concurrent reassignment of the **same phone** can change line identity. Do not
use this adapter when strict frozen UUID-line identity is required. No retry,
lookup fallback or sender substitution is performed.

```ts
import {createMissBlueFetch} from '@chert/missblue-adapter';
const missBlueFetch = createMissBlueFetch({chert: {
  baseURL: 'https://messaging.example.com', apiKey: process.env.CHERT_API_KEY!,
}});
const response = await missBlueFetch('https://api.missblue.dev/v1/messages', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({number_id: ownedLineUUID, recipient: '+442079460123', text: 'Hello'}),
});
```

The Chert credential authenticates every actual backend call. A caller's optional
Miss Blue bearer header is not forwarded or independently authenticated by this
replacement. Tenant/project ownership remains Chert's authenticated authority.
There is no network fallback to the provider.

| Method | Supported subset / actual Chert boundary |
| --- | --- |
| `POST /v1/messages` | Exactly `{number_id,recipient,text}`; assigned UUID line, phone-only DM, lossless nonblank UTF-8 <=16KiB/no NUL. Inventory GET then explicit-from POST `/chats`, exact HTTP202 canonical queue receipt and matching plaintext/peer/chat required. Returns HTTP201 `{id,chat_id,status:'pending',queued:true}`. |
| `GET /v1/messages/{id}` | Actual unchanged lowercase32hex Chert public message ID only. Recorded outbound plaintext and frozen line/peer facts; pending/sent/delivered/read projected only from compatible facts. No native identifier exposure. |
| `GET /v1/numbers` | Complete owned iMessage inventory `{total,data:[{id,handle,service,disabled}]}`. Invalid/non-UUID/ambiguous rows refuse the whole response. No inferred availability, project ID, label, simulation, sharing or creation clock. |
| `POST /v1/typing` | Exactly `{chat_id,active:boolean}`, where chat_id is an owned public Chert chat UUID previously returned by Chert. Calls actual nested typing route once; requires exact chat/state/applied receipt, then empty204. No native chat alias guessing. |

The response schemas in the pinned official OpenAPI are generic objects; the
examples are not required-field definitions. IDs remain actual Chert public IDs:
they are not reformatted into synthetic UUIDs. `request_id`, `agent_id`, Apple
`external_message_id`, short links and URLs are absent because Chert cannot
establish those provider facts. Stored `created_at`/`updated_at` are copied only
when supplied and valid. `message_at` is omitted because outbox creation is not
the original Messages.app clock. A queue receipt is acceptance, never sent,
delivery, read, native service proof or a promise of Miss Blue's offline retry
policy. Service is omitted on an unknown-service recorded pending row.

All other routes/options/headers/queries refuse closed, including media,
caption/replies, email/groups, pagination/listing/thread sync, mutations/reactions,
mark-read, callbacks/webhooks, schedules, sandbox emulation, number administration,
`manual`, `allow_duplicate`, and bounded `/typing-indicators` timers. No Miss Blue
duplicate-text suppression, quota pacing, cancellation or automatic resend is
implemented. Merely omitting `allow_duplicate` does not create such a fence.

Errors retain `{error:{code,message}}`, with sanitized messages. On actual Chert
HTTP502/code4103 responses, a valid public message ID and chat UUID pair are
preserved in `X-Chert-Message-Id` / `X-Chert-Chat-Id` response headers for Chert
record/operator reconciliation. These are explicitly Chert extensions, not
invented MissBlue request IDs or delivery proof. Invalid/missing IDs and lost
Chert HTTP replies provide no such headers. The adapter never guesses IDs.
 Unknown mutation
outcomes use documented HTTP504 `command_unconfirmed`: they may have happened and
must be reconciled, **never automatically retried**. Transport aborts propagate;
after mutation dispatch an abort cannot prove no effect. Unsupported calls make
zero Chert requests. Wrong/malformed2xx ACKs never become successful provider
receipts. Known401/404 are preserved without exposing private backend bodies.

## Primary contract pin and verification

Official reference: [messages](https://missblue.dev/docs/messages),
[conversations](https://missblue.dev/docs/conversations-api),
[numbers](https://missblue.dev/docs/numbers),
[delivery](https://missblue.dev/docs/delivery),
[errors](https://missblue.dev/docs/errors),
[OpenAPI](https://missblue.dev/openapi.json).
OpenAPI1.0.0 retrieved `2026-10-18T16:08:25.767398+00:00` (October19 Melbourne),
SHA256 `63ba790ecdfb3e4155ed5af735a41e25f43a3f8d1852b9e53c8791a848df6105`.
`contract/official.json` freezes selected official operations and error schema,
including unsupported delivery-related options for review. No marketing claims
are used as API evidence.

From the SDK workspace: `bun test packages/missblue-adapter/index.test.ts`.
Tests use the actual ChertClient, including actual loopback HTTP for send and
typing, with synthetic backend receipts. They prove bounded construction/auth/
validation/uncertainty behavior, not actual cloud PostgreSQL route execution,
Miss Blue account operation, deployment or physical iMessage/typing. Workspace checks add packaging/build/distribution verification.
`tests/missblue-http.test.ts` separately passes 21 cases through actual Chert auth,
HTTP routes, reservation and HMAC signing, using explicitly fake query storage
and native peers. The separate six-provider strict text gate now passes real authentication and
disposable PostgreSQL/PostgREST, including normal and exact Unicode/whitespace
MissBlue sends and six refusal cases with no native dispatch or reserved row.
Two additional MissBlue native lost-reply/wrong-ACK cases each make one native
request, retain the same actual public ID in headers/ledger/permanent claim,
record an unconfirmed outcome, and refuse a restart of the spent attempt.
Its native peer remains synthetic. The after-inventory inactive-line refusal does
not close the documented same-phone UUID-reassignment limitation. Physical-device
acceptance remains pending. No device actions are performed by these checks.
