# Connect your agent to FaceTime

**Building your first agent? Start with the [student guide](STUDENT_GUIDE.md).**
It ships a complete JavaScript starter (`chert new my-agent` creates it; `--video` for the video one),
private credential setup, two-terminal instructions and troubleshooting.
Instructors: use the [workshop checklist](WORKSHOP_INSTRUCTOR.md)
to assign accounts, lines and time slots before students begin.

This shorter page is for developers who **already have a named LiveKit agent**.
Chert connects that agent to an assigned FaceTime line. It does not create or
run your agent code. Your computer runs the CLI; a separate Chert Mac answers
FaceTime. LiveKit connects their media. No tunnel or public webhook server is needed.

## Before you start

- Chert account with **owner/admin** access to a project with exactly **one** line,
  configured for "customer decides"; get the project UUID and actual FaceTime
  address from your instructor or Chert dashboard.
- A running LiveKit agent with a unique dispatch name (example: `team-otter-agent`).
- A private `.env.local` with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
  `LIVEKIT_API_SECRET` from the same LiveKit project your agent uses.
- Model credentials/credits required by your agent, configured in its environment.
- macOS/Linux and Node 22.12+, 24 or 26. The student starter uses
  Node 22.23.2 or 24. Windows is not supported by this CLI.

## One-time setup

```sh
npm install -g @trychert/facetime@beta
chert --version
chert login
chert whoami
```

The `beta` tag moves to each new release, so this installs the latest published
version. Approve browser login for your assigned Chert project. Remote shell:
`chert login --device`. Browser login lasts 30 days; no manual token copying
is needed. Then make your agent folder from the starter shipped in the CLI, and put your keys in it:

```sh
chert new my-agent          # or: chert new my-agent --video
cd my-agent && npm install
# edit .env.local: the three LiveKit values and OPENAI_API_KEY (AGENT_NAME is already my-agent)
chert doctor
```

`chert new` refuses a folder that already has files. If you already have a LiveKit agent, skip it: from that agent's folder, where `.env.local` holds the LiveKit keys and `AGENT_NAME`, run `chert doctor`.

The CLI reads the three LiveKit values from `.env.local` (or `.env`) in the
current folder and uses the Chert project approved at sign-in. It reports the
file it used. Files are parsed as data, never executed; shell values take priority.

Existing saved setup takes priority over folder loading. To use folder loading,
run `chert setup --clear`. To run from another folder, optionally save defaults:
`chert setup --env-file /absolute/path/to/.env.local --project PROJECT_UUID`.
Use your assigned Chert UUID. Setup saves only the project and file path, not
secret values, and does not activate a line.

## Every development session

**Terminal A:** start your agent with its normal command and leave it running.
For the student starter, run `npm start` from its project directory.

**Terminal B:** select the same Node version, then:

```sh
chert doctor --agent team-otter-agent
chert dev --agent team-otter-agent --until 14:10
```

On a shared line, put the end of your time slot after `--until HH:MM` (24-hour,
your computer's clock), or its length after `--minutes N`. A minute before, it
warns you; at that time it releases the line by itself, after any call in
progress ends, and the next team sees until when you hold it.

The name must match the agent's registered name exactly. Plain `doctor` is
read-only; `doctor --agent` dispatches a real test job and can incur usage.
Wait for **Connected to Chert** and the message that your agent **is in a waiting
room**, then call your assigned line using **FaceTime Audio**.
The generic waiting-room check proves membership, not model or media readiness.

Greet the caller within 10 seconds of `bridge_ready`, or the call ends (`remote_audio_timeout`).
When the Mac reports `bridge_ready`, `chert dev` prints `FaceTime is ready.` and
sets the room metadata to `{"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"}`.
Greet once on that signal, never because the caller joined. The starters do this
with `greet.mjs`; the Python and Node patterns are in the
[developer guide](DEVELOPER_GUIDE.md#7-writing-an-agent-for-facetime). Without
the signal, do not greet: the caller speaks first.

After hanging up, wait for `Call ended.` Generic `chert dev`
automatically prepares another waiting room. Test a second call after it is ready.
To edit/restart your agent, stop Chert cleanly first, restart the agent, then run
`chert dev` again so no old warmed job answers.

To release the line, press Ctrl+C in Terminal B and wait for:

```text
Stopped. The line no longer routes to this agent.
```

Then stop Terminal A. With `--until`, Terminal B does this by itself at the end
of your slot. One line supports one active CLI session and one call at a time;
coordinate shared slots. A session that is no longer connected (a closed laptop,
a crash, a stop whose release failed) is replaced without `--takeover`: run
`chert dev` and it takes the line. Use `--takeover` only for a live holder who
agrees, and only with no call in progress. If cleanup remains pending, preserve
`~/.chert` and ask for help.

## If something fails

| Symptom | Next step |
| --- | --- |
| Wrong project or role | Check `chert whoami`; ask your instructor for the correct project and owner/admin access. |
| Missing LiveKit credentials | Check the saved path and all three LiveKit values. |
| Agent never joins | Check Terminal A, registered name, and matching LiveKit project. |
| Busy line / stale worker | Wait for your slot or ask the instructor; do not take over blindly. `line_in_use` names who holds the line and until when; `line_in_call` means a call is in progress: wait for it to end. |
| `chert dev` refuses the line (`line_paused`, `line_unacknowledged`, `line_offline`, `worker_unavailable`, `line_not_customer_decides`; on a shared line from `chert onboard`, `shared_line_paused` or `shared_allocation_inactive`) | The line cannot take calls yet; the message says who fixes it: a project admin (Enable calls, Routing "Your webhook"), or Anish for the Mac. `chert doctor` shows the same view. |
| Connected but silent, or the call ends about 10 s after `FaceTime is ready` | The agent did not speak within 10 seconds of `bridge_ready`. Greet on the `chert_bridge_ready` room signal; check the agent's model credentials, credits and errors. |
| Video missing | Call with FaceTime Video. The agent that speaks must also publish a camera track (`examples/video-agent` does). The media line `chert dev` prints a few seconds into the call says what the Mac takes. |

Use `chert guide` (topics: agent, video, line, fix), `chert --help`, `chert dev --help`, the [student guide](STUDENT_GUIDE.md),
[developer guide](DEVELOPER_GUIDE.md), or [command reference](COMMANDS.md).

## Existing Muse integration

`--muse` is only for the prepared Muse agent integration. It is not required for
student agents or generic prewarming. Its one-call limits, paid preparation and
cleanup process differ from the generic workflow above. Follow the
[Muse guide](CLI_GUIDE.md#muse-explicit-media-preparation-for-one-call).
The October 8 missing-video report remains unresolved; do not treat it as a
qualified workshop video path.
