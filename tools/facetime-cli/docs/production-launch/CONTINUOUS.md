# Continuous pilot operation

The production launcher can explicitly enable automatic ready-session preparation for the current BYOR binding. This is application orchestration: the Python owner still performs all LiveKit work, verifies both audio and video, durably claims sessions, and owns expiry and cleanup. The CLI transport does not create provider resources.

The controller is disabled by default. Once explicitly enabled, its persisted switch survives restart and permits automatic preparation. Startup with no enabled policy and every health request remain nonallocating. Incoming calls only claim an already-ready session. The existing one-session limit remains; calls during preparation or another call cannot consume a second session. There is a brief preparation gap after cleanup or idle expiry.

Before staging, the controller requires healthy owner/Node IPC, complete prior connector records, clean prior owner slots, and a fresh authenticated inspection proving the exact binding is active and connected. The owner additionally rejects staging when resource receipts remain. The controller stores its new slot ID before sending the request. A timeout, process interruption or absent pending slot never causes a blind retry or a fresh replacement. Uncertainty stops refill for operator review.

After verified cleanup the controller waits at least ten seconds before preparing the replacement. An unused slot retains the existing bounded idle lifetime (270 seconds under the configured 900-second token and 600-second conversation limits), so idle availability consumes provider sessions periodically. Conversations retain the existing 600-second resource ceiling. Service-side FaceTime hangup is known to fail; callers must hang up. Resource expiry is not a proven native FaceTime disconnect.

## Controls

Run as UID/GID 10001 in the application container:

```sh
python /opt/chert-pilot/railway-20260930-r1/runtime/runtime.py continuous-on
python /opt/chert-pilot/railway-20260930-r1/runtime/runtime.py continuous-off
```

The switch is `/state/chert-pilot/continuous-policy.json`; the supervisor's durable staging intent is `/state/chert-pilot/continuous-state.json`, both private. Do not edit/remove the intent to bypass ambiguity. Disabling stops future preparation; it does not forcibly end an existing call or erase a ready slot. Existing owner expiry/cleanup remains active. A request already starting when disabled can finish under its original durable ownership.

`/healthz` exposes a sanitized `continuous` status. `ready` plus `session_readiness: available` is an observation, not a reservation or end-to-end media guarantee. `waiting_for_active_authority`, `waiting_for_runtime`, `waiting_for_cleanup`, `uncertain`, `pending_slot_unobserved`, or `operator_review_required` explain why no replacement is being prepared. Use private owner status and retained journals for diagnosis. No restart limits, crash locks or resource deadlines were relaxed.

To stop admission, disable continuous preparation first, then use the existing binding drain operation. Draining is terminal for admission and requires a fresh binding for later activation; preserve the original state and complete any owned work. Never reinitialize an existing journal.
