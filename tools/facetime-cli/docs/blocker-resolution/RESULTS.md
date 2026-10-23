# Deployment blocker resolution — 2026-09-30 UTC

Status: **software and source-provenance blockers resolved locally; external
connector hook qualification and historical external cleanup proof still required.** No production SQL,
deployment, enrollment, activation, live session, Mac restart, commit or push
was performed during this follow-up. The previously created Railway project
remains the intended empty relay project.

## Resolved

**Dependencies.** The separate candidate at
`/Users/garygao/chert-facetime-cli/.local/blocker-resolution/candidate` pins Next.js
and eslint-config-next 16.3.7, sharp 0.35.5 and Vitest 4.1.11. The lockfile also
updates js-yaml to its patched compatible version. The complete npm audit now
reports zero advisories, including development dependencies. The earlier report's
critical/high findings remain preserved as historical evidence. These changes
do not update the running deployment.

The patch versions address the maintainer's
[Windows Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
[AVIF Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
and [sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).
Windows-specific exploitability was not assumed for Vercel. Patching removes
the vulnerable package versions without depending on that applicability argument.

**Serving source provenance.** Authenticated Vercel deployment-file listing
returned the uploaded source tree for `dpl_CaaB7JWXnBi7w6dYzZPz4METHBks`.
Every one of its **282 `src/control-plane/` files** has a content SHA-1 matching
Git revision `cbb22ee854e26219aea92d67fa401433cdb4d84c`. This resolves the concern
that the CLI upload contained different control-plane source bytes from its
declared revision. See [comparison](source-upload-comparison.json) and
[summary](provenance-summary.json). Vercel documents the
[uploaded source tree API](https://github.com/vercel/sdk/blob/main/docs/sdks/deployments/README.md#listdeploymentfiles).
This verifies source contents, not reproducible compiled output or secret values.
The runtime remains the configured Vercel Node 24.x runtime.

**Installed Mac mapping.** The latest completed passive audit at
2026-09-29 12:00:14 UTC reports `approved_package_matches` and binds installed
binary `1ee0d259cfb71fca55a8c11c3bcd8eeb2c2ecc3824bfb409473195d1882affae`
to source `647b9f66ce39a5e37634b50f28f0a11dc7583558` through manifest
`f42173e77fcb64732fa87a8dcc07e4c64b6ce8debde213c16eb40c97aa1bbb7f`.
The binary matches the preparation's heartbeat evidence. The audit overall is
`warn`, including checkout drift and recent failures; its release check passes.
That source commit is unavailable from the inspected Git remote, so this is a
reported installed-package mapping, not a local review of its source or a fresh
physical/media acceptance. Physical acceptance remains a later activation gate.

## Cleanup ordering defect and correction

Session `53945278-4dcf-4a4d-817a-73702d67799d` belongs to call
`01256872-9ba3-44c7-b320-a2f686f6f558`. It failed with
`byor_answer_accessibility_failed`; it never reached Session `active`.
The worker recorded `cleanup_complete` at 16:12:35 UTC on September 28.
It reached the database at 16:13:33.505, **273 ms before** the `failed` event,
whose occurrence timestamp is the same. The deployed trigger accepts cleanup
only for already-terminal Sessions, so it ignored this cleanup and then changed
the Session to failed. `cleaned_at=null` therefore does not prove missing worker
cleanup. [Read-only evidence](pilot-evidence.json) preserves the event ordering.

Three deterministic regressions reproduced this problem for failed, ended and
rejected Sessions. The local correction preserves early cleanup evidence without
freeing an active Session. Once a terminal event is processed, it uses only an
existing same-call/same-project worker cleanup event whose occurrence time is
at least the terminal event and dispatch time. Stale cleanup and a non-worker
cleanup event do not qualify. Eight regression cases cover both event orders
and these exclusions. The normal terminal-then-cleanup path is preserved.

The new [guarded payload](migration.payload.sql) includes the existing compatible
connector migration plus this fifth shared-function replacement. It checks the
deployed function preimage `8b3183b1613bcf9159011ba7c85194f9` as well as the four
previous guards. It makes **no historical data repair**. All five preimages and
the 40-entry ledger were rechecked read-only; see [preflight](current-preflight.json).
Atomic rehearsal verified successful application and complete rollback on a
forced late failure, with zero enrollments/deliveries and repeat/drift rejection.

The historical row remains failed and unchanged. Worker cleanup is evidenced,
but external customer-room/provider cleanup cannot be inferred from it. Before
release, obtain room/job absence or owner-confirmed cleanup from its actual
LiveKit project. Do not delete or mark the row cleaned to pass a checklist.
Any eventual historical repair requires its own reviewed, narrowly guarded data
change after that evidence; it is not included in this payload.

## Qualification follow-up

The [next-step qualification](../hook-qualification/RESULTS.md) found that the
selected talking-head agent is incompatible with the current connector protocol.
A local dispatch guard and eight regressions are prepared; all 101 agent tests
pass on both supported Node versions. A dedicated connector entrypoint and
same-host hook implementation are required before activation. No agent deployment
was performed.

## Current target after the user's webhook update

At 2026-09-30 03:12:51 UTC, authenticated database inspection confirmed that
**Chert FaceTime Test** now uses
`https://talking-head-webhook-production.up.railway.app/webhooks/talking-head`.
Integration generation is **11**, active revision
`f6613a73-98ef-4450-8a8e-b8a5979d201e`; line assignment generation remains **3**.
The integration is enabled, payload version 1, signing disabled. The line remains
available with no current call. See [saved routing observation](talking-head-pilot.json).

Both `GET /healthz` and `GET /readyz` returned HTTP 200 over normally verified TLS,
without redirects or allocation. Bodies were `{"ok":true}` and
`{"ready":true,"signing_configured":true}` respectively. See
[health observation](talking-head-health.json). These establish current receiver
liveness/readiness, not end-to-end webhook delivery or FaceTime/media acceptance.
No webhook POST, dispatch, room creation or call was made. Python's default CA
configuration initially failed certificate validation; curl's normal TLS validation
succeeded. No verification bypass was used.

The target mismatch is resolved. The talking-head repository is available at
`/Users/garygao/demo-agent-0`; it identifies the Railway receiver and independent
LiveKit Cloud agent `CA_aWAg6UGjgzeG` / `demo-agent-0` in project
`chert-byor-staging-wi1rapq6`. That agent was observed Running during the preceding
investigation. Its repository documents the ordinary webhook receiver separately
from the independently hosted agent. Its public readiness endpoint is not the
CLI's authenticated, same-host, exact-session loopback hook. The connector-test
worktree's isolated probe does not establish that hook on the deployed agent.
That integration/host qualification still needs to be completed before connector
activation. The existing webhook receiver's documented 600-second call limit
must not be substituted for the CLI's 60-second ceiling.

The earlier Session remains pinned to the interview-agent integration revision
that created it; changing the future-call URL does not migrate its room or cleanup
ownership. Its `cleaned_at` is still null. Worker cleanup is evidenced as described
above; external room/job absence still requires the previous agent's LiveKit
project or an owner-confirmed cleanup receipt. New talking-head credentials cannot
prove absence in the previous project's namespace.

Remaining work is now specific: qualify a compatible connector host and
authenticated loopback hook for the selected talking-head agent, and obtain the
previous interview agent's external cleanup evidence. No need to ask again which
FaceTime project or future webhook target the user intends.

## Review artifacts and validation

Use [artifacts.json](artifacts.json), [candidate.patch](candidate.patch),
[24-file allowlist](candidate-files.json) and [migration.payload.sql](migration.payload.sql).
The earlier candidate and all earlier evidence remain intact. The CLI tarball and
relay source are unchanged; only the control-plane archive changes.

Next.js production builds passed on Node 22.23.2 and 24.14.0 using synthetic
configuration. Do not upload those `.next` directories. The final catalog suite passed **103 tests on each Node version**, comprising
the 95 existing compatibility tests and eight cleanup-ordering cases.
Five known historical/optional cases remain excluded as documented in the original
report. The final full audit reports **zero advisories**; lint, typecheck and migration
validation passed. Per-runtime logs live beside this report. Synthetic results do not prove FaceTime/audio/video
or customer-agent readiness. The previous 248-test CLI results remain applicable
because the CLI is unchanged.

Initial follow-up failures are retained: missing relay node_modules in the fresh
candidate was resolved with its lockfile installation; the event fixture was
corrected to use the actual enum and timestamp payload convention. npm 10's
dependency resolver failed while updating Vitest; npm 12.1.0 completed the scoped
update. None of these initial failed runs is reported as a pass.

After external evidence is available, the next backend deployment authorization
permits only this reviewed migration, new shared secret provisioning, control-plane
and singleton relay deployment, and coordinated release fences. Fresh full-schema,
ledger and active-work checks remain execution preconditions. Enrollment,
activation and supervised audio testing remain separate, with manual access-token
enrollment and the existing four/five/60-second budgets unchanged.

[Preservation verification](preservation-final.json) confirms all 1,340 original
files are unchanged except the intentionally updated runbook, whose original
text is retained verbatim. All 22 historical local state/evidence files, including
both cleanup debts, are unchanged. No original Chert checkout file was edited.
