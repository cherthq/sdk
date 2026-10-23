# Application-owned ready-session example

This complete TypeScript callback example has **no HTTP receiver** and no LiveKit
management client. Copy handler.ts, sessions.ts and tsconfig.json into an ESM
application (`"type":"module"`). Install the reviewed private CLI tarball plus
TypeScript and Node types for compilation, then run `npx tsc -p tsconfig.json`.

Use `chert init --mode byor --config /absolute/config.json --state-dir
/absolute/new-state --handler-module /absolute/dist/handler.js --handler-id app-v1`.
Enroll that configuration in standby separately; neither check nor `chert byor`
activates routing. Start your application/agent with its ordinary command.

The application supplies one **already ready, call-scoped** session descriptor at
`BYOR_APPLICATION_SESSION_FILE` (owner-only 0600): session_ref, state="ready",
absolute millisecond session_expires_at, livekit_url, participant_token and
remote_participant_identity. It must have no prior operation_id. Keep real
credentials in application secret storage; never check them into source.

`sessions.ts` is a small application session owner, separate from the package's
journal. It durably claims the descriptor for one operation before returning the
credentials, records delivered event IDs and sets cancel_requested on recovery.
Your existing application must observe that request, perform its own teardown,
and mark the descriptor cleaned only after verifying its resource cleanup. The
example never invents this fact or deletes a room. Retain the claimed descriptor
for recovery; do not replace it with a new session while the operation is pending.
Unknown/missing ownership blocks cleanup rather than guessing absence.

The simple file store assumes a single application writer and no concurrent
provisioning edits. Replace it with your existing transactional session store for
multiple writers. Returning decline before a claim may require your recovery
implementation to prove that operation had no effects; this example deliberately
reports unknown rather than making that inference from a different descriptor.

The package validates the returned grants/expiry, sends the decision, reconciles
central acceptance and replays lifecycle. A returned accept asserts application
readiness, not decoded audio or FaceTime readiness. The five-second decision
budget is independent of session duration; no cold start or video support is added.
