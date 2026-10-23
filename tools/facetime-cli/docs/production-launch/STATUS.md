# Production launch — 2026-09-30

**Active production pilot: demo-agent-0 on Chert FaceTime Test / Mac 2, with caller-ended calls and continuous session preparation enabled.** The first automatically prepared audio/video session was observed ready at 20:30:30 UTC. Live idle expiry, cleanup and automatic replacement passed at 20:35:00 UTC. Final runtime checks confirm active connected authority and another ready audio/video session.

The user explicitly waived service-side hangup as a launch blocker and selected continuous availability. The earlier two physical calls established two-way audio, moving agent video and responses. The service hangup failure remains recorded in [the physical test report](../pilot-activation/STATUS.md); callers must end their calls. No Mac change or additional physical test call was made during this launch.

## Deployed identity and routing

- Railway project `56930118-77fc-479a-a12f-4c453e7e987c`, service `679aad53-1b81-4198-a4ae-1bd0cd357b19`, production environment `7815a140-42c1-4238-b72d-fb2935923123`.
- Application deployment `a8820b15-e8be-4f09-b798-08c5d20779fa`; Railway-recorded image digest `sha256:de0bc25aabc894d9408350ec5092114c53f56a0e8d37cb2419be7d2b3605446f`; instance `3e2d004e-e594-49fd-a06e-c3ec179b2d4f`.
- Fresh BYOR binding `bb0d9eef-a165-4e5f-bec1-a0dcad5c6f87`, instance scope `2d7104b6-9c32-4b69-90f0-005b540b607e`, activated at 20:29:51.370 UTC. Authenticated active authority observed on connection generation 2 after the expected activation reconnect.
- Project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, line `59b3e3d0-945b-45da-b907-027103941a65`, worker `dedea298-97e0-4321-8c85-1deca994b2a0`. Fresh activation used no prior active binding and assignment generation 3. Original integration, `customer_decides`, and no default Assistant remain unchanged.
- Shared relay deployment `12b0fdba-1ba3-479e-875e-f0870bdbd970` was not replaced. This launch did not change backend code/schema, CLI package, callback handler, Python owner, media/expiry policy or Mac release.

Production settings retain one replica, no sleeping, zero overlap, 70-second draining grace, `/healthz`, bounded child restarts and Railway restart policy NEVER. All processes run as UID 10001 with private state and the existing provider/connector credential partition. Owner/admin credentials were used only locally for management and were not deployed. Verified runtime files match the reviewed context; no qualification directory is present in the production image.

Evidence: [deployment identity/settings](production-build-final.json), [standby verification](standby-runtime.json), [activation inputs](activation-inputs.json), [activation result](activation-result.json), [active runtime](active-runtime.json), [enable request](continuous-enable-request.json), [enable result](continuous-enable-result.json).

## Continuous preparation

The only production source change is an opt-in controller in the container supervisor. It invokes the Python owner's existing private staging API, persists an intent before sending, requires active connected authority, and waits for both application and connector cleanup. Ambiguous requests, uncertain resources and incomplete lifecycle records block replacements. It preserves one session at a time and the existing audio/video readiness checks.

The controller's durable enabled policy resumes after restart. There is a preparation gap after cleanup or unused-slot expiry. Idle readiness consumes provider sessions periodically. The 600-second conversation resource ceiling remains; it is not a guarantee of native FaceTime disconnection. Bounded restart exhaustion, crash locks and unresolved provider operations still require operator attention.

See [operator controls](CONTINUOUS.md), [brief](BRIEF.md), [review](REVIEW.md), [source manifest](continuous-context-manifest.json) and [observation samples](continuous-observation.jsonl). The legacy HTTP webhook route remains unavailable; the activated connector supplies incoming routing. No npm release or other customer project is included in this launch.

## State preservation and deployment recovery

The old drained binding `0b758533-1c9a-4cc0-b5a5-cfcd2464b281` remains drained. Before replacement, both calls were terminal, all lifecycle deliveries acknowledged, all slots clean, provider inventory empty and the line idle. The old supervisor and children were stopped; no live writer or Node crash lock remained. Its entire subtree was renamed to `/state/chert-pilot-retired-20260930`, and a private local archive was retained. Its file hashes remain unchanged. Only a newly provisioned subtree was initialized for the fresh binding; no prior journals, locks or historical debts were deleted or rewritten.

The initial Railway `redeploy` attempt (`2c9855eb-a307-4bfc-80c3-8bc54b8cd36f`) reused the previous launch configuration and failed before startup with a missing Python executable. It made no provider allocations. Uploading the frozen context applied the intended maintenance configuration successfully (`8b19eaef-e01d-412f-ad5a-3af08f0d89e0`). The final production upload uses the reviewed continuous controller. The failed attempt's metadata is retained; its unexpected runtime/image behavior is not represented as a passing restart test.

Evidence: [preflight route](lines-preflight.json), [provider before transition](../standby-deployment/before-production-launch.json), [retired state hashes](retired-state.json), [private backup metadata](retired-backup.json), [fresh initialization](fresh-initialization.json), [failed deployment metadata](maintenance-inventory-latest.json), [successful maintenance deployment](maintenance-ready.json).

## Validation

The finite live observer ran for approximately 287 seconds. All 20 process-health and authenticated-authority samples passed, remaining active and connected on generation 2. The initial unused session reached its configured expiry at 20:34:45 UTC; by 20:35:00 UTC its slot was clean and one replacement was ready. Independent provider inventory confirms the original room is absent and only the replacement room remains. No new call occurred. The observation exited; continuous preparation is part of the deployed supervisor, not a laptop polling job.

See [live observation summary](continuous-summary.json), [observer completion](continuous-observation-result.json), [provider after replacement](../standby-deployment/production-after-turnover.json), [final runtime](final-runtime.json), [final deployment](final-deployment.json), [Mac idle state](mac-final.json) and [final route](lines-final.json). The ready room's pending cleanup receipt is expected live ownership, not leftover debt. New sessions continue to be prepared only after prior cleanup.

Five runtime unit tests and eight new controller tests pass. The eight controller tests pass in Linux amd64 and again on the deployed Railway host using isolated temporary files, synthetic callbacks and no provider credentials. Nine local container regressions pass with provider substitutes and networking disabled. The final targeted container test verifies inactive-authority refusal, initial readiness, restart without duplication, terminal cleanup followed by one replacement, disable, and resource absence.

See [validation summary](validation.json), [container regression output](container-tests.txt), [final continuous container test](continuous-container-final.txt), [remote controller tests](remote-controller-tests.json) and [first real prepared room](../standby-deployment/production-first-ready.json). These tests supplement the earlier physical media evidence; they do not turn the failed service-hangup check into a pass.
