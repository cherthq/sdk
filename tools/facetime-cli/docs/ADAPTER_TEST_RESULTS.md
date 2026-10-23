# LiveKit adapter test results

## September 29 correlation review — bounded live test passed

**The single newly authorized provider-free LiveKit attempt passed dispatch →
exact readiness → synthetic authority acceptance receipt → terminal delivery →
verified cleanup.** This run exercised an actually omitted nested job room.
No second session ran. Both historical unresolved debts remain unchanged.

### Review and local checks

No blocking finding was found in the room-correlation fix within this test's scope.
Review traced the omitted-room case through discovery, authenticated session
binding, durable assignment and readiness. Wrong/empty nested rooms and mismatched
parent room, dispatch/job IDs, nonce, marker or participant still fail; SID/marker
ownership checks and absolute deadlines remain intact. No adapter or demo source
change was needed during this review.

The harness now uses a new exclusive one-use `--correlation-review-20260929`
reservation, linked to the prior clean run; it cannot reuse old state or unlock
qualification slot 2. A regression verifies those properties. Final inventory
now records both the project-wide count and an exact-room query, including
SID/marker match booleans when a room exists. This avoids treating an unscoped
count as the sole cleanup observation while preserving discrepancies as evidence.
The harness also records whether the successful listed job omitted its room and
retains all boolean readiness checks on success.

**180/180 CLI tests pass on Node 22.23.2 and 24.14.0**, together with typecheck,
lint, build and the 20-call synthetic proof on each runtime. The isolated demo
passes **97/97 tests on Node 22.23.2**. Proofs:
[Node 22](ADAPTER_CORRELATION_REVIEW_TRANSPORT.json),
[Node 24](ADAPTER_CORRELATION_REVIEW_TRANSPORT_NODE24.json).
Both show 20 synthetic commits/deletions and zero resources/debt. No dependency,
lockfile, original demo, hosted configuration, routing, database or Mac changes
were made. No commits, pushes or package publication occurred.

### Real-service evidence

The [attempt](ADAPTER_CORRELATION_REVIEW_ATTEMPT.json) ran from **21:10:33–21:10:45
UTC** with harness and worker both explicitly on **Node v22.23.2**. SDK/agents/RTC
remain **2.19.0 / 1.8.0 / 0.13.35**. The named worker uses the isolated demo checkout;
Chert authority and relay remain local synthetic fixtures, not hosted production.

| Evidence | Result |
| --- | --- |
| Run / boot | `5826fc94-7077-4ce2-8baa-d10719a9e28d` |
| Worker name | `chert-connector-test-5826fc94-7077-4ce2-8baa-d10719a9e28d` |
| Connector instance | `1b4ec1bd-15e4-4ab4-8b1d-ec0fd5ee9582` |
| Logical operation | `b0bd2f37-dd90-4279-8b56-23d3f8c89ca7` |
| Room / SID | `d27d7995-039a-47b9-9fa1-88cbd41e6af6` / `RM_3FghZH353wCp` |
| Dispatch / actual job | `AD_w7bA75onRGhP` / `AJ_x2PpBvRt3Ud7` |
| Actual worker | `AW_2HfhGjdtyWPT` |
| Participant / audio track | `36e3ffd2-399a-48dd-ba38-449310e37219` / `TR_AMWvRmhZqXTaZi` |
| Idle | authenticated availability; zero new rooms/jobs |
| Allocation | one CreateRoom with one intended room agent; zero CreateDispatch calls; no redispatch |
| Room timeout | 3901 ms input, floored to 3000 ms; room ACK in 530 ms |
| Readiness | all 19 checks true; nested job room omitted; exact job/dispatch/session/nonce/publication match |
| Decision | **accept**, preparation response in **3473 ms**, within the 4000 ms limit |
| Authority | exactly one synthetic commit at 21:10:39.914 UTC; receipt delivered and journal accepted |
| Bridge material | real LiveKit token signature and call-specific room/identity/grants verified; token not logged |
| Terminal | version 2 event delivered through relay and acknowledged |
| Cleanup | **2738 ms**, durable `clean` receipt, zero new debt |
| Worker | draining observed, exact job ended, exit code 0 |
| Final inventory | project-wide owned count 0; exact owned room count 0 |

The [acceptance receipt](ADAPTER_CORRELATION_REVIEW_ACCEPTANCE.json) is authoritative
within the **synthetic control plane only**. Its receipt was fsynced before commit
completion and delivered over the fixture relay; the connector journal reached
accepted before terminal delivery. The decision deadline remained five seconds;
resource lifetime remained 60 seconds and worker watchdog 90 seconds. No warming,
refill, retry, provider session or FaceTime call occurred.

Cleanup retained authenticated cancellation, dispatch deletion ACK, exact job-ended
observation, room deletion ACK and verified absence. It preserved the actual
operation/dispatch/job/worker ownership mapping. [Reopened verification](ADAPTER_CORRELATION_REVIEW_RECOVERY.json)
after worker shutdown independently returned settled/absent with **zero hook
calls**, using a memory copy without changing the on-disk evidence.

### Final state and qualification limits

At **21:11:15 UTC**, the [independent scoped inventory](ADAPTER_CORRELATION_REVIEW_FINAL_INVENTORY.json)
found no rooms for any of the five runs and no local test worker. Room-specific
dispatch reads returned not_found. For the new run, absence is corroborated by
exact durable terminal/deletion receipts; for the two historical runs, it still
cannot settle their missing evidence.

| Run | Observed rooms | Cleanup debt |
| --- | --- | --- |
| Original September 25 | 0 | **1 unresolved** |
| September 25 diagnostic | 0 | **1 unresolved** |
| Earlier September 29 qualification | 0 | 0 |
| September 29 readiness review | 0 | 0 |
| This correlation review | **0** | **0** |

[Baseline](ADAPTER_CORRELATION_REVIEW_BASELINE.json) and final audit confirm all
**59 historical evidence hashes unchanged**, along with the original demo's
unrelated document hashes. [New-run evidence hashes](ADAPTER_CORRELATION_REVIEW_EVIDENCE.json)
cover journal, adapter receipt, result and acceptance. The two historical debts
remain quarantined and unresolved; this passing test does not administratively
settle them or bypass normal production admission.

This qualifies **one isolated provider-free dispatch/readiness/acceptance/cleanup
path under the tested conditions**. It does not establish decoded audio (no bridge
participant connected), conversation, FaceTime, Muse, real Chert authority,
production recovery, actual demo profiles, hosted transport or Mac readiness.
One success is not reliability or latency-distribution evidence. Non-atomic
compare-SID-and-delete and historical settlement limitations remain.

Recommended next step: review this evidence and the scope of a separately
authorized integration/transport slice, while resolving historical debts through
their own evidence or explicit administrative process. **Stopped after one
attempt; no additional real sessions or deployment.**

## Prior implementation record

The following local-only report predates the successful live review above.

## September 29 room-correlation fix — implemented, locally validated

The room-correlation contract is corrected in `src/adapters/livekit.ts`.
**No new real session, worker, allocation, credential loading or service inventory
request ran in this implementation task.** All 53 pre-task historical artifact,
receipt and authorization-latch hashes remain unchanged, including both unresolved
historical debts and both clean September 29 runs.

The pinned SDK permits an omitted `Job.room` and preserves that omission when
round-tripping dispatch responses. LiveKit's public
[RedisStore](https://github.com/livekit/livekit/blob/master/pkg/service/redisstore.go)
stores jobs by room, omits the nested room from the stored job, and associates
listed jobs with dispatch IDs under the same room key. The
[dispatch API](https://docs.livekit.io/reference/agents/agent-dispatch-service-api/)
provides the parent dispatch's room and the job's dispatch ID. These establish a
supported omission case, not proof of the hosted service revision or of whether
the last attempt's unrecorded nested value was missing versus wrong.

Readiness and durable assignment now use the same correlation predicate:

- Exactly one listed job with nonempty job/dispatch IDs.
- Parent dispatch names the owned room, and its ID matches both the listed job
  and the authenticated worker session's SDK dispatch ID.
- The listed job ID matches the authenticated session job ID. Session operation,
  room, ownership marker, nonce and participant match the connector's entry.
- An absent nested `Job.room` is allowed only with that complete binding chain.
  A present nested room must name the same room; wrong or explicitly empty room
  objects are rejected, not treated as omission.

Current room SID/marker inspection, signed dispatch metadata digest, exact target,
worker, running state, participant attributes, sole unmuted audio, track SID and
original deadlines remain enforced. The existing probe checks SDK request/job
room against the signed operation before publication and binds `/ready` to SDK
job/worker identity. It already reports the required dispatch ID, so no demo hook
or other repository changes were needed. Older hooks without that dispatch ID
cannot satisfy readiness. Cleanup and historical settlement rules are unchanged.
The `job_room_matches` diagnostic now describes this correlated room binding,
rather than requiring the optional nested room field alone.

### Regression and validation evidence

[Failing-before regression](ADAPTER_ROOM_CORRELATION_RED.txt): an SDK-decoded job
with omitted room declined despite fully matching dispatch/session evidence.
After the fix, the same regression prepares once for duplicate requests, persists
actual job/worker before minting the synthetic bridge token, commits exactly one
synthetic acceptance, delivers terminal state and clears all owned resources/debt.

Sixteen added cases cover that full path plus wrong/empty nested room, wrong
parent room, missing/wrong hook dispatch, mismatched job/dispatch IDs, wrong hook
room/marker/nonce, foreign SID/marker, and deadline expiry. The existing SDK
round-trip diagnosis now distinguishes omission from contradiction. Existing
redaction and nonce rejection tests remain effective when the room is omitted.

| Validation | Result |
| --- | --- |
| Node 22.23.2 / npm 10.9.8 | typecheck, lint, 179/179 tests, build, 20-call synthetic proof pass |
| Node 24.14.0 / npm 10.8.2 | typecheck, lint, 179/179 tests, build, 20-call synthetic proof pass |
| Isolated demo Node 22 | 97/97 tests pass; no source changes |
| Synthetic proof, each runtime | 20 commits/deletions, zero remaining resources/debt |
| Whitespace and preservation | tracked/untracked files checked; historical hashes unchanged |

Logs: [Node 22](ADAPTER_ROOM_CORRELATION_NODE22.txt),
[Node 24](ADAPTER_ROOM_CORRELATION_NODE24.txt),
[demo Node 22](ADAPTER_ROOM_CORRELATION_DEMO_NODE22.txt),
[baseline hashes](ADAPTER_ROOM_CORRELATION_BASELINE.json),
[final preservation check](ADAPTER_ROOM_CORRELATION_VALIDATION.json).
Executed `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
`npm run proof:transport -- --host 127.0.0.1 --json` with each Node directory
explicitly first in PATH; demo used `npm run check`. The earlier broader Node 24
demo module-mock limitation remains historical and was not requalified here.

The implementation is ready for review. **Live qualification remains unproven
until a separately authorized attempt exercises this fix.** A genuinely wrong
nested room will still block readiness. The two historical debts remain unresolved;
no old result is reclassified as success. No commits, pushes, deployments,
publication, production integration, provider sessions or FaceTime calls occurred.

## Prior reviewed attempt (historical)


## September 29 reviewed retry — exact failing check identified

The owner asked to try again after reviewing the previous qualification result.
Exactly **one fresh provider-free attempt** ran at **20:56 UTC**, with the existing
4-second preparation / 5-second decision / 60-second resource / 90-second worker
limits. It failed readiness; **no acceptance or bridge material was returned**.
Cleanup verified absence with durable receipts, and the worker stopped: **zero
new debt**. Both historical debts remain unresolved and byte-for-byte unchanged.

### Authorization, isolation and validation

The separate test-only `--readiness-review-20260929` flag consumes an exclusive,
fsynced `.local/adapter-readiness-review-20260929.json` reservation. It does not
reuse a worker, rewrite a prior latch, unlock qualification slot 2, or change
production admission/settlement rules. Its regression covers incomplete prior
cleanup refusal, one-use consumption, fresh identity and unchanged prior files.
Before the attempt, all prior workers were stopped; scoped prior rooms were absent.
[Baseline](ADAPTER_READINESS_REVIEW_BASELINE.json) hashes 41 historical evidence
files, including all three previous runs' local receipts and result files.
[Preflight](ADAPTER_READINESS_REVIEW_PREFLIGHT_INVENTORY.json) independently retains
the distinction between absence and unresolved historical debt.

Both harness and worker explicitly ran **Node v22.23.2**, confirmed by IPC.
SDK/agents/RTC remain **2.19.0 / 1.8.0 / 0.13.35**. Before allocation: 162 CLI tests,
typecheck, lint, build, synthetic proof and 97 isolated demo tests passed.
After diagnosis: **163/163 CLI tests**, typecheck, lint, build and
[final synthetic proof](ADAPTER_READINESS_REVIEW_FINAL_TRANSPORT.json) pass on
Node v22.23.2 (20 synthetic commits/deletions, zero resources/debt). No Node 24
rerun was needed for this attempt; its earlier matrix remains historical below.
No demo code, provider profile, hosted service, routing, database or Mac changed.
No commit, push, publication, provider session or FaceTime call occurred.

### Real result and precise remaining mismatch

[Attempt](ADAPTER_READINESS_REVIEW_ATTEMPT.json) and
[evidence hashes](ADAPTER_READINESS_REVIEW_EVIDENCE.json) record:

| Item | Evidence |
| --- | --- |
| Run / boot | `16cdc9cb-cdc4-4eaa-86c0-79fa5af92fec` |
| Worker name | `chert-connector-test-16cdc9cb-cdc4-4eaa-86c0-79fa5af92fec` |
| Connector instance | `7603706b-6bd9-476b-97db-eb9a7b201c44` |
| Logical operation | `9bc1d097-ec66-4b06-9a24-af3803ac2851` |
| Room / SID | `998fb937-5f5d-4082-bf13-cd42d135d20f` / `RM_vAT5DHxbKQ33` |
| Dispatch / actual job | `AD_fQALXjPM4JFR` / `AJ_P9c5h2E2PMVT` |
| Worker / audio track | `AW_8BaJ5JTyu5dL` / `TR_AM8bc5ejgVS5hv` |
| Idle | authenticated available; zero new rooms/jobs; no baseline rooms |
| Allocation | one CreateRoom with configured worker, ACK in 348 ms; zero CreateDispatch calls |
| Exact room timeout input | 3941.2810419999996 ms, floored to 3000 ms |
| Decision | decline `deadline_exceeded`, response in 4041 ms including transport overhead |
| New cleanup | `clean`, zero debt, worker exit 0 |

The last readiness diagnostic has **18 true checks and exactly one false check:
`job_room_matches`**. The adapter compares the listed job's `job.room.name` against
the owned room. All other recorded checks passed: authenticated session binding,
job/dispatch/worker/participant, running state, nonce/job attributes, no foreign
participant, sole unmuted audio and exact track SID. This identifies a concrete
blocking predicate, not merely slow audio initialization. It does not prove every
check was true simultaneously earlier in the budget.

The stored failure observation omits the nested job room value, so **missing versus
wrong job room is not distinguishable in this artifact**. The pinned protocol's
`Job.room` is optional, and SDK decoding does not populate it from the parent
`AgentDispatch.room`. The new offline regression round-trips through the pinned
SDK and proves that either an omitted or explicitly wrong nested room reproduces
exactly this single false check with all other predicates true.

LiveKit's public [RedisStore implementation](https://github.com/livekit/livekit/blob/master/pkg/service/redisstore.go)
removes `Job.room` when storing jobs and associates them with dispatches through
the room-keyed store. This is a plausible omission path, **not proven attribution
to the deployed service**: its revision/path is unknown, and the public
[RoomManager ListDispatch](https://github.com/livekit/livekit/blob/master/pkg/service/roommanager.go)
also has an in-memory path. No predicate was removed or relaxed based on this
inference. Recommended next fix: establish an explicit room-binding contract from
the exact room-scoped dispatch response and authenticated SDK job-entry evidence,
rejecting contradictions; cover missing and wrong fields separately before a
newly authorized live test.

Live components were the isolated named SDK worker, management API, RTC job,
participant and silent audio publication. Chert call authority and relay remained
synthetic loopback fixtures. Normal acceptance receipt, returned bridge credentials
and success-path terminal delivery were **not reached**. Publication is not decoded
audio, conversation, FaceTime or Muse evidence.

### Verified cleanup and preservation

The adapter durably recorded authenticated cancellation, dispatch deletion ACK,
exact job-ended evidence, room deletion ACK and scoped absence, in that order.
The immediate harness count-only inventory again reported one room after cleanup;
that historical count remains untouched and does not distinguish delayed visibility
from replacement. No extra deletion was attempted. At **20:56:39 UTC**, the
[final scoped inventory](ADAPTER_READINESS_REVIEW_FINAL_INVENTORY.json) found no
rooms for any of the four runs and room-specific dispatch reads returned not_found.
[Reopened receipt verification](ADAPTER_READINESS_REVIEW_RECOVERY.json), using an
in-memory copy after worker shutdown, independently returned settled/absent with
zero hook calls; on-disk evidence hashes remained unchanged.

| Run | Observed rooms | Cleanup debt |
| --- | --- | --- |
| Original September 25 | 0 | **1, unresolved** |
| September 25 diagnostic | 0 | **1, unresolved** |
| Earlier September 29 qualification | 0 | 0, clean |
| This reviewed retry | 0 | **0, clean** |

All 41 historical hashes match, unrelated original demo files are unchanged,
and no local test worker remains. The one-use retry authorization is consumed.
**Stopped for review; no second allocation or further integration/deployment.**

## Previous qualification record

The following section records the earlier September 29 attempt and its then-current
uncertainty; the reviewed retry above identifies the failing room predicate.

## September 29 correction and qualification — blocked, stopped for review

The two reported adapter gaps are implemented and covered locally. **One new
provider-free real session ran and failed the unchanged four-second readiness
budget. The second session did not run.** The new run has verified cleanup and
zero new debt; both historical debts remain unresolved and unchanged. No acceptance
receipt or bridge material was returned. No deployment, production routing,
provider session, FaceTime call, commit, push or publication occurred.

### Fixes and failure-before evidence

- **Explicit dispatch topology:** CreateRoom now supplies exactly one pinned-SDK
  `RoomAgentDispatch` with the fresh intended name/deployment, signed operation
  metadata and `JRP_NEVER`. The combined room/dispatch side effect is journaled
  before the RPC. The adapter never follows it with CreateDispatch; the live
  harness forbids that call. Discovery requires the exact metadata digest,
  name/deployment/room and immutable dispatch ID; unexpected records (including
  the observed unnamed record), jobs, restart policy or participants fail closed.
  Exact job, nonce, worker, publication and deadline checks remain enforced.
- **Durable cleanup:** append-only receipts record authenticated cancellation,
  exact job-ended or unassigned-tombstone evidence, dispatch deletion ACK, room
  deletion ACK and verified absence. Identity fields and prior audit prefixes
  cannot be rewritten. Recovery with these receipts needs no retired live hook.
  Verification polls within a separate eight-second cleanup window; individual
  management RPCs also have bounded timeouts (room one second, dispatch two).
  An in-flight RPC can finish after the polling window; acceptance deadlines are
  never extended. Foreign SID/marker replacements are not deleted, and uncertain
  create operations remain unsettled even when room inventory is empty.

[Failing-before output](ADAPTER_QUALIFICATION_RED.txt) shows two failures:
CreateRoom omitted `agents`, and acknowledged deletion followed by stale inventory
left phase `ready` rather than `clean`. Both pass after implementation. New tests
cover combined intent-before-effect, no second explicit dispatch, unexpected
records/jobs/publishers/target/restart policy, late assignment and cancellation,
unassigned tombstones, reopen after worker shutdown, delayed visibility,
management errors, foreign replacement, durable terminal evidence before a
management failure, and append-only evidence. Historical ambiguous receipts
remain covered.

The supported SDK exposes `CreateOptions.agents`. LiveKit's
[dispatch documentation](https://docs.livekit.io/agents/server/agent-dispatch/)
recommends explicit dispatch. Its open-source
[room implementation](https://github.com/livekit/livekit/blob/master/pkg/rtc/room.go)
uses configured room agents instead of the unnamed fallback and terminates
DeleteDispatch jobs asynchronously; deletion ACK alone is therefore insufficient.
The hosted revision is unknown. In this live attempt, exactly the configured
named record appeared, with no unnamed fallback.

The [room-specific ListDispatch implementation](https://github.com/livekit/livekit/blob/master/pkg/service/roommanager.go)
returns room-not-found when the room is unavailable. The adapter accepts only a
typed SDK `ServerError` with HTTP 404/Twirp `not_found` from that exact read, and
only alongside exact terminal/deletion receipts plus scoped room absence. It is
corroboration, never independent settlement. Bare 404s, auth errors, timeouts and
absence without receipts retain debt. [Read-only service observations](ADAPTER_QUALIFICATION_ABSENCE_SEMANTICS.json)
returned typed 404/not_found in 1,112 and 1,063 ms; this explains why the previous
one-second dispatch-management timeout obscured that response. Dispatch reads
and deletion now allow two seconds, with preparation still checked against its
original deadline.

### New real attempt and remaining blocker

[Attempt 1](ADAPTER_QUALIFICATION_ATTEMPT_1.json), Node **22.23.2**, ran at
2026-09-29 20:48 UTC with fresh run/boot
`134ef9a4-1e92-4046-a815-93a7f799d982` and worker
`chert-connector-test-134ef9a4-1e92-4046-a815-93a7f799d982`.

| Observation | Result |
| --- | --- |
| Idle checks | 0 new rooms/jobs |
| Room-triggered dispatch | 1 CreateRoom, ACK in 330 ms; **0 CreateDispatch calls** |
| Intended dispatch/job | `AD_VLjz9YA7CzBq` / `AJ_upmiJjUP7DFP` |
| Publication | intended identity, one unmuted audio track; hook reported ready |
| Decision | decline `deadline_exceeded`, 4,030 ms |
| Full exact readiness | not established within the deadline |
| Bridge / authority acceptance / normal terminal delivery | not reached |
| Cleanup | exact ended receipt, dispatch/room deletion ACKs, scoped absence saved; phase `clean`, zero new debt |
| Worker | stopped, exit 0 |
| Provider sessions | 0 |
| Second qualification slot | unused and blocked by first-run failure |

The immediate final harness inventory reported one room after the adapter had
observed absence. That count-only snapshot cannot distinguish stale visibility
from a replacement. No additional deletion was attempted. A subsequent
[scoped read](ADAPTER_QUALIFICATION_POST_ATTEMPT_INVENTORY.json) found zero rooms
and typed not_found. [Reopened-receipt verification](ADAPTER_QUALIFICATION_RECOVERY_1.json)
with the worker stopped confirmed settlement and absence with **zero hook calls**.
The final audit records each run independently.

The readiness failure snapshot contains matching job/worker/participant/track
IDs but omits job room and participant nonce/job attributes. It does **not** prove
which remaining predicate failed or when every condition first became true.
No check was relaxed on that basis. A local follow-up adds boolean-only diagnostics
for every readiness predicate, with redaction tests, so a future reviewed attempt
can identify the exact mismatch without logging raw metadata or credentials.
That diagnostic change and immediate abort-cancellation receipt persistence were
validated locally after the attempt; neither was exercised in another real run.

### Historical runs preserved separately

| Run | Room | Current resource/debt state | Recovery decision |
| --- | --- | --- | --- |
| Original | `45726c6f-633d-4912-b0b6-450db9b6a47b` | absent; `dispatch_pending`; create pending; 1 debt | no original dispatch ACK or sufficient send/settlement evidence; retain unresolved |
| September 25 diagnostic | `72ff56d4-1fd4-4fd8-9b60-078599d276a0` | absent; `dispatch_ack`; 1 debt | saved summary reports ended/deleted, but lacks complete exact operation/nonce/marker terminal evidence and durable deletion receipts; no retrospective fabrication |
| September 29 qualification 1 | `50fe326c-2be7-4a11-9384-3a3342ca91ec` | absent; `clean`; 0 debt | exact durable terminal/deletion evidence and reopened verification |
| Qualification 2 | none | not allocated | first run failed; gate refuses allocation |

[Baseline hashes](ADAPTER_QUALIFICATION_BASELINE.json),
[preflight audit](ADAPTER_QUALIFICATION_PREFLIGHT_INVENTORY.json) and
[final audit](ADAPTER_QUALIFICATION_FINAL_INVENTORY.json) preserve all historical
JSON/text evidence and both old local journals byte-for-byte. The audits are new
observations, not edits to old receipts. Existing unrelated demo changes are
unchanged. Normal connector admission continues to block on debt; the two-slot
exception exists only in the explicit test harness and uses exclusive, fsynced
reservations before effects. It cannot reuse a consumed or failed slot.

### Final local validation

CLI **161/161 tests**, typecheck, lint, build and the 20-call synthetic proof pass
on both **Node 22.23.2 / npm 10.9.8** and **Node 24.14.0 / npm 10.8.2**.
Each synthetic proof records 20 commits/deletions and zero resources/debt.
Logs: [Node 22](ADAPTER_QUALIFICATION_NODE22.txt),
[Node 24](ADAPTER_QUALIFICATION_NODE24.txt).
Commands, with the corresponding explicit Node directory first in PATH:

```sh
node --version
npm --version
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
git diff --check
```

A Node 24 rerun exposed an existing test-observer race: a replaced socket's delayed
close could satisfy the current-generation rejection wait. The assertion now
awaits the exact current socket, with no protocol relaxation. The failed run is
retained in [initial Node 24 output](ADAPTER_QUALIFICATION_NODE24_INITIAL.txt).

The isolated demo's **97/97 checks pass on Node 22**; all three hook/probe modules
pass syntax checks on both runtimes. On Node 24, the relevant isolated provider-free
probe has **6/6 passing tests**. The optional broader demo run has 81 passes and
two failing test files: pre-existing startup mocks spread a CJS `module.exports`
export into Node 24's experimental module-mock generator, causing a syntax error
before those files' tests run. No provider calls occurred and unrelated demo tests
were not changed. Node 24 full demo compatibility is **not qualified**.
[Demo Node 22](ADAPTER_QUALIFICATION_DEMO_NODE22.txt),
[demo Node 24 failure](ADAPTER_QUALIFICATION_DEMO_NODE24.txt),
[probe Node 24](ADAPTER_QUALIFICATION_PROBE_NODE24.txt).

Whitespace is checked for tracked and untracked source/docs, including new files.
No dependency or lockfile change was needed. CLI baseline remains
`54db70ba5f18d2cc8d36053352186af6c1287847`; work remains uncommitted in the existing
private proof tree. Demo edits are confined to the isolated connector worker's
operation tombstone/dispatch identity in `/Users/garygao/demo-agent-0-connector-test`.

### Review boundary

Dispatch isolation and durable acknowledged cleanup now have local regression
coverage and live evidence, but the full provider-free acceptance path is still
blocked. Review the exact readiness predicate/SDK field contract and inventory
consistency observations before authorizing any further real attempt. Both old
cleanup debts require separate supported evidence or an explicit administrative
resolution; they are not silently cleared. Compare-SID-and-delete remains a
non-atomic service limitation under concurrent privileged writers. Lost creation
or terminal acknowledgments can still require manual recovery.

Audio publication proves neither decoded audio, conversation, FaceTime nor Muse
readiness. Real Chert authority, production enrollment/routing, hosted integration,
provider hooks, packaging/publication and the separate SDK remain outside this
work. **Stopped for review; no second session or further integration is started.**

## Historical record through September 25

The following earlier results are preserved as history; current status is above.

Date: 2026-09-25. **Recommendation: do not enable acceptance or deploy.**
The owner-authorized diagnostic exception was consumed by exactly **one new
application dispatch**. The intended worker ran and published silent audio, but
full readiness failed at the unchanged preparation deadline. There was **no
acceptance receipt or returned bridge material**. Cleanup stopped the worker and
acknowledged room deletion, but did not finish the adapter's verification path.
Final scoped reads show **zero old-run rooms and zero new-run rooms; two retained
cleanup debts, one per run**. Neither debt has been erased or reclassified.

## One-use diagnostic exception — 20:38 UTC

The owner's latest instruction explicitly authorized one isolated diagnostic
attempt despite the original unresolved dispatch. This superseded the earlier
allocation prerequisite **only for this attempt**, not the settlement rules.
The original operation remains unresolved. No production admission rule changed.
The test-only reservation in `tests/fixtures/diagnostic-run.ts` writes an exclusive,
fsynced authorization record at `.local/adapter-diagnostic-exception-20260925.json`
before network/worker effects. It retires the original identity from test reuse,
links old evidence hashes to a fresh directory, and refuses reuse. The old worker
name was never recorded and is not reconstructed or invented. No previous local
probe worker was running. Default invocation still refuses retained state; a
failed dispatch consumes the one-use dispatch budget. SDK failover remains off,
job restart remains `NEVER`, and no harness redispatch occurred.

Original bytes and eight historical evidence files were hashed before the test
and checked afterward: [preflight](ADAPTER_DIAGNOSTIC_PREFLIGHT.json),
[final inventory and hash comparison](ADAPTER_DIAGNOSTIC_FINAL_INVENTORY.json).
The original journal, receipt and result hashes remain:

| Original file | SHA-256 |
| --- | --- |
| journal.json | `277d88baa5176fc9cb474a1399359556cdd429bfcef4f7361a48a14035e3bc40` |
| adapter.json | `bab82981f060e4389c96d5ff51a2861aa9f58bc8e85ef1dbc1cc06b2b7acf088` |
| result.json | `f966944f022246f14b7df9dfe0d2eaa2ba0d4f1d106f1f4fe4bd0e8781d723be` |

### Runtime, topology and new identities

Both harness and worker explicitly ran **Node v22.23.2**. The worker is forked
with the harness's exact `process.execPath` and reports `process.version` over
IPC; the harness requires an exact match. The existing supported-runtime guard,
timeout floor and sanitized operation audit were active before service effects.
Pinned SDK/agents/RTC versions remain **2.19.0 / 1.8.0 / 0.13.35**.

| Identity | Recorded value |
| --- | --- |
| Run / boot | `1c7e0f02-de8c-4932-963f-05c9b994327e` |
| Worker name | `chert-connector-test-1c7e0f02-de8c-4932-963f-05c9b994327e` |
| Deployment | `chert-test-1c7e0f02-de8c-4932-963f-05c9b994327e` |
| Connector instance | `5d3c7f7b-c5b2-411a-b0cc-822d78e5c804` |
| Logical operation | `98084e96-5778-4721-8110-6601358270a8` |
| Room / acknowledged SID | `72ff56d4-1fd4-4fd8-9b60-078599d276a0` / `RM_uciFtuAa76x9` |
| Explicit dispatch | `AD_6AezaiqS2SMN` |
| Actual job / worker | `AJ_k9ReeEAnwevv` / `AW_enTiXpfirYFy` |
| Participant / audio track | `feb2459d-b2c3-4945-9bf4-b1be23918102` / `TR_AMU559x4toJjk5` |

Owner-only local receipts are retained in
`.local/adapter-diagnostic-1c7e0f02-de8c-4932-963f-05c9b994327e/`.
The adapter durably maps owner/operation/room/SID to the explicit dispatch ID.
The diagnostic result additionally preserves the service dispatch-to-job-to-worker
and participant mapping. `actualJob` was not added to the adapter receipt because
its full readiness predicate never passed. [Attempt](ADAPTER_DIAGNOSTIC_ATTEMPT.json)
and [new evidence hashes](ADAPTER_DIAGNOSTIC_EVIDENCE.json) preserve that distinction.

Real components: development LiveKit management API, isolated local SDK worker,
job execution, RTC participant and audio publication. Synthetic components:
loopback Chert authority, call request, relay/WebSocket transport and lifecycle.
The original webhook receiver and manual demo command were not used. No model,
avatar, Muse, OpenAI or LemonSlice session was constructed by this probe.

### Observations and failure attribution

- Authenticated idle availability passed after **439 ms** of polling; three
  subsequent samples remained available. Idle checks observed **zero new rooms
  and zero worker jobs**. Two unrelated baseline rooms were left untouched;
  their SIDs/metadata matched at the harness's final inventory and were not logged.
- Exactly **one application room-create invocation and one explicit dispatch
  invocation** occurred. Both were acknowledged: room about **292 ms**, dispatch
  about **30 ms**. The operation audit retains exact inputs **3932.928958 ms**
  and **3621 ms**, each floored to **3000 ms** for the pinned SDK. This fixes the
  reproduced fractional-timeout path without extending the preparation budget.
- Service observations showed the intended explicit dispatch with exactly one
  running job, the intended worker and participant, and one unmuted audio track.
  The authenticated worker reported `ready` with the same job and track SID.
- The same room also contained `AD_BgynxCE8aRF5`, with empty agent name and no jobs.
  Thus **two service dispatch records** existed despite one application dispatch.
  The adapter's `dispatches.length === 1` guard prevented readiness. The call
  declined with **`deadline_exceeded`**, returning after **4032 ms** including
  transport overhead. The 4000 ms preparation, 5000 ms decision, 60000 ms resource
  and 90000 ms worker-watchdog limits were unchanged.
- This proves a blocking cardinality mismatch in the observed inventory. It does
  not prove every other live readiness predicate would have passed: the failure
  snapshot does not retain the nonce comparison or all signed metadata. Offline
  regression supplies fully matching data and proves the extra empty row alone
  blocks acceptance. No readiness predicate was weakened to ignore that row.
- LiveKit's [dispatch documentation](https://docs.livekit.io/agents/server/agent-dispatch/)
  describes unnamed automatic dispatch. Its public [room source](https://github.com/livekit/livekit/blob/master/pkg/rtc/room.go)
  (`createAgentDispatchesFromRoomAgent`) supplies an empty default dispatch when
  no room agents are configured. That explains a plausible origin of the extra
  record; the hosted server revision was not established, so exact service-side
  provenance is not claimed. The extra row's job list was empty in the saved
  observation; it must not simply be ignored as harmless future capacity.
- There was **no connector accept decision, returned call-scoped bridge token,
  synthetic authority acceptance commit, or acceptance receipt**. The harness's
  success-only receipt delivery and token-signature/scope assertions were not
  reached. They are not live evidence. Track publication and worker `ready` are
  not decoded audio, conversation, FaceTime or Muse readiness.

The sanitized harness error is `Error / unclassified` from its own decline
wrapper; the precise decision reason is separately retained as
`deadline_exceeded`. The SDK room and dispatch audits show acknowledgments, not
an SDK timeout error. Exact operation timestamps, timeout inputs, phases and
available service identifiers are preserved without tokens, headers, raw request
bodies or signed metadata.

### Cleanup and separate inventories

Deadline cancellation and a synthetic local terminal lifecycle triggered ordinary
ownership-checked cleanup. No success-path terminal delivery/ack through the relay
was reached. The worker hook later reported the exact job **ended and cancelled**;
this hook is emitted after SDK disconnect and track/source closure. The harness
recorded one successful room-delete call, but the adapter remained `dispatch_ack`
and its immediate final name-based room inventory still counted **one** room.
It did not write `clean`. That last count did not record a SID/marker, so delayed
visibility versus replacement cannot be distinguished from that snapshot.

The worker then exited **code 0**. At **20:39:27.859 UTC**, narrowly scoped
`ListRooms([exact room])` returned **zero** for both original and diagnostic rooms;
`ListDispatch(exact room)` returned **404 / not_found** for both. No additional
cleanup mutation was attempted against an absent resource. No local probe worker
or harness remained. All old evidence and the original demo's unrelated document
hashes remained unchanged.

| State at final scoped inventory | Original run | New diagnostic run |
| --- | --- | --- |
| Observed matching rooms | 0 | 0 |
| Exact remote dispatch/job inventory | Unknown (404) | Unknown (404); matching job-ended observation retained |
| Adapter phase | dispatch_pending | dispatch_ack |
| Create pending | true | false |
| Cleanup debt | **1** | **1** |
| Verified complete cleanup | No | No |

A local regression models an acknowledged delete followed by one stale room
observation and a dispatch-list 404. Even with a matching ended hook, the existing
inspection path returns unknown and retains debt. This demonstrates a cleanup
contract gap compatible with the run, not proof of the hosted consistency model.
The process-local hook cannot be recovered by restarting the retired worker.
Neither elapsed lifetime nor present absence is used to clear debt. **Total debt
remains two; no operation is administratively settled by this exception.**

### Changes, validation and review gate

Only the test harness/fixtures, focused regressions, read-only inventory runner,
results artifacts and isolated worker runtime IPC changed for this exception.
Production connector/adapter admission and settlement rules are unchanged.
The five new tests cover default refusal and immutable originals, one-use
exception, missing original evidence, a failed dispatch consuming the single
attempt, the extra unnamed dispatch, and incomplete cleanup evidence (the first
case covers multiple assertions).

On Node v22.23.2: **143/143 CLI tests**, typecheck, lint and build pass. The final
[synthetic transport proof](ADAPTER_DIAGNOSTIC_FINAL_TRANSPORT_NODE22.json) has
20 commits, 20 fake rooms/jobs/providers, 20 deletions, **zero resources and debt**.
The isolated demo has **97/97 passing tests** plus syntax checks of all three
hook/worker modules. These checks are independent of the failed live outcome.
The earlier Node 24 validation below predates these harness changes; the new real
attempt used Node 22 only. No commits, pushes, publication, hosted or Mac changes,
production routing/database changes or modifications to the original demo occurred.

Next review should address (1) default-dispatch isolation using supported room
configuration or an explicit ownership model without ignoring potential jobs;
(2) durable job-ended/delete/absence evidence and bounded verification under
service visibility delay, without extending call deadlines; and (3) operation-
specific service evidence or an explicit administrative resolution for retained
debt. The old dispatch additionally lacks a service ID and original target/send
record, so it still needs service correlation to its acknowledged room SID/time
window or a separately reviewed administrative decision. The new one supplies
exact dispatch/job IDs for service investigation. No further allocation is
permitted by the consumed exception. **Stopped for review: no rerun, actual demo
profile integration, Muse work or deployment.**

## Historical investigation and first-attempt results

The sections below describe the earlier investigation and first failed attempt;
their historical test counts and single-debt statements predate this exception.

## Follow-up investigation — original operation remains unresolved

The follow-up used explicit Node **22.23.2** and **24.14.0**. It made **no new
allocation, dispatch, worker launch or session**. The conditional second real
audio test was not run because its settlement prerequisite is still unmet.
Current checks: **138/138 CLI tests on both runtimes, 97/97 isolated demo tests**;
typecheck, lint, build and both synthetic transport proofs pass.

### Retained operation and immutable evidence

The original logical operation is `19263778-3dd9-4f3a-b025-2cd682c7baa8`, with room
`45726c6f-633d-4912-b0b6-450db9b6a47b` and acknowledged SID `RM_mrfsEGe5SAUK`.
The connector entry is terminal, `create_pending=true`, `cleanup_debt=true`,
`reconcile_debt=false`. The adapter receipt is `dispatch_pending` with a room SID,
but no dispatch ID, actual job ID, target/project binding, exact timeout, original
error class/code, SDK request ID or evidence that fetch was or was not invoked.
The adapter entry snapshot still says `intent`; it records the initial ownership
intent, not a contradictory current connector state.

The three original files were read without mutation. Their SHA-256 hashes, exact
allowlisted identifiers, missing evidence and offline reproduction results are in
[ADAPTER_INVESTIGATION_EVIDENCE.json](ADAPTER_INVESTIGATION_EVIDENCE.json).
Neither newer diagnostic fields nor a fabricated target/acknowledgment were added
to those historical files. The original attempt and inventory artifacts also
remain unchanged. There is still **one unresolved cleanup debt**.

### Proven bug versus unproven attribution

The [offline investigation runner](../tests/adapter-investigation.ts) and
[SDK regressions](../tests/adapter/sdk.test.ts) replace every fetch with a stub;
they load no account environment and make no network requests.

The original implementation passed `budget.remaining(true) / 1000` to SDK 2.19.0.
The pinned `AgentDispatchClient.createDispatch` serializes its request and awaits
local token signing. `TwirpRpc.request` then constructs the request and calls
`AbortSignal.timeout(timeout * 1000)` **before calling fetch**. A remaining budget
of **3588.123 ms** throws `RangeError / ERR_OUT_OF_RANGE` with **zero fetch calls**.
An integer **3588 ms** invokes the stubbed fetch once and returns a mock dispatch.
This proves the fractional-timeout defect and its ordering in the tested pinned
SDK on the supported runtimes. It does **not** prove the original input was fractional.

The historical artifact stores only rounded durations, including **411 ms total
preparation**; neither the exact argument nor the monotonic samples were saved.
A deterministic Budget counterexample gives integer and fractional remaining
values under the same rounded 411 ms elapsed observation. That total also includes
transport and persistence time, so it cannot reconstruct the dispatch argument.
The retained phase was persisted before invoking the API. It is not a send receipt.

Other paths remain compatible with the evidence:

| Possibility | What is established |
| --- | --- |
| Fractional timeout rejected before fetch | Reproduced offline; original input/error absent |
| Integer timeout, service rejects request | Reproduced with a mock HTTP 400; original response code absent |
| Remote accepts, response is lost or cannot be parsed | SDK can reject after fetch; original send/result evidence absent |
| Other local signing/serialization/persistence failure | No original diagnostic discriminates this; not claimed as cause |

The successful room call establishes a room acknowledgment, not dispatch-service
acceptance or permission. Both SDK clients normalize `ws(s)` to `http(s)`, so no
fixed missing-URL-normalization defect was found. The source-generated deployment
uses a UUID-based label shorter than 63 characters, so an inherently malformed
label is not established either. Node 20 was outside this test's chosen matrix,
but the SDK declares Node >=19; that mismatch does not prove no request was sent.

### Narrow service check and final inventory

At **20:13:04 UTC**, Node 22.23.2 made only `ListRooms([exact room])` and
`ListDispatch(exact room)` using the configured development credentials. Results:
**0 matching rooms**, and **HTTP 404 / `not_found`** for dispatch listing.
[ADAPTER_INVESTIGATION_INVENTORY.json](ADAPTER_INVESTIGATION_INVENTORY.json)
contains the sanitized status/code and current project fingerprint. The old receipt
has no original project fingerprint; the current configuration is not retroactive
proof of that missing binding. No arbitrary project rooms were enumerated or modified.

This is current absence, not a server-side receipt closing the original request.
The documented [dispatch API](https://docs.livekit.io/reference/agents/agent-dispatch-service-api/)
lists/deletes dispatch resources but supplies no documented lookup for this
unacknowledged client operation. `404`, elapsed lifetime, stopped worker and the
fixed bug cannot establish settlement. Final observed owned rooms: **0**; exact
remote dispatch/job state: **unknown**; local cleanup debt: **1**. A final
[20:22:14 UTC read-only check](ADAPTER_INVESTIGATION_FINAL_INVENTORY.json) returned
the same room count/404 and verified all three original file hashes unchanged.

### Fixes and auditable recovery for future proven pre-send failures

[Operation validation and diagnostics](../src/adapters/livekit-operation.ts)
now validate the exact supported test runtime before SDK use and validate endpoint/
credential presence before constructing the API. The harness and isolated demo
configuration both reject unsupported test runtimes before worker/service effects.
Timeouts are rounded down to whole seconds; subsecond/nonfinite budgets fail
locally. Conversion never increases the input budget; 4s/5s absolute deadlines
remain unchanged. The SDK still does not offer a caller-supplied cancellation
signal for these operations; ambiguous in-flight requests remain debt.

Only a failure generated by the adapter's own synchronous validation boundary
carries process-local proof that the SDK was not invoked. That proof binds the
operation kind, exact room and exact input budget. Similar Error/RangeError codes
from the SDK or network do not carry proof. No global fetch replacement or private
SDK patch is used in runtime code; fetch replacement is only an offline test seam.

The [receipt store](../src/adapters/livekit-receipts.ts) appends a strict, secret-free
operation audit: pending then acknowledged/not_sent/uncertain, timestamp, runtime,
exact input/effective timeout, and allowlisted error class/code. `room_not_sent`
and `dispatch_not_sent` require matching pending and validation evidence. Audit
history cannot be rewritten by `put`; memory advances only after persistence
succeeds. A persistence error disables settlement and further writes until reopen,
so a possibly completed rename cannot be overwritten from stale memory. A crash after pending but before durable validation evidence remains
uncertain. Unknown error messages, stacks, URLs, tokens, headers, metadata and
request/response bodies are never copied into the audit. The real harness exports
these phase diagnostics into its sanitized result on any future authorized run.

For a new proven-unsent dispatch, the room may already exist: recovery permits
settlement of the dispatch attempt, then deletes only the acknowledged owned room
and verifies absence before clearing debt. It does not need a worker cancellation
or shutdown receipt for a dispatch known never to have been invoked. Unsent room
creation needs no fabricated room acknowledgment. This path does **not** apply to
the original ambiguous operation, and no receipt/journal was deleted or edited to
make it apply.

The recovery regression first failed (`settled=false`) before the change, then
passed through failure, actual receipt-file reopen, simulated deletion failure,
exact verified cleanup and zero debt. Additional regressions cover a RangeError
after stubbed fetch retaining uncertainty, an unbound lookalike error, wrong
operation/room/budget proof, absent evidence preventing reclassification, append-only
audit, failed persistence retaining the prior memory/disk state, runtime checks,
and timeout rounding. Existing cleanup-settlement and duplicate-decision tests
remain passing.

### Required evidence or explicit administrative decision

To resolve the original operation technically, obtain **authoritative LiveKit
request/audit evidence**, bound to the original project, room name/SID, operation
metadata and the **17:25:15–17:25:17 UTC** attempt window, establishing either:

1. The original CreateDispatch was never accepted and cannot later execute; or
2. Its exact dispatch/job identifiers, completion/cancellation of that operation,
   and termination/absence of all owned effects with no further late effects possible.

An original local trace proving the exact request failed before fetch could also
resolve the send ambiguity, followed by ordinary ownership/absence verification;
no such trace was retained. Current API listing does not substitute for either
kind of evidence. A new recovery implementation must verify and preserve any
supplied evidence, rather than accepting a caller-provided `settled=true` flag.

If such evidence is unavailable, a different next step requires an **explicit
administrative risk decision**: acknowledge that this exact operation remains
unresolved and authorize a separately audited exception allowing one isolated test
while retaining its quarantined receipt/debt. That is not verified settlement,
not granted by this task's conditional test authorization, and no override or
waiver command was implemented or exercised. Do not erase the prior state to rerun.

### Follow-up validation

Executed with each runtime explicitly first in PATH: `npm run typecheck`,
`npm run lint`, `npm run build`, `npm test`, and
`npm run proof:transport -- --host 127.0.0.1 --json`.
Node **22.23.2 / npm 10.9.8** and **24.14.0 / npm 10.8.2** each pass **138 tests**.
Isolated demo Node 22: `npm run check` passes **97 tests**, plus syntax checks of
its three new hook/worker files. Each synthetic proof completes **20 commits**, with
zero fake surviving resources/debt:
[Node 22](ADAPTER_INVESTIGATION_TRANSPORT_NODE22.json),
[Node 24](ADAPTER_INVESTIGATION_TRANSPORT_NODE24.json).
The follow-up added ten CLI regressions and one demo runtime test. Dependency
pins are unchanged. The remaining sections below preserve the first-run history.

**Recommendation:** preserve admission blocking and get the exact settlement
proof or explicit administrative decision above. No new real session occurred;
real readiness, decoded audio, provider behavior, FaceTime and Muse remain
unverified. Stop for review before further integration or deployment.

## Scope and preserved work

CLI: main at `54db70ba5f18d2cc8d36053352186af6c1287847`, with the existing
uncommitted synthetic implementation. All 92 reviewed regressions remain intact.
Demo: main at `ccfe5136b660cf3294c07af9495afc8f1ee9f7b2`; its unrelated edits to
TECHNICAL_SUMMARY_LOG.md and docs/MUSE.md remain untouched. New demo files live in
`/Users/garygao/demo-agent-0-connector-test`, branch `codex/connector-adapter-test`
at that same commit. It shares the original demo's node_modules through a local
symlink, visible as untracked because the existing directory-only ignore pattern
does not hide a symlink. Nothing was staged, committed, pushed or published.
The original agent entrypoint, dependencies/lock, Muse implementation, receiver,
hosted deployment, project/line routing, database and Macs were not changed.

The [brief](ADAPTER_TEST_BRIEF.md) preceded implementation. The real path was:

```text
synthetic incoming authority -> signed loopback HTTP -> relay WebSocket
 -> Connector -> TypeScript LiveKitAdapter -> real LiveKit room/dispatch API
                                        -> signed loopback demo worker hooks
```

The worker used a unique random `chert-connector-test-*` name and `chert-test-*`
deployment. It could not match the existing `demo-agent-0` dispatch name. No old
receiver/demo command was used. Chert authority, receipt, lifecycle and reconnect
remain fixtures; no production Chert request or FaceTime call occurred.

## Implementation and SDK evidence

- [LiveKit adapter](../src/adapters/livekit.ts): exact room metadata/SID checks,
  one dispatch, signed metadata/deadlines, actual dispatch/job mapping, sole audio
  publication verification, call-scoped bridge token and conservative cleanup.
- [Authenticated hook](../src/adapters/livekit-hook.ts): domain-separated HMAC,
  challenge, sequence, observation age, project-host fingerprint, exact configured
  name/deployment/boot; failed authentication/sampling invalidates earlier health.
- [Adapter receipts](../src/adapters/livekit-receipts.ts): secret-free fsynced
  intent/ack/pending phases and SDK IDs, under the connector journal writer lock.
  Missing, old unbound, or wrong-target receipts fail closed. No inferred
  settlement from a rejected promise, process restart or absent room.
- [Connector](../src/runtime/connector.ts) now validates and forwards adapter
  bridge material instead of returning synthetic constants. Those constants moved
  to the fake agent. Protocol accepts bounded credential-free WSS URLs; tokens
  remain transient, never persisted. Health supports explicitly unknown connection
  state separately from an observed disconnection.
- [Real harness](../tests/livekit-proof.ts): explicit `--real` only, one attempt,
  unique target, no provider credentials passed to the worker, isolated launch,
  retained receipts, sanitized evidence, and a refusal to overwrite prior runs.
- [Demo hook guide](/Users/garygao/demo-agent-0-connector-test/docs/CONNECTOR_ADAPTER_TEST.md)
  links the new JavaScript ESM worker, control helper, probe entrypoint and tests.
  This is a new diagnostic profile using the demo's pinned runtime and existing
  preparation helper, not a claim that its current Muse profile meets this contract.

Installed types/source were inspected for ServerOptions requestFunc/loadFunc,
AgentServer id/activeJobs/drain/close, SDK `/` and `/worker`, JobContext job/workerId,
connect/shutdown callbacks, RoomService and AgentDispatch clients. No private
worker fields or undocumented worker events are used. The wrapper owns explicit
drain and a conservative single-use reservation; it never infers capacity from
deployment status. The pinned job runner disconnects before shutdown callbacks;
the probe also checks disconnected state before reporting end.

Official [server options](https://docs.livekit.io/agents/server/options/) documents
request/load hooks and local health. Public health alone lacks this application's
authentication, capacity and drain contract. Official
[dispatch documentation](https://docs.livekit.io/agents/server/agent-dispatch/)
describes name/deployment routing. The
[dispatch API](https://docs.livekit.io/reference/agents/agent-dispatch-service-api/)
provides create/delete/list and server-assigned IDs, not a generic uncertain-create
settlement receipt. Installed version behavior takes precedence over newer examples.

## Exact dependencies and runtimes

| Component | Pins / runtime |
| --- | --- |
| CLI runtime dependencies | livekit-server-sdk **2.19.0**, ws **8.21.3**, zod **4.6.5** |
| CLI tooling | TypeScript **6.0.2**, @types/node **24.13.6**, @types/ws **8.18.1**, ESLint **10.11.0**, typescript-eslint **8.70.1** |
| Demo | @livekit/agents **1.8.0**, @livekit/agents-plugin-openai **1.8.0**, @livekit/rtc-node **0.13.35**, livekit-server-sdk **2.19.0**, sharp **0.35.4** |
| Resolved protocol, both lockfiles | @livekit/protocol **1.51.0** |
| Final CLI matrix | Node **22.23.2** / npm **10.9.8** and Node **24.14.0** / npm **10.8.2**, macOS |
| Final demo checks | Node **22.23.2** / npm **10.9.8** |
| Initial real attempt | Shell selected Node **20.19.6** unintentionally; not a supported-runtime qualification |

The harness now rejects runtimes outside Node 22/24 before contacting LiveKit.
It was not rerun after that correction because cleanup settlement remains unknown.
No Linux/Windows, remote hook service, Cloud-hosted hook or Python matrix was run.

## Real-service evidence — one failed attempt

[Sanitized attempt](ADAPTER_LIVEKIT_ATTEMPT.json), from 17:25:15–17:25:17 UTC:

| Observation | Actual result |
| --- | --- |
| Initial project room inventory | 0 rooms |
| Authenticated worker availability after start | available; measured poll interval to availability **435 ms** (excludes initial process/IPC setup) |
| Three subsequent idle health checks | 0 new rooms, 0 application jobs |
| Room create invocation | 1, acknowledged in **300 ms**, exact marker/SID saved locally |
| Dispatch invocation | 1, no positive acknowledgment saved |
| Concurrent duplicate incoming requests | same decline, no second dispatch invocation |
| Decision | `preparation_failed`, after **411 ms** |
| Correct session/job/publication readiness | **not reached / not verified** |
| Committed acceptance, live lost-ack reconnect, full/draining state | **not reached**; local tests only |
| Adapter deletion invocations | 0; uncertain dispatch prevented unsafe clearance |
| Test worker | stopped by harness |
| Retained state | `dispatch_pending`, 1 cleanup debt; no retry |
| Provider work | no OpenAI/Muse/LemonSlice calls; probe contains no provider startup |

The artifact's `room_creates` and `dispatch_creates` are SDK **invocation counts**,
not proof that those many remote sessions/jobs exist. Final exact test-room count
was zero. At **17:27:03 UTC**, a separate read-only check on Node 22 again found
zero project rooms and zero exact test rooms. Listing dispatches for the absent
room did not produce usable evidence; it is recorded as **unknown**, not zero.
See [final inventory](ADAPTER_FINAL_INVENTORY.json). There were no pre-existing
rooms during this run, so live unrelated-room preservation is vacuous; foreign-room
protection is covered deterministically. No hosted demo management API was used.

The runtime error was deliberately reduced to stable diagnostics; the original
exception class was not retained. Investigation then independently reproduced a
concrete bug: SDK 2.19.0 passes `requestTimeout * 1000` directly to
`AbortSignal.timeout`. A fractional remaining budget produces `ERR_OUT_OF_RANGE`
before fetch. The regression failed with `3588.123 ms`, then passed after rounding
**down to whole seconds**; budgets below one second now fail before SDK effects.
This is a plausible explanation for the live failure, **not proven attribution**
to that earlier request. Future harness failures retain only allowlisted error
class/code. Neither the repair nor an empty inventory clears the original debt.

No deadlines were relaxed. There was no warming, refill, second real dispatch,
paid retry, Muse timing measurement or pre-prepared session counted as a cold start.

## Deterministic evidence and validation

Initial red regression: the connector returned `wss://synthetic.invalid` when an
adapter supplied another scoped URL/token. It passes after the adapter credential
boundary change. The SDK fractional-timeout regression also failed before its fix.

**128/128 CLI tests pass on both final runtimes**, including all original 92 and
36 new cases. **96/96 demo tests pass** on Node 22, including five new hook/entry
checks. No skipped or cancelled tests. New evidence covers:

- Missing/stale/disconnected/unknown/full/draining admission with zero API effects;
  bad MAC, challenge, replay, skew and project/name/deployment/boot mismatch.
- One mapped actual job/dispatch; duplicate delivery; uncertain reconnect preserving
  a potentially accepted room; exact terminal cleanup.
- Wrong nonce/participant/room/worker/job/dispatch, ended job, disconnected worker,
  wrong track, muted track and extra audio publisher rejected by readiness checks.
- Rejected room create with real receipt reopen; rejected dispatch with absent room;
  late acknowledged creation after cancellation; foreign room/SID protection;
  wrong-instance receipts; deletion failure and vanished room with running job.
- Demo signed target/deadline validation; cancellation before connect, after connect
  and before publication; ready publication and explicit track/source cleanup.

Mocks establish ordering and contracts, not service-side settlement, actual media
or native shutdown reliability. Readiness mismatch tests exercise the concrete
validation predicate; the original transport suite separately proves connector
rejection/cleanup behavior. Both cleanup-settlement and duplicate-decision review
regressions remain unchanged and passing.

Executed with each CLI runtime explicitly first in PATH:

```sh
npm ci --ignore-scripts                 # Node 22; 104 packages, audit 0 vulnerabilities
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
git diff --check
```

Demo: `npm run check` plus syntax checks of all three new `.mjs` source files.
The final Node 22 and Node 24 synthetic proofs each have **20 commits, 20 fake
rooms/jobs/providers, 20 deletions, zero surviving resources and zero debt**.
Artifacts: [Node 22](ADAPTER_TRANSPORT_NODE22.json),
[Node 24](ADAPTER_TRANSPORT_NODE24.json). These remain loopback/fake-provider timings;
they are not real LiveKit or avatar performance evidence.

## Contract gaps and remaining blockers

1. **Remote settlement:** failed create requests have no proven bounded settlement
   mechanism here. The single pending dispatch receipt remains in ignored,
   owner-only `.local/adapter-livekit/`, together with the connector journal.
   Do not delete it or reinterpret missing resources as settlement. Recovery needs
   service evidence tied to that exact operation or an explicitly reviewed
   administrative resolution before any further allocation.
2. **Ownership:** the proof's preassigned `entry.job` is a logical operation ID.
   LiveKit supplies a separate dispatch ID and actual job ID. The adapter persists
   and verifies that mapping. LiveKit room creation/deletion lacks an established
   exclusive-create / compare-SID-and-delete primitive. Random names plus exact
   prechecks and markers reduce collision risk but do not prove atomic ownership
   against a concurrent privileged writer. Production qualification must resolve
   that limitation, not relabel the logical ID as the service job.
3. **Recovery:** this test worker's reservation/cancellation/end receipts are
   process-local and single-use. Missing end receipts, rejected/unassigned jobs,
   worker crashes or management outages can leave debt indefinitely. Sidecar
   receipts rely on the connector's single-writer lock; distributed crash recovery,
   retention, target migration and a durable health/control service are unbuilt.
4. **Authentication/hosting:** test hooks are loopback-only, with an ephemeral
   shared HMAC key. Separate production health/dispatch/cleanup scopes, key rotation,
   remote TLS, fleet aggregation and hosted rollout are unverified.
5. **Actual media and provider lifecycle:** no real ready audio session completed.
   SDK track descriptors are structural publication evidence, not decoded audio,
   conversational response or FaceTime video. Private Muse rooms/provider sessions
   are outside this adapter's ownership contract. The existing Muse cold-start
   deadline mismatch remains unchanged and separate.

## Minimum agent changes and next slice

For a provider-free named agent, add a server-level authenticated health publisher
that composes request/load/drain policy; signed metadata validation at request and
job entry; exact job/room/participant/nonce/publication readiness; cancellation and
absolute/monotonic deadline checks before effects; and exact shutdown/settlement
receipts for every resource the agent can create. Preserve JavaScript ESM where
used. No HTTP receiver for Chert calls or automatic agent launch is needed.

For the existing demo's actual classic/Muse profiles, the probe is insufficient:
compose those hooks around their real initialization and expose durable cleanup
for model/render/provider effects, including late completions. Do not treat the
existing `byor.ready` attribute or a room join as the stronger correlated contract.

Next: review and resolve the retained dispatch operation and ownership/recovery
contract, then authorize one new isolated audio session on the pinned supported
runtime. Only after exact readiness and verified cleanup pass should real Muse
hooks or hosted transport be considered. **Stopped for owner review; no further
integration, deployment or allocation follows from these local passing tests.**
