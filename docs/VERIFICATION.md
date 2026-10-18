# Verification checkpoint — 2026-10-19

The expanded standalone SDK's portable suite passes 387 tests / 3,714 assertions
across 27 files. Build/typecheck and built Node/Bun/Deno distribution checks pass,
including MissBlue inventory and zero-effect unsupported SMS construction.
MissBlue's 14 tests / 270 assertions include actual loopback HTTP with synthetic
backend receipts. A separate 21-case actual authenticated HTTP-route fixture
passes with explicit fake database/native boundaries. A separate real
PostgreSQL/PostgREST strict-text gate now includes MissBlue normal and exact
Unicode/whitespace sends, plus six refusal cases proving no native dispatch and
no reserved message. The native peer remains synthetic; MissBlue physical-device
acceptance remains pending.

Go passes normal tests, the race detector, vet and formatting (94.5% statement
coverage). .NET passes 19 actual HTTP cases in Debug and Release, and Release
package license/README checks. Both have no third-party runtime dependencies.
Python passes 34 tests and wheel/sdist license/typing-marker checks; Rust passes
19 tests with its crate license; C++ passes three local HTTP suites under
ASan/UBSan with warnings treated as errors.

The first isolated backend integration run passed 375 tests with 30 explicitly
unconfigured tool cases skipped. A fuller configured run then exposed omitted
helper configurations, a stale native source lock, and three five-second fixture
timeouts during concurrent compilation. After fixing the tool forwarding and
refreshing the reviewed native harness, the unchanged-timeout combined rerun
passes **405 tests / 3,826 assertions / 89 files**, zero failures, including the
new MissBlue actual-route and PostgreSQL cases. The first expanded run caught a
wrong expected route path in the new fixture; that assertion was corrected and
both focused and complete configured reruns pass. Three optional
ImageIO/caption cases remain skipped because their experimental pixel manifest
is not configured. This combines actual authenticated platform HTTP,
PostgreSQL/PostgREST, Storage and source-bound native fixture gates; it does not
run a fresh physical message or read transition. The MissBlue package's unit coverage and new Go/.NET HTTP tests remain separate
from this integration run.

GitHub Actions runs 39142526244 and 39144180024 did not start any jobs.
The latter confirms zero steps across all six current jobs. Its annotation reports
account payment/spending-limit configuration; no CI runner or repository test
executed. Local passes do not imply GitHub CI passed. No billing changes were made.

No new Mac installation is required for these client-only changes. Historical
device proof and remaining boundaries are in DEVICE_ACCEPTANCE.md. No new package
was published to a language registry and no fleet service was installed/restarted.


After the complete405-test checkpoint, a bounded MissBlue error-handling repair
preserved actual validated Chert reconciliation IDs in namespaced headers.
Updated portable/type/distribution checks pass. The affected actual-route and
PostgreSQL wrappers pass three tests /20 assertions, including two added native
lost-reply/wrong-ACK cases with one dispatch, matching durable IDs and spent
restart refusal. The six-provider PostgreSQL gate now checks31 pre-effect
reservation reads and17 total synthetic effects, plus six zero-dispatch refusal
cases. This focused result is separate from the preceding full combined run;
no fresh physical message/read operation occurred.
