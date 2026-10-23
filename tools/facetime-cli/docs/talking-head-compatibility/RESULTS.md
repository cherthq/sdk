# Talking-head compatibility implementation — review only

The production callback construction now claims an already-ready classic
**audio/video** session. It does not use the synthetic audio policy or cold-prepare
on an incoming call. Application staging, durable claims, independent expiry and
cleanup are implemented. **Actual deployment-host qualification and physical
FaceTime media remain open gates.** No live sessions, production access, remote
host operations, deployment, agent starts, warming, commits or publication occurred.

## Changes

- BYOR protocol/types/journal preserve the requested video boolean. The additive
  backend migration permits audio+video only for immutable BYOR bindings;
  create-room retains its audio-only and 60-second limits. Original deadlines,
  authorization, credential sealing, lifetime bounds, duplicate digests and
  connection fences remain intact. Existing Mac source already observes the
  incoming video flag (`FaceTimeCallControl.swift:577`) and sends call media to
  the control plane. No Mac source or configuration was changed; physical video
  capability is not established by this source audit.
- The application server constructs `ReadySessionOwner`/`ReadyAvatarAdapter`.
  Its private callback socket only admits claims; the separate application admin
  socket exposes explicit staging, cancellation and status. Staging reuses the
  existing demo dispatch shape, 45-second preparation budget, classic profile,
  token minting, audio AND video readiness and cleanup implementation. Health,
  check, startup and incoming callbacks cannot create/refill or start an agent.
  No ready slot means a clear decline. This is expected admission behavior, not
  the old unconditional production-profile rejection.
- One fsynced atomic journal update binds a slot to the exact call/operation digest
  before credentials are returned. Duplicate/conflicting calls cannot claim it
  twice. Reopen preserves claims without creating another room or replaying tokens.
  Ready slots refresh the original room's ownership/media before re-admission.
  The full configured call duration must fit the original agent/token and authority
  bounds; no silent truncation or token renewal occurs.
- The owner independently runs terminal/expiry cleanup and bounded retries while
  Node is absent. It persists room intent/marker before create and the acknowledged
  SID before dispatch. Cleanup refuses foreign replacements and preserves debt on
  unavailable APIs or failed verification. Cancelled/interrupted staging remains
  uncertain, including after reopen and absent inventory. Only the original
  completed preparation can establish settlement; no reset or blind retry exists.
- Private journal/socket locks exclude another writer. An owner SIGKILL leaves
  durable claims and a stale socket that the next exclusive owner safely reclaims.
  Normal startup requires both persistent journals; `--initialize-state` is an
  explicit fresh-state setup that refuses existing state. Reviewable systemd units
  were added, not installed. The Node crash-lock policy remains conservative;
  its recovery requires review while application expiry continues independently.

The old HTTP receiver's live in-memory warm slot is not transferred. Deployment
requires fresh state and a deliberate old-owner drain. Automatic continuous refill
is not enabled: the application/operator explicitly stages each next slot through
its own control endpoint. This keeps paid preparation outside incoming/check/startup
and avoids running the old destructive HTTP lifespan or warm watcher.

## Regression evidence

[Brief](BRIEF.md) recorded hypotheses before implementation.

- [CLI media red](media-red.txt): an audio/video incoming request failed with
  `invalid_frame`. It now reaches the callback unchanged, rejects a conflicting
  media duplicate and reopens from the journal with video preserved.
- [Owner behavior red](owner-behavior-red.txt): the old owner had no durable stage/
  claim operation; both ready-claim and reopened-expiry tests failed. The new
  [owner/process tests](python-full-final.txt) pass all 16 cases, including no-slot,
  missing video, stale readiness, full-duration bounds, duplicate/foreign claims,
  journal failures, cancellation during held staging, late completion, unresolved
  staging after reopen, replacement-room refusal, cleanup retry, exclusive writer,
  owner SIGKILL, independent expiry and fresh-state initialization.
- [Backend red](backend-behavior-red.txt): an audio/video BYOR decision could not
  produce a commit receipt. The real SQL/relay test now commits one Session with
  the 600-second lease, survives receipt loss/restart and delivers terminal state.
  A separate regression verifies create-room still rejects video and the private
  delegated runtime remains inaccessible to service_role.
- Installed npm → actual TypeScript callback → production ready-owner construction
  → real AvatarAdapter readiness code: both publications are required; explicit
  staging completes before incoming, duplicate callbacks claim once, wrapper
  management/create/dispatch/delete counters stay zero, cleanup completes, and a
  second staged session can be claimed. Only provider transports are substituted.
  No synthetic audio-policy override is used in this new test.

Earlier prototype tests remain as regression coverage, explicitly named synthetic
or default-decline; they are not evidence for the new production-policy admission.
Their 62-second offline dwell remains separate from the proposed future live calls.

## Final validation

| Check | Node 22.23.2 | Node 24.14.0 |
| --- | --- | --- |
| CLI full suite, installed application tests enabled | 268 passed, zero skips | 268 passed, zero skips |
| CLI typecheck/lint/build | pass | pass |
| Synthetic transport proof | 20 commits, zero resources/debt | 20 commits, zero resources/debt |
| Control-plane full suite with isolated DB and installed CLI enabled | 259 passed, 1 existing pgTAP skip | 259 passed, 1 existing pgTAP skip |
| Control-plane typecheck/lint/build | pass | pass |
| Demo syntax and full Node tests | 93 passed | 93 passed |
| Relay tests | 3 passed | 3 passed |
| Final private tarball production-policy callback test | pass | pass |

Python 3.12: **129 tests passed** across the receiver and bridge; Ruff passed.
See [main matrix](matrix.json), [final CLI matrix](final-cli-matrix.json), [demo/relay matrix](remaining-matrix.json),
[Python full log](python-full-final.txt) and [final tarball evidence](artifacts.json).
The full suites used serial CLI execution to avoid the previously observed
fixture health-window contention. Local backend builds used synthetic loopback
configuration. No test connected to a real provider or performed a FaceTime call.

[PostgreSQL 17.6 candidate rehearsal](candidate-rehearsal.json) restored the recorded
catalog and preserved newer candidate payload into a disposable Unix-socket cluster.
The media extension applies atomically; forced failure rolls back, repeated apply
rejects, all five shared functions remain unchanged, and the delegated runtime
changes only at the reviewed media predicate. ACLs remain restricted. Ordinary
backend tests use PostgreSQL 15.14. This is not fresh production schema validation.

Validation corrections: the first owner test invocation lacked its connector
import path; the corrected invocation produced the intended two behavior failures.
The first backend command ran from the wrong directory; corrected red evidence is
linked above. The first process tests exceeded the OS Unix-socket path limit;
they now use short private temporary directories. The initial validation runner
called nonexistent demo `npm test`; the project's actual `npm run check` was run
separately. That broader check exposed Node 24's `module.exports` namespace marker
in two mock.module fixture spreads. Filtering that marker fixes the test harness
on both runtimes without changing application/agent behavior. No provider or agent
runtime was changed to make these checks pass. A final installed Node 24 recheck
caught a fake-provider JSON read/write race ([failure](final-installed-node24.txt));
the fixture now publishes its inventory/control files with atomic replacement.
The production journals already used atomic fsynced writes. Final CLI suites were
rerun against the same final private tarball after this fixture correction.

## Preservation, artifacts and remaining gates

[Preservation](preservation.json) and [exact changed-file hashes](changed-files.json)
compare the pre-edit 11,629-file baseline. All historical qualification reports,
release candidates, artifacts and cleanup/debt evidence remain unchanged. Prior
unrelated dirty work remains intact. The new private CLI tarball is solely a local
review/test artifact; no deployment candidate or shared-service archive was
regenerated. New/changed text and tracked diffs pass whitespace checks. The docs
checker still reports only the two existing unindexed files recorded previously.

Before deployment, regenerate artifacts in a **new** candidate from the preserved
`.local/byor-qualification/candidate`, integrate the additive media migration into
its guarded atomic payload, rebuild the CLI and application source archives,
update hashes and supervisor paths, and review current/historical cleanup state.
Do not deploy the old checkout's base migration wholesale. The previous candidate
hashes are historical evidence and do not describe this implementation.

[Host qualification](HOST.md) remains incomplete: no actual Linux/systemd or
Railway volume/supervision has been exercised, and the host-selection question is
pending. Node hard-kill crash-lock recovery remains a reviewed operator step.
Interrupted provider staging still requires authoritative external settlement
before releasing that slot; this is retained uncertainty, not a claimed fix for a
missing provider operation-status API. Full continuous automatic refill is not
implemented. Dynamic FaceTime video, decoded audio, conversation and actual host
latency remain unqualified.

**Next: review these application-boundary changes and select/qualify the host.**
Then the deployment agent can regenerate affected artifacts and review cleanup
before proposing activation. The 70-second call followed by a 20-second call remains
a later separately authorized acceptance test. No further real session follows
this report.
