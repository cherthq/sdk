# Standby deployment continuation — 2026-09-30

The supplied admin login token was verified as owner of the exact Chert FaceTime Test project. It is loaded only from the user-designated private file and can be supplied in memory as `CHERT_USER_ACCESS_TOKEN`. No token values are in this report.

## User-identified owner follow-up at 13:51 UTC

In response to the question identifying the historical agent/cleanup owner, the user specified **demo-agent-0**. Using that identification, a read-only check ran inside the existing `talking-head-webhook` deployment with its original runtime credentials. Its configured LiveKit host is `chert-byor-staging-wi1rapq6.livekit.cloud`, namespace `demo-byor`. An exact-name room-list request returned **zero rooms** for `interview-697d9bb7a1cc4eb09501b83ba82597d2`. See [sanitized provider observation](demo-agent-historical-room-check.json).

The current schema-2 journal contains neither the historical call ID nor that room name; journal absence is not itself cleanup evidence. The positive evidence is the user's identification of the owner, the authenticated room-absence result in that owner's configured project, and the already-recorded Mac `cleanup_complete` event. Historical provenance is user-supplied rather than independently reconstructed from the pruned journal. This resolves the request to identify/check the pilot's provider owner and supplies the requested LiveKit room-absence observation. It does not assert arbitrary external rendering-job cleanup or repair `cleaned_at`. No room, dispatch, journal, credential, line configuration or Session row was changed. Do not ask the user again to identify the selected agent.

The three Brodie Sessions still lack recorded worker cleanup. Their resolution is outside the authorized pilot-only resource changes and remains a prerequisite of the reviewed shared-backend release. There is no new request to expand scope or waive that gate in the user's agent-name clarification. The previously requested pause in pilot testing has also not been confirmed.

## Host test interpretation correction

The earlier report treated live removal of `/state` during child restart as an additional deployment gate. That was broader than the packaged cases the request asks to repeat. The actual reviewed cases are:

- `packaging/railway/tests/test_container.py:206`: a missing journal during child restart must refuse recreation while leaving the owner alive.
- `packaging/railway/tests/test_container.py:216`: a missing mount must refuse normal startup.

Both required failure paths ran on Railway: [missing-journal restart/startup](uncertainty-missing-output.txt) and [missing-mount startup](no-mount-log.jsonl). The deployed runtime calls `preflight()` before every child start (`packaging/railway/runtime.py:205`); that preflight verifies the mount before inspecting journals. This source relationship does not claim a live-detachment experiment occurred. Hot removal of a mounted volume remains untested, but is no longer represented as a separate required packaged test. No privilege escalation, product source change, or new test service was needed for this correction. The previously measured 70-second Railway drain setting remains the proposed launch setting.

## Concrete cleanup ownership and call-window blockers

[Fresh cleanup/event inspection](cleanup-owner-review.json) distinguishes the outstanding work:

- Historical pilot Session `53945278-4dcf-4a4d-817a-73702d67799d`, call `01256872-9ba3-44c7-b320-a2f686f6f558`: the worker's cleanup event predates arrival of the terminal event, matching the known deployed ordering defect. The historical integration URL was `mock-interview-agent-1.apps.thalesops.com`, room `interview-697d9bb7a1cc4eb09501b83ba82597d2`. Initial infrastructure discovery did not identify that host. The user's later owner identification and the exact-room check are recorded above and supersede the missing-owner-input status; the historical integration URL is preserved as evidence.
- Three historical failed Sessions belong to **Brodie** and have no recorded `cleanup_complete` event. Their identifiers and event timestamps are retained in the read-only evidence. The current task explicitly excludes changes to unrelated customer projects; their records, workers and provider resources were not changed.
- During this continuation a newer pilot call was observed ending; a later read found that call settled and a different pilot Session allocating. Existing testing is therefore concurrent with this release attempt. No call was interrupted, no admission/routing change was made, and no maintenance fence was applied.

The user has been asked for the old agent's deployment/repository or cleanup receipt, and to identify when pilot testing is paused. These are concrete missing inputs, not another approval request for already-authorized deployment. The shared release remains conditional on its reviewed drain/cleanup predicates. The exact migration payload is unchanged; no historical row repair, false cleanup, schema mutation, enrollment, deployment promotion or routing activation has occurred in this continuation.

At 13:45:33 UTC the [final read](continuation-final-gates.json) found zero nonterminal calls and the pilot idle again, with generation 3 and unchanged routing. The four historical uncleaned Sessions remain. This idle snapshot does not establish that concurrent testing has been paused. The original continuous owner's journal was inspected read-only; [observation](original-owner-continuation-observation.json) records its hash and collection sizes, without credential values or claimed resource settlement.

Once original ownership is settled and the shared release's remaining out-of-scope cleanup obligations are handled by their owners (or an explicitly reviewed release plan addresses them), refresh the no-new-call window, source/schema/function guards and token validity, then execute the authorized backend/relay release and pilot standby transition. Activation and physical media tests remain separate.
