# Backend integration results

Implemented locally across `chert-facetime-cli` and `chert-facetime`. No production migration, deployment, activation, live room/session/call, Mac change, package publication, commit or push occurred. No other agent was started. Existing unrelated work was preserved.

## Implemented

- Owner/admin enrollment through existing Chert authentication and project membership, with exact project/sole-line confirmation. Separate random connection and recovery credentials are hashed centrally and saved once in a protected local file. Project API keys cannot administer bindings. Enrollment/check/reconnect remain inactive until explicit activation.
- Transactional activation with expected previous binding and line assignment generation, production-only activation, immutable per-call ownership, controlled replacement/draining and connection revocation. Routing is an overlay: the existing webhook configuration is untouched. A legacy call blocks initial activation; accepted connector calls stay with their original binding.
- A private Node HTTP/WebSocket relay with encrypted public transport, generation leases, bounded requests/frames, duplicate-decision idempotency, conflicting/stale/foreign decision rejection and backpressure. It carries signaling only. The authority stores decision receipts, lifecycle delivery/acknowledgements and reconciliation state durably.
- Connector-owned incoming handling reaches the existing BYOR validator, credential sealer and `start_bridge` worker-command helper. Legacy webhook acceptance cannot take over a connector-owned call. Unactivated webhook/managed routes remain compatible in the existing full suite.
- Installed CLI commands: projects, lines, bindings, enroll, activate, drain, revoke, check/status/run and `run --recovery`. Diagnostics distinguish binding authorization, activation/connectivity, authenticated hook health and local cleanup debt. Health checks allocate nothing; the CLI never starts the customer agent.
- A scoped authoritative decline without local allocation now records a tombstone instead of disconnecting. Unknown accepts and foreign-scope receipts remain rejected. Earlier expiry and in-flight reconciliation fixes remain covered and unchanged.
- Railway configuration, npm-first deployment/supervision, durable-state handling and a concrete pilot activation/rollback runbook. No mandatory Docker or separate SDK was introduced.

## Red-before/green-after evidence

| Boundary | Observed failure before fix | Final evidence |
| --- | --- | --- |
| Database enrollment/activation | Two tests failed because the authority RPC did not exist | Real isolated PostgreSQL membership, cardinality, CAS/concurrency, revocation, ownership and recovery tests pass |
| Hosted CLI configuration | Encrypted hosted configuration was rejected | Hosted config and plaintext rejection tests pass |
| Health-gated decline | Receipt threw `forbidden` without a journal intent | Scoped tombstone regression passes; no allocation/debt |
| Incoming route selection | Connector-pending request fell into legacy decline | Connector authority wait and expired-deadline tests pass without webhook delivery |
| Replayed lifecycle acknowledgement | Strict parser rejected the live-generation envelope; two deliveries remained unacknowledged | Restart/replay test acknowledges both and retains the authoritative receipt |

Raw failure records: [database](BACKEND_DATABASE_RED.txt), [hosted CLI](BACKEND_CLI_RED.txt), [decline](BACKEND_DECLINE_RED.txt), [incoming route](BACKEND_INCOMING_RED.txt), [replay](BACKEND_REPLAY_RED.txt).

The integrated test uses an actual disposable PostgreSQL cluster, the production ConnectorBackend class and deployment relay server. It exercises WebSocket duplicate acceptance, one sealed session/one `start_bridge`, conflicting duplicate rejection, stale generations, database/relay restart, reconciliation and terminal replay. The installed tarball test exercises TLS enrollment/activation with an isolated login fixture, then the installed CLI plus real adapter and fake LiveKit/hook endpoints through this database authority/relay to acceptance, terminal delivery and verified zero local debt. The login fixture is not evidence of a deployed Supabase login; no real LiveKit or FaceTime endpoint participates.

## Validation actually run

| Check | Node 22.23.2 | Node 24.14.0 |
| --- | --- | --- |
| CLI full suite (including clean tarball install) | 248 passed | 248 passed |
| CLI typecheck / lint / build | pass | pass |
| 20-call synthetic transport proof | 20 commits, zero resources/debt | 20 commits, zero resources/debt |
| Control-plane full suite | 251 passed, 1 skipped; 30 files passed | 251 passed, 1 skipped; 30 files passed |
| Final installed/integrated service recheck | 3 passed | 3 passed |
| Control-plane typecheck / lint / build | pass | pass |
| Relay syntax checks / tests | pass / 3 passed | pass / 3 passed |

Database tests replay migrations into a new Unix-socket-only PostgreSQL 15.14 cluster; they do not connect to production. `CHERT_TEST_POSTGRES_BIN` and `CHERT_TEST_CLI_ROOT` were explicitly enabled. The one existing skipped test requires external `CHERT_TEST_PGTAP_SQL`; that dependency was not configured. No connector/database/integration test was skipped. Supabase migration-history correctness on the deployed PostgreSQL 17 baseline is not established by SQL replay.

The first control-plane build failed at the existing reset-password prerender because public Supabase configuration was absent. Both supported builds then passed with explicit synthetic loopback build configuration, without production credentials. See [Node 22 logs](BACKEND_VALIDATION_NODE22.txt) and [Node 24 logs](BACKEND_VALIDATION_NODE24.txt).

`git diff --check` and a changed-file whitespace scan including new files pass. The repository-wide documentation checker remains blocked only by two pre-existing unindexed files: `PATENT_TECHNICAL_DISCLOSURE.md` and `output/fleet-investigation-2026-09-29.md`. Their content was not changed. The new documentation is indexed; this result is not reported as a clean global docs check.

## Pilot verification, compatibility and preservation

Read-only production lookup identified one “Chert FaceTime Test” project and its sole line, currently using an enabled Line webhook, customer-decides policy and no default assistant. Stable identifiers and observed assignment generation are in the [brief](BACKEND_INTEGRATION_BRIEF.md); revalidate them immediately before a separately approved activation. No routing change was made.

Source inspection confirms the existing Swift `start_bridge` payload fields and one-shot credential-redemption path match the unchanged helper reused by the new authority. No Mac changes are expected. Physical compatibility, decoded audio, conversation, FaceTime and video remain pending; synthetic success does not establish them.

[Preservation verification](BACKEND_PRESERVATION_CHECK.json) confirms all 96 pre-existing historical evidence/state files checked are byte-for-byte unchanged, including both unresolved historical debts. New evidence is stored separately. [Exact changed files](BACKEND_CHANGED_FILES.json) lists both repositories; historical source/README work was preserved and updates were scoped to this integration.

## Remaining limits and deployment gate

- No backend/relay has been deployed, and no real connector enrollment/activation or call has been qualified. Production has newer schema columns than this checkout, plus historical duplicate numeric migration versions in source. Resolve the deployed migration/release baseline before applying the additive migration; do not renumber or fabricate history.
- The original audio-only, five-second acceptance/four-second preparation/60-second resource ceilings remain. Longer calls/lease renewal, slow-avatar readiness, providers and video are separate work.
- Enrollment uses an existing owner/admin Supabase user access token, not a new browser/device login UI. Operational visibility is API/CLI; no dashboard UI was added. High-volume polling/ingress qualification and automated retention/recovery-token retirement remain outside this bounded pilot implementation.
- Local cleanup evidence remains in the connector's journal and adapter receipts. A server lifecycle acknowledgement is not proof of resource cleanup. Keep the original state/recovery process through draining, replacement and rollback.

The [pilot runbook](BACKEND_PILOT_RUNBOOK.md) specifies deployment order, exact-target reinspection, explicit activation, rollback to the unchanged webhook and preservation of accepted calls. Before deployment, review the release/migration baseline, choose control-plane/relay domains and connector supervision/secret storage, and verify owner/admin and agent/hook prerequisites. Stop for review before production deployment or live testing.

## Revocation review fixes (2026-09-29)

Fixed both review findings locally in the existing undeployed connector migration:

- `revoked` is terminal. Subsequent or repeated drain requests retain that state, so the original connection credential remains rejected for connect, inspection and reconciliation. Explicit activation cannot restore it. The separate recovery credential still retrieves existing owned-call receipts and terminal state after database restart.
- The exactly-one-line requirement now applies only to enrollment and activation. Authorized drain/revoke operations lock the existing scoped binding's own line and remain available after another line is added, including when the new line sorts before the original. Membership and binding scope checks, routing configuration, immutable ownership and recovery restrictions remain unchanged.

Before the SQL change, both deterministic database regressions failed: `revoke → drain → connect` unexpectedly authenticated, and `drain → add line → revoke` raised `connector_requires_exactly_one_line`. [Original failing run](BACKEND_REVOCATION_RED.txt) records 2 failures. After the fix, the complete focused connector file passes all 10 tests, including the two regressions and two added transaction-order tests for concurrent drain/revoke. [Focused passing run](BACKEND_REVOCATION_GREEN.txt) also covers repeated drain, restart, retained recovery access, rejected unauthorized/unknown binding requests, unchanged routing and preserved enrollment/activation cardinality gates.

Final validation for this follow-up:

| Check | Node 22.23.2 | Node 24.14.0 |
| --- | --- | --- |
| CLI full suite, including installed tarball | 248 passed | 248 passed |
| CLI typecheck / lint / build | pass | pass |
| Synthetic transport proof | 20 commits; zero resources/debt | 20 commits; zero resources/debt |
| Control-plane full suite, including isolated database and installed CLI integration | 255 passed, 1 existing skip; 30 files passed | 255 passed, 1 existing skip; 30 files passed |
| Control-plane typecheck / lint / build | pass | pass |
| Relay syntax / tests | pass / 3 passed | pass / 3 passed |

[Node 22 log](BACKEND_REVOCATION_NODE22.txt), [Node 24 log](BACKEND_REVOCATION_NODE24.txt) and [command exit codes](BACKEND_REVOCATION_MATRIX.json) are new evidence; earlier validation artifacts remain intact. Database tests use isolated Unix-socket PostgreSQL 15.14, with database and installed CLI tests explicitly enabled. The existing pgTAP dependency skip remains unchanged. Builds used synthetic loopback configuration. These tests establish local source behavior, not deployed migration-history compatibility or physical Mac readiness.

[Final preservation and whitespace checks](BACKEND_REVOCATION_CHECKS.json) compare all 680 baseline files: only the six intended source/test/document files changed. All 108 pre-existing historical evidence/state artifacts are byte-for-byte unchanged, including both unresolved historical debts. Tracked diffs and new/changed files pass whitespace checks. The documentation checker still reports only the two previously unindexed files named above.

No production access/change, migration application, live session, Mac change, deployment, commit, push or publication occurred in this follow-up. The deployment gate and pilot limitations above remain: reconcile production schema/migration history and review relay hosting, secrets and supervision before deployment; routing must remain inactive until explicitly activated. Stop for review before those steps or supervised calls.
