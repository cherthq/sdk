# Chert FaceTime Test — standby deployment, 2026-09-30

**Later transport repair:** the relay and application were updated and passed ten minutes of remote standby observation. See [the final repair report](../transport-stability/FRESHNESS-RESULTS.md). The failed observations in this original deployment report are retained as history. Routing remains unactivated.

The reviewed backend, shared relay and production BYOR application are deployed, and the pilot binding is **standby**. Initial authenticated transport and IPC checks passed, but sustained standby qualification failed: repeated transport disconnects exhausted Node's three-start budget. Final HTTP health is 503, with Python still running, Node stopped, empty new journals and unchanged line routing. No activation, real staging, call, Mac change or npm publication was performed.

**Deployment completion is blocked on transport reliability.** The connector established three runtime connections after four deliberate authorization-test connections, then stopped reconnecting as its reviewed bound requires. No crash lock or accepted work remains; this is not historical Brodie debt. Do not activate. The owner remains available for recovery and the image/state are preserved. No timeout, retry limit, journal or frozen source was changed to hide the failure. A separate raw WebSocket diagnostic is recorded below; no root cause is asserted without evidence.

## Deployed identities

| Component | Deployed identity |
| --- | --- |
| Backend | Vercel `dpl_4ZgLa9pkVaM1WbRSJvqu7LB7wFS8`, region `iad1`; all three serving aliases verified on this release |
| Backend source | Reviewed base `cbb22ee854e26219aea92d67fa401433cdb4d84c` plus frozen release patch; backend archive SHA-256 `3335d617e8e0177fca6e7520017d82c11d6d95bdddc3cf689cb930f4eb2885ee` |
| Database | Supabase `krlbefcfgxcsnfhrjjof`; migration `20260930140442_connector_backend_compatible_release` |
| Shared relay | Railway project `1e6ab885-d595-4bfd-aac3-90ca1fc90d4f`, service `d2877bdb-d910-4e6d-b618-92b32fc7caf8`, deployment `ecced424-a7e9-46d7-a52f-314dc5555058` |
| Relay image | Railway reported `sha256:05c0850676b999a4e9eaf44cbc25e443638f2e491a0f1283ee8d8d331da67398` |
| Application | Railway `demo-agent-0-byor`, service `679aad53-1b81-4198-a4ae-1bd0cd357b19`, deployment `998b7608-c0ee-40fd-8a70-1a93af55b21c`, instance `249e6161-9b20-48e0-a5a5-b2535aaf5d70` |
| Production image | Railway reported `sha256:7b7e03ca6e0c3c51febb629132449b8352f10e1c927ec0265141b77e25a3add2`; BuildKit OCI manifest `sha256:650c2029044da74d06fa8a03f2da08990acf0ebbc66f51041c0c82cf2d2d0bcd`, image config `sha256:4cd1ac83f1143aba148271c965da14049a37808093be0a09f02a1d8d305483ed` |
| Production context | Reviewed archive SHA-256 `27e6f3b7614eee8cd73fff157a79d3bd26c192e614a667cd308880009b8342ea`; default production `runtime` target, no `/qualification` directory |
| Persistent volume | Existing `22f39489-ca8e-4c04-8d42-d6d3e194b379`, mounted at `/state`; fresh subtree `/state/chert-pilot` |
| Binding | `0b758533-1c9a-4cc0-b5a5-cfcd2464b281`, BYOR, standby, epoch 1 |
| Pilot scope | Project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`; sole line `59b3e3d0-945b-45da-b907-027103941a65` |

The Railway runtime image is not claimed byte-identical to the local Docker image or the qualification image. Its frozen input manifest and deployed supervisor/Node/state file hashes match the review. Source/package identities remain those in [the frozen release](../deployment-release/artifacts.json) and [packaging manifest](../railway-packaging/artifacts.json). Production and setup deployments report the same Railway image digest.

Backend: [deployment](https://vercel.com/chert-technologies/chert-facetime-control-plane/4ZgLa9pkVaM1WbRSJvqu7LB7wFS8). Relay: [health](https://connector-relay-production.up.railway.app/healthz). Application: [health](https://talking-head-webhook-production.up.railway.app/healthz).

## Backend release and maintenance

The exact reviewed SQL payload, SHA-256 `573a8b3aab2d2b9002bf6609d31fa439c93e8b7a505dbfd0be5ef7eb2f274d7e`, passed its PostgreSQL 17, 391-column, 40-ledger-entry and five-function preimage guards. It was applied once through the transactional migration tool. All 40 existing ledger records and their statement hashes are unchanged; precisely one new record was appended. New tables had zero rows before enrollment. RLS, private-table privileges and public/private RPC execute privileges passed. No blanket push, historical replay or row repair occurred. See [migration validation](migration-validation.json), [receipt](migration-receipt.json) and [ledger](ledger-after.json).

The candidate built with Node 24 and explicit `npx --yes npm@12.1.0 ci`. The build completed, dependency audit reported zero vulnerabilities, and authenticated project/line/connector reads passed. An invalid credential with project context returned 401. A missing project header correctly returned 400; that initial probe was corrected rather than interpreted as an authorization bypass.

Temporary write-drain enforcement was confirmed at 13:59:57 UTC, followed by full quiescence. Fresh counts showed zero active calls, pending commands, reservations, retained credential ciphertext, queued webhook deliveries or open development windows. Migration was recorded at 14:04:42 UTC. All aliases were promoted and verified before reopening. Temporary controls were fully removed at 14:08:38 UTC. The existing retired-deployment firewall fence remains, now allowing the new exact deployment and excluding the old one; no firewall draft remains. The existing Git build hold was retained. See [aliases](promoted-aliases.json), [final firewall](backend-final-firewall.json), [maintenance start](maintenance-start.json) and [end](maintenance-end.json).

Protected Vercel hosts were checked with authenticated deployment-protection bypass. An earlier direct request followed an SSO redirect; the SSO page was not mistaken for application code or a failed fence. The history preimage file initially used a different SQL array-hash encoding; the separate ledger comparison uses the reviewed `md5(statements::text)` encoding and matches all 40 entries.

## Original owner and webhook transition

The original continuous owner was stopped through its supported SIGTERM/aiohttp cleanup lifecycle at 14:10:19 UTC. Shutdown cancels refill before cleaning the owned warm room. The original process reported cleanup success and zero receipts at 14:10:20 UTC. An authenticated inventory using its original LiveKit credentials confirmed no remaining rooms or dispatch-bearing rooms. No warm slot was transferred. See [shutdown](old-owner-shutdown.json) and [provider absence](original-provider-after-drain.json).

The original volume was backed up privately before shutdown and again after verified drain, before new-state provisioning. Both local archives are mode 0600. The drained backup SHA-256 is `b911cf19458088f0a71a67dcdd5a5ee60499a3fef775dd265e9ddd65a8139ba4`; paths and checksums are in [backup evidence](original-volume-drained-backup.json). The old `/state/rooms.json` hash remained `f1c6553adef9b7ba788e0e926fbc7447849c1ae4b697dc51faf6dbe8b2a7c0d2` after provisioning and normal startup. Old files, journals and locks were not reset or recursively reowned.

**The old webhook endpoint was interrupted and remains unavailable.** Its maintenance interval began with the 14:10:19 UTC shutdown. The new image intentionally exposes only `/healthz`; `/webhooks/talking-head` now returns 404. Healthy standby was observed by 14:15 UTC and recorded with the endpoint check at 14:16:23 UTC. The unchanged legacy integration URL does not provide service until a separately reviewed routing transition. Do not place pilot calls against that legacy route.

Original image/configuration and private environment backup are retained for recovery. Do not blindly restart the old allocating startup path or restore a stale snapshot over newer receipts. Preserve the new binding, credential files, exact handler path and journals for any recovery; never reinitialize to clear a lock or bypass debt.

## Initial production standby checks and final failure

One-time root provisioning affected only the fresh subtree. Explicit initialization ran as UID/GID 10001 with the runtime volume attached; bootstrap configuration was removed afterward. Normal supervisor and both children run as UID 10001. All new directories are 0700 and state/socket files 0600. The exclusive supervisor lock is held. [Runtime inspection](production-runtime-verification.json) and [assertions](production-verification-summary.json) verify:

- Authenticated relay connection, owner/Node IPC and HTTP health; mode `standby`, session readiness `unavailable`.
- Empty owner slots, resource/operation receipts, connector entries and connector deliveries. Repeated provider inventories remained empty after startup and health checks.
- LiveKit management variables reach Python only; scoped connector connection/recovery variables reach Node only. The owner/admin management token was never deployed.
- Exact BYOR binding scope; recovery credential reports restricted recovery authority. Actual WebSocket handshakes returned `standby` for connection access and `draining` for recovery access; invalid access was rejected with 403.
- Line remains generation 3, `customer_decides`, no default Assistant, original integration `946445e1-2c0f-478d-a049-72c8dd9762f2`, no active pilot call. No binding was activated.

The application is one always-on replica, zero overlap, 70-second drain, health timeout 120 seconds, restart policy NEVER, with no linked Git/image auto-update source. Relay is one always-on replica, zero overlap, 30-second drain, bounded on-failure restarts. Both Railway services currently use `us-west2`; backend is `iad1`. [Effective inventory](effective-final-services.json) records actual settings and sole running instances.

Configuration names added: backend/relay `CHERT_CONNECTOR_RELAY_SECRET`; relay `CHERT_CONTROL_ORIGIN`, `RAILPACK_NODE_VERSION`, `PORT`; application `PILOT_VOLUME_ID`, `PORT`, `CHERT_CONNECTION_TOKEN`, `CHERT_RECOVERY_TOKEN`, normal `RAILWAY_RUN_UID=10001`. Existing provider inputs were preserved. Child allowlists exclude unused legacy parent labels/configuration.

## Qualification and remaining limits

The isolated Railway qualification passed persistence across restart/replacement, non-root permissions, credential partition, writer exclusion, graceful Node restart, retained crash-lock refusal, Python crash recovery, expiry while Node is absent, interrupted-preparation uncertainty, bounded starts, missing-journal restart/startup refusal, missing-mount startup refusal, and nonallocating startup/health. The 70-second setting produced 69.927 seconds of measured survival after first SIGTERM. See [qualification evidence](../railway-deployment/RESULTS.md) and [case clarification](../railway-deployment/CONTINUATION.md). Those substitute tests are not physical media evidence.

Live hot-detachment of a mounted filesystem remains untested; it is not an extra required packaged case. Real revocation/drain state transitions were not performed on the newly enrolled binding. Provider staging, actual audio/video readiness, physical FaceTime media and live call cleanup have not been tested in this release.

Two temporary qualification services were retired after their evidence was archived. The detached qualification volume remains in Railway's pending-deletion window until 2026-10-02; it is not claimed physically deleted. Historical CLI debts and all four failed/uncleaned Session rows are preserved. The user's explicit exception excludes only the three Brodie outbound-test Sessions from this release's drain blocker. The historical pilot owner's user-supplied provenance and exact-room absence evidence remain qualified as recorded previously.

The initial WebSocket test harness completed its handshakes but did not exit; it was corrected and rerun without any source deployment change. Runtime connection generations subsequently advanced 5 → 6 → 7. The cause of those early reconnects is not established. A later disconnect exhausted Node's bounded restart budget and changed `/healthz` to 503 (`restart_budget_exhausted_or_fatal`). Python remained running, the Node journal lock was released normally, and all new journals remained empty; see [failure isolation](failure-state-isolation.json). A 100-request backend sample contained only HTTP 200 responses; a separate 5xx query returned no entries. The subsequent failure is recorded in [final health](final-health.json); earlier healthy observations remain historical evidence only. See [transport observations](transport-stability-observation.json). A separate credentialed raw WebSocket connection held standby generation 8 for 180.301 seconds and closed normally at the diagnostic observation limit (code 1000); it did not reproduce the intermittent runtime failure or establish its cause. See [raw diagnostic](transport-close-diagnostic.json). The diagnostic container exited and its lease expired. [Final database state](final-database-blocked.json) supersedes the earlier healthy snapshot. No indefinite monitoring or automatic restart workaround was installed. Node is now stopped by its bounded restart policy. Resolve transport reliability before a controlled restart and renewed standby qualification; do not merely reset the budget repeatedly.

## Next separately authorized step

Diagnose and fix the transport disconnects within a newly reviewed change if a source modification is required; then perform one controlled restart preserving the initialized state and prove sustained healthy standby first. Then re-read the exact binding state, current line assignment generation and prior binding before a pilot-only compare-and-set activation; do not reuse this report's generation as an unchecked input. No further enrollment is needed.

After separate approval, follow the frozen runbook's bounded physical plan: at most two explicit staging operations, a roughly 70-second incoming call followed by a 20-second call, both audio directions, visibly changing agent video on FaceTime, and verified central/application/Mac/provider cleanup after each. Keep automatic refill disabled and existing readiness/decision budgets unchanged. Current process health does not establish media or customer readiness.
