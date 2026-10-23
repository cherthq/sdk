# Historical pilot preflight — superseded by STATUS.md

The user authorized pilot activation and the proposed bounded physical tests after the completed standby repair, and confirmed they will be the caller. No additional activation permission is needed. Execution is currently blocked on a fresh owner/admin access token: the saved token expired at 14:38:19 UTC and the projects endpoint returned HTTP 401 at 20:00:43 UTC. No auth bypass or direct database mutation was attempted.

## Verified preflight

- Target remains Chert FaceTime Test, project `5ee3afd6-f248-45a5-9fe8-bf30c4c961e7`, line `59b3e3d0-945b-45da-b907-027103941a65`, worker `dedea298-97e0-4321-8c85-1deca994b2a0`.
- BYOR binding `0b758533-1c9a-4cc0-b5a5-cfcd2464b281` remained standby with a current lease and generation 14. Line assignment generation was 3, original integration unchanged, `customer_decides`, no default Assistant and no current call. These values must be re-read before activation.
- User identified the pilot as “Mac 2 FaceTime Worker” on Gary's MacBook Pro. The reachable host is `100.84.26.52`, SSH account `chert`, hostname `Garys-MacBook-Pro-3.local`. The default `garygao` login failed; the account documented in the existing Mac runbook succeeded. Remote local identity `worker_mac2` / `line_mac_002` matches this pilot. No other Mac was operated.
- Running PID 31155 uses immutable binary SHA-256 `1ee0d259cfb71fca55a8c11c3bcd8eeb2c2ecc3824bfb409473195d1882affae`, mapped by manifest to source `647b9f66ce39a5e37634b50f28f0a11dc7583558`. All 121 release files match their manifest; that source commit exists. The current checkout HEAD differs, so it was not substituted for the running artifact identity. Existing checkout changes were preserved.
- Local API listens on `127.0.0.1:8787`; authenticated health/diagnostics and idle local line checks passed. Configuration is mode 0600. Accepted configured route is Scarlett Solo playback / EarPods microphone / MacBook Pro Speakers output, `earpods_coupler_v1`.
- The current automatic audio/video profile passed accessibility, configuration, audio device, screen capture, FaceTime sign-in/selections, playback renderer, video resources and control-plane polling. System audio capture is explicitly deferred to call start. Idle per-call audio counters remain false and the legacy diagnostic boundary says `audio_route_not_verified`; these are not recorded as physical audio success. Caller-visible changing video and both audio directions remain unverified.

Evidence: [Mac preflight](mac-preflight.json), [expired-token API check](../railway-deployment/admin-token-check-20260930T200043Z.json), [standby repair](../transport-stability/FRESHNESS-RESULTS.md).

## Next execution

After a fresh token is saved in the existing local secret file, verify owner/admin membership and re-read line plus bindings. Perform the single pilot compare-and-set activation with those fresh values. Confirm active welcome and healthy runtime using the existing config/state, without re-enrollment or initialization.

Only with the caller ready, explicitly stage one audio/video slot (45-second preparation limit). Require both media publications. Ask the caller to start the first incoming call, observe both audio directions and changing agent video for roughly 70 seconds (90-second observation cap), then have the caller hang up. Verify central, application, Mac and provider cleanup within 30 seconds. Only after verified cleanup, stage the second slot for a roughly 20-second call and hang up from the opposite side. At most two staging operations/two calls; stop on failure or uncertainty. No automatic refill, altered deadlines, Mac release/configuration changes, or unrelated customer operations.

No activation, paid staging or call has occurred in this preflight. The former webhook route remains unavailable until connector activation; do not call yet.
