# Standby transport repair — 2026-09-30

**Later result:** the authority-freshness follow-up is deployed and passed ten minutes of remote standby observation. See [the final repair report](FRESHNESS-RESULTS.md). The initial repair and failed qualification below remain historical evidence.

## Failure and repair

The installed production CLI exited with transport error 6 at 14:32:27.019 UTC. A simultaneous read-only authority probe from the actual relay host encountered its 2,000 ms timeout at 14:32:27.587 UTC, with another timeout a minute earlier. The original relay discarded the WebSocket on every polling exception. These observations identify transient authority failures as a concrete trigger; the underlying source of intermittent latency is not established. The second diagnostic CLI session ended without its final output, so no close code or successful duration is claimed for that run.

The relay now retries a replayable authority poll once, after 100 ms, for timeout/network/429/5xx failures. Each request is capped at two seconds and the remaining last-confirmed five-second lease, conservatively measured from request start. A failed or uncertain request cannot renew that local deadline. Authentication rejection and malformed responses fail closed; backend generation/revocation checks still run on every retry. Decisions, acknowledgements and connection acquisition are not replayed. The application supervisor's bounded starts, readiness rules and call budgets are unchanged. Diagnostics contain fixed error categories, action names and numeric status only.

See [review](REVIEW.md), [incident brief](BRIEF.md), [authority observations](authority-observation.json), [original CLI observation](original-cli-observation.jsonl) and [source patch](relay.patch).

## Validation and deployed identity

All 12 relay tests passed on Node 22.23.2 and Node 24.14.0. The initial reproduction failed against the original source. The suite covers an actual two-second stalled poll, repeated outage, 401/403, malformed response, role change, decision non-replay, network reset and the original lease deadline after slow connection acquisition. These are transport tests, not physical media evidence.

- Relay deployment: `9de3f096-fbb2-4105-8934-6f630c619e68`; instance `bc95c7c2-a0c7-4be1-9e15-bb4a04b1f5b2`.
- Railway relay image: `sha256:86ca5a60cdaf985a797efd18f8dcc8d6b2388aba6b6dd5270b4853200f1fc2f5`.
- Frozen repair archive: `81f8d73a9918c53820242f63b3f4737ed12b6d058553490f3e6f6e7597f74132`. The previously deployed Railway configuration was retained byte-for-byte.
- Running relay Node: 22.23.2. Remote main/relay/config/lockfile hashes match the frozen manifest.
- Application deployment remains `998b7608-c0ee-40fd-8a70-1a93af55b21c`; image remains `sha256:7b7e03ca6e0c3c51febb629132449b8352f10e1c927ec0265141b77e25a3add2`. One provider restart reused initialized persistent state, without initialization or provisioning.
- Binding remains `0b758533-1c9a-4cc0-b5a5-cfcd2464b281`, epoch 1, BYOR standby, instance scope `44850d10-2625-4abc-9811-512348dea018`. The restarted runtime connected with generation 11.

Both services retain one always-on replica in us-west2, zero overlap, application drain 70 seconds / restart NEVER, and relay drain 30 seconds / bounded ON_FAILURE. Backend release, migration, credentials, application image and provider configuration were not changed. See [artifact manifest](artifacts.json), [remote identity](relay-runtime-identity.json), [relay deployment](relay-deployment.json), [application deployment](application-deployment.json) and [effective services](effective-services.json).

## Remaining boundary

This repair authorizes standby only. No binding activation, real staging, physical calls, automatic refill, Mac changes or npm publication occurred. The old `/webhooks/talking-head` endpoint still returns 404; the unchanged legacy integration URL is not a working incoming-call route. Physical audio/video and cleanup must be verified after a separately reviewed pilot routing transition, using fresh compare-and-set inputs and the bounded runbook. All historical debt and earlier failed observations remain intact in the [original deployment report](../standby-deployment/RESULTS.md). Live hot filesystem detachment remains untested and is not an additional required packaged qualification case.
