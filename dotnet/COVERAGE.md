# TryChert .NET source and coverage boundary

## Branch inventory before implementation

Inspected all local heads, remote-tracking heads, live remote heads (`git
ls-remote --heads origin`), and SDK worktrees on 2026-10-24 Melbourne time.
Fetched the previously untracked `origin/feat/unify-facetime-cli` for inspection.
All branches with a `dotnet/` directory shared the identical tree
`9d6092f0911976e6121958561a56d49a469ef1d8`. No competing C# implementation or
uncommitted C# changes existed in those worktrees when inventoried.

| Branches / worktrees | C# prior work |
| --- | --- |
| `main`, `origin/main`, `amp/orb-setup` | Same iMessage-only baseline |
| `codex/cherthq-scope`, `codex/chert-adopt`, `codex/more-provider-adapters` (local and remote) | Same baseline |
| `origin/codex/agent-onboarding-cli`, `origin/feat/unify-facetime-cli`, `origin/fix/adopt-unresolved-rewrites` | Same baseline; FaceTime work is TypeScript, not C# |
| `trychert-sdk-release`, `review-trychert-sdk-release`, `unified-sdk-release` | Same baseline |
| `unified-csharp-sdk`, `unified-cpp-sdk`, `unified-rust-sdk` | Same baseline at task start |
| `codex/sdk-foundation`, `origin/codex/sdk-foundation` | No C# directory |

The two C# history commits were inspected before coding:
[initial transport/tests](https://github.com/cherthq/sdk/commit/5cd380ae4664a0f7fa957025f578cff6955adb19)
and [package rename](https://github.com/cherthq/sdk/commit/ed19d7d41d9a6492c17bbffda29b8c74019d8c72).
Chosen base: `unified-csharp-sdk` at
[`deb210b`](https://github.com/cherthq/sdk/commit/deb210b7b35c43a3c7da8ad71421df55ae2790ed),
the same most-complete C# tree with orb setup. Its original 19 loopback groups
passed before changes. No unrelated worktree changes were imported.

## Contract sources

- iMessage strict native transport and receipt contracts: the existing C# source,
  tests and `packages/imessage/src/index.ts` on the selected SDK base.
- FaceTime control-plane TypeScript SDK:
  [typed control-plane client](https://github.com/cherthq/sdk/commit/4aaabba9fb6fba3665553aa165264a122baf20a3)
  and current source in the `unified-sdk-release` worktree. It covers login,
  identity, lines/workers, credentials, connectors and billing, but not calls.
- FaceTime executable backend inspected at
  [`b5e0de5`](https://github.com/cherthq/facetime/commit/b5e0de5ddec188cbe872f48e58fba331092a5ecb):
  `control-plane/app/api/v1/calls/**`, `lines`, `workers`, `cli/**`, `connectors`,
  and `src/lib/facetime/{schemas,destination-schema,http,call-action,
  normalization,store,cli-login,connectors}.ts`. These sources, rather than a
  historical coverage document, define call payloads and the two different event
  representations. Source inspection is not a deployment assertion.
- FaceTime `control-plane/app/api/v1/billing/**`, including checkout, was
  inspected in the current backend worktree. Its exact inspected revision is
  **unverified**; checkout is absent at `b5e0de5` and must not be attributed to
  that revision. Billing source coverage does not establish deployed availability.

## Completeness matrix

| Surface | Implemented / tested | Boundary |
| --- | --- | --- |
| Package/namespace/assembly | NuGet `chert-sdk`; namespace/assembly `TryChert`, .NET 8, dependency-free, MIT | Preview artifact; no publication |
| Unified client | Optional independent `IMessage` and `FaceTime` clients; owns their lifetimes | No unified credential/project binding |
| iMessage | Raw JSON transport; strict text and six standard reactions; typed receipts/errors | Full native baseline parity; no vendor adapters or media helpers |
| FaceTime calls | Typed create/list/get/answer/reject/end/events/transcript | API state/acknowledgement, not device/media proof |
| FaceTime destinations | Managed and BYOR, direct destination, links, typed groups | Server permissions, feature flags, LiveKit token validation and worker support remain authoritative |
| FaceTime inventory | Typed paged lines/workers | No automatic pagination or readiness inference |
| FaceTime login/access | Typed start/poll/inspect/approve/whoami/logout/credential list/revoke | Human approval; no automatic browser flow/storage; credential scopes unchanged |
| FaceTime connectors | Typed enrollment + secrets; list/activate/drain/revoke JSON results | No connector runtime/media relay; enrollment is not activation |
| FaceTime billing | Typed catalog/current checkout/create checkout | Explicit owner action, pinned catalog; no entitlement/provisioning claim |
| Other JSON APIs | Raw authenticated request methods for both channels | No typed wrappers for every assistant, webhook, integration or administration resource |
| Safety | No retries, redirects, proxy/cookies or ambient credential reads; bounded responses/deadlines; cancellation; sanitized errors | Cancellation/lost response never proves no effect |
| Tests | Original iMessage regression suite + FaceTime wire/auth/serialization/negative/boundary checks on real loopback sockets | Synthetic credentials only; not live E2E |
| Exact artifact gate | ZIP allowlist, metadata/license/no dependencies, clean-cache local-feed consumer runs the full suite and safe example, SHA-256 | Review must refer to exact package bytes; publication needs separate approval |

## Release blockers and exclusions

No test authorizes real calls, messages, financial actions, credential revocation,
infrastructure changes or publication. No physical device/media acceptance was
performed. Source contracts may not be deployed, and CLI credentials intentionally
cannot invoke all methods. A live integration acceptance run requires a specified
environment, suitable per-channel credentials and explicit recipient consent.

This is a unified native HTTP SDK, not complete parity with all vendor adapters,
administration resources, media streaming, signup or passkeys. If those are part
of a release's advertised scope, that release remains blocked on implementing
and separately verifying them. No Mac worker installation or restart is needed
to consume this SDK; compatible server/worker deployment is still required.
