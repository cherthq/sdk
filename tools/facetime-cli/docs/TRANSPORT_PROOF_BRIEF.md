# Local transport proof — analyst brief

Written before implementation, 2026-09-25. Authorized scope is the first local
synthetic slice in CLI_IMPLEMENTER_AGENT.md. Baseline: main at
54db70ba5f18d2cc8d36053352186af6c1287847. README was modified and RESEARCH.md,
IMPLEMENTER_HANDOFF.md and CLI_IMPLEMENTER_AGENT.md were untracked. Preserve them.
No commits, staging, other-repository edits, deployment, real credentials,
LiveKit/provider sessions, Macs, SDK or publication belong to this work.

## Hypotheses and observable tests

| Failure hypothesis | Observable predicate / proposed tests |
| --- | --- |
| Retries or clock rollback renew time | Inject wall/monotonic clocks; delay dispatch and commit lock; reject at 4s preparation / 5s commit, including rollback, transit and duplicate delivery |
| Claimed IDs confer authority | Credential map scopes project/line/binding/epoch/instance; socket generation and pinned call/request are checked before lookup disclosure/effects; test every tuple field, revocation, standby and explicit activation CAS |
| Duplicate preparation creates two paid objects | Concurrent equivalent deliveries share one result and exactly one room/job/provider counter; conflicting semantics fail, changing message ID/remaining time cannot change ownership or deadlines |
| Health is confused with readiness | Authenticated fresh challenge/sequence/name/project/deployment health enables only activated capacity-one admission; idle checks have zero effects; exact room/job/identity/nonce and sole audio publisher required per call |
| Relay success is mistaken for committed acceptance | Journal decision_sent before response; drop receipt, close socket, restart, then reconcile accepted/declined/unknown/forbidden/not-found; uncertain resources survive |
| Cancellation misses an uncancellable create | Persist tombstone before abort; return decline without awaiting cleanup; controlled late room/job effects are deleted by exact marker only |
| Restart or lifecycle replay destroys active work | Real-file crash/reopen after intent/allocation/send; persist event before ack, replay lost ack, terminal version dominates started/incoming; missing terminal recovered by reconciliation |
| Cleanup success is assumed from an error/empty result | Exact ownership/absence checks retain debt on unknown/delete failure; corruption/lock conflict disables admission; unrelated resources survive |
| Outages terminate accepted work or leave it forever | Relay/health/auth failures preserve active calls; initial bridge absence differs from verified departure; explicit hard expiry enforced by agent and connector independently; drain requires zero active work and debt |
| Untrusted frames or diagnostics leak secrets | Strict bounded v1 schemas; raw-byte HMAC; malformed/version/oversize/tenant rejection without body echo; sentinel absent from disk, diagnostics and results |

## Local contract decisions

Use private ESM TypeScript modules, Node built-ins, ws for actual loopback
WebSockets and Zod strict schemas. Node 24 is primary; exercise local Node 22.
Only literal 127.0.0.1 destinations/listeners and ephemeral ports are supported.
No env/config/credential loading. Synthetic constants are injected by fixtures.
The fake authority alone pins calls, activates bindings, increments generations,
records decisions and emits terminal versions. Its serialized commit model is
not evidence of Postgres transaction behavior.

Use integer epoch milliseconds on the local wire instead of ISO strings, and a
signed sent_at plus remaining_ms to charge transit time. Reject future skew over
250ms; bound original decision window to 5s, preparation to 4s and leave at least
1s for commit. Every receiver retains a monotonic cap. Generation is excluded
from the semantic digest but independently fenced; stable ownership, original
deadlines and resource expiry remain in the digest. Reconnect never redispatches
journaled work or resends cached acceptance. Transient bridge material is never
journaled. The fake bridge token is explicitly unusable outside the proof.

Persist exact randomly chosen room/job/operation IDs before allocation. The fake
provider supports exact inspection and ownership markers; unknown inspection
retains cleanup debt and forbids retry. A late-completion continuation cleans
its own effects. The journal uses synchronous atomic writes, fsync and an
exclusive writer lock, with fail-closed corruption and explicit dead-process
lock recovery. POSIX behavior only is in scope; no automatic delete-all recovery.
Lifecycle cursors advance only through contiguous durable receipts. Reconciliation
is explicit on reconnect and periodic while outstanding work exists. A terminal
receipt permits cleanup; forbidden/not-found/transport failure never does.
Hard expiry is agreed at registration and independent of token expiry.

## Evidence plan

Add and execute deterministic failing behavioral tests before implementation;
record that red run. Use injected clocks, deferred promises and real temporary
journal files. Keep actual-network tests separate and test authentication,
raw-byte signatures, framing, cancellation, closure and lost receipts/acks.
Use npm ci, typecheck, lint, test, build, proof:transport and git diff --check.
Record count/p50/p95/max for request, preparation, response, fake commit and total
loopback latency. The 6s Mac gate is context only, never simulated performance
claimed as a real call. Results will map acceptance cases to evidence and list
all remaining integration gates. Stop for review after this slice.

## Review repair hypotheses — 2026-09-25

This follow-up is limited to the two reviewed defects in the existing synthetic
proof; preserve the uncommitted implementation and historical research.

1. A rejected preparation promise is only a local request outcome. It cannot
   establish that a remote create operation settled. Reproduce a timed-out local
   request with `settled=false` and initial `inspect=absent`. Assert durable debt
   and blocked admission, including after closing/reopening a real file journal;
   then release late creation, independently establish settlement, verify exact
   deletion/absence and restored admission. No second preparation and no foreign
   resource deletion are allowed.
2. Two identical incoming frames can share preparation but send two decisions.
   Reproduce both authenticated HTTP requests concurrently through the actual
   relay/WebSocket path while fake readiness is held. Both HTTP responses must
   agree, the connection must remain usable, one authoritative decision must
   commit, its receipt must arrive and lifecycle acknowledgment/cleanup must
   succeed. Matching repeat decisions may be recognized by a bounded, secret-free
   semantic fingerprint tied to the original request, socket generation and
   deadline. Authentication and full ownership checks must precede any duplicate
   lookup. Conflicting decisions or incoming semantics, foreign ownership, stale
   generations, revocation and expired budgets must still fail closed; duplicate
   delivery cannot renew retention or become another call authority.

Demonstrate each regression failing before its fix. Re-run focused regressions,
then typecheck, lint, the full suite, build and the 20-call proof on pinned Node
24 and available Node 22. Record updated counts and sanitized evidence in results.
