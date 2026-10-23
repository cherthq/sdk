# Chert FaceTime Test — current release and live-test proposal

Review proposal only. This preparation does not deploy, apply production SQL,
enroll or activate bindings, warm sessions, start agents, change routing, place
calls or modify Macs. Use `chert byor` with application callbacks.

## Fixed target and release

Project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7` (Chert FaceTime Test), sole line
`59b3e3d0-945b-45da-b907-027103941a65`, worker
`dedea298-97e0-4321-8c85-1deca994b2a0`. At 04:59:11 UTC the line was idle,
assignment generation 3, customer_decides, no default Assistant. Re-read these
values at every scope-sensitive step. Never use this recorded generation as an
unchecked activation argument.

Review [results](RESULTS.md), [host findings](HOST.md), [artifact hashes](artifacts.json),
[backend patch](candidate.patch), [application patch](application.patch), and
[combined payload](migration.payload.sql). Only the new `.local/deployment-release`
artifacts contain this full combination. Prior release directories are historical.

Control plane: Supabase `krlbefcfgxcsnfhrjjof`, Vercel project
`prj_sNxcJ3Agi9urdLD4XYaKpe73jsP5`, team `team_Z3LEzgyI0Ki1wEurc5kaLy01`,
`https://facetime.trychert.com`. Reserved shared-relay Railway project
`1e6ab885-d595-4bfd-aac3-90ca1fc90d4f` still has no service/domain.
Selected application host: Railway `demo-agent-0-byor`, service
`679aad53-1b81-4198-a4ae-1bd0cd357b19`; see the host gate before using it.

## Host and ownership prerequisites

Build a separate reviewed Railway launch arrangement; the current Python-only
HTTP receiver image and provided systemd examples cannot run the new arrangement
on this container. See HOST.md for concrete packaging and restart checks.
No host image is presently claimed qualified. Freeze its digest and launch config
alongside the current source hashes before release execution.

Install the npm tarball and compile the real application's `connector/handler.ts`
against it into an immutable path. Python `connector/server.py` constructs
`ReadySessionOwner` and `ReadyAvatarAdapter`, uses the existing application's
session code, and owns all provider effects. Separate Node/Python environment
allowlists must prevent provider management credentials reaching Node. Management
access tokens are transient operator inputs, not runtime environment. The runtime
names file lists names only; existing application Config requirements still apply.

Use separate fresh private journals under the verified persistent volume and a
private Unix callback socket; the admin socket is separate. Owner initialization
is an explicit once-only operation and refuses existing state. Normal startup
requires both journals. Never initialize or delete locks to bypass recovery.
Start/check/health do not stage, dispatch, create rooms, refill, or launch agents.
The external customer agent remains under its existing independent supervisor.

Drain the prior HTTP continuous owner's namespace under its original state and
credentials before replacing that owner. A process-local warm slot cannot be
transferred. Keep old receipts, unresolved CLI debts and historical failed Session
`53945278-4dcf-4a4d-817a-73702d67799d`; verify cleanup using their actual owner,
not the new talking-head credentials. Interrupted staging in the new owner stays
uncertain until externally settled; no blind retry or force-clean is acceptable.

## Proposed authorized release sequence

1. Refresh serving source/schema/history/function preimages, environment-name
   configuration, relay/host state, firewall settings, line assignment and calls.
   Confirm restore/backup ownership and historical cleanup evidence. Stop on drift
   or active calls; do not relax SQL guards. This run did not refresh every firewall
   or environment setting.
2. Build/install the backend with pinned `npm@12.1.0 ci`, retaining Next 16.3.7,
   sharp 0.35.5, Vitest 4.1.11 and brace-expansion patches. Record that explicit
   install command in the deployment settings; do not rely on the default npm.
3. Apply exactly one reviewed combined atomic payload with the approved migration
   receipt procedure. Do not apply both base connector migrations, blanket db push,
   or edit existing history. Deploy this backend and a singleton, always-on shared
   relay with approved TLS origins and private shared secret. No enrollment yet.
4. After the old owner is drained and host gates pass, install the immutable
   Railway image, private fresh state, and separately supervised owner/connector.
   Prove actual restart/redeploy persistence using provider substitutes before
   assigning real traffic. Use separate app and connector state namespaces.
5. Create a fresh BYOR config and handler ID. Example paths for the selected mount:

   ```sh
   chert init --mode byor --non-interactive \
     --config /state/chert-pilot/byor-v1/base.json \
     --state-dir /state/chert-pilot/byor-v1/state \
     --handler-id talking-head-byor-av-pilot-20260930-r1 \
     --handler-module /opt/talking-head/byor-av-pilot-20260930-r1/connector/handler.js
   ```

6. Enroll with the exact pilot project/line, approved backend/relay origins and
   separately supplied owner/admin authorization using CLI_GUIDE syntax. Write
   new config and 0600 credential files; do not reuse historical state. Verify
   returned scope.session_mode=byor and state=standby. Record binding ID.
7. Run `chert byor --config /state/chert-pilot/byor-v1/config.json --json` in standby.
   Check transport and non-allocating owner health. No paid ready slot is implied.
   Require zero unresolved new-state debt, safe writer ownership and verified
   historical isolation. Standby is not activation.
8. Review explicit activation separately using freshly read expected binding and
   assignment-generation CAS values, restricted to the pilot's sole line. Save
   prior routing/recovery references. No approval of source preparation alone
   authorizes activation or paid staging.

## Proposed bounded physical test after separate authorization

Authorize one named operator/caller, at most two explicit staging operations and
two incoming calls. Stage one slot through `connector/control.py` on the private
admin socket immediately before each call. Require actual audio AND video
publication readiness within the existing 45-second staging budget. Do not extend
that budget or incoming four/five-second deadlines. No automatic refill or retry.
An audio-only request must decline; never turn off video to make this test pass.

First call: verify acceptance within the normal deadline, FaceTime/room connection,
audible speech in both directions, and visible changing agent video on the caller's
FaceTime display. Publication metadata alone does not pass physical video. Caller
video publication is outside the current inbound BYOR profile. Hold approximately
70 seconds to exceed the old prototype ceiling, then caller hangs up; cap call
observation at 90 seconds. Require central terminal state, application lifecycle
acknowledgment, Mac cleanup and verified absence of owned room/agent/rendering
resources within 30 seconds. Preserve all uncertainty and stop if any check fails.

Only after verified cleanup, explicitly stage a fresh slot and perform a 20-second
second call. Recheck both audio directions and agent video, hang up from the
opposite side, then repeat cleanup checks. Proposed maximum call observation is
110 seconds plus two 30-second cleanup windows, excluding bounded staging.
Record sanitized call/operation IDs and latency evidence; never tokens or keys.
No physical call or paid staging occurred during preparation.

## Rollback

Drain future admission first. Keep the original binding, handler, credentials,
application owner and persistent journals available for accepted calls and their
recovery. Routing rollback does not transfer ownership. Use the original BYOR
config with `--recovery` for its accepted calls; legacy calls keep their original
legacy owner. Keep the new owner alive for expiry/cleanup while its calls settle.
Do not down-migrate shared schema, revoke the only recovery credential, reset
journals, shorten accepted expiry or repeat uncertain staging. Reconcile debt with
its actual owner before retirement. Revert immutable images/config only after
proving all ownership obligations remain serviceable.
