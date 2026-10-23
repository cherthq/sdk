# CLI implementer handoff

Status: **Proposed — awaiting owner review**.
Prepared by `CLI_RESEARCH_AGENT` on 2026-09-25.

Read [PLAN.md](PLAN.md) for accepted product direction and
[RESEARCH.md](RESEARCH.md) for the evidence, architecture and proposed decisions.
This handoff does not authorize implementation, production access, enrollment,
deployment, paid sessions, npm publication or another agent. The research task
ends at owner review. After review, execute only the scope the owner approves.

## 1. Recommended first slice

Build a **local synthetic transport proof** in this repository, using a fake
control plane, loopback relay, connector and fake agent/resource manager. Exercise
an actual HTTP request → WebSocket request/response → HTTP response path, then a
separate commit receipt and acknowledged lifecycle stream. No Chert route,
database migration, LiveKit connection or provider integration belongs in this
slice. Estimated effort: two to three engineering days after contract review.

The proof should answer:

- Can one immutable request cross both transports, prepare once, and return in
  the original budget without reconnect/retry extending it?
- Can the authority reject old connections, expired/revoked ownership and another
  tenant's response before committing exactly one decision?
- Can a lost commit receipt, process restart or missed terminal event recover
  without dispatching again or deleting a possibly accepted call?
- Does the availability gate disable admission without any room/job/provider
  creation, while preserving already accepted work?

Use the architecture and version-1 shapes in RESEARCH sections 4–6. The fake
authority owns bindings, epochs, generations, absolute deadlines and committed
state. The relay routes; it must not become an independent call state machine.
Model authorization meaningfully with test credentials mapped to exact scopes,
not a client-supplied `project_id` accepted on trust. All test credentials are
obviously synthetic and unusable against any real service.

## 2. Start conditions and boundaries

Before editing, reread applicable AGENTS, inspect status/branch/HEAD and preserve
the existing staged documentation. This checkout was unborn on `main` during
research. Evidence checkouts include unrelated dirty work; the exact baseline
is in RESEARCH section 2. Do not reset or stage another person's work.

Create the local analyst brief required by PLAN's hypothesis workflow. State
the failure hypotheses, observable outcomes and test cases before behavior
changes. Roles can be combined; this handoff does not require spawning agents.
Keep the proof files in this repository. Other checkouts remain read-only unless
the owner separately approves a cross-repository slice.

Proposed file boundaries, subject to ordinary implementation judgment:

| Path to create | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json`, lockfile | Private prototype package, ESM TypeScript, explicit build/typecheck/test/lint scripts; reviewed dependency versions |
| `docs/TRANSPORT_PROOF_BRIEF.md` | Hypotheses, reviewed contract choices and scope |
| `src/protocol/v1.ts` and schema files | Exact message union, bounds, stable errors and canonical semantic digest |
| `src/runtime/deadline.ts` | Injected wall/monotonic clocks; immutable deadline conversion; cancellation propagation |
| `src/runtime/connector.ts` | Admission, deduplication, preparation, transient acceptance, committed/uncertain states and lifecycle receipt |
| `src/runtime/journal.ts` | Secret-free receipts, atomic persistence and recovery through a narrow storage interface |
| `tests/fixtures/control-plane.ts` | Synthetic HTTP authority, transactional commit model, binding/revocation and reconcile fixtures |
| `tests/fixtures/relay.ts` | Loopback-only WebSocket relay and signed internal request verification |
| `tests/fixtures/agent.ts` | Health publisher simulator, counted room/dispatch effects, delayed/cancelled effects and precise deletion |
| `tests/transport/` | Deterministic state/race tests plus actual loopback HTTP/WebSocket smoke tests |
| `docs/TRANSPORT_PROOF_RESULTS.md` | Exact revision, runtime versions, commands, measurements, limitations and next gate |

Do not export a public SDK, create the future SDK repository, add a browser media
bridge or implement the full customer CLI. A small development harness is enough
to demonstrate the path. Keep the package `private: true` for this proof. Avoid
prepublish/deploy lifecycle scripts. Implementer-created package installation
should use a reviewed lockfile, not execute arbitrary agent project scripts.

## 3. Precise behavior to prove

### Deadlines and cancellation

The authoritative fixture assigns `deadline_at` once, normally five seconds from
registration, and `prepare_deadline_at` no later than one second before it. Relay
and connector also receive a signed remaining budget. Combine the absolute wall
deadline with a monotonically decreasing local budget; no retry, clock rollback,
duplicate, queue delay or reconnect may extend either. Reject excessive skew or
invalid preparation/deadline ordering. Keep the Mac's six-second outer budget
visible in measurements, without pretending a fake Mac proves real timing.

Cancellation records the exact request and authoritative version before aborting
preparation. A delayed completion must see that record and release only its own
newly created resources. Decline is not blocked on deletion. Explicitly simulate
an uncancellable external operation completing after timeout.

### Ownership, authorization and commit

Use the tuple `(project, line, binding, binding_epoch, instance,
connection_generation, call, request)` throughout. Authentication determines
scope; inbound fields cannot widen it. Keep at most one active new-call owner.
A standby development connection never supersedes a production binding.

The synthetic authority models the atomic final check for time, call terminality,
revocation, pinned ownership and generation. A transaction that waits past the
deadline must recheck after acquiring its simulated lock. The test must observe
one commit under concurrent replies. Record the limitation: a deterministic lock
model does not prove the future Postgres implementation's behavior.

Socket delivery, a relay HTTP success and `call.decision` are not durable accept.
Only `decision.committed` or authenticated reconciliation settles the result.
After acceptance is sent but before receipt, the connector remains uncertain and
cannot delete its room merely because the socket closes or the deadline passes.
Known accept preserves work; known decline/terminal cleans it; transport failure,
forbidden and not-found remain uncertain until an authoritative result or the
pre-agreed owned-resource expiry. Persist intent before allocation and
`decision_sent` before transmitting acceptance.

### Availability, readiness and side effects

Model the full states: available, unavailable, unknown, stale, recovered,
capacity-exhausted and draining. Admission needs a fresh, authenticated matching
health observation and a known slot. A recovered signal only restores admission
for the already activated binding. `check` and idle health probes must produce
exactly zero allocation/dispatch/provider effects. Connector capacity is one.

A real incoming request may allocate only after the gate passes. The fake job
checks metadata/deadline before effects, reports exact session/identity/nonce
readiness, and simulates one eligible audio publisher. Agent connection or a
generic `ready=true` from an unrelated participant cannot satisfy it. Do not wait
for the fake FaceTime bridge to join before accepting. Actual SDK hooks and media
publication verification remain later work.

### Recovery and cleanup

Journal schema is versioned and contains only owned resource identifiers and
state, never bridge tokens or raw response bodies. Use an in-memory implementation
for most scheduling tests and a small real-file implementation for crash/reopen,
atomic-write and exclusive-writer tests. Production lock portability is a later
validation gate; do not claim Windows support from a POSIX test.

Deduplication keys are stable across redelivery; transport `message_id` may change.
Digest immutable incoming semantics, excluding transport-varying remaining time,
message ID and delivery metadata. Conflicting semantic payloads are rejected.
Changing transport metadata cannot authorize a new preparation or move ownership.
After reconnect, reconcile interrupted requests; do not resend an old-generation
acceptance or redispatch under a new generation.

Persist lifecycle receipt before acknowledgment, and keep cleanup debt after ack
until deletion is verified. Terminal versions dominate delayed starts/incoming
messages. Simulate dropped lifecycle messages and acks, reconnect cursors and
periodic reconciliation. Missing management data is not proof of resource absence.
Match the exact resource ID/ownership marker; never delete by name prefix or sweep
all project rooms. Restart must preserve centrally accepted calls. Do not port
the reference receiver's delete-all-on-start policy.

No accepted media object should be terminated solely by relay loss, stale agent
health, failed credential renewal or replacement standby. Drain stops new work,
allows accepted work to finish, and reports completion only at zero active calls
and zero cleanup debt. Bound retained resources with the explicitly configured
hard expiry, independently enforced by the fake agent as well as connector.

## 4. Deterministic acceptance tests

Use injected clocks and controllable promises for races, not real multi-second
sleeps. Run a separate small actual-network test for framing/routing. Minimum
cases and observables:

| Case | Required assertion |
| --- | --- |
| Fast available agent | One room, one dispatch, correct BYOR-shaped response, one commit, commit receipt observed |
| Duplicate incoming while preparing | One shared preparation; no duplicate side effects; same eventual decision |
| Changed payload with reused request ID | Stable conflict error; no second preparation |
| 4s preparation boundary and 5s final boundary | Late work declines; final commit rejected at/after expiry; time never renewed |
| Time advances while commit waits on lock | Post-lock deadline check prevents acceptance |
| Clock rollback, transit delay and retry | Original local/central budgets still expire; invalid clock/skew data fails closed |
| Unknown/unavailable/stale/full/draining agent | Zero rooms/jobs/provider effects; distinct stable diagnostic codes |
| Health replay or wrong name/project/deployment | Cannot refresh eligibility; no allocations |
| Health recovery | Activated binding may admit again; standby remains standby |
| Readiness from wrong participant/job/nonce or dual speech publishers | No accept, owned resources cleaned |
| Caller/terminal cancellation before readiness | One tombstone, no resurrection; late side effects cleaned exactly |
| Accept sent, receipt dropped | Reconcile accept preserves resources; reconcile decline cleans; unknown preserves uncertain state |
| Reconnect / old-generation reply | Reject stale response; no second dispatch; committed call survives |
| Cross-project/line/instance injection | Authorization rejection before state access/effect; no information from the other tenant in diagnostic |
| Revocation races with acceptance | Revoked owner cannot commit even with a still-valid cached ticket |
| Local standby versus production | No implicit takeover; explicit expected-epoch activation is required |
| Crash after intent, after resource creation, after decision send | Reopen receipts; reconcile safely; no blind create retry or delete-all |
| Ambiguous create result | Inspect only exact intended owned resources; decline/retain debt if unresolved |
| Lifecycle duplication/reordering, lost ack and missing terminal event | Durable replay/ack and reconciliation converge once; terminal state wins |
| Agent health/relay outage during accepted call | Existing media/resource object survives; new calls disabled |
| Bridge initially absent versus observed departure | No premature cleanup merely because bridge has not yet joined |
| Cleanup failure / journal corruption or lock contention | Debt persists, admission disabled, no unrelated deletion |
| Hard resource expiry during authority outage | Only owned resources end; reconciliation debt remains |
| Drain/replacement | No new old-owner assignments; accepted calls retain owner; zero-call/debt condition precedes replacement |
| Secret sentinel and malformed/oversized frame | Secrets appear only in transient response path; absent from journal/log/error snapshots; bounded reject without body echo |

At the wire layer, test real HTTP cancellation, socket closure, unknown versions,
frame size limits, handshake authorization, signed raw bytes and tenant-scoped
routing. Unit tests of a direct function call alone do not prove a transport.
Loopback `ws://` is sufficient for the synthetic state proof if explicitly
documented; it proves neither production WSS/TLS nor reverse-proxy behavior.

## 5. Validation commands and evidence

These are proposed commands to make available in the implementation; the package
and scripts do not exist at handoff time. Use repository-local dependencies and
record actual tool/runtime versions in the results file.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
git diff --check
```

Bind harness listeners only to loopback and ephemeral ports. The harness must
not load `.env`, local customer configuration, credential stores or deployment
secrets. Inject all dependencies and synthetic credentials explicitly. Fail if
the harness attempts a non-loopback network destination. Close all listeners and
temporary state after each run. A developer should not need any account or key.

Record a bounded loopback latency sample, including request arrival, preparation,
relay response and durable fake commit. State sample count and p50/p95/max; do not
call it Railway latency, LiveKit startup performance or a FaceTime benchmark.
Run the package's chosen Node 24 and 22 versions when both are available. Mark an
unavailable runtime matrix as untested rather than declaring support.

## 6. Later integration boundaries

The following source links are for design review and later separately approved
work, not first-slice edit instructions. See RESEARCH's evidence map for the
complete revision and dirty-state context.

| Boundary | Preserve / add later |
| --- | --- |
| [webhook-core.ts](/Users/garygao/chert-facetime/control-plane/src/lib/facetime/webhook-core.ts:73) and [store.ts](/Users/garygao/chert-facetime/control-plane/src/lib/facetime/store.ts:695) | Preserve existing customer webhook and managed routes; add internal signed connector envelope carrying the database deadline and pinned ownership |
| [byor-credentials.ts](/Users/garygao/chert-facetime/control-plane/src/lib/facetime/byor-credentials.ts:32) and [credential-seal.ts](/Users/garygao/chert-facetime/control-plane/src/lib/facetime/credential-seal.ts:10) | Reuse validator and encrypted custody; no master-key upload, queue plaintext or claim of JWT signature verification |
| [line-integrations SQL](/Users/garygao/chert-facetime/control-plane/supabase/migrations/20260911131327_line_integrations.sql:584) | New migration adds ownership/generation/revocation checks atomically to existing decision commit; never edit historical applied migrations |
| [line schema](/Users/garygao/chert-facetime/control-plane/supabase/migrations/0001_facetime_control_plane.sql:129) and [immutable line rules](/Users/garygao/chert-facetime/control-plane/supabase/migrations/20260911131327_line_integrations.sql:177) | Atomic one-current-line/binding invariant across all writers; owner review of retirement model; no implicit legacy migration |
| [auth.ts](/Users/garygao/chert-facetime/control-plane/src/lib/facetime/auth.ts:18) | Reuse membership checks; add browser approval, scoped enrollment/tickets and rotation without treating existing project keys as a finished CLI login |
| [event route](/Users/garygao/chert-facetime/control-plane/app/api/internal/v1/calls/[callId]/events/route.ts:6) and [event enqueue](/Users/garygao/chert-facetime/control-plane/supabase/migrations/20260911131327_line_integrations.sql:283) | Transactional connector outbox, prompt leased consumer and independent scoped reconcile; existing minute cron is insufficient alone |
| [reference service](/Users/garygao/chert-reference-agent/src/chert_reference_agent/service.py:77) and [journal](/Users/garygao/chert-reference-agent/src/chert_reference_agent/journal.py:16) | Port deduplication/receipt-before-effect/cleanup-debt behavior conceptually; replace restart deletion with authoritative reconciliation; no Python runtime dependency |
| [demo preparation](/Users/garygao/demo-agent-0-outbound-video/src/preparation.mjs:1) and [request handler](/Users/garygao/demo-agent-0-outbound-video/src/agent.mjs:28) | Enforce late-job rejection before provider effects and exact per-call readiness; no paid warming or automatic restart |
| [Mac gate](/Users/garygao/chert-facetime/Sources/ChertFaceTimeLab/FaceTimeCallControl.swift:160), [HTTP path](/Users/garygao/chert-facetime/Sources/ChertFaceTimeLab/ControlPlaneClient.swift:290), [bridge coordinator](/Users/garygao/chert-facetime/Sources/ChertFaceTimeLab/CallMediaCoordinator.swift:751) | Basic release keeps these unchanged; slow-avatar support needs separate coordinated work and physical tests |

The next feasibility gate after the proof is the pinned agent-health adapter:
verify documented SDK lifecycle/admission hooks without dispatching or creating
paid media. A Cloud deployment status or successful local `/` health response
alone cannot enable acceptance. If matching project/name, freshness, drain and
capacity cannot be established, that hosting path remains unsupported/unknown.

Real integration subsequently requires isolated database race tests against the
actual commit/provisioning functions, real validator/seal boundary tests and
authorized hosted transport/LiveKit/Mac acceptance. Follow the Chert release and
supervised-test runbooks before any production action. The first proof cannot
establish deployed fleet currency, six-second real-world success, idle Cloud
capacity, paid-session cleanup, video capability or npm publishing rights.

## 7. Exclusions and completion criteria

Excluded from the first slice: production auth/enrollment implementation; real
relay deployment; database migrations; route/line changes; dashboard work; Mac
code changes; LiveKit/provider sessions; agent auto-start/restart/deploy; paid
warming; avatar cold-start fixes; outbound/video features; public SDK; npm publish.

Complete the approved synthetic slice when schemas, brief, runnable loopback
proof, deterministic tests and results are reviewable, with passing required
checks and explicit untested limits. Report residual design problems instead of
masking them with permissive admission or automatic dispatch retries. Stop for
review of that evidence before widening scope to real integrations. Do not infer
deployment authority from a passing proof.

## 8. Research deliverable checks

The research assignment created only RESEARCH.md and this handoff, and updated
README links/status. PLAN.md and CLI_RESEARCH_AGENT.md were preserved. Local
Markdown targets and referenced starting line numbers were checked, fenced
blocks were balanced, and `git diff --check` plus staged/added-file whitespace
checks passed. No runtime suites were executed and no implementation was created.
The source facts and test cases in RESEARCH are inspection evidence, not test-run
receipts. Final repository status was checked to preserve existing unrelated work.
The link/fence checker covered five Markdown files, 73 local targets/line anchors
and eight fenced blocks. The CLI checkout gained an initial commit during the
research interval; its final HEAD is recorded in RESEARCH. This run did not commit
or push.
