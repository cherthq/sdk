# @cherthq/jared-adapter

Private Fetch-compatible replacement for the open-source
[Jared](https://github.com/ZekeSnider/Jared) bot's local REST `POST /message`,
backed by Chert. Use it to move code that posted to a self-hosted Jared Mac onto
Chert without changing request bodies. It never contacts Jared or Messages.app,
retries, or adds telemetry/dependencies.

```ts
import {createJaredFetch} from '@cherthq/jared-adapter';
const jaredFetch = createJaredFetch({origin: 'http://localhost:3005', chert: {
  baseURL: 'https://messaging.example.com', apiKey: process.env.CHERT_API_KEY!,
}});
await jaredFetch('http://localhost:3005/message', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({body: {message: 'Hello'}, recipient: {handle: '+14155551234'}}),
});
```

`origin` is required and must be loopback `http://host:port` — Jared's
documentation says port 3005, while the reviewed source defaults to 3000, so the
adapter does not guess.

| Operation | Status |
| --- | --- |
| `POST /message` text to a phone | Supported subset: exactly `{body:{message},recipient:{handle}}` with an E.164 phone `handle` and lossless nonblank text ≤16 KiB, no NUL. Calls Chert recipient-only `POST /send` via `ChertClient.sendText` once (owned line policy, existing Apple DM). Confirmed receipt (202 `queued` or 200 `sent`/`duplicate`) → empty HTTP 200, matching upstream "parsed and handed to the sender". |
| Email handles, group GUID handles (`iMessage;+;chat…`) | Unsupported (501). |
| `attachments` (local file paths) | Unsupported (501). |
| Extra `recipient` fields (`givenName`, …) | Unsupported (501). |
| Webhooks, routes/plugins, bot commands | Unsupported: not part of the REST surface. |

Upstream returns plain-text 400 for undecodable bodies; this adapter does the same
for invalid JSON/text and adds plain-text 501 (unsupported) and 502 (unconfirmed;
reconcile, do not retry). For an actual Chert 4103 nonretryable 502 with
validated IDs, `X-Chert-Message-Id` / `X-Chert-Chat-Id` headers carry
reconciliation identity. Chert sends from an owned line, not the Jared Mac's
signed-in Apple ID.

Source: Jared commit `969f145` (2023-01-02) [JaredWebServer.swift](https://github.com/ZekeSnider/Jared/blob/969f145321deacfc41401fb7728053f240dad465/Jared/JaredWebServer.swift)
and [REST API doc](https://github.com/ZekeSnider/Jared/blob/969f145321deacfc41401fb7728053f240dad465/Documentation/restapi.md),
retrieved 2026-10-19. Upstream appears unmaintained. No physical device
acceptance has been performed. No Mac installation change is required.
