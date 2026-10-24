# Provider compatibility sources

The [compatibility matrix](../COMPATIBILITY.md) lists implemented adapter subsets.
Each adapter guide identifies its pinned provider contract and unsupported
operations. A provider's marketing claims or similar method names do not prove
compatible request and response semantics.

Primary references include [Linq](https://docs.linqapp.com/),
[Sendblue](https://docs.sendblue.com/), [Blooio](https://docs.blooio.com/),
[LoopMessage](https://loopmessage.com/apidocs/send-message/),
[Miss Blue](https://missblue.dev/docs), [Texting Blue](https://docs.texting.blue/),
[Contiguity](https://docs.contiguity.com/),
[Blue Reacher](https://bluereacher.com/docs), and
[Jared](https://github.com/ZekeSnider/Jared/blob/master/Documentation/restapi.md).

No adapter is provided for BlueBubbles, Photon/Spectrum or other providers not
listed in the matrix. Native message records, completed-send receipts, automatic
fallback, scheduling and provider-specific identities cannot be inferred from
Chert queue acceptance. Missing required facts must remain unsupported, not be
filled with invented values.
