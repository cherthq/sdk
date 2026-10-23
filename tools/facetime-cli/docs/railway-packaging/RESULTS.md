# Railway container packaging — local qualification, 20260930 r1

The BYOR CLI and production Python talking-head owner are packaged and locally
qualified in Linux amd64 containers. **No Railway deployment, production access,
real provider session, worker start, call, routing activation, image publication,
commit or push occurred.** Stop for review. Remote provider-substitute qualification
is the next step; standby deployment still depends on its results and the existing
backend/relay and old-owner cleanup gates.

## Delivered

- [Dockerfile](../../packaging/railway/Dockerfile): immutable official Node
  **22.23.2** / Python **3.12.14** base digests; reviewed CLI tarball; compiled
  TypeScript callback; pinned npm integrity lock and exact Python wheel hashes;
  non-root UID/GID 10001. Immutable application/module paths. Default target is
  production; the separate qualification target is never suitable for real secrets.
- [Supervisor](../../packaging/railway/runtime.py): independent Python/Node child
  supervision; three-start lifetime cap and five-second backoff; no Node restart
  on retained crash lock or fatal exits; bad Node config leaves Python running.
  SIGTERM budgets are Node 10 seconds, then owner 50 seconds, preserving evidence
  if either requires SIGKILL. No systemd or old HTTP/continuous warm watcher.
- Exact `/state` mount checks, operator-bound persistent volume marker, exclusive
  supervisor kernel lease, fresh-subtree-only provisioning, explicit one-time
  initialization and normal-start refusal for missing journals. Required state is
  rechecked before **every child restart**, not only container startup. Private
  0700 directories and 0600 journals/Unix sockets separate application and connector
  state. No lock reset, journal reset or inferred cleanup success.
- Explicit child env allowlists. Only Python receives LiveKit management secrets;
  only Node receives Chert runtime credentials. The supervisor forwards no raw
  child logs. Health exposes fixed process/IPC/connection statuses only. Both
  trusted children share one UID; this is environment partitioning, not a sandbox
  against malicious application code.
- `GET /healthz` probes processes and both local event loops. Empty standby is
  healthy without a paid slot; session readiness remains unavailable. A ready-slot
  observation does not establish acceptance or media delivery. No startup or
  health path stages, allocates, dispatches, refills or starts an agent.
- [Deployment handoff](HANDOFF.md): exact build/init/run commands, env names,
  paths/permissions, volume and signal gates, old-owner drain, standby, substitute
  qualification, recovery/rollback and backend/shared-relay prerequisites.

## Frozen inputs and artifacts

Built from `byor-av-pilot-20260930-r1`, without modifying that release or the adjacent
application repository. [Preservation audit](preservation.json) verifies original
archives/configuration plus all 16 frozen allowlisted application files. The
source comparison found 14/16 identical files; the only differences are the source
systemd templates' placeholder paths versus release-specific frozen paths. Those
units are unused here. Production owner, adapter, handler and focused tests match.

Exact inputs, dependency versions and image identities:
[artifact manifest](artifacts.json), [installed versions](installed-versions.json),
[wheel hashes](python-wheels.sha256), [source comparison](source-comparison.json).

- Production image: `chert-railway:20260930-r1`
- Local Docker identity: `sha256:c53462a1102e8b7f2af7ae6334851c1f66ed8290890b6a83eedff9fd07bd58e9`
- Qualification image: `chert-railway-qualification:20260930-r1`
- Build context: `/Users/garygao/chert-facetime-cli/.local/railway-packaging/railway-20260930-r1/context-v7`
- Portable build context: `/Users/garygao/chert-facetime-cli/.local/railway-packaging/railway-20260930-r1/railway-20260930-r1-reviewed-build-context.tar.gz`
- Context archive SHA256: `27e6f3b7614eee8cd73fff157a79d3bd26c192e614a667cd308880009b8342ea`

Images remain local, not published. Reproducible dependency/source selection is
pinned; BuildKit provenance and timestamps are not claimed byte-identical across
rebuilds. Prior unsuccessful/intermediate contexts and logs were retained separately.

## Validation and regression evidence

[Brief](BRIEF.md) recorded mount, restart, secret, allocation and uncertainty
hypotheses before implementation. Initial unit scaffolding failed because the new
supervisor module did not exist. The first build exposed TypeScript 6's explicit
Node-types requirement; it was corrected. Two early container checks exposed a
harness PID lookup error (Node has extra command-line arguments in this local
engine); fixing the lookup required no production behavior relaxation.

A subsequent **behavioral regression failed before the final fix**:
[child restart red](child-restart-red.txt). After graceful Node exit, removing its
journal during restart backoff caused the next process to recreate it. Per-child
preflight now refuses restart and keeps the existing Python owner alive. The exact
regression passes in the [final container suite](container-reviewed.txt).

| Check | Result |
| --- | --- |
| Production and qualification Linux amd64 builds | passed; final frozen context v7 |
| New container integration scenarios | **8 passed** |
| Supervisor unit/process tests | **5 passed** (including bounded kill of a hung child) |
| Frozen Python connector/owner suite in final qualification image | **24 passed**, Python 3.12.14 |
| CLI full suite, installed frozen application qualification enabled | **268 passed, zero skips** on Node 22.23.2 and 24.14.0 |
| CLI typecheck, lint and build | passed on both Node versions |
| Synthetic transport proof | **20 commits, zero resources/debt** on each Node version |
| Demo syntax/full Node checks | **93 passed** on each Node version |
| Packaging Python lint, JS syntax and whitespace checks | passed |

Container evidence is actual Docker Desktop 28.5.2 / Linux amd64 execution under
emulation on a Linux arm64 engine hosted by Darwin arm64. It is not native Railway
scheduler/volume evidence. Runtime test containers used `--network none`, synthetic
credentials and isolated named volumes; provider transport calls were substituted.
The production server's `main()` still constructed its real Config, adapter and
ReadySessionOwner. No fake owner or synthetic audio-policy override was used.
The production-image smoke also ran without test hooks on a read-only root filesystem.

The eight scenarios cover:

1. Missing journal during child restart: refuse recreation; leave Python alive.
2. Missing mount/journal or foreign volume marker: refuse startup; retain files.
3. Graceful Node restart, Node SIGKILL, retained lock across container restart,
   no automatic reconnect, and Python expiry/verified cleanup while Node is down.
4. Actual production image: healthy empty standby with a loopback handshake,
   nonwritable application, no qualification files, bad Node config isolated from
   owner liveness. Production provider network was unavailable; no staging occurred.
5. Python SIGKILL: reopen the exact claim, complete terminal cleanup, and preserve
   interrupted staging as uncertain without redispatch or guessed deletion.
6. Repeated owner crashes exhaust restart budget; graceful container shutdown exits
   within the configured bound. Hung-child force-kill logic is separately tested
   with a real subprocess and shortened injected budget, not a 50-second Railway test.
7. Non-root UID, private permissions, child credential separation, sanitized repeated
   standby health and zero startup/probe creates/dispatches; repeat init refuses.
8. Second writer refusal; same-container restart and replacement-container recovery
   on one volume preserve a claim, avoid extra allocation, and verify terminal cleanup.

Logs: [container suite](container-reviewed.txt), [owner suite](owner-reviewed.txt),
[unit tests](unit-reviewed.txt), [Node 22 CLI](cli-node22.txt),
[Node 24 CLI](cli-node24.txt), [Node 22 proof](proof-node22.txt),
[Node 24 proof](proof-node24.txt), [Node 22 demo](demo-node22.txt),
[Node 24 demo](demo-node24.txt), [runtime build](build-runtime-reviewed.txt),
[qualification build](build-qualification-reviewed.txt).

## Remaining gates and limitations

- No container case was skipped for unavailable tooling. Actual Railway restart,
  mount persistence, root provisioning/non-root launch, one-writer deployment
  sequencing, no-sleep setting and 65-second termination grace remain untested.
  Mountinfo plus a persistent marker cannot independently prove a Railway volume
  UUID; the deployment agent must verify it against the selected service inventory.
- The container needs an enrolled standby config and working authenticated backend
  and relay to return healthy transport status. This packaging does not implement
  or deploy those dependencies. Existing schema/ledger reconciliation, relay
  hosting/secrets/supervision and routing review remain open.
- The old continuous webhook owner must be drained and its resources/debts reviewed
  before replacement. This image only exposes HTTP health; it does not preserve
  the old HTTP callback endpoint. Keep the route unchanged pending explicit
  activation, with a reviewed maintenance interval for the inactive pilot.
- Existing historical cleanup debts, the historical uncleaned Session and their
  evidence were not modified or relabeled. Synthetic uncertain test fixtures were
  disposed only with their isolated test volumes; that is not provider settlement.
- No automatic repair for CLI crash locks or interrupted preparation is provided.
  Uncertainty stays quarantined. Python cleanup continues while Node is down, but
  cannot run while the entire container is stopped or after its own restart budget
  is exhausted; ongoing monitoring and reviewed recovery remain necessary.
- Container health proves process/IPC liveness and a transport observation. It does
  not prove fresh backend authorization, agent readiness for a particular call,
  decoded audio/video, conversation, FaceTime or Muse compatibility.

After review, proceed to isolated Railway **provider-substitute qualification**.
Only after that passes, old-owner cleanup is verified and backend/relay prerequisites
are complete should the deployment agent perform an explicitly authorized standby
deployment. Do not activate, stage real sessions or run the proposed 70s/20s calls
as part of this handoff.
