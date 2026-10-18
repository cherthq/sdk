# Chert core SDK

Private, unpublished generic JSON transport. Requests use explicit Chert
credentials and an explicit HTTPS or loopback HTTP destination, with no
provider fallback or automatic retries. The transport and `sendText` contracts
remain documented in the workspace README.

## Standard reaction dispatch

```ts
import {ChertClient} from '@chert/sdk';
const client=new ChertClient({baseURL:'https://your-chert.example',apiKey:'your-key'});
// Explicit effect: only use an owned chat/message and an authorized target.
const receipt=await client.sendReaction(
  '11aa0000-0000-4000-8000-000000000001', 'Exact:message-id',
  {reaction:'like',remove:false}, {idempotencyKey:'one-reviewed-reaction'},
);
// Frozen ReadonlyReactionReceipt: operation_id, chat_id, message_id, status.
```

`sendReaction(chatId,messageId,{reaction,remove?},{signal?,idempotencyKey?})`
sends one POST to `/chats/{chatId}/messages/{messageId}/reactions`, with exactly
`{reaction,remove,part_index:0}`. It does not look up the message implicitly.
Supported reactions are `love`, `like`, `dislike`, `laugh`, `emphasize`, and
`question`; `remove` is a real boolean and defaults to false. Custom emoji and
nonzero parts are outside this subset.

The chat ID must be a dashed UUID and is canonicalized to lowercase. Message
IDs are case-preserved ASCII `[A-Za-z0-9:_.-]` of 1–160 characters, excluding
`.` and `..`, and encoded as one URL segment. An optional `Idempotency-Key`
header must contain 1–200 printable ASCII bytes with no leading/trailing space;
internal spaces are preserved. This header subset is narrower than `sendText`'s
UTF-8 JSON key. No key or message ID is trimmed or normalized.

Only actual HTTP 202 with exactly `operation_id`, `chat_id`, `message_id`, and
`status:"acknowledged"` produces a runtime-frozen receipt. The operation ID must
be lowercase 32-hex and both returned identities must match the request.
Malformed success receipts or unconfirmed transport outcomes raise sanitized
`ChertAPIError(502,"unconfirmed_reaction_outcome",...)`. Explicit server errors
retain their machine-readable codes; raw response data is available only through
`error.data`. A caller's abort signal propagates without retries. No arbitrary
per-request headers or destinations are exposed.

Acknowledgement is dispatch acceptance, not applied/current reaction state,
recipient receipt, a timestamp, or an OS-level SMS-fallback guarantee. An
unknown outcome never authorizes a fresh origin or automatic resend. These
local tests do not establish live use of this core method or deployment;
compatible cloud/native installation and separately reviewed physical evidence
remain necessary.
