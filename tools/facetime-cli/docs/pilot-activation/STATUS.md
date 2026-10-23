# Supervised BYOR pilot results — 2026-09-30

Subsequent launch decision: the user accepted caller-ended termination and authorized continuous production availability. A fresh binding is now activated; see [production launch](../production-launch/STATUS.md). The failed service-hangup result below remains unchanged.

**Audio/video passed twice; service-side hangup failed. The pilot is drained and is not ready for unattended calls.** The caller explicitly confirmed they hung up the second call. No third call or staging attempt was made.

## Physical results

| Check | First call | Second call |
| --- | --- | --- |
| Explicit ready-slot preparation | 3.866 seconds | 2.711 seconds |
| Incoming call claimed staged session | Passed | Passed |
| Two-way audio, moving agent video and responses | Caller confirmed | Caller confirmed |
| End behavior | Caller hung up | Service end failed; caller hung up |
| Final application/provider/Mac cleanup | Clean | Clean after caller hangup |

First call `5f6ce432-4323-460a-a5cb-3d31e841e7b6` became centrally active at 20:05:49.375 UTC and ended at 20:07:05 UTC (`remote_ended`), approximately 75.6 seconds connected. The caller initially saw the connecting screen, then corrected that it connected and confirmed everything worked. No service end request was sent.

Second call `c8284192-2b61-4e26-8261-7f5a561a88fc` became centrally active at 20:09:32.345 UTC. The single service end request returned HTTP 202 at 20:09:53.824 UTC. Worker command `01a2b437-9164-47eb-b756-665aa5bb6c1d` failed at 20:10:04.082 UTC with `command_failed` after one attempt. The call remained open until the caller hung up at 20:10:24 UTC (`remote_ended`), approximately 51.7 seconds connected. HTTP 202 acknowledged scheduling, not successful native disconnection.

Caller reports: first, “yes, everything worked. thanks!”; second, “yes, everything works, video and audio and responses, thanks!”; after the specific disconnection question, “i hung up”. These establish physical media success and caller-ended termination, not service-ended termination or caller-video acceptance.

Evidence: [first observation](first-call-observation.jsonl), [first cap](first-call-cap.json), [second observation](second-call-observation.jsonl), [end request](second-end-request.json), [central command/event timeline](second-call-timeline.json), [Mac lifecycle](mac-second-lifecycle.json), [media tracks](media-during-call.json).

## Cleanup and timing evidence

After the first hangup, the application reported clean at 20:07:14.198 UTC, about nine seconds after termination, with zero resource receipts. Its clean predicate includes verified absence of owned rooms. Independent provider inventory and Mac probes followed at approximately 20:07:40 UTC; those later probes corroborate cleanup but are not direct provider observations within 30 seconds.

During the failed second hangup, the 20:10:13 UTC snapshot still showed an active call and an owned provider room. These intermediate failures remain preserved. Following caller hangup, central cleanup completed at 20:10:27.271 UTC and stop-bridge completed at 20:10:28.128 UTC. Resource, application and connector journals were last written at 20:10:27.940, 20:10:28.173 and 20:10:28.177 UTC respectively. The 20:10:57 UTC snapshot verified clean terminal records and zero provider rooms. Journal timing supports prompt cleanup, but the independent final snapshot was about 33 seconds after termination; it is not a directly observed sub-30-second provider probe.

Final checks confirm both connector records terminal, settled, clean and fully acknowledged; zero resource receipts and provider rooms; the Mac line available with no current call and both local media sessions disconnected. Retained terminal journal entries and decision receipts are history, not unresolved resource debt.

Evidence: [first cleanup](first-cleanup-proof.json), [second intermediate failure](second-cleanup-proof.json), [second final cleanup](second-cleanup-final.json), [journal timestamps](journal-cleanup-timestamps.json), [owner after drain](owner-after-drain.json), [Mac after drain](mac-after-drain.json), [provider after drain](../standby-deployment/after-pilot-drain.json).

## Final deployment state

The refreshed owner/admin token passed membership verification. Binding `0b758533-1c9a-4cc0-b5a5-cfcd2464b281` was activated at 20:02:58.997 UTC for Chert FaceTime Test, project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, line `59b3e3d0-945b-45da-b907-027103941a65`, worker `dedea298-97e0-4321-8c85-1deca994b2a0` (Mac 2 FaceTime Worker). Exactly two slots and two calls were used.

After the failure, the binding was drained at 20:11:54.895 UTC. The 20:14:39.911 UTC database check confirms `draining`, generation 16, disconnected, zero unacknowledged deliveries and no current call. Assignment generation remains 3, original integration remains `946445e1-2c0f-478d-a049-72c8dd9762f2`, policy remains `customer_decides`, and no default Assistant was assigned.

Application health now reports degraded: the Python owner remains running, while Node reports `restart_budget_exhausted_or_fatal`. No restart-budget reset or replacement was attempted. Generations progressed from 14 in qualified standby to 15 after activation and 16 before the second call; the earlier fixed-generation standby observation must not be generalized to this activation interval. No ready slot remains and automatic refill is disabled. The unchanged legacy webhook route was previously verified as 404, so draining does not restore a usable legacy route.

During healthy idle operation the health field `mode: standby` describes absence of a ready slot, not authoritative binding state. Use authenticated authority/database state to distinguish active, standby and draining.

Evidence: [activation](activation-result.json), [second-call authority](active-authority-second.json), [drain](drain-result.json), [final database](database-after-drain.json), [health after drain](health-after-drain.json). Historical [preflight](PREFLIGHT.md) is retained and superseded by this report.

## Failure boundary and next gate

The failed command reached the Mac worker; the underlying exception is not preserved in the central result. Pinned running source `647b9f66ce39a5e37634b50f28f0a11dc7583558` shows `ControlPlaneClient.executeAndComplete` collapses end-command errors to `command_failed`. The local end route calls the native coordinator before marking the call ended. `FaceTimeCallControl.endFaceTimeOnce` inserts its deduplication marker before awaiting `controller.end()`. This deserves review because a thrown native action can leave the marker set; it is a source-level concern, not proof of this call's specific failure. Local lifecycle events contain no successful API-requested end. The precise underlying native/control error remains unresolved.

Repair and qualify the Mac end-call path, then repeat a bounded service-ended physical call before enabling normal admission. Restore a healthy connector through its supported lifecycle after the repair; a drained binding is not reusable standby. Preserve journals and unresolved historical debts. This run stopped at its two-call limit and did not alter Mac code/configuration, change deadlines, create refill automation, publish npm packages or operate unrelated customer calls.

Running Mac binary SHA-256: `1ee0d259cfb71fca55a8c11c3bcd8eeb2c2ecc3824bfb409473195d1882affae`; all 121 manifest files verified. Application deployment: `1707de5b-fc2b-4378-ae1f-648025d20fdd`, image `sha256:2f2aeccb6b9e2693b08c57fa7d2b19775f5d82cd8b12c0b6fa4906f84c390ac3`. Relay deployment: `12b0fdba-1ba3-479e-875e-f0870bdbd970`, image `sha256:d40291870e45af574be319ce8b6d2c503a9b56c6bb7aa621d1d6eb18fffe3463`. No application source changed during these tests; validation consists of deployed-state checks and two physical calls, not a new unit-test run.
