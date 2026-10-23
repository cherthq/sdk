# CLI-first shared onboarding

Status: `0.1.0-beta.10` is published. A public npm registry check on October 23,
2026 resolved the `beta` tag to beta.10 and `latest` to beta.6; the registry's
SHA-1 and integrity values match the reviewed candidate in the
[release receipt](releases/0.1.0-beta.10.md). This command still needs the
matching shared-line control-plane release and configured pilot pool. Installing
the CLI does not migrate the server, activate a shared pool or upgrade a worker.

The latest operational note recorded here is from October 22, 2026: at that time,
the shared pool was disabled pending line qualification, so signup and name/phone
entry could be tested but allocation and the live demo were not available. This
guide has not rechecked current pool availability; confirm with the pilot operator
before promising allocation or a live demo. After an account reset, use
`chert onboard --no-browser` and open the URL in a private window to avoid stale
browser authentication.

Use the published version explicitly for a reproducible onboarding run:

```sh
npx --yes --prefer-online @trychert/facetime@0.1.0-beta.10 onboard
```

Run it from your agent's project directory. Inside the CLI source checkout, use
`node dist/src/cli/main.js` after building to avoid npm resolving a different
installed executable. For the newest published beta instead of an exact version,
use `@trychert/facetime@beta`.

October 22 pilot policy: six unexpired active projects can share each explicitly
qualified line; the line still serves one physical call at a time. Trial credit
is 10 messages and 10 FaceTime minutes, expiring 24 hours after the original grant.
Retrying onboarding never resets the trial. Expiry preserves the project and
releases its subscription slot; reactivation does not guarantee the old number.

Shared calls reserve at most 10 minutes within the project's 100-minute UTC-day
limit and available entitlement/credit. At cutoff Chert requests native hangup
and stops its own media where supported. During a control-plane outage FaceTime
may remain connected or silent beyond cutoff. The physical line stays unavailable
until worker evidence confirms safe cleanup; media stopping or a terminal server
status alone does not establish native hangup. No undisclosed overage is charged.

## Copy prompt

Use this prompt with a coding agent that can run the reviewed CLI build:

> Help me connect my agent to Chert. Read the installed Chert CLI help and
> `docs/CLI_ONBOARDING.md`. Run `chert onboard --json` using the reviewed build.
> This opens browser sign-in and name/phone setup, creates my default project,
> obtains a shared line, and asks me to
> send an inbound iMessage verification code, and then requests one hosted FaceTime
> demo. Give me the browser URL when I need to act. Never ask me to paste Chert,
> LiveKit or provider secrets into chat. Wait for the CLI status; if interrupted,
> run the same command again, not a new account, project or allocation. Do not
> use `--restart` while a session is active. After the demo, inspect this project
> and use Chert's existing setup, doctor and dev commands to connect my agent.
> Explain which processes must remain running. Ask before deploying or starting
> paid provider work. Do not claim voice/video worked until I confirm the call.

For verification without placing the demo call, use
`chert onboard --skip-demo --json` instead. On a remote shell, add `--no-browser`.
The agent stays in its current tool invocation or resumes manually. No temporary
background helper, arbitrary agent reprompt or second runtime is installed.

## Flow and recovery

1. A fresh `chert onboard` opens browser sign-in or signup. After email confirmation,
   “Setting Up” asks for your name and phone number. It creates or reuses your
   default **Name's project** automatically; no project picker is needed.
2. The server allocates shared access under its capacity, credit and eligibility
   policy. Existing dedicated lines are left untouched. A saved active onboarding
   resumes in its original project; `--project` or an explicit user credential keeps
   the existing manual project workflow.
3. In the same browser tab, text the displayed code to the allocated number. The
   page updates to “Verified, please return to the terminal/coding agent.” The CLI
   shares the browser's durable request key and waits for the same session; it does
   not open a second verification tab on the initial setup.
4. After the server confirms proof and its “Verified” reply, the CLI requests the
   existing hosted demo. This uses Chert's infrastructure before customer provider
   keys are needed. Answer the FaceTime call. `demo_running` means the request was
   admitted, not that audio/video passed; `complete` means terminal, not successful.
5. For your own agent, use its existing `.env.local` containing its LiveKit/provider
   values. Start the agent and run `chert doctor`, then `chert dev`. If the env file
   is elsewhere, `chert setup --env-file PATH --project UUID` saves its path and
   project, not its secrets. `chert dev --takeover` only replaces this project's
   connector; it must never replace another project's connector on the shared line.
6. Both your agent and `chert dev` must remain running for local availability.
   Existing app-specific deployment/continuous-operation recipes are in the source
   repository under `docs/deployment-release/` and `docs/production-launch/`;
   their historical pilot targets must not be copied into a new project. Use the
   [CLI guide](../CLI_GUIDE.md) for the current runtime contract and
   [BYOR example](../examples/byor/README.md) for application-owned sessions.
   Continuous hosting still requires qualifying your chosen app and supervisor.
   This command does not deploy either process or configure an avatar provider.

Run `chert onboard --status --json` for a read-only snapshot. Ctrl+C pauses waiting;
run `chert onboard` again to resume. `--wait 0` displays the verification link and
returns instead of waiting (exit 3 while pending). Other waits are bounded to one
hour, with ten minutes the default.

If the browser credential response is lost, run `chert onboard` again to reuse
the saved setup intent. An approved credential whose response never arrived may
still exist; the error explains how an owner or admin can revoke it in the dashboard.

`chert onboard --cancel` cancels further onboarding work. It does not release the
project's allocation, hang up an admitted call, discard a recovery journal or
revoke a running connector. Active calls retain normal cleanup. `--restart` only
creates a fresh intent after the previous session is cancelled, expired or complete.
If the first server response was lost, run plain `chert onboard` to recover its
session ID before cancelling; its saved request key prevents duplicate creation.

No-capacity, missing credit, line-busy and verification failures retain the saved
intent. Full project capacity differs from a busy physical line or an unresolved
cleanup hold. No demo queue is promised, and the CLI does not select another line
or switch the hosted outbound demo to inbound calling. Retry the same command
once the cause is resolved. Do not delete local
resume state to work around an uncertain demo response. A retry reads existing
call status; the server also derives one stable demo request key per session.

## State and API boundary

Protected `~/.chert/onboarding/` files contain only a random request key and session
ID, partitioned by Chert origin and project. A reserved browser-setup scope holds
the intent before the project exists, so interrupted or expired login retries use
the same request. The resulting credential also retains that non-secret key. They contain no phone, code, password,
provider key or bearer token. Sign-in continues using the existing credential
store. An unreadable or unsafe resume file fails closed rather than silently
creating a second session.

The initial login URL carries `onboard=<request UUID>`. Browser setup uses
`POST /api/v1/cli/logins/setup` with the authenticated name, phone, login code and
request key. The CLI never stores the name or phone in its resume files.

The command uses `POST /api/v1/onboarding`, `GET /api/v1/onboarding/:id`,
`POST /api/v1/onboarding/:id/demo` and `DELETE /api/v1/onboarding/:id`. It sends the
existing bearer credential and `X-Chert-Project-Id`; writes reuse an idempotency
key. The server binds the session to its initiating actor, project and active
allocation. Browser verification uses its own authenticated session. Project API
keys cannot self-verify. Browser URLs must match the requested Chert origin and
session/project IDs before the CLI opens them.

The strict connector wire protocol, LiveKit credential handling, claim/dev runtime,
existing dedicated-line behavior and packaging model are unchanged. Shared routing,
limits and demo authorization remain server-side responsibilities. Tests with mock
responses verify orchestration and recovery, not a live messaging or media call.
