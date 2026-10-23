# Chert CLI user guide

This guide covers the everyday `chert` commands for connecting a LiveKit agent
to a Chert FaceTime line. It is for people building or running an agent, not for
operating Chert's Mac fleet.

- Starting from zero? Use [`chert new` below](#create-an-agent) or the more
  guided [student guide](STUDENT_GUIDE.md).
- Already have an agent? Follow the [quickstart](QUICKSTART.md).
- Need every command flag? See the generated [command reference](COMMANDS.md).
- Need to understand the call lifecycle or write an agent? See the
  [developer guide](DEVELOPER_GUIDE.md).
- Integrating Chert into an application you operate? See the advanced
  [CLI and connector guide](CLI_GUIDE.md) and the
  [BYOR example](examples/byor/README.md).

## What the CLI does

The CLI runs on your development computer. It connects outward to Chert and
keeps your project's FaceTime line assigned to your session. Your LiveKit agent
is a separate process, running on your computer or wherever you host it. A Chert
Mac answers the FaceTime call and bridges its media to a LiveKit room containing
your agent. The CLI does not run your agent, deploy it, or require you to expose
a public webhook or tunnel.

The usual development session has two processes:

1. Start your agent and leave it running. It must register with a LiveKit agent
   name and use the LiveKit project whose credentials you give Chert.
2. Run `chert dev` in another terminal. It checks and claims the line, keeps an
   agent room ready, and reports each incoming call.
3. Call the line using FaceTime Audio for a voice agent, or FaceTime Video for an
   agent that publishes video. The caller's actual audio and video are only
   validated by a real call; a successful connection or waiting room is not a
   media test.
4. Press Ctrl+C in the `chert dev` terminal and wait for confirmation that the
   line no longer routes to your agent.

One line handles one call at a time. On a shared line, only one `chert dev`
session may hold it, so agree on time slots before starting.

## Choose your setup path

| Your situation | Start here |
|---|---|
| You are new to Chert and need a project and shared line | `chert onboard`; read the [onboarding guide](docs/CLI_ONBOARDING.md) first. |
| You have a Chert project and its assigned line | `chert login`, then `chert doctor` and `chert dev`. |
| You have no agent code yet | `chert new my-agent`, then fill in its private environment file. |
| You already run a LiveKit agent | Keep your agent; set its LiveKit credentials and registered name, then run `chert doctor` and `chert dev` from its folder. |
| You own an application that accepts calls and supplies its own room/session | Use the advanced [BYOR application integration](CLI_GUIDE.md#install-and-connect-an-application-callback), not the developer `chert dev` path. |

`chert onboard` is not required for an existing, assigned project. It starts the
browser-based shared onboarding flow, which can create a default project, verify
your phone, request shared access and then request one hosted demo. Its server,
pool and line-qualification requirements are independent of installing the CLI;
an installed CLI does not enable shared allocation or prove the demo works.

## Install and sign in

The CLI requires Node.js 22.12 or later in the 22.x line, 24.x or 26.x, on
macOS or Linux. Windows is not supported. The bundled student/video starters have
their own engine requirements; check the starter's `package.json` before
choosing a runtime. Runtime support alone does not establish physical FaceTime
acceptance; consult the dated [release receipts](docs/releases/).

Install the current beta and confirm which executable your shell will run:

```sh
npm install --global @trychert/facetime@beta
command -v chert
chert --version
```

The `beta` tag is the pre-release channel. Pin an exact version for a workshop,
team rollout or reproducible environment. Do not assume npm's `latest` tag means
stable; see the current [release receipt](docs/releases/0.1.0-beta.10.md).

Sign in once for the project you intend to use:

```sh
chert login
chert whoami
```

Browser sign-in approves this computer for one Chert project and lasts 30 days.
On a remote shell, use `chert login --device` and approve the displayed code in
your browser. Owners and admins can use a project; a member role is not enough
to claim a line. If you belong to several projects, select the right project at
sign-in or use the project options described in the [command reference](COMMANDS.md).

Use `chert logout` when this computer should no longer use the saved browser
credential. It revokes that credential at Chert as well as removing the local
copy. Logging out is separate from stopping a running `chert dev` session: stop
the session cleanly first.

## Create an agent

`chert new` copies a working starter shipped with the CLI into a new folder. It
does not overwrite a non-empty folder.

```sh
chert new my-agent             # voice starter
# or
chert new my-agent --video     # video starter

cd my-agent
npm install
```

Open `.env.local` and replace the `YOUR_` placeholders. The LiveKit URL, API key
and API secret must all come from the same LiveKit project. Set the model
provider key required by the starter (the included starter uses
`OPENAI_API_KEY`). The starter fills `AGENT_NAME` from the folder name; it must
match the name registered by the agent.

Keep `.env.local` private and out of Git. `chert new` creates it with owner-only
permissions and includes ignore rules, but still check your own repository
before committing. Never paste credentials into chat or put a secret directly
in a command argument.

Start the agent in terminal 1:

```sh
npm start
```

Then, from the same folder, use terminal 2 for the Chert session:

```sh
chert doctor
chert dev
```

The starter's README explains how to change its greeting and, for the video
starter, its drawn camera image. For other agent frameworks, start the agent
using its normal command; the CLI only needs a LiveKit agent that registers
under the name you provide.

## Connect an existing agent

Run `chert dev` from the agent's folder so it can read the same LiveKit settings
as the agent. Alternatively pass `--agent NAME` and `--env-file PATH` explicitly.
The agent name must exactly match its LiveKit dispatch name.

First, run the basic checks:

```sh
chert whoami
chert doctor
```

Without `--agent`, `chert doctor` checks the saved sign-in, project role, line,
worker and LiveKit credentials without dispatching an agent. To check agent
registration too, run:

```sh
chert doctor --agent my-agent
```

That option starts a real test job in a temporary room. It can start model or
provider work and incur usage; it is not a read-only check and does not prove
FaceTime audio/video quality.

Then connect:

```sh
chert dev --agent my-agent
```

Wait until the CLI says the agent is in its waiting room. This proves the agent
joined LiveKit, not that its model credentials work or that FaceTime media is
ready. The generic workflow keeps a warm room, so the agent may have a job
running before a caller arrives. Avoid greeting or opening paid model work just
because that job starts or the bridge participant joins.

When the worker reports `FaceTime is ready`, it has emitted the `bridge_ready`
signal. Greet once on that signal, within 10 seconds. A call that hears no agent
audio in that window ends with `remote_audio_timeout`. The starter examples
implement this greeting gate. Without the signal, let the caller speak first.
See [Writing an agent for FaceTime](DEVELOPER_GUIDE.md#7-writing-an-agent-for-facetime)
for Node and Python patterns.

### Audio and video

- For a voice agent, call with FaceTime Audio.
- For a video agent, call with FaceTime Video and publish video from the same
  LiveKit participant that publishes the agent's audio.
- The Mac selects one audio-publishing participant. If multiple participants
  publish audio, the call ends. Video from a different participant is not shown.
- If a video agent publishes no camera track, the caller sees the line's default
  picture. An audio-ready state is not video readiness.
- Avatar services generally join as another participant. Keep the agent's own
  audio muted when the avatar is the voice, so only one participant publishes
  audio. Check the media diagnostic on an actual call; the generic CLI does not
  certify a third-party avatar integration.

## Operate a session safely

`chert dev` claims the project's line and maintains the agent connection until
you stop it or a requested time slot ends. Use `--until HH:MM` or `--minutes N`
for a bounded session. The time is based on this computer's clock; teams sharing
a line should agree on the time zone and check that the clock is correct. The
session releases after a call in progress finishes.

To stop manually, press Ctrl+C once and wait for:

```text
Stopped. The line no longer routes to this agent.
```

Do not treat closing a laptop, killing the process, or seeing a local stop as
proof that cleanup succeeded. If the CLI reports a failed release or unfinished
call, preserve `~/.chert` and follow the message or ask the project operator for
help. There is no general command to recover unfinished call work yet. If the
sign-in expires while the session is running, sign in again, run `chert dev` to
reclaim the line, and stop that new session cleanly.

On a shared line, `--takeover` is for intentionally replacing a live holder who
agrees, and only when no call is in progress. A disconnected holder is normally
replaced without `--takeover`. `--force` bypasses line-readiness checks; it does
not repair the worker, and calls can be declined until the line is ready. These
are not routine troubleshooting switches. `--no-prewarm` avoids keeping a room
ready, but leaves less of Chert's call-decision window for the agent to join.

## Choose where settings come from

For `chert dev` and `chert doctor`, the CLI can read the three LiveKit values
from the shell, an env file, or the agent folder. The value order is:

1. A value already present in the shell wins over the same value in a file.
2. `--env-file PATH` selects a file for this run and overrides a saved file path.
3. Otherwise, `chert setup --env-file PATH --project UUID` saves defaults for
   running outside the agent folder. The CLI stores the path and project UUID,
   not the credential values.
4. Without an explicit or saved env file, the CLI looks in the current folder
   for `.env.local`, then `.env`.

An explicit `--project UUID` overrides the saved project. If the selected
project does not match the browser sign-in, sign in to the intended project.
`chert setup` does not authenticate, claim a line or activate routing;
`chert setup --clear` removes only the saved dev defaults, not sign-in or call
recovery state.

The folder files are parsed as data, not executed as shell scripts. Chert reads
the three LiveKit values and `AGENT_NAME` for `dev`/`doctor`; it does not load
`CHERT_USER_ACCESS_TOKEN`, Node options or arbitrary commands from an env file.
Use `CHERT_HOME` only when you intentionally need to relocate Chert's local
sign-in and call state from the default `~/.chert` directory.

## Shared onboarding

For a new user who needs Chert to set up a default project and request shared
access, run:

```sh
npx --yes --prefer-online @trychert/facetime@0.1.0-beta.10 onboard
```

Use the same command again to resume an interrupted onboarding attempt. On a
remote machine add `--no-browser`; with `--skip-demo`, onboarding stops after
phone verification instead of requesting the hosted demo. `chert onboard
--status` inspects saved progress, and `--cancel` stops further onboarding work.
Do not use `--restart` while a session is active; it is for a completed,
cancelled or expired session.

The CLI asks you to act in the browser and to send the displayed verification
code. It then requests one hosted FaceTime demo; provider credentials for your
own agent are not needed for that demo. A demo request being admitted is not
proof that the call connected or that media worked. After onboarding, use your
own agent's env file, then `chert doctor` and `chert dev`.

Shared access depends on the matching Chert control-plane release, pilot
configuration, available capacity and qualified lines. These are operational
prerequisites, not effects of installing or updating the CLI. Read the detailed
[onboarding recovery guide](docs/CLI_ONBOARDING.md) and the release receipt
before relying on a live shared-line demo.

## Commands and automation

| Command | Use it for |
|---|---|
| `chert onboard` | Browser setup, phone verification and a hosted demo request for shared onboarding. |
| `chert login`, `whoami`, `logout` | Sign in to, inspect or revoke this computer's Chert access. |
| `chert new <dir>` | Create the voice or `--video` starter folder. |
| `chert doctor` | Diagnose the project, line, worker and LiveKit settings. Add `--agent NAME` for a real agent test job. |
| `chert dev` | Connect a named LiveKit agent to the line for a development session. |
| `chert setup` | Save a project and env-file path as defaults when running outside the agent folder. |
| `chert guide [TOPIC]` | Read the short start, agent, video, line or fix guide in the terminal. |
| `chert context` | Print Chert's coding-agent instructions; `--write [DIR]` updates the managed block in `AGENTS.md` and maintains the `CLAUDE.md` import; `--check [DIR]` checks for drift. |

Every command has `--help`; `chert --help --all` also shows advanced commands
and flags. `--json` gives machine-readable records. For commands that stream
events, such as `dev`, expect multiple JSON records rather than one final
document. Structured errors include a `code` and an `action`; errors are written
to stderr. Use the command's exit status as well as its records:

| Exit | Meaning |
|---:|---|
| 0 | Completed successfully. |
| 1 | Internal error. |
| 2 | Invalid command, arguments or configuration. |
| 3 | Not ready, not signed in, or context missing/stale. |
| 4 | Unsafe or inconsistent local state. Preserve it and follow the error action. |
| 5 | Unsupported runtime or platform. |
| 6 | Network or server failure. |
| 130 | Cancelled with Ctrl+C. |

The lower-level connector commands shown by `--help --all` (`init`, `check`,
`byor`, `create-room`, `run`, `status`, and enrollment/operation commands) are
for application owners integrating or operating a connector directly. They are
not required to connect an agent with `chert dev`; see the
[connector guide](CLI_GUIDE.md) before using them.

## Troubleshooting

| What you see | What to check |
|---|---|
| `login_required` or expired sign-in | Run `chert login`, choose the intended project, then `chert whoami`. |
| Wrong project or `project_selection_required` | Check `chert whoami`; select the right project at sign-in or pass `--project` if your account has access. |
| Role or line refusal | `doctor` reports the line state and the party that can fix it. Project role, routing, pause state and worker readiness are not changed by the CLI. |
| `line_in_use` | Wait for the named holder or agreed time slot. Use `--takeover` only with their agreement and no call in progress. |
| `line_in_call` | Wait for the active call to end. Do not take over a line during a call. |
| Missing/invalid LiveKit credentials | From the agent folder, check that all three values are present, non-placeholder values from one LiveKit project. Check the path selected by `--env-file` or saved setup. |
| Agent is not in the waiting room | Check terminal 1 is running, the registered name matches `AGENT_NAME`/`--agent`, and the agent uses the same LiveKit project. |
| Call ends about 10 seconds after `FaceTime is ready` | The agent did not send audio in time. Greet once on the `chert_bridge_ready` room metadata signal; inspect the agent's model key, credits and logs. |
| No video | Use FaceTime Video and publish a camera track from the same participant that publishes audio. Check the CLI media diagnostic during a real call. |
| Call ends with `several_audio` | More than one participant published audio. Leave exactly one audio publisher in the room. |
| `shared_allocation_inactive` or `shared_line_paused` | These are Chert-managed shared-pool states. Run `chert onboard --status`; if the line is centrally paused or the allocation is unavailable, contact the pilot/operator rather than changing project routing. |
| Cleanup or release is uncertain | Stop retrying, preserve `~/.chert`, and follow the printed recovery action. Do not delete local state to force a new session. |

For exact failure codes, fixes and command syntax, see [COMMANDS.md](COMMANDS.md)
and `chert guide fix`. For call lifecycle and limits, see the
[developer guide](DEVELOPER_GUIDE.md). For beta publication and test boundaries,
read the dated [release receipts](docs/releases/).
