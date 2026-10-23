# Compatibility and acceptance coverage

A passing unit coverage percentage does not mean full provider API parity.
These packages currently cover the narrow operations below. All other methods
must reject before a Chert send. Provider identifiers and credentials are not
portable across services. The old-version CRM compatibility comparison is complete;
this is not a paired deployment claim.

| Feature | Linq 0.78 | Sendblue 3.20 | Blooio SDK 0.0.2 | Blooio HTTP v4 |
| --- | --- | --- | --- | --- |
| Existing-chat plain text | Supported | Not mapped | Not mapped | Supported subset |
| Explicit sender/recipient text | Not mapped | Supported | Recipient only, Chert line policy | Supported subset |
| Queue acceptance vs sent | Mapped | Mapped | Mapped | Supported subset |
| Delivery/read evidence | M4D delivered; read transition pending | M4D delivered; read transition pending | M4D delivered; read transition pending | M4D delivered; read transition pending |
| Error codes / unknown outcomes | Tested | Tested | Tested, including legacy flat errors | Supported subset |
| Retry suppression / cancellation | Tested | Tested | Tested | Supported subset |
| Idempotency | Existing-chat text/media frozen receipt; 255-code-point keys; PostgreSQL and separate controlled M4D text/PNG fresh200/replay200/conflict409 runs pass | Not declared for normal send | Strict keyed reservation/replay; PostgreSQL and one controlled M4D fresh/replay/conflict run pass | All supported send paths use frozen route/body identity and owned lookup; local PostgreSQL replay/conflict/concurrency checks pass. Direct text plus existing-chat text and owned PNG each have a controlled M4D 201/replay200/conflict409 run; each produced one native send |
| Recorded status / retrieval | Metadata-complete recorded retrieval, including one frozen media part | Recorded scalar subset plus one owned media URL; getStatus stays narrow | Supported subset | Chat-scoped status and validated recorded text/single-image/caption retrieval subset |
| DM typing start / stop | Supported acknowledgement subset | Explicit sender/recipient acknowledgement subset; duration rejected | Rejected | Supported acknowledgement subset |
| Existing-chat mark-as-read | Explicit application acknowledgement subset; native installation/live acceptance pending | Not mapped | Not mapped | Not mapped |
| Authenticated identity / active state | Not implemented | Not implemented | `me.retrieve()` valid flag only; no billing/devices/credentials | Not implemented |
| History / pagination | Metadata-complete recorded cursor subset | Tenant-wide strict text/media offset subset; bound lifecycle proof only; unknown required facts refuse | Rejected | Recorded text/single-image/caption cursor listing subset |
| Owned direct-chat retrieval | Not mapped | Not mapped | Not mapped | Actual Chert chat/contact identity, target and nullable name only |
| Media sends / voice notes | One uploaded attachment in an existing DM; no caption or voice-note semantics | One HTTPS PNG/JPEG URL; media-only M4D pixel gate passed, optional caption v2 experimental with recipient whitespace fidelity failure; voice notes rejected | Rejected | One owned PNG/JPEG or server-imported public HTTPS image in an existing DM, no caption; external import physical acceptance pending |
| Attachment metadata | Metadata-complete `attachments.retrieve` subset | Not mapped | Not mapped | Planned provider upload endpoints remain unsupported |
| Attachment registration/upload | `attachments.create` plus caller PUT and stable Chert download candidate | Not mapped | Not mapped | Not mapped |
| Groups / participants | Rejected | Rejected | Rejected | Rejected |
| Standard part-zero reactions | Six-type dispatch acknowledgement; LIKE add/remove physically checked on R8 | Official SDK has no method; explicit HTTP factory supports six standard received-iMessage reactions; requires matching FT-INSTALL-099 and migration026; historical records without protected proof fail closed; one LIKE ADD observed in both M4D accounts through verified native snapshot/export reingestion | Rejected | Rejected: applied-result contract not established |
| Replies / edit / unsend | Rejected | Rejected | Rejected | Rejected |
| Assigned sender numbers | Deprecated `phonenumbers.list`: actual assigned `id`/`number`; modern reputation endpoint rejected | Not mapped | Not mapped | `getChannel` and unfiltered `listChannels`: actual assigned UUID/phone identity only |
| Contacts / sender provisioning | Rejected | Rejected | Rejected | Owned DM contact `id`/nullable `name` getter only; provisioning rejected |
| Webhooks / signature / replay / ordering | Inherited Standard Webhooks verifier tested on exact raw bytes; registration/payload mapping unsupported; consumer dedup required | Explicit Chert inbound plaintext unwrap; consumer dedup required | Not implemented | GET/PATCH/DELETE for existing qualified Chert subscriptions only; no creation/listing/rotation/replay or all-event claim |
| SMS/RCS/WhatsApp/business messaging APIs | Outside scope | Outside scope | Outside scope | Outside scope |

The current bounded strict plaintext device gate has passed for all five callers:
genuine Linq 0.78, Sendblue 3.20 and legacy Blooio 0.0.2 SDKs, and the V4/LoopMessage
HTTP adapters. Actual authentication, disposable PostgreSQL reservation, frozen
fingerprints, queued receipts and one native effect per fresh plan were checked;
exact GUID/iMessage observations matched both accounts. V4's final result is a
separate read-only reconciliation preserving its original spent receipt.
[Receipt identities and acceptance limits](https://github.com/cherthq/sdk/blob/main/docs/DEVICE_ACCEPTANCE.md#five-provider-strict-plaintext-checkpoint--2026-10-18)
remain authoritative. This does not promote media, read transitions, webhooks,
OS-level SMS-downgrade prevention or unsupported methods to accepted parity.
Earlier platform verification before the October19 media extension: 594 tests / 0 failures / 5,531 assertions / 94 files (including keyed V4 direct plaintext replay, strict text/media history, Sendblue3.20.1 mapping, and the source-bound R10 local relay); typecheck passes. Local verification does not establish physical acceptance. FT099 R2 is separately installed on M4D with receiving-context wire emission off; one received-message LIKE ADD is separately observed in both M4D account databases through verified native snapshot/export reingestion. Original live webhook transport and UI application remain unverified.
Caption-plus-image v2 delivered on M4D with matching image pixels, but the
recipient changed edge ASCII spaces to NBSP and CRLF to two LF. Exact caption
fidelity remains a failed physical gate; this is not full Sendblue parity.

“Rejected” is a compatibility gap, not an implemented feature. The inherited
upstream resource objects still expose methods; their existence does not imply
these adapters support them. Transport fallback policy is separate from network
API coverage; no adapter may invent proof that an accepted message was iMessage,
delivered or read.

## Generic language-client boundary

Python, Rust and C++ now provide typed strict `send_text` queue acceptance and
raw authenticated JSON transport, alongside the JavaScript core. These are language clients, not additional provider adapters:
they do not add typed resource parity or FaceTime integration to the table above.
Python is synchronous with socket-inactivity timeout (not a wall-clock deadline)
and no in-flight cancellation; its 27 local tests include HTTP and wheel import.
Rust is async with explicit timeout/response limits and cancellation by dropping
the future; 13 local tests cover the transport and strict queue boundary. C++ is synchronous
with installed libcurl/JSON dependencies, timeout/response limits and no cancel API.
Typed sends require exact HTTP202 and the four queued receipt fields, preserve
optional exact caller keys, and reject native GUIDs or invented delivery evidence.
Their individual READMEs give commands and interpreter/platform limitations.
None has been published; these HTTP clients require no changes to installed Mac workers.

The joined loopback fixture passed 17 cases with all four language clients
explicitly configured: actual `/phone-numbers` handler and authentication, with
only database substitution. It covers exact IDs/numbers, missing/invalid auth,
project isolation and database errors. There are no database writes or native
calls. This is a read-only source-contract check, not live authentication,
provider compatibility, cancellation or delivery proof. Ordinary runs without
native-helper configuration do not establish the four-client result.

Separate one-attempt M4D runs verified one fresh send each from Python, Rust and
C++ through the actual `/send` and `sendFollowUp` pipeline. All three had queued
SDK acceptance, exact recipient iMessage GUID matches and later read-only sender
delivery confirmation; all remained unread. Cloud authentication/storage and the
SSH transport boundary were substituted. This does not prove installed native
HTTP status support, typing, read transitions or full provider parity. The
[device evidence](https://github.com/cherthq/sdk/blob/main/docs/DEVICE_ACCEPTANCE.md) preserves each receipt.

The new assigned-number `id` field is a cloud public-contract change;
production deployment remains a separate gate. It does not provision a number or prove native
capability. Modern Linq reputation metadata is absent and must not be fabricated.

Evidence layers:

1. Actual upstream SDK tests: argument/response/error mapping and pre-send rejection.
2. Node/Bun/Deno built-package smoke checks: packaging and synthetic transport.
3. Real Chert route handlers over loopback HTTP: validation, ownership, queue/error
   construction; auth/database/device dispatch initially substituted.
4. Controlled M4D live acceptance: separate explicit run, actual native API and
   receiver-side database observation; no automatic retries or unknown-outcome resend.
5. Production authentication/database/webhook and endurance acceptance: pending.

No row may be promoted to full interoperability based only on layers 1–3.

Capability lookup remains a gap: native address services describe local handle
construction, not recipient availability. The branch public lookup now requires
authentication and an explicit project-owned active sender line; it exposes
these observations as `reachable: unknown`, `capability_verified: false`.
Legacy Blooio phone/email capability calls are tested to reject before dispatch.
Actual IDS capability, freshness and account binding must be established before
mapping that provider operation. This public-route correction is cloud-only; it is not proof of deployment.

The FT-INSTALL-086 native helper source included in the reviewed M4D pair validates the cached
IDS selector ABI and reports non-positive/unsupported results as null, with
unknown freshness and unverified account binding. Offline fake-controller tests
and an arm64e compile establish the guard behavior, not current recipient
registration. No provider capability operation is enabled by that candidate.

## Read-path acceptance limit

Recorded-status tests execute the real tenant-scoped cloud handler and real
native-status reconciliation function with a simulated external native HTTP
response. The M4D installed bridge could not look up the tested native outbox
IDs via its HTTP API, despite matching sent/delivered database evidence.
The branch now adds a separate exact bridge outbox lookup, preserving native
SMS ownership. Its offline tests and read-only M4D probe resolve all four real
test IDs with observed iMessage delivery. The installed native HTTP route has
not been upgraded or accepted. This remains a live status-API compatibility
gate. Branch chat routes now persist returned message
IDs, verified through the real send pipeline with external boundaries substituted;
that correction is not deployed. Branch cloud history now supplies cursor
pagination; it does not supply every provider's required message metadata.

The four live send receipts replace `sendFollowUp` with a reviewed native-API
shim. They verify device delivery from those handler/adapter requests, not the
production cloud database. A separate deterministic fixture now exercises actual
production dispatch construction across all four adapters in bridge and queued
modes. Authenticated staging callbacks and read transitions remain gates.
Separate guarded real-pipeline live tests for all four adapters additionally
retain that production dispatch code and have passed SDK acceptance plus exact
recipient iMessage verification, one fresh message per reviewed plan. The
preceding failed Blooio SDK attempt exposed a now-tested asynchronous
dispatch response; that original message was reconciled and never resent.
Cached sent state is now fallback evidence during outages rather than a reason
to stop polling; fresh exact-ID delivery observations can advance confirmation.

Sendblue's explicit `unwrapChert` helper authenticates an unchanged direct-Mac
Chert webhook before converting the supported inbound plaintext subset. It does
not accept Sendblue signatures, register subscriptions, deliver tenant callbacks,
or provide durable replay/ordering storage. Signed and tampered fixtures pass
the built-package checks in Node, Bun and Deno; live callback acceptance is pending.

The branch backend now forwards owned, existing-chat native plaintext events
through tenant callbacks. A real HMAC-ingest/dispatch/notifier/loopback-receiver
fixture verifies project/line isolation, immutable persisted events and retry
recovery with a substituted database. It preserves native event IDs and requires
consumer deduplication; this is Chert webhook support, not a provider-specific
webhook replacement. Live callback acceptance remains pending. See [route evidence](https://github.com/cherthq/sdk/blob/main/tests/ROUTE_HTTP.md).

Typing tests retain the real Chert HTTP handler and HMAC forwarder, substituting
only external authentication/database/device boundaries. Compatible FT-INSTALL-087 native server/helper installation is required before
cloud typing activation; M4D's existing bridge service has not demonstrated physical typing.
Its controlled stop-only probe returned HTTP 200 with `applied:false`; the
corrected cloud route rejects this no-op rather than claiming success.
Both cloud routes bind an existing project-owned pinned DM. Explicit `/typing`
requires canonical E.164 from/to and typing/stopped state; known-chat typing
accepts only consistent state/boolean on. Native acknowledgement requires exact
from/recipient echoes and strict ok/applied booleans. Sendblue omitted state
defaults to start; explicit start/stop are supported, duration is rejected.
Feature-specific physical acceptance remains pending; current M4D installation
does not itself prove typing.
Group typing is not claimed. Linq's official `chats.markAsRead()` now maps only
an exact-chat, explicit Chert application acknowledgement to its void result.
Real-route tests retain the HMAC forwarder and reject contradictory/native no-op
responses without retry. This acknowledges a command, not a received read receipt.
The branch native candidate replaces the former failed-lookup/empty-chat
conflation and 500-message truncation; installing and physically accepting that
candidate remains a separate gate. Oversized snapshots are explicitly refused
before any IMCore operation instead of marking a prefix. See FT-INSTALL-085.

Recorded cloud history is an evidence-preserving subset, not complete provider
history parity. `ChertRecordedMessage` permits unknown lifecycle/service and null
timestamps, preserving stable stored identity and separate native GUIDs without
trusting legacy delivered flags. Root history accepts limit 1–200 (default 200),
order asc/desc (default desc) and cursor, with `has_more`/nullable `next_cursor`.
Cursor-only continuation inherits order; page limits may vary. Membership/order
is frozen by prefix IDs/creation times, while current fields remain visible and
later appends are excluded. Structural changes return 409; malformed records
refuse the whole snapshot. Cursors are unsigned, not authorization, and each
request reauthorizes its tenant/chat. The whole stored array is loaded and the
selected snapshot sorted. Exact alias retrieval is tenant/
lead/conversation-scoped, rejects ambiguity and exposes `canonical_id` when the
requested alias differs. Blooio v4 `getChatMessage` uses this actual recorded GET
with exact chat membership; v4 recorded listing defaults to 50 and forwards
opaque cursors. Protocol/timestamps are not invented.
Linq recorded list/retrieve supports only records with actual valid `created_at` and
`updated_at`, known lifecycle status and explicit direction; missing metadata
returns 502 for the whole page rather than skipping records. No native installation is required and no protocol/version bump is claimed;
production deployment remains separate.


Sendblue recorded retrieval now preserves explicit received state as RECEIVED.
Outbound read evidence maps to DELIVERED; inbound local read is retrieve-only
RECEIVED, and unknown-direction read omits status. GetStatus uses its narrower
official enum and omits RECEIVED. These distinctions are verified through the
actual authenticated route and built Node/Bun/Deno packages; they do not establish
a new physical read transition. No Mac installation is required.

Linq recorded list/retrieve requires actual creation/update timestamps, known
status and direction; incomplete pages fail 502. Deprecated booleans follow its
status enum, and parts without actual required reaction metadata are omitted.
Official PagePromise/async iteration uses an empty terminal cursor; Chert's
1–200/default-200 descending bounds are not claimed as Linq defaults. The
98-case HTTP fixture includes 605 officially async-iterated Linq rows. Legacy
`updated_at` coverage remains pending across constructors/direct inserts,
read-receipt/manual replacement, SQL tapback RPCs and native writers; candidate migration 22 is prepared but unapplied; legacy backfill was not performed. No Mac installation is required.

Candidate migration `22_convo-message-updated-at.sql` centrally stamps changed/new
message objects on future `convo.messages` writes, only after application. Its
row-level BEFORE trigger runs after the existing guard, uses `clock_timestamp()`,
matches unique stable identities with ordinal fallback, and preserves unchanged
legacy timestamp presence without backfill. Constructors/direct inserts, manual
replacement, read receipts, SQL tapback RPCs and native writers are covered only
when they write this table with the migration applied. Append/tapback RPC return
values remain pre-trigger local JSON: refetch stored history for authoritative
Chert record-write timestamps, which are not native edit/delivery or commit times.
The installed database is unchanged; this source candidate is unapplied and its
disposable-database gate (`scripts/test-history-timestamps.sh`) passed on
PostgreSQL 18.6 with 46 SQL assertions, including observing the second RPC in
`Lock` wait before release. Reapplication, guard ordering, RPC writes, no-op and
timestamp-spoof handling, identity fallback and rollback passed. Active/staging
release verification has not been performed. Status, direction and reaction metadata gaps still prevent full
Linq coverage. No version bump, database application or Mac installation follows
from these checks.

Branch inbound storage now retains complete plaintext multipart content joined
with two newlines, raw mixed/media parts (without fetching URLs), and actual
`native_text`, group flags and participants. Media-only messages retain empty
content and mark an owned lead responded; empty content does not trigger opt-out
or pacing. The history mapper refuses contradictory aliases/native text, rich
parts, groups and invalid evidence for the whole page rather than presenting a
truncated plaintext DM. `received` requires exact `recv:<guid>` plus explicit
inbound role/received status; no service, delivery, read or update-time evidence
is invented. Callbacks remain strictly single-text; media/group SDK support is
not added. The signed inbound HTTP fixture passes 33 scenarios, including actual
authenticated chat history through v4 listing; helper units pass 6 tests/58
assertions and mapper units 9/70. These are local checks, not deployment/live
acceptance. Stored JSON/public-history deployment remains a separate gate. That storage change alone needs no Mac installation; its earlier
EventBuilder adjustment was comment-only. The separate native transport-evidence
fix below requires FT-INSTALL-088 before installed workers receive it.

**Activation prerequisite:** candidate `23_convo-native-guid-dedup.sql` must be
applied explicitly in the intended database before enabling inbound multipart/media
preservation. A real-SQL regression showed the old append RPC merges distinct
media-only messages with empty captions. Candidate 23 protects all three
text/substring echo branches when both native GUIDs are known and differ
(`guid` or legacy `spectrum_message_guid`). Exact-event idempotency and existing
same/missing-GUID echo policy remain; missing-GUID heuristics are still ambiguous.
It explicitly denies anonymous/authenticated execution and permits service-role
execution. The combined PostgreSQL 18.6 disposable gate passes 67 SQL assertions,
including concurrency and both rollbacks. Candidate 23 uses
`WHERE NOT COALESCE((echo criteria), false)` in its general deletion branch to
preserve records when source or incoming timestamp is missing/null; both actual
SQL regressions and the known manual-echo baseline pass. Candidates 22 and 23 remain unapplied to active databases; 22's
timestamp trigger is independent. Roll back cloud media preservation before
restoring the original append RPC from migration 01. Stored records and 22
timestamps survive, but the old deduplication risk returns. No Mac install is
required; this is not deployed media/group SDK support.


Assigned-channel identity and native transport evidence (branch-only): Blooio v4
`getChannel` (`GET /v4/channels/{channel}`) accepts an actual canonical lowercase
Chert line UUID or canonical E.164 phone and returns only `{data:{id,address}}`
from tenant-authenticated `/api/v1/phone-numbers`. Missing assignments return 404;
malformed or duplicate inventory identities reject the whole response. It does not establish channel
availability, online state, delivery capability or provider provisioning. Other
channel operations and full provider parity remain unsupported. The SDK getter
requires no Mac installation.

The separate native event service-evidence candidate preserves only observed,
typed iMessage/SMS service values. Unknown, malformed and RCS values omit both
service and downgrade evidence; absence is unknown, not iMessage or SMS. An
outbound observed SMS value can report downgrade evidence, which is not proof of
delivery. The reviewed M4D pair includes this fix; other Macs require the reviewed
signed server and scoped restart under
[FT-INSTALL-088](https://github.com/cherthq/sdk/blob/main/INTEGRATION.md). Existing runtime behavior must not be inferred from
source tests. The completed old-version CRM comparison is not a paired
deployment, fleet installation or full provider compatibility claim.


The branch cloud chat-create and existing-chat send responses also preserve
unknown transport: absent native metadata no longer defaults to iMessage.
Only explicit native `imessage`/`sms` evidence is retained; bridge-owned outbox
acceptance remains unknown. The actual sending-pipeline HTTP regression covers
both handlers without replacing their send construction. This cloud-only change
needs no Mac installation; deployed cloud behavior remains separate.


### Existing-chat attachment dispatch candidate

The branch existing-chat POST now accepts distinct uploaded attachment IDs for
an owned, project-matching, pinned-line direct phone chat. Attachments precede
one optional final text caption, matching the native wire order. URL refs, Live
Photos, extra media/message attributes, duplicates, groups and other part orders
are refused before device dispatch. Existing attachment ownership checks and
project line selection remain mandatory; bytes are resolved by the native ID
path rather than the removed cloud-buffer bubbler.

Signed native requests reject redirects. Exact per-attachment ID/GUID evidence
is required, plus the queued text ID when a caption exists. Malformed, lost or
partial outcomes are sanitized nonretryable 4103; known explicit predispatch
unsupported-worker errors remain 501. Accepted compound messages remain queued,
with unknown service and no delivery/read evidence. Actual attachment GUIDs and
caption outbox IDs are stored separately: a delivered caption cannot prove that
all attachments arrived. Exact all-part reconciliation and physical attachment
reception remain pending. No provider media adapter is enabled by this backend
candidate alone. This paragraph describes the earlier compound source path;
current single-operation physical evidence below does not establish compound parity.


### Linq attachment metadata and exact uploads (branch candidate)

`attachments.retrieve(actualChertAttachmentId)` now maps complete actual owned
metadata to Linq's required fields and upload-object `pending`/`complete` state.
This does not mean message delivery. The ID is Chert's real 48-hex registration
ID, not a portable vendor ID. Chert GET exposes actual stored `created_at` or
null; the original attachment-table creation migration is unavailable, so the
branch does not assume that every installed schema has this column. Missing or
malformed creation/upload metadata fails the entire SDK read with 502. Database
UTC offsets and microseconds are preserved; no timestamp is backfilled.

The authenticated joined fixture retains the actual GET and official SDK with
only database substitution, including tenant isolation and sanitized database
errors. Built Node/Bun/Deno checks use the published SDK types. This retrieval operation alone does not register or send attachments. The
registration/download candidate below adds those upload primitives. The separate
adapter supports one uploaded attachment in an existing DM; deletion, captions,
voice-note semantics and reaction metadata remain unsupported. No URL is invented.

Whole-blob PUT now requires exactly the registered byte count before storage or
row updates. Short uploads return 422/5002, oversized uploads retain 413/5002,
and empty uploads retain 400; existing chunked exact-size guards are unchanged.
The actual-handler fixture covers nine cases with database/storage substitution.
These are source checks, not physical reception or production storage proof.
Both public changes remain source contracts, not production deployment proof. No Mac
package/configuration change or installation is required.


### Ready-only bridge media candidate — FT-INSTALL-089

The source candidate routes regular attachments and CAF voice notes through an
already-ready bridge only. It does not call `ensureReady`, launch/relaunch
Messages, inject a dylib or retry during that media RPC. Existing startup and
reprobe recovery remain separate; text, reactions, in-process IMCore and
ScriptingBridge paths are unchanged. Missing readiness is `not_started` before
any RPC. After one invocation, missing/malformed/contradictory acknowledgement
is unknown; an existing queue client's known claim disposition is preserved.
Only an actual UUID message GUID establishes dispatch identity, never delivery.

Pure tests and ASan/UBSan pass, and the affected Sender object compiles. A
controlled pre-change reconstruction confirms its 11 warnings are unchanged.
This is uninstalled source under FT-INSTALL-089; affected Macs need a reviewed
signed server and separately authorized idle restart. No helper payload, public
endpoint, configuration or state migration is added. Read-only M4D health is not
physical attachment acceptance. Exact native/cloud ID correlation, recipient
attachment/file verification and all-part delivery reconciliation remain gates.


### Linq registration and stable download capability — branch candidate

Linq `attachments.create({filename,content_type,size_bytes})` now maps the real
registration endpoint, limited to the pinned MIME intersection and 1–100 MiB.
It returns actual Chert IDs, a real stable download route, the separate
15-minute upload deadline, PUT method and configured upload headers. Both URLs
must match the configured Chert origin, API prefix and exact returned ID before
credentials are exposed. The official SDK does not upload automatically: the
caller PUTs the bytes with the returned headers. Forwarded-host/proto headers
cannot redirect the registration URLs. Retrieval validates and returns actual
download URLs when available; legacy unsupported blob locations do not gain a
fabricated working link.

The download URL is a per-object bearer capability: sharing it grants read
access while its current tenant, key, owned row and canonical stored object
remain valid. Purpose-bound HMAC covers tenant and attachment identity; key
rotation, inactive tenant or row deletion revokes access. Registration expiry
controls future uploads, not uploaded-byte retention or download lifetime. No
persistent/ephemeral retention tier or automatic purge is claimed. URLs must be
handled as credentials; application code does not log them.

The binary route rechecks current authorization and storage ownership on every
GET, uses no-store/nosniff/attachment response headers, and exposes no internal
storage paths. Its dedicated storage transport rejects redirects, caps actual
streamed bytes to the declared size/200-MiB maximum, uses one bounded buffer,
and enforces a 15-second fetch/read deadline. Existing storage helpers are
unchanged. Authentication fixtures substitute only DB/storage boundaries; a
separate real loopback storage fixture proves redirect rejection and stream
limits/deadline. None uses production credentials, writes active storage or
sends a message.

This is a new read-authorization/public-contract candidate, not activated.
Staging must verify real proxy origin, private storage permissions, exact bytes,
URL sharing/revocation and upload expiry before any production approval. No Mac package or installation is required.
Provider media-send response metadata, native ID correlation, physical media
reception and all-part delivery evidence are still separate gates.

Sendblue `messages.retrieve(id)` now additionally maps one recorded outbound
attachment to optional `data.media_url`. It validates the actual requested
attachment ID against the authenticated GET's frozen/refreshed metadata and
same-origin one-hour capability. It performs no URL fetch, renewal or send; only
the server may renew a public copy after checking current ownership and metadata.
Expired, conflicting, compound or malformed returned media fails with a sanitized
502. Current-row changes prevent renewal; an unexpired retained snapshot can
still pass SDK structural validation while its URL is independently revoked at
the download endpoint. The SDK does not prove ownership or verify HMAC.
No vendor media-object ID, protocol, sent/read clock or provider CDN permanence
is inferred. Actual loopback GET/auth/renewal tests substitute only the database
and prove zero writes, native calls, download fetches and send effects. SDK media
full send support and provider callbacks remain separate gaps; source/deployment
and physical acceptance limits above still apply.

### Blooio v4 assigned-channel inventory

Unfiltered `GET /v4/channels` now maps the actual authenticated Chert assigned
line inventory to `{data:[{id,address}],has_more:false,next_cursor:null}`. It
returns a terminal page only when the complete inventory fits the documented
default of 50; larger or malformed/duplicate inventories fail instead of being
truncated. Filters, explicit limits and cursors reject before a Chert request.
No channel availability, service, capability or provisioning state is inferred.
The actual-route fixture covers tenant isolation, invalid authentication,
malformed inventory and database failures: 32 cases, 29 HTTP requests, zero
writes or native calls. This adapter-only change needs no Mac installation.

Superseded history limitation: the earlier chat-scoped-only implementation
refused Sendblue account-wide lists. The hosted account-history route now maps
qualified tenant-wide offset history, including strict text/media intents.
Unsupported filters and unqualified legacy inventories still refuse; a phone
number is never treated as a Chert chat ID.

### Strict plaintext source boundary

The direct-chat and existing-chat one-part plaintext source paths now use a
versioned native operation with pre-effect actual sender/account/sole-peer
checks and durable public/native identity reservation. Acceptance is queued;
independent exact-GUID evidence is still required for lifecycle. Missing or old
workers refuse instead of falling back. The separate legacy `/send` path used by
generic language-client tests is unchanged and does not gain
this pre-effect policy. Prior controlled plaintext receipts remain historical;
they do not prove installation of the new operation. See FT-INSTALL-095.


### Legacy Blooio strict recipient-only migration

The legacy SDK now calls the versioned authenticated cloud
`POST /api/v1/text-operations/v1` with `{phone,body,idempotency_key?}`; this is
separate from the internal Mac endpoint's frozen native tuple. All four provider
adapters now select a strict plaintext source path. None falls back to `/send`
when the versioned cloud or native protocol is unavailable. Generic raw `/send`
clients retain their legacy semantics.

The SDK requires actual HTTP 202 and exactly the four queued receipt fields.
Historical key replay returns the same owned public ID independently of current
line health or conversation links. A keyed public ID is derived from a
domain-separated SHA256 of tenant and exact key, truncated to 128 bits; the
existing database primary key atomically fences concurrent strict requests.
Reserved or uncertain attempts never dispatch again. Existing legacy key
collisions refuse; concurrent key reuse across old `/send` and the new protocol
is outside that fence and unsupported. No new schema is introduced.

The real disposable PostgreSQL/PostgREST gate exercises 12 cases, including
primary-key races, two deferred COMMIT faults and lost transport replies.
Its seven native HTTP effects are synthetic; zero device messages are sent.
That historical fixture did not establish installation or physical acceptance.
Current matching M4D installation and bounded plaintext acceptance are recorded
separately under FT-INSTALL-095/097; other fleet/deployment gates remain open.

## LoopMessage Conversation HTTP subset

The private `@cherthq/loopmessage-adapter` supports a send and recorded-status
subset. `POST https://a.loopmessage.com/api/v1/message/send/` requires exact
`{contact,text,channel:"imessage"}`. It uses Chert's recipient-only strict route,
owned line selection and an existing Apple DM. Provider sender IDs, emails,
automatic channels, options, attachments, webhooks and other methods
reject before dispatch. Text is lossless, at most 16KiB and fewer than 10,000
UTF16 code units; no vendor truncation is emulated. Actual strict202 queued
acceptance maps to the endpoint-specific HTTP200 `{message_id,contact,text}`.
The generic example's conflicting `recipient` alias is not emitted. Generic
error100 is supported; billing/lifecycle/retry-advice parity is not claimed.
See the [package contract](https://github.com/cherthq/sdk/blob/main/packages/loopmessage-adapter/README.md).

Twelve focused checks and Node/Bun/Deno built-package smoke checks pass. The
actual-auth/disposable-PostgreSQL fixture now covers three genuine SDKs plus
Blooio v4 and LoopMessage HTTP adapters, with five positive synthetic native requests and two uncertainty
faults. That is not five physical sends. Version 1 retains one legacy Blooio
live plan; version 2 prepares each provider individually. That local fixture
does not establish physical acceptance; the subsequently completed five-caller
device checkpoint is recorded above. Full provider parity is not claimed. No
additional Mac installation is introduced by this adapter; current strict-pair
installation evidence is separate from its broader rollout. Observed iMessage delivery remains distinct from channel
intent and from OS fallback policy.

Exact LoopMessage status GETs use the actual authenticated Chert message read.
Delivery requires affirmative iMessage service and delivered evidence; read alone
and4103 uncertainty remain unknown. Conflicting errors or lifecycle flags refuse
the response. Contact/text are included only when observed; provider error codes
and update clocks are omitted. The actual status fixture covers eight cases with
zero POSTs; built Node/Bun/Deno checks include delivery and contradiction handling.


### Exact plaintext fidelity checkpoint — 2026-10-18

Strict create-chat and existing-chat sends now preserve the original text part's
spaces, CRLF, slash and Unicode through the durable request and fingerprint;
generic multipart flattening keeps its prior behavior. The real PostgreSQL
five-provider fidelity matrix passes. One fresh M4D Sendblue plaintext operation
also passed exact recipient scalar comparison, including the original two ASCII
boundary spaces and CRLF. Its immutable spent receipt is run
`e5d0a306-135b-4489-be19-8d730d1bb559`, SHA256
`9a6252776741243ea601552a033df0125aa26535be4e3d2f9a4d7f7c38235bcb`.
This stronger live check covers that one fresh Sendblue operation, not all five
providers or endurance.

Latest configured SDK verification: **436 passed, 0 failed; 4,318 assertions
across 77 files**, with typecheck passing. Full-suite log:
`/tmp/chert-sdk-reactions-all-r3-final-20261018.log`. The original caption fidelity failure
and its spent receipt remain unchanged; plaintext or reaction success does not
repair it. Current M4D runs the FT-INSTALL-098 unified Messages service under
launchd with the preserved R9 helper, whose no-send reaction target preflight
passed under FT-INSTALL-097. The physical reaction cases below were performed on R8;
R3–R7 account/selection refusals remain historical evidence, not the current gate.
Full provider parity remains incomplete.

### Typed core reaction clients and bounded Linq acceptance

JavaScript/TypeScript `sendReaction` and Python/Rust/C++ `send_reaction` now
support explicit owned chat/message identities and six standard part-zero
reactions. They require exact HTTP202 acknowledgement with only public operation,
chat and message identities/status, return validated typed receipts, and never
infer current application, delivery, native GUIDs or timestamps. UUID chat IDs
alone are lowercased; message IDs retain case. Optional keys use the printable
ASCII HTTP-header subset and no client retries an unknown effect. These client
checks are local; they are not four live reaction acceptances.

The offline real PostgreSQL reaction fixture now covers 36 cases across the four
actual typed clients through authentication, the real nested route and migration25.
Twelve synthetic native POSTs require committed reserved tuples and fingerprints;
eight rows acknowledge and four remain unknown. There are zero implicit message
GETs. Case-preserved encoded aliases, add/remove, authentication failures,
invalid-input zero HTTP, and replay/unknown replay with zero extra native effects
are checked. No native/device response or applied reaction is inferred. See the
[explicit helper variables and offline runner](https://github.com/cherthq/sdk/blob/main/tests/ROUTE_HTTP.md#four-typed-reaction-clients-over-real-postgresql--2026-10-18).

The genuine Linq0.78 adapter separately passed a fresh LIKE add and separately
bound fresh removal through actual authenticated GET/nested POST, disposable
PostgreSQL25, committed reservation before native dispatch, durable actual SDK
`{status:'accepted'}` capture and exact GUID/type/target/iMessage event observation
on both accounts. Runs `9195c2cb-eb8d-4ca3-8857-ff0911a396d9` and
`0e19b2c7-29e9-4bdb-b85f-404110c52560` have receipt SHA256 respectively
`3a0e0d2c1e578b68b835ab614cc68a7b826a35308d83b42751d02071f0cca5ee` and
`caac6e05d376a4b9163297d6767e5f1c8f3bd54508d540b5717202f874f3d13c`.
The original failed/spent remove-love receipt and separate no-send reconciliation
are preserved; no spent operation was resent. See [device evidence](https://github.com/cherthq/sdk/blob/main/docs/DEVICE_ACCEPTANCE.md).
These bounded R8 event checks do not establish current UI state, arbitrary
multipart/custom reactions, all providers, endurance or an OS no-SMS guarantee.

### Reaction contracts checked — 2026-10-18

These contracts are not interchangeable. The installed pinned declarations and
current official references were compared. Linq now has the bounded mapping and
physical evidence above; the other provider reaction gaps below remain.
The durable Chert route returns dispatch identity only. Native ACKs do not prove
recipient application or current reaction state, and this contract inventory does not itself establish live acceptance.

| Provider surface | Exact request and documented result | Remaining boundary |
| --- | --- | --- |
| Linq 0.78 `messages.addReaction(id, body)` | SDK posts `/v3/messages/{id}/reactions`; required `operation:add\|remove`, `type`; optional `part_index` defaults to part 0. Six standard types plus custom emoji/stickers. HTTP200 example uses `status:accepted`; response `message`, `status`, `trace_id` are optional strings. | Six standard part-0 add/remove dispatch acknowledgements are mapped; bounded LIKE physical acceptance is above. Acceptance remains distinct from current application. Custom emoji, sticker placement/removal rules and multipart remain separate. [Official operation](https://docs.linqapp.com/channel/imessage/api/resources/messages/methods/add_reaction/) |
| Sendblue current HTTP; pinned SDK 3.20 has no named reaction resource method | `POST /api/send-reaction`, API-key-id/secret headers; required `from_number`, received primary `message_handle`, `reaction`; optional `part_index` defaults 0. Six names or one emoji; leading `-` removes. HTTP200 returns `status:OK`, a request-sent message, handle and accepted reaction. | Must enforce inbound iMessage, matching sender and primary handle; outbound/SMS/RCS/app-card targets are explicitly rejected. No inferred SDK method or application proof. [Official contract](https://docs.sendblue.com/api-v2/reactions) |
| Legacy Blooio SDK 0.0.2 versus current v2 HTTP | Pinned `Messages` exposes retrieve/cancel/getStatus/send, no reaction method. Current HTTP documents `POST /v2/api/chats/{chatId}/messages/{messageId}/reactions`, signed `+`/`-` reaction and optional direction for relative indices. HTTP200 has optional `success`, `message_id`, unprefixed `reaction`, `action:add\|remove`. | Current HTTP documentation is not a new method in the pinned SDK. Relative/latest indices, address/group resolution and emoji are not covered by the explicit owned Chert target. [Official v2 operation](https://docs.blooio.com/reference/v2/reactions/addReaction) |
| LoopMessage Conversation HTTP | Same `/api/v1/message/send/` endpoint as text, but reaction body requires `contact`, webhook `message_id`, `reaction` (emoji or six names; leading `-` removes), with API-key Authorization. | The dedicated reaction section supplies no response schema/status example; do not borrow the adjacent voice/text response or treat this as a text send. Webhook identity, sender binding and a verified response contract remain necessary. [Official reaction section](https://loopmessage.com/apidocs/send-message/#send-a-reaction) |

Blooio v4 remains separately pinned to OpenAPI SHA256
`069fa87a9702f802607bcf7341df4d6ae237ac52658eece5d4b4e6378ba40f73`:
its reaction POST labels HTTP200 “applied,” with optional `data.message_id`,
`reaction` and integer `at`; no current-reaction-state GET or documented `at`
clock meaning is supplied. Its application claim must not be filled by a dispatch
ACK. [Official v4 operation](https://docs.blooio.com/reference/v4/messages/addReaction)

For any further adapter mapping: test actual upstream method/raw HTTP routing
without an extra send; validate exact inbound/outbound and part/sender ownership;
and prove unknown ACK, cancellation and configured retries cannot create a second
operation. Keep unsupported emoji, sticker, relative-index and response shapes
zero-effect. Native account-binding and controlled event proof are now established
for the scoped Linq cases above; broader applied-state/provider contracts remain open.

### Current M4D service boundary — FT-INSTALL-098

The unified Messages binary is installed under launchd on macOS 26.4; actual
executable/argv/listener/job ownership, owned logs, existing operation ACK and
missing-operation GET checks pass. The R9 helper is reused without restarting
Messages. Configuration, all journals, both accounts and ingress were preserved,
security settings were unchanged, and migration sent no messages. The old
Messages tmux session is absent. Managed restart remains unsupported; this is
not unified FaceTime/media serving or full provider parity. The arm64 server
was built for macOS 15 with static official-source Opus 1.6.1 and identical
public headers; no macOS 15 runtime acceptance is claimed. A fresh genuine
Sendblue SDK plaintext test passed on the installed FT098 service through
actual authenticated Chert HTTP, disposable PostgreSQL reservation, two
fingerprint checks and exactly one native POST. SDK acceptance was queued;
exact GUID sender/recipient iMessage evidence preserved two ASCII boundary
spaces, slash, Unicode and actual CRLF. Run
`c0f60750-501f-4bd2-9458-423c6fb31315`, receipt SHA256
`e614ad3dbc882a1edbbef3d3df19e3c8d5da87c109262b809476fa33f1a90ba5`.
This single distinct message was not retried and does not establish other
provider, media, caption or endurance acceptance.


The later exact Sendblue dependency pin is 3.20.1. Package-local resolution,
109 affected adapter tests, typecheck and built Node/Bun/Deno distribution checks
pass. Upstream now permits an omitted sender for automatic routing; Chert still
requires an explicit tenant-owned sender and tests that omission performs zero
requests. Earlier physical SDK receipts used 3.20.0; this dependency update adds
local verification and does not relabel them as 3.20.1 device tests.


Final Sendblue3.20.1 regression checkpoint:514 SDK tests pass, zero failures,
4826 assertions across82 files, including the actual native webhook relay with
its fresh source-bound R10 descriptor. Original device exports and receipt hashes
remain unchanged. This supersedes the earlier513-test local checkpoint, not the
separate physical verification limits.


Account-wide read checkpoint:540 SDK tests/5000 assertions/86files pass. The new
hosted history route and official Sendblue list method were exercised against
real disposable PostgreSQL/PostgREST with actual tenant authentication and no
native effects. Unhandled media/legacy send rows refuse the whole inventory;
qualified plaintext history is implemented, full media/legacy history parity is
still open. This supersedes the earlier missing-route finding without promoting
local reads to new physical message-delivery proof.


### Blooio v4 keyed supported-path source checkpoint — 2026-10-18

Keys now cover direct explicit-from plaintext, existing-chat plaintext and the
existing single owned PNG/JPEG subset. The adapter binds the original provider
route and canonical sorted-key JSON body hash, including exact text and full
capability URL strings. It calls authenticated read-only Chert
`/idempotency/lookup` before mutable sender routing or media metadata. Historical
ACK replay maps to 200 with the same queued IDs; a fresh receipt maps to 201,
changed context conflicts with 409, and unknown4103 never automatically resends.
Missing legacy context cannot prove a historical provider request and refuses
lookup. After a lookup miss and metadata failure, one extra read-only lookup may
recover a racing acceptance; it cannot dispatch.

Actual-route/disposable PostgreSQL gates establish local request identity,
concurrency and no-repeat behavior. Built Node/Bun/Deno checks cover canonical
UTF-8/URL hashing and lookup-before-media behavior. Fresh controlled M4D tests
now also verify existing-chat text and owned PNG through actual HTTP routes and
disposable PostgreSQL: 201 fresh, 200 replay, 409 changed body, one native send
each. The media run used official isolated Storage and a temporary native HTTP
harness connected to the existing helper. Both account databases contained the
exact text GUID; media decoded pixels matched after Messages re-encoding (file
bytes differed). These are same-Mac controlled-account checks, not independent
phone, upstream vendor, deployed-cloud or endurance acceptance. See the latest
[route evidence](https://github.com/cherthq/sdk/blob/main/tests/ROUTE_HTTP.md). No native protocol, database migration, Mac installation,
upstream expiry semantics or universal provider parity is added. Chert keeps
reservations permanently; official v4 docs do not specify expiry/reuse behavior,
while older v2 guides guarantee replay within 24 hours. Use the matching cloud
lookup/context revision with this SDK feature.

## Current v4 media extension — 2026-10-19 local candidate

The v4 existing-chat image path now accepts a public HTTPS source through the
authenticated Chert attachment importer, in addition to the existing canonical
owned capability. No adapter-side source fetch or automatic send retry is added.
The original provider URL stays in the frozen route/body identity. Historical
replay precedes import; post-import and dispatch-conflict reconciliation use that
same identity. Concurrent fresh imports may leave extra owned uploaded objects;
this does not imply import deduplication or transactional Storage cleanup.

Four adapter integration cases / 19 assertions cover cancellation, original identity,
replay/conflict and concurrent import resolution. A separate HTTPS fixture runs
the actual authentication, import, metadata, lookup and send handlers with a
real HMAC native loopback peer across eight cases, including unknown outcomes.
Database, Storage, downloader and device effects are substituted in that fixture;
it is not a fresh physical-image or joined PostgreSQL/Storage acceptance run.
The prior controlled owned-PNG evidence remains separately scoped. Cloudflare
Workers still refuse external media imports at the server boundary because its
DNS/IP-pinning requirement is unavailable there. No per-Mac update is required.

The official v4 OpenAPI was fetched again successfully on October 19: 198,551
bytes, unchanged SHA-256 `069fa87a9702f802607bcf7341df4d6ae237ac52658eece5d4b4e6378ba40f73`.


## Go and C#/.NET clients — 2026-10-19

Both clients implement authenticated generic JSON transport, strict text queue
acceptance and the six standard part-zero reaction acknowledgements. These are
Chert API clients, not new vendor compatibility wrappers. They add no FaceTime,
media-upload or full-resource parity claims. Go uses only its standard library;
C# targets .NET 8 and uses built-in HttpClient/System.Text.Json without NuGet
runtime dependencies. Both have explicit total deadlines, response bounds and
caller cancellation, and refuse redirects and automatic retries.

Go's actual loopback HTTP suite passes normal tests, the race detector and vet
(94.5% statement coverage). The .NET dependency-free actual HTTP executable passes
19 cases in Debug and Release, and the Release package includes its license and
README. These tests cover exact requests, malformed acknowledgements, lost
replies, pre-effect validation and cancellation; they do not establish device
acceptance. Their READMEs document the public APIs and native check commands.


## MissBlue HTTP subset — 2026-10-19

`@cherthq/missblue-adapter` pins official OpenAPI 1.0.0. It maps plaintext sends,
owned number inventory, recorded outbound message retrieval and owned-chat typing.
Requests with unsupported fields, SMS/RCS options, media, scheduling or provider
administration refuse before dispatch. Accepted text returns pending/queued, not
sent or native service proof. Required provider-native facts are never invented.

The source UUID is resolved to an owned iMessage phone, then passed as explicit
`from` to Chert. This is not an atomic UUID-line binding under concurrent
same-phone reassignment, so the adapter is unsuitable where frozen source-line
UUID identity is required. It is not a full drop-in replacement. See its
[method matrix and contract pin](https://github.com/cherthq/sdk/blob/main/packages/missblue-adapter/README.md).

Fourteen tests (270 assertions) use the actual Chert client; send and typing
include actual loopback HTTP with synthetic backend receipts. Built inventory
and unsupported SMS checks pass under Node, Bun and Deno. A separate 21-case fixture passes actual authenticated
backend routes, reservation and HMAC signing with fake database/native peers.
The separate strict-text gate passes real PostgreSQL-backed normal and
Unicode/whitespace sends plus six refusal cases with zero native dispatch.
Its native peer is synthetic; device acceptance for this adapter remains pending.
BlueBubbles, Photon/Spectrum and other candidates remain research unless an
implemented method is explicitly identified; see [research](https://github.com/cherthq/sdk/blob/main/docs/PROVIDER_RESEARCH.md).


MissBlue uncertainty handling also retains validated actual Chert public IDs in
`X-Chert-Message-Id` / `X-Chert-Chat-Id` headers on an actual502/4103 response.
Missing/invalid IDs or a lost Chert response never produce guessed headers.
Two actual PostgreSQL-backed lost-native-reply/wrong-ACK cases verify one native
request, matching header/ledger/claim IDs, retained unknown state and permanent
restart refusal. These are synthetic native effects, not physical delivery.

## Additional HTTP provider subsets — 2026-10-19

Four private Fetch-replacement adapters were added from the
[2026-10-19 provider inventory](https://github.com/cherthq/sdk/blob/main/docs/PROVIDER_RESEARCH.md#imessage-provider-inventory--2026-10-19).
Each pins official docs (or source, for Jared) retrieved that day. None forwards
the vendor credential, retries, or falls back to SMS/RCS; every operation not
listed as supported or partial rejects before any Chert request. Accepted sends
mean Chert queue acceptance only. Response IDs are actual 32-hex Chert public
IDs, never the vendor's ID format. For an actual Chert 4103 nonretryable 502
with validated IDs, `X-Chert-Message-Id` / `X-Chert-Chat-Id` carry
reconciliation identity.

| Operation | Texting Blue (`texting-blue`) | Contiguity (`contiguity`) | Blue Reacher (`bluereacher`) | Jared (`jared`) |
| --- | --- | --- | --- | --- |
| Base URL | `https://api.texting.blue/v1` | `https://api.contiguity.com/send` | `https://api.bluereacher.com/v1` | Caller-configured loopback (`http://localhost:3005` documented) |
| Explicit-sender text | Supported subset: `POST /messages/send` `{to,from,content}` → 202 queued shape | Partial: `POST /imessage` `{to,from,message}`; `id`/`timestamp` are adapter-local | Partial: `POST /messages` `{to,message,send_mode:'instant',device_id}`; `status:'dispatched'` = queue acceptance | Not mapped |
| Recipient-only text (Chert line policy) | Not mapped (`from` required upstream) | Partial: `from` omitted/`null` | Unsupported (`auto_*` line selection) | Supported subset: `POST /message` phone handle → empty 200 |
| Text limits | ≤5,000 UTF-16 units and ≤16 KiB | ≤16 KiB; markdown-style formatting rejected | ≤16 KiB | ≤16 KiB |
| Media / attachments | Unsupported (`media_url`) | Unsupported (`attachments`) | Unsupported (`media_urls`, voice memos) | Unsupported (local file paths) |
| Effects / formatting | — | Unsupported (`effect`, formatting markup) | Unsupported (`message_effect`) | — |
| SMS/RCS fallback | Not offered upstream | Unsupported (`fallback`, even `null`) | Unsupported: upstream falls back automatically; Chert never does | — |
| Scheduling / pacing | — | Unsupported (`fast_track`) | Unsupported (`drip`, the upstream default) | — |
| Idempotency | Rejected (`Idempotency-Key`) | Rejected | Rejected (`Idempotency-Key`) | Rejected |
| Typing start/stop | Not offered upstream | Supported subset: `POST /imessage/typing` with explicit `from`; `stopped` status inferred | Unsupported (auto-expiring window, `expires_at`) | — |
| Reactions | — | Unsupported (content-matched target) | Unsupported | — |
| Read receipts | — | Unsupported | Unsupported | — |
| Status / history | Unsupported (sender phone, `delivered_at` not Chert facts) | Unsupported | Unsupported (`device_name`, `delivery_channel`) | — |
| Lines / numbers | Unsupported (`label`, `verified`, `device_name`, …) | Unsupported (leases) | Used internally to resolve `device_id`; endpoint unsupported | — |
| Groups | Not offered upstream | Unsupported | Unsupported | Unsupported (group GUID handles) |
| Email / iCloud recipients | — | Unsupported | — | Unsupported |
| Webhooks / signatures | Unsupported | Unsupported | Unsupported | Unsupported |
| Error envelope | Documented `{error:{code,message}}` | Documented `{id,timestamp,api_version,object:'error',data:{error,status}}` | Undocumented upstream; adapter emits `{success:false,error,message}` | Upstream plain text |

Blue Reacher's `device_id` resolution reads owned Chert inventory, then sends
with explicit `from`; like MissBlue this is not an atomic line-identity guard.

Verification: 34 new fixture-based unit tests (Texting Blue 8, Contiguity 11,
Blue Reacher 8, Jared 7) plus Node/Bun/Deno built-package smoke checks. No
provider or device was contacted; there is no route, PostgreSQL or device
acceptance for these adapters. They require no Mac installation change.

Researched without an adapter (reasons in the inventory): MessageBlue
(completed-by-agent send with native GUIDs), Inkbox (identity/router model),
Claw Messenger (WebSocket send), SendiMessage (non-optional SMS fallback, SDK-only
schema), Tuco AI, Zernio, Courio, TextLink/Blububl, Mobile Text Alerts, Beeper
Desktop API, mautrix/beeper bridges, AirMessage, imessage-rs (BlueBubbles
contract), plus BlueBubbles and Photon above.
