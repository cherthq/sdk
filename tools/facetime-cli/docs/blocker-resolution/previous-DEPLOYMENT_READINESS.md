# First connector deployment readiness

Status: **BLOCKED for deployment; preparation and isolated rehearsal complete.**
Observed 2026-09-30 UTC (2026-09-29 America/New_York). Scope is the sole
**Chert FaceTime Test** pilot. No production SQL, enrollment, activation, live
session, Mac operation, deployment, secret rotation, publication, commit or push
was performed. Following the later explicit request, an **empty private Railway
project** was created using the existing authenticated browser session; no service,
secret, ingress or deployment was created.

## Release baseline and source selection

| Component | Verified baseline |
| --- | --- |
| CLI checkout | `54db70ba5f18d2cc8d36053352186af6c1287847`, plus substantial pre-existing uncommitted implementation |
| Chert checkout | `e9dddcda52865d85e6295196cdda5690ab57f736`, plus local connector implementation and unrelated user work |
| Serving control plane | Vercel `dpl_CaaB7JWXnBi7w6dYzZPz4METHBks`, READY, CLI upload, declared source `cbb22ee854e26219aea92d67fa401433cdb4d84c`, Node `24.x`, region `iad1` |
| Serving origins | `https://facetime.trychert.com`, `https://chert-facetime-control-plane.vercel.app`, and the team alias all resolve in authenticated alias metadata to that deployment |
| Non-serving production pointer | `dpl_5hvNa9Bhou2n747iqoNfT5o5CZTb`, CANCELED, SHA `ec45dbb9…`; do not use it as deployed truth |
| Supabase | `krlbefcfgxcsnfhrjjof`, PostgreSQL **17.6**, platform version `17.6.1.155`, `ca-central-1` |
| Migration ledger | 40 recorded entries, ending `20260924200520 / outbound_byor_video`; no connector migration/table |
| Release controls | Vercel project `prj_sNxcJ3Agi9urdLD4XYaKpe73jsP5`, team `team_Z3LEzgyI0Ki1wEurc5kaLy01`, root `control-plane`, Git hold `exit 0`; active retired-host deny rule `rule_line_release_quiesce_Zr6KPK`, firewall v57, no draft |

The deployment's declared Git SHA is verified metadata, **not a proof of every
uploaded byte**: `source=cli`, `gitSource=null`. Obtain the original upload's
runtime-file digest/receipt before asserting a byte-identical rebuild. Exact
Node patch version of the serving function was not exposed by this metadata.

[Serving aliases](deployment-preparation/serving-aliases.json),
[deployment](deployment-preparation/serving-deployment.json),
[project/env names](deployment-preparation/vercel-project.json),
[firewall](deployment-preparation/firewall.json), and
[ledger with statement digests](deployment-preparation/production-ledger-digests.json)
are fresh read-only evidence. No environment values were printed or saved.

**Do not deploy either dirty checkout wholesale.** A separate uncommitted candidate
was assembled under `.local/deployment-preparation/candidate` from the serving
SHA, with only the connector changes overlaid. The three changed shared
TypeScript files were merged onto the newer deployed implementation. A conflict
in `data-access.ts` was resolved by retaining the deployed audit/admin functions
and adding `connectorData`; no deployed features were removed.

The reviewable [candidate patch](deployment-preparation/candidate.patch) and
[file/hash allowlist](deployment-preparation/candidate-files.json) identify the
exact delta: two API routes, connector service, three shared TS additions,
compatible connector migration, connector tests, catalog-capable isolated test
helper, four new compatibility regressions, and relay source/configuration.
Swift, managed-agent, unrelated plans, patent material, historical evidence and
user edits are not part of this delta. The candidate's deployed base already
contains the newer dashboard, signing, audit, outbound and video behavior.

## Schema discrepancies and compatibility correction

The old checkout's pre-connector schema lacks **105 production columns** and has
**five different nullability definitions**. All five are nullable unsigned-signing
references/versions in integration revisions, webhook events and delivery attempts.
Production-only areas include project identity/status, automatic readiness,
worker onboarding, media observations, platform administration, memberships,
audits/notifications, optional signing, video framing and outbound fingerprinting.
The complete machine-readable [column discrepancy list](deployment-preparation/column-discrepancies.json)
and [12 missing source migrations](deployment-preparation/migration-discrepancies.json)
are authoritative for the enumeration. The old-schema comparison used local
PostgreSQL 15.14 SQL replay solely to describe checkout differences; it is not the
production compatibility rehearsal.

Historical `0013_additional_project_creation.sql` and
`0013_project_livekit_allowed_hosts.sql` share the numeric prefix. Production uses
timestamped receipts and several separate release-transport amendments. Examples:
optional signing source `20260915191435` maps to ledger `20260915191852`, audits
source `20260921044014` to `20260921142141`, outbound video source `20260924194048`
to `20260924200520`. Source filename equality is not an applied-history test.
No historical file was renumbered; no ledger row was fabricated or rewritten.

The original connector migration is unsafe against production:

| Replaced function | Lost deployed behavior | Candidate correction |
| --- | --- | --- |
| `facetime_pin_call_integration` | Unsigned integrations can pin without a signing key | Retain `found OR NOT r.signing_enabled` alongside connector pins |
| `facetime_pinned_incoming_context` | Explicit unsigned-signing discriminator | Retain `webhook_signing_enabled` alongside connector pending context |
| `facetime_guard_incoming_accept` | Worker automatic-readiness locking/checks and unsigned acceptance | Start from deployed definition, add connector-authority rejection |
| `facetime_enqueue_call_webhook` | Outbound `call.started` emitted at `bridge_ready`, not native `active` | Start from deployed definition, suppress legacy delivery only for connector-owned calls |

The separate connector decision path also bypassed the deployed automatic
readiness predicate. The candidate now checks enabled/accepting/fresh automatic
readiness under the worker lock before sealing, then rechecks freshness after
sealing; failure rolls back the session, seal, command and receipt. Legacy workers
without automatic readiness retain their deployed behavior. This is a narrow
compatibility correction, not a new Mac requirement or media feature.

[Compatible SQL](deployment-preparation/connector_backend.compatible.sql) and
[guarded migration payload](deployment-preparation/migration.payload.sql) are the
release artifacts. The original undeployed SQL in the user's Chert working tree
is unchanged. **Use the candidate/payload, never that original file by itself.**

Apply only this new payload through an approved atomic migration transport after
fresh ledger/schema verification and normal coordinated drain/quiescence. It
checks PostgreSQL major 17, connector absence, and exact preimage digests of all
four shared functions. Recheck the entire recorded ledger and catalog, not just
those four guards. Supabase `apply_migration` should create one new transport
receipt named `connector_backend_compatible_release`; record its actual generated
version and SQL digest after success. Do not insert a guessed historical version,
run `db push`, replay the old activation SQL, or apply both connector variants.
An uncertain result requires read-only ledger/schema inspection before retry.

## Isolated rehearsal and limits

Read-only catalog queries captured public columns/types/defaults, 13 enums,
33 tables, 263 constraints (including one constraint trigger), 44 non-constraint
indexes, 37 triggers, 10 policies, 77 functions and their ACLs/owners. No table
rows, customer data or secret values were copied. The
[catalog builder](deployment-preparation/build_catalog_baseline.py) creates a
[public schema baseline](deployment-preparation/production-public-baseline.sql).
The constraint trigger is reconstructed from its trigger definition, not as an
ordinary ALTER TABLE constraint.

PostgreSQL **17.6** was built in a temporary directory from the official source
archive with its published SHA-256 verified. Rehearsals used disposable,
Unix-socket-only clusters. This matches production's major/minor PostgreSQL,
but not Supabase's full extension set, Auth, PostgREST, platform patches, role
memberships/default privileges, production collation, scale or real workload.
`auth.users`, `auth.uid`, `auth.role`, and `auth.jwt` are explicit minimal local
fixtures. Public table/function ACLs and RLS policies were restored. Sequence
ACLs, full auth schema and platform-managed schemas are not reproduced. These
limits remain release checks; this is more specific than claiming a full
production clone.

| Validation | Result |
| --- | --- |
| Original SQL against catalog baseline | Three behavioral regressions reproduced: unsigned pin failure, stale-readiness acceptance, early outbound notification |
| Connector readiness regression | With valid synthetic seal inputs, original path accepts a stale automatic worker; corrected path rejects before allocation |
| Catalog compatibility suite, Node 22.23.2 and 24.14.0 | **95 passed each**; 5 explicitly skipped: four historical pre-line-integration migration tests inapplicable to the already migrated baseline, plus existing optional pgTAP test |
| Coverage | Existing webhook and managed routes, unsigned signing, automatic readiness, outbound audio/video SQL contracts, membership/grants, binding ownership, activation races, permanent revocation after drain/additional lines, installed CLI/real relay, duplicate decisions, database/relay restart, lifecycle replay, recovery and cleanup |
| CLI full suite, both Node versions | **248 passed each**, including clean tarball consumer and no-allocation diagnostics |
| Control-plane candidate | Typecheck, lint, migration validator passed; synthetic-config builds passed on both Node versions |
| Relay | Syntax and 3 security tests passed on Node 22.23.2 |
| Synthetic transport proof | 20 calls; inspect retained proof for latency/counts; no real provider or media |
| Atomic SQL rehearsal | Apply succeeds with zero bindings/deliveries; forced late failure restores all shared functions and removes new objects; drift and second application rejected |

The first combined catalog run included four old migration-history tests that
try to reapply the already-installed line-integration migration; those failed on
missing old constraints/deletion guards. Logs are preserved. They were then
explicitly excluded by name, not reported as compatibility passes. Initial
exporter/path/test-fixture and symlinked-Turbopack setup errors are retained
separately; the final build used a clean candidate-local `npm ci --ignore-scripts`.
The final four compatibility regressions also pass independently.

New evidence is entirely in `docs/deployment-preparation/`. Historical Node 22/24
results remain historical; these new results establish neither decoded audio,
FaceTime, video, customer-agent readiness nor physical Mac compatibility.
Manual `CHERT_USER_ACCESS_TOKEN` enrollment remains required. The enforced
five-second decision/four-second preparation/**60-second resource ceiling** remains.

A fresh `npm audit --omit=dev` reports **Next 16.3.1 critical and sharp high**
advisories in the inherited deployed dependency set. This task did not update
unrelated dependencies. Review applicability and a separately tested patch before
release; [audit details](deployment-preparation/candidate-runtime-audit.json)
contain the advisory URLs and suggested versions. Do not apply `npm audit fix`
blindly to the release artifact.

## Pilot and installed Mac evidence

[Fresh pilot observation](deployment-preparation/pilot-observation.json): project
`5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, slug `chert-facetime-test`, enabled; sole
line `59b3e3d0-945b-45da-b907-027103941a65` (“Mac 2 FaceTime Line”); worker
`dedea298-97e0-4321-8c85-1deca994b2a0`; assignment generation **3**;
`customer_decides`; no default Assistant; enabled Line webhook
`946445e1-2c0f-478d-a049-72c8dd9762f2`; available, no current call.
Connector table absence establishes no connector binding in this database.
These values must be rechecked at release/enrollment/activation time.

At 02:21:38 UTC there were zero nonterminal pilot calls and zero queued/leased
worker commands, but **one failed Session with `cleaned_at=null`**, failed
2026-09-28. Its call is failed, seal tombstoned and ciphertext absent. This is not
proof of a live resource leak, and not proof of verified cleanup. Resolve the
release drain predicate through read-only evidence/ordinary cleanup; do not mark
it cleaned or delete it to pass. This is distinct from the two historical CLI
adapter cleanup debts, which remain unchanged and quarantined.

The Mac's fresh heartbeat reports software `0.1.0` and build digest
`1ee0d259cfb71fca55a8c11c3bcd8eeb2c2ecc3824bfb409473195d1882affae`;
`production_media_ready=true`, `audio_ready=false`, no evidence-build/time. These
are different telemetry predicates, not a physical acceptance result. Audit
runner metadata names approved release `647b9f66ce39a5e37634b50f28f0a11dc7583558`,
which is not present in the inspected checkout. No current binary-to-source
mapping or local Mac process/configuration inspection was obtained.
[Build observation](deployment-preparation/mac-build-observation.json) and
[cleanup/audit observation](deployment-preparation/pilot-cleanup-observation.json)
retain the evidence. The existing `start_bridge` v1 payload and one-use credential
redemption are reused; no worker update is planned. Obtain a read-only installed
release manifest/binary digest mapping before claiming Mac compatibility.

The user's “Chert Internal Test” reply was clarified to **Chert FaceTime Test**;
it does not identify a customer agent/connector host. Local LiveKit CLI has no
usable configured project. Missing: actual host/OS/owner, agent repository or
deployment ID, exact dispatch name/deployment/boot ID, WSS project URL/fingerprint,
literal `http://127.0.0.1:PORT` hook, its HMAC secret provisioning path, capacity,
and exact-session readiness/cancel/expiry implementation. A Cloud agent's Running
status or generic health endpoint is insufficient. No agent was started.

## Hosting and configuration decisions

Created the requested dedicated Railway project **`chert-facetime-connectors`**,
ID `1e6ab885-d595-4bfd-aac3-90ca1fc90d4f`, workspace
`4d1ddeeb-ba8e-4bd8-a411-3b5a0cf1adcd` (existing Yannaner’s Projects workspace).
Its default `production` environment is `ef40a0a1-6968-4a30-92e0-1b7e8d613b1b`.
The project is private and empty; [creation metadata](deployment-preparation/railway-project.json)
records the browser-verified result. Proposed service configuration is
one always-on `connector-relay` service, root `/connector-relay`, US East region
near Vercel `iad1` and the Canada database, no relay volume, no sleep, no automatic
replicas. The service/region remain proposed configuration.
Both stored Railway CLI credential forms returned `Not Authorized`; the existing
browser session succeeded. Restore CLI access only if the approved release uses
CLI deployment. Use the platform-issued
HTTPS domain as the relay origin once recorded; do not invent its hostname.
An optional `connectors.trychert.com` alias is a proposal requiring DNS ownership
verification and approval, not a verified endpoint.

Control origin is **`https://facetime.trychert.com`**. Relay public ingress must
terminate trusted TLS and support WSS `/connect`, HTTPS POST `/inspect` and
`/reconcile`; internal service port is HTTP on platform `PORT`. No redirects may
receive bearer credentials. `/healthz` is liveness only. Validate the provider
certificate chain and WebSocket upgrade after deployment without dispatching.

[Railway config](deployment-preparation/railway-relay.json) pins singleton,
no-sleep, health timeout, zero deployment overlap, 30-second termination grace
and bounded restart retries. It was checked against the downloaded official
[Railway schema](https://railway.com/railway.schema.json); teardown controls are
also documented in [Railway config reference](https://docs.railway.com/config-as-code/reference).
The service platform behavior still needs verification after an approved deployment.
Use relay/connector **Node 22.23.2** (`RAILPACK_NODE_VERSION=22.23.2` for relay),
which was exercised here. Node 24.14.0 is also CLI-tested. Preserve control-plane
Vercel `24.x`; verify its exact build runtime instead of promising patch pinning.

| Configuration/secret | Owner and provisioning |
| --- | --- |
| `CHERT_CONNECTOR_RELAY_SECRET` | Chert operations: generate at least 32 random characters directly in the approved secret manager, provision identical value to Vercel production and new Railway service. Currently absent in Vercel env-name metadata. Never log or put in argv. No existing key rotation required. |
| Existing Supabase keys, `FACETIME_CREDENTIAL_PEPPER`, destination encryption key/version, cron/audit/mail settings | Existing Chert platform owners; preserve exact current values/targets. Relay receives none of these. Never `env pull` for this preparation. |
| `CHERT_CONTROL_ORIGIN`, `RAILPACK_NODE_VERSION`, `PORT` | Chert operations; origin above, pinned relay Node, platform port. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CHERT_HOOK_SECRET` | Customer agent operator; inject on selected same-host connector, owner-only secret manager/environment file. Keys never reach the control plane/relay except scoped call credentials. |
| `CHERT_USER_ACCESS_TOKEN` | Authorized project owner/admin; existing login, short-lived management-shell injection only; unset after management. No project API key or invented browser-login command. |
| Connection/recovery credentials | Returned once by standby enrollment, owner-only credential file referenced by generated config; runtime env names `CHERT_CONNECTOR_TOKEN` and `CHERT_RECOVERY_TOKEN`. Keep a protected recovery copy with the original config/journal/adapter receipts. |

Customer connector: npm companion process, independently operated agent on the
same host/network namespace (literal loopback hook restriction), persistent
owner-only directory 0700/files 0600, one writer, no automatic replicas. The
[systemd template](deployment-preparation/chert-connector.service) is a **Linux
proposal**, not a verified host installation: dedicated unprivileged account,
Node path pinned, 45-second stop grace, delayed restart on transport exit 6,
stop on config/state/platform/debt exits. Verify account/path/filesystem semantics
on the selected host. Do not install it on a Mac; select a reviewed launchd
configuration if the actual host is macOS.

Relay restart immediately terminates sockets; DB leases expire in five seconds,
new connections increment/fence generations, supervisor reconnects using the same
state. Polling is every 200 ms per connection through a two-second authority
request timeout; measure capacity/latency before expanding beyond one pilot.
Activation/drain closes the socket and requires supervised CLI restart. The
relay is not a graceful in-memory call owner: accepted/uncertain work is durable
in the authority and original connector journal. Reconciliation/lifecycle must
stay available across releases; healthy `/healthz` does not prove that path.

## Artifacts, remaining gates and next authorization

[Artifact manifest](deployment-preparation/artifacts.json) pins private CLI
`chert-local-transport-proof@0.0.0`, control-plane source archive and relay source
archive. The provisional npm name/version and `private:true` are retained; no npm
publication is proposed. Build output produced with synthetic configuration is
**test evidence only**, excluded from source archives and never uploaded as a
production `.next` build. The [pilot runbook](BACKEND_PILOT_RUNBOOK.md) provides
commands, observations, stop conditions and rollback.

Final preservation verification checked **1,340 pre-existing files**: only the
pilot runbook changed, and its original text remains byte-for-byte in the historical
section. All 22 pre-existing `.local` state/evidence files, including both unresolved
cleanup debts, are unchanged. No pre-existing file is missing. See
[preservation verification](deployment-preparation/preservation-final.json).
The patch applies cleanly to the declared serving base and recreates all 21
allowlisted candidate files. Source archives exclude installed dependencies and
generated builds; [freeze script](deployment-preparation/freeze_artifacts.py)
recreates their deterministic hashes. Local report/runbook links and tracked
whitespace checks pass. Railway configuration passes draft-2020-12 schema validation.
The Chert documentation checker still reports two pre-existing unindexed files:
`PATENT_TECHNICAL_DISCLOSURE.md` and `output/fleet-investigation-2026-09-29.md`;
neither was changed.

Deployment remains blocked by: inherited dependency advisory resolution; original
serving upload provenance; fresh whole-schema/ledger verification and coordinated
maintenance controls; uncleaned pilot Session evidence; an identified compatible
customer agent/connector host; and verified ingress after approved relay deployment.
Railway project creation is complete; CLI authentication remains unavailable.
Mac installed-source mapping and physical readiness remain gates for activation
and supervised testing even if backend deployment is approved first.

The next **backend deployment authorization**, once those gates are resolved,
would permit applying only the guarded migration payload, provisioning its new
shared secret, deploying/promoting the exact reviewed compatible control-plane
and singleton relay artifacts, and the specific coordinated firewall maintenance
changes. It would **not** permit enrollment, routing activation, reassignment,
live LiveKit/FaceTime tests, Mac changes, publication, commits or pushes. New
Railway project creation was separately requested and completed during preparation. Enrollment/connector start, explicit pilot activation, and bounded
supervised audio testing each remain distinct later stages. Do not widen this
pilot to other projects.
