# Private npm CLI implementation brief

Scope: September 29, 2026 local packaging and implementation request. Older
research prompts are historical. Preserve the dirty main checkout and every
historical journal/evidence file; baseline hashes are in CLI_IMPLEMENTATION_BASELINE.json.
No real service credentials, sessions, agent processes, other repositories,
publication, commits or production routing are part of this task.

## Contracts

- `chert --help`, `--version`: compiled executable, exact tested Node versions
  22.23.2 and 24.14.0 checked before command work. Private provisional npm name.
- `init --config PATH`: interactive on a TTY; `--non-interactive` requires
  explicit agent name, deployment, LiveKit WSS endpoint, loopback hook origin,
  expected worker boot and absolute state directory. Exclusive owner-only config
  creation; no overwrite, allocation, enrollment or activation. Credentials are
  uppercase environment variable references, never values. No dotenv/source loading.
- Default transport is unconfigured. An explicit `--development PATH` loads a
  strict loopback-v1 transport description containing three loopback origins
  (relay, reconciliation, SDK management), exact scope, and credential references.
  It is a development protocol, not a production backend or automatic fallback.
  The separate test harness owns synthetic authority and LiveKit HTTP responses.
- `check`: JSON or human diagnostics separate config/runtime, credential presence,
  state permissions/lock, authenticated hook health, authorization and pending
  work. No WebSocket connection (which would change generation), no allocations.
  Authorization remains unverified by this non-mutating check. Partial diagnostics
  exit nonzero and cannot authorize incoming calls.
- `run`: exclusive journal writer, actual adapter, authenticated hook sampling,
  version-1 WebSocket client, bounded reconciliation. No fake server in package.
  Production/unconfigured transport fails with an actionable backend-contract
  error. Development welcome must match configured identity; only its role grants
  admission. Disconnect disables admission; restart reconciles retained work;
  graceful shutdown joins local operations before releasing the writer lock.
  Accepted/uncertain resources survive relay loss and shutdown until authoritative
  terminal evidence or their existing hard expiry. No reset/clear-debt command.
- `status`: read-only atomic journal/status snapshots, no writer acquisition;
  timestamp and observation age shown, explicitly not a live authorization claim.

Exit codes: 0 successful local operation/status or clean shutdown; 2 usage/config;
3 incomplete/unavailable diagnostics or retained work; 4 state/lock failure;
5 unsupported runtime/platform; 6 transport/backend failure; 1 unexpected sanitized
failure. JSON is newline-delimited objects with schema_version, command, code and
safe actionable messages; never raw errors, frames, keys or tokens.

## Environment and boundaries

POSIX local disk, owner-only config and state, single writer. Current authenticated
hook topology is same-host literal 127.0.0.1 HTTP with HMAC and explicit expected
boot/project/name/deployment. Remote/cloud hook support is not qualified. Agent
startup is entirely separate. No mandatory Docker. LiveKit bridge endpoint stays
WSS; development-only SDK management override must be literal loopback HTTP.
Changing identity/state paths is not recovery; existing unresolved work must be
retained. Future production needs enrollment/credential rotation, explicit binding
activation/drain, TLS relay and replay/reconciliation contracts with real authority.

## Hypotheses and acceptance tests

1. A source-only build may pass while the tarball lacks its executable or imports
   test code. First demonstrate the missing CLI, then pack/install into an empty
   consumer, with production dependencies only, and run the installed executable.
2. Config errors, absent credentials and unsupported Node may accidentally trigger
   effects or leak input. Exercise strict schemas, missing noninteractive inputs,
   unknown/secret flags, exclusive writes, redaction and startup gates.
3. Healthy local hooks may be mistaken for activation. Test available, explicitly
   unavailable, stale and unauthenticated samples separately from authorization.
4. Two processes or status reads may corrupt state. Test lock refusal, read-only
   status during a run, owner-only permissions and corrupt/foreign snapshots.
5. Shutdown/transport failure may clear uncertain work or race the next writer.
   Exercise interrupt, lost commit/terminal recovery, unknown reconciliation and
   retained debt, including reopen. No redispatch and no foreign deletion.
6. Through the installed artifact, drive loopback HTTP/Twirp/WebSocket plus signed
   hook responses: one preparation/authoritative commit, exact adapter readiness,
   terminal acknowledgment, verified cleanup. These are simulated service responses,
   not new LiveKit or media evidence.

Run typecheck, lint, all tests, build and 20-call synthetic proof on both exact
Node versions. Inspect npm pack allowlist, exercise clean installation, check
whitespace including untracked source, and verify historical hashes unchanged.

## Findings during implementation

A focused failing regression found that AuthenticatedHook.refresh forwarded the
optional authenticated cancelled_operation field into the stricter availability
schema. After cancellation, subsequent otherwise-valid health was classified as
unknown. The fix explicitly projects availability fields, retaining cancellation
metadata for cleanup while excluding it from availability. CLI_HEALTH_REUSE_RED.txt
records the failure. Reuse remains subject to all freshness/target checks.

The pinned SDK can print raw JSON parser failures through console.debug. The
standalone executable suppresses dependency console output and emits only its
own sanitized structured diagnostics. A malformed SDK response sentinel regression
checks this boundary. Since the SDK has no public fetch injection, the standalone
development process installs and restores a fetch policy allowing only configured
loopback origins and forbidding redirects. No shared application imports this
process policy; this package is a CLI, not the separate SDK.

## Expiry follow-up: completed calls must stay completed

Hypothesis: tick unconditionally re-marks every expired entry for cleanup and
reconciliation, including calls whose terminal authority result and verified
absence were already durable. An authority outage then strands new debt and
blocks admission. Reopening the journal reproduces it from persisted state.
Reconciliation also needlessly reopens cleanup on already-completed entries.

Use the existing completion invariant: terminal with no create, cleanup or
reconciliation debt. Skip completed entries in expiry and reconciliation without
rewriting historical state or changing the journal schema. Terminal alone is
insufficient: local expiry/departure retains reconciliation debt, uncertain create
retains create/cleanup debt, and active accepted calls still need terminal status.
A locally declined, verified-clean preparation with no possible acceptance is
also complete under this existing invariant.

Deterministic tests will cross wall and monotonic expiry with thrown/unknown/
forbidden/not-found reconciliation, reopen a real file journal after verified
terminal cleanup, and check authoritative decline completion. Negative controls
will retain polling/debt for active, uncertain, locally ended, unfinished creation
and unverified cleanup cases. Preserve previous evidence and both historical
cleanup debts; validate the exact Node 22.23.2/24.14.0 matrix, with no live sessions
or backend expansion. Record new evidence under CLI_EXPIRY_* names.

The first Node 22 full run also exposed an in-flight reconciliation race: a
read begun before terminal delivery can return after verified cleanup and requeue
cleanup using its old loop snapshot. A controlled-promise regression reproduced
it deterministically. Revalidate completion from the current journal after the
await (and after receipt ownership/expiry validation), before applying the result.
This preserves authoritative validation and does not suppress unfinished work.
