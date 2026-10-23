# BYOR-first CLI implementation results

Implemented locally, with a real installed npm callback path for an application
that has no receiver. No production writes/access, deployment, live sessions,
agent start/restart, Mac changes, commits, pushes or publication occurred. No
other agent/task was started. The provisional package remains private and unnamed
for publication; the existing name is `chert-local-transport-proof@0.0.0`.

## What the customer now does

Install the reviewed tarball, run `chert init --mode byor` (the default without
legacy adapter flags), connect generated `chert-handler.ts` to their application
session owner, compile it, then check and run `chert byor` after separately
approved standby enrollment. Explicit activation remains a separate operation.
A fresh [private tarball manifest](artifacts.json) records the review artifact; it
is not a regenerated deployment candidate. The [CLI guide](../../CLI_GUIDE.md) and [complete example](../../examples/byor/README.md)
show the no-receiver workflow. The example's application-owned mailbox demonstrates
durable claim, lifecycle delivery and explicit cleanup evidence; it creates no
real resources. Its single-writer store is illustrative, not a multi-writer database.

The package handles Chert authentication/enrollment, scoped transport, original
deadlines, response handling, duplicate coalescing, central reconciliation and
persistent lifecycle delivery. The application supplies ready call-scoped room
credentials, its non-secret session reference, session duration, idempotent event
processing and recovery/cancellation/cleanup through its existing session owner.
No HTTP receiver, public URL, wrapper LiveKit master credential, named dispatch
or experimental hook is required. The application owns its session effects; the
wrapper has no LiveKit create/dispatch/delete operation in BYOR mode.

`chert create-room` remains an explicit persistent connector using the specialized
adapter; it allocates only for an incoming call. Its named dispatch, exact readiness,
loopback hook, master-key requirements and 60-second ceiling are retained. Legacy
v1 config and `run` retain their interpretation. V2 command/mode mismatch rejects
before effects. BYOR uses a distinct strict journal pinned to mode, binding,
handler ID and module path; old resource journals cannot silently convert.

## Ownership and duration

The [ownership contract](../BYOR_OWNERSHIP.md) separates central decision, transport
lifecycle receipt, application acknowledgment and verified application cleanup.
Intent is durable before preparation; timeout/rejection never establishes remote
settlement. No blind preparation retry occurs after timeout/reopen. Pending
application events survive transport acknowledgments and replay with stable IDs.
Missing recovery/lifecycle capabilities remain explicit limitations and retain debt.
Completed calls stay debt-free through expiry and failed/stale reconciliation.

BYOR acceptance supplies explicit session_expires_at. Local and central checks
reject expired, over-token or over-authority values; accepted Session/seal/worker
command lifetime uses the chosen value without silent truncation. Real isolated
backend tests verify a 600-second lease, one sealed Session and one start_bridge.
The authority upper bound is two hours, matching the existing BYOR token validator;
its receipt bound is distinct from the chosen application expiry. Decision/preparation
remain five/four seconds. Create-room retains 60 seconds. No video or slow-avatar
cold-start capability is added; the current connector remains audio-only.

Backend enrollment pins immutable session_mode. New mode handoffs use new bindings
and fresh state; old calls retain their original owner and recovery. Permanent
revocation and retirement despite added lines remain covered. The new SQL extension
delegates to the installed connector runtime; it does not replace the five shared
routing/readiness/cleanup functions of the newer deployment candidate.

## Failing-before and passing-after

- [Onboarding/transport red](onboarding-red.txt): two failures before implementation,
  because init demanded LiveKit/hook parameters and transport rejected BYOR mode/
  duration fields. Receiver-free initialization and installed callback tests now pass.
- [Backend red](backend-red.txt): enrollment discarded BYOR mode. Mode is now pinned,
  immutable and produces the two-hour bound; legacy remains unchanged.
- [Terminal ordering red](terminal-order-red.txt): final review found a terminal-before-
  incoming tombstone rejected its subsequent authoritative decline. The fix preserves
  this allocation-free completed record without weakening ordinary expiry checks.
- [Ownership tests](final-ownership-node22.txt) cover controlled-promise duplicates,
  conflicting/stale/foreign input, late preparation, rejected/unsettled operations,
  lost acceptance, restart, application replay, missing recovery, unknown cleanup,
  immutable handler/binding, 600-second duration, expiry/reconciliation races and
  suppression of credential replay after the original deadline.

The installed tarball test starts in a clean application with no receiver. It
compiles the **generated** scaffold using exported package types, then connects it
to the bundled example session owner. Through actual loopback HTTP/WebSocket it
holds preparation, delivers identical requests, requires one preparation/two equal
responses, loses the central receipt, restarts, recovers without re-preparation,
replays terminal delivery, waits for explicit application cleanup and finishes
without debt. It also verifies health recovery from unavailable to available.
All wrapper LiveKit management, create, dispatch, cancel and delete counters stay
zero across check, idle startup, acceptance, restart, terminal and mode mismatch.

The production ConnectorBackend and deployable relay are separately exercised
against disposable PostgreSQL: both modes, duration validation before sealing,
conflicting duration replay, one authoritative commit, durable receipt/terminal
replay, recovery credentials and generation fencing. Installed TLS enrollment and
legacy create-room construction remain in the full backend suite. None of these
fixtures is a real Supabase login, LiveKit room, provider or FaceTime call.

## Final validation

| Check | Node 22.23.2 | Node 24.14.0 |
| --- | --- | --- |
| CLI full suite, including both installed tarball paths | 263 passed | 263 passed |
| CLI typecheck / lint / build | pass | pass |
| Legacy synthetic transport proof | 20 commits, zero resources/debt | 20 commits, zero resources/debt |
| Control-plane full suite, DB + installed CLI enabled | 257 passed, 1 existing skip; 30 files passed | 257 passed, 1 existing skip; 30 files passed |
| Control-plane typecheck / lint / build | pass | pass |
| Relay syntax / tests | pass / 3 passed | pass / 3 passed |
| Existing talking-head BYOR syntax and focused preparation/outbound tests | pass / 6 passed | pass / 6 passed |

[Initial full matrix](matrix.json) and [Node 22](validation-node22.txt)/
[Node 24](validation-node24.txt) logs include the backend, relay and unchanged demo
checks. [Final CLI matrix](final-cli-matrix.json) and [Node 22](final-cli-node22.txt)/
[Node 24](final-cli-node24.txt) rerun all CLI checks after final review and packaging
updates. Earlier 262-test counts are intermediate; final totals include the added
late-duplicate regression. The existing pgTAP dependency is the sole backend skip;
no connector/database/installed integration was skipped in the full matrix.
Control-plane builds used only synthetic loopback configuration.

[Candidate rehearsal](candidate-rehearsal.json) uses a new Unix-socket PostgreSQL
17.6 cluster restored from the recorded production schema-only catalog and the
preserved blocker-resolution payload. The new extension applies successfully;
a forced late failure rolls back its column, functions and runtime rename. The
five shared function bodies and automatic-readiness runtime body remain unchanged.
The delegated runtime is not callable directly by service_role; the public wrapper
retains service-only execute privileges. Ordinary suites use PostgreSQL 15.14.
This is local catalog rehearsal, not a fresh production/schema-history check.

The first new service test queried a nonexistent lease_expires_at column on
Sessions. It was corrected to the actual expires_at column; [final focused service
run](service-node22-final.txt) and both full matrices pass. Original failure evidence
is retained. No product fix was inferred from that test-assertion mistake.

## Preservation and candidate regeneration

[Exact changed-file list and hashes](changed-files.json) and
[preservation/whitespace verification](preservation.json) compare 3,386 baseline
files. All 2,461 pre-existing CLI .local files, 124 historical deployment/qualification
artifacts, 189 historical JSON/text evidence files and all 135 original demo files
are unchanged (categories overlap). Both historical adapter debts, the separate
historical failed Session evidence, old migration, release archives, candidate
checkouts and original dirty work remain intact. The documentation checker still
reports only its two pre-existing unindexed files. New/changed files and tracked
diffs pass whitespace checks.

Before a release can be reviewed, regenerate **new** artifacts from the preserved
newer serving baseline, retaining its patched dependencies, signing/automatic
readiness behavior and cleanup-ordering fix:

1. Rebase the mode-aware `control-plane/src/lib/facetime/connectors.ts` changes and
   tests onto `.local/blocker-resolution/candidate` in a new candidate directory.
   Do not replace that directory or copy the old checkout's shared functions.
2. Compose its guarded migration payload with
   `20260930033750_connector_byor_mode.sql` in the same transaction, preserving all
   existing preimage/catalog/history guards and adding reviewed mode-extension
   guards. Rehearse the combined release, rollback and drift handling on the fresh
   serving baseline; do not apply two competing connector base migrations.
3. Rebuild private CLI tarball, control-plane source archive, candidate patch,
   allowlisted file hashes, artifact manifest, and any bundled relay archive manifest.
   Relay source itself did not change. Historical artifact digests are no longer
   evidence for this new package; retain them as history.
4. Update host supervision from legacy `run` to the chosen explicit command,
   use fresh state/binding, immutable handler/module paths and application-owned
   secret/recovery provisioning. Review the amended pilot runbook for Chert
   FaceTime Test. No wrapper LiveKit/hook secrets belong in its primary BYOR config.

## Remaining limitations and next step

The generic no-receiver TypeScript path is implemented and locally validated.
The actual talking-head application is a Python receiver/session owner with warm
slot startup/shutdown side effects; importing its HTTP lifespan would allocate or
clean resources and violate non-allocating check/startup. Its existing APIs do not
supply this operation-scoped callback recovery interface. A qualified application
bridge to that session owner remains compatibility work before this specific pilot.
No experimental dispatch/hook retrofit or optional receiver-forwarding adapter
was added. A successful forwarded HTTP call would not satisfy this implementation.

The example is not a production session database; callbacks are trusted code and
must implement durable idempotency and honest settlement. Missing/hung recovery
retains uncertainty and stops admission. Callback initialization/health must be
non-allocating. Capacity remains one and long-term journal retention/high-volume
operation are unqualified. Enrollment still uses manual owner/admin access tokens.
Actual decoded audio, talking-head media, FaceTime/video, host supervision and
production ingress remain unqualified by this local work.

**Next: review this implementation, then qualify the talking-head application
bridge and regenerate/review deployment artifacts.** No automatic deployment,
enrollment, activation, warming or live test follows this result.
