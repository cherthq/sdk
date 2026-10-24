# chert-sdk/sendblue-adapter

A restricted transport for `sendblue@3.20.1`, retaining official resources,
APIPromise helpers, types and API errors. It is not a complete replacement.

```ts
import Sendblue from 'chert-sdk/sendblue-adapter';
const client = new Sendblue({
  chert: { apiKey: process.env.CHERT_API_KEY! }, maxRetries: 0,
});
await client.messages.send({
  from_number: '+15550000001', number: '+15550000002', content: 'Hello',
});
```

The default origin is `https://console.trychert.com`; `chert.baseURL` overrides
it explicitly. Chert credentials and IDs are required. Vendor credentials are
not forwarded. Automatic retries and unsupported request overrides reject;
cancellation propagates. Obtain consent before real communications.

| Method | Supported subset |
| --- | --- |
| `messages.send` | Explicit assigned E.164 sender and recipient, plaintext or one public HTTPS image URL; optional image caption is experimental. |
| `typingIndicators.send` | Explicit sender/recipient, default/start or stop state; acknowledgement is not visible typing or duration proof. |
| `messages.getStatus` / `retrieve` | Owned recorded message; retrieve can include one validated media URL. |
| `messages.list` | Recorded history, supported number/line/direction/status/service/time filters and offset pagination. |
| `unwrapChert` | Explicit authenticated Chert plaintext-event conversion, not Sendblue webhook verification. |
| Separate HTTP reaction transport | Restricted received-message standard reaction subset; not an official SDK reaction method. |

All other APIs and unsupported fields reject before Chert requests. Automatic
sender selection, app cards, effects, replies, groups and provider administration
are outside this subset.

## Results and history

Actual Chert IDs map to `message_handle`. Queue acceptance maps to `QUEUED`,
not sent or delivered. Recorded sent/delivered/read/failed observations map
only where compatible; no READ state exists in the Sendblue response. Missing
timestamps, identities and provider metadata are omitted rather than invented.

History defaults to limit 50, offset 0, creation-time descending. Limit is
1–200 and offset 0–10000. A filter requiring unavailable facts fails rather than
silently omitting records. Pages reflect current inventory, not a frozen snapshot.
Creation time is not send time. Media URLs and captions require compatible
recorded facts; unavailable evidence is not proof of delivery.

## Images and captions

The client asks Chert to import one public HTTPS image; it does not download
the URL itself. Supported images are PNG/JPEG up to 100 MiB with a usable
filename. Import success is not send success. Failed or cancelled import/send
sequences may leave an uploaded attachment. No automatic retry is performed.

Optional `content` with an image remains experimental. Input must be lossless
UTF-8, 1–16,384 bytes and NUL-free. Exact recipient caption whitespace and line
ending fidelity is **not guaranteed**. A returned media URL is not evidence of
recipient decoding or byte-preserved media.

## Errors and webhooks

Malformed mutation success responses are unknown outcomes, not safe-to-retry
failures. Where supplied and validated, Chert message/chat IDs support
reconciliation. Reconcile before retrying; a lost response may contain no IDs.

`unwrapChert(rawBody, headers, {secret})` verifies the expected Chert subscription
signature over exact bytes before parsing, with a ±300-second time window.
It accepts `X-Webhook-Signature` or `x-chert-signature` and requires agreement
when both exist. Select the secret from trusted subscription configuration and
atomically deduplicate returned event IDs. Only qualified inbound single-plaintext
events with an E.164 peer are converted; groups, media and other events reject.
It does not register subscriptions or authenticate Sendblue signatures.

The named export `createSendblueReactionFetch({baseURL,apiKey})` translates
`POST https://api.sendblue.com/api/send-reaction` with `from_number`,
`message_handle` and `reaction`. It supports `love`, `like`, `dislike`, `laugh`,
`emphasize`, `question` and leading-minus removals, with omitted/zero `part_index`.
The target must be an eligible owned received plaintext iMessage; outbound,
ambiguous or incompatible historical targets reject. Acceptance does not prove
applied recipient state. Uncertain operations are not retried.

Run `bun test packages/sendblue-adapter` from the workspace. Tests use synthetic
contracts, not real messages or calls. See the
[official sending contract](https://docs.sendblue.com/getting-started/sending-messages).
