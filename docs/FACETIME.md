# FaceTime integration

## CLI source and release boundary

The customer-side Node CLI is maintained in [`tools/facetime-cli`](../tools/facetime-cli/README.md)
and distributed independently as `@trychert/facetime`. It remains a standalone
npm project with its own lockfile, build, tests and package release; it is not an
SDK library in the `packages/*` workspace. The CLI package is MIT-licensed under
this repository's license. This source consolidation does not publish a new npm
version, archive the former CLI repository or change the Mac worker/control-plane
deployment boundary.

## Historical CLI comparison — 2026-10-19

Reviewed `cherthq/chert-facetime-cli` main at
`7988bc3cb4e80d1436406ade158580ea63453119`, package
`@trychert/facetime@0.1.0-beta.6`. It is the customer-side Node BYOR connector,
with device login and scoped user tokens, durable connector recovery, deadlines
and application callbacks. It is separate from this Mac serving binary and the
messaging provider adapters. Its current control/auth route names align with
this control plane, but that source comparison is not an end-to-end runtime test.

The source now lives in this repository at `tools/facetime-cli`; preserve its
callback/recovery contract and reuse the device-login protocol rather than
inventing another credential model. The historical comparison below describes
the review state at the time, not a current release or end-to-end runtime test.
Its owner/admin connector APIs require scoped user authorization; a panel API
key cannot silently substitute. The Node WebSocket connector still needs its
relay origin: hosting the dashboard on Workers does not implement that relay.
The CLI cannot be embedded unchanged into the native executable or Worker.

At the time of this review, no source had been imported because the separate CLI
repository did not declare a license. The CLI is now included here under MIT.
The beta.5 receipt was already historical at that review while its manifest was
beta.6; physical acceptance must still be evaluated against the exact release.
The integration gate remains isolated actual-auth route compatibility for device
login and connector ownership/activation/recovery, without production enrollment,
agent startup or routing changes.
