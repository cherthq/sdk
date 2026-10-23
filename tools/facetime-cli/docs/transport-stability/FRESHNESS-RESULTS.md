# Authority freshness repair — 2026-09-30

Subsequent pilot outcome: two physical calls passed audio/video, but service-side hangup failed. The binding was drained at 20:11:54 UTC; the application is now degraded with Node stopped and the owner running. See [current pilot results](../pilot-activation/STATUS.md). The standby observation below is historical.

**Healthy standby qualified for this pilot observation.** The repaired relay and application are deployed. All 41 remote health and authenticated-authority samples passed over ten minutes, with generation 14 and Node PID 11 unchanged. Routing remains inactive for this connector; physical media is unverified.

The first relay repair tolerated a transient polling timeout but did not establish sustained standby. The local observer encountered network failures and a wall-clock suspension gap; its 600 seconds of monotonic time spanned a longer wall-clock interval and generation advanced from 11 to 12. At 19:24 UTC, the backend lease had expired at 16:00:17.29177 UTC while the application still reported healthy and Node retained an established TCP socket. The precise reason for the open stale socket is unresolved. The earlier data is retained in [the initial report](RESULTS.md), [observer output](standby-observation.jsonl) and [pre-replacement runtime](pre-freshness-runtime.json).

The relay now emits the fixed `chert-authority-v1` WebSocket ping only after a successful authenticated authority poll and role check, at most once a second. The CLI terminates a socket after five seconds without that marker, starting at welcome. Unrelated pings, pongs and business frames cannot renew freshness. Timeout uses existing disconnect/cleanup and bounded supervisor restart behavior. The earlier single poll retry remains inside the last-confirmed lease. No acceptance authority, readiness budget, restart limit or refill behavior changed.

The heartbeat is a transport availability signal, not call authorization or physical media readiness. Current backend generation/lease checks remain mandatory for each call. An older relay without this heartbeat will fail closed with the updated CLI; the heartbeat-capable relay was therefore deployed first.

## Validation

- Three new CLI regressions failed against the original transport: silent open socket, unrelated pings, and loss of valid heartbeats. The relay heartbeat test failed against the frozen first repair.
- Node 22.23.2 and 24.14.0: each CLI run reported 267 passes, four skips, zero failures (271 total); each relay run passed all 13 tests.
- Typecheck, lint and synthetic transport proof passed. The synthetic proof does not cover physical media.
- The built Linux amd64 production container, UID 10001 and Node 22.23.2, terminated a silent welcomed socket in 5,007 ms and cleared connected state.
- Application context differs only in the private CLI archive, its lockfile integrity and inputs manifest. The CLI archive differs only in compiled `connector-wire.js`. Existing dependencies, Python owner, supervisor, handler path, persistent scope and journals are retained.

See [review](REVIEW.md), [brief](FRESHNESS-BRIEF.md), [compiled transport diff](cli-freshness.patch), [application manifest](application-freshness-manifest.json), [relay manifest](freshness-relay-artifacts.json) and [container smoke test](freshness-container-smoke.json).

## Deployment

Relay deployment `12b0fdba-1ba3-479e-875e-f0870bdbd970` replaced the initial repair; the remote runtime files match the frozen artifact. Application deployment `1707de5b-fc2b-4378-ae1f-648025d20fdd` uses the new private CLI with the existing initialized volume and stable handler path. No initialization or enrollment was repeated. No backend or database change was required.

The running application image is `sha256:2f2aeccb6b9e2693b08c57fa7d2b19775f5d82cd8b12c0b6fa4906f84c390ac3`; the relay image is `sha256:d40291870e45af574be319ce8b6d2c503a9b56c6bb7aa621d1d6eb18fffe3463`. The application archive SHA-256 is `ac806813f126e68f9935f992ebae6b907cd402ec500eb6d97713ddb49fb43236`; relay archive SHA-256 is `7f3200e73c0990a70a80814a0e600fd7166e16ccdcf4aad9586a1529a91ccb83`. Both services remain singleton, always-on in us-west2 with zero overlap; application drain 70 seconds / restart NEVER, relay drain 30 seconds / bounded ON_FAILURE. See [effective settings](freshness-effective-services.json) and runtime identities for [application](freshness-application-identity.json) and [relay](freshness-relay-identity.json).

## Final remote observation

The finite observer ran on the application host from **19:32:50.691 UTC to 19:42:50.691 UTC**, exactly 600 seconds, taking 41 samples at 15-second intervals. Every sample returned healthy local IPC/process status and an authenticated, connected standby binding. Generation remained 14 and Node remained PID 11: no observed reconnect or process restart. Session readiness correctly remained unavailable because no session was staged. This interval is evidence for sustained standby, not an indefinite reliability guarantee.

The fresh database check confirmed standby, a current lease, unchanged assignment generation 3, original integration, `customer_decides`, no default Assistant, no current call and zero connector deliveries. Owner slots and all new journal entries/receipts remain empty; journals equal the pre-replacement snapshot. Both children remain UID 10001 with original credential partition and private permissions. The old room-journal checksum is unchanged. Provider inventory contains zero rooms. Historical debt and source evidence remain intact.

See [observation samples](remote-standby-observation.jsonl), [asserted summary](freshness-verification-summary.json), [database](freshness-final-database.json), [runtime](freshness-runtime-verification.json), [provider inventory](../standby-deployment/after-freshness-replacement.json) and [relay diagnostics](freshness-relay-runtime.jsonl). The observer completed and exited. Relay logs recorded three poll timeouts during the window (19:41:13.716, 19:42:13.969 and 19:42:44.053 UTC), while every sample remained connected on generation 14 and PID 11. This supplies deployed recovery evidence for transient poll failures in addition to the regression tests. No recurring monitoring or restart workaround was installed. The previous stale-socket cause remains unresolved, but the new watchdog's fail-closed behavior is reproduced and tested.

## Scope

This work remains standby-only. No binding activation, provider staging, physical call, automatic refill, Mac change or npm publication occurred. The historical debts remain intact. The former `/webhooks/talking-head` endpoint still returns 404; the unchanged legacy route is not ready for incoming calls. Pilot activation requires fresh routing inputs, followed by the bounded physical audio/video and cleanup checks. Process and transport health alone do not satisfy those checks.
