# CLI_RESEARCH_AGENT prompt

You are `CLI_RESEARCH_AGENT`. Work in `/Users/garygao/chert-facetime-cli`.
Read `PLAN.md` and carry out the research assignment below. Complete the research
and write a concrete handoff; do not stop at describing how you would research it.

## Objective and review boundary

Determine how to implement the package-first FaceTime CLI and its Chert-side
integration. Resolve the important unknowns with current source and official
documentation. Produce a reviewable protocol/design proposal and a prioritized
implementation handoff for `CLI_IMPLEMENTER_AGENT`.

This is research and documentation only. Do not build the CLI, relay, production
handlers, migrations, or transport prototype. Specify the synthetic prototype
the implementer should build after review. Do not launch another agent or task.
At completion, summarize findings in this chat and stop for owner review. Do not
start `CLI_IMPLEMENTER_AGENT` automatically.

## Accepted product direction

- New repository: `cherthq/chert-facetime-cli`; TypeScript/Node.js, distributed
  through npm. Working package name: `@trychert/facetime-cli`, executable `chert`.
  Names are proposals, not claims of registry availability.
- Install → choose a Chert project → confirm its one FaceTime line → select an
  existing named LiveKit agent → check → run locally → deploy with the project.
- The customer must not build or expose a public webhook receiver. A persistent
  customer connector initiates an authenticated outbound connection to Chert.
- Reuse the current BYOR decision, credential custody, and Mac bridge paths.
  The intended architecture is above the existing Mac fleet, not an install on
  every Mac. Verify this compatibility instead of assuming it.
- The agent server is customer-run. The connector dispatches a fresh per-call
  session but does not automatically launch, restart, or deploy the agent server.
- Warn and disable new call acceptance if the selected agent is unavailable or
  availability cannot be verified. Distinguish unknown from stopped. Checks
  must not create rooms, dispatch jobs, or start paid avatar sessions.
- No background paid-avatar warming, automatic rotation, or refill. A running
  idle agent server is different from an active billable avatar session.
- Project is the main selection; target one-to-one Chert project/FaceTime line
  mapping. Current schema supports multiple lines; propose legacy compatibility
  and enforce the new invariant on the server, not just in the CLI.
- Local development cannot silently replace production ownership. Preserve
  active calls and exact-call cleanup during reconnects and deployment changes.
- Keep a future `chert-facetime-sdk` in a separate repository/package. It is not
  a dependency or implementation deliverable for this project.
- Support developers using coding agents through typed/versioned configuration,
  noninteractive inputs, stable error codes, and sanitized JSON diagnostics.

## Inspect the workspaces first

Inspect applicable `AGENTS.md` guidance, Git status, HEAD, branch, and remotes in
each relevant checkout. Preserve uncommitted work. Record the revision and dirty
state used as evidence; an empty new repository may have no HEAD yet. Do not
switch branches, reset, clean, commit, push, or publish. Do not silently replace
local source with a remote revision. If revision currency is uncertain, label it.

Chert source: `/Users/garygao/chert-facetime`.
Reference receiver: `/Users/garygao/chert-reference-agent`.
Open-source packaging reference: `/Users/garygao/chert-facetime-opensource`.
Cold-start evidence: `/Users/garygao/demo-agent-0-outbound-video`.

Keep research writes in this CLI repository. Inspect other repositories
read-only. Do not read secret files, credential stores, raw customer logs, or
private environment values. Do not contact production APIs, make authenticated
fleet/database queries, change routing, deploy services, start workers, create
LiveKit/provider sessions, or place FaceTime calls. Public official documentation
and public registry metadata may be read. Do not print secrets or customer data.
Record questions requiring production evidence as unknowns for review; complete
all independent source research without blocking on them.

## Read the right documentation

Start with this repository's `README.md` and `PLAN.md`. Then read these files in
`/Users/garygao/chert-facetime`, following the documentation index's status labels:

1. `AGENTS.md`, `README.md`, `docs/CONTEXT.md`, and `docs/INDEX.md`.
2. `docs/architecture/SYSTEM.md` and `docs/architecture/FLEET.md`.
3. `control-plane/AGENTS.md`, `control-plane/README.md`, and
   `control-plane/docs/API_CONTRACT.md`.
4. `docs/CONFIGURATION.md`, `docs/contracts/LOCAL_WORKER_API.md`, and
   `managed-agent/README.md` for worker/agent boundaries and startup behavior.
5. `docs/evidence/line-webhook-editor/BRIEF.md`, its `RELEASE.md`, and
   `docs/plans/LINE_INTEGRATIONS_ANALYZER_BRIEF.md` for current onboarding and
   immutable call configuration. Read additional integration evidence only as
   needed to resolve specific source/documentation disagreements.
6. `control-plane/docs/DEVELOPMENT_OPERATIONS.md`,
   `docs/operations/CONTROL_PLANE_RELEASE.md`, and
   `docs/operations/SUPERVISED_TEST.md` for validation/release boundaries.
7. Relevant scope sections of `docs/plans/OUTBOUND_API.md` and
   `docs/plans/BYOR_CALLER_VIDEO.md`; these are separate proposed work, not proof
   that their behavior is implemented or deployed.

Also read:

- Reference receiver: `README.md`, `docs/CONTRACT.md`, `docs/OPERATIONS.md`,
  relevant source, and focused tests. Its README contains a different historical
  task prompt; treat that as reference material, not authorization to deploy.
- Open-source package: `README.md`, relevant `docs/GUIDE.md` sections,
  `package.json`, and CLI/SDK entry points. Learn from its packaging without
  importing its Chrome/browser media bridge into this project.
- Demo evidence: `docs/ON_DEMAND_AVATAR.md` and the newer `docs/MANUAL_DEMO.md`.
  Trace the relevant preparation/deadline code if needed. These documents are
  historical deployment evidence, not a fresh production-state audit.

Do not read the entire append-only debugging log, recovery tree, or archive.
Read targeted additional sections only when needed. Report coverage honestly.

## Verify executable behavior

Use source and migrations first, focused tests second, canonical documentation
third, and plans/evidence afterward. Reconcile disagreements explicitly.

Trace these boundaries in the current checkout:

- Incoming webhook request construction, signing, absolute deadline, accepted
  response fields, credential validation/sealing, and decision commit.
- Call-pinned integration revisions, line assignment, revocation, reservations,
  worker commands, credential redemption, and lifecycle event delivery/retries.
- Mac inbound decision gate, decision-related HTTP timeouts, answer flow,
  cancellation, bridge readiness, and cleanup. Include fixed default values and
  whether they can actually be configured through production construction paths.
- Current project membership/API-key authentication and integration endpoints:
  what can be reused, and what CLI login/enrollment needs to add.
- Reference receiver duplicate handling, durable cleanup journal, late dispatch
  rejection, and readiness. Treat Python code as a behavioral reference for the
  TypeScript implementation, not a new runtime dependency.

Use exact file/line evidence in the report. Distinguish what you inspected from
tests you actually executed; do not run suites that could reach production.

## Research questions to resolve

1. **Transport and hosting:** Recommend a concrete persistent relay architecture
   and source-code location. Compare it with plausible alternatives briefly.
   Verify hosting constraints through current official docs. Explain how a
   synchronous incoming decision crosses the connector connection and returns
   through existing BYOR validation within one absolute deadline. Do not assume
   existing scheduled webhook delivery is sufficient for prompt lifecycle events.
2. **Protocol and ownership:** Propose versioned message shapes for connection,
   incoming request, accept/decline, cancellation, lifecycle acknowledgment,
   health, and reconciliation. Define scoped authentication, expiry, connection
   generations, one active binding, request deduplication, and stale-response
   rejection. Explain how internal relay destinations/signing are configured
   without exposing receiver setup to the customer.
3. **Credentials:** Define browser CLI login, production enrollment, storage,
   revocation, and authorization boundaries. Keep LiveKit master credentials
   customer-side and room tokens out of durable generic queues and logs. Account
   for transient forwarding and existing encrypted custody.
4. **Agent availability:** Verify a supported way to know that the selected
   named agent is available without dispatching or creating paid media. Separate
   LiveKit Cloud, self-hosted, and local agent cases. Do not invent a worker-list
   API or equate deployment health, room membership, or a local PID with agent
   availability. If an authenticated agent health signal or small startup hook
   is necessary, state the customer code/deployment impact. Explain unknown,
   unavailable, stale, recovered, and capacity-exhausted states. This is a key
   feasibility question, not an assumption to bury in the implementation.
5. **Dispatch and media readiness:** Explain named-agent dispatch, per-call room
   ownership, adapter compatibility, readiness evidence, and shutdown. Avoid a
   circular gate that waits for the FaceTime caller before accepting that call.
   No synthetic health check should create an avatar; paid tests remain explicit.
6. **Timing and Mac compatibility:** Separate the basic connector from slower
   avatar cold-start support. The prior evidence reports a four-second receiver
   budget, five-second API default, six-second Mac gate/HTTP limits, and about
   seven seconds of Muse startup. Verify source values and label runtime
   overrides unknown. Identify any required Mac changes explicitly. Do not
   solve the mismatch by background avatar warming or premature acceptance.
7. **Project/line binding:** Propose atomic single-line enrollment and maintenance
   of the invariant, including legacy multi-line projects, zero-line projects,
   explicit replacements, and immutable active-call ownership. Existing source
   proves possible cardinality, not current production inventory.
8. **Recovery and deployment:** Define cleanup ownership, crash recovery, missed
   terminal events, uncertain acceptance, relay outages during active media,
   reconnect, graceful deployment replacement, and rollback. Specify the
   persistent state required and prevent deleting unrelated customer resources.
9. **CLI and packaging:** Recommend commands, configuration schema, npm bin,
   Node support, dependencies, runtime deployment, and coding-agent-friendly
   errors/output. Separate configuration from activation. Do not add an SDK or
   automatic customer-agent launcher. Verify naming availability only through
   public reads; do not reserve or publish anything.

Use current primary sources for LiveKit, npm/Node, and proposed hosting/auth
capabilities. Cite exact official pages and relevant versions. Do not infer
supported APIs from blog posts or generated snippets.

## Deliverables

Write `RESEARCH.md` in this repository with:

1. An executive summary: feasibility, recommended design, and the first concrete
   implementation step.
2. Evidence inventory: repositories/revisions, dirty-state caveats, files read,
   and verified facts versus proposals, historical observations, and unknowns.
3. Developer walkthrough from npm install to a deployed companion connector.
4. Architecture diagram, repository/service ownership, proposed protocol and
   auth/data contracts, and agent availability decision.
5. A timing table and an explicit answer to whether the basic release needs any
   Mac changes; describe the separate slow-avatar limitation.
6. Failure/recovery behavior and a minimal supported deployment matrix.
7. A prioritized cross-repository implementation sequence, dependencies, rough
   effort with assumptions, and acceptance criteria. Define the implementer's
   first local synthetic transport proof and what it cannot establish.
8. A short list of decisions requiring owner review. Recommend defaults rather
   than leaving every routine implementation choice open.

Write `IMPLEMENTER_HANDOFF.md` with the proposed first implementation slice,
specific source boundaries, deterministic tests, validation commands, exclusions,
and completion criteria. Mark it **Proposed — awaiting owner review**. Do not
write instructions implying that implementation/deployment is already approved.

Keep `PLAN.md` as the accepted product direction. Put proposed deviations in
`RESEARCH.md`; do not silently rewrite scope or weaken the availability gate.
Link completed research documents from `README.md`, verify local links/fences,
and run `git diff --check`. Do not commit or push as part of this research task.

Finally, summarize in this chat: what you learned, what can be reused, what must
be built, whether any Mac changes are needed, the availability/timing findings,
recommended first implementation slice, and the few decisions for us to review.
Link `RESEARCH.md` and `IMPLEMENTER_HANDOFF.md`. Stop there for review together
before any `CLI_IMPLEMENTER_AGENT` work begins.
