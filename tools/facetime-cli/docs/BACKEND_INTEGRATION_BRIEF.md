# Backend integration analyst brief

Implementation scope: private CLI and Chert control plane/hosted relay, isolated validation only. No production migration, deployment, activation, credential rotation, live sessions, Mac changes or publication.

## Boundaries and invariants

Existing Supabase user authentication and project membership authorize enrollment and explicit binding administration. An owner/admin session must confirm a project and its sole assigned line. Enrollment creates a standby binding and separate random connection/recovery credentials; it never changes routing. Secrets are returned once into an owner-only local file, never arguments or diagnostic output. Project API keys cannot administer enrollment.

The control plane owns transactional binding activation, generation leases, immutable call ownership, deadline enforcement, validated/sealed BYOR acceptance, worker commands and durable lifecycle delivery. A new database migration provides these boundaries. Activation uses compare-and-swap against the previous binding and line assignment generation. Replacement drains the previous binding; calls remain pinned to it. Disabling restores the captured line route only when that route has not independently changed. Other projects continue their existing webhook or managed routes.

The hosted relay carries bounded authenticated WebSocket signaling only. It polls durable control-plane delivery records, commits decisions through the existing BYOR validator/sealer and acknowledges lifecycle events. Database generation fencing remains authoritative across relay restarts/replicas. Encrypted public origins are mandatory; an explicit isolated loopback test mode is separate. Recovery credentials authorize only existing owned-call recovery, never new admission. A revoked connection credential cannot accept new calls. Matching decision retries are idempotent; conflicting content, foreign ownership, expired deadlines and stale generations fail closed.

The CLI owns protected configuration and durable local journals/adapter receipts. Existing authenticated fresh hook health, exact adapter readiness and cleanup uncertainty rules remain unchanged. Authoritatively terminal, fully cleaned calls remain completed after expiry and concurrent reconciliation. The two historical debts are not modified.

## Failure hypotheses and validation

Before implementation, enrollment/activation RPCs and hosted transport are absent. Deterministic tests must first fail at these construction boundaries. Isolated PostgreSQL must exercise membership, sole-line cardinality, activation compare-and-swap, revocation, immutable call ownership and generation checks. Runtime tests must exercise actual relay HTTP/WebSocket paths, deadlines, duplicate/conflicting decisions, durable receipt/replay/reconciliation and disconnect/restart. Validate installed CLI construction, both supported Node majors, existing webhook/managed tests, lint/typecheck/build, synthetic proof and whitespace. Preserve baseline hashes in BACKEND_INTEGRATION_BASELINE.json.

No synthetic result establishes FaceTime, decoded audio, video or deployed readiness. Current Mac command/redeem schema is reused; physical compatibility requires separately authorized validation.

## Read-only pilot observation (2026-09-29)

Supabase project `krlbefcfgxcsnfhrjjof` contains exactly one project matching “Chert FaceTime Test”: `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, slug `chert-facetime-test`, enabled. Its sole line is `59b3e3d0-945b-45da-b907-027103941a65`, “Mac 2 FaceTime Line”, worker `dedea298-97e0-4321-8c85-1deca994b2a0`. It was available with no current call, policy `customer_decides`, no default assistant, assignment generation 3, enabled “Line webhook” integration `946445e1-2c0f-478d-a049-72c8dd9762f2`. This is an observation, not activation authorization; recheck immediately before any future approved change. Production schema includes columns newer than this branch, so deployment requires reconciliation with the deployed migration history.

## Implementation review

Activation uses an overlay rather than changing/capturing/restoring line configuration. The line guard blocks route edits while a connector is active; draining removes the overlay and leaves the original webhook intact. This is smaller and avoids a rollback overwriting independent configuration changes.

The durable relay polls the authority rather than retaining pending HTTP decisions in memory. The worker incoming handler waits only within its existing deadline. Connector decisions enter the existing sealed-session/`start_bridge` helper under new ownership, generation and deadline checks; the legacy acceptance guard refuses connector-owned calls. Hosted inspection distinguishes rejected authorization from unavailable authority and verifies the returned scope.

Construction tests exposed two additional issues: the client rejected authoritative declines when health had prevented creating a journal entry, and strict lifecycle acknowledgement parsing initially rejected the relay's live-generation envelope. Both were reproduced before their fixes. Tests now cover a no-allocation decline tombstone and acknowledgement after relay/database restart. Resource ceilings remain 60 seconds, matching the existing CLI contract.

Review confirmed no change to the journal expiry/in-flight reconciliation rules, no historical debt settlement, no Mac or provider implementation changes, and no production writes. Remaining deployment constraints are recorded in the runbook/results rather than inferred from synthetic success.

## Revocation review hypotheses (2026-09-29)

The review reproduced two management defects: `drain` can replace `revoked` with `draining`, restoring connection-credential authentication, and the blanket one-line check can block revocation after a drained project gains another line. This follow-up remains local/isolated; no production migration, deployment, enrollment, activation or live test is authorized.

Required predicates: revocation is terminal for the original connection credential, including subsequent/repeated/concurrent drain and restart. The separate recovery credential must retain access only to existing owned work. Exactly-one-line selection remains mandatory for enrollment/activation, but cannot prevent an authorized owner/admin from draining or revoking an existing binding. Management must still scope the binding to the authenticated project, preserve membership checks, ownership pins and receipts, and leave line routing unchanged.

Add deterministic real-PostgreSQL regressions before changing the existing, undeployed connector migration. Check both reported sequences, foreign membership/binding rejection, retained enrollment/activation cardinality gates, durable recovery and concurrent drain/revoke ordering. Run the supported Node 22/24 matrix, review locking and grants, and retain the historical evidence/debts with a fresh preservation baseline. No deployed migration is being edited or applied.

### Follow-up implementation review

Both reported failures were reproduced before editing SQL. Management now preserves `revoked` through drain and gates exactly-one-line cardinality only for enrollment/activation. Retirement locks the scoped binding's own line before the project/binding rows, maintaining the runtime's line-before-binding order even when a newly added line sorts first. The binding state is reread under its lock; both drain/revoke transaction orderings end revoked. Membership and scoped binding checks, activation compare-and-swap, runtime credential rejection, recovery restrictions, ownership pins, receipts, grants and line-routing guards remain intact. Tests also exercise database restart and retained recovery access. Only the undeployed management function changed; no runtime, CLI, journal or relay implementation changed in this follow-up.
