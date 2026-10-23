# Talking-head callback qualification and regenerated candidate

**The callback bridge works with the actual Python session code under isolated
provider transports. The deployed talking-head profile is not qualified for this
audio-only pilot.** Its default path explicitly refuses admission. Acceptance tests
use an explicitly synthetic audio capability policy; they do not establish that
the deployed audio+video/continuous profile can accept through `chert byor`.

No production writes, deployment, migration, enrollment, activation, routing or
secret changes, agent/warm-pool start, real provider sessions, FaceTime calls,
Mac changes, publication, commits, pushes, or additional agents occurred.

## Application boundary and exact scope

Actual checkout: `/Users/garygao/demo-agent-0`, base
`52b43a4be253bc815e32b205a8f1118870b85955`. Existing Python session and adapter source
are unchanged. New application integration is `connector/handler.ts`, `owner.py`,
`server.py`, README and three isolated test files; see [allowlist](application-files.json)
and [review patch](application.patch). The old experimental hook guard candidate
remains separate and is not included in this bridge.

The TypeScript handler compiles against the installed npm package's exported
ByorHandler contract. It calls a private Unix socket owned by Python; it does not
forward to HTTP or reimplement Chert authentication, webhook parsing, transport,
enrollment or routing. Python reuses AvatarService/Service._prepare, the existing
worker-token minting and AvatarAdapter readiness/cleanup implementation. Only that
application adapter creates the original room and dispatches its existing agent.
The wrapper never independently creates, dispatches or deletes resources.

Operation input digest, room/spec mapping and intent are fsynced before application
effects; no token is saved in the operation journal. Duplicates coalesce. A durable
cancellation tombstone prevents an IPC-delayed preparation from allocating after
recovery reported no operation. A completed preparation survives process restart
without credential replay or new dispatch. Lifecycle events have durable stable-ID
acknowledgments, separate from cleanup evidence. The existing owner must verify
room absence (and owned Muse child-room absence) before clean is returned.

Startup/open and health perform no provider calls. They skip HTTP lifespan,
Service.start and the warm-slot watcher, and never run the receiver's destructive
startup recovery on accepted calls. The bridge does not claim the existing
Railway receiver's in-memory slots. It does not start an agent. See the application
[bridge README](/Users/garygao/demo-agent-0/connector/README.md) for construction
and deliberately retained limitations.

A crash or SDK cancellation during preparation is **unsettled/unknown**, even
when deletion currently sees no room. Existing APIs cannot prove the original
provider effect will not complete later. Operation ownership stays durable and
new admission stays blocked; no blind retry or guessed settlement is implemented.
The test that allows late completion proves cleanup only after the original
preparation actually returns, then the original owner verifies absence.

## Tests actually run

| Check | Result |
| --- | --- |
| Python receiver plus application bridge | **113 passed**, including 8 new owner tests; Ruff passed |
| Installed npm → actual TS handler → Python owner, Node 22.23.2 | **3 passed**, no skips |
| CLI full suite, Node 22.23.2, final serial run | **263 passed**, 3 integration tests gated off here and passed separately above |
| CLI full suite, Node 24.14.0 | **266 passed**, no skips, including all 3 installed application tests |
| CLI typecheck/lint/build | Passed both supported Node versions |
| Legacy synthetic transport proof | Passed both versions, 20 commits, zero resources/debt |
| Final regenerated backend: connector DB/service/installed construction, production compatibility, cleanup ordering, optional signing, automatic readiness | **107 passed in 7 files**, both Node versions |
| Final control-plane typecheck/lint/Next build | Passed both Node versions, synthetic loopback configuration |
| Relay tests | **3 passed**, both Node versions |
| PostgreSQL 17.6 combined migration rehearsal | Atomic apply/rollback, permissions, RLS, repeated apply and 8 drift rejections passed |
| New candidate full dependency audit | **0 vulnerabilities** after scoped transitive patch updates |

Logs: [Python](python-final.txt), [Node 22 installed application](installed-node22-third.txt),
[Node 22 final CLI](cli-full-node22-final.txt), [Node 24 full CLI](cli-full-node24.txt),
[CLI matrix](cli-matrix.json), [final candidate matrix](final-candidate-matrix.json),
[atomic rehearsal](atomic-rehearsal.json), [audit](candidate-audit-final.json).
The CLI matrix retains the initial Node 22 failure; the later final log above
supersedes that run. No backend UI-wide full suite or physical media test is claimed.

Installed tests exercise real loopback Chert transport and private Python IPC:
non-allocating startup/check, explicit production-profile decline, duplicate
incoming delivery, actual adapter readiness before acceptance, timeout with late
completion, lost central acceptance reply, restart of both CLI and Python,
lifecycle replay and blocked cleanup followed by verified absence. They keep an
accepted session for **62 real seconds** after restart with a 600-second explicit
expiry, then hang up synthetically and verify cleanup. Wrapper management/create/
dispatch/cancel/delete counters remain zero. The isolated Python server rejects
Internet socket connections and loads no real credentials.

Readiness is exercised through the real AvatarAdapter._refresh using substituted
LiveKit participant/track responses, not a hard-coded healthy callback or prefilled
ready-session file. Real Service._prepare creates the session under those provider
substitutes. Both audio and video readiness checks still run; synthetic acceptance
is explicitly labeled and is not evidence that video may be dropped in production.
No decoded audio/video, provider runtime, FaceTime media or Mac behavior is proved.

Failure evidence is preserved: an early late-completion test cleared its synthetic
non-cancellable-provider behavior too soon; correcting that fixture produced the
expected unsettled-then-clean sequence. Initial installed-test setup used an
incorrect CLI flag and an extra development config field; these were test setup
errors. Backend setup initially lacked relay dependencies. The broad Python run
initially asserted HTTP was never imported even though separate HTTP tests had
imported it; it now checks this bridge adds no import, and the isolated server
independently asserts HTTP absence. No product fix was inferred from those errors.
The parallel Node 22 CLI run hit the existing hook freshness check (unknown rather
than available); the serial full rerun passed without relaxing readiness deadlines.
Host latency remains a real deployment qualification requirement.

A [temporary mutant regression](tombstone-regression-red.txt) removes only the new
unknown-operation cancellation tombstone and fails the late-prepare test. The
actual implementation passes; no historical source/candidate was changed for it.

## Candidate, migration and fresh infrastructure evidence

New directory:
`/Users/garygao/chert-facetime-cli/.local/byor-qualification/candidate`.
It starts from preserved `.local/blocker-resolution/candidate`, itself based on
serving source `cbb22ee854e26219aea92d67fa401433cdb4d84c`. The 25-file
[candidate allowlist](candidate-files.json) and [patch](candidate.patch) retain its
newer signing/readiness behavior, cleanup-ordering fix and dependency patches.
Only mode-aware connector service/tests and the additive BYOR extension are
integrated from the implementation checkout. The five shared production functions
are not copied back from the stale checkout.

[Combined payload](migration.payload.sql) retains original PG17, connector-absence
and five function preimage guards. It adds exact fresh column/history guards and
a post-base runtime preimage/mode-extension guard. Both base and mode extension
apply in one transaction. Forced final failure rolls back schema and function
replacements together. All five shared functions remain unchanged across the
extension; its private delegated runtime retains automatic readiness and cannot be
called by service_role. Public/authenticated access is denied and table RLS remains
on. Zero bindings/deliveries are created. This payload is not applied in production.

Fresh read-only observations, 2026-09-30 around 04:07–04:19 UTC:

- [Serving deployment](fresh-deployment.json) remains READY `dpl_CaaB7JWXnBi7w6dYzZPz4METHBks`,
  declared source cbb22ee, Node 24.x/iad1; [alias](fresh-infrastructure.json) still
  targets it. The earlier 282-file upload/source comparison is recorded evidence
  for this same immutable deployment, not a newly repeated file verification.
- Supabase is PG17.6, no connector table, 40 ledger entries through 20260924200520.
  All five shared preimages still match. [Fresh columns/history](fresh-schema-columns-history.json)
  match the 391 recorded columns in the restored baseline. Full constraints,
  triggers/policies and all other function bodies are recorded catalog evidence,
  not freshly re-captured here. The local baseline still uses minimal auth stubs
  and is not a complete Supabase platform or data backup.
- [Pilot line](fresh-pilot.json) retained generation 3, customer_decides and no
  Assistant, but now referenced an existing call. [That call](fresh-current-call.json)
  was `ending` at 04:19:01 UTC. It needs a fresh settled/drained check before release.
- Historical failed Session still has cleaned_at null. No repair was attempted.
  Railway/LiveKit runtime profile and prior worker audit remain recorded evidence;
  this task did not start, probe or operate their agent processes.

Next 16.3.7, sharp 0.35.5 and Vitest 4.1.11 are retained. The refreshed audit found
newly indexed brace-expansion advisories; only its locked transitive versions changed
from 1.1.18→1.1.21 and 5.0.9→5.0.12. See the maintainer's
[recursion advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and
[expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).
A clean npm 12.1.0 install passes; npm 10 rejects the optional-peer lock layout.
Use the reviewed npm 12 install command at deployment, not an unqualified default.

## Artifacts and preservation

All new artifacts are in
`/Users/garygao/chert-facetime-cli/.local/byor-qualification/artifacts/`:

- `chert-local-transport-proof-0.0.0.tgz` — rebuilt and installed in tests. Its hash
  equals the prior BYOR implementation tarball because production package contents
  did not change; the new application bridge lives in its owning application.
- `control-plane-source.tar.gz` — regenerated mode-aware patched backend.
- `connector-relay-source.tar.gz` — regenerated unchanged relay source.
- `talking-head-bridge-source.tar.gz` — application base plus reviewed new bridge,
  with no dependency/build directories, environment secrets, or runtime journals.

Exact SHA-256/size values are in [artifacts.json](artifacts.json). Both patches apply
cleanly to their pinned bases. These are source archives, not published packages
or a hosted deployment. [Preservation verification](preservation.json) checks the
42,570-file initial baseline, including historical candidates, artifacts and debt.
The existing source change is a test-harness timeout parameter for the 62-second
integration test; current readiness/runbook documents receive a new lead-in while
their previous bytes are retained. Existing Python source and the original Chert
working tree remain unchanged. Unrelated user changes are preserved.

## Remaining blockers versus deferred polish

**Release blockers:** deployed video requirement versus audio-only protocol;
45-second warm preparation versus four-second callback; no durable shared claim
of the existing process-local warm slot; independent application expiry/lifecycle
supervision and authoritative settlement of interrupted provider preparation;
actual selected Linux host supervision and ingress; current-call drain; separate
historical cleanup evidence; real audio/provider/FaceTime acceptance. The bridge
therefore remains a local qualification prototype, not an activation-ready host.

**Deferred polish:** browser/device login instead of manual management tokens,
friendlier diagnostics, broader multi-writer/capacity support and high-volume
retention work. These are separate from the concrete pilot blockers.

[Deployment and bounded live-test proposal](RUNBOOK.md): resolve and requalify the
application gates, review hashes/fresh infrastructure and cleanup, then separately
authorize one atomic migration and shared-service deployment. Enroll fresh BYOR
state/binding in standby; review activation separately. Only then propose two
supervised calls: about 70 seconds of connection/two-way audio, hangup and verified
cleanup, followed by a 20-second call and opposite-side hangup. Stop on uncertainty;
retain old owners and recovery through rollback. No production or live step follows
automatically from this report.

Documentation/whitespace verification: tracked diffs pass `git diff --check` in all
three repositories. The Chert documentation checker still reports only its two
pre-existing unindexed files (`PATENT_TECHNICAL_DISCLOSURE.md` and
`output/fleet-investigation-2026-09-29.md`); neither was edited.
