# @cherthq/adopt

Private, unpublished migration helper. `chert-adopt` finds iMessage provider
usage in a project and classifies each usage against the Chert adapters'
documented subset ([COMPATIBILITY.md](../../COMPATIBILITY.md)). It is a static
analysis aid, not a parity claim: dynamic calls are invisible to it, and every
adapter still rejects unsupported operations before sending.

The public entry point is `chert-sdk adopt`. New rewrites install `chert-sdk`
and import `chert-sdk/<adapter>`; the `@cherthq/*` names below are private
workspace names. This successor package is not yet published: validate with a
local tarball until release. Existing `@trychert/sdk@0.1.0` dependencies and
imports are left intact; see the [migration guide](../../README.md#migrating-from-trychertsdk010).

```sh
chert-adopt [path] [--from auto|<provider-id>] [--write] [--install] [--json] [--allow-dirty]
```

Provider IDs: `blooio`, `blooio-v4`, `linq`, `sendblue`, `loopmessage`,
`missblue`, `texting-blue`, `contiguity`, `bluereacher`, `jared`. Dry run is
the default and changes nothing. Example (`fixtures/missblue-ts`):

```
Provider       drop_in  native  unsupported  detected
MissBlue HTTP  2        0       1            1

detected     index.ts:1  env MISSBLUE_API_KEY
drop_in      index.ts:3  http POST https://api.missblue.dev/v1/messages
drop_in      index.ts:6  http GET https://api.missblue.dev/v1/numbers
unsupported  index.ts:7  http GET https://api.missblue.dev/v1/conversations
             Not mapped by @cherthq/missblue-adapter; the adapter rejects it with HTTP 501 before any Chert request.
```

## What it detects

JavaScript/TypeScript files are parsed with the TypeScript compiler API:
provider SDK imports and `require()`s, clients constructed from them (including
class properties), method calls on those clients, raw HTTP calls to provider API
hosts (string, template and same-file `const` URLs; `fetch`, `Request` and
`x.get/post/...` methods), provider env var names, and webhook routes and
payload field access. `package.json` dependencies are read too. Providers that
document no env var names (Texting Blue, Contiguity, Blue Reacher, Jared) are
found by API base URL, and hardcoded `tb_live_`/`brk_live_`/`brk_test_` keys
are flagged by prefix only.

Python and other languages are detection-only: dependency names, provider API
URLs and env var names. Nothing outside JS/TS is rewritten.

Providers researched without an adapter (Photon/Spectrum, BlueBubbles and
imessage-rs, MessageBlue, Inkbox, Claw Messenger, SendiMessage, Tuco AI,
TextLink, Beeper Desktop API) are reported as unsupported for drop-in, with the
reason from `docs/PROVIDER_RESEARCH.md`.

## Classes

- `drop_in`: the adapter accepts the same call shape. SDK clients still need a
  `chert: {baseURL, apiKey}` constructor option; raw HTTP calls must be routed
  through the adapter's fetch factory (for example `createBlooioV4Fetch`).
- `native`: rewrite to the suggested `@cherthq/imessage` call or adapter helper.
- `unsupported`: blocking. The adapter rejects it; the report gives `file:line`
  and the reason.

## `--write`

- Refuses unless the target's git working tree is clean (`--allow-dirty`
  overrides; a non-git directory also requires it).
- Rewrites an import/require specifier only when every usage through it is
  `drop_in`. Imports with native or unsupported usages, subpath imports and
  CommonJS `require()` imports of ESM-only adapters are left alone and reported.
- Updates `package.json`: adds the adapter, and removes the vendor package only
  when no direct imports of it remain. Fetch-style adapters are added when a
  drop-in raw HTTP call exists.
- Appends `CHERT_BASE_URL`, `CHERT_API_KEY` (and `CHERT_WEBHOOK_SECRET` when
  webhooks are found) to `.env.example`-style files, creating `.env.example` if
  none exists. Names only.
- Writes `ADOPTION_REPORT.md`: summary, findings, blockers, webhook mapping
  guidance and manual steps.
- Is idempotent: a rerun on the result changes nothing.
- `--install` additionally runs the project's own package manager, chosen by
  lockfile (`bun`, `pnpm`, `yarn` or `npm`). Without it no installer runs.

## Safety

No network calls, credentials or telemetry. Files that may contain secret values
(`.env`, `.env.local`, `.env.production`, ...) are never opened; from
`.env.example`-style files only variable names are read. Reported URLs drop
query strings, call arguments are never printed, and key literals are shown
as their prefix only.

## Adding a provider

Providers are data: add one entry to `src/providers.ts` (packages, hosts,
routes, methods, env prefixes, webhook guidance, adapter package) aligned with
COMPATIBILITY.md, plus a fixture under `fixtures/` and its test case.

```sh
bun test packages/adopt
```
