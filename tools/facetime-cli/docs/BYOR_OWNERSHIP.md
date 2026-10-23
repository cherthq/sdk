# Two modes, one Chert transport

| Boundary | BYOR application callback | Create-room adapter |
| --- | --- | --- |
| Receiver, authentication, enrollment, activation, relay | Package/shared authority | Same |
| Room/agent preparation and readiness | Application; accept explicitly asserts ready | Package adapter checks exact owned dispatch/job/nonce/participant/publication |
| Resource identity | Durable operation ID and opaque application session reference | Wrapper-generated room, marker, job, nonce and participant |
| Cleanup | Application's existing owner; explicit recovery evidence | Adapter's exact ownership inspection and verified absence |
| LiveKit management credentials/hook | Not required by wrapper | Required, specialized loopback hook |
| Duration | Explicit session expiry ≤ credential expiry and two-hour authority limit | Existing 60-second cap |
| Agent server start/restart | Never performed by package | Never performed by package |

## Callback v1

`ByorHandler` is exported as a TypeScript type from the same npm package's `/byor`
entrypoint. The explicit compiled module exports `{version:1, prepare, health?,
lifecycle?, recover?}`. There is no generated HTTP server or separate SDK.
The trusted module must have non-allocating initialization and health.

`prepare` receives an opaque operation_id, project/line/call/request IDs, original
prepare/decision deadlines, maximum_session_expires_at, requested audio/video media, an abort
signal and remaining budget. Persist operation_id before application effects.
Accept includes ready:true, non-secret session_ref, session_expires_at in epoch
milliseconds and the existing livekit_url/participant_token/remote_participant_identity
BYOR fields. Decline needs only action:decline. Local response validation checks
claims/grants/expiry; the backend independently validates/seals and reuses the
existing Mac command path. LiveKit still performs token signature authentication.

The four-second preparation timeout requests cancellation; it does not prove the
application's operation stopped. The package never calls prepare again for a
retained request. Duplicate delivery coalesces before preparation and preserves
original deadlines. Conflicting content or stale/foreign scope fails closed.
Call credentials are never stored in the wrapper journal. Matching decisions are
cached in memory only; restart reconciles central authority instead of minting
replacement credentials or repeating application preparation.

`lifecycle` receives stable event_id, transition and recovery context. Apply once
by event_id and acknowledge only after durable application processing. Delivery
can repeat after a crash, even if your side effect succeeded. The application
must deduplicate. Reconciliation may supply `reconciled_terminal` when Chert
terminal status is known before a detailed lifecycle frame is delivered; it does
not invent an ended-versus-failed reason.

`recover` receives operation_id plus the known session_ref, authoritative_terminal,
acceptance (unknown/accept/decline) and cancel_requested. It must query/cancel the
original application operation, including when a timeout prevented any session
reference from returning. It must never retry creation. Return settled:true only
when that operation cannot create another session; cleanup:clean only after the
application verifies its resources are absent/cleaned. Returning a different
session_ref from the pinned reference is rejected. A pending local prepare still
retains uncertainty even if a concurrent recovery query reports absence.

Recovery also runs routinely while an accepted call is active, and after unknown
or failed reconciliation reads. Invocation alone is not permission to clean up:
preserve the call's resources unless authoritative_terminal or cancel_requested
is true. The connector sets cancel_requested for preparation cancellation and
session expiry; expiry alone does not establish authoritative termination.
A finished preparation with a retained live room can report settled:true with
cleanup:pending. Do not report cleanup:clean for a room being kept alive or infer
a session_ref while preparation is still selecting a prewarmed room.

## Four separate facts

1. **Central decision:** an authoritative receipt determines accept/decline;
   local accept or an outgoing frame is not central acceptance.
2. **Transport lifecycle delivery:** the package durably stores the event before
   acknowledging it to Chert. This does not acknowledge application processing.
3. **Application delivery:** the callback explicitly acknowledges the stable
   event after processing it. Missing/failed delivery remains in the local outbox.
4. **Resource settlement:** application recovery explicitly reports settled and
   clean. Neither terminal status, acknowledgment, a successful HTTP response nor
   elapsed expiry supplies this proof.

A record is complete only when central terminal state, operation settlement,
application cleanup and all application acknowledgments are present. Completed
records are skipped during expiry/reconciliation. Uncertain or unfinished calls
continue to require reconciliation and block admission. Cleanup callbacks use a
separate bounded wait; they never extend the incoming decision deadline. Hung
callbacks are not started again concurrently; debt survives process shutdown.
No wrapper path calls LiveKit create, dispatch or delete in BYOR mode.

## Mode and lifetime fencing

V2 config explicitly selects mode. A v2 BYOR journal pins mode, binding scope,
handler ID and absolute module path and cannot open a v1 room journal. Keep an
immutable compatible handler release for recovery. A handoff uses fresh state
and a new binding; existing calls never transfer to a new mode or owner. Legacy
v1 config and `run` retain their original room-management behavior.

Backend enrollment pins session_mode immutably. Legacy bindings default to
create-room with unchanged wire ownership. BYOR ownership includes session_mode,
and a late insert trigger extends only its authority upper bound to two hours.
A call's bound is immutable; explicit accepted session expiry must fit it and the
validated token. The sealed Session/worker-command expiry uses that exact selected
value; the receipt carries the immutable upper bound. The incoming decision
budget is unchanged. A 600-second session is supported without a 60-second
truncation. Longer than two-hour credentials, physical video qualification and slow-avatar preparation
remain outside this implementation.

The additive mode migration wraps/delegates the installed connector runtime,
preserving the newer candidate's automatic readiness checks. It does not replace
the five shared production routing/readiness/cleanup functions. It is local SQL,
not a regenerated release payload or production migration authorization.

## Built-in Muse preparation owner

`chert dev --muse` adds the explicit `chert-muse-v1` application handler; the BYOR
wire/decision contract is unchanged. The handler owns one preparation, pins its
caller-facing room to the real call and returns settled/pending during live
reconciliation. Its separate agent protocol binds the real bridge identity and
leases speech only after authenticated worker `bridge_ready` evidence. The agent
owns the model, private render room and provider session; the CLI requires its
cleanup acknowledgment before deleting the caller room. A persisted receipt
blocks another paid preparation while cleanup is uncertain. This built-in handler
is injected by `chert dev`; it is not a general loadable recovery module and has
no automatic crash-resume command. See the [Muse guide](../CLI_GUIDE.md#muse-explicit-media-preparation-for-one-call)
for limits, shutdown, recovery limitations and two-call qualification.
