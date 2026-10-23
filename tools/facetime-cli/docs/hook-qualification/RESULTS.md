# Talking-head connector qualification — 2026-09-30 UTC

**Result: the existing webhook receiver is healthy, but the talking-head agent is
not compatible with the current CLI adapter.** Qualification is complete for the
available source and read-only deployment evidence. A dedicated connector handler
and host integration are required before activation; this is no longer merely a
missing URL or credential configuration.

No production deployment, webhook change, room creation, dispatch, provider session,
agent start/restart, FaceTime call or historical cleanup mutation was performed.
The current webhook route remains available. The following local patch is a
dispatch guard, not a working talking-head connector adapter.

## Verified current deployment

The authenticated, configuration-only receiver action reports revision `08c33cf`,
classic profile, continuous mode with automatic refill, audio+video, 45-second
preparation, 270-second waiting rotation and a 600-second call limit.
[Sanitized output](receiver-config.txt) contains credential-presence indicators,
never credential values. Only the `config` operation was invoked; start, preflight
and stop operations were not invoked.

LiveKit status reports `demo-agent-0` / `CA_aWAg6UGjgzeG`, version `axoUxsvux8x3`,
Running in `us-east`, deployed at 03:01:59 UTC. This supersedes the earlier
`NhdecWJZ5V7Z` observation. See [status](cloud-agent-status.txt).
The agent repository's deployment record identifies `08c33cf` as the uploaded
implementation; current HEAD `52b43a4be253bc815e32b205a8f1118870b85955` has no
source difference from it in `src`, `scripts`, or `receiver/src`.
This combines live status with the local deployment record, not an independently
retrieved cloud source manifest.

## Contract comparison

| Requirement | Current talking-head implementation | Qualification |
| --- | --- | --- |
| Signed connector dispatch envelope | Parser recognizes `chert-byor`; CLI sends `{spec, signature}` with inner `chert-connector-probe` | Incompatible; unknown envelope falls through to standalone job |
| Exact agent identity and ownership | BYOR uses `demo-byor-*` identities and `byor.*` attributes | Does not establish CLI nonce/job/dispatch/track correlation |
| Authenticated same-host hook | Receiver is Railway; agent is LiveKit Cloud; public `/readyz` reports receiver readiness | No qualified `chert-adapter-v1` loopback hook on the agent host |
| Capacity-one admission | Receiver owns a continuously warmed slot | Does not establish the CLI's selected worker/boot/session capacity |
| Fresh room per connector operation | Receiver reuses its prepared slot for one incoming call | Cannot transfer pool ownership into the CLI's room/marker journal |
| Four-second preparation, 60-second resources | Hosted configuration uses 45-second preparation and 600-second calls | Incompatible; do not increase CLI budgets or reuse receiver TTL |
| Cancel and cleanup proof | Receiver owns its own durable journal and room lifecycle | Does not establish connector operation cancellation/settlement |

An arbitrary participant that publishes audio is insufficient. The CLI checks the
specific dispatch, job, worker, nonce, identity, room marker and sole unmuted track.
Mapping only metadata or returning a hard-coded healthy hook would bypass these
checks without implementing their guarantees.

## Local dispatch guard and tests

The actual talking-head request handler was tested under provider/RTC mocks.
Before the patch, all eight new regressions failed: signed connector envelopes,
explicit connector mode and partial envelopes could be accepted or enter the
standalone path. That path has its own ten-minute lifetime and lacks the CLI's
signed ownership contract. No real agent job was used to demonstrate this.

The isolated candidate now reserves connector envelope fields (`spec`, `signature`)
and the connector mode, rejecting them with a fixed, sanitized error in the shared
parser. Both dispatch acceptance and the job entrypoint use this parser. The
regressions require rejection before connection, publication, model or session
creation. Ordinary Console and existing BYOR/outbound behavior remain covered.

Artifacts:

- [Review patch](agent-guard.patch), based on the agent HEAD above.
- [Exact changed-file hashes](candidate-files.json).
- Candidate directory: `/Users/garygao/chert-facetime-cli/.local/hook-qualification/agent`.
- [Brief](BRIEF.md), [red evidence](dispatch-red.txt),
  [Node 22 results](agent-check-final-node22.txt),
  [Node 24 results](agent-check-final-node24.txt).

**101 tests pass on Node 22.23.2 and 24.14.0**, including eight new regressions.
The first Node 24 run exposed an existing test-mock incompatibility: Node exposes
a synthetic `module.exports` namespace key that the experimental mock generator
cannot emit as a named export. Two candidate test mocks omit that synthetic key;
production exports and behavior are unchanged. Initial failure evidence is retained.

All 41 inspected original agent source/test files and all 22 historical CLI state
files remain unchanged. The patch applies cleanly to its base. See
[preservation verification](preservation.json). This candidate is separate from
the existing control-plane/relay release artifacts and has not been deployed.

## Next implementation step

Build a dedicated connector-compatible talking-head entrypoint and same-host hook
supervisor in an isolated agent candidate. Keep the existing webhook entrypoint
and continuously warmed receiver unchanged. Use a distinct named deployment so
connector metadata cannot reach the legacy fallback. A dedicated Linux pilot host
running the agent and npm connector as separate supervised processes fits the
current loopback restriction; a remote Cloud hook would require a separate reviewed
protocol/topology change. No specific host has been provisioned or selected.

The implementation must:

1. Authenticate the dispatch envelope and bind project, deployment, boot, exact
   room/job/dispatch/participant/nonce before accepting a job or starting a provider.
2. Expose authenticated `/health` and operation-specific `/cancel` on literal
   loopback with replay rejection, fresh challenges, monotonic sequence and
   capacity derived from the actual worker/session. Health creates no resources.
3. Publish readiness only after the exact talking-head session is ready, with
   the CLI's required nonce/job attributes and sole matching audio publication.
   Readiness must fit the existing preparation deadline; a slow cold start declines.
4. Enforce the original 60-second deadline and cancellation through provider,
   media and room teardown, including late completion and process restart. Preserve
   original journals and recovery identity until cleanup is confirmed.
5. Pass isolated contract tests before separately authorized host installation,
   no-allocation qualification, standby enrollment, activation and bounded live test.

The guard patch can be reviewed with that implementation; it does not qualify
an adapter by itself. Do not deploy the current CLI against `demo-agent-0` or point
its loopback hook setting at the public webhook/receiver URL.

The historical interview-agent Session is separate. Its worker cleanup is
recorded, but changing future routing to talking-head does not prove external
room/provider cleanup in the previous project's namespace. That evidence remains
required; this qualification neither erased nor reassigned the Session.
