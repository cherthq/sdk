# Chert command reference

Every command of the `chert` command-line tool that a developer uses. This page is generated from the tool's own help, so it matches what `chert <command> --help` prints. To get started, read the [developer guide](DEVELOPER_GUIDE.md).

```
npm install -g @trychert/facetime@beta
chert login
chert doctor --agent my-agent
chert dev --agent my-agent
```

| Command | What it does |
|---|---|
| `chert onboard` | Set up shared access, verify your phone and try the demo |
| `chert login` | Sign this computer in to your Chert project |
| `chert new` | Create an agent folder from the starter, ready for your keys |
| `chert dev` | Put your LiveKit agent on your line until you press Ctrl+C |
| `chert doctor` | Check sign-in, LiveKit keys, the line and your agent |
| `chert guide` | A short handbook: your agent, video, sharing a line, fixes |
| `chert context` | Chert's rules for a coding agent, as an AGENTS.md block |
| `chert whoami` | Show who is signed in, and to which project |
| `chert logout` | Sign out and revoke this computer |
| `chert setup` | Save a project and an env file as defaults for dev and doctor |

Every command also takes `--json`, which prints machine-readable records instead of text, and `-h` or `--help`.

## chert onboard

Set up shared access, verify your phone and try the demo.

Signs in through your browser, asks for your name and phone, creates your default project and allocates shared access. Text the displayed code to verify your phone. Then requests one hosted FaceTime demo. Run it again to resume; provider keys are not needed for the hosted demo.

```
chert onboard [flags]
chert onboard --status
chert onboard --cancel
```

| Flag | What it does |
|---|---|
| `--no-browser` | Print the browser address for a remote shell |
| `--skip-demo` | Stop after verification without placing a demo call |
| `--status` | Read the saved onboarding status without starting work |
| `--cancel` | Cancel new onboarding work; preserve active call cleanup |
| `--restart` | Start again after an expired, cancelled or completed session |
| `--wait SECONDS` | Maximum verification wait, 0–3600 seconds (default 600) |
| `--project UUID` | Project for an explicit user-session credential |
| `--backend ORIGIN` | Another Chert address, https://HOST |

| Environment variable | What it does |
|---|---|
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |
| `CHERT_USER_ACCESS_TOKEN` | A credential to use instead of the saved sign-in, for scripts |
| `CHERT_CONTROL_ORIGIN` | Another Chert address, the same as --backend |

Examples:

```
$ chert onboard
# Sign in, verify your number, then answer the hosted demo
$ chert onboard --no-browser --json
# Get machine-readable progress and a browser address
```

## chert login

Sign this computer in to your Chert project.

Opens your browser to approve this computer for one project. It then stays signed in for 30 days. In a terminal you choose with 1, 2, 3 or the arrow keys.

```
chert login
chert login --device
chert login --with-token < token.txt
```

| Flag | What it does |
|---|---|
| `--device` | Print the address and code instead of opening a browser, for a remote shell |
| `--with-token` | Read a dashboard session token from standard input. It lasts about an hour |
| `--backend ORIGIN` | Sign in to another Chert address, https://HOST |

| Environment variable | What it does |
|---|---|
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |
| `CHERT_CONTROL_ORIGIN` | Another Chert address, the same as --backend |

Examples:

```
$ chert login
# Sign in with the browser
$ chert login --device
# On a server: open the printed address on any device
```

## chert new

Create an agent folder from the starter, ready for your keys.

Copies the voice starter (or the video starter with --video) from this package into a new folder and writes its .env.local with the agent name filled in. You add your LiveKit values and OPENAI_API_KEY, run npm install and npm start, then chert dev.

```
chert new <dir>
chert new <dir> --video
```

| Flag | What it does |
|---|---|
| `--video` | Start from the video starter: it publishes a drawn face as its camera |
| `--agent NAME` | The agent_name written to .env.local. Default: the folder name, cleaned |

Examples:

```
$ chert new my-agent
# A voice agent in my-agent/, named my-agent
$ chert new otter --video
# A video agent in otter/
```

## chert dev

Put your LiveKit agent on your line until you press Ctrl+C.

Claims your project's FaceTime line, keeps a room ready with your agent in it, and answers each call with that agent. Ctrl+C releases the line, and so does the end of a time slot set with --until or --minutes. Start your agent first.

```
chert dev [--agent NAME] [flags]
```

| Flag | What it does |
|---|---|
| `--agent NAME` | The agent_name your LiveKit agent registers with. Default: AGENT_NAME in .env.local |
| `--env-file PATH` | Read the LiveKit variables from this file |
| `--project UUID` | The project to use when you belong to several |
| `--until HH:MM` | Release the line at this time today, once no call is in progress. Teams waiting for the line see the time |
| `--minutes N` | Release the line after N minutes (1 to 240), once no call is in progress |
| `--takeover` | Replace another session that holds the line |
| `--force` | Take the line even when Chert says it cannot take calls yet (paused, offline, not acknowledged). Calls decline until it can |
| `--no-prewarm` | Create the room when a call arrives instead of keeping one ready. Chert gives about 5 s to answer, so calls can be declined; not for teams |
| `--muse` | Prepare one Muse session per run. See CLI_GUIDE.md |
| `--backend ORIGIN` | Another Chert address, https://HOST |
| `--relay-origin ORIGIN` | Another connector relay address, https://HOST |

| Environment variable | What it does |
|---|---|
| `LIVEKIT_URL` | Your LiveKit project address, wss://HOST |
| `LIVEKIT_API_KEY` | LiveKit API key, the same one your agent uses |
| `LIVEKIT_API_SECRET` | LiveKit API secret. It stays on this computer |
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |
| `CHERT_USER_ACCESS_TOKEN` | A credential to use instead of the saved sign-in, for scripts |
| `CHERT_CONTROL_ORIGIN` | Another Chert address, the same as --backend |
| `CHERT_RELAY_ORIGIN` | Another relay address, the same as --relay-origin |

Examples:

```
$ chert dev
# In your agent's folder: answer calls with the agent named in .env.local
$ chert dev --agent my-agent
# Answer calls with the agent registered as my-agent
$ chert dev --agent my-agent --env-file .env.local
# Take the LiveKit keys from a file
$ chert dev --until 14:30
# Your time slot ends at 14:30: release the line for the next team then
```

## chert doctor

Check sign-in, LiveKit keys, the line and your agent.

Runs each check chert dev depends on and says what to fix. With --agent it also sends your agent a test job and times how long it takes to join.

```
chert doctor [--agent NAME] [flags]
```

| Flag | What it does |
|---|---|
| `--agent NAME` | Also check that this agent joins a test room. This runs a real agent job |
| `--env-file PATH` | Read the LiveKit variables from this file |
| `--project UUID` | The project to check when you belong to several |
| `--backend ORIGIN` | Another Chert address, https://HOST |

| Environment variable | What it does |
|---|---|
| `LIVEKIT_URL` | Your LiveKit project address, wss://HOST |
| `LIVEKIT_API_KEY` | LiveKit API key, the same one your agent uses |
| `LIVEKIT_API_SECRET` | LiveKit API secret. It stays on this computer |
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |
| `CHERT_USER_ACCESS_TOKEN` | A credential to use instead of the saved sign-in, for scripts |
| `CHERT_CONTROL_ORIGIN` | Another Chert address, the same as --backend |

Examples:

```
$ chert doctor
# Check sign-in, the project, the line and the Mac behind it
$ chert doctor --agent my-agent
# Also check that the agent answers
```

## chert guide

A short handbook: your agent, video, sharing a line, fixes.

Explains in the terminal how Chert works and how to set up a voice or video agent. Without a topic it shows the first page and lists the others: agent, video, line, fix.

```
chert guide [TOPIC]
```

This command has no flags of its own.

Examples:

```
$ chert guide
# How it works and the setup, in one page
$ chert guide video
# Video agents and avatars
$ chert guide fix
# When something goes wrong
```

## chert context

Chert's rules for a coding agent, as an AGENTS.md block.

Prints one Markdown block for an AGENTS.md: the commands, the rules the Mac enforces, the secrets rule, the output contract and the fixes, rendered from this CLI's own help and guide so it cannot drift. Paste it into your agent folder's AGENTS.md, or let the starter from chert new carry it.

```
chert context
chert context --write [DIR]
chert context --check [DIR]
```

| Flag | What it does |
|---|---|
| `--write [DIR]` | Write or refresh the block in AGENTS.md (your text outside the marks stays) and make CLAUDE.md import it. Default: this folder |
| `--check [DIR]` | Exit 3 when the block is missing or out of date, 0 when current |

Examples:

```
$ chert context
# Print the block
$ chert context --write
# In your agent folder: AGENTS.md and CLAUDE.md up to date
$ chert context --check --json
# For a script: the state of both files
```

## chert whoami

Show who is signed in, and to which project.

Asks Chert, so it also tells you when a sign-in was revoked. Offline, it shows what is saved and says it could not confirm it.

```
chert whoami
```

This command has no flags of its own.

| Environment variable | What it does |
|---|---|
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |
| `CHERT_USER_ACCESS_TOKEN` | A credential to use instead of the saved sign-in, for scripts |

Examples:

```
$ chert whoami
# Signed in as you@example.com · project Acme (admin).
```

## chert logout

Sign out and revoke this computer.

Removes the saved sign-in and revokes it at Chert, so it cannot be used again from anywhere.

```
chert logout
```

This command has no flags of its own.

| Environment variable | What it does |
|---|---|
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |

Examples:

```
$ chert logout
# Signed out. The credential was revoked at Chert.
```

## chert setup

Save a project and an env file as defaults for dev and doctor.

Not needed when you run chert dev from your agent's folder: the keys are read from .env.local there. This saves a project and an env file for running from anywhere else. Only the path is saved, never the keys.

```
chert setup --env-file PATH --project UUID
chert setup --clear
```

| Flag | What it does |
|---|---|
| `--env-file PATH` | The file holding the three LiveKit variables |
| `--project UUID` | The project to use |
| `--clear` | Remove the saved defaults. Sign-in is not changed |

| Environment variable | What it does |
|---|---|
| `CHERT_HOME` | Where the sign-in and call state are kept (default ~/.chert) |

Examples:

```
$ chert setup --env-file .env.local --project PROJECT_UUID
# Save both
$ chert setup --clear
# Forget them
```

## Exit codes

- `0` success
- `1` internal
- `2` usage
- `3` not ready or not signed in
- `4` state
- `5` unsupported runtime
- `6` network or server
- `130` cancelled

## Advanced commands

The connector and enrollment commands (`init`, `check`, `byor`, `create-room`, `run`, `status`, `projects`, `lines`, `bindings`, `enroll`, `activate`, `drain`, `revoke`) are for operating a connector by hand. `chert dev` does all of that for you. Run `chert --help --all` to see them, and read [CLI_GUIDE.md](CLI_GUIDE.md).
