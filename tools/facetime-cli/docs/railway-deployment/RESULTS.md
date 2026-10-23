# Railway deployment qualification — 2026-09-30

Subsequent execution: [standby deployment report](../standby-deployment/RESULTS.md) records the applied backend/relay release, enrolled production pilot and the later transport-reliability blocker. The observations below describe the earlier qualification run and are retained unchanged.

Latest continuation: [scope correction and concrete remaining blockers](CONTINUATION.md). The packaged missing-mount/startup and missing-journal/restart cases passed; live hot-detachment is untested but was an extra gate introduced by the earlier report. Authentication is verified. Historical cleanup and the shared release window remain outstanding.

Status: remote substitute qualification performed; production standby deployment is blocked. No binding was enrolled or activated. No real provider session was staged, no call was placed, and no Mac or customer project was changed. The existing webhook service and serving control plane were not replaced.

Follow-up at 13:41 UTC: the user supplied `CHERT_ADMIN_LOGIN_TOKEN` in their private `.env.local`. A read-only authenticated request verified **owner** membership for the exact pilot and its sole idle line. The credential file was already mode 0600; no token value was printed or copied into evidence. This resolves the credential-availability blocker recorded below. The CLI can receive that value in memory as `CHERT_USER_ACCESS_TOKEN`; no source or runtime credential change is needed. See [sanitized token verification](admin-token-check-20260930T134059Z.json). A [fresh deployment-gate check](post-token-deployment-gates.json) still finds four uncleaned Sessions, including one in the pilot, no active calls/reservations, and no connector table. The shared release cleanup gate and remaining mount-loss qualification gap remain unresolved. No deployment or enrollment followed this credential check.

## Scope and release provenance

The authorized target is Chert FaceTime Test, project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, line `59b3e3d0-945b-45da-b907-027103941a65`. Its latest recorded routing remains `customer_decides`, no default Assistant, generation 3, no current call. This observation is not an activation precondition for a later run.

The reviewed release is `byor-av-pilot-20260930-r1`, packaging `railway-20260930-r1`. [Release verification](release-verification.json) verifies the frozen archive/configuration/source hashes, including the reviewed context archive SHA-256 `27e6f3b7614eee8cd73fff157a79d3bd26c192e614a667cd308880009b8342ea`. No reviewed product source or frozen artifact was edited.

The separate upload context adds only `FROM qualification AS railway_qualification` to select the existing reviewed test target. See [context change](qualification-context.json). This image received only synthetic credentials. Its Python provider substitute denies IPv4/IPv6 socket connections, and its Node transport uses a loopback substitute authority. These tests did not use real provider credentials or production ownership records.

Railway reports deployed image digest `sha256:4861d5dfef8469da5fa8aa685b4d581cd8eeaa47a76b9588a0ba824666a5ee5c` for the primary qualification uploads. BuildKit separately reports OCI manifest `sha256:b78421c884ae0ae2f2d35e165ca167a523124b32a5995afa4638b0dee78b6164` and config `sha256:5c45bee5c029af78b91036909ae4ff669477d9e9b495a80b2b0da54321560fb5`. These are distinct identity fields, not claims of equality with the prior local image. [Build log](qualified-build-log.txt), [remote source hashes](remote-source-hashes.json), and [deployment inventory](qualification-deployments-inventory.json) retain the evidence.

## Remote resources and tests

Project `demo-agent-0-byor` (`56930118-77fc-479a-a12f-4c453e7e987c`), environment `7815a140-42c1-4238-b72d-fb2935923123`:

| Resource | Identity / purpose |
| --- | --- |
| Primary temporary service | `03e04d92-fec4-461d-ada2-30add42ee8ea`, `byor-qualification-20260930` |
| Isolated ext4 volume | `4e26cff0-5b63-44fe-a605-a18b245c6a38`, mounted `/state` |
| Negative no-mount service | `d165968f-20f5-4d47-aa59-7dbe7fa3490b`, no volume |
| First working runtime deployment | `bdfaea8e-3f8e-487b-95db-f3e446c2ea45` |
| Replacement retaining original claim | `517ddbb2-8279-4d14-8caf-38c1b3e7a11c` |
| Uncertainty/missing-journal deployment | `e6182de9-fa77-4b43-b7a7-8f3a9708acd7` |
| Negative no-mount deployment | `b5ac8e2c-5134-4c10-bdb0-db441d516fe7` |

| Railway scenario | Evidence and outcome |
| --- | --- |
| Startup and repeated health allocate nothing | PASS, [initial output](initial-output.txt) |
| UID 10001, private directories/sockets, child credential partition | PASS, same output; environment values were not printed |
| Second writer exclusion | PASS, same output |
| Railway restart preserves claim without another allocation | PASS, [restart](restart-reopen-output.txt) |
| New deployment on same volume preserves claim | PASS, [replacement](replacement-reopen-output.txt) |
| Graceful Node restart leaves Python alive | PASS, [Node restart](graceful-node-output.txt) |
| Python SIGKILL reopens exact claim and verifies terminal cleanup | PASS, [failure scenarios](failure-tests-output.txt) |
| Node SIGKILL retains crash lock; whole-service restart does not clear it | PASS, [crash-lock reopen](crash-lock-reopen-output.txt) |
| Python expiry/cleanup continues while Node is unavailable | PASS, [failure scenarios](failure-tests-output.txt); reviewed synthetic short-TTL fixture only |
| Child restart budget bounded | PASS, same output; owner exhausted three starts and stayed stopped |
| Interrupted preparation remains uncertain without repeat creation/guessed deletion | PASS, [uncertainty](uncertainty-missing-output.txt) |
| Missing journal refuses child restart and normal startup | PASS, same output; owner continued running |
| Missing mount refuses startup | PASS, [no-mount logs](no-mount-log.jsonl) |
| Actual mount loss while a child restarts | UNVERIFIED; missing-journal restart and source mount checks are not equivalent evidence |
| Platform termination grace | PASS with 70-second setting: 69.927 seconds of measured survival after first SIGTERM; [timing result](grace-timing-70-result.json) |
| Production target on Railway with real enrolled standby transport | NOT RUN; prerequisites blocked |

Effective normal test settings were one replica, sleeping disabled, zero overlap, `/healthz` on port 8080, healthcheck timeout 90 seconds, restart policy NEVER. Root UID 0 was used only for isolated provisioning/holding phases; runtime children were UID/GID 10001. No public qualification domain was created. Empty standby health means IPC/transport liveness, not media readiness.

The final timing probe ran as PID 2 behind Railway's `/run/podman-init`, on the same qualification image and volume. Deployment `2e97fa66-57e5-4845-a6cb-78552ef9d244` received SIGTERM at epoch `1790773631.0992465`, received a second SIGTERM 21.986 seconds later, and durably recorded heartbeats through epoch `1790773701.0260417`. Replacement `c3659060-4d11-45c0-b6ea-2c4f08297dbd`, instance `06429f69-2c6b-458d-9a8a-21e05355e514`, then mounted the same volume. The 70-second effective setting therefore demonstrably exceeds the required 65-second minimum from the first signal. Use 70 seconds for a future production launch, not Railway's default. The previous 65-second test recorded 64.667 seconds at one-second sampling resolution, consistent with its setting but insufficient to prove the strict minimum independently.

The initial frozen-process test could not timestamp signal receipt. An early interpretation of adjacent “Stopping Container”/new-container log lines as immediate termination was incorrect: these platform log markers occur after the drain. The durable signal/heartbeat probe supersedes that inference; the frozen test is not claimed as a separate timed pass. The platform describes draining as the SIGTERM-to-SIGKILL interval in its [official teardown documentation](https://docs.railway.com/deployments/deployment-teardown).

Actual mount loss during a running child restart remains untested. The exec container's capability mask `00000000800405fb` lacks `CAP_SYS_ADMIN`; no privileged remount or platform mount detachment was attempted. Source invokes `preflight()` before child restarts, but this is source evidence, not a remote fault-injection result.

The first case's entire subtree was renamed to `/state/archived-case-1` after all test children were fenced and its three synthetic rooms were verified deleted. The original crash lock was retained. A fresh second subtree was explicitly provisioned and initialized. It retains one synthetic uncertain preparation and the preserved missing-journal fixture; this is not reported as successful cleanup.

Before resource retirement, all qualification owner/connector/probe processes were confirmed absent. The entire volume was archived into the local owner-readable file `.local/railway-deployment/qualification-volume-20260930.tar.gz` (0600), SHA-256 `b4df74c3c36c11568049d521a9c4074c392c0a5e85c56b97f86ee954cd3d3063`. Its 43 entries were checked; crash locks, original journals, missing-journal evidence, uncertain preparation, and both timing traces are retained. See [archive manifest](qualification-volume-archive.json) and [pre-archive state](qualification-pre-archive-state.json). The uncertain room exists only in the synthetic provider's local dictionary; disposing the isolated test fixture does not constitute external provider settlement.

Both temporary services were deleted after this archive was verified, at 13:10:41–13:10:47 UTC. Volume deletion was accepted at 13:10:48 UTC. Railway retains the detached volume during its deletion window: `isPendingDeletion=true`, `serviceId=null`, scheduled `deletedAt=2026-10-02T13:10:48.405Z`. It is **not yet physically deleted**. See [deletion receipts](qualification-retirement.json), [volume deletion state](volume-retirement-state.json), and [final infrastructure inventory](railway-after-retirement.json). No temporary qualification service remains active; the private local archive and sanitized report evidence remain available. The original service/volume/settings exactly match the starting inventory.

Operational corrections: non-root custom commands required absolute Python/PATH; the working command was `/usr/bin/env PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/python /qualification/entry.py run`. Railway `redeploy` reused old launch settings, so subsequent setting changes used fresh `up` uploads. Clearing a temporary healthcheck required an empty string; null retained it. Bootstrap/probe phases intentionally have no healthcheck. An initial `/proc` environment inspection needed UID 10001, and one SSH attempt during replacement addressed a stopping container. These harness issues were corrected and passing outputs are linked above.

## Shared backend and enrollment gates

The serving backend remains Vercel `dpl_CaaB7JWXnBi7w6dYzZPz4METHBks`, source `cbb22ee854e26219aea92d67fa401433cdb4d84c`. The Git build hold remains `exit 0`; the retired-host deny rule is active, with no pending firewall draft. No firewall, alias, environment secret, schema, or migration-history mutation was made.

Fresh PG 17.6 inspection found the expected 391 public columns, 40 migration records, five shared-function preimages, and no connector table; see [schema comparison](schema-comparison.json). The operational drain gate nevertheless fails: at 13:02:51 UTC there were **four uncleaned failed Sessions**, including historical pilot Session `53945278-4dcf-4a4d-817a-73702d67799d`. There were zero nonterminal calls, executable commands, worker/line reservations, open development windows, unconsumed seals, or seals retaining ciphertext. [Corrected shared-work query](shared-work-gate-corrected.json) is authoritative. The earlier query in `shared-work-gate.json` omitted terminal `rejected` calls and used a deletion timestamp as a seal proxy; its apparent counts of 31 nonterminal calls and 199 retained seals were diagnostic-query errors, not live work.

The reviewed [backend release procedure](../deployment-release/previous-BACKEND_PILOT_RUNBOOK.md) and canonical `/Users/garygao/chert-facetime/docs/operations/CONTROL_PLANE_RELEASE.md` stop on unverified cleanup before shared quiescence/migration. The exact additive payload was therefore **not applied**, and the candidate was **not deployed**. No records were relabeled or repaired to make that gate pass. Provider settlement of historical ownership requires its original owner and credentials; the new synthetic or talking-head namespace cannot establish it.

The reserved relay project `1e6ab885-d595-4bfd-aac3-90ca1fc90d4f` remains empty. Authenticated relay authority, standby authorization and recovery verification depend on the blocked backend release and actual enrollment. No health-only relay success is claimed.

The current CLI accepts an **owner/admin Supabase user access token** for management enrollment through `CHERT_USER_ACCESS_TOKEN`. Per-line API keys are not that credential. The CLI guide explicitly documents this internal-pilot limitation and absence of browser/device login. No supported token was available in this session. No token was extracted, synthesized or substituted with a line key, and no direct-database enrollment bypass was used. Supporting normal line-key enrollment requires a separately reviewed authentication change outside this frozen deployment release.

## Existing service and production transition

Original service `679aad53-1b81-4198-a4ae-1bd0cd357b19` (`talking-head-webhook`), original volume `22f39489-ca8e-4c04-8d42-d6d3e194b379`, and deployment `93fd35f6-42dc-4dd0-bb25-f34deb478092` were not changed. Its original owner remains in continuous mode. Its supported shutdown path must stop refill and settle its owned resources before replacement; its continuous HTTP controls do not expose the manual stop/status actions. No warm slot was transferred.

The original service's nonallocating `/healthz` returned HTTP 200 at 13:07:21 UTC; see [health observation](original-webhook-health.json). No webhook event was sent as a probe.

The transition was not started: no old-owner stop, production volume backup, maintenance interval, production image installation, real credential injection, binding enrollment or new standby process. **The webhook endpoint was not interrupted by this work.** Existing historical CLI debts and Session evidence remain intact. The future image exposes only `/healthz`; replacing the old service would remove `/webhooks/talking-head` and needs the documented maintenance/recovery procedure.

## Remaining work and separate activation

1. Establish original-owner cleanup evidence for the shared release drain gate, without resetting historical debt or touching unrelated customer resources under this task.
2. Credential availability resolved by the 13:41 UTC owner-session verification above. Use that protected value as `CHERT_USER_ACCESS_TOKEN` and revalidate its session when the remaining release gates pass; line-key enrollment remains outside this reviewed release.
3. Packaged mount/state refusal cases are verified, as clarified in [the continuation](CONTINUATION.md). Once cleanup and the release window are established, execute the guarded backend/relay release with fresh state and coordinated release controls. Live hot-detachment remains untested; no pass is claimed for that additional scenario.
4. Retire the old continuous owner safely, back up its volume, record the maintenance/recovery interval, provision the fresh subtree, and deploy the production target with a new BYOR binding in standby. Verify authenticated transport, both IPC probes, zero ready slots/new provider allocations, and unchanged routing.
5. Only after standby passes, separately review activation using freshly read binding/generation CAS values and the runbook's bounded physical plan: at most two explicit stages, a roughly 70-second call then a 20-second call, both audio directions, visible changing FaceTime video, and verified cleanup after each. None of those actions is authorized or performed by this qualification.

Substitute tests do not establish real provider timing, decoded media, FaceTime compatibility, media readiness or customer readiness.
