# Standby transport repair — analyst brief

Authorization: continue diagnosis, fix the transport failure and requalify deployed standby. Keep activation, paid staging and calls off. Preserve the enrolled binding, immutable handler path, journals, volume, cleanup ownership and historical debts. Do not raise decision/readiness budgets or hide failure by repeatedly resetting the three-start limit.

Observed failure: real production BYOR process successfully acquired generations 5, 6 and 7, then exhausted its start budget. Python continued, Node released its journal lock, no slots/resources/calls were created. A raw three-minute WebSocket connection held generation 8 successfully. Root cause was not established by HTTP status samples alone.

Hypotheses to distinguish:
- relay closes after a transient authority request failure;
- infrastructure closes the upgraded socket;
- CLI rejects a frame, fails an application callback/tick, or exits for another reason.

Use the original installed CLI with a temporary observation-only WebSocket event hook on the actual application host, plus read-only timed authority inspections from the relay host. Emit only allowlisted error categories and numeric close codes; never credentials, request bodies, headers or arbitrary errors. The production supervisor is already fenced by its exhausted budget; the diagnostic CLI must hold the existing journal's normal exclusive lease, stop gracefully, and release it before replacement.

Implement only the evidence-supported correction. Add a deterministic regression test that reproduces the failure before changing source, review behavior against authorization/generation fencing, bounded deadlines, credentials isolation and durable recovery. Freeze a new artifact with hashes rather than silently replacing the previously reviewed archive. Deploy only required components, retain state, verify actual authenticated standby and observe sustained connectivity longer than the prior failure window. Health alone is not media evidence.
