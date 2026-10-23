# LiveKit adapter test brief

Written before adapter implementation, 2026-09-25. This user-authorized slice
supersedes the historical synthetic-only restrictions for this bounded test.
No commits, pushes, deployment, receiver/routing/database/Mac edits or FaceTime.

## Baseline and topology

CLI main at 54db70ba5f18d2cc8d36053352186af6c1287847 contains the uncommitted
92-test proof; retain all regressions. Demo main at
ccfe5136b660cf3294c07af9495afc8f1ee9f7b2 has unrelated TECHNICAL_SUMMARY_LOG.md
and docs/MUSE.md edits. Demo changes go in the isolated
`/Users/garygao/demo-agent-0-connector-test`, branch codex/connector-adapter-test.
The outbound-video and chert-facetime checkouts are read-only references.

Demo pins: @livekit/agents 1.8.0, @livekit/agents-plugin-openai 1.8.0,
@livekit/rtc-node 0.13.35, livekit-server-sdk 2.19.0, sharp 0.35.4.
Connector adds exactly livekit-server-sdk 2.19.0; retains TypeScript 6.0.2,
ws 8.21.3, zod 4.6.5 and existing tooling pins. Primary test Node 22.23.2 /
npm 10.9.8 matches demo; also run CLI Node 24.14.0 if locally available.

Real: existing authorized development LiveKit account; explicitly started local
Node agent from isolated demo checkout; SDK registration/health, room/dispatch,
participant/audio publication and deletion. Simulated: Chert authority, incoming
call, commit/lifecycle/reconnect; no production Chert traffic. Demo test entry
publishes silent audio with existing pinned native RTC, without constructing a
model, renderer or avatar. This validates transport/publication, not conversation,
Muse readiness, decoded media, FaceTime video or cold avatar timing.

## Supported-hook investigation

Inspect installed SDK types/source and official [server options](https://docs.livekit.io/agents/server/options/),
[dispatch](https://docs.livekit.io/agents/server/agent-dispatch/) and
[dispatch API](https://docs.livekit.io/reference/agents/agent-dispatch-service-api/).
Use ServerOptions requestFunc/loadFunc, AgentServer id/activeJobs/drain/close,
SDK loopback `/` and `/worker`, JobContext job/workerId/connect/shutdown callback,
RoomService and AgentDispatch clients. Do not use private worker state/events.
The application owns explicit drain and a conservative one-session reservation.
Authenticated challenge replies bind project URL fingerprint, unique name,
deployment and test boot instance. Missing SDK evidence stays unknown.

Known mismatches to investigate, not conceal: LiveKit assigns dispatch/job IDs
(the proof preassigns a logical job ID); createRoom is not exclusive creation;
create RPC errors have no operation-settlement API; room absence cannot settle
an uncertain create; public health has no authentication/drain/capacity contract.
Use distinct logical operation and actual SDK identifiers in owned receipts.
Disable SDK failover and job restart. Positive acknowledgments may establish
successful requests; failed/unknown requests retain debt even after empty lists.

## Failure hypotheses and criteria

- Idle startup and repeated health create zero rooms/jobs/provider sessions.
- Missing/stale/disconnected/full/draining/wrong-instance health declines before
  effects. Health is authenticated and challenge-bound, never deployment status.
- One fresh request dispatches once into an owned room. Readiness must match
  ownership, nonce, actual service job/dispatch, participant and sole unmuted
  required audio track; malformed/wrong/missing publications fail closed.
- Absolute 4-second preparation/5-second decision and cancellation checks precede
  every allocation/provider step; no deadline extension for test success.
- Duplicate delivery shares one dispatch; lost commit ack/reconnect preserves
  potentially accepted media. Existing 92 regressions remain passing.
- Late/rejected creation and process restart preserve unsettled debt. No blind
  retry; failed deletion/foreign metadata/unknown inspection cannot clear debt.
- Terminal cleanup verifies exact ownership, dispatch removal, job shutdown and
  room absence. Unknown private/provider resources remain unsupported.

Use deterministic controlled promises for races before real allocation. Record
an initial failing regression before implementation. Full CLI build/typecheck/
lint/tests/synthetic proof and relevant demo checks must pass; mock evidence
and actual service observations must be separately labeled.

## Ownership, limits and cleanup

Random test-specific dispatch name/deployment/boot; never `demo-agent-0`.
Random connector room plus exact metadata marker and SID; no prefix sweeping.
At most one real dispatch per explicit run, capacity one, resource lifetime
60 seconds maximum and a 90-second harness watchdog. No retry after an uncertain
create, no paid sessions, no background warming/refill. A control-only sentinel
room may be created as an independent test-owned resource to prove noninterference;
it gets its own exact cleanup receipt and is never dispatched.

Persist secret-free connector/adapter receipts before effects in ignored
owner-only local state. Only environment loads the existing authorized LiveKit
credentials; raw SDK errors/logs/tokens/metadata are not printed or archived.
Use a separate ephemeral HMAC key for local health/job hooks. Explicit worker
startup belongs to the test harness, never the customer connector runtime.

On termination revoke job permission, remove only exact acknowledged dispatch,
wait for job shutdown evidence, delete only matching room SID/marker, verify
absence, and stop the isolated worker. Any ambiguous creation or unverifiable
cleanup stops further allocations and retains receipts. Inspect unrelated room
IDs without writing them to results; never delete them or hosted demo sessions.
Muse is not needed for this first capability test. If audio-only proves insufficient,
report that boundary rather than silently start paid providers or use the receiver.

## Follow-up investigation — 2026-09-25

Before further implementation or allocation: preserve hashes and bytes of the
original journal, adapter receipt and result. Reproduce the exact pinned SDK's
fractional-timeout path with fetch replaced by a counting stub (no network).
Test both integer and fractional Budget outcomes; rounded historical timings
cannot substitute for an unrecorded timeout/monotonic sample. Query only the
original room's inventory/dispatch listing, retaining safe error class/code/status.

Hypotheses for local repairs: (1) our own synchronous validation can fail after
`*_pending` is recorded yet before the SDK is invoked; capture a branded,
operation-bound pre-send result and append its evidence, permitting ordinary
verified cleanup on reopen; (2) a lookalike SDK/network RangeError must remain
uncertain; (3) invalid runtime/configuration must fail before external effects;
(4) diagnostics must retain phase, class/code and actual timeout without raw
messages, bodies, tokens or headers. Preserve the original ambiguous receipt;
new bookkeeping cannot retroactively certify it. Tests must include prior room
cleanup after a proven unsent dispatch and retained debt after network failures.

A new real session is conditional on verifiable original settlement. Missing
room, 404, elapsed time and stopped worker are insufficient. If the evidence is
incomplete, deliver diagnosis/recovery requirements and all independent checks,
with no second allocation and no administrative override inferred from this task.

## September 29 corrective qualification

The owner authorizes implementation and up to two fresh provider-free sessions,
sequentially gated on a fully successful first run with zero new debt. Historical
journals and evidence remain immutable and quarantined. No production admission
exception is introduced.

Failure hypotheses:
1. CreateRoom without agents installs an unnamed automatic dispatch. Adding an
explicit dispatch afterward leaves two potential job sources. Configure the sole
intended RoomAgentDispatch in CreateRoom (SDK 2.19.0 supports agents, deployment,
metadata and restartPolicy), journal this combined side effect before sending,
and never issue a second CreateDispatch. Retain strict inventory/readiness
validation; an unexpected unnamed record, job or publisher must still fail closed.
2. DeleteRoom acknowledgment can precede ListRooms visibility. Losing the live
hook after job shutdown makes recovery impossible because the prior adapter never
saved terminal or deletion evidence. Append exact authenticated cancellation/job
terminal evidence and deletion acknowledgments durably as observed. Poll scoped
absence within a separate bounded cleanup budget. A typed room-specific Twirp
not_found is only corroboration after acknowledged operations and terminal proof;
arbitrary HTTP errors and absence alone never settle uncertain creation.

Tests first: SDK serialization of explicit room topology; one room-triggered
dispatch and zero explicit redispatch; unexpected inventory/jobs/publishers; late
assignment/cancellation; delayed deletion visibility; reopened receipt with worker
stopped; foreign replacement; unavailable APIs; uncertain creation. Preserve all
old run hashes, evaluate historical debts independently, and record any recovery
as a new event without inventing missing acknowledgments.

Sources: [dispatch guide](https://docs.livekit.io/agents/server/agent-dispatch/),
[room service API](https://docs.livekit.io/reference/other/roomservice-api/), pinned
SDK RoomServiceClient CreateOptions.agents and protocol RoomAgentDispatch, and
[LiveKit room implementation](https://github.com/livekit/livekit/blob/master/pkg/rtc/room.go)
(createAgentDispatchesFromRoomAgent, DeleteAgentDispatch). The open-source server
explains the observed unnamed default and asynchronous job termination; its exact
revision is not evidence of the hosted service revision.

Qualification outcome: the first fresh session used one configured named
dispatch and zero explicit CreateDispatch calls, but did not satisfy the exact
readiness predicate before four seconds. No second allocation is permitted after
that failure. Durable exact terminal/deletion receipts and a reopened-receipt
check establish zero new debt; both historical debts remain unresolved. The
saved failure snapshot cannot identify the failing job-room/attribute predicate.
Boolean-only per-predicate diagnostics were added and locally tested after this
attempt; no readiness check was weakened and no further real session ran.

Final results and per-run audits are in ADAPTER_TEST_RESULTS.md. Newly recorded
red-test logs retain their failure content with trailing whitespace normalized;
all pre-task historical evidence is unchanged.

## Room-correlation correction (local implementation only)

Hypothesis: the nested Job.room is an optional listing field, so requiring its
name rejects a correctly bound job when the service omits it. A contradictory
nonempty or explicitly empty nested room must still fail. The room binding must
instead require the owned room-scoped AgentDispatch.room, exact dispatch/job IDs,
and the authenticated worker session's matching operation/room/marker/nonce and
SDK dispatch/job IDs. Reuse this contract for readiness and durable assignment.
The existing worker checks request.room and ctx.job.room against the signed spec
before publication; /ready binds SDK job/worker to the reserved session. No worker
changes are needed. Current room SID/marker ownership inspection remains required
before acceptance; no adoption from listing absence or room names alone.

Test before fix: SDK round-trip of omitted room with full correlated evidence must
prepare once and save the actual job/worker before minting bridge material. Test
wrong/empty nested room, missing/wrong hook dispatch, parent room, job/dispatch
IDs, signed session fields, foreign room SID, deadlines and cleanup. Existing
SDK round-trip diagnosis should now distinguish omission from contradiction.
No real allocation, credential loading, historical receipt edits or new run
authorization is included. Verify the full CLI Node 22/24 matrix and local demo
checks; preserve prior evidence hashes and update current results/README.
