# BYOR-first pilot amendment — review only

The primary pilot for **Chert FaceTime Test** now uses `chert byor` and an
application-owned session callback. The older hook/dispatch instructions below
are historical create-room preparation, not prerequisites for BYOR. The local
wrapper is implemented; no deployment or live qualification is authorized.

1. Review [BYOR implementation results](byor-implementation/RESULTS.md) and the
   [ownership contract](BYOR_OWNERSHIP.md). Regenerate the candidate artifacts listed
   there from the newer serving baseline; never deploy the original dirty-checkout
   migration wholesale or reuse the historical tarball/payload hashes.
2. Connect the application's **existing session owner** to the generated TypeScript
   callback and qualify readiness, idempotent lifecycle and recovery without an
   HTTP receiver. The current talking-head session owner is Python with a warm-slot
   lifecycle. Its healthy receiver is not this callback: a qualified application
   bridge remains necessary before using it in this pilot. No special
   `chert-adapter-v1` hook or rewritten dispatch envelope is required by BYOR.
3. Prepare fresh mode-v2 config using `chert init --mode byor --config BASE
   --state-dir FRESH_PRIVATE_STATE --handler-module ABSOLUTE_COMPILED_MODULE
   --handler-id IMMUTABLE_APPLICATION_RELEASE`. Start the customer's agent normally;
   the CLI must not start/restart it. Keep module initialization and health free of
   allocation, dispatch or paid preparation. Keep original historical debts/state.
4. After separate deployment/enrollment authorization, freshly verify the exact
   project/sole-line IDs below, owner/admin and route generation. Enroll BASE in
   standby with new config/credential paths. Require returned scope.session_mode
   `byor`. Check authorization, application capability/health and zero local debt;
   `chert byor --config CONFIG --json` starts standby transport without activation.
5. Explicit activation remains a separate action with fresh CAS values and the
   previous binding ID. Keep old bindings, original modes/modules/state and
   recovery credentials until their calls are fully settled. BYOR recovery uses
   `chert byor --config ORIGINAL_CONFIG --recovery`; legacy v1 uses `run --recovery`.
6. Separately authorize supervised audio qualification only after application and
   Mac compatibility review. The decision budget remains five seconds/four-second
   preparation. BYOR uses the explicit application expiry (the talking-head record
   describes 600-second calls), within its token and Chert's two-hour limit; the
   create-room-only 60-second cap must not truncate this pilot. No video/cold-start
   capability is inferred. No warming or provider sessions are authorized here.

Roll back new-call routing with drain. Revocation stays permanent; adding a line
cannot block drain/revoke. Neither action transfers existing session ownership.
Preserve the separate historical failed Session and both historical adapter debts.
Stop for review before deployment preparation execution or live testing.

---

## Retained prior pilot preparation (historical)

> Superseded deployment direction: the [revised product plan](../PLAN.md)
> requires a primary BYOR receiver wrapper and a separate optional room-creation
> command. The talking-head pilot must preserve its existing session logic;
> implementing the experimental dispatch/loopback-hook contract is no longer its
> default prerequisite. The wrapper is not implemented yet. Requalify the candidate
> and revise this runbook/report before executing its release steps. The evidence
> below is retained; this note does not resolve historical cleanup or release gates.

# Chert FaceTime Test — staged first release

Updated 2026-09-30 UTC. **Review-only: blocked for deployment.** Follow this section
for the current candidate; the previous runbook is retained unchanged below as
historical context. See [readiness report](DEPLOYMENT_READINESS.md) for findings,
remaining gates and the limits of every test. None of the production actions
below has been executed.

Qualification update: the current talking-head agent does not implement the CLI
connector dispatch/hook contract. A tested local guard rejects accidental
connector traffic; it has not been deployed and does not implement the adapter.
See [qualification results](hook-qualification/RESULTS.md). Complete the dedicated
agent/host integration before the standby-enrollment stage below.

## Fixed scope and release inputs

- FaceTime project: `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7` (“Chert FaceTime Test”).
- Sole line: `59b3e3d0-945b-45da-b907-027103941a65`; Mac worker:
  `dedea298-97e0-4321-8c85-1deca994b2a0`.
- Saved future-call route: enabled integration
  `946445e1-2c0f-478d-a049-72c8dd9762f2`, `customer_decides`, no Assistant.
  Save its current revision/assignment and protected configuration before change;
  do not copy URL credentials or signing secrets into release logs.
- Assignment generation was 3 at preparation; **read it fresh**, never use 3 by habit.
- Control plane: `https://facetime.trychert.com`, Vercel
  `prj_sNxcJ3Agi9urdLD4XYaKpe73jsP5`, team `team_Z3LEzgyI0Ki1wEurc5kaLy01`.
- Database: Supabase `krlbefcfgxcsnfhrjjof`, PostgreSQL 17.6.
- Candidate base: `cbb22ee854e26219aea92d67fa401433cdb4d84c` plus
  [candidate.patch](blocker-resolution/candidate.patch), not the old dirty checkout.
- Reviewed artifacts and SHA-256 values:
  [artifacts.json](blocker-resolution/artifacts.json).
- SQL: [migration.payload.sql](blocker-resolution/migration.payload.sql).
  Do not also apply the unsafe original connector migration or historical files.
- Railway: empty private `chert-facetime-connectors` project created;
  project `1e6ab885-d595-4bfd-aac3-90ca1fc90d4f`, workspace
  `4d1ddeeb-ba8e-4bd8-a411-3b5a0cf1adcd`. Proposed service `connector-relay`
  has no service ID or issued domain yet. Never substitute a reference-agent service.

Use the hashes in the manifest as execution preconditions. Before any release,
refresh ledger, schema/function digests, alias targets, firewall live/draft state,
environment **names**, and active-work counts. Stop on drift and regenerate/review
only the affected candidate. A read-only preparation snapshot is not clearance.
The existing failed Session with no `cleaned_at` needs verified cleanup evidence;
its tombstoned seal alone does not satisfy the drain gate. The user's webhook
update was verified at 03:12:51 UTC: integration revision 11 points to the
talking-head Railway receiver, with signing disabled and `/healthz` + `/readyz`
returning 200. Assignment generation remains 3. The historical Session retains
its previous interview-agent ownership; do not use new-project room absence to
clear it.

## 0. Reproduce and review locally

These commands are local-only, using the prepared directory layout:

```sh
cd /Users/garygao/chert-facetime-cli
python3 docs/deployment-preparation/build_catalog_baseline.py
python3 docs/blocker-resolution/rehearse_atomic_migration.py
```

The PostgreSQL binary path is in `deployment-preparation/postgres-runtime-path.txt`;
it is a temporary locally built 17.6 runtime. If missing, obtain PostgreSQL 17.6
and update that path locally. Never use a production connection string. The
baseline SQL contains no customer rows and explicitly uses a minimal auth stub.

For the selected production-catalog compatibility matrix, use Node 22.23.2 or
24.14.0 on PATH and run from the isolated candidate's `control-plane` directory:

```sh
CHERT_TEST_POSTGRES_BIN=/absolute/postgresql-17.6/bin \
CHERT_TEST_CATALOG_BASELINE=/Users/garygao/chert-facetime-cli/docs/deployment-preparation/production-public-baseline.sql \
CHERT_TEST_CLI_ROOT=/Users/garygao/chert-facetime-cli \
npm test -- --maxWorkers=1 \
  tests/connector-production-compatibility.test.ts tests/connectors.test.ts \
  tests/connector-service.test.ts tests/connector-incoming.test.ts \
  tests/optional-signing.test.ts tests/automatic-readiness-migration.test.ts \
  tests/line-integrations.test.ts tests/webhook-core.test.ts \
  tests/line-webhook-authorization.test.ts tests/outbound-admission-wire.test.ts tests/session-cleanup-ordering.test.ts \
  -t '^(?!.*(preserves legacy ciphertext|holds activation preflight)).*$'
```

Expected: 103 passed, 5 skipped as explained in the report. The final corrected
readiness fixture also has its own four-test green record. Check typecheck/lint,
relay tests, migration validation, builds and actual tarball consumer. Resolve
any new audit findings before freezing deployment hashes. The current candidate
has patched Next/sharp/Vitest/js-yaml dependencies and a zero-advisory full audit.
Never upload the synthetic-config `.next` directory.

The revised payload additionally corrects cleanup-before-terminal event ordering.
It changes five shared functions and makes no historical data repair. The retained
failed pilot Session has worker cleanup evidence; external room cleanup still
needs verification through the previous interview agent’s LiveKit project. The
new talking-head target is identified; its connector host and authenticated
loopback-hook qualification remain unresolved. See the
[follow-up evidence and gates](blocker-resolution/RESULTS.md).

## 1. Database migration — separate backend deployment authorization

1. Follow Chert's `docs/operations/CONTROL_PLANE_RELEASE.md` on the deployed-source
   candidate. Keep Git build hold and retired-host deny rule. Select a controlled
   no-new-call window; preserve worker events, reconciliation, command completion,
   cleanup and queued delivery while ordinary processing drains.
2. Freshly inspect **all affected shared work**, not only the pilot: nonterminal
   calls, uncleaned Sessions, commands/leases, reservations, credential seals,
   queued/future deliveries, development windows and available worker outboxes.
   Do not clear records/pointers or settle either historical CLI debt.
3. Only after drain, stage/review the exact temporary all-request/direct-writer
   quiescence controls. Include cron/manual dispatch; inspect every firewall diff
   and do not publish unrelated changes. Wait for in-flight requests and recheck.
4. Compare `supabase_migrations.schema_migrations` version/name/statement-MD5 rows
   with `production-ledger-digests.json`; compare current public catalogs and five
   function preimages with the recorded baseline. No `db push`, renumber, repair,
   or replay of a prior release's `activation.sql`.
5. Through the authenticated Supabase **apply_migration** tool, target
   `project_id=krlbefcfgxcsnfhrjjof`,
   `name=connector_backend_compatible_release`, and `query` equal to the exact
   reviewed `migration.payload.sql` bytes. This is one transactional payload;
   record the transport's actual generated migration version/name and payload
   SHA-256. Do not fabricate the source filename's version in the ledger.
6. Require unchanged historical ledger digests, exactly one new receipt, two empty
   connector tables, four new call columns, expected indexes/triggers/ACLs/RLS,
   preserved shared behavior, and no enrollment/activation/configuration writes.
   On error/timeout: keep fences, inspect schema and ledger read-only before retry.

Stop on active/uncertain work, unverified cleanup, schema drift, public RPC grants,
unexpected ledger entries, partial/ambiguous SQL result or any changed other-project
routing. No down migration is used as a rollback toggle.

## 2. Control-plane deployment — while quiesced

1. Unpack the reviewed control-plane source archive into a fresh release directory.
   Its root contains `control-plane/`. Review all source hashes and production
   upload provenance (282 uploaded control-plane source files were matched). Copy the reviewed `vercel-project-link.json` to
   `RELEASE_ROOT/.vercel/project.json`; confirm root setting `control-plane` and
   Node `24.x`. Preserve all existing secrets/configuration.
2. Chert operations creates `CHERT_CONNECTOR_RELAY_SECRET` in approved secret
   storage and provisions the identical value into Vercel production and the new
   relay service. Never put it in arguments, documentation or logs. Do not rotate
   the existing credential pepper/encryption keys.
3. From the linked release root, using reviewed Vercel CLI 54.14.2:

   ```sh
   vercel deploy --prod --skip-domain --yes --scope chert-technologies
   ```

   Capture deployment ID/hostname/source digest/runtime. `--skip-domain` is not
   isolation: all aliases/hostnames remain fenced until explicitly reviewed.
4. Stage exact-new-host inclusion in the retired-host rule and a narrow read-only
   validation policy together. Keep writes/calls/dispatch fenced. Require successful
   authorized project/line/user reads and expected invalid-token rejection; no
   enrollment/probe may mutate state. Observe new API route presence from build
   manifest and authorized read checks.
5. With controls still effective:

   ```sh
   vercel promote REVIEWED_DEPLOYMENT_ID --yes --scope chert-technologies
   ```

   Read each of the three serving alias objects and require its deployment ID to
   match. Remove only this attempt's temporary fences in the runbook's order;
   keep the Git hold and retired-host denial, with the old hostname excluded.
   Verify ordinary heartbeat/poll/lifecycle/dispatcher behavior without live calls.

Stop on an unexpected alias target, stale-host write exposure, denied normal
cleanup, build/dependency failure, missing secret or unreviewed firewall draft.
Do not restore the old application alone after connector ownership exists.

## 3. New Railway relay

The requested empty private project exists: `1e6ab885-d595-4bfd-aac3-90ca1fc90d4f`,
workspace `4d1ddeeb-ba8e-4bd8-a411-3b5a0cf1adcd`, default environment
`ef40a0a1-6968-4a30-92e0-1b7e8d613b1b`. See [creation metadata](deployment-preparation/railway-project.json).
Browser authentication works; local CLI credentials are rejected. Restore CLI
authentication if needed for the approved deployment path. Service creation,
deployment and secret provisioning remain part of the reviewed backend release.

Create only the relay service in that existing project, select US East near `iad1`, set service root
`/connector-relay`, use the reviewed relay source archive and `railway.json`,
Railpack, Node **22.23.2**, singleton, sleep disabled, zero overlap, 30-second
termination grace, health path `/healthz`. No volume and no customer agent in this
service. Configure only `CHERT_CONTROL_ORIGIN=https://facetime.trychert.com`,
`CHERT_CONNECTOR_RELAY_SECRET`, `RAILPACK_NODE_VERSION=22.23.2` and platform `PORT`.
Use the Railway service deployment action with the exact archive/source directory;
record project/environment/service/deployment IDs and issued HTTPS origin.

Require valid TLS and WSS, successful liveness, invalid-token rejection, and no
body/header logging. Authenticated standby `/inspect` is deferred until enrollment;
healthz alone cannot prove it. Ensure control-plane firewall permits the intended
internal connector route and does not expose retired control-plane writers.
Stop on unknown origin/redirect, sleep/replica drift, non-pinned runtime, or a
health-only success without the later authority check.

## 4. Private artifact installation and host prerequisites

Select the actual agent/connector host before executing this stage. The customer
agent runs independently; no CLI command launches it. Require exact named-agent
boot/deployment, same-host authenticated literal-loopback hook, no-allocation
health, exact-job readiness, cancel and 60-second expiry enforcement. A generic
LiveKit SDK health endpoint or Cloud Running status is insufficient.

For the proposed Linux host, the operator provisions a dedicated unprivileged
`chert-connector` account, `/opt/chert-pilot`, `/var/lib/chert-pilot` (0700), and
owner-readable secret environment file (0600). Match all paths in the systemd
review template. Do not install this template on an unidentified host.

After verifying the manifest SHA-256, as the selected runtime owner:

```sh
cd /opt/chert-pilot
npm install --save-exact --ignore-scripts /secure/artifacts/chert-local-transport-proof-0.0.0.tgz
./node_modules/.bin/chert --version
```

Expected private package `0.0.0`, compiled `chert`, Node 22.23.2 or 24.14.0. No npm
publication/Docker requirement. Keep a protected local artifact copy and lockfile.
Inject `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CHERT_HOOK_SECRET` through the
host secret manager. The following uppercase values are **unresolved inputs**,
not guessed identifiers:

```sh
./node_modules/.bin/chert init --non-interactive \
  --config /var/lib/chert-pilot/base.json \
  --agent-name "$AGENT_NAME" --deployment "$AGENT_DEPLOYMENT" --boot "$AGENT_BOOT" \
  --livekit-url "$LIVEKIT_WSS_ORIGIN" --hook-origin "$LOOPBACK_HOOK_ORIGIN" \
  --state-dir /var/lib/chert-pilot/state --hook-secret-env CHERT_HOOK_SECRET
```

Require files 0600, directory 0700, correct ownership, writable persistent storage,
fresh state path separate from every historical adapter run. Stop on existing
files, unknown hook scope/capacity, corruption, locks, debt or ambiguous credentials.

## 5. Standby enrollment and no-allocation checks — no activation

Requires explicit authorization for enrollment/connector start, independent of
backend deployment. An owner/admin obtains an existing short-lived Supabase user
access token and injects `CHERT_USER_ACCESS_TOKEN` securely into the management
shell. Never paste it into chat or pass it as a flag.

```sh
CHERT=./node_modules/.bin/chert
CONTROL=https://facetime.trychert.com
PROJECT=5ee3afd6-f248-45a5-9fe8-bf30c4c961e7
LINE=59b3e3d0-945b-45da-b907-027103941a65
BASE=/var/lib/chert-pilot/base.json
CONFIG=/var/lib/chert-pilot/config.json
# RELAY is the verified origin returned by the actual Railway deployment.
"$CHERT" projects --config "$BASE" --backend "$CONTROL" --json
"$CHERT" lines --config "$BASE" --backend "$CONTROL" --project "$PROJECT" --json
"$CHERT" bindings --config "$BASE" --backend "$CONTROL" --project "$PROJECT" --json
"$CHERT" enroll --config "$BASE" --backend "$CONTROL" --project "$PROJECT" \
  --line "$LINE" --relay-origin "$RELAY" --environment production \
  --output-config "$CONFIG" --credentials-file /var/lib/chert-pilot/credentials.json --json
"$CHERT" bindings --config "$CONFIG" --json
"$CHERT" check --config "$CONFIG" --json
```

Require exactly the pilot, one line, current generation, no previous active binding
unless separately reviewed, and a standby response. Enrollment creates a binding
but must leave assignment/routing unchanged. A response/save failure can leave an
orphan standby binding: inspect/revoke the exact orphan; never blindly reenroll.
Record binding ID/scope and secure the original config/credential recovery copy.

Start one supervised `chert run --config /var/lib/chert-pilot/config.json --json`
process using the reviewed host supervisor. `check` may exit **3** because it is
partial diagnostics. Require authenticated authorization + standby state,
connectivity, fresh matching hook health and no local debt; it must allocate no
rooms/dispatches. Installation, health, run, reconnect and standby enrollment
must not activate routing. Remove the user session from the runtime environment.
Do not create a real room to make a health check pass.

## 6. Explicit pilot activation — separate authorization

Freshly recheck exact project/line, owner/admin membership, assignment generation,
active-binding expectation, worker readiness/installed revision, no legacy call,
cleanup and agent prerequisites. Retain saved future route. Set the expected
binding to `none` only if fresh bindings confirms none. Then, and only under
explicit pilot activation authorization:

```sh
"$CHERT" activate --config "$CONFIG" --expected-binding none \
  --assignment-generation "$FRESH_ASSIGNMENT_GENERATION" --json
```

Replacement requires the actual previous UUID, never `none`. The transaction must
accept the compare-and-swap; stale generation/binding is a stop, not a retry with
an inferred value. Expect relay socket closure and supervisor restart with the
**same config and state**, active welcome and fresh diagnostics. Confirm only
this pilot is active and original line integration fields are unchanged.
Stop here. Active transport is not physical FaceTime readiness.

## 7. Later supervised FaceTime test — new bounded authorization

Obtain the exact Mac installed-source/binary mapping and read-only no-call physical
preflight, a named human caller/operator, confirmed agent/connector host, and
strict local/central cleanup. No Mac update or restart is planned by this release.
Use the existing supervised runbook's BYOR-relevant observations; its managed-only
recording helper is not a BYOR acceptance shortcut.

Authorize one short inbound **audio-only** test first. Record decision receipt,
unchanged v1 command/redemption, caller-to-agent and agent-to-caller intelligible
audio, terminal delivery and exact owned-resource absence. Keep preparation under
four seconds, authoritative decision under five seconds, resource ceiling **60
seconds**. Do not extend deadlines, create avatars/warm pools or infer video.
Stop on missed/uncertain acceptance, wrong participant, silence, FaceTime failure,
cleanup debt or unexpected other-project behavior. Any repeat test requires the
agreed bounded test scope and clean predecessor evidence.

## Rollback and interrupted release

- **Before SQL commits:** failed transaction leaves old functions/schema intact.
  Verify ledger/schema before lifting only this attempt's fences.
- **Ambiguous SQL/deployment:** keep coherent cleanup services; inspect exact
  ledger, schema and alias state. Never retry by guessing success/failure.
- **After SQL, before activation:** retain additive schema and deploy a compatible
  correction. Use an old app only after proving zero bindings/pins and compatibility
  with the deployed schema; this is not the default rollback plan.
- **After activation:** stop future connector assignment explicitly:

  ```sh
  "$CHERT" drain --config "$CONFIG" --json
  ```

  Drain removes the connector overlay; the unchanged saved webhook handles **future
  calls only**. Verify its route revision/assignment against the saved snapshot.
  If independently changed, stop and review rather than overwrite it.
- Retain accepted/uncertain calls on their **original binding, config, journal,
  adapter receipts, credentials and agent/hook**. Never transfer them to a new
  enrollment. Relay loss/SIGTERM does not authorize resource deletion.
- Keep compatible control-plane RPCs/schema, relay lifecycle/reconciliation,
  original connector state and hook available until authoritative terminal state
  **and** verified adapter/resource cleanup. Lifecycle ack and elapsed expiry are
  not proof of cleanup. Do not shut these services down merely because routing
  has reverted.
- If deliberately revoking the connection credential:

  ```sh
  "$CHERT" revoke --config "$CONFIG" --json
  # After stopping/verifying the sole original writer, replace its supervisor
  # command with recovery mode using exactly the same config/state:
  "$CHERT" run --config "$CONFIG" --recovery --json
  ```

  Revocation is permanent even after drain; recovery is old-owned-call-only.
  Never overlap writers or remove an unexplained crash lock. With a crashed writer,
  verify host/PID ownership and use the reviewed dead-writer recovery procedure;
  do not delete journals. Keep encrypted recovery backups, not live file copies.
- Replacement enrollment uses a fresh state directory; CAS hands off only new
  calls. Old bindings continue draining/recovery to verified terminal zero debt.
- Do not drop connector columns/tables, revoke recovery prematurely, restore a DB
  snapshot, rewrite receipts or mark cleanup complete to simplify rollback.
  Preserve the two historical CLI debts and the separate failed pilot Session.

## Next review boundary

Review the exact artifacts, compatible SQL, recorded uncertainties and access
requirements in [the follow-up report](blocker-resolution/RESULTS.md). Backend deployment authorization permits only the specified
migration, secret provisioning, deployment/promotion and coordinated fences.
Enrollment/start, activation and supervised testing remain separate. New Railway
project creation is complete; its service remains unprovisioned.
No commits, pushes, publication, other projects or Mac changes are included.

---

# Previous runbook — historical preparation record

# Chert FaceTime Test pilot — review-only runbook

No command in this runbook was run against production. Deployment, migration and activation each require the review/authorization requested by the user.

## Verified target and unchanged rollback route

Read-only observation on 2026-09-29, Supabase project `krlbefcfgxcsnfhrjjof`:

- Project: `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, slug `chert-facetime-test`, name “Chert FaceTime Test”, enabled.
- Sole line: `59b3e3d0-945b-45da-b907-027103941a65`, available, no current call at observation.
- Route: `customer_decides`, no default assistant, enabled “Line webhook” integration `946445e1-2c0f-478d-a049-72c8dd9762f2`, assignment generation 3.

Do not use the name alone or reuse generation 3 without a fresh inspection. Do not activate another project. Activation overlays connector ownership without changing the line's saved webhook route; draining returns future calls to that route.

## Review and staged release

1. Reconcile this branch with the deployed schema and migration history. Production has newer columns and the repository contains duplicate historical numeric versions. Do not run `db push`, renumber history or fabricate applied migrations. Approve an exact release/migration plan first.
2. Review and rehearse the additive connector migration; back up through the existing release process. After separate approval, apply it, deploy the control-plane API, and configure the new relay secret. Existing authentication pepper/encryption keys and integration secrets must remain unchanged.
3. After approval, deploy `chert-facetime/connector-relay` as a Railway Node service using its `railway.json`, Node 24.14.0, HTTPS/WSS ingress and the reviewed control-plane origin. No Docker, media proxy or Mac update is required. Record the chosen relay/control-plane domains; none were invented in this task.
4. Install the reviewed private CLI artifact on the selected connector host. Create a fresh owner-only state directory and an agent configuration using `chert init`. The existing compatible agent/hook must already run independently. Inject LiveKit/hook secrets through the host secret manager. Obtain an owner/admin user session from existing Chert/Supabase authentication and inject it as `CHERT_USER_ACCESS_TOKEN`; never put it in arguments.
5. Use `projects`, `lines` and `bindings` to recheck the exact identifiers above, current assignment generation, no legacy call in flight and the expected current connector binding. Resolve any discrepancy before allocation or activation.
6. Enroll standby with explicit `--project`, `--line`, reviewed `--backend` and `--relay-origin`, plus new `--output-config` and `--credentials-file` paths. Keep the enrollment configuration separate from historical adapter directories. `check` must show authorization, standby state and fresh authenticated agent health; no room is created. Start the supervised connector. Enrollment and reconnect do not activate.
7. Only with separate explicit activation authorization, run `activate --config PILOT_CONFIG --expected-binding none --assignment-generation CURRENT_INTEGER` (or the reviewed existing binding UUID for replacement). The relay closes on state change; the supervisor restarts the same config/state and obtains an active welcome. Check activation and health again. An active configuration is not evidence of successful FaceTime/media.
8. Stop here for separately authorized, bounded live testing. Record authoritative receipt, terminal delivery and verified cleanup independently. The current audio-only adapter keeps the five-second incoming budget and 60-second resource ceiling; it does not qualify slow avatars or long calls.

## Rollback and retained work

Explicit `drain --config PILOT_CONFIG` restores future routing to the existing webhook. It never transfers an accepted call. Keep the old process/state/hook operational for those calls; SIGTERM disables admission and preserves accepted/uncertain work. If the connection credential is revoked, restart with `run --config PILOT_CONFIG --recovery`. Recovery cannot accept new calls. Do not delete or overwrite journals/adapter receipts or the separate recovery credential.

A deployment replacement uses a new standby binding and fresh state directory, then activation with the exact previous binding UUID. The old binding becomes draining. Do not revert the control plane to code that ignores connector pins until all owned calls have authoritative terminal outcomes and verified resource absence. Preserve a compatible lifecycle/reconciliation endpoint throughout rollback.

Both historical unresolved adapter debts remain quarantined with unchanged evidence. This task authorizes no attempt to settle them, no new real room, and no exception to admission rules. A binding's lifecycle acknowledgement is not proof of local cleanup: check the original connector journal and adapter receipts separately.

## Decisions required before deployment

Approve the deployed migration baseline and release revision; choose reviewed control-plane/relay domains, secret-manager entries and connector host/supervisor; verify owner/admin access and the target agent/hook; approve a bounded pilot activation and later physical test separately. No backend access or product decision blocked the isolated implementation. Production qualification, provider behavior, decoded audio, FaceTime and video remain unverified by these tests.
