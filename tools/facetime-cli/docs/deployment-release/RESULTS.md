# Deployment preparation results — 2026-09-30

The current audio/video BYOR implementation is now frozen into a new reviewed
source candidate. Local integration checks pass. The selected Railway host has
persistent storage, but its current Python-only image cannot run the new connector
as-is; Railway packaging and runtime qualification remain before deployment.
No deployment, migration, enrollment, activation, staging, live call, agent start,
Mac change, commit or push was performed.

## Candidate and artifacts

Release `byor-av-pilot-20260930-r1`:

- Backend: `/Users/garygao/chert-facetime-cli/.local/deployment-release/candidate`.
- Application: `/Users/garygao/chert-facetime-cli/.local/deployment-release/application`.
- Four frozen archives: `/Users/garygao/chert-facetime-cli/.local/deployment-release/artifacts`.
- [Artifact hashes](artifacts.json), [backend allowlist](candidate-files.json),
  [backend patch](candidate.patch), [application allowlist](application-files.json),
  [application patch](application.patch), [atomic migration](migration.payload.sql).

The backend composes the preserved newer candidate on serving source
`cbb22ee854e26219aea92d67fa401433cdb4d84c`, its patched dependencies, signing/readiness
behavior and cleanup-ordering correction, plus BYOR mode and the additive video
predicate. Both patches were checked by applying to clean Git archives. The
application is base `52b43a4be253bc815e32b205a8f1118870b85955` plus 16 allowlisted
files; its systemd examples have explicit release paths. They are not installed
and are not Railway-compatible launch instructions.

The installed tarball exercises actual `ReadySessionOwner` / `ReadyAvatarAdapter`
production construction through `handler.ts` and private Python IPC. It claims an
explicitly staged audio/video session, keeps one room, and permits reuse only
after verified cleanup. Only provider transports are substituted. This does not
prove real provider timing, decoded video, or FaceTime media.

## Checks run on this exact candidate

| Check | Result |
| --- | --- |
| Node 22 and 24: backend typecheck, lint, production build | All pass |
| Node 22 and 24: 7 focused backend suites against isolated PG 17.6 | 109 tests pass each |
| Node 22 and 24: relay suite | 3 tests pass each |
| Node 22 and 24: installed tarball with actual production ready-video policy | 1 focused integration test passes each |
| Frozen application Python receiver + connector tests | 129 pass |
| Frozen application Ruff | Pass |
| Backend npm audit | Zero reported vulnerabilities |
| Combined atomic migration / forced late rollback / permissions and RLS | Pass |
| Drift rejection | 9 cases pass, including exact runtime preimages |
| Repeat application | Rejected; no bindings or deliveries created |

See [matrix](candidate-matrix.json), [migration rehearsal](atomic-rehearsal.json),
[Python output](python.txt), [audit](dependency-audit.json). The larger historical
268 CLI / 259 backend / 93 demo Node suites remain evidence in
[the compatibility report](../talking-head-compatibility/RESULTS.md); those full
suites were not rerun in this regeneration. The focused installed-package test
here does not repeat every prior timeout/crash/long-duration scenario.

## Fresh infrastructure evidence

Supabase read-only inspection at 04:57:58 UTC still reports PostgreSQL 17.6, no
connector table, 391 matching public columns, 40 ledger records and unchanged
five shared-function preimages. Full catalog constraints/triggers are the recorded
baseline, not a newly captured full production snapshot. The rehearsal uses that
recorded catalog plus fresh column/history guards. No production SQL was applied.

Fresh Vercel metadata at 05:02:12 UTC still maps `facetime.trychert.com` to
`dpl_CaaB7JWXnBi7w6dYzZPz4METHBks`, READY, source `cbb22ee…`, Node 24.x, iad1.
Use the reviewed npm 12.1.0 install command for this lockfile; the prior clean
install rejected npm 10's optional-peer interpretation.

The pilot line was idle at 04:59:11 UTC, generation 3, customer_decides, no Assistant.
This fresh idle observation supersedes the earlier ending-call observation;
recheck before any cutover. Historical failed Session
`53945278-4dcf-4a4d-817a-73702d67799d` still has no cleaned_at. Both older CLI debts
remain untouched. New talking-head credentials cannot settle the old namespace.

The reserved shared-relay project still shows no services. The user-selected
`demo-agent-0-byor` application host was inspected through its authenticated
Railway dashboard and read-only console; [host findings](HOST.md) record the
actual persistent ext4 mount, absent Node/runtime bridge and required packaging.
No credential values were retrieved or changed.

## Remaining gates and proposed next action

1. Build/test the Railway image and supervision arrangement described in
   [HOST.md](HOST.md), then qualify its actual persistent volume and restart
   behavior under separately authorized deployment/restart work.
2. Drain/verify the old receiver's resources and reconcile historical cleanup with
   their original owners; preserve all unresolved evidence.
3. Execute the guarded backend/shared-relay release and enroll only in standby.
   Explicit activation and the bounded audio/video test are separate stages in
   [the current runbook](RUNBOOK.md).

Automatic refill remains disabled. It is deferred product work, not a prerequisite
for a pilot with explicit staging. Real preparation latency and physical media
are unverified acceptance gates, not product polish. Interrupted staging remains
uncertain until authoritative external settlement; never reset that uncertainty.
