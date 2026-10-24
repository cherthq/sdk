# Chert SDKs

Open-source clients for Chert messaging and FaceTime control-plane services.
This repository contains JavaScript/TypeScript, Python, Rust, C#/.NET, C++ and Go
clients. **Language coverage and release status differ:** JavaScript is published;
the other clients are source previews, with unified channel support under review.

## Languages and release status

| Language | Available on `main` | Release / unified-channel work | Documentation |
| --- | --- | --- | --- |
| JavaScript / TypeScript | iMessage, FaceTime control plane, provider adapters, CLI | Published: [`@trychert/sdk@0.1.0`](https://www.npmjs.com/package/@trychert/sdk). Planned successor: `chert-sdk` (not yet published); same binary `chert-sdk` | [Quickstart below](#javascript--typescript) |
| Python 3.10+ | iMessage and FaceTime control plane (`trychert`); legacy `chert` imports retained | Unpublished `chert-sdk` distribution; build from source ([implementation #11](https://github.com/cherthq/sdk/pull/11)) | [Python guide](https://github.com/cherthq/sdk/blob/main/python/README.md) |
| Rust 1.88+ | Async iMessage and FaceTime clients (`trychert_sdk`) | Unpublished `chert-sdk`; source preview only | [Rust guide](rust/README.md) |
| C# / .NET 8 | iMessage and FaceTime HTTP clients (`TryChert`) | Unpublished `chert-sdk` NuGet package; source preview only | [.NET guide](dotnet/README.md) |
| C++20 | iMessage and FaceTime HTTP clients (`trychert`, CMake `trychert::trychert`) | Unpublished `chert-sdk` archives; no C++ registry release | [C++ guide](cpp/README.md) |
| Go 1.23+ | Standard-library iMessage transport (`chert`) | Unified iMessage/FaceTime source preview on `unified-go-sdk`; no tagged release | [Go guide](go/README.md) |

Draft package names describe proposed distributions, not packages available from
PyPI, crates.io, NuGet or a C++ package registry. Follow the language guide to
build/test source; do not substitute a similarly named registry package.

## Channels and credentials

- **iMessage** clients use a Chert API key and optional messaging tenant.
  JavaScript defaults to `https://console.trychert.com` with an optional service
  URL override. A queued receipt does not mean sent, delivered or read.
- **FaceTime control-plane** coverage differs by language. The published JavaScript
  client inspects identity, assigned lines, workers, credentials and connectors;
  it is not an outbound-call API. The C++ and Rust source previews also expose typed call
  creation/actions, events and transcripts against their documented server contracts.
  None is a media runtime. Route availability and permissions depend on the backend.
- Channel credentials are **separate**. The SDK does not prove that an iMessage
  key belongs to a FaceTime project, map tenants to projects, or convert provider
  credentials. In the JavaScript wrapper, `projectId` is sent to FaceTime only;
  it is application context, not an authorization check, for iMessage.
- Keep secrets outside source control. Explicit login/enrollment responses may
  contain credentials; do not log them. Constructors do not contact services.
  Use only authorized recipients and reconcile uncertain outcomes before retrying.

## JavaScript / TypeScript

The examples below target the **planned `chert-sdk` successor**, not an already
available registry release. Until it is published and verified, existing users
should keep `@trychert/sdk@0.1.0`; local validation installs the packed tarball.

```sh
npm install chert-sdk
# Alternatives:
pnpm add chert-sdk
bun add chert-sdk

npx chert-sdk --help
bunx chert-sdk --help
```

ESM and declarations are shipped for Node 22.12+, current Bun and Deno 2 with
npm compatibility. Deno imports use `npm:chert-sdk`. CommonJS `require()` is
not a supported migration target. The npm package and binary are both `chert-sdk`.

```ts
import { ChertSDK } from 'chert-sdk';

const sdk = new ChertSDK({
  projectId: process.env.CHERT_PROJECT_ID!,
  imessage: {
    apiKey: process.env.CHERT_API_KEY!,
  },
  facetime: {
    token: process.env.CHERT_FACETIME_TOKEN!,
  },
});
const lines = await sdk.facetime.listLines(); // Existing assignments; no provisioning.
// Only send with recipient consent:
// await sdk.imessage.sendText({ phone: '+15555550123', body: 'Hello' });
```

The default export remains the iMessage `ChertClient`. Explicit subpaths include
`imessage`, `facetime`, `control-plane`, `adopt`, and each provider adapter:
`linq`, `sendblue`, `blooio`, `blooio-v4`, `loopmessage`, `missblue`,
`texting-blue`, `contiguity`, `bluereacher`, `jared` (append `-adapter`).

```ts
import ChertClient from 'chert-sdk';
import { ChertControlPlane } from 'chert-sdk/facetime';
import Sendblue from 'chert-sdk/sendblue-adapter';
```

Channel commands require `CHERT_PROJECT_ID` as application context and only their
own channel credentials. `context` needs only the project ID; help and `adopt`
need neither project context nor channel credentials. iMessage uses `CHERT_API_KEY`
and optional `CHERT_TENANT`, defaulting to `https://console.trychert.com`.
`CHERT_BASE_URL` optionally overrides it: root origins get `/api/v1`, while
explicit deployment prefixes (including `/api/v1`) are preserved without duplication.
FaceTime uses `CHERT_FACETIME_TOKEN` and defaults to
`https://facetime.trychert.com`. `CHERT_FACETIME_URL` is an optional origin-only
override; `/api/v1` is composed once by the client.

Defaults apply only when a URL option is omitted/undefined. Explicit empty or
null values are invalid, not a request to fall back to production. No host
fallback or retries are added.

**Unpublished source preview:** verify feature availability for your project
before production use. Default-origin reaction support is not yet verified.
No endpoint fallback or automatic retries are performed; a queued receipt is
not proof of delivery. Package publication remains a separate approval step.

Billing uses a signed-in user session and project UUID, not a CLI/project key.
Use `billingStatus()` to inspect entitlement and availability. The successor
removes the obsolete catalog and checkout-row APIs; see the
[billing migration guide](https://github.com/cherthq/sdk/blob/main/packages/control-plane/BACKEND_COVERAGE.md#preview-migration).

```sh
bunx chert-sdk context
bunx chert-sdk facetime status
bunx chert-sdk facetime lines
bunx chert-sdk facetime workers
bunx chert-sdk adopt ./my-app          # Dry-run migration report
bunx chert-sdk adopt ./my-app --write  # Applies supported rewrites
```

`adopt --install` additionally uses the target project's package manager.
Replace legacy `@cherthq/sdk` imports with `chert-sdk` and
`@cherthq/<adapter>` with `chert-sdk/<adapter>`. Bare legacy package names do
not resolve from this archive. Provider call shapes and refusal boundaries are
preserved. `chert-adopt` becomes `chert-sdk adopt`.

### Migrating from `@trychert/sdk@0.1.0`

The published scoped package remains available and is not unpublished or
deprecated by this change. Existing installs and imports keep working without
migration. Registry deprecation is deferred until the successor is published and
verified; publication is a separate release step.

Once the successor is available, replace the dependency with `chert-sdk`, update
root imports from `@trychert/sdk` to `chert-sdk`, and preserve subpath suffixes
(for example `@trychert/sdk/facetime` becomes `chert-sdk/facetime`). Regenerate
your consumer lockfile and rerun tests. The default export, named exports,
provider contracts and `chert-sdk` CLI are unchanged by this rename. The new
archive does not provide an alias for old imports. `adopt` migrates supported
provider usage; it does not automatically rename existing scoped SDK imports.

Published 0.1.0 does not include `login`, `onboard`, `new`, `doctor` or `dev`.
The preview CLI/onboarding work remains in [draft #5](https://github.com/cherthq/sdk/pull/5)
and its integration branch in [draft #6](https://github.com/cherthq/sdk/pull/6).
Those drafts are not installed by the current npm release.

## Source-preview quickstarts

These examples describe the APIs in this source tree, after following the linked
language guide's local build setup. They are not registry installation commands;
other draft PRs may propose different unified APIs.

**Python** — with `python/` on the module path:

```python
import os
from trychert import Chert, IMessageConfig, FaceTimeConfig

sdk = Chert(
    imessage=IMessageConfig(api_key=os.environ['CHERT_API_KEY']),
    facetime=FaceTimeConfig(token=os.environ['CHERT_FACETIME_TOKEN'],
                           project_id=os.environ['CHERT_PROJECT_ID']),
)
# identity = sdk.facetime.whoami()  # Explicit read-only request.
# Either channel can be omitted. Legacy `from chert import ChertClient` still works.
```

Python defaults to `https://console.trychert.com` for iMessage and
`https://facetime.trychert.com` for FaceTime; explicit `base_url` overrides remain
available for tests/self-hosting. **Unpublished source preview:** default origins
and offline tests do not establish live service compatibility. Strict text,
default-origin reactions, and billing availability require separate verification.
No host fallback or automatic retries are performed; publication remains separate.

**Rust** — use Rust 1.88+ and a Tokio runtime with the local `rust/` crate:

```toml
[dependencies]
chert-sdk = { path = "../sdk/rust" }
```

```rust
use trychert_sdk::{ChertSdk, IMessageConfig, FaceTimeConfig};

let sdk = ChertSdk::new(
    Some(IMessageConfig::new("messaging-key")),
    Some(FaceTimeConfig::new("facetime-key", "project-id")),
)?;
```

The distribution is `chert-sdk`; the library import stays `trychert_sdk` for
preview source compatibility. `ChertClient` remains messaging-only; `ChertSdk` accepts independent
`IMessageConfig` and `FaceTimeConfig` values for either or both channels.
FaceTime includes typed calls, events, transcripts, lines, assistants and settings.
Messaging tenant and FaceTime project credentials remain separate; no shared
server binding is inferred. See the [Rust guide](rust/README.md) for the unified
example and API limits. `publish = false` remains enforced: this is not a
crates.io installation command, and call snapshots do not prove connection.

URLs default to `https://console.trychert.com` and `https://facetime.trychert.com`,
with `/api/v1` once. Explicit `base_url` overrides support tests/self-hosting;
empty or invalid values reject. **Rust publication hold:** production feature
availability, including default-origin reactions, requires separate verification.
This is an untagged source preview, not a published package. There are no typed
billing wrappers; generic billing transport is not a release promise.

**C# / .NET** — reference `dotnet/Chert.Sdk/Chert.Sdk.csproj` locally:

```csharp
using TryChert;

using var client = new ChertClient(
    iMessage: new IMessageOptions { ApiKey = "replace-with-your-key" },
    faceTime: new FaceTimeOptions {
        Token = "replace-with-your-token",
        ProjectId = "22000000-0000-4000-8000-000000000002" // Replace with your project UUID.
    });
// Either channel may be omitted. Construction makes no requests.
```

NuGet package `chert-sdk` retains the `TryChert` assembly and namespace. It
provides typed iMessage text/reactions and FaceTime calls, events, transcripts,
inventory, login, connectors and billing status/actions. Billing requires a
signed-in user token and project UUID; messaging and FaceTime credentials remain
independent. This is an HTTP client, not a media runtime or server implementation.

Defaults are `https://console.trychert.com/api/v1` and
`https://facetime.trychert.com/api/v1`; explicit validated overrides preserve
custom prefixes. **Unpublished source preview:** default origins and offline
tests do not establish live feature availability, including reactions and billing.
No fallback or automatic retries are performed. Run
`bash dotnet/verify-package.sh /tmp/chert-sdk-review` for the exact-package and
empty-cache consumer gate. See the [.NET guide](dotnet/README.md) for API limits
and breaking preview migration. Publication requires separate approval.

**C++20** — build/install from `cpp/`, then use
`find_package(trychert 0.1 CONFIG REQUIRED)` and link `trychert::trychert`:

```cpp
#include <trychert/client.hpp>

trychert::Client sdk({
    {.api_key = imessage_key, .tenant = imessage_tenant},
    {.api_key = facetime_key, .project_id = facetime_project_uuid}
});
// auto lines = sdk.facetime.list_lines(); // Explicit read-only request.
```

Omitted URLs default to `https://console.trychert.com` (iMessage) and
`https://facetime.trychert.com` (FaceTime), using `/api/v1` exactly once.
Explicit validated overrides remain available for self-hosting and tests.
**C++ publication hold:** production feature availability, including default-origin
reactions, requires separate verification. This is an untagged source
preview, not a published package. Generic billing transport is not a release promise.

The channels use separate Bearer credentials: iMessage has an optional tenant,
while FaceTime requires a project UUID. There is no automatic server-side binding.
Legacy `<chert/client.hpp>` remains an iMessage-only alias; rebuild existing
binaries. See the [C++ guide](cpp/README.md) for dependencies, install commands,
typed coverage and tests. Other administration APIs remain JSON-based; native
media and live-device acceptance are not covered.

**Go** — import the source module `github.com/cherthq/sdk/go`:

```go
client, err := chert.NewClient(chert.Config{
    BaseURL: "https://messaging.example.test",
    APIKey: "replace-with-your-key",
})
// Check err before using client; construction makes no request.
```

## Repository layout and contributing

`packages/` contains TypeScript clients, adapters, migration tooling and the
unified CLI. `python/`, `rust/`, `dotnet/`, `cpp/` and `go/` contain language
clients and their tests. `tests/` and `scripts/` contain distribution and
local HTTP contract fixtures; `docs/` records API and verification boundaries.

```sh
# JavaScript release gates (Node, Bun and Deno must be installed):
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:distribution
bun run test:package
```

Run each native language's checks from its guide. Python packaging requires the
declared setuptools build backend in an isolated environment, not an arbitrary
system setuptools. CI runs all language suites; packed-artifact checks cover
clean consumers rather than relying only on workspace imports.

Contributions should preserve channel contracts, credential isolation, failure
semantics and legacy compatibility. Keep implementation, tests, packaging and
documentation changes reviewable. Include reproduction steps and tests for
observable behavior; never commit secrets. See the
[integration guide](INTEGRATION.md) for local contract checks. Real messages,
calls, purchases and other external effects require explicit authorization and
are not part of the SDK test suite.

## Compatibility and limits

[COMPATIBILITY.md](COMPATIBILITY.md) defines the supported provider subsets.
Adapters are not full vendor replacements; unsupported operations reject before
dispatch. Provider IDs and credentials do not transfer to Chert. Sends are not
automatically retried. Local tests do not establish live-device delivery or
cross-service project authorization.

Assigned lines can be inspected; shared/dedicated availability and allocation
remain backend/admin managed. No automatic line allocation, plan entitlement,
concierge service, checkout automation, native media connector or delivery
guarantee is included in the published SDK. Billing client methods require a
separately enabled backend. Repository source, package publication and backend
deployment are independent release steps.

MIT licensed. Third-party dependencies retain their own licenses.
