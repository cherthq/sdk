# Talking-head connector qualification

Scope: read-only infrastructure and isolated local source tests; no deployed agent,
receiver, CLI routing or historical cleanup state changes. Original agent HEAD is
recorded in baseline.json; existing user edits remain untouched.

Hypothesis: the current talking-head request handler treats the CLI's signed
connector envelope as a standalone job because byorSpec recognizes only
chert-byor. Such a job is accepted without the requested participant identity,
authenticated session hook or 60-second expiry. A healthy webhook URL does not
establish this different transport contract.

Regression: invoke the actual requestFunc and job entry under provider/RTC mocks.
A connector envelope must reject before acceptance, model/session creation,
connection or publication; ordinary Console and existing BYOR jobs must retain
their behavior. Do not dispatch a real job to prove this negative predicate.

Narrow candidate fix: reserve connector envelope fields and connector mode in the
shared parser and fail closed until a compatible entrypoint is implemented.
This correction is not an implementation of the connector hook or a claim that
the talking-head agent now supports the connector.

Qualification also checks public HTTPS liveness/readiness and existing cloud-agent
status without POSTing a webhook, creating a room or starting a worker.

Review: compare candidate against this brief, run startup/dispatch tests on both
supported Node patches and the agent's existing check suite. Preserve original
sources, user edits and both CLI cleanup debts. Record the remaining host/adapter
engineering step explicitly; do not bypass loopback, metadata or expiry checks.
