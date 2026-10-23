> Follow-up: hosted backend implementation and validation are reported separately in [BACKEND_INTEGRATION_RESULTS.md](BACKEND_INTEGRATION_RESULTS.md). The original CLI evidence below remains historical; production deployment and live qualification have not occurred.

# Private npm CLI implementation results

## Expiry follow-up — terminal completion remains durable

**242/242 tests now pass on Node 22.23.2 and 24.14.0.** This bounded follow-up
changes only connector completion handling and adds 16 deterministic regressions.
No live sessions or backend expansion occurred. Both historical unresolved debts
and all pre-existing evidence remain intact.

Expiry previously marked every expired entry for cleanup and reconciliation,
even after an authoritative terminal result and verified resource absence were
durable. Failed reconciliation could then leave the connector blocked indefinitely.
`Connector.tick` and `reconcile` now skip terminal entries only when creation,
cleanup and reconciliation obligations are all settled. No journal fields,
migrations, ownership/deadline rules or debt-clearing shortcuts were introduced.

The first full Node 22 run also exposed a related race: an authority read begun
before lifecycle cleanup could return afterward and requeue cleanup from its old
snapshot. Reconciliation now checks the **current** durable entry again after
awaiting and validating the authority response. The response still must match
owner and resource expiry before that check. Already-completed work is preserved.

Evidence and controls:

- [Initial red tests](CLI_EXPIRY_RED.txt): 13 failures reproduced reopened debt;
  two unfinished-work controls already passed.
- [Controlled reconciliation-race failure](CLI_EXPIRY_RECONCILIATION_RED.txt):
  a held read returned after verified terminal cleanup and reopened debt.
- [Final focused suite](CLI_EXPIRY_GREEN.txt): all 16 pass. Coverage includes
  wall/monotonic expiry during thrown, unknown, forbidden and not-found reads;
  byte-identical file-journal reopen; authoritative decline completion; and the
  in-flight reconciliation race. Completed entries perform no new authority or
  management reads and retain admission eligibility with fresh health.
- Active accepted calls, lost-receipt uncertainty, locally observed departure,
  unsettled creation and unverified cleanup still reconcile and retain debt.
  Resource absence or a terminal flag alone cannot mark those calls complete.
  Only their existing settlement/verified-cleanup paths resolve the obligations.

| Final runtime | Tests | Typecheck / lint / build | 20-call synthetic proof | Installed tarball lifecycle |
| --- | --- | --- | --- | --- |
| Node 22.23.2 / npm 10.9.8 | 242/242 | Pass | 20 commits/deletions, zero resources/debt | Pass |
| Node 24.14.0 / npm 10.8.2 | 242/242 | Pass | 20 commits/deletions, zero resources/debt | Pass |

Full evidence: [Node 22](CLI_EXPIRY_NODE22.txt), [Node 24](CLI_EXPIRY_NODE24.txt).
Each ran `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`npm run proof:transport -- --host 127.0.0.1 --json` on the exact supported runtime.
The initial matrix logs are retained as [Node 22 initial](CLI_EXPIRY_NODE22_INITIAL.txt)
and [Node 24 initial](CLI_EXPIRY_NODE24_INITIAL.txt), before the race fix.

A fresh private tarball containing this correction is retained at
`.local/cli-expiry-review/chert-local-transport-proof-0.0.0.tgz`; see its
[25-file allowlist manifest](CLI_EXPIRY_PACKAGE_MANIFEST.json). The earlier tarball
and validation evidence below are preserved as historical artifacts, not replaced.
The full suite installs a freshly packed artifact into a clean consumer on each
runtime and exercises its fixture-backed lifecycle without development dependencies.

The [follow-up audit](CLI_EXPIRY_AUDIT.json) verifies all **85 pre-existing
local/evidence files** against the [new baseline](CLI_EXPIRY_BASELINE.json), including
both historical debt journals and the previous package. Whitespace checks cover
the edited source, new untracked regression file and updated brief/results;
`git diff --check` also passes. Existing production-backend, hook/hosting, media
and historical-debt limitations are unchanged. Stop for review before any live
session or backend integration.

## Original CLI implementation report (preserved)

Implemented the September 29 npm CLI slice in this repository. **226/226 tests
pass on Node 22.23.2 and 24.14.0**, including installation and execution from a
packed artifact. No real service session, agent launch, enrollment, routing change,
publication, commit or push occurred. Stop here for review.

## What ships

The provisional private package remains `chert-local-transport-proof@0.0.0`.
Its `chert` executable is compiled JavaScript with a startup gate for the two exact
tested Node versions. The [guide](../CLI_GUIDE.md) documents install, all options,
JSON output, exit codes, hook topology and a companion npm script.

| Command | Actual behavior |
| --- | --- |
| `--help`, `--version` | Work without config or credentials; unsupported runtime fails first |
| `init` | Six interactive target prompts or explicit noninteractive flags; strict versioned schema; exclusive 0600 file creation; only credential environment references; no enrollment, activation or allocation |
| `check` | Separate runtime/config, credential presence, state permissions/lock, pending work and HMAC-authenticated local health; no management allocations; authorization remains unverified; exits 3 for these partial diagnostics |
| `status` | Read-only safe config and atomic local snapshots, pending counts, timestamps/age and explicit `live: false`; does not acquire a writer lock |
| `run` | Requires explicit loopback-v1 development config; otherwise `backend_not_implemented` before effects. Wires actual Connector, FileJournal, LiveKitAdapter/SDK, AuthenticatedHook, durable adapter receipts, health sampling, reconciliation and extracted WebSocket client |

The reusable client moved to `src/transport`; the old fixture import re-exports
it for existing regressions. Fake authority, relay and management/hook responders
remain under tests and are excluded from the package. The explicit development
management override preserves the configured WSS bridge endpoint and is restricted
to literal loopback HTTP. The standalone CLI also forbids fetch redirects or
unconfigured destinations; there is no synthetic fallback or agent launcher.

Runtime admission requires matching authenticated health, exact welcomed scope,
current generation and an active role, with existing debt/capacity gates intact.
Preparation and final decision deadlines are unchanged. Acceptance is transient
until the authority receipt. Reconciliation errors preserve uncertainty; process
restart never repeats creation. SIGINT/SIGTERM or relay disconnect disables
admission, waits for local operations and cleanup before releasing the writer,
and preserves accepted/possibly accepted resources and their original expiry.
The CLI never calls the worker-wide drain hook. Relay loss exits 6 for a supervisor
to handle using the same config/state; it does not repeatedly reconnect itself.

Unsafe/linked files, foreign journal identity, writer conflicts and orphaned
adapter receipts fail closed. Crash locks are not removed automatically. There
is no generic reset/clear-debt command. Dependency console output is suppressed
inside the standalone executable because SDK parse errors can contain raw response
bodies; only structured allowlisted CLI diagnostics are emitted.

## Failure and regression evidence

The [brief](CLI_IMPLEMENTATION_BRIEF.md) preceded implementation. The initial
[red test](CLI_IMPLEMENTATION_RED.txt) failed because the compiled executable was
missing. It now passes, including from a clean installed package.

A second [deterministic failing regression](CLI_HEALTH_REUSE_RED.txt) exposed a
pre-existing adapter health issue: the valid optional `cancelled_operation` hook
field was forwarded into the strict availability schema, causing otherwise healthy
post-cleanup samples to become unknown. The fix explicitly excludes session,
worker and cancellation-only metadata from the availability projection. Hook
signature, target, challenge, sequence and freshness validation remain intact.
That regression and successful subsequent-call reuse now pass.

The 46 added tests cover CLI config/runtime/usage errors, JSON/exit codes,
noninteractive missing inputs, exclusive init, permissions and links, credential
redaction, unavailable/unknown/stale/bad-signature health, writer contention,
status during a run, foreign/reopened journals, orphaned receipts, abrupt crash
locks, graceful interruption during creation, relay loss, lost commit receipt,
failed recovery, missed terminal reconciliation, malformed/oversized/redirected
recovery responses and SDK raw-body redaction. Existing 180 regressions still pass.

The actual loopback runtime tests hold creation and send two identical requests,
observe one creation and one authoritative synthetic commit, deliver terminal,
verify exact deletion/zero debt, and reuse the connection for another call.
Separate restart tests retain rooms through uncertainty and later clean through
authenticated reconciliation without redispatch. These are fixture service
responses and synthetic authority, not new real LiveKit or decoded-media evidence.

## Validation and installed artifact

| Runtime | npm | Tests | Typecheck / lint / build | Synthetic proof | Clean install lifecycle |
| --- | --- | --- | --- | --- | --- |
| Node 22.23.2 | 10.9.8 | 226/226 | Pass | 20 commits/deletions; 0 resources/debt | Pass |
| Node 24.14.0 | 10.8.2 | 226/226 | Pass | 20 commits/deletions; 0 resources/debt | Pass |

Evidence: [Node 22 tests](CLI_TESTS_NODE22.txt), [Node 22 checks/proof](CLI_VALIDATION_NODE22.txt),
[Node 24 checks/tests/proof](CLI_VALIDATION_NODE24.txt), and [final audit](CLI_IMPLEMENTATION_AUDIT.json).
Commands executed with each exact runtime first on PATH:

```sh
node --version
npm --version
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
```

The package test performs `npm pack --ignore-scripts --json` after the suite's
build, inspects the allowlist, installs that tarball into a fresh temporary
consumer with `npm install --omit=dev --ignore-scripts --no-audit --no-fund
--package-lock=false`, and verifies no source symlink or TypeScript/ESLint/TS
runner dependency. It exercises the installed bin's shebang, help/version, init,
check, status, actual-adapter fixture lifecycle and graceful stop with the consumer
as cwd. The fixture servers live outside the installed package. The test uses an
isolated npm configuration and synthetic credential environment, not developer
credentials. Only npm dependency installation accesses the public registry.

A final ordinary `npm pack --json --pack-destination .local/cli-package-review`
also passed its build/prepack hook. The [manifest](CLI_PACKAGE_MANIFEST.json)
contains **25 files**, 31,475 compressed bytes, 114,767 unpacked bytes: compiled
runtime JavaScript plus package metadata, README and CLI_GUIDE. No tests, maps,
TypeScript source, journals, credentials, historical evidence or repository-only
imports are included. The retained private artifact is
`.local/cli-package-review/chert-local-transport-proof-0.0.0.tgz`.
SHA-256: `0a7453e5a6669ebc38a2418f13b28945ebc743191a55fb2357b79c49eb9fb0b6`.

A separate PTY exercise completed all six interactive init prompts on Node 24,
returned exit 0, created a 0600 unconfigured file and created no runtime state or
network request. Its temporary directory was removed. `git diff --check` passed,
and the audit explicitly scanned untracked implementation/test/doc files for
trailing whitespace because most of this repository's implementation is untracked.

## Preservation and limits

Baseline: dirty `main`, HEAD `54db70ba5f18d2cc8d36053352186af6c1287847`.
Existing README edits and the untracked proof/adapter tree were preserved while
extending the implementation. No existing source tree was reset or staged.
All **76 historical local/evidence files** recorded in the
[baseline](CLI_IMPLEMENTATION_BASELINE.json) retain their exact hashes. Neither
historical September 25 debt was erased, reclassified or subjected to recovery.
No other repository was modified or agent/task started. The latest real-service
result remains the [September 29 correlation review](ADAPTER_TEST_RESULTS.md).

Support is deliberately narrow: exact Node patch versions, tested on macOS;
owner-only local POSIX storage and one writer; same-host literal-loopback HMAC
hook with explicit expected boot/project/name/deployment. Windows, distributed
locks/shared disks, remote/cloud hooks, automatic deployment and multi-replica
operation are not qualified. Crash lock recovery still needs explicit operator
review. Normal admission remains blocked by unresolved work in the configured
journal; changing paths/identity is not an approved way to bypass it.

The CLI checks do not verify LiveKit master-key access. They authenticate the
supported hook and report credential presence separately. Production backend
readiness cannot be established by the development welcome or a local health
sample. Real demo profiles, decoded audio, conversation, FaceTime, Muse and hosted
operation remain unqualified. No new live tests were run in this task.

## Missing backend contracts and next slice

Before a customer pilot, separately review and implement:

1. Browser/device login, tenant project discovery, line assignment and connector
   enrollment; scoped credential issuance, rotation, revocation and recovery scope.
2. Server-owned binding activation using expected epoch/CAS, standby/drain/handoff
   rules and one active new-call owner. Installation and health must not activate it.
3. Production TLS relay authentication, generation fencing, bounded delivery and
   absolute deadline propagation, with the existing authoritative commit transaction
   and sealed bridge-credential custody. This package invents no production URL.
4. Durable lifecycle replay/cursors/acknowledgments and exact-owner reconciliation,
   including revoked-instance recovery and definitive terminal outcomes.
5. Reviewed customer-agent hook integration and deployment supervision: persistent
   state, secret injection, graceful shutdown, independent resource expiry and an
   explicit historical-debt recovery process. Keep npm-first packaging; no Docker
   prerequisite or provider warming is introduced.

Review this CLI and its development contract first. Production enrollment/relay
integration, additional live adapter tests and any media/FaceTime qualification
require the next explicitly authorized slice.
