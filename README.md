# Chert SDK

Chert HTTP clients for JavaScript/TypeScript, Python, Rust, C++, Go and C#/.NET, plus explicit
iMessage compatibility adapters. This repository is under development: packages
remain private/unpublished and provider coverage is incomplete.

| Package | Boundary |
| --- | --- |
| `@cherthq/imessage` | Authenticated Chert JSON transport and typed queue acceptance |
| `@cherthq/linq-adapter` | Selected `@linqapp/sdk@0.78.0` methods |
| `@cherthq/sendblue-adapter` | Selected `sendblue@3.20.1` methods |
| `@cherthq/blooio-adapter` | Legacy `@blooio/sdk@0.0.2` subset |
| `@cherthq/blooio-v4-adapter` | Pinned current v4 HTTP subset |
| `@cherthq/loopmessage-adapter` | Selected LoopMessage HTTP requests |
| `@cherthq/missblue-adapter` | Pinned MissBlue HTTP text, inventory, recorded retrieval and typing subset |

Every package is iMessage messaging; there is no FaceTime client here yet, so
there is no `@cherthq/facetime` package (see [FaceTime integration](docs/FACETIME.md)).

### Package names by language

All remain private/unpublished (`private: true`, `publish = false`).

| Language | Package / distribution | Import as | Previous name |
| --- | --- | --- | --- |
| JS/TS core | `@cherthq/imessage` (`packages/imessage`) | `@cherthq/imessage` | `@chert/sdk` (`packages/sdk`) |
| JS/TS adapters | `@cherthq/<provider>-adapter` | same | `@chert/<provider>-adapter` |
| Python | `cherthq-imessage` | `chert` | `chert-sdk` |
| Rust | `cherthq-imessage` | `cherthq_imessage` | `chert-sdk` / `chert_sdk` |
| Go | `github.com/cherthq/sdk/go` | package `chert` | `github.com/cherthq/chert-sdk/go` |
| C#/.NET | NuGet ID `Cherthq.IMessage` | namespace `Chert.Sdk` | `Chert.Sdk` |
| C++ | CMake target `cherthq-imessage` / `cherthq::imessage` | `<chert/client.hpp>`, namespace `chert` | `chert-sdk` / `chert::sdk` |

Source-level import names (Python `chert`, C# `Chert.Sdk`, C++ `chert`) and
the C++/Rust fixture executable names are deliberately unchanged.

These are explicit adapters, not aliases for complete provider parity. Existing
provider credentials and IDs do not transfer to Chert. Accepted/queued requests
are separate from sent, delivered and read evidence. Unsupported operations
refuse before a message dispatch; uncertain sends are never automatically retried.
See [compatibility and acceptance](COMPATIBILITY.md).

## Local development

Use Bun to install the workspace and run JavaScript checks:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:distribution
```

`bun run test` selects the self-contained package/core tests. Bare `bun test`
discovers the integration fixtures too and requires their backend prerequisites.
Distribution checks exercise the built packages in Node, Bun and Deno; all three
runtimes must be installed explicitly. Nothing is published by these commands.

Backend HTTP/database/device fixtures are retained separately. Follow
[the integration guide](INTEGRATION.md); an explicit matching Chert platform
checkout is required, and missing prerequisites fail rather than silently proving
integration. Live device scripts are opt-in and require their reviewed plans.

Other language clients have their own native checks and limitations:
[Python](python/README.md), [Rust](rust/README.md), [C++](cpp/README.md),
[Go](go/README.md), [C#/.NET](dotnet/README.md).
They provide typed text queue acceptance, reaction acknowledgement and raw JSON transport;
they do not claim the JavaScript provider adapters' typed resource coverage.

## TypeScript and JavaScript

All SDK and adapter implementation source is TypeScript. Builds emit JavaScript
and TypeScript declarations for Node, Bun and Deno. Plain `.mjs` files are
executable integration fixtures and distribution probes, not a second SDK
implementation. The distribution probe deliberately imports the built JavaScript
to catch packaging errors a TypeScript-only test would miss. See
[source conventions](docs/SOURCE_LAYOUT.md).

## Architecture and evidence

The Mac worker, injected helpers and hosted control plane remain in
`cherthq/chert-facetime`; this repository does not install, restart or deploy them.
Historical controlled-device checks and their limits are summarized in
[device acceptance](docs/DEVICE_ACCEPTANCE.md). Current Photon/Spectrum and other
provider research is recorded in [provider research](docs/PROVIDER_RESEARCH.md).
The separate FaceTime CLI/BYOR contract is described in
[FaceTime integration](docs/FACETIME.md).

Chert code is MIT licensed. Vendor SDKs remain external dependencies with their
own licenses; they are not copied into this repository. No registry publication,
production deployment or fleet installation is implied by a GitHub push.
