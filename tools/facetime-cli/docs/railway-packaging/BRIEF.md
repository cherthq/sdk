# Railway packaging qualification brief — 20260930 r1

Build only from the reviewed `byor-av-pilot-20260930-r1` archives, verified before extraction. Preserve that release, source working trees and all historical debts. Local Docker is available (Linux arm64 engine on Darwin); target Linux amd64 explicitly for Railway.

Failure hypotheses: an ephemeral directory could impersonate the volume; normal startup could initialize empty journals; a connector crash could stop cleanup or trigger lock-removing restarts; inherited environment could expose provider credentials to Node; health could allocate or confuse empty standby with readiness; abrupt owner death could lose claims or erase preparation uncertainty; overlapping containers could unlink another writer's IPC.

Predicates: exact mountpoint plus persistent installation marker, explicit one-time initialization and existing journals/config, exclusive supervisor lease, bounded independent child restarts, retained Node crash lock, strict child env allowlists, private Unix sockets, sanitized HTTP process/IPC health, zero startup/probe allocations, actual production owner with only provider transports substituted. Tests exercise signals, reopen, expiry while Node is down, journal persistence and container replacement on one named local volume. No real credentials or sessions.

Limits: local containers do not establish Railway mount identity, termination grace, restart/deployment overlap settings or backend enrollment. Runtime image contains no qualification injection. Qualified image identity and source/dependency hashes must be recorded. No deployment, image publication, agent starts, staging against live providers, or routing changes.
