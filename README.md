# @trychert/sdk

One ESM package for Chert iMessage, FaceTime control-plane access, CRM/provider
adapters and migration tooling. The executable is `chert-sdk`; this release does
not create a second npm package named `chert-sdk`.

## Install and run

```sh
npm install @trychert/sdk
pnpm add @trychert/sdk
bun add @trychert/sdk

npx @trychert/sdk --help
bunx @trychert/sdk --help
npx @trychert/sdk imessage --help
bunx @trychert/sdk facetime --help
```

Use Node 22.12+, current Bun, or Deno 2 with npm compatibility. JavaScript and
TypeScript declarations are shipped. This is ESM only; CommonJS `require()` is
not a supported migration target. Deno imports use `npm:@trychert/sdk`.

## Minimal quickstart

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

// Inspect existing FaceTime lines; this does not provision a line or place a call.
const lines = await sdk.facetime.listLines();
// Only send to a consenting recipient. Queued is not delivered.
const receipt = await sdk.imessage.sendText({
  phone: '+15555550123', body: 'Hello from Chert',
});
```

The SDK groups two existing transports. **It does not unify server authentication
or verify that an iMessage API key belongs to the FaceTime project.** `projectId`
is sent to the FaceTime control plane; it is application context only for
iMessage. Supply credentials assigned by your administrator to the intended
project. Never treat the wrapper's project label as an authorization check.
Provider credentials cannot be substituted for Chert credentials. No credential
is embedded, logged, or automatically converted; keep secrets in your environment.

Direct imports retain existing call shapes:

```ts
import ChertClient from '@trychert/sdk'; // existing iMessage default
import { ChertControlPlane } from '@trychert/sdk/facetime';
import Sendblue from '@trychert/sdk/sendblue-adapter';
```

## CLI channels

Set `CHERT_PROJECT_ID` as application context. iMessage additionally requires
`CHERT_BASE_URL`, `CHERT_API_KEY`, and optionally `CHERT_TENANT`. FaceTime requires
`CHERT_FACETIME_URL` and `CHERT_FACETIME_TOKEN`. Each command requires only its
own channel's credentials. Explicit URLs must point to your existing services;
there is no implicit production endpoint or fallback provider.

```sh
bunx @trychert/sdk context
bunx @trychert/sdk facetime status
bunx @trychert/sdk facetime lines
bunx @trychert/sdk facetime workers
bunx @trychert/sdk imessage send --phone +15555550123 --body 'Hello'
bunx @trychert/sdk adopt ./my-app
bunx @trychert/sdk adopt ./my-app --write
```

`adopt` is a dry run unless `--write` is supplied. `--install` additionally uses
the target project's package manager. Migration preserves unsupported usages
and reports them instead of pretending full provider parity. The former
`chert-adopt` invocation becomes `chert-sdk adopt`.

## Supported surfaces and limitations

- iMessage queue acceptance, typed resources and provider-specific CRM subsets
  are unchanged. See [COMPATIBILITY.md](COMPATIBILITY.md) for precise coverage.
- FaceTime exposes existing control-plane identity, lines, workers, connector
  and credential methods. Backend permissions and availability still apply.
  `status` checks identity only; it does not prove media readiness.
- Existing assigned lines can be inspected. Shared-line availability and
  assignment are backend/admin managed. This package does not automatically
  allocate shared or dedicated lines and does not promise a free or paid plan.
- No concierge onboarding, browser/passkey enrollment, checkout automation,
  media connector, FaceTime call/media API, or delivery guarantee is included.
  Raw control-plane billing methods require a separately enabled backend.
- Unsupported adapter methods fail before dispatch. Sends are not automatically
  retried; reconcile uncertain outcomes before retrying.
- Local tests use controlled fixtures, not proof of live calls, devices,
  provider delivery, billing, or cross-service project authorization.

Exports: root, `imessage`, `facetime`, `control-plane`, `adopt`, and
`linq-adapter`, `sendblue-adapter`, `blooio-adapter`, `blooio-v4-adapter`,
`loopmessage-adapter`, `missblue-adapter`, `texting-blue-adapter`,
`contiguity-adapter`, `bluereacher-adapter`, `jared-adapter`.

## Migration and local verification

Replace `@cherthq/sdk` with `@trychert/sdk`, and legacy `@cherthq/<adapter>`
imports with `@trychert/sdk/<adapter>`. Bare legacy package names do not resolve
from this archive. The default iMessage client, named error classes and provider
call shapes are retained. The private preview's onboarding exports are omitted;
`facetime` now exposes the real control-plane client rather than the preview
setup/concierge runner. Old setup commands are not a supported public API.
Other language packages remain separate and are not published by this release.

From the source repository:

```sh
bun install --frozen-lockfile
bun run build
bun scripts/test-unit.ts
bun x --no-install tsc --noEmit
bun scripts/test-package.ts
```

The package check installs a tarball outside the workspace, checks all exports,
Node/Bun/Deno behavior, CLI help and strict TypeScript declarations.
Source and integration documentation: https://github.com/cherthq/sdk
MIT licensed; upstream SDK dependencies retain their own licenses.
