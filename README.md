# Chert SDK

The JavaScript/TypeScript distribution is **one private, unpublished ESM package,
`@cherthq/sdk`**. Install an approved local archive with `bun add ./cherthq-sdk-0.1.0.tgz`.
No npm publication or live onboarding readiness is implied.

```ts
import ChertClient, { ChertControlPlane } from '@cherthq/sdk';
import Sendblue from '@cherthq/sdk/sendblue-adapter';
import { startOnboarding } from '@cherthq/sdk/onboarding/client';
```

The root exports the iMessage client and FaceTime control-plane client. Explicit
subpaths are `imessage`, `control-plane`, `facetime` (CLI programmatic `run`),
`adopt` (migration `main`), `onboarding/client` (protected local helper),
`onboarding` (server), and every `<provider>-adapter` listed below. Both `chert`
and `chert-adopt` executables are included. The onboarding **server requires Bun**
(SQLite); it is not imported by the root. Node 22.12+ is required for CLI/helpers.
The messaging client and adapters are distribution-tested under Node, Bun and Deno.

Existing `@cherthq/<name>` workspace packages remain for source compatibility;
the archive needs none of them. Replace those imports with `@cherthq/sdk/<name>`
without changing call shapes or credentials. Bare legacy package names cannot
resolve from the single archive. `chert-adopt --write` now writes unified subpath
imports and one `@cherthq/sdk` dependency; legacy imports remain recognized.
Provider coverage and unsupported-operation boundaries are unchanged.

To prepare (never publish) an archive: `bun install --frozen-lockfile`, then
`bun run build`, `bun run test`, `bun run typecheck`, `bun run test:distribution`,
and `bun run test:package`. The last gate installs a packed archive outside the
workspace, checks exports/types and CLIs, and reruns the distribution behavior
under Node/Bun/Deno. After those pass, `bun pm pack --ignore-scripts` creates the
archive. `private: true` intentionally prevents npm publication; a future private
registry release needs explicit authorization to remove that guard, with
`publishConfig.access: restricted` retained.

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
| `@cherthq/texting-blue-adapter` | Texting Blue explicit-sender text send subset |
| `@cherthq/contiguity-adapter` | Contiguity iMessage text send and typing subset |
| `@cherthq/bluereacher-adapter` | Blue Reacher instant 1:1 text send subset |
| `@cherthq/jared-adapter` | Open-source Jared local `POST /message` text subset |
| `@cherthq/adopt` | `chert-adopt` migration report and drop-in import rewrites; see [its README](packages/adopt/README.md) |

`@cherthq/control-plane` adds typed control-plane operations. `@cherthq/facetime`
adds an original development CLI and concierge helper, not a bundled media worker.
See [setup.md](setup.md) and the [worker/API handoff](docs/ONBOARDING_WORKER_HANDOFF.md).
These packages remain private/unpublished; hosted onboarding and media adapters require staging verification.

### Package names by language

All remain private/unpublished (`private: true`, `publish = false`).

| Language | Package / distribution | Import as | Previous name |
| --- | --- | --- | --- |
| JS/TS unified | `@cherthq/sdk` | root or explicit subpaths above | `@cherthq/imessage`, `@cherthq/<provider>-adapter` |
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
