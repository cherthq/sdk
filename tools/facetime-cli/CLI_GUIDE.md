# Private Chert CLI guide

The npm package provides developer commands and two explicit connector modes.
CLI release: [`@trychert/facetime@0.1.0-beta.10`](https://www.npmjs.com/package/@trychert/facetime/v/0.1.0-beta.10) (npm tag `beta`).
Node 26 support starts with beta.4. The student starter still targets Node
22.23.2 or 24; real FaceTime calls under Node 26 remain unverified.
See the release evidence below for registry verification and rehearsal status. The primary workflow starts with
an application/agent and **no receiver**. The package is currently named
`@trychert/facetime`.
Use Node **22 (22.12 or later), 24 or 26**, POSIX and durable owner-only local storage.
Windows, network filesystems and multiple writers are unqualified. Docker and a
separate SDK are not required. Nothing here authorizes live enrollment or deployment.

## Quick start: put a LiveKit agent on FaceTime

For a LiveKit agent that registers with an `agent_name`. No receiver, tunnel, config file or handler code.

```sh
chert login                              # opens your browser; --device prints a code for a remote machine
export LIVEKIT_URL=wss://PROJECT.livekit.cloud LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
chert dev --agent AGENT_NAME
```

0. Optional: `chert doctor --agent AGENT_NAME` checks login, role, line, LiveKit and agent registration. With `--agent` it briefly creates a test room and dispatches a real job; agent startup can incur usage. It does not verify Muse media readiness.
1. Start your agent as usual (for example `python agent.py dev`).
2. `chert dev` claims your project's line and reports connection and agent membership separately.
3. FaceTime the line. It uses the waiting room, or dispatches a new room if necessary, then answers after agent membership is confirmed.
4. Ctrl+C, or closing the terminal, releases the line.

- The LiveKit key and secret stay on this machine. Chert receives a token for that one room, valid for at most two hours.
- Your project needs the owner or admin role and exactly one line set to "customer decides".
- A line already connected to another session is refused; `--takeover` replaces it. The replaced session is not restored on exit.
- `--project UUID` chooses between several projects. `chert whoami` and `chert logout` manage the stored session (`~/.chert`, owner-only).
- `chert dev` keeps one warm room with the agent already inside, so a call is answered in about 0.1 s. This means **one job of your agent is running before any caller exists**: write the entrypoint so it does not speak when the job starts or when a participant joins (the bridge joins before FaceTime has finished answering; see [Writing an agent for FaceTime](DEVELOPER_GUIDE.md#7-writing-an-agent-for-facetime)), and expect idle time on whatever the entrypoint opens.
- Greet the caller within 10 seconds of `bridge_ready`, or the call ends (`remote_audio_timeout`). For each answered call `chert dev` reads the call from Chert every 500 ms, for up to 30 s, and on the worker's `bridge_ready` sets the room metadata to `{"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"}` and prints `FaceTime is ready.` (with `--json`, a `call_bridge_ready` record). Greet once on that signal. Without it, do not greet: the caller speaks first. Without `chert dev`, poll `GET /api/v1/calls/<call id>` for the worker's `bridge_ready` event and greet once. The warm room is checked every few seconds and replaced if the agent left (for example after a code reload) or after five minutes.
- `--no-prewarm` turns this off; a call then waits for the agent to join (measured 3.7 to 4.9 s from a distant network against LiveKit Cloud), which leaves less time within the deadline supplied by Chert.
- Job metadata is `{"chert_warm":true}` for a warm room and `{"chert_call":ID,"media":{…}}` for a room created during a call. Do not rely on the call ID being present.
- If no warm room is ready and the agent does not join inside the decision window, the call is declined and the room removed. At startup `chert dev` says once whether the agent joined a test room.
- If another session takes the line over, `chert dev` says so and stops. Ctrl+C releases the line; a second Ctrl+C waits; a third quits without releasing.
- A browser sign-in lasts 30 days. A pasted token is the `access_token` of your signed-in Chert dashboard session and lasts about an hour. Generic calls keep working after the sign-in expires, but the line is then not released on exit. A running `chert dev` keeps the sign-in it started with, so a later `chert login` does not help it: stop it before the sign-in expires, or afterwards sign in, run `chert dev` again and stop that one. Muse requires a current token throughout the call.
- On a clean stop the connector credentials and state under `~/.chert/dev/` are deleted. They are kept only when a call was left unfinished.
- `chert logout` revokes a browser sign-in at Chert and removes it from this computer. A pasted session token cannot be revoked from the command line: it is only removed, and runs out within the hour.
- Not yet covered: recovery of unfinished call work after a crash (state is kept under `~/.chert/dev/`).

## Muse: explicit media preparation for one call

This source revision adds an opt-in integration with the updated `demo-agent-0`
worker deployed with **`AGENT_PROFILE=muse`**. The `0.1.0-beta.1` release includes
the cleanup, media preparation and saved demo setup changes. Generic `chert dev`
continues to support other named agents and proves membership only.

```sh
chert dev --agent demo-agent-0 --muse
```

This command claims/activates the line and starts **one paid preparation**. Use it
only when ready to rehearse on the intended line; `--project UUID` selects the
project. It cannot be combined with `--no-prewarm`. Neither `--muse` nor local
profile settings reconfigure the hosted worker. Classic workers reject this mode.
Do not run a second worker under the same dispatch name.

| Diagnostic | What it establishes |
| --- | --- |
| Connected to Chert | Connector transport is connected; media may still be warming. |
| Warming Muse | One model/avatar preparation is starting; OpenAI, LiveKit and LemonSlice usage can begin now. |
| Muse media ready | The agent reports model audio prepared and returned avatar audio/video, and the CLI observes fresh advancing frame counters plus unmuted microphone/camera publications. Silence is published while waiting. |
| Prepared media bound | The actual call and bridge identity are attached; acceptance has been requested, not yet proven. |
| Call declined: Muse media was not confirmed ready | Muse was asked about this call and turned it away: media was still preparing, already used by a call, its heartbeat or tracks had gone stale, or LiveKit could not be read. A decline that says `before the agent was asked` was made on Muse's last health report, without asking it. |
| Call connected | Authenticated Chert call detail reports this same active call with a worker `bridge_ready` event. The agent may greet only the matching bridge participant. |
| Muse cleanup verified | Agent acknowledgment confirms preparation settled, model/provider/private-room cleanup; the CLI has then deleted the caller room. |

No fabricated caller identity or `chert-byor` dispatch is used. The new
`chert-muse-v1` metadata selects preparation without caller input. After a real
incoming call consumes the single slot, its bridge identity and bounded expiry
are supplied through room metadata. Muse installs muted, unassigned RoomIO before model startup, then binds that
existing input to the real participant. This avoids the LiveKit Agents 1.8.0
late-input attachment bug; automatic selection of other participants is disabled. Internal model readiness speech is discarded. Agent join,
call acceptance and connector `started` are insufficient to permit greeting.

The CLI reads the existing authenticated `GET /api/v1/calls/:id` endpoint with
the signed-in user's token and project scope. It checks call/project/line IDs,
active status, and a **worker** `bridge_ready` event. The current inbound Mac
worker already emits that event after its FaceTime media path is structurally
ready. `agent_connected` is later audio evidence and is not used to gate greeting.
No receiver, control-plane, relay or Mac change is required for this signal.

Limits (measured from preparation start unless stated otherwise):

- Preparation: 25 seconds. Caller arrival: 120 seconds. Entire session: at most
  600 seconds, including preparation/waiting, and never beyond the call's bound.
- Waiting metadata lease: 12 seconds, renewed about every two seconds. After
  acceptance, only successful authoritative call reads renew speech permission.
  Call reads are attempted at most once per second. Fresh login is required
  throughout the session; failed reads cannot enable or renew speech.
- A bound call gets at most 60 seconds to establish bridge readiness. The agent
  stops on its lease deadline, terminal state, bridge departure or media failure.
- No automatic refill, paid retry or next-call allocation. After cleanup, Ctrl+C
  releases the line; run the command again to deliberately prepare another call.

Routine nonterminal reconciliation preserves the active room and reports cleanup
pending. Uncertain acceptance or failed reads do not authorize deletion; speech
permission instead expires at its independent lease. Authoritative termination,
applicable cancellation, expiry or explicit shutdown requests cleanup. Cleanup
first asks the agent to close its model, provider session and private render room.
Only after a matching clean acknowledgment does the CLI delete the caller room.
Late preparation must settle; failed provider termination/deletion is retried.

A nonsecret `muse-session.json` ownership receipt is persisted under
`~/.chert/dev/<binding>/` before dispatch. Unverified cleanup retains this receipt,
connector credentials and journal, returns an error on shutdown, and blocks a new
Muse run. Absence of an agent or room is not provider cleanup proof. There is no
automatic crash-resume command in this revision: after a killed CLI/worker, lost
provider-create response or outage, an operator must verify the recorded caller
room, its `muse_parent_room` private room, provider termination and original call
journal before resolving the retained state. **Do not delete the receipt merely
to bypass the block.** Leases bound local operation, but cannot prove remote
termination during an outage or establish a provider billing cutoff.

### Install, sign in and start a demo

The hosted Muse worker is already deployed as version `oxDdjM5jYBx9` (October 6,
2026). Installing the CLI does not deploy or change that worker. Use Node 22
(22.12 or later), Node 24 or Node 26 for beta.10. Perform installation and setup privately before the
demo; install the exact registry version:

```sh
nvm use 22.23.2
npm install -g @trychert/facetime@0.1.0-beta.10 --registry=https://registry.npmjs.org
chert --version                    # 0.1.0-beta.10
chert dev --help --all             # lists --env-file and --muse
chert setup --env-file /Users/garygao/demo-agent-0/.env.local \
  --project 5ee3afd6-f248-45a5-9fe8-bf30c4c961e7
chert whoami
```

This explicitly selects **Chert FaceTime Test**, the requested demo project. Setup performs local validation only:
it does not sign in, verify project access, claim a line, or start paid preparation.
It saves only the project UUID and absolute env-file path in owner-only
`~/.chert/dev-defaults.json` (`CHERT_HOME` overrides that directory). Your existing
`.env.local` stays in place; no credentials are copied into the defaults file.

`dev` and `doctor` parse only `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` from that file. Shell values take precedence. Quoted values
and spaces are supported; shell commands and variable references are **not**
executed or expanded. Chert auth, endpoint overrides and Node options in the file
are ignored. Keep the file private and outside Git.

Starting with **0.1.0-beta.3**, with no `--env-file` and no saved setup, `dev` and `doctor` read the same three
values from `.env.local`, then `.env`, in the folder they are run from, and say
which file they used. They use the first file that fills a missing LiveKit value;
they do not combine both files. From an agent's own folder no setup step is needed
with this release. Shell values still take priority; `chert setup --clear` removes
saved defaults if you want folder loading.

Explicit `--env-file PATH` and `--project UUID` override the corresponding saved
values for one invocation. Re-run setup to change defaults, or use
`chert setup --clear` to remove them without changing login or retained call state.
Project membership, role, line selection and ownership are checked on each run.
Low-level connector commands do not use these developer defaults.

If not signed in, run `chert login` (a bare `chert` shows the same screen the
first time). The screen offers three choices: `1` sign in with the browser, `2`
paste a token, `3` quit. Move with the arrow keys and press enter, or press the
number. With `1` your browser opens the approval page; the terminal shows the
code spaced out with a countdown, `esc` cancels and `c` copies the address. You
check that the browser shows the same code, pick the project and approve. This
computer is then signed in to that one project for 30 days, and `chert dev`
uses that project without `--project`. On a remote or headless machine the
same screen offers a code to approve from any device; `chert login --device`
prints it without the screen. `chert logout` revokes the credential at Chert.
Approving needs the owner or admin role on the project. Signing in again
revokes the credential it replaces; if Chert cannot be reached for that, the
sign-in still succeeds and says on which day the earlier credential stops
working (`previous_revoked` is `false` in the `--json` record).

`chert login --backend https://HOST` (or `CHERT_CONTROL_ORIGIN`) signs in at
another Chert server. A Chert server puts the approval page on its own address,
the one that was asked; an answer that points anywhere else is refused with
`login_origin_mismatch` before a code is shown or a browser is opened.

If the server does not offer browser sign-in yet, the sign-in screen comes back
with a note saying so: choose `2` and paste a session token at the hidden
prompt. Outside a terminal, and with `--json` or `--device`, the command ends
with `login_unsupported` instead; pipe the token in with `--with-token` as below. Open the Chert
dashboard and sign in. In Chrome DevTools, open
Network and refresh; select `/api/v1/projects`, then find the Authorization
request header. Copy only its token after `Bearer `, without quotes. On macOS:

```sh
(umask 077; pbpaste > ~/token.txt)
chert login --with-token < ~/token.txt
chert whoami
rm ~/token.txt                    # after successful login
```

Keep tokens out of chat, shell command arguments and Git. A session token lasts
about one hour. A project API key is not this user session token.

If copying terminal commands keeps replacing the token on your clipboard, run
this zsh command **first**, then copy the dashboard token and paste it at the
hidden prompt. The token is piped directly to login and is not written to a file:

```zsh
read -rs "chert_token?Paste token (hidden): "; printf '\n'; printf '%s' "$chert_token" | chert login --with-token; unset chert_token
```


Before the demo, refresh your Chert login and run `chert doctor` without
`--agent` for read-only connectivity/role/line checks. This checks the saved Chert FaceTime Test
project and LiveKit credentials but does not prove Muse media readiness. Do not
use `doctor --agent demo-agent-0` as a Muse readiness test: it dispatches a real job.

Confirm that the number you will FaceTime belongs to the project shown by
`chert doctor`. An old FaceTime recent-call entry may point to another project.

Onstage, from any directory, type:

```sh
chert dev --agent demo-agent-0 --muse
```

This claims the saved Chert FaceTime Test line and begins one paid preparation. No alias, wrapper,
local agent server or repo checkout is needed at runtime (the saved env file must
remain available). Do not add `--takeover` unless intentionally replacing the
current line owner. Wait for **Connected to Chert** and **Muse media ready** before
calling; call within 120 seconds of preparation start.

Without saved defaults, the explicit equivalent is:

```sh
chert dev --agent demo-agent-0 --muse \
  --env-file /Users/garygao/demo-agent-0/.env.local \
  --project 5ee3afd6-f248-45a5-9fe8-bf30c4c961e7
```

On hangup, **Muse cleanup verified** confirms owned-resource cleanup. The command
stays open without preparing another session. Press Ctrl+C and wait for **Stopped.
The line no longer routes to this agent.** Run the same command again for another
call. `cleanup_pending` or `muse_cleanup_pending` requires resolving retained
state; do not erase it to force another start.

### Beta release and supervised rehearsal evidence

Beta.5 adds PR #21: clearer session screens and errors, the built-in `chert guide`,
agent-name discovery, shared-line ownership and call-media diagnostics. See the
[beta.6 release receipt](docs/releases/0.1.0-beta.6.md); beta.10 is this branch (PR 29, PR 30 and the reconnect and context work of PR 31).

Beta.4 adds PR #20's Node 26 runtime support. See the
[beta.4 release receipt](docs/releases/0.1.0-beta.4.md)
for publication and independent registry checks. No new live FaceTime rehearsal
is implied. Earlier release evidence below is historical.

The `0.1.0-beta.3` release adds PR #19: `dev` and `doctor` automatically load
LiveKit keys from the agent folder. See the
[beta.3 release receipt](docs/releases/0.1.0-beta.3.md)
for publication and registry verification status. Real FaceTime rehearsal of
beta.3 remains pending; earlier call evidence does not qualify this release.

The following beta.2 evidence is historical.

The October 8 `0.1.0-beta.2` release includes CLI PRs #10, #13 and #14,
including their child PRs #9, #11, #12 and #15–#18, plus browser login already
merged in #8. Improvements cover warm-room cleanup, diagnostics, sign-in,
startup speed, help and documentation. Earlier October 7 text called beta.2
published prematurely; registry inspection on October 8 found only beta.1.

At beta.2 publication, `beta` pointed to beta.2 and `latest` remained on beta.1.
The exact registry package passed command/setup/Muse-gate checks on Node
22.12.0, 22.23.2 and 24.0.0, plus two simulated connector call lifecycles.
Full-suite results: 589 passed and four skipped on both Node 22.23.2 and 24.0.0;
lint and typecheck passed. Publication and registry-install details are in the
[release receipt](docs/releases/0.1.0-beta.2.md).
Two supervised Chert FaceTime Test calls on this exact release remain pending.
The October 6 beta.1 evidence below is historical.

Published October 6, 2026 from CLI commit `872b5cc` as
[`@trychert/facetime@0.1.0-beta.1`](https://www.npmjs.com/package/@trychert/facetime/v/0.1.0-beta.1),
using `npm publish --tag beta --access public --registry=https://registry.npmjs.org`.
Registry tarball SHA-1: `3105262e7560bc273f27a892f3a0bbe6ee7e5cf4`.

**Tag exception:** there were no existing registry versions or tags. npm created
both `beta` and `latest` for this first publication, despite the explicit beta tag.
An authenticated `npm dist-tag rm @trychert/facetime latest` was rejected with
HTTP 400. At that first publication, both tags pointed to `0.1.0-beta.1`; the requested unchanged
`latest` state was not achieved. This first-publication behavior is also reported
in [npm/cli #8490](https://github.com/npm/cli/issues/8490). Pin the exact version
for the demo; the `latest` tag does not establish stable-release qualification.

Release checks on Node 22.23.2: 459 tests passed, four skipped; lint, typecheck and
`git diff --check` passed. All 37 developer-command/setup tests also passed on
Node 22.12.0 and 24.0.0.

The exact registry version was installed in a fresh temporary directory outside
the source checkout, with no source symlink. Its lockfile resolved to
`https://registry.npmjs.org/@trychert/facetime/-/facetime-0.1.0-beta.1.tgz`, and its
integrity matched registry metadata. The actual installed `chert` executable
passed version/help, saved setup, and Muse authentication-gate checks on
Node **22.12.0, 22.23.2 and 24.0.0**. Its Muse handler was present and importable.
Node 20.19.6 was rejected before creating state. This was a registry install,
separate from the suite's local tarball lifecycle test.

The registry beta was also installed globally under Node 22.23.2, and private
setup saved the Dev project and existing env-file path. The running Muse worker
was checked as Running at `oxDdjM5jYBx9`; no redeploy was needed. Read-only
preflight confirmed LiveKit authentication. Chert login needed refreshing; an
invalid replacement token was rejected locally. No line was activated by
those release/setup checks.

The earlier corrected-worker conversation, cleanup and line release were reported
on October 6. Two fresh supervised **Dev-project** calls using the registry beta
remain pending. A later authenticated preflight passed for the Dev project.
The user started three preparations there, reached media ready and stopped each
with verified cleanup and line release. Two rejected calls at 14:13 and 14:14 PDT
on October 6 reached the **previous Chert FaceTime Test line**, not the saved Dev
line; their worker reason was `webhook_timeout_declined`. These do not demonstrate
a Muse decline or a successful Dev-project conversation. Check the line shown by
`chert doctor` and `Connecting to Chert` before calling; the saved project can differ
from the project used by an older explicit `--project` command. For each, record media readiness, two-way conversation and
interruption, remote hangup, verified cleanup and clean Ctrl+C release. Start the
second session only after the first releases the line, and verify new preparation
and room IDs. Automated tests alone do not establish demo readiness.

### Update Macs that run the CLI

This release updates `chert`; it does not update the FaceTime Mac worker,
OBS, audio routing, or the hosted Muse agent. Macs that only run the native
FaceTime worker need no installation or restart for this release. Installing
npm does not activate a project or change line routing.

Update one CLI host at a time, under the same macOS account and Node installation
that normally runs it:

1. Record `chert --version` and `command -v chert`. Finish any call, wait for
   verified cleanup, press Ctrl+C, and wait for confirmed line release.
   If cleanup remains pending, resolve it before proceeding; preserve `~/.chert`.
2. Select Node 22 (22.12 or later), 24 or 26 for beta.10 and install the exact registry package:
   `npm install -g @trychert/facetime@0.1.0-beta.10 --registry=https://registry.npmjs.org`.
   Check `chert --version` and `chert dev --help`. With nvm, global packages
   belong to the selected Node version; verify the shell resolves the new binary.
3. Run `chert whoami`. If needed, use `chert login` and approve that Mac's intended
   project (or `chert login --device` on a headless host). Keep each Mac's own
   credentials and env file. Do not copy Gary's project defaults to every Mac.
4. Preserve correct existing setup. To change it deliberately, use
   `chert setup --env-file /absolute/path/to/that/macs.env --project PROJECT_UUID`.
   Run `chert doctor` without `--agent` and verify the intended project and line.
   Do not use `--takeover` for a routine upgrade.
5. On the first CLI host, run two fresh authorized Muse sessions using the
   short command above. For each, verify readiness, two-way conversation,
   caller hangup, cleanup and line release. Repeat on each additional host's
   intended line before marking that host verified. One active CLI owns a line;
   do not point several hosts at the same line simultaneously.

No macOS reboot, native worker restart or Muse redeployment is needed. Relaunch
the CLI after upgrading. Record host, Node/CLI versions, intended project/line
and call outcomes; an npm install alone is not fleet acceptance. If a regression
occurs, release the line cleanly and reinstall the recorded previous exact npm
version, preserving credentials and recovery state. Pause further rollout until
it is understood.

### Rebuild or redeploy the worker

Use these steps when intentionally updating the reviewed worker source. The
caller-audio correction is already deployed and requires no CLI reinstall:

```sh
cd /Users/garygao/chert-facetime-cli
nvm use 22
npm ci
npm run build
# Run the reviewed CLI directly (no npm publication/install required):
node dist/src/cli/main.js --help

cd /Users/garygao/demo-agent-0
nvm use 22
npm ci
npm run check
# Existing .env.local must contain LiveKit/OpenAI and LemonSlice credentials.
# Upload this reviewed worker revision to the existing LiveKit deployment:
AGENT_PROFILE=muse npm run deploy
npm run lk -- agent status
```

Restart/redeploy the **Node LiveKit worker** with the reviewed source and Muse
profile. No Railway receiver deployment or Mac installation/restart is required.
If a packaged CLI is preferred, use `npm pack --pack-destination /absolute/artifacts`
in the CLI checkout and install the resulting reviewed tarball with
`npm install -g /absolute/artifacts/trychert-facetime-0.1.0-beta.0.tgz`.
Do not publish to npm as part of rehearsal.

### Supervised two-call rehearsal

After deployment review and separate permission to use the intended line:

1. Sign in using the reviewed CLI, export that worker's LiveKit credentials, then
   run `node /Users/garygao/chert-facetime-cli/dist/src/cli/main.js dev --agent demo-agent-0 --muse --project PROJECT_UUID`.
2. Wait for both connected and **Muse media ready**, then place the first FaceTime
   call within the waiting limit. Verify moving video, one greeting only after
   FaceTime readiness, two-way audio/conversation and interruption. Observe the
   call-connected diagnostic; it is not proof of decoded media on the phone.
3. Hang up. Wait for **Muse cleanup verified**; confirm caller/private rooms and
   the provider session are gone. Ctrl+C and verify clean release. If cleanup is
   uncertain, stop rehearsal and retain state.
4. Run the same command again. Verify fresh room/preparation IDs and complete a
   second call, greeting, conversation, hangup and cleanup. Stop/release again.

Offline tests cover pre-caller preparation, gating, cancellation during warm-up,
active-call preservation, cleanup failure/retry and the next explicit call. They
use mocks/local fixtures, not paid providers or real FaceTime. Live model/avatar
startup time and media quality must still be judged on actual calls.

### Observed result — October 6, 2026

The first supervised call delivered Muse video and greeting, but conversation
failed due to late audio-input attachment in the Node worker. Hangup and cleanup
were confirmed by the backend and CLI. Worker version `oxDdjM5jYBx9` corrected
that input path. The user then reported the retry worked perfectly and supplied
logs showing media ready, bridge ready, verified cleanup and clean Ctrl+C release.
This establishes one user-confirmed successful conversation on the corrected
worker, not two successful consecutive calls or formal latency/interruption
qualification. Run the second-call step above before relying on repeatability.

Node 22.23.2 checks: CLI 442 passed/four skipped, lint and typecheck passed; worker
108 passed, including real SDK/native-audio input regressions. No Mac worker,
receiver, control-plane or relay update was needed. Git push is separate from
npm publication; the locally installed beta package remains the tested CLI.

## Install and connect an application callback

Install a reviewed local tarball in your application. From the source checkout,
`npm run build` then `npm pack --pack-destination /absolute/artifacts` creates it.
The package contains compiled runtime JavaScript, TypeScript declarations and the
small example; test fixtures, historical evidence and local state are excluded.

```sh
npm install --save-exact /absolute/artifacts/trychert-facetime-VERSION.tgz
npx --no-install chert --help
npx --no-install chert init --non-interactive --mode byor \
  --config /absolute/app/chert.json --state-dir /absolute/app/chert-state
```

With no mode or old adapter flags, init defaults to BYOR. It creates a new v2 config
and `chert-handler.ts` beside it, refusing to overwrite either. The config names
`chert-handler.js` at that same location. Supply `--handler-module /absolute/app/dist/handler.js`
and `--handler-id application-v1` to select your own compiled trusted module instead.
Only that explicit module is imported. No project discovery or arbitrary scripts run.

Connect the generated callback to your **existing application session logic**:

- `prepare(call, {signal, remaining_ms})` supplies decline, or accept with
  `ready:true`, opaque non-secret `session_ref`, absolute `session_expires_at` in
  milliseconds, `livekit_url`, `participant_token` and `remote_participant_identity`.
  Persist the provided `operation_id` in the application before any session effect.
- `lifecycle(call, event, context)` handles stable event IDs idempotently and returns
  `{acknowledged:true}` only after durable application processing.
- `recover(call, context)` looks up/cancels the **original** operation and returns
  explicit operation settlement and `cleanup:clean|pending|unknown`. A successful
  callback/HTTP request, terminal event or acknowledgment is not cleanup proof.
- Optional `health()` is strictly non-allocating and returns available/unavailable/
  unknown. Missing or failed health is unknown, never displayed as ready. Known
  unavailable health declines; unknown permits bounded per-call preparation, whose
  accept must explicitly assert readiness.

Export a default `ByorHandler` from the same package's `.../byor` type export.
Use your application's existing TypeScript build. For the standalone scaffold:

```sh
# Development tooling only; use the application's pinned versions if present.
npm install --save-dev --save-exact typescript@6.0.2 @types/node@24.13.6
npx tsc --module NodeNext --target ES2023 --skipLibCheck /absolute/app/chert-handler.ts
npx --no-install chert check --config /absolute/app/chert.json --json
```

The generated scaffold intentionally declines and reports unimplemented lifecycle/
recovery rather than inventing readiness or cleanup. Fill it in before activation.
[The complete example](examples/byor/README.md) supplies a simple application-owned
ready-session store. It requires no HTTP receiver and performs no LiveKit management.
Replace its single-writer file store with your own transactional session owner.

A trusted module is ordinary application code with this process's permissions.
Module initialization and health must not allocate or start paid sessions; the
wrapper cannot sandbox arbitrary customer code. Neither CLI mode starts/restarts
an agent server. Start that separately using its normal procedure. BYOR itself
never creates/deletes rooms or sends LiveKit dispatch, including during recovery.
Application callbacks may perform their own operations under application ownership.

## Shared enrollment and explicit activation

Initialization, install, check, startup and reconnect do not activate routing.
Existing owner/admin Supabase user access-token enrollment is an internal-pilot
limitation: `chert login` signs in with the browser or a device code, but these
connector commands do not read that sign-in yet. Inject
`CHERT_USER_ACCESS_TOKEN` securely in the management shell, never in arguments.

```sh
chert projects --config BASE --backend https://REVIEWED_CONTROL --json
chert lines --config BASE --backend https://REVIEWED_CONTROL --project PROJECT_UUID --json
chert bindings --config BASE --backend https://REVIEWED_CONTROL --project PROJECT_UUID --json
chert enroll --config BASE --backend https://REVIEWED_CONTROL \
  --project PROJECT_UUID --line LINE_UUID --relay-origin https://REVIEWED_RELAY \
  --output-config NEW_CONFIG --credentials-file NEW_SECRET_FILE --environment production --json
chert check --config NEW_CONFIG --json
chert byor --config NEW_CONFIG --json
# Separately reviewed activation, with freshly observed values:
chert activate --config NEW_CONFIG --expected-binding none --assignment-generation INTEGER --json
```

Confirm exact project/sole-line IDs; no automatic selection. Enrollment pins the
mode immutably and returns standby plus separate connection/recovery credentials
in a 0600 file. Only encrypted hosted origins are supported. If the response or
local save fails, inspect bindings; do not blindly reenroll. Never overwrite config
or secrets. Use the actual previous binding UUID for replacement, not `none`.
Remove the user token from the runtime environment. Connection/recovery credentials
come from the protected enrollment file or their named environment references.
BYOR requires no wrapper LiveKit key/secret, named dispatch or `chert-adapter-v1` hook.

`check` exits 3 intentionally for partial diagnostics; it reports authorization,
activation/authority reachability, application health/capabilities, storage and debt.
It does not establish a WebSocket connection or allocate sessions. Successful run
welcome reports transport connectivity. `status` is a read-only saved observation;
it does not import the application module or establish live readiness.

## Optional create-room and legacy behavior

```sh
chert init --mode create-room --non-interactive --config ROOM_CONFIG \
  --state-dir /absolute/fresh-room-state --agent-name NAMED_DISPATCH \
  --deployment DEPLOYMENT --boot BOOT_ID --livekit-url wss://LIVEKIT_HOST \
  --hook-origin http://127.0.0.1:PORT
chert check --config ROOM_CONFIG --json
chert create-room --config ENROLLED_ROOM_CONFIG --json
```

This starts a persistent connector; startup allocates nothing. On incoming calls,
the specialized adapter creates an isolated room with an explicitly configured
named dispatch, exact worker/job/participant/nonce readiness and scoped cleanup.
It needs LiveKit master credentials (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) and an
existing authenticated literal-loopback `chert-adapter-v1` health/cancel hook
(`CHERT_HOOK_SECRET`). Override environment names with the documented init flags.
Its preparation follows the deadline Chert supplies (see below) and its 60-second resource ceiling remains. It is not
compatible with arbitrary Cloud agents or the current talking-head receiver.

Legacy schema-v1 configs, `chert run` and room journals retain the old semantics.
For backward compatibility, init with old adapter-specific flags and no --mode
still emits v1. New onboarding without those flags defaults to BYOR. `run` rejects
v2 configs; use their explicit mode command. Explicit mode/command mismatch fails
before module, credential, network or resource effects.

To switch modes, create a fresh config/state and **new standby binding**, then
activate with the old binding's ID and current line generation. Never edit a v1
journal into BYOR or point BYOR at old adapter receipts. A BYOR journal also pins
handler ID and module path; incompatible handler changes need a fresh handoff.
Use immutable module release paths and keep compatible original code for recovery.
An operator may deliberately retain a v1 room binding and run `create-room` with
that same v1 config; this does not convert its state or ownership.

## Lifetime, recovery and diagnostics

The incoming-decision and preparation budgets come from the deadlines Chert
supplies with each call: at most ten seconds in total, with preparation ending at
least one second before the decision deadline. They never extend on retries. BYOR session expiry must fit the application's ready session, token
expiry and Chert's maximum two-hour credential lifetime. Unsupported durations
are rejected; nothing silently truncates a 600-second call to 60 seconds. The
incoming/receipt `resource_expires_at` is an authority upper bound; the accepted
session's sealed lease and local application expiry use the explicit selected
value. BYOR preserves the incoming audio/video flags; create-room remains audio-only.
Neither mode fixes slow avatar cold starts or qualifies physical video delivery.
The talking-head application now has an explicit ready-session owner; see the
[compatibility results](docs/talking-head-compatibility/RESULTS.md). Actual host
and physical media qualification remain separate.

Keep one writer per 0700 state directory and its 0600 journal/config/credentials.
Uncertain preparation is never repeated after timeout or restart. The journal
contains opaque application references, deadlines and delivery/settlement facts,
not room deletion authority or bearer credentials. Call-scoped credentials exist
transiently in memory/transport and are sealed centrally. The central validator
checks claims/grants; actual JWT signature authentication still belongs to LiveKit.

SIGINT/SIGTERM stops admission and preserves accepted/uncertain work. It never
stops the application server. Missing/hung recovery retains debt and blocks new
admission at the current capacity of one. Application callbacks must be cooperative
and idempotent; their timeout/rejection is not remote settlement. Keep the original
operation record through late completion. There is no clear-debt/reset command.

```sh
chert drain --config OLD_CONFIG --json
chert revoke --config OLD_CONFIG --json
# After the old sole writer stops, use its original mode/config/state/module:
chert byor --config OLD_CONFIG --recovery --json
# Legacy v1: chert run --config OLD_CONFIG --recovery --json
```

Drain returns future calls to the unchanged legacy route. Revocation remains
permanent across later drain; recovery is restricted to previously owned calls.
Both operations remain possible after project line cardinality changes. Keep old
recovery running after a new mode/binding takes new calls. Never delete an
unexplained writer lock; investigate host/PID ownership and use the existing
reviewed dead-writer recovery procedure. Completed calls remain debt-free during
later expiry or reconciliation failures.

JSON diagnostics use stable codes without callback exception text, tokens or raw
service errors. Notable codes: mode_mismatch, handler_invalid, credentials_invalid,
preparation_failed, deadline_exceeded, acceptance_uncertain,
application_recovery_missing, application_lifecycle_pending and cleanup_pending.
Journal state separates central_pending, application_pending and cleanup_pending.
Exit codes: 0 success, 1 internal failure, 2 configuration/usage, 3 partial/debt,
4 state/writer failure, 5 unsupported runtime/platform, 6 transport/backend,
130 sign-in cancelled (`login_cancelled`: escape, `q`, Quit or Ctrl+C during `chert login`).
`loopback-v1` is an explicit isolated-test mode, never a production fallback.

See [ownership details](docs/BYOR_OWNERSHIP.md) and
[implementation evidence](docs/byor-implementation/RESULTS.md). Review is required
before regenerating/deploying the candidate or starting any live qualification.

Hosted relay compatibility: the connector requires the `chert-authority-v1`
WebSocket ping heartbeat following authenticated relay polls. Five seconds
without it terminates the connection and clears connector availability, even if
TCP remains open. Other pings and call frames do not renew this freshness check.
This signal does not authorize calls or establish media readiness. Upgrade the
relay before deploying this connector; older relays fail closed after welcome.
