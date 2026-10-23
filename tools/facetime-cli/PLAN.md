# Chert FaceTime CLI implementation plan

Status: Revised product direction following owner review; command names and interfaces
below are proposed, not shipped behavior or deployment evidence.
Created: 2026-09-25. Revised: 2026-09-29 (owner clarification after adapter qualification).
Current repository: `cherthq/sdk`, at `tools/facetime-cli` (moved from
`cherthq/chert-facetime-cli`).

This revision supersedes the earlier requirement that every connector create a
room, dispatch a named agent, and implement `chert-adapter-v1`. Earlier research,
test reports, and deployment artifacts remain historical evidence for that
implementation. Their passing results do not qualify the new BYOR wrapper.

## 1. Summary: package the receiver, make room management optional

Build one TypeScript/Node.js npm package with two explicit runtime commands:

- **`chert byor` — primary workflow.** Abstract the BYOR receiver: receive incoming
  requests from Chert, invoke the customer's existing acceptance/session logic,
  return its call-scoped room credentials, and deliver lifecycle events. The
  customer retains control of rooms, agent startup, providers, and cleanup.
- **`chert create-room` — optional convenience workflow.** For developers who want
  the package to manage sessions, create a fresh customer-owned LiveKit room and
  dispatch the configured agent for each incoming call. The package owns cleanup
  of the resources it creates through this mode.

Both preserve BYOR at Chert's boundary: Chert receives call-scoped credentials
for a room in the customer's LiveKit project and uses its existing Mac bridge.
The difference is who prepares and manages the session on the customer side.
Creating rooms is not a prerequisite for removing the public webhook receiver.

The product remains npm-first, with one `chert` executable and two modes. It does
not require Docker or a separate SDK. Provisionally use `@trychert/facetime-cli`;
verify naming and registry access before publication. The current private package
is now named `@trychert/facetime`; the frozen Railway pilot artifact keeps its original name.

The normal customer starts with an agent/application and **no BYOR receiver**.
The npm package supplies the receiver functionality. The primary success criterion
is onboarding that customer without asking them to build an HTTP handler, webhook
server, signature verifier, response plumbing, or public receiver URL.

The customer connects a small application callback that prepares or selects their
session and returns call-scoped room credentials, plus application-specific
lifecycle handling. Provide scaffolding and examples for this glue; do not assume
the customer already has Chert-compatible session logic. The package owns the
Chert protocol and transport. If the customer also wants room creation and
dispatch supplied, they choose the separate `create-room` command.

## 2. Developer experience

### Choose the mode explicitly

These are target commands, not instructions to run against today's package:

```sh
npm install @trychert/facetime-cli
npx chert login
npx chert init --mode byor
npx chert check
npx chert byor
```

For optional package-managed rooms:

```sh
npx chert init --mode create-room
npx chert check
npx chert create-room
```

`create-room` starts a persistent connector that creates a room **on an incoming
call**, not a room immediately at command startup. It is not a one-shot room
utility. Do not warm rooms or start paid sessions during installation, init,
check, or idle runtime startup. The command may dispatch a call job into an
already running agent server; neither mode starts the customer's server process.

Use shared enrollment, activation, status, drain, revoke, and recovery commands.
Installing, configuring, enrolling, checking, or starting the runtime never
implicitly activates a line. Standby operation is visible. Activation is an
explicit action on the confirmed project/line and expected previous binding.

`init` defaults its selection to BYOR and explains both modes. Persist the choice
in a versioned configuration. The runtime command must match that choice; a
mismatch returns an actionable error before effects. Never silently fall back
from BYOR to room creation when an integration fails.

### Project and line selection

Select the Chert project by name, persist its stable ID, and visibly confirm its
sole FaceTime line. The initial connector workflow targets one project/one line,
with one active binding receiving new calls. No-line and multi-line projects
require explicit resolution; do not choose a line silently or migrate unrelated
legacy projects. Enrollment/activation enforce cardinality atomically. Draining
and revoking an existing binding remain possible if project cardinality changes.

A LiveKit project is separate from a Chert project. BYOR mode need not request
LiveKit master credentials or select a dispatch name: the application's callback
supplies bridge credentials using its own session logic. `create-room` asks for the
LiveKit configuration, agent dispatch name, and supported readiness adapter.

Show project, line, mode, handler/adapter target, environment, health, and current
owner before activation. Development instances cannot silently replace production.
Switching modes uses an explicit new binding/handoff; old calls retain their
original mode and lifecycle owner.

### BYOR integration options

Support a versioned handler boundary with two integration paths:

1. **Application handler (primary, required first-release path).** The developer
   starts without a receiver. `init --mode byor` offers a minimal TypeScript
   callback scaffold, without overwriting existing files. The developer connects
   it to their session logic and explicitly selects the compiled module. The package
   handles Chert transport and event delivery; the module supplies acceptance or
   decline and delegates lifecycle cleanup to the application. No customer HTTP
   server or public URL is required. Publish a small TypeScript example; do not
   require a separate SDK or framework rewrite.
2. **Existing receiver compatibility adapter (optional migration/demo path).** Forward the current
   Chert BYOR request and lifecycle contract to an explicitly configured existing
   receiver, preserving its response semantics. The destination may be private,
   loopback, or an existing authenticated HTTPS service. A deployed receiver may
   retain its endpoint during migration; this is not the final no-HTTP-server DX.
   Do not require users to expose a new endpoint or implement the experimental
   dispatch/hook contract to use this path.

For compatibility testing, adapt the existing talking-head receiver/session interface
rather than modifying its agent to accept the current CLI's special dispatch envelope.
Verify its actual request, response, signing, lifecycle, cancellation, readiness,
and idempotency behavior before writing the compatibility adapter. Reuse its
existing preparation and cleanup rather than creating a parallel session manager.
The handler-module path must ship and be tested from a clean application with no
receiver; it is not deferred until after the demo integration. A successful demo
forwarding to an existing receiver alone does not satisfy the product acceptance
criteria. Use the demo's session logic through the module boundary where feasible
to validate real-call operation without its existing HTTP receiver.

The wrapper authenticates Chert transport. Calls to an existing receiver must
also meet that receiver's configured authentication/signature contract. Do not
blindly replay old signatures, disable verification, or leak connector credentials
to the upstream. Preserve logical request IDs/deadlines when translating envelopes.
Store credentials in protected files or deployment secret storage; no secrets in
flags, examples, logs, or generic journals.

The application must return call-scoped credentials with the existing BYOR grants
and acceptance semantics. A ready session may have been prepared already; BYOR
mode does not require the wrapper to create it. It does not authorize sharing one
conversation or credentials across unrelated calls.

### Health and understandable failures

Separate these observations in `check`, status, and structured diagnostics:

- Chert authentication and project/line ownership.
- Relay connectivity and explicit activation state.
- Handler/receiver reachability and authentication.
- Reported application/agent availability, including unknown or stale evidence.
- Per-call preparation and central acceptance.
- Lifecycle delivery, session cleanup status, and unresolved uncertainty.

A receiver HTTP 200 or a running deployment is not proof of agent/media readiness.
Use integration-specific, non-allocating health signals when available. Do not
require all agents to expose the experimental same-host signed hook. A known
unavailable integration declines with an actionable warning; unknown health must
not be displayed as ready. Per-call preparation may establish readiness within
the existing deadline; acceptance requires that contract's affirmative readiness
result, not mere endpoint liveness. If readiness remains unknown, decline.

The handler's accept decision asserts that its supplied session is ready under
the BYOR contract; the wrapper validates the response and central commit, not
all of the agent's internal job/participant implementation. Chert's post-answer
media checks remain separate. Publish what each adapter does and does not verify.

Supply stable error codes, an actionable message, and sanitized call/request IDs.
Distinguish authentication failure, unsupported adapter, agent unavailable,
preparation timeout, rejected credentials, uncertain acceptance, and cleanup
pending. Avoid one generic backend error for all these cases. Health checks must
not create rooms, dispatch agents, start providers, or call paid preparation.

### Deploy with the customer's project

Add the pinned npm package as a runtime dependency and run the chosen command as
a supervised companion process. The existing application/agent starts normally.
Document supported Node versions, secret injection, durable state, restart,
draining, and recovery. Docker can be an optional example, never a requirement.
An independently hosted connector is supported only when its handler or receiver
is reachable through a qualified topology; a local module must be installed with
that connector. Do not claim arbitrary cloud/agent compatibility.

Provide noninteractive setup, versioned configuration, sanitized JSON output, and
stable exit codes for coding agents. Discovery must not execute arbitrary project
files; runtime loads only the explicitly selected trusted handler. A browser
login is target onboarding; current owner-token enrollment remains an internal
pilot limitation until replaced with a usable login flow.

## 3. Architecture and ownership

```text
FaceTime Mac → Chert control plane → shared relay ⇄ customer npm connector
                                                       │
                               ┌───────────────────────┴─────────────────────┐
                               │                                             │
                          chert byor                                chert create-room
                               │                                             │
                    existing session logic                     optional LiveKit adapter
                    supplies room credentials                  creates room + dispatch
                               └───────────────────────┬─────────────────────┘
                                                       │
                                      existing BYOR validation and sealing
                                                       │
Media: FaceTime caller ⇄ Chert Mac bridge ⇄ customer LiveKit room ⇄ agent
```

The relay carries control messages and transient bridge credentials, never live
media. Preserve Chert's Calls, Sessions, sealed-credential custody, worker commands,
immutable routing, and terminal reconciliation. One call has one decision
owner; no dual delivery to the legacy webhook and active connector. Ordinary
webhook projects remain supported and unchanged.

| Responsibility | `chert byor` | `chert create-room` |
| --- | --- | --- |
| Chert transport/authentication/routing | Package and shared backend | Same |
| Prepare or choose the room | Customer's existing session logic | Package's LiveKit adapter |
| Dispatch/start per-call agent session | Customer's existing session logic | Package's supported adapter |
| LiveKit master credentials in connector | Not required by wrapper; handler may use its own | Required by LiveKit adapter |
| Per-call readiness evidence | Existing BYOR preparation contract | Mode-specific LiveKit readiness contract |
| Cleanup authority | Customer session owner | Package, limited to resources it created |
| Lifecycle delivery and reconciliation | Package tracks delivery; customer owner settles resources | Package tracks delivery and owned-resource cleanup |
| Start/restart the agent server | Never | Never |

### Primary mode: one incoming call

1. Authenticate the active binding and persist the request identity and deadline.
2. Coalesce duplicate delivery; invoke the selected BYOR handler with the original
   logical request and remaining budget. Preserve existing request semantics.
3. The application prepares/selects its session and returns accept with bridge
   credentials, or decline. The wrapper never allocates a replacement room or
   sends its own LiveKit dispatch in this mode.
4. Validate and forward the existing BYOR decision to Chert's authoritative commit
   and credential-sealing path. A local accept response alone is not a commit.
5. Deliver started/ended/failed events to the same pinned session owner, with
   durable delivery state, acknowledgments, and replay where safe.
6. On cancellation, timeout, disconnect, or uncertain acceptance, reconcile Chert
   status and notify/query the existing session owner. Cleanup happens through
   that owner's established interface, never by generic wrapper room deletion.

### Optional mode: managed LiveKit preparation

Reuse the existing room-creation adapter behind `chert create-room`. It creates
isolated resources, dispatches the configured named agent, verifies its supported
readiness contract, and supplies bridge credentials. Its resource journal and
cleanup proofs stay scoped to that mode. Clearly document its current specialized
hook/metadata requirements; do not advertise support for every LiveKit agent.

A one-time room utility is outside this plan. The optional command is a
long-running call connector, with no allocations until an incoming call.

### Decouple the existing runtime, not just command names

The present `Agent` interface and connector journal assume wrapper-generated
room/job/participant/nonce values, resource creation settlement, and deletion.
Adding two command aliases to that runtime would preserve the problem.

Split shared call transport/decision handling from session ownership. Specify a
versioned internal adapter interface for preparation, health, lifecycle delivery,
and recovery. BYOR records use opaque application session references when needed;
they must not fabricate dispatch IDs or claim ownership of customer rooms. Keep
LiveKit resource intents and deletion receipts in the create-room implementation.
Only store non-secret correlation data needed for recovery.

For an existing receiver, determine which operations are idempotent and which
settlement/status signals actually exist. Do not retry a preparation request
blindly after a timeout; a timed-out handler may still have created a session.
If settlement cannot be established, retain and report the uncertainty, block
unsafe new work at the affected capacity, and give an operator recovery path.
Do not invent a mandatory new agent hook to hide missing compatibility.

Separate four facts: decision committed; lifecycle delivered; application
acknowledged; resources cleaned. A transport acknowledgment is not resource
absence. Recovery must survive process restart and preserve accepted calls.
Mode-specific recovery must be able to resume old work after a mode handoff.

### Deadlines, duration, and media remain explicit

The initial decision budget still comes from Chert's deployed API/Mac contract.
Receiver preparation timeout, session duration, credential expiry, and the
incoming decision deadline are different values. Forward the original deadline;
retries and mode switches cannot extend it. Report incompatible cold starts
rather than pretending the wrapper solves them.

The current implementation imposes a 60-second resource ceiling across its
protocol, journal, adapter, and backend. This is a limitation of the existing
prototype, not a universal BYOR rule. The main wrapper must preserve the existing
integration's supported call lifetime and cleanup policy, subject to Chert's
validated session/credential limits. Audit and change the shared hard-coded
assumptions before claiming compatibility; do not merely remove expiry checks.
Until validated, retain and label the ceiling for the optional adapter. Do not
truncate an existing customer's calls to fit that implementation silently.

Existing talking-head evidence reports different preparation, duration, and media
settings. Document and test those discrepancies instead of forcing its agent into
the provider-free probe profile. Neither mode creates new FaceTime/video support.
Do not infer decoded audio or dynamic video delivery from publication or room join.
Changes that require API/Mac deadline or media updates are a separate scope.

## 4. Current state and implementation sequence

### What exists and what is changing

Local work includes the npm CLI, scoped enrollment/activation, shared relay,
durable receipts/recovery, and a specialized LiveKit room-creation adapter.
The revocation/retirement fixes and earlier cleanup/expiry regressions remain
requirements. Existing tests qualify their recorded paths, not the new wrapper.

Deployment preparation and talking-head qualification found an adapter mismatch.
That finding is evidence of the narrow implementation; making the talking-head
agent implement that special hook is no longer the default product plan.
Preserve qualification reports, release candidates, artifacts, and unresolved
debts. Deployment runbooks need review under this revision before execution.
This documentation change authorizes no implementation, deployment, activation,
credential change, live session, or Mac operation.

### Phase 1 — Specify receiver-free onboarding and the BYOR boundary

- Inspect current Chert BYOR contracts and the actual talking-head receiver.
- Write an analyst brief mapping incoming requests, decisions, signing, deadlines,
  readiness, lifecycle events, cancellation, duplicates, and cleanup ownership.
- Specify the application callback, scaffold, and setup starting from an agent
  project with no receiver. Use the existing receiver as a contract reference,
  then define its optional compatibility adapter using the same boundary.
- Identify source changes required to remove generic room/dispatch assumptions,
  the 60-second ceiling, and audio-only prototype restrictions where they conflict
  with the existing supported contract. Separate software compatibility from new
  Mac/media capability; record unresolved gaps without inventing behavior.

Exit: a reviewed contract mapping and deterministic regression cases proving that
BYOR mode must not create rooms, dispatch jobs, or directly delete customer rooms.
This is the immediate next engineering task, before resuming deployment.

### Phase 2 — Split modes and implement the primary wrapper

- Add `chert byor` and `chert create-room`, mode-specific configuration, help,
  check/status output, and deployment examples. BYOR is the primary onboarding.
- Preserve existing `run` as explicitly documented legacy behavior or require an
  explicit migration; never silently change what an old config does. Document a
  deliberate migration to create-room mode for current users.
- Implement receiver-free onboarding and the application-handler path first;
  add the existing-receiver compatibility adapter without making it a dependency.
- Refactor shared transport/decision state away from resource ownership. Preserve
  the optional LiveKit adapter, its specialized safety checks, and recovery logic.
- Pin mode/adapter ownership per binding and call where needed. Do not reopen,
  reinterpret, or overwrite old journals. Recover old work with its original mode;
  use fresh state for a new binding and drain before retiring the old process.
- Keep master credentials, dispatch names, and the experimental local hook out of
  mandatory BYOR setup. Update backend contracts only where the split requires it.

Exit: a clean installed npm artifact supports both explicit modes. A fresh agent
project with no receiver can use the scaffold to supply a BYOR decision and
credentials without building HTTP infrastructure or causing extra session creation.
The optional command still manages only its own resources.

### Phase 3 — Validate the ownership and compatibility boundaries

- Run deterministic tests through the real wrapper and installed package in a
  clean application with no receiver, using the generated callback example.
  Test the existing receiver compatibility adapter separately.
- Assert zero wrapper-originated LiveKit create/dispatch/delete calls in BYOR
  mode, including timeout, cancellation, restart, and terminal handling. Customer
  handler resource operations remain attributable to the customer session owner.
- Test exact response/lifecycle translation, signing, duplicate requests, uncertain
  preparation, lost commit responses, late completion, and safe replay/recovery.
- Test unavailable/stale health without allocation or paid provider activity.
- Test mode mismatch, cross-project input, standby versus active, explicit mode
  handoff, permanent revocation, and retirement after line cardinality changes.
- Cover supported call durations and media contract differences, and prove that
  BYOR operation is not forcibly cut off at the old prototype's 60-second limit.
- Preserve existing optional-adapter regressions and all historical evidence.

Exit: isolated tests establish both ownership models. These are engineering
checks, not a marketed substitute for testing with FaceTime.

### Phase 4 — Requalify the deployment candidate and pilot

- Reuse useful deployment preparation, but revalidate source/schema compatibility
  and regenerate the exact candidate/artifact hashes after the mode changes.
- Revise the pilot runbook: use `chert byor` for **Chert FaceTime Test**, targeting
  its existing talking-head BYOR integration. No second room or parallel dispatch.
- Keep shared backend deployment separate from project activation. Enroll in
  standby, verify handler/relay readiness and ownership, then explicitly activate
  only the pilot line after review. Preserve the saved webhook rollback route.
- Use approved bounded real FaceTime tests to verify connection, both audio
  directions, lifecycle delivery, cleanup, and a subsequent call. Qualify video
  separately when claimed. Report each failure at its actual boundary.
- Drain and reconcile old calls before retiring their runtime. Do not clear
  historical debts or use another integration's resource inventory to settle them.

Exit: an agent/session flow works through the main npm command on a real call
without a customer-built HTTP receiver, with no forced rewrite of its dispatch/room
management. Existing-receiver forwarding alone cannot satisfy this gate. Mac updates are
not assumed; verify installed compatibility and separately scope any needed change.

### Phase 5 — Polish onboarding and publish

Finish browser login, guided project/line selection, actionable errors, and
supported host documentation. Remove proof-only naming after package/release
review. Make BYOR the primary quickstart; present create-room as optional with
its tested adapter requirements. Publish only after the reviewed pilot succeeds.

Re-estimate effort after Phase 1. Earlier estimates and implementation-complete
statements covered the specialized room-creation path, not this revised wrapper.

## 5. Repository and evidence references

- `chert-facetime-cli`: both commands, customer runtime, adapters, diagnostics,
  configuration, state/recovery, package tests, and customer documentation.
- `chert-facetime`: shared enrollment/routing/authority/lifecycle APIs and
  `connector-relay`; existing Mac media and credential custody remain here.
- Customer agent repositories: preserve session logic; keep compatibility mapping
  in the package wherever feasible. Any necessary customer contract gap must be
  explained and reviewed rather than disguised as a universal adapter requirement.

Read current source before implementation. Useful starting points:

- [CLI guide](CLI_GUIDE.md) — current specialized implementation, not new commands.
- [Backend results](docs/BACKEND_INTEGRATION_RESULTS.md) — prior local evidence.
- [Deployment readiness](docs/DEPLOYMENT_READINESS.md) and
  [pilot runbook](docs/BACKEND_PILOT_RUNBOOK.md) — requalification required.
- [Talking-head qualification](docs/hook-qualification/RESULTS.md) — mismatch evidence.
- [Existing adapter](src/adapters/livekit.ts), [agent interface](src/runtime/agent.ts),
  and [connector](src/runtime/connector.ts) — ownership assumptions to separate.
- [System architecture](https://github.com/cherthq/facetime/blob/main/docs/architecture/SYSTEM.md) and
  [API contract](https://github.com/cherthq/facetime/blob/main/control-plane/docs/API_CONTRACT.md).
- [Incoming decision boundary](https://github.com/cherthq/facetime/blob/main/control-plane/src/lib/facetime/webhook-core.ts)
  and [credential validation](https://github.com/cherthq/facetime/blob/main/control-plane/src/lib/facetime/byor-credentials.ts).
- [Release runbook](https://github.com/cherthq/facetime/blob/main/docs/operations/CONTROL_PLANE_RELEASE.md) and
  [supervised acceptance](https://github.com/cherthq/facetime/blob/main/docs/operations/SUPERVISED_TEST.md).

## 6. Future separate SDK

A future `chert-facetime-sdk` repository/npm package may provide an importable
TypeScript client for application-owned accept/decline policy, lifecycle callbacks,
call metadata, and embedded connector startup/shutdown. It is not a prerequisite
for either CLI command. The small handler contract needed by the CLI does not
expand this release into a general public SDK.

The SDK and CLI may share versioned backend contracts while retaining separate
releases. Broader call-management APIs and additional language bindings can follow
actual demand. The primary promise stays: keep BYOR, remove the receiver plumbing,
and make package-managed session preparation an explicit option.
