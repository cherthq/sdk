# Chert SDKs

Open-source clients for Chert messaging and FaceTime control-plane services.
This repository contains JavaScript/TypeScript, Python, Rust, C#/.NET, C++ and Go
clients. **Language coverage and release status differ:** JavaScript is published;
the other clients are source previews, with unified channel support under review.

## Languages and release status

| Language | Available on `main` | Release / unified-channel work | Documentation |
| --- | --- | --- | --- |
| JavaScript / TypeScript | iMessage, FaceTime control plane, provider adapters, CLI | npm [`@trychert/sdk@0.1.0`](https://www.npmjs.com/package/@trychert/sdk); binary `chert-sdk` | [Quickstart below](#javascript--typescript) |
| Python 3.10+ | iMessage transport (`chert`) | Unpublished; `trychert-sdk` / `trychert` unified client in [draft #11](https://github.com/cherthq/sdk/pull/11) | [Python guide](https://github.com/cherthq/sdk/blob/main/python/README.md) |
| Rust | Async iMessage transport (`cherthq_imessage`) | Unpublished; unified `trychert-sdk` in [draft #8](https://github.com/cherthq/sdk/pull/8) | [Rust guide](https://github.com/cherthq/sdk/blob/main/rust/README.md) |
| C# / .NET 8 | iMessage transport (`Chert.Sdk`) | Unpublished; unified `TryChert` preview in [draft #9](https://github.com/cherthq/sdk/pull/9) | [.NET guide](https://github.com/cherthq/sdk/blob/main/dotnet/README.md) |
| C++20 | iMessage transport (`chert`, CMake `cherthq::imessage`) | Unpublished; unified `trychert` preview in [draft #7](https://github.com/cherthq/sdk/pull/7) | [C++ guide](https://github.com/cherthq/sdk/blob/main/cpp/README.md) |
| Go 1.23+ | Standard-library iMessage transport (`chert`) | Unified iMessage/FaceTime source preview on `unified-go-sdk`; no tagged release | [Go guide](go/README.md) |

Draft package names describe proposed distributions, not packages available from
PyPI, crates.io, NuGet or a C++ package registry. Follow the language guide to
build/test source; do not substitute a similarly named registry package.

## Channels and credentials

- **iMessage** clients use an explicit service URL, Chert API key and optional
  messaging tenant. A queued receipt does not mean sent, delivered or read.
- **FaceTime control-plane** clients inspect identity, assigned lines, workers,
  credentials and connectors. These HTTP APIs are not a media runtime or an
  outbound-call API. Route availability and permissions depend on the backend.
- Channel credentials are **separate**. The SDK does not prove that an iMessage
  key belongs to a FaceTime project, map tenants to projects, or convert provider
  credentials. In the JavaScript wrapper, `projectId` is sent to FaceTime only;
  it is application context, not an authorization check, for iMessage.
- Keep secrets outside source control. Explicit login/enrollment responses may
  contain credentials; do not log them. Constructors do not contact services.
  Use only authorized recipients and reconcile uncertain outcomes before retrying.

## JavaScript / TypeScript

```sh
npm install @trychert/sdk
# Alternatives:
pnpm add @trychert/sdk
bun add @trychert/sdk

npx @trychert/sdk --help
bunx @trychert/sdk --help
```

ESM and declarations are shipped for Node 22.12+, current Bun and Deno 2 with
npm compatibility. Deno imports use `npm:@trychert/sdk`. CommonJS `require()` is
not a supported migration target. `chert-sdk` is the binary, not a second npm
package.

```ts
import { ChertSDK } from '@trychert/sdk';

const sdk = new ChertSDK({
  projectId: process.env.CHERT_PROJECT_ID!,
  imessage: {
    baseURL: process.env.CHERT_BASE_URL!,
    apiKey: process.env.CHERT_API_KEY!,
  },
  facetime: {
    baseUrl: process.env.CHERT_FACETIME_URL!,
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
import ChertClient from '@trychert/sdk';
import { ChertControlPlane } from '@trychert/sdk/facetime';
import Sendblue from '@trychert/sdk/sendblue-adapter';
```

Channel commands require `CHERT_PROJECT_ID` as application context and only their
own channel credentials. `context` needs only the project ID; help and `adopt`
need neither project context nor channel credentials. iMessage uses `CHERT_BASE_URL`, `CHERT_API_KEY` and
optional `CHERT_TENANT`; FaceTime uses `CHERT_FACETIME_URL` and
`CHERT_FACETIME_TOKEN`.

```sh
bunx @trychert/sdk context
bunx @trychert/sdk facetime status
bunx @trychert/sdk facetime lines
bunx @trychert/sdk facetime workers
bunx @trychert/sdk adopt ./my-app          # Dry-run migration report
bunx @trychert/sdk adopt ./my-app --write  # Applies supported rewrites
```

`adopt --install` additionally uses the target project's package manager.
Replace legacy `@cherthq/sdk` imports with `@trychert/sdk` and
`@cherthq/<adapter>` with `@trychert/sdk/<adapter>`. Bare legacy package names do
not resolve from this archive. Provider call shapes and refusal boundaries are
preserved. `chert-adopt` becomes `chert-sdk adopt`.

Published 0.1.0 does not include `login`, `onboard`, `new`, `doctor` or `dev`.
The preview CLI/onboarding work remains in [draft #5](https://github.com/cherthq/sdk/pull/5)
and its integration branch in [draft #6](https://github.com/cherthq/sdk/pull/6).
Those drafts are not installed by the current npm release.

## Source-preview quickstarts

These examples describe the **current `main` APIs**, after following the linked
language guide's local build setup. They are not registry installation commands
and do not describe the different unified APIs proposed in the draft PRs.

**Python** — with `python/` on the module path:

```python
import os
from chert import ChertClient

client = ChertClient(os.environ['CHERT_BASE_URL'], os.environ['CHERT_API_KEY'])
# identity = client.request('/whoami')  # Explicit read-only request.
```

**Rust** — in a consumer configured for the local `rust/` crate:

```rust
use cherthq_imessage::ChertClient;
use std::time::Duration;

let client = ChertClient::new(
    "https://messaging.example.test", "replace-with-your-key", None,
    Duration::from_secs(20), 1024 * 1024,
)?;
```

**C# / .NET** — reference `dotnet/Chert.Sdk/Chert.Sdk.csproj` locally:

```csharp
using Chert.Sdk;

using var client = new ChertClient(
    "https://messaging.example.test", "replace-with-your-key");
```

**C++** — link the local CMake target `cherthq::imessage`:

```cpp
#include <chert/client.hpp>

chert::Client client("https://messaging.example.test", "replace-with-your-key");
```

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
opt-in integration fixtures; `docs/` records API and acceptance boundaries.

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
[integration guide](https://github.com/cherthq/sdk/blob/main/INTEGRATION.md) before
running backend or device tests: they require explicit prerequisites and consent
for any real messages, calls or other external effects.

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
