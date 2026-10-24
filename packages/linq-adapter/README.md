# @trychert/sdk/linq-adapter

Restricted compatibility with `@linqapp/sdk@0.78.0`, retaining the official
resource objects, types and APIError classes. This is not full Linq compatibility.

```ts
import Linq from '@trychert/sdk/linq-adapter';
const client = new Linq({
  chert: { apiKey: process.env.CHERT_API_KEY! },
  maxRetries: 0,
});
await client.chats.messages.send('existing-chert-chat-id', {
  message: { parts: [{ type: 'text', value: 'Hello' }] },
});
```

Use Chert IDs and credentials. The default origin is `https://console.trychert.com`;
`chert.baseURL` is an explicit override. Vendor credentials are not forwarded.
Retries, custom headers, streaming and unsupported query/body overrides are
rejected. Cancellation propagates. Obtain consent before real communications.

## Supported methods

| Method | Contract and limits |
| --- | --- |
| `chats.messages.send` | One nonempty unmodified text part, or one uploaded Chert attachment ID in an existing direct chat. No captions, URL parts, multiple parts or new-chat sends. |
| `chats.typing.start` / `stop` | Acknowledges the requested state; does not promise visible typing or duration. |
| `chats.markAsRead` | Requires matching identity and `applied:true`; not proof of a remote read receipt. |
| `phonenumbers.list` (deprecated) | Assigned `{id,phone_number}` inventory only; modern `phoneNumbers.list` is unsupported. |
| `chats.messages.list` | Recorded metadata with integer limit 1–200 and opaque cursor; missing required metadata rejects the page. |
| `messages.retrieve` | Actual owned ID, chat identity, valid creation/modification times, lifecycle and direction must be available. |
| `attachments.create` | `{filename,content_type,size_bytes}`, supported MIME intersection, positive size up to 100 MiB. Caller uploads raw bytes separately. |
| `attachments.retrieve` | Actual 48-hex Chert ID, filename, MIME, size and creation/upload metadata; no invented delivery evidence. |
| `messages.addReaction` | Six standard tapbacks, add/remove on part zero; `{status:'accepted'}` acknowledges dispatch, not recipient UI state. |

IDs are validated before requests; vendor IDs are not migrated. Unknown or
incompatible response fields cannot substitute for required facts. Text-part
reaction observations and send times are not invented. History is a metadata
subset, not complete provider content parity. Unsupported rich parts reject.

Attachment registration validates returned configured-origin upload/download
URLs before returning credentials in `required_headers`. Uploads use PUT with
an expiring deadline. Treat capability URLs as sensitive. A download can become
unavailable after deletion or authorization changes. Media send receipts require
matching IDs, metadata and URL expiry; a replay can contain an expired original
URL. Current attachment retrieval is separate from replay.

## Idempotency and uncertain outcomes

Existing-chat text and uploaded-attachment sends accept `message.idempotency_key`
or the official `idempotencyKey` request option. Conflicting values reject.
Keys must be lossless, NUL-free, nonempty, at most 255 Unicode codepoints and
1020 UTF-8 bytes. Keyed acceptance/replay returns HTTP 200; unkeyed acceptance
returns HTTP 202. Changed requests conflict. No key-expiration parity is promised.

Queue acceptance is not delivery. Incompatible mutation receipts produce
`502 outcome_unknown`; reconcile before retrying. When validated IDs are
available, `APIError.headers` contains `x-chert-message-id` and
`x-chert-chat-id` as Chert-specific diagnostics. A lost response may provide
neither. Retrieve the actual Chert message ID to reconcile; no automatic retry
or lookup follows an uncertain mutation.

## Webhook verification and exclusions

The inherited `webhooks.unwrap(rawBody,{headers})` verifies Standard Webhooks
headers using an explicit secret/key. Preserve exact raw bytes. Consumers must
deduplicate event IDs. Omitting headers at runtime invokes upstream parse-only
behavior, not authentication; event schema validation is also the caller's job.
This does not enable subscription registration or Chert-to-Linq callback conversion.

Chat creation, groups, services, effects, replies, edits, custom/sticker or
nonzero-part reactions and all unlisted methods are unsupported.
See [official declarations](https://unpkg.com/@linqapp/sdk@0.78.0/resources/chats/messages.d.ts).
Run `bun test packages/linq-adapter` from the workspace. Local synthetic tests
do not establish deployed service availability or physical delivery.
