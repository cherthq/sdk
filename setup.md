# Set up Chert

This file is the canonical agent onboarding runbook. The website should copy only:

> Set up Chert for my agent or this project. Follow https://trychert.com/setup.

## Release status

This branch is a development preview. Packages are private/unpublished. The concierge HTTP service is implemented and locally fixture-tested; communications/account adapters and real staging must be verified before this becomes unattended onboarding. Do not claim signup, payment, a provisioned line, or working FaceTime from a local fixture or CLI receipt.

## Agent workflow

1. Explain what will happen: Chert contacts the user's phone, verifies ownership, opens a browser for a passkey and plan payment, then returns a protected integration receipt. Ask for their E.164 phone number and permission for that onboarding contact. Never infer consent from knowing a number.
2. Detect whether you are configuring a persistent personal agent (Muse, Hermes, OpenClaw, OpenAI Dots, Claude Duet, Grok Bot) or integrating the current project (Codex, Claude Code or another coding agent). Ask only if context is ambiguous. Never upload project files, environment variables, credentials or an absolute project path.
3. Use an explicitly trusted deployed onboarding origin. Do not invent one. For local development, clone this repository, run `bun install` and `bun run build`. Run `bun packages/facetime/dist/cli.js --help`; inspect the current command help before running it. The intended published package is `@cherthq/facetime`; it is not published yet.
4. Start the helper with `chert onboard --base-url <trusted-https-origin> --phone <E164> --consent-contact --agent <name> --target <project|personal> --detach`. From source, replace `chert` with `bun packages/facetime/dist/cli.js`. Only pass the consent flag after the user agrees. Add `--prefer-facetime` only if they also want hosted FaceTime onboarding and the service reports it configured; messages remain the default. Store the returned helper path privately. The helper polls for at most two hours; do not create duplicate sessions to work around an uncertain result.
5. Tell the user to reply to Chert's verification message and follow the passkey and payment links it supplies. A busy user can continue in messages; a FaceTime session requires a configured hosted assistant. Offer shared US$25/month or dedicated US$250/month per line. There is no free plan. The user chooses and authorizes checkout; never silently purchase.
6. Use `chert onboard-status --state <helper-path>` or `onboard-watch` to resume. If a transport or local write fails, resume the same helper; do not start a second setup or payment. Receipt delivery is acknowledged only after protected local files are saved. When complete, read `continuation.md` and `completion.json` privately. Reuse the confirmed project and line, configure the intended runtime, and run read-only readiness checks. Keep credentials outside source control and avoid overwriting existing configuration. Do not claim that a receipt proves successful calls, video or delivery.
7. Report the exact remaining prerequisites. Connecting an existing agent still requires its provider/LiveKit configuration and a running connector. Ask before placing a real test call or sending a real message. Deploy for availability only within the user's authorization.

The helper writes owner-only files in a temporary directory. It does not execute a callback or inject instructions into the originating agent. The host agent must watch/read the handoff and continue; automatic resumption requires a supported host integration. Use `onboard-cleanup` after consuming credentials. `onboard-cancel` attempts authenticated remote cancellation and always reports whether it was confirmed. It stops local polling on failure; contact can continue until the remote service expires or stops it. Once checkout starts, payment must be reconciled rather than blindly cancelled.

## Implementers

See [worker and API handoff](docs/ONBOARDING_WORKER_HANDOFF.md), [CLI](packages/facetime/README.md), and [control-plane coverage](packages/control-plane/BACKEND_COVERAGE.md). Keep these contracts and this runbook in the SDK repository; website copies must not become a second source of truth.
