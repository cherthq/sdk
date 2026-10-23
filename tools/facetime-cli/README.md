# Chert FaceTime CLI

**Using the Chert CLI? Start with the [CLI user guide](CLI_USER_GUIDE.md).** It
explains setup choices, sign-in, starter agents, `doctor`/`dev`, safe line use,
settings and troubleshooting.

Building an agent for a workshop? Use the [student guide](STUDENT_GUIDE.md) and
its JavaScript starter: `chert new my-agent` creates a working voice agent
folder (`--video` for a video one). Instructors: see the
[workshop checklist](WORKSHOP_INSTRUCTOR.md). Already have an agent? Use the
[quickstart](QUICKSTART.md).

The [developer guide](DEVELOPER_GUIDE.md) explains call lifecycle, agent
requirements, diagnostics and limits. Every CLI command and flag is in the
[command reference](COMMANDS.md). Application owners integrating a receiver
should use the advanced [connector guide](CLI_GUIDE.md).

The shared-line beta adds `chert onboard` to this same CLI. Its
[copy prompt and recovery guide](docs/CLI_ONBOARDING.md) describe the browser
sign-in, automatic project setup, verification and hosted outbound demo flow.
The CLI is published on npm's `beta` prerelease tag; `latest` and `beta` are
independent tags, so use `@beta` for the newest prerelease and a version pin for
reproducible installs. Shared allocation still requires the matching control-plane
release, configured pilot pool and qualified lines; installing the CLI does not
activate them. See the dated [release receipts](docs/releases/) for current tag
verification and remaining live-call boundaries.

For the optional one-call Muse preparation workflow, see
[CLI Guide: Muse](CLI_GUIDE.md#muse-explicit-media-preparation-for-one-call).
Use the reviewed CLI and updated `AGENT_PROFILE=muse` worker with
`chert dev --agent demo-agent-0 --muse`. Generic agent membership is not media
readiness. On October 6, 2026, the user verified a successful Muse FaceTime
conversation, cleanup and line release on worker version `oxDdjM5jYBx9`.
CLI release: the latest published [`@trychert/facetime`](https://www.npmjs.com/package/@trychert/facetime),
installed with `npm install -g @trychert/facetime@beta` (the `beta` tag moves to each new release).
Each version's release receipt, with publication and registry verification, is in
[docs/releases](docs/releases);
the [Mac CLI upgrade steps](CLI_GUIDE.md#update-macs-that-run-the-cli) are in the CLI guide.
The guide distinguishes historical call evidence from pending live rehearsals.

A customer-side, npm-first Chert receiver with two explicit modes:

- **`chert byor` (primary):** your application supplies a small TypeScript callback
  for ready, call-scoped room credentials and application lifecycle/recovery.
  The package supplies authenticated transport, deadlines, duplicate handling,
  decisions, lifecycle delivery and durable recovery. No existing receiver,
  public webhook URL, wrapper LiveKit master keys or special agent hook required.
- **`chert create-room` (optional):** a persistent connector using the specialized
  LiveKit room/dispatch adapter. It allocates only on incoming calls, requires
  its documented named-agent/loopback-hook integration and retains a 60-second
  resource ceiling.

The historical implementation reports below describe the BYOR engine and optional adapter; the current Muse deployment and test evidence are in the guide. Neither starts/restarts the
customer agent server or implicitly activates routing. The package remains
`@trychert/facetime` (see `package.json` for the version); publishing is done by Chert. No separate SDK or
mandatory Docker is needed. Use Node **22 (22.12 or later), 24 or 26** on macOS or Linux.
Node 26 support starts with beta.4. The student starter still targets Node 22.23.2
or 24; real FaceTime calls under Node 26 remain unverified.

```sh
npm install --save-exact /absolute/reviewed/trychert-facetime-VERSION.tgz
npx --no-install chert init --mode byor --non-interactive \
  --config /absolute/app/chert.json --state-dir /absolute/app/chert-state
# Connect generated chert-handler.ts to your session owner, then compile to JS.
npx --no-install chert check --config /absolute/app/chert.json --json
# After separate explicit standby enrollment:
npx --no-install chert byor --config /absolute/app/chert.json --json
```

Incoming preparation follows the deadline supplied by Chert, including its ten-second decision window. BYOR accepts an explicit application session expiry, bounded by the
supplied token and Chert's two-hour credential limit; it is not silently truncated
to 60 seconds. Callback accept asserts readiness. General BYOR callback acceptance alone does not qualify media. The explicit Muse
preparation path above handles its startup before caller arrival.

- [CLI guide and deliberate legacy migration](CLI_GUIDE.md)
- [Complete no-receiver callback example](examples/byor/README.md)
- [Ownership and callback contract](docs/BYOR_OWNERSHIP.md)
- [Talking-head ready-session compatibility](docs/talking-head-compatibility/RESULTS.md)
- [Implementation results and exact evidence](docs/byor-implementation/RESULTS.md)
- [Product direction](PLAN.md)
- [Pilot review guidance](docs/BACKEND_PILOT_RUNBOOK.md)
- [Deployment candidate status](docs/DEPLOYMENT_READINESS.md)

Legacy schema-v1 configuration and `chert run` retain their create-room behavior;
old journals are never reinterpreted as BYOR. Mode handoff requires a new binding
and fresh state, while the old owner continues recovery. There is no debt-reset
command. Historical [adapter](docs/ADAPTER_TEST_RESULTS.md),
[backend](docs/BACKEND_INTEGRATION_RESULTS.md) and
[talking-head qualification](docs/hook-qualification/RESULTS.md) reports remain
unchanged evidence of their original paths. The two historical cleanup debts
remain unresolved. No live qualification occurred during the BYOR implementation.

Development: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run proof:transport`. Tests install the actual tarball into a clean application
and use only isolated services and synthetic credentials. Review the new package,
application integration and regenerated candidate before deployment or live tests.
