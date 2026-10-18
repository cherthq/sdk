# FaceTime integration

## FaceTime CLI comparison — 2026-10-19

Reviewed `cherthq/chert-facetime-cli` main at
`7988bc3cb4e80d1436406ade158580ea63453119`, package
`@trychert/facetime@0.1.0-beta.6`. It is the customer-side Node BYOR connector,
with device login and scoped user tokens, durable connector recovery, deadlines
and application callbacks. It is separate from this Mac serving binary and the
messaging provider adapters. Its current control/auth route names align with
this control plane, but that source comparison is not an end-to-end runtime test.

Preserve its callback/recovery contract when adding FaceTime to the shared SDK;
reuse the device-login protocol rather than inventing another credential model.
Its owner/admin connector APIs require scoped user authorization; a panel API
key cannot silently substitute. The Node WebSocket connector still needs its
relay origin: hosting the dashboard on Workers does not implement that relay.
The CLI cannot be embedded unchanged into the native executable or Worker.

No source was imported. The private repository has no declared license, so it
has not been added as a new third-party dependency. Its README's beta.5 receipt
is historical while the current manifest is beta.6; current physical acceptance
must be tested separately. Next integration gate is isolated actual-auth route
compatibility for device login and connector ownership/activation/recovery,
without production enrollment, agent startup or routing changes.
