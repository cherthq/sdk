# Local transport proof results

Status: **Implemented and locally validated; stopped for owner review.**
Date: 2026-09-25. Scope: CLI_IMPLEMENTER_AGENT.md's synthetic slice only.

## Baseline and preservation

Repository: `/Users/garygao/chert-facetime-cli`, branch `main`, baseline HEAD
`54db70ba5f18d2cc8d36053352186af6c1287847`.
At entry, README.md was modified; CLI_IMPLEMENTER_AGENT.md,
IMPLEMENTER_HANDOFF.md and RESEARCH.md were untracked. Their existing research
and README links were preserved. Only README's obsolete implementation status
was replaced and local run instructions added. PLAN.md, CLI_RESEARCH_AGENT.md
and the three handoff/research documents were not rewritten. No staging, commit,
push, other-repository modification, deployment, production contact, Mac change,
LiveKit/provider session, agent launch, SDK project or package publication occurred.

## What was built

A private ESM TypeScript package with exact dependency pins and a lockfile:

- [Protocol](../src/protocol/v1.ts): strict bounded v1 message schemas, stable
  errors, full ownership tuple and canonical immutable-content digest.
- [Deadline](../src/runtime/deadline.ts): absolute wall deadlines plus monotonic
  caps, signed remaining budget/transit accounting and a smaller preparation cap.
- [Connector](../src/runtime/connector.ts): availability/capacity admission,
  shared preparation, durable intent and decision_sent, uncertain acceptance,
  authoritative receipts, reconnect reconciliation, terminal precedence,
  periodic reconciliation, precise cleanup, bridge observation and drain.
- [Journal](../src/runtime/journal.ts): narrow in-memory/file implementations,
  strict secret-free schema, fsync/atomic rename/directory fsync, exclusive writer
  lock, fail-closed corruption and explicit dead-process lock recovery.
- [Availability](../src/runtime/availability.ts): separate authenticated synthetic
  health credential, challenge, boot/sequence, matching project/name/deployment,
  freshness, known capacity and draining checks. Zero idle allocation effects.
- [Authority](../tests/fixtures/control-plane.ts): credential scopes, activation
  CAS, generations, pinned calls, serialized commit and post-lock guards,
  revocation, recovery-only credential, lifecycle outbox and acknowledgment model.
- [Relay](../tests/fixtures/relay.ts) and [wire client](../tests/fixtures/connector-wire.ts):
  real loopback HTTP/WebSocket routing, raw-byte HMAC, authenticated upgrade,
  frame bounds, cancellation, socket closure and separate commit/lifecycle delivery.
- [Fake agent](../tests/fixtures/agent.ts): counted room/job/provider effects,
  exact readiness, delayed/ambiguous operations, exact ownership inspection and
  verified deletion, independently scheduled hard resource expiry.
- [Network harness](../tests/fixtures/network.ts) and [proof runner](../tests/proof.ts):
  actual HTTP authority endpoint → signed relay HTTP → connector WebSocket →
  fake agent → WebSocket response → relay HTTP response → authoritative commit.
  The harness fsyncs a secret-free fake commit ledger before returning a receipt.
  Reconciliation uses an independently authenticated HTTP endpoint.

Only `127.0.0.1`, ephemeral ports and local `ws://` are accepted. No harness code
loads environment files, customer configuration, credential stores or remote
service URLs. The fake bridge URL/token are never used to connect anywhere.
Temporary journals, listeners and timers are closed/removed after tests and proof.

## Test-first evidence and review findings

The [analyst brief](TRANSPORT_PROOF_BRIEF.md) was written before implementation.
The initial wall-clock-only scaffold compiled, then failed three deterministic
assertions: rollback renewed preparation time (5,000 instead of 0 ms); a reduced
signed/transit budget was ignored (4,000 instead of 1,000 ms); invalid timing was
accepted. Its boundary test passed. That red run preceded the deadline fix.
A preliminary compile also exposed missing explicit Node types in TS config;
that setup error was fixed before recording the behavioral red run.

A later regression test failed because recovery cleared cleanup debt while an
external create was still in flight and the resource was not yet visible.
The private agent interface now requires operation-settlement evidence before
absence can clear create debt. Unknown management state remains debt; no create
retry is issued. That test passes with controlled late completion. This is a
real requirement for the future adapter, not evidence that a provider supports it.

Two additional red tests caught terminal cancellation/lifecycle delivery before the
incoming request: there was no journal entry to record terminality. The journal
now persists an ownership-scoped tombstone even without resources, before ack.
Both regressions and a real-file reopen check pass with zero late allocations.

Review also retained reconciliation debt when a locally observed bridge departure
has not yet become centrally terminal, and fenced a resource collision that
appears while creation is pending. Neither can delete or adopt a foreign object.

## Review repairs — failing before, passing after

The follow-up retained the same baseline HEAD and existing uncommitted proof.
README, plans/research, package manifest/lockfile and protocol schema were preserved.
The original 77-test suite missed two reviewed failure modes; 15 new regressions
now bring the full suite to 92 tests. Failure hypotheses were added to the brief
before either repair. No new agent/task or real integration was started.

### 1. Rejected preparation versus remote settlement

Two deterministic tests (same runtime and real file-journal reopen) initially
failed with `cleanup_debt=false` where `true` was required. The local preparation
request rejected with a synthetic timeout while `settled()` remained false and
`inspect()` returned absent. This reproduced the reviewed premature clearance.

The preparation catch now preserves `create_pending` instead of setting it false.
Only cleanup's independent `settled()` check can clear pending creation after a
rejection. Admission stays blocked while that state/debt persists. The private
agent interface comment explicitly requires proof that the exact remote operation
can produce no further effects; local promise rejection and absence are not proof.

Both tests now pass through late creation, independently released settlement,
a simulated deletion failure, verified eventual deletion, and restored admission.
The reopened journal retains the same debt. Exactly one preparation and one late
owned creation occur; unrelated foreign resources survive. No create retry, schema
migration or broader provider behavior was introduced.

### 2. Duplicate decisions on the actual wire

The new loopback regression first reproduced two successful HTTP responses from
one held preparation, followed by `connector_closed_before_barrier`: the relay
closed the socket on the second matching decision. An ordered WebSocket ping/pong
barrier detects closure after processing both decisions without timing sleeps.

The relay now keeps a per-connection completion fingerprint until the earliest
original pending deadline, and clears it on expiry or socket closure. It retains
only a SHA-256 semantic digest of the decision, not raw response credentials.
Only delivery `message_id` is excluded. Authentication/revocation, full ownership,
current connection generation and the original budget are checked before a repeat
is ignored. Conflicting action/token/participant content still closes with a
stable conflict diagnostic. The whole HTTP fan-out is checked before any response
is completed. Duplicate decisions neither commit nor extend the retained budget.

The passing regression verifies both matching HTTP responses, one room/job,
continued socket usability, one authoritative commit under concurrent replies,
separate commit-receipt delivery, terminal acknowledgment and zero cleanup debt.
Further actual-wire regressions cover conflicting immutable incoming content,
foreign project/line/instance/request, stale generation, revoked credentials and
expiry under injected clock rollback. The connector wire client remains unchanged:
the relay tolerates its legitimate matching repeats rather than hiding the race.

A late HTTP retry after response disposal returns HTTP 409 `acceptance_uncertain`
and must reconcile; no acceptance body is cached or recreated. This behavior is
also tested through successful reconciliation and terminal cleanup. The completion
fingerprint is a transport receipt only; the fake control plane remains the call
and commit authority.

### Regression commands

On Node v24.14.0, the following focused commands demonstrated the red failures
before their respective fixes, then passed after them:

```sh
npm run build
node --test --test-name-pattern='rejected local preparation' dist/tests/transport/journal.test.js
node --test --test-name-pattern='concurrent identical incoming HTTP' dist/tests/transport/network.test.js
```

Cleanup: **0/2 → 2/2**. Concurrent wire duplicate: **0/1 → 1/1**.
The expanded duplicate/conflict/security/deadline selection passed **13/13**:

```sh
node --test --test-name-pattern='duplicate|late HTTP retry|concurrent identical' dist/tests/transport/network.test.js
```

The full validation and both 20-call latency samples below were refreshed after
the repairs. Remaining production/integration limitations still apply.

## Acceptance coverage

**92/92 tests passed on each tested runtime after the review repairs; no skipped/cancelled tests.**
Tests are split between deterministic state/file tests and actual-network tests.
Race scheduling uses injected clocks and controlled promises. The network tests
use event-driven synchronization with a three-second failure watchdog, not
multi-second sleeps to manufacture race outcomes.

| Handoff case | Executed evidence |
| --- | --- |
| Fast available agent; correct response; one commit and receipt | state: fast available; network: HTTP → WS → HTTP; proof: 20 calls |
| Duplicate while preparing; changed immutable payload | state: shared preparation/conflicts; actual wire: matching duplicate decisions, conflicting replies, live commit receipt and cleanup |
| 4s preparation / 5s final boundary | deadline: exclusive boundaries; state: late create; recovery: final expiry |
| Time advances while commit waits | state: controlled lock wait with rollback and post-lock rejection |
| Rollback, transit, retry and invalid clock data | deadline suite; recovery: original boundary; resource expiry cap |
| Unknown/unavailable/stale/full/draining health | state parameterized admission tests; recovery health tests; zero room/job/provider counts |
| Health replay or wrong name/project/deployment | recovery: challenge/sequence replay and matching/authentication rejection |
| Recovery only for activated binding | recovery: recovered signal, standby and production ownership conflict |
| Wrong readiness identity/job/nonce/room; dual publishers | state parameterized readiness tests; resources cleaned |
| Caller/terminal cancellation and late effects | state controlled cancellation; pre-incoming terminal tombstones and file reopen; actual HTTP abort and late readiness |
| Accept sent, receipt lost, accept/decline/unknown reconciliation | state: uncertain acceptance; recovery: generation interruption; network: dropped commit receipt |
| Reconnect, old generation, no redispatch | recovery generation test; network reconnect/closure tests; accepted resource survives |
| Cross-project/line/instance/call/request injection | state every tuple field plus zero-effect incoming fences; network tenant routing, signed substitution and scoped reconcile |
| Revocation during commit | state controlled commit wait; network revoked owner fails before allocation |
| Standby versus production; expected-epoch activation | recovery standby and drain/replacement tests |
| Crash after intent, allocation/prepared, decision send | journal: actual child SIGKILL, locked reopen, dead-writer recovery and no blind retry |
| Ambiguous create | recovery: exact inspection and unknown management; rejected local promise with unsettled remote create, late allocation and real journal reopen |
| Lifecycle reorder/duplicate/lost ack/missing terminal | recovery cursor gaps/terminal precedence/periodic reconcile; network dropped event and lost ack replay |
| Health/relay/auth outage preserves accepted call | state/recovery survival tests; network accepted socket closure |
| Bridge initially absent versus observed departure | recovery: exact bridge identity, unknown management, two absence observations 250ms apart |
| Cleanup failure; corruption; lock contention | recovery deletion/foreign-marker tests; journal corruption/exclusive-writer/atomic-write tests |
| Hard expiry during authority outage | recovery independently advances agent and connector clocks; retains reconciliation debt |
| Drain/replacement requires zero work/debt | recovery drain-to-zero and activation CAS |
| Secret sentinels and malformed/version/oversized frames | network HTTP + WS reject without echo; disk/diagnostic scan; journal extra-field rejection |

Detailed tests: [deadlines](../tests/transport/deadline.test.ts),
[state/authorization](../tests/transport/state.test.ts),
[recovery/cleanup](../tests/transport/recovery.test.ts),
[file journal](../tests/transport/journal.test.ts),
[actual transport](../tests/transport/network.test.ts).

## Validation commands and dependencies

Primary runtime: **Node v24.14.0, npm 10.8.2**.
Compatibility check: **Node v22.23.2, npm 10.9.8**.
Host: macOS; no Linux or Windows matrix was run. Initial exploratory work used
the shell default v20.19.6; this is not a claim of Node 20 support. The installed
`/opt/homebrew/opt/node@24/bin/node` unexpectedly reported v26.7.0, so the final
primary run used explicitly pinned `node@24.14.0` from the public npm registry.

Preparation and lock review:

```sh
npm install --package-lock-only --ignore-scripts
npm ci --ignore-scripts
npm exec --yes --package=node@24.14.0 -- node --version
npm exec --yes --package=node@24.14.0 -- node -p 'process.execPath'
```

The lock contains 100 resolved packages, all with registry.npmjs.org URLs and
integrity hashes; none declares an install script. Runtime dependencies are
`ws 8.21.3` and `zod 4.6.5`. Dev dependencies are TypeScript 6.0.2,
@types/node 24.13.6, @types/ws 8.18.1, ESLint 10.11.0 and typescript-eslint 8.70.1.
The npm ci audit reported **0 vulnerabilities** at execution time; this is not
a source audit or future security guarantee.

The following complete sequence passed with each runtime selected in PATH:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
```

Primary PATH prefix:
`/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin`.
Node 22 PATH prefix: `/Users/garygao/.nvm/versions/node/v22.23.2/bin`.
These are execution provenance, not required installation paths for another user.
Final `git diff --check` passed; new implementation files were also checked
against `/dev/null` so untracked-file whitespace was covered. Markdown local
links (26 targets), 31 new files and both JSON artifacts were checked. The CLI
also rejected `--host example.com --json` with exit 1 and only a stable
`forbidden` diagnostic. README contains reproducible local commands.

## Bounded local latency sample

Each sample is 20 sequential accepted calls, including local journal fsyncs and
a fake authority commit ledger fsync. Each runtime observed **20 rooms, 20 jobs,
20 fake provider effects, 20 deletions, 20 commits, zero surviving resources and
zero remaining debt**. Units are milliseconds; nearest-rank percentiles; no
outliers/warmup samples removed. These are small local samples, not an SLA.

Stage definitions:

- Request: synthetic authority registration start through HTTP/WS delivery and
  durable connector intent, ending at fake-agent preparation invocation.
- Preparation: fake-agent work plus prepared/decision_sent persistence, ending
  when the connector sends the response frame.
- Response: response-frame send through relay HTTP return and authority parsing.
- Commit: serialized authoritative final check and local commit-ledger fsync.
- Total: registration start through fake commit, excluding later receipt/cleanup.

Node v24.14.0:

| Stage | Count | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| request_ms | 20 | 11.651 | 13.19 | 18.617 |
| preparation_ms | 20 | 19.815 | 24.294 | 39.033 |
| response_ms | 20 | 1.238 | 2.623 | 4.815 |
| commit_ms | 20 | 4.304 | 5.164 | 7.075 |
| total_ms | 20 | 37.834 | 45.63 | 53.348 |

Node v22.23.2:

| Stage | Count | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| request_ms | 20 | 12.337 | 14.305 | 15.099 |
| preparation_ms | 20 | 20.225 | 21.995 | 37.123 |
| response_ms | 20 | 1.353 | 2.899 | 4.824 |
| commit_ms | 20 | 4.298 | 5.037 | 5.896 |
| total_ms | 20 | 39.262 | 42.559 | 55.458 |

Sanitized machine-readable artifacts: [Node 24](TRANSPORT_PROOF_NODE24.json),
[Node 22](TRANSPORT_PROOF_NODE22.json). Configured preparation/final deadlines
remain 4,000/5,000 ms. The existing Mac's 6,000 ms outer gate is documented
context only: no Mac timing, Railway latency, LiveKit cold start, real media,
physical call or provider performance was measured.

## Local choices and remaining limits

- Millisecond epoch timestamps replace the proposed ISO representation. The
  signed envelope adds `sent_at`, explicit instance identity and immutable
  resource expiry. Digest exclusions are only message ID, sent/remaining time
  and transport generation; generation is separately fenced everywhere.
- The proof uses a 60-second pre-agreed resource lifetime, a one-second injectable
  reconciliation scheduler and 250ms bridge-departure confirmation. These are
  simulation choices, not production lifetime/health/arrival-watchdog policies.
- The real wire path covers incoming/decision, commit receipt, cancel/ack,
  lifecycle/ack, welcome/authentication and HTTP reconciliation. Health publishing,
  enrollment/activation/drain and relay-to-authority scope/ack lookups are private
  authenticated fixture APIs, not deployed services or a complete public protocol.
  The fake agent is an injected object, not a LiveKit/HTTP service. The future
  hello/lease/renewal/enrollment flows and protocol negotiation remain unbuilt.
- Completed-decision fingerprints are transient and connection-local, expire at
  the original deadline and never authorize a call. A later HTTP retry uses
  reconciliation instead of replaying credentials. This does not provide durable
  relay replay across restarts or production rate/retention controls.
- Last cursor is a recovery hint; the fake outbox replays all unacknowledged
  events even below that cursor so a lost acknowledgment converges. Retention,
  tombstone compaction, bounded database reconciliation pages and production
  queue backoff are future work. The synthetic journal retains its small history.
- The fake authority has serialized in-process state and an fsynced commit ledger
  in the network harness. It does **not** implement authority-process recovery,
  transactional outbox durability or actual Postgres semantics. Crash tests cover
  the connector journal; the fake provider and authority remain alive in the test.
- Synthetic credential equality and scopes establish fixture authorization, not
  production authentication, ticket expiry, key rotation, TLS, encrypted custody,
  JWT validation, enrollment or billing. Recovery credentials are independent
  read/cleanup scopes; they cannot connect or submit decisions. Generic diagnostics
  omit raw errors, credentials and bodies. JavaScript strings cannot be physically
  zeroized; transient credentials are not cached or written to the journal/ledger.
- POSIX PID locks intentionally fail closed on ambiguity, malformed locks or PID
  reuse. Explicit recovery needs a verified dead writer; there is no automatic
  stale-lock deletion. Network filesystems, symlink/hostile shared-directory
  hardening, machine/power loss, multi-host writers, Windows and storage quotas
  are untested. The current journal is synchronous and intended for a tiny proof.
- The agent model assumes exact ownership lookup and operation-settlement evidence.
  A real adapter that cannot establish settlement/absence must retain debt. Fake
  room removal models stopping its job/provider object, but proves nothing about
  a vendor's private sessions or late callbacks after a real process crash.
- This does not establish supported LiveKit lifecycle/admission/readiness hooks,
  Cloud capacity, real sole-publication verification, installed fleet currency,
  line-cardinality migration, real cleanup or end-to-end deadline feasibility.
  The slow-avatar/Mac deadline change remains separate.

## Recommended next slice — review required

Validate a version-pinned TypeScript agent health/readiness adapter through
supported SDK hooks. Establish matching project/name/deployment, authenticated
freshness, drain and capacity, exact job/identity/nonce/publication readiness,
pre-effect deadline/cancellation checks and truthful operation-settlement/cleanup
capabilities. Idle startup/check/recovery must create zero rooms/jobs/provider
sessions; unsupported signals must remain unknown. Do not infer these hooks from
this health simulator or silently loosen admission to make the demo pass.

After that gate, separately authorize isolated real database/auth/custody tests
and any hosted transport, LiveKit/provider or supervised Mac work. **This task
stops here for review and does not start real integration.**
