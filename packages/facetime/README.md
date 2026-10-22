# @cherthq/facetime — agent setup preview

An original SDK-owned `chert` CLI for preparing an existing agent or project and checking Chert control-plane access. **Private and unpublished.** The intended package name is `@cherthq/facetime`; registry installation is not available until a separate publication gate passes.

This is not the legacy FaceTime connector and contains none of its implementation. It does not relay media or provide `chert dev`. It uses the SDK-owned `@cherthq/control-plane` client against existing API contracts.

## From this checkout

```sh
bun packages/facetime/src/cli.ts --help
bun packages/facetime/src/cli.ts setup --backend https://YOUR_CHERT_HOST --target project --plan shared --json
bun packages/facetime/src/cli.ts login --backend https://YOUR_CHERT_HOST
bun packages/facetime/src/cli.ts doctor --env-file .env.local --json
```

`setup` detects a project from `.git`, `package.json`, `pyproject.toml` or `Cargo.toml`; use `--target personal` for a persistent agent running from such a directory. It explains prerequisites, surfaces missing credentials and asks for a plan if none was selected. Shared is US$25/month; dedicated is US$250/month/line. Current service availability and checkout terms still need confirmation. No free plan is offered.

`login` starts device approval, prints a same-origin browser approval address and waits at most 15 minutes. The user approves the displayed code in their browser. Only a returned approved project-scoped credential is stored, in `~/.config/chert/facetime/credential.json`, outside the current project, with directory mode0700 and file mode0600 on Unix. It never prints the device secret or access token. The file is a CLI credential, **not a passkey**. Existing valid local credentials are reused; `status` checks whether the server still accepts them. Server refusal or a lost token response stops the attempt; no uncertain approval is retried automatically.

`status` and `doctor` use only whoami, assigned-line and worker GET routes. They do not dispatch test agent jobs, enroll a connector, create checkout, call anyone or send a message. A `configuration_ready` result only means those configuration predicates passed; it does not prove a connected agent or working media.

## Local agent configuration

The CLI reads the selected `--env-file`, else `.env.local` or `.env`, without executing it, creating it or overwriting it. Shell values take precedence. Required names are `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `AGENT_NAME`. Values are never included in CLI output. Store secrets outside source control. Your registered LiveKit agent and the compatible connector must run separately for continuous availability.

## Deliberate blocked steps

- Signup, passkey enrollment and association between an account and a verified phone are not implemented here.
- Phone-number verification requires a documented service and a real user-approved verification step.
- Project creation and line allocation remain separate account/operator steps. Existing connector policy expects one assigned `customer_decides` line with no hosted assistant.
- Billing is informational. The CLI does not generate arbitrary Stripe links or spend money.
- Connector enrollment and media relay are not implemented by this package. Use a separately verified compatible runtime; do not claim the setup preview connects calls.

## Verification and release gates

`bun test packages/facetime` runs isolated HTTP fixtures and temporary owner-only credential storage tests. These tests do not contact production or verify actual browser approval, signup, payment, phone ownership, call delivery or media.

Before publication: build the CLI and declarations; run Node22+ execution smoke tests; verify the packed bin and the `@cherthq/control-plane` dependency; make agent-readable public docs available; verify device approval against staging; verify fresh-account onboarding and line entitlement separately; integrate a licensed connector runtime and prove an authorized real call plus cleanup. Keep `private:true` until those explicit gates are reviewed. The name alone is not a working end-to-end setup product.

## Concierge onboarding helper

```sh
chert onboard --base-url https://TRUSTED_ONBOARDING_HOST --phone +14155550123 --consent-contact --agent codex --target auto --detach --json
chert onboard-status --state /tmp/chert-onboarding-EXAMPLE/state.json --json
chert onboard-watch --state /tmp/chert-onboarding-EXAMPLE/state.json --json
chert onboard-cancel --state /tmp/chert-onboarding-EXAMPLE/state.json --json
chert onboard-cleanup --state /tmp/chert-onboarding-EXAMPLE/state.json --json
```

The originating agent must explain that Chert will contact the supplied number and obtain the user's explicit contact consent before using `--consent-contact`. A trusted service origin is required; there is deliberately no guessed production default. HTTPS is required except localhost HTTP. `--agent` overrides `CHERT_ORIGIN_AGENT`, Codex/Claude environment detection and the generic coding-agent fallback. `--target auto` uses repository markers. Only the project directory's basename is sent as a label; repository files, full paths and local provider credentials are not uploaded.

Without `--detach`, `onboard` prints actionable session context and watches until completion, refusal or expiry. With `--detach`, a short-lived Node/Bun child watches independently. It cannot execute arbitrary resume commands or inject a message into another agent. Agent hosts may explicitly watch the returned protected handoff path. The helper is a mkdtemp directory with0700 permissions; state, claim receipt and continuation use0600. The private polling capability is never printed. Concurrent polling is locked. Receipt retrieval is repeatable until the original deadline; the CLI saves the protected files and a `handoff_saved` state before sending a delivery-bound acknowledgement. Lost responses can be retried with `onboard-status` using the same helper; never start another signup or payment. Only a matching acknowledgement erases the local capability. Polling stops at the server deadline or two hours, whichever comes first. The installed CLI starts a fixed local expiry child and waits for its startup acknowledgement. It removes state and handoff at the original deadline without another command, including after completion. The child inherits no environment credentials, does no HTTP, and never revokes a remote line or subscription. Library callers must inject `scheduleExpiry` to enable that automatic lifecycle; otherwise expiry is enforced when inspected. Completed handoffs remain available only until the original deadline or explicit cleanup. It is not a durable credential vault. Killing the cleanup process, rebooting, permission changes or a stale helper lock can prevent scheduled deletion; inspect the process/lock and run `onboard-cleanup` safely in that case. Cleanup waits at most 60 times for an active lock and never forcibly removes it.

`onboard-cancel` stops local polling, erases its persisted capability, and sends an authenticated `POST /sessions/:sessionId/cancel` with body `{}` using the cached capability under the helper lock. A matching server cancellation receipt produces `remoteCancellation:true`. If the service is unavailable, refuses, or returns an invalid receipt, local cancellation still completes with `remoteCancellation:false`; remote contact may continue until the service expires or stops the session. Cancellation does not revoke an allocated line or subscription. `onboard-cleanup` removes only the known local state/completion/continuation files. After a lost claim or acknowledgement response, rerun `onboard-status` or `onboard-watch` with the same helper. Its saved state resumes receipt delivery without a duplicate paid setup.

### Concierge HTTP contract

All routes are relative to the explicit `--base-url`; JSON may be returned directly or as `{ "data": ... }`. Responses are bounded to64KiB and requests time out after15seconds. Redirects are refused. Errors do not echo response bodies or credentials.

- `POST /sessions`: `{phone, contactConsent:true, originAgent, target:{kind:"personal"|"project", projectLabel?}, resumeStrategy:"poll"|"manual", ttlSeconds:7200}`. Returns `{sessionId, pollCapability, expiresAt, state}`. `expiresAt` is an ISO timestamp or milliseconds since Unix epoch; session IDs contain8–160 URL-safe alphanumeric/underscore/hyphen characters. Capabilities are32–1024characters.
- `GET /sessions/:sessionId`, header `Authorization: Bearer POLL_CAPABILITY`. Returns `{sessionId, state, phoneVerified?, passkeyRegistered?, ...}`. Public status fields are guidance, not credentials. `ready` permits a claim; `failed`, `denied`, `expired` and `cancelled` stop the helper.
- `POST /sessions/:sessionId/claim`, same capability header, body `{}`. Returns the same protected receipt until acknowledgement or expiry: `{sessionId, deliveryId, projectId, connector:{kind:"existing-connector"|"hosted-webhook", configuration:{...}}, ...}`. Connector configuration may contain scoped secrets, so it goes only to `completion.json`. The CLI creates a separate safe `continuation.md` asking the originating agent to reuse the confirmed resources, inspect the connector contract, protect credentials and verify readiness. It does not interpret or execute remote configuration as code.

- `POST /sessions/:sessionId/claim/ack`, same capability header, body `{deliveryId}`. Returns `{sessionId,state:"claimed",deliveryId}`. The CLI sends this only after saving the protected receipt, continuation and retry state; identical acknowledgement retries expose no credentials.

The independent server/worker must implement verified phone ownership, account/passkey association, plan selection, checkout, entitlement, allocation and a compatible connector. Neither these fixture tests nor a claim receipt establish those real integrations. Real staging onboarding, detached process lifecycle, interruption/reconciliation and physical communication acceptance remain explicit release gates.

`--prefer-facetime` explicitly requests hosted FaceTime onboarding after contact consent; it is omitted by default. The service refuses that preference if FaceTime is unconfigured. A requested call is not proof of connected media.
