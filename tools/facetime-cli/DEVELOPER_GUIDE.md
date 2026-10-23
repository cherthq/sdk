# Put your agent on FaceTime: developer guide

This is the one page to read before you connect a LiveKit agent to a Chert FaceTime line with the `chert` command-line interface (CLI). It covers the generic `chert dev` flow. The one-call Muse demo mode is described in [CLI_GUIDE.md](CLI_GUIDE.md#muse-explicit-media-preparation-for-one-call).

For a complete first project, use the [student guide](STUDENT_GUIDE.md)
and JavaScript starter (`chert new my-agent` creates a voice agent folder from it, `--video` a video one).
This page is the deeper reference. Workshop organizers should complete the
[instructor checklist](WORKSHOP_INSTRUCTOR.md).

## 1. How it works

1. FaceTime has no programming interface. Chert runs Mac computers, each signed in to one Apple ID. Each Mac answers FaceTime calls to that address. That is a **line**: one Mac, one address, one call at a time.
2. Your agent runs on LiveKit, wherever you host it. It registers with a name, exactly as for any LiveKit dispatch.
3. `chert dev --agent NAME` runs on your computer and connects outward to Chert. No public URL, tunnel or webhook server. When a call rings, Chert hands the decision to your `chert dev`.
4. `chert dev` creates a LiveKit room in your project with your agent dispatched into it, waits until the agent is in the room, then tells Chert to answer and join that room. The Mac bridges the caller's voice into the room and your agent's voice back into FaceTime.
5. To answer fast, `chert dev` keeps one **warm room** ready with your agent already inside. A call is then accepted in about 0.1 s. Without a warm room, answering waits for the agent to join (measured 3.7 to 4.9 s from a distant network against LiveKit Cloud) inside Chert's ten-second window.
6. Chert never sees your LiveKit API secret. It receives a token for that one room, valid for at most two hours.
7. When you stop `chert dev`, the line stops routing to your agent. Nothing of yours keeps running on Chert's side.

## 2. Before you start

You need:

1. A LiveKit agent that registers with a name. For the pinned JavaScript starter:
   ```js
   cli.runApp(new ServerOptions({
     agent: fileURLToPath(import.meta.url),
     agentName: 'my-agent',
   }));
   ```
   The complete imports and entrypoint are in the student starter; the name must
   match `chert dev --agent my-agent`.
2. The `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` of the LiveKit project that agent uses.
3. A Chert account with the **owner or admin** role on a project that has **exactly one** FaceTime line, set to "customer decides".
4. Node 22 (22.12 or later), Node 24 or Node 26, on macOS or Linux.

## 3. Get a line

1. Ask Chert for a project with one line and the owner or admin role for your account. A project with two lines, or a `member` role, is refused.
2. The dashboard shows the line's FaceTime address, its Apple ID. `chert doctor` and `chert dev` show it masked, so take the address from the dashboard and check it belongs to the project `chert doctor` names. An old entry in your FaceTime recents may point to another project.
3. At a hackathon, lines are shared by time slot. In your slot the line is yours. Outside it, do not start `chert dev` on it.

## 4. Install and sign in

The CLI runs on Node 22.12+, 24 or 26.
The JavaScript starter still targets Node 22.23.2 or 24.

1. Install the latest published version. The `beta` tag moves to each new release:
   ```sh
   npm install -g @trychert/facetime@beta
   chert --version
   ```
2. Sign in through your browser, on macOS or Linux:
   ```sh
   chert login
   chert whoami
   ```
   The sign-in screen offers `1` sign in with browser, `2` paste a token, `3` quit. Move with the arrow keys and press enter, or press the number. With `1` your browser opens: check that it shows the code on the terminal, pick the intended project and approve. In a remote shell, use `chert login --device`: it prints an address and a code, to open and approve on another device.
3. Browser login saves a project-scoped CLI credential in a private file under `~/.chert/`. It lasts 30 days. `chert logout` revokes it; owners and admins can also revoke credentials through the control-plane API. Dashboard credential management is not yet available.
4. The pasted dashboard-token fallback lasts about one hour and also saves a private credential file. Choose `2` on the sign-in screen and paste at the hidden prompt; a script uses `chert login --with-token < token.txt`, which reads the token from the file and never from the keyboard. Stop `chert dev` before its credential expires: signing in again does not refresh an already-running process. If release fails, sign in and restart `chert dev` to reclaim and release the line. Logout does not revoke connector credentials already issued to a running process; stop it first.
4b. Make an agent folder from the starter the CLI ships, with `.env.local` ready for your keys (`AGENT_NAME` is the folder name, or `--agent NAME`):
   ```sh
   chert new my-agent            # voice; add --video for the video starter
   cd my-agent && npm install    # then put the LiveKit values and OPENAI_API_KEY in .env.local
   ```
   It refuses a folder that already has files. Any LiveKit agent that registers with a name works instead; the starter is a working one to begin from.
5. From your agent's folder, `dev` and `doctor` read the three LiveKit values from `.env.local` (or `.env`) and use the project approved at sign-in. Shell values take priority. No separate setup is needed for new users. Existing saved setup takes priority over folder loading; `chert setup --clear` removes it. To run from elsewhere, optionally save defaults:
   ```sh
   chert setup --env-file /absolute/path/to/.env --project PROJECT_UUID
   ```
   Only the three LiveKit values are read from the file, as data; nothing in it is executed. The file is never copied. Shell values override file values. `chert setup --clear` removes the defaults.

## 5. Check everything: `chert doctor`

1. Start your agent and leave it running, for example `python agent.py dev`.
2. Run the checks:
   ```sh
   export LIVEKIT_URL=wss://your-project.livekit.cloud LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
   chert doctor --agent my-agent
   ```
3. Read the lines in order. `✓` passed, `!` warning, `✗` problem with the fix on the next line, `-` skipped.

| Check | What it proves |
| --- | --- |
| `session` | You are signed in, and how long the session has left. |
| `chert` | Chert is reachable and accepted the session. |
| `project` | Which project, and that your role is owner or admin. |
| `line` | The project has one line, set to "customer decides", with no call in progress. |
| `worker` | The Mac behind the line checked in within the last minute. A warning here means calls will not be answered until it is back: tell Chert. If the warning names this computer's clock instead, its date and time are a minute or more behind Chert's: correct them and run it again. |
| `line_free` | No other `chert dev` session is connected to the line. |
| `livekit` | The three LiveKit values belong to one reachable project. |
| `agent` | Your agent joined a test room, and how long it took. Slower than 3.5 s means calls depend on the warm room. |

`--agent` dispatches a real job into a temporary room in your LiveKit project, so your agent runs briefly. Without `--agent`, `chert doctor` is read-only.

## 6. Connect: `chert dev`

1. With your agent running, connect it to the line:
   ```sh
   chert dev --agent my-agent
   ```
2. Wait for these lines:
   ```
     Connecting "my-agent" to +1 317-555-0100 (My Project)…
   ✓ Connected to Chert.
   ✓ "my-agent" is in a waiting room. Call your line (+1 317-555-0100) on FaceTime to talk to it. Ctrl+C to stop.
   ```
   The waiting room shows that your agent joined LiveKit. It does not verify the model or the media path; the first call does.
   If instead you see `! "my-agent" has not joined a waiting room`, the agent is not running or registers under another name. Calls are declined until it joins. If a running agent stops, you see `! "my-agent" left its waiting room`.
3. FaceTime the line. Each call prints its own lines:
   ```
     09:12:04  Incoming FaceTime Audio call.
   ✓ 09:12:04  Answered in 0.1 s.
   ✓ 09:12:07  FaceTime is ready. The room now carries chert_bridge_ready: your agent should greet within 10 s, or the call ends.
   ✓ 09:12:11  Audio is coming from "agent-AJ_x1y2".
     09:14:10  Call ended.
   ```
   Without a warm room: `Answered in 4.2 s (the agent joined when the call arrived).` The `FaceTime is ready` line is the moment your agent must greet (section 7). If LiveKit never takes the room update, it reads `FaceTime is ready, but LiveKit did not take the room update, so your agent was not told to greet.` With `--json` it is a `call_bridge_ready` record whose `room_signal` is `true` or `false`.
4. Stop with Ctrl+C and wait for `Stopped. The line no longer routes to this agent.` A second Ctrl+C keeps waiting. A third quits without releasing the line; avoid it. Closing the terminal window, or losing an SSH session, stops it like the first Ctrl+C. With `--until HH:MM` or `--minutes N` it stops the same way by itself at the end of your time slot (section 8).

Flags: `--project UUID` chooses between several projects; `--env-file PATH` reads the LiveKit values from a file; `--until HH:MM` or `--minutes N` ends the session at the end of your time slot; `--takeover` replaces a live session holding the line (section 8); `--no-prewarm` turns the warm room off; `--json` prints one JSON record per line instead of messages.

If you see `Stopped with N unfinished call(s)`, their state is kept under `~/.chert/dev/` for inspection. A recovery command is not available yet; the state is small and safe to leave.

If your sign-in expired during the run, Ctrl+C prints `Stopped, but your Chert session expired so the line was not released. Run chert login, then chert dev again to take it back.` This is a message, not an error: the exit status stays what the run itself produced (0 after a clean stop), and `--json` shows the record as `release_failed`. A script must read the message or the record, not the exit status, to know the line was not released. Sign in, run `chert dev` again (it takes the line back) and stop that one.

## 7. Writing an agent for FaceTime

1. **A job starts before any caller exists.** The warm room dispatches your agent as soon as `chert dev` connects, and again every time the warm room is replaced (after five minutes, or when the agent left the room, for example after a code reload). Expect jobs that end without a call.
2. **Greet the caller within 10 seconds of `bridge_ready`, or the call ends (`remote_audio_timeout`).** The Mac reports `bridge_ready` once FaceTime has answered and its media path is up, and then ends the call if your agent sends no audible audio within 10 seconds. `ctx.wait_for_participant()` only proves that the bridge joined LiveKit, before that moment, so never greet because the caller joined. `chert dev` reads each answered call from Chert every 500 ms, for up to 30 s, and when the Mac reports `bridge_ready` it sets the room's metadata (not the job's) to `{"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"}` and prints `FaceTime is ready.` Greet once on that signal: check the room metadata once when your session has started, in case the signal came first, then on every room metadata change. Without the signal, do not greet: the caller speaks first.

   Python, in your entrypoint:
   ```python
   import json

   def bridge_ready(metadata: str) -> bool:
       try:
           return json.loads(metadata or "{}").get("chert_bridge_ready") is True
       except (ValueError, AttributeError):
           return False

   await ctx.connect()
   await ctx.wait_for_participant()  # the caller: open paid sessions only now
   await session.start(room=ctx.room, agent=MyAgent())
   greeted = False

   def greet_once(*_):
       nonlocal greeted
       if greeted or not bridge_ready(ctx.room.metadata):
           return
       greeted = True
       session.generate_reply(instructions="Greet the caller in one short sentence.")

   ctx.room.on("room_metadata_changed", greet_once)
   greet_once()  # the signal may have come before the session started
   ```
   Node, with `greet.mjs` from the starters (`examples/student-agent`):
   ```js
   import { greetOnBridgeReady } from './greet.mjs';

   await session.start({ room: ctx.room, agent: new voice.Agent({ instructions }) });
   const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: 'Greet the caller in one short sentence.' }));
   ctx.addShutdownCallback(async () => stopGreeting());
   ```
   Without the helper, listen with `ctx.room.on('roomMetadataChanged', check)` and call `check()` once after `session.start`, where `check` greets once when `JSON.parse(ctx.room.metadata || '{}')?.chert_bridge_ready === true`.

   If you run your own LiveKit room instead of `chert dev` (for example with `chert byor`), nothing writes this signal. After you accept a call, poll the call API, `GET /api/v1/calls/<call id>` with your Chert credential and the `x-chert-project-id` header, every 500 ms until the call's `status` is `active` and its `facetime_call_events` include a `bridge_ready` event with `source` `worker`. Then greet once. Stop polling when the status is `ended`, `failed` or `rejected`.

   Avoid unsolicited speech and unnecessary paid work on job start. A warm job can
   exist without a caller; the student starter waits for a participant before
   opening its model session. Other agent designs may incur costs while warming.
3. **Know who is in the room.** The caller arrives as one participant named `chert-bridge-<call id>`. The Mac takes audio from the one participant that publishes an unmuted audio track, and shows video only from that same participant. Two participants publishing audio ends the call. An avatar service that joins as a third participant and publishes both the voice and the face fits this rule, and LiveKit admits it to the room; that path is not yet tested on a FaceTime call.
4. **Job metadata.** A warm room's job carries `{"chert_warm":true}`; a room created during a call carries `{"chert_call":"<call id>","media":{"audio":true,"video":<boolean>}}`, where `video` is whatever Chert reported for that call: true for a FaceTime video call, false for FaceTime Audio. A warm room's job has no `media` key. A warm room keeps its metadata when a call is answered in it, so do not rely on the call id being present. The room's own metadata is separate from the job's: `chert dev` sets it to the `bridge_ready` signal of point 2, in a warm room too, and in no room without a call.
5. **Video.** For the caller to see your agent, the call must be FaceTime Video and the participant that speaks must also publish a camera track. The video example in `examples/video-agent` does this. A few seconds into each call `chert dev` prints what the Mac is taking from the room: video and audio, audio only, or what to change. With no video from the agent, the caller sees the line's default picture.
6. **Keep turns short.** This is a phone call: short sentences, no long monologues, and a clear way to end the conversation.
7. A call lasts at most two hours, the lifetime of the room token.

## 8. Sharing a line

1. One line answers one call at a time. A second caller is neither answered nor declined while the first call is active.
1b. Before it takes the line, `chert dev` prints Chert's view of it (`line_state`): status, routing, whether calls are enabled, and when the Mac last checked in. A line that cannot take calls is refused with the reason and who fixes it; `chert doctor` shows the same.
2. One `chert dev` session holds a line at a time. Starting a second one fails with `line_in_use` and names who holds it, and until when if they set a slot, for example `ana@example.com (agent "otter-1a2b") is on this line until 14:10`. Wait until then, or ask them to stop. `chert doctor` names who holds the line too.
3. Start your slot with `chert dev --until HH:MM` (today, on your computer's clock) or `--minutes N` (1 to 240). A minute before the end it warns you. At the end it stops as Ctrl+C does and releases the line; a call in progress then is allowed to finish first, and it says so. The time is part of the session's name, so the next team sees it in `line_in_use` and `chert doctor`. Each computer reads the time on its own clock, so agree slot times in one time zone.
4. Without `--until`, hand over cleanly at the end of your slot: Ctrl+C, then wait for `Stopped. The line no longer routes to this agent.`
5. A session that is no longer connected (a closed laptop, a crash, a stop whose release failed) is replaced without `--takeover`: run `chert dev` and it takes the line. Use `--takeover` only for a live holder who agrees, and only with no call in progress. While a call is in progress `chert dev` refuses with `line_in_call`, with or without `--takeover`. To clear the line without starting a session, drain it from the dashboard. With the updated backend, a disconnected connector falls back to an enabled pinned webhook once its lease is more than ten seconds late (about fifteen seconds after the last renewal). Without a pinned webhook, the normal call decision deadline still handles the unanswered call; this does not remove the stale binding.
6. Two teams on one line at the same time cannot both answer. Agree the slots before the event.

## 9. Errors

Errors print as `What to do. (code)` and exit with a non-zero status.

| Code | Meaning | Do this |
| --- | --- | --- |
| `unsupported_runtime` | Node is not 22.12+, 24 or 26 | Install Node 22 (22.12 or later), Node 24 or Node 26 |
| `login_required` | No session, or it expired | Sign in again (section 4) |
| `invalid_token` | The pasted text is not a current session token | Copy a fresh token from the dashboard |
| `login_input_required` | The token fallback needs piped input | Use browser login, or pipe a token to `chert login --with-token` |
| `project_required` | Your account has no project, or `--project` is not yours | Ask Chert to add you |
| `project_selection_required` | You belong to several projects | Add `--project UUID` or save it with `chert setup` |
| `project_role_insufficient` | Your role is `member` | Ask a project owner for `admin` |
| `line_required` / `project_requires_one_line` | The project has no line, or more than one | A Chert admin (Gary) assigns exactly one line to the project in the Admin panel, Assignments |
| `line_not_customer_decides` | The line is routed as `auto_reject` or to a hosted assistant, so calls never reach a `chert dev` session | A project admin opens the line in the console (Workers & Lines) and sets Routing to "Your webhook" and Assistant to "Unassigned" |
| `line_paused` | Calls are paused on the line | A project admin presses Enable calls on the line in the console |
| `shared_line_paused` | The project reached a shared pool line through `chert onboard`, and Chert keeps that line paused until the pilot opens | Chert enables the pool line; nothing to press in your console. `chert onboard --status` shows the allocation |
| `shared_allocation_inactive` | The project was onboarded with `chert onboard`, and its shared allocation expired, was released or its pool line is not qualified now, so no line is listed | `chert onboard --status`; after expiry, `chert onboard` requests a new allocation |
| `line_unacknowledged` | The Mac has not acknowledged the line's settings: it must report a confirmed receiving identity and be accepting | Wait 30 s and try again; if it stays, Anish checks the Mac in Chert MAU |
| `line_offline` / `line_draining` | The line is not `available`: the Mac behind it is not accepting calls or has not confirmed the receiving identity | Anish checks the Mac in Chert MAU (`chert-mau line`) and sets the worker accepting |
| `worker_unavailable` | The Mac behind the line is disabled, offline, draining or has not checked in for a minute | Anish checks the Mac in Chert MAU; `--force` takes the line anyway, and calls decline until the Mac is back |
| `line_in_use` | Someone else's session is connected to the line; the message names them, and the end of their slot if they set one | Wait until then, or ask them to stop. Add `--takeover` only if they agree and no call is in progress |
| `line_in_call` | A call is in progress on the line. Taking the line would cut it off, so this is refused with or without `--takeover` | Wait for the call to end, then run `chert dev` again |
| `slot_time_passed` | The `--until` time has already passed today on this computer's clock | Give a later time, or a length with `--minutes N` |
| `backend_request_forbidden` | Your account may not do this on the project | You need the owner or admin role; check `chert whoami` |
| `backend_request_conflict` | The line changed while the command ran: taken by another session, in a call, or reconfigured | Run `chert doctor`, then try again |
| A call never ends, the line stays busy | The caller hung up but Chert still shows the call; the CLI's sign-in cannot end calls | Hang up on the phone. If the line stays busy, a project owner or admin ends the call in the console (or `POST /api/v1/calls/{id}/end` in a browser session) |
| `remote_audio_timeout` on the call, silence after "FaceTime is ready" | The agent sent no audio within about 10 s of `bridge_ready`, so the Mac ended the call | Greet on the `chert_bridge_ready` room signal (section 7); check the model key and credits in the agent's terminal |
| The call ends at once with `several_audio` | Two participants published audio; the Mac takes audio from exactly one | Let only the agent publish audio; mute or remove any other participant |
| `livekit_credentials_missing` / `livekit_credentials_invalid` / `livekit_url_invalid` | LiveKit values are missing, from different projects, or malformed | Set all three from one project; the URL looks like `wss://name.livekit.cloud` |
| `livekit_unreachable` / `backend_unreachable` | LiveKit or Chert could not be reached | Check the network and the addresses |
| `backend_request_rejected` | Chert refused a change | Check your role and that the line is free |
| `env_file_unreadable` / `invalid_dev_setup` | The saved defaults or env file cannot be read | Run `chert setup` again, or `chert setup --clear` |
| `transport_unavailable` | The connection to Chert failed 30 reconnects in a row. A connection that held for ten seconds starts the count again | Start `chert dev` again |

Each call gets one line: `Answered in …` once Chert has been sent the answer, or `Call declined: …` with the reason Chert was given:

| Message | Meaning |
| --- | --- |
| `the agent did not join in time` | No warm room, and the agent did not join the new room inside the window. Check the agent is running under this name. |
| `LiveKit could not create the room` | Room creation failed. Check the LiveKit project and the network. |
| `the caller hung up` | Chert ended the call before it was answered. |
| `the answer was not ready before Chert's deadline` | The agent was asked, but LiveKit or the agent took longer than Chert allows. Keep the warm room on. |
| `the connection to Chert was lost while the call rang` | The relay connection dropped before the answer was sent. `chert dev` reconnects on its own. |
| `before the agent was asked: …` | Declined by `chert dev` itself before dispatching: cleanup from an earlier call still pending, this session no longer active for the line, the connection to Chert lost, the local journal unwritable, the call arrived too late to answer, or its timing did not fit this computer's clock. The line says which. A clock more than about a quarter of a second behind Chert's declines every call: set the date and time automatically (on a Linux virtual machine or WSL, resync the clock). |

## 10. Limits

1. One call per line at a time. Until Chert has confirmed that a call ended and `chert dev` has removed its room, a new call is declined before the agent is asked (section 9). That lasts as long as those requests take, not a fixed number of seconds; no measured figure is recorded yet.
2. Chert allows ten seconds to answer. Keep the warm room on; a cold answer from a distant network takes four to five seconds of that.
3. A browser-login CLI credential lasts 30 days; a pasted dashboard session lasts about one hour. A room token, and therefore a call, lasts at most two hours.
4. Tested with audio only. Rooms hold two participants.
5. Node 22.12+, 24 or 26 on macOS or Linux. Windows is not supported.
6. Not yet available: a recovery command for unfinished call work, a simulated test call without a line, outbound calls, and printing the full address to call (take it from the dashboard).


### Incoming caller identity compatibility

Incoming frames and BYOR application calls accept optional `from` metadata:
`{type: "phone_number" | "email", value: string}` or explicit `null` when unknown.
Legacy requests omit the field. The first identity remains part of the semantic
digest and durable journal; conflicting retries cannot invoke preparation again.
Recovery callbacks receive the original snapshot. It is caller metadata, never
an authorization credential. Keep compatible readers until new-format journals
and pending calls settle before any downgrade. Release/publication is pending.
