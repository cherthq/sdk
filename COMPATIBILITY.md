# SDK compatibility

Adapters implement restricted subsets, not full provider replacements. Use Chert
credentials and resource IDs; provider credentials and IDs are not portable.
Unsupported operations reject rather than silently changing their meaning.

| Adapter | Supported subset | Guide |
| --- | --- | --- |
| Linq 0.78 | Existing-chat text/single uploaded attachment, typing, mark-read acknowledgement, conditional history, attachment registration/retrieval, standard reactions, local signature verification | [Linq](packages/linq-adapter/README.md) |
| Sendblue 3.20 | Explicit-sender text, typing, recorded status/history, one HTTPS image; separate HTTP reaction subset | [Sendblue](packages/sendblue-adapter/README.md) |
| Blooio SDK 0.0.2 | Recipient-only text, recorded status/retrieval, active identity flag | [Legacy Blooio](packages/blooio-adapter/README.md) |
| Blooio HTTP v4 | Direct/existing-chat text, one image in an existing chat, recorded history, assigned line/contact lookup, existing qualified webhook management | [Blooio v4](packages/blooio-v4-adapter/README.md) |
| LoopMessage | Explicit iMessage plaintext and recorded status | [LoopMessage](packages/loopmessage-adapter/README.md) |
| Miss Blue | Plaintext, owned number inventory, recorded outbound retrieval, typing | [Miss Blue](packages/missblue-adapter/README.md) |
| Texting Blue | Explicit-sender plaintext | [Texting Blue](packages/texting-blue-adapter/README.md) |
| Contiguity | Plaintext and explicit-sender typing | [Contiguity](packages/contiguity-adapter/README.md) |
| Blue Reacher | Instant one-to-one plaintext with an explicit assigned line | [Blue Reacher](packages/bluereacher-adapter/README.md) |
| Jared | Plaintext to a phone through the configured loopback-shaped API | [Jared](packages/jared-adapter/README.md) |

## Interpretation of results

- Queue acceptance is not evidence of sending, delivery, reading or media playback.
- Recorded status is projected only from compatible returned facts. Missing
  required metadata produces an error, not invented timestamps or identities.
- A control acknowledgement does not establish what a recipient saw.
- Requests are not automatically retried or redirected to a provider. Reconcile
  uncertain mutation outcomes before manually retrying. Where returned, validated
  Chert message/chat IDs can help reconciliation; a lost response may provide none.
- Idempotency is available only where the adapter guide explicitly documents it.
  Reuse the same key only for the same logical operation.
- Media support is bounded by each adapter's format, size and ownership checks.
  A returned URL does not promise indefinite availability. Captions, groups,
  scheduling, SMS/RCS and provider administration are not generally supported.
- Number lookup followed by a send does not guarantee an atomic line-identity
  binding during concurrent reassignment; see the Miss Blue and Blue Reacher guides.

The generic iMessage client and FaceTime HTTP client are separate from provider
adapters. Credentials remain independent by channel. HTTP clients do not provide
a media runtime or provision service access. See each package guide for methods,
permissions and currently available service features.

## Verification boundary

Local tests exercise SDK behavior with synthetic responses and loopback HTTP.
They do not establish deployed API availability, provider account compatibility,
physical device behavior or end-to-end delivery. Package publication and service
availability are separate from source support. See [local checks](INTEGRATION.md).
