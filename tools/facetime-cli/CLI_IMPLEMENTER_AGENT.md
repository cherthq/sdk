# CLI_IMPLEMENTER_AGENT — first local implementation slice

You are `CLI_IMPLEMENTER_AGENT`. Work in `/Users/garygao/chert-facetime-cli`.
When the owner invokes this prompt, implement the bounded local transport proof
described below. This is the first implementation slice, not authorization for
the complete product, cross-repository writes, deployment, or publication.

## Read and establish the current baseline

Read applicable `AGENTS.md` guidance, `PLAN.md`, `RESEARCH.md`, and
`IMPLEMENTER_HANDOFF.md`. Inspect the current branch, HEAD, and working tree;
preserve existing research and unrelated edits. Historical notes that this
repository was unborn are not its current Git state. Do not reset, discard,
commit, push, or stage unrelated work.

Use the handoff's proposed file boundaries and acceptance table as the detailed
specification. Source references in the adjacent `chert-facetime` checkout may
be inspected read-only to resolve questions. Do not edit that repository, Macs,
customer agents, or production services in this slice.

The reviewed direction is suitable for this synthetic proof. Railway hosting,
production auth lifetimes, health sampling intervals, database retirement rules,
and real LiveKit adapter compatibility remain proposals for later validation.
Do not present simulated versions of those policies as production-ready features.

## Implement this slice

Build an actual loopback-only HTTP → WebSocket → HTTP request/response path:

```text
Fake Chert control plane → local relay ⇄ customer connector → fake agent
```

Add the separate authoritative decision-commit receipt, lifecycle delivery and
acknowledgment, reconciliation, and a minimal durable connector journal. The fake
control plane owns call state, routing ownership, deadlines, and commits; the
relay must not become a competing call authority.

Use TypeScript/Node.js, ESM, a reviewed dependency lockfile, and `private: true`.
Provide build, typecheck, lint, test, and `proof:transport` scripts. Keep runtime
and fixture code small and readable. Use private reusable modules; do not expose
a public SDK or build the full customer CLI. Use public registry reads/package
installation as needed for development, but the running proof must contact only
loopback listeners and must require no real account or credentials.

First write `docs/TRANSPORT_PROOF_BRIEF.md` with failure hypotheses, observable
predicates, scope, and proposed tests. Add meaningful deterministic failing tests,
then implement and review the results against the brief. Roles may be combined;
do not start subagents or other tasks. Ordinary file organization and dependency
choices within this scope do not require additional approval.

## Required invariants

1. Preserve one absolute call deadline and a smaller preparation budget. Combine
   wall-clock validation with monotonic elapsed time. Retries, reconnects,
   duplicated delivery, delayed queues, clock rollback, and waiting for the final
   commit lock cannot renew the budget. Check expiry at the authoritative commit.
2. Authenticate synthetic credentials to exact scopes. Fence project, line,
   binding epoch, instance, connection generation, call, and request. Client
   identifiers alone cannot confer authority. A local standby never takes over
   production ownership implicitly. Wrong-tenant and revoked requests fail
   before state disclosure or side effects.
3. Duplicate incoming requests prepare only once. Conflicting immutable request
   content is rejected. Canonical semantic digests exclude transport-varying
   metadata without allowing that metadata to change ownership or deadlines.
4. Socket delivery and relay HTTP success do not mean acceptance committed.
   Persist `decision_sent` before sending acceptance. If the commit receipt is
   lost, reconcile; preserve potentially accepted resources while uncertain.
   Forbidden/not-found/transport failure is not permission to delete. Do not
   redispatch or resend stale-generation acceptance after reconnect.
5. Model authenticated agent availability as available, unavailable, unknown,
   stale, full, and draining, with recovery limited to an activated binding.
   Missing or unverifiable health disables new admission and gives a clear
   diagnostic. Idle health/check operations create zero fake rooms, jobs, or
   provider sessions. They never start or restart an agent.
6. Availability is distinct from per-call readiness. Match readiness to the
   exact fake job, participant identity, nonce, and required publication. Do not
   wait for the FaceTime bridge before accepting. Do not treat the fake health
   publisher as proof that real LiveKit hooks are implemented or supported.
7. Journal ownership intent before resource allocation. Handle ambiguous creates,
   cancellation, and external operations completing after timeout without blind
   retries or leaked late resources. Delete only exact owned resources.
8. Persist lifecycle receipts before acknowledgment; retain cleanup debt until
   deletion is verified. Terminal versions dominate delayed events. Recover
   crash windows and missed terminal events through authenticated reconciliation.
   Never copy the reference receiver's delete-all-on-restart behavior.
9. Relay loss or stale health disables new work but does not end accepted calls.
   Drain preserves old ownership until active work and cleanup debt reach zero.
   Distinguish a bridge that has not yet arrived from one observed departing.
   Enforce the simulated pre-agreed resource expiry independently of token expiry.
10. Journal, logs, errors, and result artifacts contain no raw credential bodies.
    Use synthetic sentinels to test redaction. Reject malformed, oversized, and
    unsupported-version frames without echoing their contents.

## Validation

Cover the full first-slice acceptance table in `IMPLEMENTER_HANDOFF.md`, using
injected clocks and controlled promises rather than multi-second timing sleeps.
Use meaningful assertions about observed effects, commit count, resource survival,
and cleanup, not tests that merely repeat internal implementation steps.

Include actual loopback HTTP/WebSocket tests for framing, authenticated routing,
raw-byte signature verification, cancellation, socket closure, and commit/lifecycle
receipt loss. Keep timing/race tests deterministic and network smoke tests separate.
Use real temporary files for journal crash/reopen, atomic-write and writer-lock
checks. Close all listeners and temporary state after each run. Test doubles do
not establish database transaction semantics, provider cleanup, or TLS behavior.

Provide and execute:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run proof:transport -- --host 127.0.0.1 --json
git diff --check
```

Create the reviewed lockfile before `npm ci`. Record the Node/npm versions and
actual commands. Use Node 24 as the primary target and check Node 22 when available;
report an unavailable matrix as untested. Do not claim version support that was
not exercised. Pin exact installed dependencies in the lockfile.

The harness must not load `.env`, customer configuration, credential stores,
deployment secrets, or external service endpoints. Bind only loopback/ephemeral
ports and reject non-loopback runtime destinations. A local `ws://` proof is
acceptable; it is not production WSS or reverse-proxy validation.

Record a bounded loopback latency sample with count, p50, p95 and maximum, including
request, preparation, response and fake commit stages. Do not label those numbers
as Railway latency, LiveKit cold-start performance, or real Mac acceptance timing.

## Scope exclusions

No real Chert auth/enrollment, database migrations, dashboard or routing changes,
relay deployment, LiveKit/provider sessions, paid avatar work, FaceTime calls,
Mac changes, agent launching, background warming, SDK project, npm publication,
or production access. Keep the slow-avatar deadline fix separate. Production
fleet compatibility remains unverified even if every synthetic test passes.

The real health/readiness adapter is the next feasibility gate after this proof.
Record what it still must establish through supported SDK hooks. Do not silently
relax unavailable/unknown admission rules to make a demo pass. If a contract flaw
is found, resolve routine local details and document them; stop only dependent
work when a material product/security decision cannot be made within this scope.

## Deliver and stop for review

Write `docs/TRANSPORT_PROOF_RESULTS.md` with the final implementation, baseline
revision and working-tree caveats, validation evidence, timing sample, deviations,
known limits, and proposed next slice. Update README with exact local setup/run
instructions and explicitly state that this is a private synthetic proof, not
a published connector. Keep the research documents as historical research;
document corrections in the brief/results rather than rewriting them silently.

Review the final diff and complete required checks. In the final chat response,
summarize what was built, what passed, unresolved concerns, and the recommended
next implementation slice. Link the brief/results and key code. Stop for our
review before real integration work. Do not request the same scope approval again
or automatically start another task.
