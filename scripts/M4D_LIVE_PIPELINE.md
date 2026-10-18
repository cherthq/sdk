# M4D pipeline acceptance: current and historical boundaries

## Current strict-provider path

The four provider CLI plans below are historical. Current adapters use strict
text operations; `m4d-live-pipeline.fixture.mjs` deliberately refuses those paths
before SSH or an attempt claim. Do not bypass that guard or restore legacy
`/send` to reproduce an old receipt. Generic language-client legacy plans remain
a separate contract and do not verify the current provider path.

The current harness is `m4d-live-text-acceptance.mjs`, exercised through
`scripts/test-attachment-native-postgrest.sh`. Its offline `--text-live-contract`
mode uses real authentication and disposable PostgreSQL for five adapters. The
explicit `--live-one-text ABS_OWNER_0600_PLAN` mode requires a separately reviewed
installed server/helper receipt and permits one legacy Blooio strict text request.
Installation receipts now exist; the current native pair is R7 (FT-INSTALL-097), while the
fresh plaintext fidelity receipt below was produced under R2. Exact source,
fingerprint, permanent claim and physical evidence requirements are documented in
[route acceptance](../tests/ROUTE_HTTP.md#strict-text-live-harness-preparation--2026-10-18).
Version 2 plans now support each provider separately through
`--live-one-text-provider PROVIDER ABS_OWNER_0600_PLAN` (one of `blooio`, `linq`,
`sendblue`, `blooio-v4`, `loopmessage`). They learn the actual committed cloud ID,
revalidate its frozen reservation, then fsync that ID/tuple into the permanent
claim before dispatch. They neither inject a chosen UUID nor add unsupported SDK
idempotency fields. A fresh version 2 Sendblue plaintext plan passed on M4D:
run `e5d0a306-135b-4489-be19-8d730d1bb559`, immutable receipt SHA256
`9a6252776741243ea601552a033df0125aa26535be4e3d2f9a4d7f7c38235bcb`.
The exact recipient scalar preserved the original ASCII edge spaces, CRLF,
slash and Unicode; a NULL sender scalar was accepted only with byte-identical
bounded attributed bodies at the same exact GUID. This proves that one fresh
plaintext case, not arbitrary caption fidelity or endurance. The earlier
pre-admission `e002…` failure remains a separate no-effect receipt; the original
caption fidelity failure also remains failed and spent. Do not rerun either.

Current R7 no-effect reaction inspection passes account ownership and exact-GUID
loading, then refuses at `selection_graph_bound`. No live reaction or journal is claimed.
Each new invocation still requires its own valid source/installed-package-bound
plan and permanent claim; an old receipt is evidence, not a reusable send plan.
See the [dated physical evidence](../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md)
for the distinct runs and current installation boundary.

## Historical legacy-runner contract

Prepared local tooling; no live execution is implied by an offline test.

The runner retains **the actual provider SDK/adapter → loopback HTTP → actual Chert route → actual `sendFollowUp` → actual mini-server legacy `/send` → M4D bridge**. Only authentication, Supabase storage and the device HTTP network boundary are substituted. The real conversation append function runs against the synthetic database RPC; confirmed sends can append, queued sends cannot. No production cloud authentication or database is accessed.

Each invocation authorizes exactly one provider-bound UUID marker and one native attempt. The original Blooio CLI remains unchanged. After reviewing a specific provider plan, the primary may execute that plan exactly once; for example:

```sh
bun --no-install sdk/scripts/m4d-live-pipeline.mjs --one-reviewed-blooio-pipeline-send
```

Available one-send plans (choose one per reviewed invocation):

| Provider | Explicit CLI flag | Real Chert HTTP route |
| --- | --- | --- |
| Blooio SDK 0.0.2 | `--one-reviewed-blooio-pipeline-send` | `POST /api/v1/send` |
| Linq SDK 0.78 | `--one-reviewed-linq-pipeline-send` | `POST /api/v1/chats/chat-a/messages` |
| Sendblue SDK | `--one-reviewed-sendblue-pipeline-send` | `POST /api/v1/chats` with approved from/to |
| Blooio v4 fetch adapter | `--one-reviewed-blooio-v4-pipeline-send` | `POST /api/v1/chats`, from official direct `/v4/messages` from/to/text |
| Python generic Chert client | `--one-reviewed-python-pipeline-send` | `POST /api/v1/send` |
| Rust generic Chert client | `--one-reviewed-rust-pipeline-send` | `POST /api/v1/send` |
| C++ generic Chert client | `--one-reviewed-cpp-pipeline-send` | `POST /api/v1/send` |

The three language plans exercise generic Chert JSON transports, not additional
provider adapters or provider parity. Each actual client runs in a subprocess and
posts `{phone, body}` through the same real Chert `/send` handler. The pinned
synthetic lead and broker bind the approved sender and recipient. Native helpers
must be built and reviewed first; missing or non-executable helper configuration
fails before an attempt. There is no JavaScript transport fallback.

Python imports `sdk/python/chert` directly. Rust and C++ require dedicated
**pipeline** helpers, distinct from the read-only inventory helpers:

```sh
# Set only reviewed, locally built test helper paths.
export CHERT_PIPELINE_RUST_CLIENT="$PWD/sdk/rust/target/debug/examples/pipeline_fixture"
export CHERT_PIPELINE_CPP_CLIENT=/tmp/chert-cpp-sdk-20261017/chert-sdk-pipeline-fixture

# Run exactly one reviewed plan, never this list as a batch/retry loop.
bun --no-install sdk/scripts/m4d-live-pipeline.mjs --one-reviewed-python-pipeline-send
# Alternative reviewed invocation:
# bun --no-install sdk/scripts/m4d-live-pipeline.mjs --one-reviewed-rust-pipeline-send
# bun --no-install sdk/scripts/m4d-live-pipeline.mjs --one-reviewed-cpp-pipeline-send
```

Each helper accepts only `--one-reviewed-pipeline-send BASE_URL` and exact stdin
`{phone,body}`. The URL is the fixture's literal `http://127.0.0.1:PORT` origin;
keys are synthetic. Phone and language-bound UUID marker are validated before
one actual request with a 45-second timeout. The server independently checks the
exact origin, path, method, credential, recipient and marker, returning a generic
rejection without printing mismatched private inputs. Helper output is bounded;
only whitelisted ID/status evidence enters the receipt. A helper timeout or lost
reply is unconfirmed and never authorizes another attempt.

`chat-a` is a synthetic local record for the already approved recipient, not a production database record. The `/chats` route uses its real sender/tenant/line and existing-recipient resolution against the synthetic DB. No routing helper or device-send helper is mocked. There is no multi-provider live loop: approval, marker suffix, receipt provider and request must match, and cross-provider markers are rejected before an attempt is spent.

This is a **real single synthetic message** to the recipient already named in the approved M4D configuration. It is not a dry run. Do not run it to investigate an earlier unknown outcome.

The runner reads the existing approved sender/recipient configuration remotely, checks the bridge health/mode/running account, generates a fresh UUID marker, then creates a private `0600` receipt with exclusive creation in a new private temporary directory. No account credentials leave M4D. Account numbers stay in process memory; receipts retain suffixes only. The child uses only synthetic local API/device credentials and a loopback HTTP server.

The network broker accepts exactly one plain-text request for that marker/recipient, preserving the actual pipeline-generated `followup:...:bubble-0` idempotency key. It adds **only** `native_sms_disabled: true` at this explicit acceptance boundary to prevent SMS fallback. This is not a change to production defaults. An exclusive `.attempt` sentinel and fsynced receipt spend the attempt before SSH; an unavailable response never permits replay. The remote side repeats health/account checks immediately before its sole `POST /send`, forwarding the real native response in memory to the mini-server parser. Receipt fields are whitelisted; arbitrary server bodies/errors and phone numbers are excluded.

The receipt is updated before acceptance assertions, including the SDK result, actual route HTTP status, synthetic event persistence and actual append count. A queued native response remains queued; it does not become a claimed delivery. Read-only observation uses the **explicit existing sender `STATE_DB_PATH`**, SQLite `mode=ro` and `query_only`, and the exact returned outbox ID. It verifies the preserved idempotency key and recipient, waits at most 40 seconds for that row's stored GUID, then waits at most 40 seconds for the exact recipient GUID with the marker, inbound flag, sender account and `iMessage` service. No latest-recipient query or uninstalled HTTP status implementation is used. Missing configuration, missing row/GUID, an exception or a timeout leaves acceptance incomplete. It never resends.

On failure, inspect the printed receipt path and reconcile that existing native ID. Do not rerun, reuse the receipt, change the idempotency key, or delete its `.attempt` sentinel to bypass the guard. No service or package is installed by this runner. No per-Mac installation-log entry is required.

Offline checks:

```sh
CHERT_PIPELINE_RUST_CLIENT="$PWD/sdk/rust/target/debug/examples/pipeline_fixture" \
CHERT_PIPELINE_CPP_CLIENT=/tmp/chert-cpp-sdk-20261017/chert-sdk-pipeline-fixture \
bun test sdk/tests/m4d-live-pipeline.test.ts
```

With both reviewed helpers configured, the focused suite passes **32 tests / 383 assertions**. Without native helpers, their subprocess cases are explicitly skipped; this does not establish native-language acceptance. These verify exclusive receipt creation, secret redaction, spend-before-transport, no second attempt after uncertainty, and all four complete real local provider pipelines and all three generic language-client pipelines with the recorded HTTP 200 native GUID acknowledgement (`success:true`, durable ID/GUID, explicit false delivery, no status/queue/owner). It must produce queued cloud/SDK acceptance, persist the returned ID and avoid a confirmed conversation append. Each of the seven plans also has a spent-attempt/foreign-marker guard check. Language tests additionally reject failed SDK status despite complete receipt evidence, unconfigured helpers, invalid helper guards/origins/markers/fields, and wrong HTTP bodies before any native attempt while keeping phones and markers out of stdout/stderr. The private child `--offline-pipeline-contract` path cannot perform SSH and labels its receipt `offline-contract`; it does not establish physical delivery.

## Current strict reaction acceptance boundary — 2026-10-18

The legacy pipeline above is not the strict reaction runner.
`m4d-live-reaction-acceptance.mjs` uses separately reviewed private source-bound
plans, installed-pair bindings and an exclusive durable claim before one effect.
Only explicit live flags in `scripts/test-webhook-postgrest.sh` activate it; normal
tests never contact devices. Spent plans and failed receipts must never be rerun.

Genuine Linq SDK like add/remove passed on R8 through actual authenticated Chert
routes and disposable PostgreSQL, with caller acceptance saved before exact
reserved-GUID events were observed on both accounts. The failed earlier
remove-love receipt remains failed despite read-only event reconciliation.
The current FT-INSTALL-098 launchd service preserves the R9 helper and all four
journal rows; the R9 no-send inspection and physical receipts retain their
original boundaries. Other provider reaction contracts,
current aggregate/UI state and full SDK parity remain unverified.
See [dated evidence](../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md).

## Historical installed service — FT-INSTALL-098

At the FT098 checkpoint, M4D served Messages directly from the unified launchd executable, PID 30527,
SHA256 `7ac67fb5a6430bdc3910cdaf68e8db780028e0b08cb154c6c2e933bfc69884e2`.
The existing Messages/helper process PID 23940 was preserved; helper SHA256 is
`24c0b22b9a2da7ff81b0d36990a01a30a6d415a81fac4878ca0e420e5046c2e1`.
The reviewed manifest SHA256 is
`d5251162a383c24c07dc76fb82045f44e474e977626dc0873d0a2e488f1876e7`,
with 216 current source inputs independently verified. These are installation
receipt identities, not permanent PID expectations for future runs.

Actual executable and fixed serving argv, listener, launchd ownership/status,
owned logs, retained operation ACK and missing-operation GET checks passed.
The Messages tmux session is absent. Configuration and all journals, sender and
recipient Messages processes were preserved; ingress resumed, security settings
were unchanged and migration sent zero messages. The server targets macOS 15
and statically links official-source Opus 1.6.1 with matching public headers;
the actual host is macOS 26.4, not macOS 15 runtime acceptance. The R9 helper
remains separate, FaceTime/media are not integrated, and managed restart is
explicitly unsupported.

A fresh source-bound genuine Sendblue SDK plaintext acceptance passed on the
installed FT098 launchd service. Actual authenticated Chert HTTP and disposable
PostgreSQL reservation, with two fingerprint checks, preceded exactly one
native POST. SDK acceptance stayed queued; exact GUID sender/recipient
iMessage evidence preserved two ASCII boundary spaces, slash, Café/emoji and
actual CRLF. Run `c0f60750-501f-4bd2-9458-423c6fb31315` has private receipt
`/private/tmp/chert-unified-activation-20261018/c0f60750-501f-4bd2-9458-423c6fb31315.receipt.json`,
SHA256 `e614ad3dbc882a1edbbef3d3df19e3c8d5da87c109262b809476fa33f1a90ba5`.
It passed with one effect and no retry. The migration itself still sent zero
messages; this was a distinct, separately controlled one-message physical test.
Previous receipts retain their original installed-pair and scope boundaries.
That checkpoint recorded 436 passing SDK tests. This pass does not
establish all providers, media, caption fidelity, endurance or macOS 15 runtime
acceptance.


## Current read-only installation check — 2026-10-19

A fresh read-only check matched FT099 R2: worker PID49389 SHA256
`fa491416e3f07a2cd55f690e235b5eb327bad79f2631a71665677d5a5e1e3c75`,
sender Messages PID49308 and recipient Messages PID50207, both loading helper
SHA256 `542efd451a064eef5e9e61881b79ccab561a62aff818c5e04f0e4bb732f6362a`.
These are dated observations, not future process assumptions. Receiving-context
wire emission remains off. The FT100 mark-read candidate is not installed.
The seven controlled unread rows remained unread during a separate audit;
no read, send, service restart or account/security change ran in that audit.

The source-bound offline webhook harness was rebuilt as R11 after its older
R10 source lock correctly rejected a changed Makefile. Three actual local
PostgreSQL relay/native-webhook tests passed, retaining the same historical
device export. This is not new device contact or original live callback proof.
