# Talking-head application compatibility brief

Scope: local implementation and isolated validation in the CLI, application and
control-plane checkouts. Preserve all prior qualification evidence, candidates,
debts and unrelated dirty work. No live sessions, host operations, production
access, deployment, enrollment, activation or artifact regeneration for release.

Failure hypotheses:

1. BYOR's literal video=false parser/journal and central decision guard reject an
   existing audio+video request. Permit the actual requested video flag only for
   BYOR; preserve create-room's specialized audio-only contract. Do not infer
   end-to-end FaceTime video qualification from signaling or publication.
2. Calling Service._prepare during admission cannot meet the deployed 45-second
   preparation/four-second decision boundary. A single application owner must
   durably stage and reserve already-ready sessions. Incoming/check/startup cannot
   create or refill. Explicit application staging owns any paid effects.
3. In-memory claims and connector-triggered recovery leave accepted resources
   orphaned after connector death. Persist claims before credentials, independently
   enforce application expiry/terminal cleanup, recover exact owners on reopen,
   and retain uncertain preparation even when inventory currently reports absent.
4. The host prototype cannot restart with a stale socket and lacks an independent
   owner loop. Qualify process death/restart, exclusive writer/socket ownership,
   private persistent storage and independent expiry with real local subprocesses.
   Linux/systemd and the actual deployment host remain separately verified gates
   unless this local environment can exercise them; do not claim remote deployment.

Deterministic red tests: video transport/journal and SQL accept; staging followed
by duplicate atomic claims with zero new preparation; cross-call claim exclusion;
ready slot reopen; missing/stale/video-not-ready decline; claim cancellation and
expiry without connector; interrupted staging reopened remains unknown; failed
cleanup retry; exclusive writers and stale socket restart. Use the actual
AvatarAdapter with substituted provider transports only, retaining production
media policy. No synthetic audio-policy override qualifies the new path.

Reuse existing application room/spec/readiness/token/cleanup implementation; do
not import HTTP lifespan or steal an old receiver's in-memory slot. Fresh owner
state and explicit old-owner drain are deployment prerequisites. Claims use one
fsynced transaction in one operation journal. Staging is explicit, idempotent,
and cannot blindly retry an interrupted provider operation. Expiry is separate
from incoming deadline and bounded by original agent/token expiry.
