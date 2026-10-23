# Railway packaging handoff — review before remote work

Later production operation: see [continuous pilot controls](../production-launch/CONTINUOUS.md) and the production-launch evidence directory. The opt-in controller is a reviewed supervisor addition; this document describes the original default-disabled packaging and remains the historical qualification baseline.

This task performed local builds/tests only. Use the production `runtime` target;
**never deploy `qualification` with real secrets**. The default Docker target is
also production. No image was published. See [RESULTS.md](RESULTS.md) and
[artifacts.json](artifacts.json) for the exact local image/config/source identities.

## Frozen build and launch

From `/Users/garygao/chert-facetime-cli`, the qualified context is
`.local/railway-packaging/railway-20260930-r1/context-v7`.

```sh
docker build --platform linux/amd64 --target runtime \
  -t chert-railway:20260930-r1 \
  .local/railway-packaging/railway-20260930-r1/context-v7
```

To regenerate a separate context, use `python3 packaging/railway/prepare.py NEW_DIRECTORY`.
It verifies the original release archives/configuration hashes, extracts only
selected files, verifies the application file manifest, and refuses an existing
output. Preserve the qualified context; compare a regenerated `inputs.json`
before using it. Base images use immutable official digests. npm uses its
integrity lock; Python uses exact Linux amd64 CPython 3.12 wheel hashes. BuildKit
metadata/timestamps can change image identity on rebuild; record the new identity
and rerun qualification rather than claiming byte-identical OCI output.

Normal command (after separate initialization):

```sh
docker run --name chert-pilot --stop-timeout 65 \
  --read-only --tmpfs /tmp \
  --mount type=volume,src=PILOT_VOLUME,dst=/state \
  --env-file /secure/pilot.env \
  -p 127.0.0.1:8080:8080 chert-railway:20260930-r1 run
```

These are review instructions; do not execute them against the selected Railway
service until deployment is authorized. No provider worker is included or started.
The application uses the existing named dispatch topology only on explicit staging.

## One-time volume provisioning and initialization

The selected service is `talking-head-webhook` in `demo-agent-0-byor`, production,
with the existing `/state` volume. Reconfirm its identity from
[the recorded host inventory](../deployment-release/HOST.md); do not create a
replacement volume just to bypass existing state/debt.

1. Confirm the actual `/state` mount, volume identity and historical directories.
   Back up the existing volume and inventory every old owner/debt. Reserve the
   new subtree `/state/chert-pilot`; it must not already exist for provisioning.
2. Set `PILOT_VOLUME_ID` to the reviewed selected volume UUID. Run the image's
   **`provision`** command once with UID 0 on the mounted volume. This checks an
   exact writable ext4/xfs/btrfs mount, creates only the fresh subtree, and assigns
   UID/GID 10001. It does not recursively chown old data or initialize journals.
   Example local equivalent:

   ```sh
   docker run --rm --user 0 --mount type=volume,src=PILOT_VOLUME,dst=/state \
     --env-file /secure/pilot.env chert-railway:20260930-r1 provision
   ```

3. Prepare an enrolled **standby BYOR** config as `/bootstrap/config.json`, a
   regular 0600 file owned by UID 10001. Use the existing enrollment procedure;
   don't invent scopes or reuse a create-room binding. Required fixed fields:

   ```json
   {
     "schema_version": 2,
     "mode": "byor",
     "handler": {
       "id": "talking-head-ready-v1",
       "module": "/opt/chert-pilot/railway-20260930-r1/handler/handler.js"
     },
     "state_dir": "/state/chert-pilot/connector"
   }
   ```

   Include the actual enrolled `hosted-v1` transport, HTTPS origins and scope
   (BYOR mode, initial connection generation 0). Its `credential_env` must be
   `CHERT_CONNECTION_TOKEN`, `recovery_env` must be `CHERT_RECOVERY_TOKEN`, and
   `credentials_file` must be absent. There are no credentials in this config.
4. Run **`initialize`** once as UID/GID 10001 with the volume, protected bootstrap
   mount and runtime environment. It creates the CLI journal through the installed
   `ByorJournal` and runs the production Python `server.py --initialize-state`.
   It writes a completion marker only after both succeed; no provider operation
   or transport connection is made.

   ```sh
   docker run --rm --user 10001:10001 \
     --mount type=volume,src=PILOT_VOLUME,dst=/state \
     --mount type=bind,src=/secure/bootstrap,dst=/bootstrap,readonly \
     --env-file /secure/pilot.env chert-railway:20260930-r1 initialize
   ```

5. Switch to **`run`**, UID/GID 10001. Remove the bootstrap mount. Normal startup
   requires all three journals, config, volume marker and initialization marker.
   Partial initialization requires inspection; rerunning init cannot overwrite it.

Railway volumes are runtime mounts, unavailable during build or pre-deploy. Use an
explicit one-off runtime initialization phase with the volume attached; **do not
put initialization in a pre-deploy command**. Root is needed only for the fresh
subtree provisioning; confirm normal deployment does not retain a root UID
override. [Official volume semantics](https://docs.railway.com/volumes).

The mount check establishes the filesystem/mountpoint and the persistent marker
binds it to an operator-confirmed volume identity. Linux mountinfo cannot prove a
Railway volume UUID or backup durability; remote identity verification is required.
Never modify the marker to make a foreign/replacement volume pass.

## Environment and durable paths

Inject only these input names; keep values in the deployment secret store:

| Recipient | Names |
| --- | --- |
| Python child only | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CHERT_NAMESPACE` |
| Node child only | `CHERT_CONNECTION_TOKEN`, `CHERT_RECOVERY_TOKEN` |
| Supervisor only | `PILOT_VOLUME_ID`, `PORT` |
| Railway settings, not child configuration | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`; UID override only during provisioning |

No Muse/OpenAI/LemonSlice credentials are needed in this image. The owner manages
LiveKit dispatch/readiness; the separately hosted existing worker owns avatar
provider credentials. The Python child receives fixed continuous-profile limits:
600-second resource ceiling, 900-second token TTL, 4000ms decision budget. These
match the reviewed application release; parent environment cannot override them.
No legacy HTTP receiver or automatic continuous refill is started. All other parent
variables, including `NODE_OPTIONS`/`PYTHONPATH`, are excluded from child envs.
Both processes run as one trusted UID; env partitioning is not a hostile-code sandbox.

| Path | Ownership/mode and purpose |
| --- | --- |
| `/opt/chert-pilot/railway-20260930-r1` | root owned, not writable by runtime; compiled handler + reviewed package/application |
| `/state/chert-pilot` and `application`, `connector`, `ipc` | UID/GID 10001, 0700 |
| `application/resources.json`, `application/operations.json` | 0600; Python resource receipts and durable slots/claims |
| `connector/config.json`, `connector/journal.json` | 0600; immutable binding/module identity and connector debt |
| `ipc/owner.sock`, `ipc/admin.sock`, `ipc/node.sock` | 0600 private Unix sockets; never HTTP routes |
| `volume-id`, `initialized`, `supervisor.lock` | 0600; marker and exclusive kernel lease; retain files |
| `connector/journal.json.lock` | conservative CLI crash lock; never auto-remove |

## Health, supervision and Railway gates

`GET /healthz` on `PORT` is the sole HTTP route. 200 requires both child processes,
both callback/event-loop IPC probes, and a connected Node transport observation.
An empty application is healthy **standby**, with `session_readiness=unavailable`.
A ready-slot observation still requires exact per-call validation and backend
acceptance authority. Health never stages, refills, creates, dispatches or starts
an agent. This is process/IPC health, not an end-to-end provider/media health claim.

503 reports sanitized process state, IPC and connection status. It reveals no
credentials or slot/call identifiers. Node config/fatal/crash-lock failure leaves
the owner running. Each child gets at most three starts per supervisor lifetime,
with five seconds between attempts. Node lock or exit 2/3/4/5 suppresses retries.
Exhaustion holds PID 1 alive and unhealthy, preserving the other process; alert an
operator rather than using health failure as a container restart trigger.

SIGTERM stops admission/Node first (10-second budget), then Python (50-second
budget), killing a hung child at the bound. It never forces cleanup success or
clears journal locks. Configure **at least 65 seconds** of platform termination
grace and prove it with remote substitutes. A stopped container cannot continue
expiry; restart/recovery availability is an operational requirement.

Verify before standby deployment: one replica, sleeping/serverless disabled,
no deployment overlap on the volume, no image auto-update, normal UID 10001,
health path `/healthz` using `PORT`, rollout timeout at least 60 seconds,
restart policy **Never for initial qualification** (operator-controlled retries).
Only consider bounded on-failure outer restarts after crash-lock recovery is reviewed.
Railway's volume deployments incur downtime and its deployment healthchecks do not
provide ongoing monitoring; arrange ongoing nonallocating health alerts separately.
[Official healthcheck behavior](https://docs.railway.com/deployments/healthchecks).
Confirm the current teardown/grace setting before use; defaults are insufficient.
[Official teardown behavior](https://docs.railway.com/deployments/troubleshooting/slow-deployments).

## Old-owner drain, remote qualification and standby

- Re-read current routing/worker generation and active Session state. Keep the
  existing webhook route unchanged until **separate explicit activation**.
- Deliberately stop old-owner refill/new work through its existing supported
  controls. Inventory each old room/job/slot and historical debt. Finish accepted
  work, perform ownership-scoped cleanup, verify provider absence/settlement, and
  retain evidence. Stop the old owner only after that review. Never launch its
  old destructive HTTP startup path for convenience or transfer an in-memory slot.
- This container serves only health over HTTP. Replacing the old webhook service
  creates a maintenance interval for that inactive pilot route; it is not an HTTP
  compatibility shim. If uninterrupted webhook service is required, resolve that
  deployment plan before replacement—do not silently change routing here.
- Qualify a separate remote provider-substitute target/volume first, with synthetic
  credentials and no external provider egress. Repeat the local `test_container.py`
  scenarios through the platform's process/exec/restart interface: empty health,
  UID/env separation, second writer refusal, graceful Node restart, SIGKILL lock,
  independent owner expiry, interrupted staging uncertainty, owner crash reopen,
  container replacement on one volume, missing-state refusal and measured grace.
  Record remote image/mount/UID identities and sanitized results. Local tests are
  not evidence of Railway's scheduler, volume attachment or signal delivery.
- Switch to the production target and original reviewed provider namespace only
  after remote qualification and old-owner cleanup review. Enroll/hold standby,
  confirm no slots and zero new provider allocations on startup/health. No staging
  or calls are part of standby. Do not load production secrets into qualification.

## Recovery and rollback

On Node crash-lock/fatal status, leave Python alive for expiry/cleanup. Preserve
journal, lock, scope, module path and application receipts. No automatic lock
removal or forced journal repair is provided. Before any lock repair, stop/fence
all writers, archive evidence, verify exact process/container ownership, and obtain
review of a narrowly scoped recovery step; retain the original lock as evidence.
Use the CLI's existing `--recovery` flow with the original binding/config and its
restricted Node environment for reviewed recovery; keep admission disabled at the
backend. Never reinitialize, switch handler paths or mint a replacement binding to
hide retained work. A ready/claimed owner can reopen; interrupted preparation stays
uncertain until original-operation settlement can be established.

For rollback, keep routing inactive, stop/fence the new writer, archive current
state and inventory, and use only a prior **compatible** image with the exact
journal/module identity. Do not restore a stale state snapshot over newer receipts.
The old continuous HTTP image is not journal-compatible and must not be restarted
to take over claims. If compatibility cannot be established, preserve state and
run recovery with the qualified image instead of rolling back code blindly.

Backend/shared-relay prerequisites remain those in
[the release runbook](../deployment-release/RUNBOOK.md): reconcile production schema
and migration ledger, review/apply guarded backend payload, host and supervise the
shared authenticated relay, provision scoped signing/runtime secrets, verify
revocation/drain fencing, and enroll the BYOR test binding in standby. The relay
reserved project currently has no qualified service/domain. Re-read all state;
recorded generation 3 is historical, not an activation precondition to assume.
Both old CLI debts and the historical uncleaned Session remain separate review
items. This package neither resolves nor erases them.

After review, the deployment agent can proceed to remote **substitute qualification**.
Standby deployment remains gated on those results, backend/relay availability and
old-owner drain. Activation, explicit staging, the later 70s/20s calls, decoded
media and physical FaceTime compatibility remain separately authorized work.
