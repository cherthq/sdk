# Build your own FaceTime voice agent

Workshop guide for **the latest published Chert CLI**. Start here if you are building an
agent, even if you have never used Chert or LiveKit. The starter is JavaScript;
existing TypeScript and Python LiveKit agents can use the same CLI steps.

**Your first goal:** call your assigned FaceTime address, talk to an agent you
customized, hang up, then complete a second call. Start with **FaceTime Audio**.
For a video agent, start from `examples/video-agent` and call with **FaceTime Video**.

## 1. Understand the three pieces

| Piece | Where it runs | Your responsibility |
| --- | --- | --- |
| Your agent | Your laptop for this exercise | Write its behavior and keep `npm start` running. |
| LiveKit | A hosted project | Use one project's URL/key/secret for both your agent and Chert CLI. It carries the audio. |
| Chert | CLI on your laptop; FaceTime worker on a separate Chert Mac | Run `chert dev` to connect your assigned line to your named agent. |

Your laptop does **not** become a FaceTime worker. You do not install OBS, log
FaceTime into a Chert Apple account, or deploy anything to the line Mac.
`chert dev` connects an existing agent; it does not generate, start or host your
agent code. The agent must register in LiveKit before Chert can dispatch it.

A **Chert project UUID** selects your line. A **LiveKit project** carries your
agent's media. An **agent name** selects your code inside that LiveKit project.
These are three different things.

## 2. Collect these before opening the terminal

Ask your instructor for a complete assignment:

- Your Chert account and a project with **owner or admin** access.
- The **Chert project UUID**, exactly **one line** in that project, and the actual
  FaceTime address to call. The line must use "customer decides" routing.
- Your team's time slot: one line supports one active CLI session and one call.
- A LiveKit project URL, API key and API secret, or access to create your team's
  own project. Obtain values privately from the instructor or LiveKit Cloud's
  project settings. These must be the project your agent registers with.
- For this starter, an OpenAI API key with Realtime model access and API credits.
  A ChatGPT subscription is not an API key. Ask who is paying for model/LiveKit use.
- A unique agent name, such as `team-otter-agent`. Other teams using the same
  LiveKit project must use different names.

You need macOS or Linux, Git, npm, and **Node 22.23.2 or Node 24** for this starter.
Check with `node --version`, `npm --version`, and `git --version`. If Node is missing,
use the [official Node download](https://nodejs.org/en/download) or your instructor's
setup instructions. If you already use nvm: `nvm install 22.23.2`, then
`nvm use 22.23.2`. Select that version in both terminals. Native Windows is not
supported by this CLI; ask for an instructor-provided supported environment.
A FaceTime-capable device/account is needed to place the test call.

Do not proceed with another team's line or credentials just to get past setup.

## 3. Install Chert and sign in (once)

```sh
npm install -g @trychert/facetime@beta
chert --version
chert login
chert whoami
```

The `beta` tag moves to each new release, so this installs the latest published
version; `npm view @trychert/facetime@beta version` prints the number `chert --version`
should show. Choose browser sign-in, check the displayed code,
select **your assigned Chert project**, and approve. Expect your account/project
in the confirmation. In a remote terminal use `chert login --device` and approve
on another device. You do not need to copy a browser session token for this flow.

The browser login lasts 30 days. It belongs to one Chert project. Switching
projects requires a login approved for the new project and matching saved setup;
changing `--project` alone cannot expand that credential's access.

## 4. Create your agent project (once)

Use a directory where you keep projects. The CLI ships the starter, so one command creates your agent folder:

```sh
chert new my-facetime-agent
cd my-facetime-agent
npm install
```

`chert new` copies the voice starter (add `--video` for the video starter) and writes `.env.local` with `AGENT_NAME` set from the folder name (`--agent NAME` chooses another). Open `.env.local` and put in your three LiveKit values and `OPENAI_API_KEY`; it is owner-only and never committed.

Without npm registry access, your instructor's `chert-student-workshop.zip` holds the same `examples/student-agent/` folder and these guides: unzip it and copy that folder instead.

Open `.env.local` in your editor and replace every placeholder privately:

```dotenv
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY
LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
AGENT_NAME=team-otter-agent
```

Use your own unique name everywhere this guide says `team-otter-agent`.
Keep this file private; the supplied `.gitignore` excludes it. Do not paste keys
into chat, screenshots or shell commands, and do not `source` the env file.
The agent reads it using Node's env-file parser. Chert reads only its three
LiveKit values; it does not receive the model key through that file.

Open `agent.mjs`. Change the `instructions` text to create a study partner,
interview coach, language tutor, or another voice experience. Keep replies short.
Change `greeting` too, and keep it to one short sentence.

Greet the caller within 10 seconds of `bridge_ready`, or the call ends (`remote_audio_timeout`).
The starter does this for you. It waits for a caller, creates the model session,
then greets once when `chert dev` writes `"chert_bridge_ready": true` into the
room metadata, which happens when the Mac reports `bridge_ready` (`greet.mjs`).
It never greets just because the caller joined: FaceTime may still be
connecting. Without the signal it does not greet, and the caller speaks first.

## 5. Connect Chert to your agent's folder

Still in `my-facetime-agent`, the folder that holds `.env.local`:

```sh
chert doctor
```

The CLI reads the three LiveKit values from `.env.local` (or `.env`) in this
folder and uses the Chert project approved at sign-in. No separate setup step is
needed. Shell `LIVEKIT_*` values take priority, so remove stale exports before
using another team's credentials.

If you previously ran `chert setup`, those saved defaults still take priority.
Use `chert setup --clear` to switch to folder loading. To run from elsewhere,
optionally save `chert setup --env-file /absolute/path/to/.env.local --project PROJECT_UUID`
with your assigned Chert UUID. This saves only the path and UUID and does not
activate the line. Keep credentials private and outside Git.

Expect checks for your account, project, line, online worker and LiveKit credentials
to pass. A skipped `agent` check is expected here. Stop and ask your instructor
if the line is busy, another team's session holds it, or the worker is offline.
Do not use `--takeover` as a setup shortcut. A session that is no longer connected
(a closed laptop, a crash, a stop whose release failed) is replaced without
`--takeover`: run `chert dev` and it takes the line. Use `--takeover` only for a
live holder who agrees, and only with no call in progress.

## 6. Run it in two terminals (every work session)

**Terminal A: your agent.** Open the `my-facetime-agent` directory:

```sh
npm run check
npm start
```

Leave it running. Its logs should show registration with LiveKit, without model
or authentication errors. This is your agent server, not the FaceTime Mac worker.
There is no automatic reload in this starter.

**Terminal B: Chert.** Open a second terminal, select the same Node version,
and change into that same directory:

```sh
chert doctor --agent team-otter-agent
chert dev --agent team-otter-agent --until 14:10
```

Put the end of your time slot after `--until HH:MM` (24-hour, your computer's
clock), or its length after `--minutes N`. A minute before that time Terminal B
warns you; at that time it releases the line by itself, after any call in
progress ends; a call that rings after that time is declined. The next team sees
who holds the line and until when. If `chert dev --help` does not list `--until`
and `--minutes`, your CLI is older than these flags: run the install command in
section 3 again.

`doctor --agent` creates a temporary room and dispatches a real job, so it may
incur usage depending on your agent. Plain `chert doctor` is read-only. This
starter waits for a caller before creating its model session.

Wait for **both** messages in Terminal B:

```text
✓ Connected to Chert.
✓ "team-otter-agent" is in a waiting room. Call your line (+1 317-555-0100) on FaceTime to talk to it. Ctrl+C to stop.
```

The waiting room means your named agent joined LiveKit. It does not prove your
model key, conversation or media path works. The real call is the next check.
Generic `chert dev` does not use `--muse`; that flag is specific to the prepared
Muse integration and is not a general video or warm-up switch.

## 7. Make your first call

1. Use **FaceTime Audio** to call the exact address in your instructor's assignment
   or Chert dashboard. Do not use an old contact/recent call without checking it.
2. After the call connects, the agent greets you within a few seconds. Terminal B
   prints `FaceTime is ready.` at that moment. Reply, for example: "Hello, what
   can you help me with?" If the agent does not greet, say hello and see section 9.
3. Ask a follow-up question related to your custom instructions. Confirm that you
   can hear a relevant response and the agent responds to your actual words.
4. Interrupt once to check conversation behavior. If using speakerphone, keep it
   away from microphones that could create feedback.
5. Hang up from the calling device. In Terminal B wait for `Call ended.`
6. Wait for the agent to join a new waiting room, then make a second call. The
   generic CLI automatically prepares the next room; a new call gets a new session.

If no reply arrives after about ten seconds, inspect Terminal A for provider or
model errors, end the call, and use the troubleshooting table. Repeated calls
without checking the error can consume usage without changing the result.

**Success means:** two-way conversation, caller hangup, room cleanup, and a fresh
second call. "Connected" alone is not a passing test. This starter has no avatar;
audio calls do not show an agent video.

## 8. Edit, restart, and hand the line back

To edit safely: finish the call, wait for room cleanup, then in **Terminal B** press
Ctrl+C. Wait for:

```text
Stopped. The line no longer routes to this agent.
```

Then stop Terminal A with Ctrl+C. Edit `agent.mjs`, run `npm run check`, restart
Terminal A with `npm start`, and restart Terminal B with the same slot end:
`chert dev --agent team-otter-agent --until 14:10`. A waiting room may contain
old agent code; restarting both between edits avoids that confusion.

At the end of your slot, B stops by itself if you started it with `--until`;
otherwise stop B cleanly first. Then stop A. Closing B's terminal
window releases the line like Ctrl+C; closing the laptop is not a clean
handoff. If cleanup is unfinished, keep `~/.chert`
and ask the instructor; do not delete it or force another team's session off the
line. `chert logout` revokes login but is not a substitute for stopping a running
connector. On a shared laptop, log out after the connector stops.

## 9. Troubleshooting

| Symptom | What to check or do |
| --- | --- |
| `chert: command not found` | Select the Node version used for the global install, then reinstall with the command above. `command -v chert` shows which executable runs. |
| `unsupported_runtime` | Use supported Node in both terminals. This starter uses Node 22.23.2 or 24. |
| `login_required` or expired login | Stop any running connector cleanly if possible, then `chert login`. If release fails, ask the instructor to resolve the line before another team starts. |
| Wrong project / `project_not_signed_in` | Approve browser login for the intended project and save matching setup. Check `chert whoami`; do not substitute a LiveKit project ID. |
| `project_role_insufficient` | Instructor must give the account owner/admin access; `member` is insufficient. |
| `project_requires_one_line`, `line_required` | The instructor (a Chert admin) must assign exactly one line to your project. |
| `line_not_customer_decides` | A project admin sets the line's Routing to "Your webhook" and Assistant to "Unassigned" in the console. |
| `line_paused` | A project admin presses Enable calls on the line in the console. |
| `shared_line_paused`, `shared_allocation_inactive` | Your project uses a shared line from `chert onboard`. Chert enables the pool line; an expired allocation needs `chert onboard` again. `chert onboard --status` shows where you are. |
| `line_unacknowledged`, `line_offline`, `worker_unavailable` | The Mac behind the line is not ready (offline, not accepting, or its receiving identity is unconfirmed). Wait 30 s and try again, then ask the instructor; Anish checks the Mac in Chert MAU. `chert dev --force` takes the line anyway, but calls decline until the Mac is back. |
| `line_in_use` | Wait for the time it names, or for your slot, or ask the instructor. No takeover without coordination. |
| `slot_time_passed` | The `--until` time has already passed today. Give a later time, or use `--minutes N`. |
| `line_in_call` | A call is in progress on the line. Wait for the call to end, then run `chert dev` again. |
| Missing/invalid LiveKit credentials | Verify all three values in `.env.local` belong to the same project and that setup points to that file. |
| Agent did not join / timed-out decline | Keep Terminal A running; match `AGENT_NAME` with `--agent` exactly; use the same LiveKit project in both. |
| Connected but silent, or the call ends about 10 s after `FaceTime is ready` | The agent must greet within 10 seconds of `bridge_ready` (`remote_audio_timeout`). Check that Terminal B printed `FaceTime is ready. The room now carries chert_bridge_ready`, then check Terminal A for model access/credits/errors and confirm the caller is not muted. Doctor checks membership, not a model conversation. |
| A call never ends, the line stays busy | Hang up on the phone. If it stays busy, ask the instructor: a project owner or admin ends the call in the console; the CLI cannot. |
| Old or unexpected agent answers | Check unique names and stop any other local/cloud instance using that name. Stop/restart both terminals after editing. |
| Agent replies but video is absent | The voice starter publishes no video, so the caller sees the line's default picture. Use `examples/video-agent`, call with FaceTime Video, and read the media line in Terminal B. |
| Call ends immediately / `agent_failed` | Save the time and terminal messages; ask the instructor to inspect the call record. It may be a worker/media failure, not your model. |
| Cleanup remains pending | Preserve state, stop making calls, and ask the instructor. Do not remove `~/.chert/dev`. |

When asking for help, send your Node/Chert versions, nonsecret agent name,
approximate call time, expected behavior, and relevant error lines from both
terminals. Never send `.env.local`, API keys, tokens or a complete unsanitized log.

## 10. Where to go next

- Add behavior by editing `instructions`; add tools/data after the basic two-call test.
- Already have a LiveKit agent? Register a unique name, greet once when the room
  metadata carries `"chert_bridge_ready": true` (copy `greet.mjs`, or see the
  Python pattern in the [developer guide](DEVELOPER_GUIDE.md#7-writing-an-agent-for-facetime)),
  and start at section 5 using its LiveKit credentials.
- TypeScript developers can use the [official LiveKit Node starter](https://github.com/livekit-examples/agent-starter-node)
  and retain its build tooling. Match named dispatch and greeting behavior described
  here; Chert is independent of the agent's implementation language.
- [Developer guide](DEVELOPER_GUIDE.md): lifecycle, room limits, metadata and details.
- [Command reference](COMMANDS.md): every supported flag. Try `chert dev --help`.
- [Instructor checklist](WORKSHOP_INSTRUCTOR.md): account/line assignments and qualification.
- [LiveKit named dispatch](https://docs.livekit.io/agents/server/agent-dispatch/) and
  [Realtime plugin](https://docs.livekit.io/agents/models/realtime/plugins/openai/): SDK references.

Validation on October 8: fresh standalone `npm ci`, syntax, SDK imports/help,
and TypeScript checking of the JavaScript passed on Node 22.23.2. Syntax and
imports/help also passed on Node 24.0.0. Offline mocked lifecycle checks covered
waiting before model creation, caller binding, no automatic greeting, shutdown
and a fresh second session. These checks used no live model credentials and do
not establish a successful FaceTime call. The instructor must rehearse the exact
starter on the intended line before using it as the workshop baseline.
On October 22 the starter gained its greeting on `bridge_ready`. The greeting
guard is unit tested and the starter loads with its pinned packages; it has not
yet greeted on a live FaceTime call.
