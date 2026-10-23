# Chert FaceTime Test — BYOR deployment and live-test proposal

Review only, 2026-09-30 UTC. No deployment, migration, enrollment, activation,
warming, provider allocation, FaceTime call, or Mac change is authorized by this
runbook. The local candidate is prepared; the current application profile is
**not ready for activation**. Use `chert byor`; do not substitute `create-room`, the
experimental dispatch/hook protocol, or forwarding to the HTTP receiver.

## Fixed scope and review inputs

Only project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7` (Chert FaceTime Test), line
`59b3e3d0-945b-45da-b907-027103941a65`, worker
`dedea298-97e0-4321-8c85-1deca994b2a0`. Read generation and binding state fresh.
At 04:18:53 UTC generation was 3, policy customer_decides, no Assistant; the line
referenced `1de6e428-4322-4da7-ab99-f1ef9c2e4888`, which was `ending` at 04:19:01.
It must settle under its existing owner before any activation. This work did not
originate or control that call.

Candidate: `/Users/garygao/chert-facetime-cli/.local/byor-qualification/candidate`.
Inputs: [artifact manifest](artifacts.json), [candidate allowlist](candidate-files.json),
[candidate patch](candidate.patch), [application patch](application.patch), and
[combined atomic payload](migration.payload.sql). Never replay both base connector
migrations, run blanket db push, change the ledger, or use old artifact hashes.

Control plane is Supabase `krlbefcfgxcsnfhrjjof` and Vercel project
`prj_sNxcJ3Agi9urdLD4XYaKpe73jsP5`, team `team_Z3LEzgyI0Ki1wEurc5kaLy01`,
serving `https://facetime.trychert.com`. The reserved Railway project is
`1e6ab885-d595-4bfd-aac3-90ca1fc90d4f`; its empty-project status is recorded prior
preparation evidence, not freshly reverified in this qualification. No relay
service/domain has been provisioned by this work.

## Application gates before release approval

1. Resolve the media contract explicitly. The deployed classic profile needs
   audio+video; the connector is audio-only. Choose and implement either an
   explicitly supported application audio profile or a separately reviewed video
   product change. The synthetic test policy is neither. Do not flip a test flag
   in production, remove video silently, or describe local fixtures as media proof.
2. Preserve four-second preparation/five-second decision budgets. The deployed
   continuous owner warms for up to 45 seconds. A new process cannot access its
   in-memory slot. Introduce a durable claim interface in the real owner, with
   preparation initiated separately and explicitly; startup/check must stay inert.
   Do not cold-dispatch a duplicate agent or steal a room from the existing owner.
3. Add owner-driven lifecycle/expiry supervision and settle interrupted preparation
   through an authoritative provider-operation fence/status. Current bridge startup
   intentionally skips HTTP start/watch/shutdown paths because they assume another
   ownership model. A crash during prepare remains unknown; deleting a currently
   absent room does not prove no late effect. Retain this debt until proved settled.
4. Qualify the chosen application construction again through the installed tarball,
   including actual readiness timing and provider cleanup evidence. Existing local
   tests qualify callback mechanics only under isolated provider substitutes.
5. Resolve prior pilot cleanup: failed Session
   `53945278-4dcf-4a4d-817a-73702d67799d` still has cleaned_at null. Its old interview
   room belongs to the prior integration; new talking-head credentials cannot
   prove its absence. Retain both older CLI cleanup debts and their original state.

These are integration/release blockers, not cosmetic improvements.

## Proposed host and secret layout

Use one selected Linux/POSIX application host, Python 3.11–3.13 with the receiver's
locked dependencies, and Node 22.23.2 or 24.14.0. Host selection is still an execution
prerequisite; no Linux host was provisioned or supervised in this local macOS test.
Use a durable local filesystem, one writer per journal, directories 0700 and
journals/socket/secret files 0600. Never reuse the existing receiver's journal.
The source archive is application base 52b43a4 plus the seven allowlisted new bridge
files; unrelated dirty application documentation is not included or overwritten.

`/opt/talking-head/REVIEWED_IMMUTABLE_RELEASE/connector/server.py` owns private IPC
and calls the existing Python session code directly. Compile its `handler.ts` against
the installed package into an immutable application release path. Configure
`TALKING_HEAD_CALLBACK_SOCKET` in both processes. Only Python receives LiveKit
application secrets, separate operation/resource journal paths and the existing
application configuration. Node receives only Chert connection/recovery secrets.
No wrapper LiveKit master key or CHERT_HOOK_SECRET is needed. See
[runtime names](runtime.env.names), [connector unit](chert-byor.service), and
[owner unit](talking-head-owner.service). These are uninstalled review templates.

No Chert unit starts the Cloud agent, HTTP receiver, or warming. The existing
customer agent remains independently operated. On owner crash, preserve journals,
verify writer death and inspect uncertainty before removing only a stale IPC socket.
Do not auto-retry preparation. The current prototype's default unavailable health
is expected and is a deployment gate, not a reason to bypass checks.

## Proposed staged execution after separate authorization

1. Review exact hashes, production restore/backup procedure, migration guards and
   rollback ownership. Refresh serving deployment/source, schema/history/function
   preimages, environment names, firewall live/draft state, line assignment, active
   calls/commands and cleanup evidence. Stop on drift; do not relax a guard.
2. Build/install the control-plane candidate using pinned `npm@12.1.0 ci`. A clean
   npm 12 install passed; npm 10 rejected this lockfile's optional-peer layout.
   Preserve Next 16.3.7, sharp 0.35.5 and Vitest 4.1.11 patches and the two new
   brace-expansion patch versions. Configure the reviewed deployment's install
   command explicitly; do not assume Vercel's default npm is compatible.
3. Apply **one** reviewed combined atomic payload, using an approved transaction
   and one new migration receipt. Deploy the control plane and a singleton relay
   into the reserved Railway project with no sleep/overlap and the reviewed drain
   settings. Issue a shared relay secret to those services only. Preserve current
   signing/readiness and Mac protocol behavior. This stage enrolls no project.
4. Install the reviewed npm tarball/application bridge on the selected host. Use
   fresh state and an immutable handler ID/module path:

   ```sh
   chert init --mode byor --non-interactive \
     --config /var/lib/chert-pilot/byor-v1/base.json \
     --state-dir /var/lib/chert-pilot/byor-v1/state \
     --handler-id talking-head-REVIEWED_RELEASE \
     --handler-module /opt/talking-head/REVIEWED_IMMUTABLE_RELEASE/connector/handler.js
   ```

5. With a separately supplied owner/admin CHERT_USER_ACCESS_TOKEN, inspect the
   exact project/line. Enroll with explicit project and line IDs, approved backend/
   relay origins, new output config and new 0600 credentials file. Verify returned
   scope.session_mode=byor and state=standby. Use existing CLI_GUIDE enrollment
   syntax; no URL, service ID, access token or expected binding is invented here.
6. Check non-allocating health and zero unresolved local/application debt. Run
   `chert byor --config /var/lib/chert-pilot/byor-v1/config.json --json` in standby.
   Standby enrollment and a connected process do not authorize or imply activation.
7. Review **explicit activation separately** with fresh expected binding and
   assignment-generation CAS values, after the application gates and line drain
   pass. Save the previous route/binding reference and retain its recovery owner.
   Activation is limited to this project's sole line.

## Proposed bounded real FaceTime test — separate approval required

After all gates above, nominate one operator/caller and authorize exactly two
incoming calls. Independently prepare at most one application-owned ready session
per call using the reviewed application mechanism. No automatic warm-pool refill,
extra dispatch, recipient discovery, or unlimited retries is part of the test.

First call: within the normal four/five-second budgets, observe acceptance and
FaceTime/room connection; verify audible speech both ways. Hold the call for about
70 seconds to exceed the old prototype ceiling, then hang up. Hard-stop observation
at 90 seconds. Require central terminal state, application event acknowledgment,
Mac cleanup evidence and verified application room/agent/provider cleanup within
30 seconds of hangup. If cleanup is uncertain, stop and preserve evidence; do not
place the second call or reset journals.

Second call: only after verified cleanup, prepare one new session and make a
20-second call, checking connection and audio again; hang up from the opposite
side and verify the same cleanup conditions. Maximum proposed call time is 110
seconds plus at most two 30-second cleanup windows. Record IDs, timings and
sanitized evidence, never access tokens. This is an audio proposal conditional on
an explicitly supported audio profile; it proves no video capability. Video needs
its own contract, implementation, approval and physical acceptance criteria.

## Rollback without losing accepted calls

Drain future admission first. A routing rollback does not move old calls into a
new binding, mode, handler or namespace. Keep original state, immutable modules,
application journals, session credentials and recovery credential references until
all original calls and application acknowledgments settle. Use `chert byor
--config ORIGINAL_CONFIG --recovery` for BYOR and the original legacy command for
legacy journals. Do not revoke the only recovery credential, delete debt, replay
preparation, shorten accepted expiry, down-migrate the connector schema, or use
new credentials to assert historical cleanup. If the application cannot recover
an old operation, retain the blocker and reconcile with its actual owner.
