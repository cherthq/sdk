<!-- chert:begin context v1 (chert 0.1.0-beta.10; refresh: chert context --write) -->
# Chert: this agent answers FaceTime calls

## What this folder is
- A LiveKit agent. `chert dev` connects it to this project's Chert FaceTime line; each call joins a LiveKit room with the agent already in it (the "waiting room").
- Sign-in and project: `chert whoami --json`. A line answers one call at a time and may be shared with other teams in time slots (see Shared line).

## Commands (chert 0.1.0-beta.10)
- `chert onboard --json`: Set up shared access, verify your phone and try the demo. Give the user the browser address when they need to act, and wait; if it stops, run the same command again, and never pass `--restart` while a session is active.
- `chert login --device --json`: Sign this computer in to your Chert project. Show the user `verification_url_complete` and `user_code` from the `login_code` record and wait; never approve it yourself.
- `chert new <dir> [--video]`: Create an agent folder from the starter, ready for your keys. Then `npm install`; the user fills `.env.local`.
- `chert doctor --agent "$AGENT_NAME" --json`: Check sign-in, LiveKit keys, the line and your agent. Exit 0 means ready; each failed check says what to fix.
- `chert dev --json`: Put your LiveKit agent on your line until you press Ctrl+C. Run it in the background after `npm start`; wait for `agent_warm`; add `--minutes N` or `--until HH:MM` for a bounded run.
- Stop `chert dev` with SIGINT or SIGTERM and wait for `dev_stopped`; never SIGKILL (the line would stay held until its lease lapses).
- `chert whoami`: Show who is signed in, and to which project. `chert logout`: Sign out and revoke this computer. `chert guide [TOPIC]`: A short handbook: your agent, video, sharing a line, fixes. `chert context`: Chert's rules for a coding agent, as an AGENTS.md block.
- Never pass `--takeover` (replace another session that holds the line), `--force` (take the line even when Chert says it cannot take calls yet (paused, offline, not acknowledged)) or `--no-prewarm` unless the user asks for it by name.

## Rules the Mac enforces
- Register with a name: agentName in the Node SDK, agent_name in Python. Put the same name in AGENT_NAME in .env.local, and choose one no other team uses.
- Use the LiveKit project whose three LIVEKIT_ values are in .env.local.
- Join the room at once, then wait for the caller before opening a paid model session. chert dev keeps a room ready with your agent in it before any call.
- Greet the caller within 10 seconds of bridge_ready, or the call ends (remote_audio_timeout). At bridge_ready chert dev sets the room metadata to {"chert_bridge_ready":true,...} and prints "FaceTime is ready." Greet once on that, never because the caller joined: FaceTime may still be connecting. The examples do this in greet.mjs. Without the signal, do not greet.
- The caller joins the room as chert-bridge-<call id>.
- Publish exactly one unmuted audio track. A second participant publishing audio ends the call.
- Video: Publish a camera track from the participant that speaks. The Mac takes audio from the one participant that publishes it, and video only from that same participant.
- After changing your agent, restart both terminals: a waiting room can still hold the old code.

## Shared line
- One line answers one call at a time, and one chert dev session holds it. Agree time slots with the other teams.
- If another session holds the line, chert dev stops with line_in_use and names who holds it, and until when. chert doctor shows the same. During a call it stops with line_in_call: wait for the call to end.
- A session that is no longer connected (a closed laptop, a crash, a stop whose release failed) is replaced without --takeover: run chert dev and it takes the line. Use --takeover only for a live holder who agrees, and only with no call in progress.
- Queue behaviour, slot lengths and limits come from Chert; the CLI prints them as records (`slot_set`, `slot_ending`, `slot_over`, `line_in_use`). Do not work around a slot or a holder.

## Secrets
- `.env.local` in this folder holds `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (one LiveKit project), the model key the agent uses, and `AGENT_NAME`.
- Never read aloud, print, log, paste, commit or send these values anywhere. Ask the user to fill them in; `chert doctor` verifies them without showing them.

## Output contract
- `--json` on any command: one JSON record per line with `schema_version: 1` and `command`. Errors go to standard error as `{code, action}`; the action says what to do.
- Exit codes: 0 success, 1 internal, 2 usage, 3 not ready or not signed in, 4 state, 5 unsupported runtime, 6 network or server, 130 cancelled.
- Records to watch from `chert dev`: `line_state`, `agent_warm`, `agent_not_warm`, `slot_set`, `slot_ending`, `slot_over`, `call_incoming`, `call_accepted`, `call_bridge_ready`, `call_media`, `call_declined`, `call_ended`, `reconnecting`, `dev_reconnected`, `displaced`, `dev_stopped`, `release_failed`.

## When something fails
- `login_required`: Run chert login. A browser sign-in lasts 30 days.
- `backend_request_forbidden`: You need the owner or admin role on the project. Check chert whoami.
- `line_in_use`: Another session holds the line. Ask them to stop, or wait for your slot.
- `line_in_call`: A call is in progress on the line. Wait for the call to end, then run chert dev again.
- `line_paused`: Calls are paused on the line. A project admin presses Enable calls on the line in the console.
- `shared_line_paused`: Calls on a shared line are paused by Chert, not by your project: Chert enables the pool line when the pilot opens. Run chert onboard --status.
- `shared_allocation_inactive`: Your shared line allocation expired, was released or is not qualified now. Run chert onboard --status; after expiry, chert onboard requests a new one.
- `line_not_customer_decides`: A project admin sets Routing to "Your webhook" and Assistant to "Unassigned" on the line in the console.
- `line_unacknowledged`: The Mac has not confirmed the line yet. Wait 30 s and try again; if it stays, Anish checks the Mac in Chert MAU.
- `line_offline, worker_unavailable`: The Mac behind the line is not accepting calls. Anish checks it in Chert MAU. --force takes the line anyway; calls decline until the Mac is back.
- `YOUR_ placeholders`: Put your LiveKit values in .env.local.
- `has not joined`: Is your agent running? Does AGENT_NAME match the name it registers with, on the same LiveKit project?
- `silent call`: The Mac ends a call that hears nothing within 10 s of bridge_ready. Greet on the room signal (chert guide agent), and look in terminal 1 for model key or credit errors.
- `no video`: Call with FaceTime Video, and publish a camera track from the participant that speaks.
- `call ends at once`: Two participants publish audio. The Mac takes audio from exactly one: let only the agent speak.
- `call never ends`: Hang up on the phone. If the line stays busy, a project owner or admin ends the call in the console; the CLI cannot.
- `clock`: Calls declined over timing: set the date and time automatically.
- `anything else`: Run chert doctor. Each failed check says what to fix.
<!-- chert:end -->
