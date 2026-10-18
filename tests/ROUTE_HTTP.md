> Current CRM scope: compatibility is compared against the old source baseline
> (`a904a97e465473d6c001c8a3dfc1b503a8a2d602`), per the user's direction.
> Historical paired-CRM release-hold notes below describe earlier gates and do
> not block this local work. No paired deployment or shared migration is claimed.
> See [baseline comparison](../../docs/plans/CHERT_BASELINE_COMPATIBILITY.md).

# Local route integration evidence

## Media reservation fault acceptance — 2026-10-18

The actual existing-chat media route reserves its owned public identity before
dispatch and finalizes with owned JSONB CAS. Unknown outcomes retain that
identity and return nonretryable reconciliation IDs. The generic HTTP fixture
tests lost acknowledgments, failed/missing finalization and GET reconciliation
without replay. Private dispatch markers are scrubbed publicly.

The native PostgREST runner exercises the actual route against disposable
PostgreSQL/PostgREST: seven reservation cases, five simulated native requests,
no database module mocks or live messages. Rejected/missing reservation causes
zero native requests; finalization failure retains intent; concurrent changes
survive; reordered JSONB keys still compare equally. Default: 26 cases / 107
REST requests. Official Storage: 32 cases / 108 REST requests. Their 26 REST
mutation attempts include rejected writes and CAS misses, not 26 commits.
This is not production RLS, native idempotency or physical delivery acceptance.

Primary full SDK gate: 268 tests / 2,246 assertions with actual database and
official Storage enabled. Paired CRM release remains held.

## Qualified received webhook candidate

`bun test tests/versioned-webhook-http.test.ts tests/subscription-wire-http.test.ts`
exercises the actual authenticated subscription, native ingestion, event list,
event detail and replay routes. The versioned fixture uses real loopback HTTP,
native-ingest HMAC, dispatch, journal compare-and-swap, notifier and independent
verification of the exact receiver bytes and Blooio signature. Only database
storage is substituted; no native or external request occurs.

Twenty-nine delivery scenarios verify the snapshot exists before POST, transient
retry preserves delivery UUID/body, duplicate ingestion does not redeliver, and
explicit replay creates a new UUID with the original bytes after source edits.
A failed replay preserves prior delivered status and timestamp.
Public event views exclude the private wire snapshot; foreign, inactive and
filtered targets cannot deliver. Forty-three subscription scenarios exercise
the qualified-version received/sent/delivered/read restriction and malformed request handling.

The qualified tag is `blooio-v4/2026-10-01`, with a nonempty unique subset of
`events: ["message_received", "message_sent", "message_delivered", "read_receipt", "message_failed"]`; evidenced plaintext direct-message
receives and exact-GUID single-send sent/delivery/read confirmations are supported. `POST /api/v1/events/{id}/replay` accepts optional
`{"subscription_id":"<owned UUID>"}`. Empty-body legacy replay remains supported.
The existing JSONB journal persists frozen event and delivery identities before
POST, uses tenant-scoped CAS and permits at-least-once delivery. It is not an
exclusive lease or exactly-once guarantee. Secret/signature values are not
persisted in the journal.

This does not implement Blooio's complete all-event registration contract;
the vendor adapter's registration method remains unsupported. Shared PostgREST
CAS, real receiver acceptance, rich messages and production activation remain
unverified under the paired CRM release hold. No Mac installation is required
for this cloud-only candidate.

The signed native delivery fixture retains actual receipt milliseconds in the
canonical Chert payload and maps only documented v4 lifecycle fields. Legacy
acknowledgements produce no provider delivery. A confirmed event arriving before
the send ledger or complete GUID metadata returns retryable 500 without an event
or dedup marker; retrying the same identity after persistence delivers once.
Proven compound sends remain observations. The send ledger remains unchanged;
this check proves callback qualification, not status-getter or physical delivery.

## Owned reaction route candidate

`bun test tests/reaction-http.test.ts` covers 34 actual HTTP cases, including
tenant/project/line ownership, compound or changed-recipient rejection,
removal, native request HMAC and exact acknowledgement validation. Twelve
native responses are substituted; there are no database writes or device
requests. Acknowledged means the native operation acknowledged the request,
not that the peer received or displayed it. Provider reaction adapters remain
unsupported pending their complete contracts and physical validation.

Run from `sdk/`: `bun test tests/route-http.test.ts`.

The isolated fixture starts a real loopback HTTP server and calls the actual
imported `POST` handlers in `imessage-server/app/api/v1/chats/route.ts`,
`chats/[id]/messages/route.ts`, and `send/route.ts`. Responses are generated by
those handlers, not by a server that imitates their contracts. It exercises the
real validation, phone normalization, lead resolution, tenant/project sender
selection, response construction and terminal-delivery error classification.
Official Sendblue, Linq and Blooio SDK classes enter through their Chert adapters.

Only authentication identity, database storage and external device dispatch are
substituted. The fake database applies the equality filters used by the tested
routes; the fixture includes a sender owned by another project to verify rejection
before dispatch. A queued device result remains queued; sent is distinct from
delivered. An uncertain dispatch result preserves normalized error code 4103 and produces
an error with one HTTP request
and one dispatch attempt, without an automatic retry.

The test uses the existing control-plane installation's actual NextRequest and
NextResponse classes, resolving dependencies through NODE_PATH. It does not
install a duplicate iMessage web dependency tree. This verifies the source route
logic under that local Next platform; it is not production Next-version,
authentication, database, device delivery, remote deployment or SDK-publishing
acceptance. Only synthetic identities and content are used, and no real send or
remote database access occurs. The fixture disables Bun automatic installs and rejects every non-loopback fetch.
Subprocess isolation keeps module mocks out of ordinary SDK tests; a timeout terminates a stuck fixture.

## Separately reviewed M4D live harness

`sdk/scripts/m4d-live-acceptance.mjs` is an opt-in development acceptance tool.
After reviewing the concrete script, the primary agent can explicitly run:

```sh
bun --no-install sdk/scripts/m4d-live-acceptance.mjs --live
```

It targets only `chert-m4d`, the approved sender installation/port 4010, and the
configured secondary account. Phone-only metadata seeds the local fixture;
API credentials stay on M4D and are read/used there through noninteractive SSH
and sudo. It checks sender health, bridge mode, and running/configured identity
before sending. It attempts at most one synthetic text through each existing
Sendblue, Linq and Blooio adapter (three total), traversing the actual local
cloud-route handlers. Each native POST carries `native_sms_disabled: true` and
a unique marker/idempotency key. An attempt is spent before SSH starts; a lost
response never authorizes retransmission. Any uncertain SDK outcome stops later
sends. The native response's actual status and outbox ID are retained; missing
service/delivery evidence is not invented.

A separate read-only recipient Messages database query waits up to 45 seconds
for the attempted markers, checking inbound direction, iMessage service and the
configured sender handle. This recipient evidence is distinct from the SDK's
queued response. Passing requires all three SDK responses and all three matching
inbound iMessage records. The flag requests no SMS fallback; this harness alone
does not prove that an older installed native revision honors that flag.

The production authentication and cloud database remain fixture substitutions;
this is not a deployed production API test. Ordinary route tests explicitly
clear the live configuration and omit the live-fixture argument. Importing the
harness does not run its main entry or open SSH. Local harness tests validate
configuration/marker guards without accessing M4D or sending anything.


For a separately reviewed v4-only acceptance, use:

```sh
bun --no-install sdk/scripts/m4d-live-acceptance.mjs --live-v4
```

This selects the fixed `blooio-v4` plan and attempts exactly one new synthetic
text through `createBlooioV4Fetch` and the actual `/chats` handler. It does not
rerun the original three-adapter plan. Marker guards reject those adapter names
under v4-only approval. The same remote-account preflight, no-retry and recipient
read-only evidence rules apply; passing requires that one matching inbound
iMessage record. The harness does not yet implement sender-status reconciliation;
native delivery/read flags remain distinct from recipient database evidence.

## Recorded message status integration

The deterministic fixture also imports the actual cloud `GET /api/v1/messages/[id]`
handler. Legacy Blooio getStatus/retrieve look up the ID produced by the earlier
real `/send` route. Actual `readNativeSendStatus` and `resolvedNativePayload` run;
only their external native HTTP response is substituted. Cases cover pending,
sent, delivered, failed, and native 404/unavailable (which remains queued), then
cached terminal observations. Retrieval omits unavailable sent-time/direction
fields. A foreign tenant's event returns 404 before a native request; polling
never increments the send-dispatch count.

This is source integration coverage. The separately exercised installed 1.9
native sender returned 404 for its message-ID status API, so its compatibility
with the new cloud status path has not been established. Separate recipient or
sender Messages-database delivery observations do not establish that API
compatibility. No remote listener, native installation, or production data is
changed by these deterministic tests.

The send-side substitution is the complete `sendFollowUp` function, not merely
its network call. Therefore that fixture does not establish its internal line
re-resolution, bubbler protocol, conversation writes or delivery metadata
construction. The opt-in M4D shim uses native `/api/v1/send`, whereas the actual
production bubbler uses legacy `/send`. Separate production-dispatch fixtures
are needed before calling the entire production path end-to-end verified.

## Actual send-pipeline coverage and strict regression predicates

`pipeline-http.fixture.mjs` is separate from the live harness and cannot enable
live sending. It retains the real `sendFollowUp`, `sendMessageAsBubbles`,
`sendViaMiniServer`, `nativeSendMetadata`, and `appendConvoMessage`. Only auth,
database methods/RPC and the external native HTTP boundary are substituted.
The RPC mock records the actual application's append request; it does not replace
the application append logic. Twelve cases cover the three vendor SDK adapters and the Blooio v4 HTTP adapter
against bridge-style confirmed-send, native-owned pending and non-native bridge
pending responses.

The real transport sends `/send` with `{to, message, idempotency_key}`; this differs
from the explicitly reviewed live harness's direct native `/api/v1/send` call.
The test checks one native request per logical single-bubble send, native-owned
queue identity preservation, actual conversation appends, and recorded-ID lookup.
These source paths currently do not force `native_sms_disabled` on ordinary text.

Two stronger acceptance predicates are executable. Durability is now repaired
and enforced by the ordinary pipeline test; the separately repaired delivery
predicate is also required by that test:

```sh
# From sdk/, with the existing control-plane dependency directory available:
NODE_PATH=../control-plane/node_modules bun --no-install tests/pipeline-http.fixture.mjs --require-durable-ids
NODE_PATH=../control-plane/node_modules bun --no-install tests/pipeline-http.fixture.mjs --require-observed-delivery
```

The initial strict run showed bridge Sendblue/Linq chat routes returning IDs
that were not persisted and subsequently returned 404. Both chat routes now
record every successful public message ID, matching the existing `/send` route.
The ordinary pipeline test requires the durability predicate across all cases.
Record failures after native acceptance return HTTP 500 with `retryable:false`,
and the adapters do not retry the native send.
Native-owned queued sends preserve their outbox metadata and are retrievable.
Bridge GUID correlation remains unverified. The initial stronger fixture also
found `isDelivered:false` turning into conversation `delivered:true`. A separate
source repair now preserves observed delivery conservatively; ordinary pipeline
tests run both strict predicates and require false to remain false. The v4 cases
also verify a tenant-owned status lookup and reject a mismatched chat without
returning message data or dispatching another send.
Both strict predicates now pass in the ordinary pipeline test. This establishes
source behavior with substituted external boundaries; production cloud database,
authentication and device transport acceptance remain separate gates.


Durability repair sync checklist: public API durability behavior changes, even
though request/response shapes, native wire format and shared table/column
definitions are unchanged. That behavior is a shared contract under the imported
sync playbook. The patch remains branch-only and is release-blocked pending
sibling `chert-crm` parity; that checkout is not present here. No arbitrary version
bump or paired-release claim was made. This cloud-route change requires no
per-Mac installation.

## Exact bridge pending timeout regression

The opt-in strict predicate `--require-bridge-queue` adds four SDK cases using the
exact legacy `/send` timeout response: HTTP 202, `fallback_owner:"none"`,
`status:"pending"`, `success:true`, `queued:true`, a `msg_…` outbox ID,
`delivered:false`, and `delivery:{isSent:false,isDelivered:false,error:0}`.
It requires queued acceptance, durable queued lookup, no confirmed conversation
append, and no forged native-SMS ownership (`mac_native_outbox_ids` must remain
absent). The native status stub returns 404 for that bridge outbox identity,
matching the known installed API boundary; missing status evidence must retain
queued state.

The first strict run failed: the real mini-server bubble check rejects this
accepted pending response as `Delivery failed on last bubble (error=0)`.
Chat routes return 502 without persisting an accepted ID; the legacy `/send`
route returns 400 and records failed. This is a distinct backend repair from
native-owned queue handling. The original eight successful bridge/native-owned
cases remain enabled and unchanged. These new pending acceptance assertions are
not weakened into an expectation that rejection is correct.

The same actual-route fixture now covers Sendblue getStatus/retrieve and Blooio
v4 chat-message status as well. Sendblue retains confirmed delivered evidence,
returns only observed number/identity fields and omits missing sender/timestamps;
foreign IDs return 404 before a native query. V4 returns the matching chat's queued
status and rejects a mismatched chat without returning data or dispatching a send.
These additional reads share the same mocked external-status transport boundary.


After the separate bridge-queue backend repair, the exact-wire predicate passes
and is required automatically by `pipeline-http.test.ts` alongside durability
and observed delivery. The original twelve successful cases remain readable. Non-native
bridge pending identities are recorded separately in `mac_bridge_outbox_ids`;
they never acquire `mac_native_outbox_ids` ownership. A native-status 404 retains
queued state, and no confirmed conversation message is appended before send
confirmation. The test additionally covers two accepted-send/record-write
failures, each non-retryable with exactly one native POST. This is verified local
source behavior, not a release or installed-native compatibility claim.

## Group acceptance and delivery regression

`bun test tests/group-route-http.test.ts` runs the isolated group fixture
in the ordinary SDK suite. It calls the actual group `POST /api/v1/chats`
and recorded-message `GET /api/v1/messages/{id}` handlers over loopback HTTP,
using the existing real Next request/response classes. Authentication, database
storage and external native dispatch are substituted; non-loopback fetches are
rejected and automatic package installation is disabled.

The native group-creation contract reports chat creation, an optional initial
message GUID and an optional initial-message error; it supplies no send/delivery
receipt or observed service. Both GUID-only and no-GUID acceptance therefore
remain queued. Conversation delivery stays false, delivery/read timestamps stay
null, and returned chat/message service stays unknown. An explicit initial-send
error becomes failed. Public message IDs come from persisted send events; a
record-write failure after acceptance returns non-retryable HTTP 500 without an
invented fallback ID. Tenant and sender-line bindings remain enforced.

The six regression cases cover these outcomes plus queued recorded reads and
unassigned-sender rejection before device dispatch. Four mocked dispatches and
eight loopback requests are asserted; no live message or remote data mutation
occurs. This is source-level fixture evidence, not native group/device acceptance.

This public behavior correction remains branch-only and release-blocked pending
paired `chert-crm` compatibility review under `versioning/SYNC_PLAYBOOK.md`;
the sibling checkout is absent. No paired release/version bump is claimed.
These cloud-route and test changes require no per-Mac installation.

## Legacy dispatched response without queue markers

The independent `--require-bridge-dispatched-pending` predicate adds all four
adapters with the actual legacy response structure: HTTP 200, `success:true`, a
valid `msg_…` ID and UUID `guid`, `delivered:false`, and
`delivery:{isSent:false,isDelivered:false,error:0}`. `queued`, `status`, and
`fallback_owner` are absent. IDs in this deterministic fixture are synthetic.
The real SDK, route, sendFollowUp, bubble dispatch and metadata code still run;
only external auth/database/device HTTP are substituted.

The initial run reproduced the observed source bug: all four SDKs received 502,
three chat sends had no accepted event, and `/send` recorded failed despite the
native acknowledgement. The strict predicate requires queued SDK acceptance,
a durable queued GET, separate bridge identities, no native-SMS ownership and
no confirmed conversation append. A native GET 404 must preserve queued state.
No real message is resent by this test.

After the shared pending-classification repair, the strict dispatched-response
predicate passes and is required automatically by `pipeline-http.test.ts`.
The combined fixture now has sixteen successful cases, eighteen native POSTs
(including two deliberate accepted-send/record failures), and six conversation
RPC appends. All sixteen IDs remain readable; both bridge-pending variants stay
queued, keep only bridge ownership and append no confirmed conversation message.
This is deterministic source evidence, not deployment or full provider parity.

## Typing requires native application confirmation

`control-http.test.ts` retains the actual known-chat handler and HMAC forwarder
for Linq and Blooio v4; auth/database/external native HTTP are substituted.
`direct-typing-http.test.ts` retains actual tenant authentication, both typing
handlers and HMAC transport with isolated database/device substitutes. Its
original 55-case scope now has 59 cases after sender-echo, unknown-outcome
and redirect regressions. The focused test passes; this is not a full-suite count or live proof.
It covers Sendblue official omitted-state default start and explicit start/stop,
strict explicit canonical from/to/state, consistent known-chat state/on,
project/pinned-line identity, canonical stored recipient overrides, ambiguity,
group refusal, routing changes and zero database writes.

Native success requires strict ok/applied booleans and exact sender/recipient
echoes. Missing from, no-op or contradictory evidence fails without retry;
HTTP 502/applied-null cannot establish no effect. No recipient-visible indicator
or duration is proven. FT-INSTALL-087 compatible native server/helper installation
must precede cloud activation; installation and physical acceptance remain pending.
Paired `chert-crm` parity remains a release hold.

The signed forwarder and mini-server mutation transport refuse redirects rather
than re-POSTing. `mutation-redirect.test.ts` verifies four initial requests and
zero redirect-sink requests; the joined direct-typing fixture also verifies one
307 attempt with zero sink requests. Plaintext phone/email response uncertainty
remains nonretryable code 4103 without invented native ownership. These are local
HTTP boundary tests, not live messaging or typing actions.

## Tenant-owned inbound plaintext callbacks

`bun test tests/inbound-webhook-http.test.ts` exercises the actual native-HMAC
HTTP ingest handler, dispatcher, conversation append helper, subscription fanout
and raw-body HMAC notifier against a real loopback receiver. The receiver uses
`unwrapChert` with the subscription secret. Database storage and unrelated
opt-out/pacing/SMS integrations are substituted; all network requests are
restricted to loopback and no live message is sent.

Receiving-line project ownership now scopes inbound lead resolution. Ambiguous
leads and conflicting tenant/project/line pins fail closed. Existing CRM leads
without a messaging tenant retain their project-scoped reply flow; inactive
tenants stop callbacks while retaining owned CRM replies. Callback support is
limited to native `message_received`, exact `recv:<guid>` identity, one
unmodified plaintext part, an E.164 peer and direct-chat metadata. Unknown peers
are not auto-created. Groups, media, other event types and provider-specific
webhook formats are outside this tested subset. Unknown service and occurrence
timestamps are omitted. The notifier's envelope timestamp is delivery time.

Each callback event is persisted before delivery. Persistence/subscription-query
failures and unsuccessful callback delivery propagate to ingest as HTTP 500,
so native retries reuse the stable event ID. A changed payload or lead identity
cannot reuse a persisted event ID. A retry can deliver the same event again;
receivers must durably deduplicate it. The existing subscription/legacy circuit
breakers remain: repeated failures can deactivate subscriptions or the tenant.
Automatic delivery then stops; retained events require explicit replay or
operational recovery. No background delivery queue or exactly-once guarantee
is introduced. Inbound dispatch dedup keys include the receiving line, while
public callback IDs retain the original native event ID.

The fixture covers 33 scenarios, including identical event IDs on two authenticated
lines/projects, cross-project and ambiguous ownership, malformed DM metadata,
unknown peers, tampering, CRM preservation, immutable persisted payloads and
persistence/callback retry, including a first inbound that creates its
conversation. Conflicting CRM identity hints cannot override the actual native
peer, text or callback chat. This changes shared public behavior and remains
branch-only pending paired `chert-crm` review under the imported sync playbook.
Its sibling checkout is absent; no paired release or version bump is claimed.
Cloud-only: no per-Mac installation is required. Production authentication,
database, callback reachability and deployed inbound acceptance remain separate
gates.

## Mark-as-read command acknowledgement

`mark-read-http.test.ts` runs 31 cases through the actual Chert handler and
HMAC forwarder, including official Linq `chats.markAsRead()` calls. Database and
native device responses are substituted. It verifies tenant/project/line pins,
canonical DM/group target identity, strict native `ok`, count and known selector
acknowledgements, explicit unsupported mode, malformed/no-op responses and an
uncertain transport without automatic retry. Only a verified acknowledgement
produces `{chat_id, applied: true}`; the SDK maps that to its official void
result. No received read timestamp or read receipt is invented.

The paired native candidate fails closed on unread lookup errors and refuses
more than 10,000 unread messages before invoking IMCore. Those native changes
need FT-INSTALL-085 installation and physical acceptance separately. This local
fixture made zero live read changes and does not establish native selector
application or remote read receipts. Shared API changes remain branch-only
pending paired CRM review.

## Tenant-safe address observations

`address-lookup-http.test.ts` runs 30 cases through the actual public GET/POST
handlers and authentication code. Only database rows and a loopback native
device are substituted. It checks Bearer and inbound HMAC authentication,
active project-owned explicit line selection, exact raw POST forwarding with
independent HMAC/Bearer secrets, identity/provenance validation, malformed and
ambiguous inputs, batch limits, sanitized failures and redirect refusal.
Public results always report unknown capability for local handle probes.
These tests perform zero live probes and do not establish IDS capability.
Legacy Blooio phone/email capability methods remain rejected before dispatch;
the separate authenticated admin diagnostic proxy is preserved. This cloud-only
repair needs no per-Mac install and remains under the paired CRM release hold.


## Assigned numbers and language transports

`assigned-numbers-http.test.ts` runs 12 cases through actual GET `/phone-numbers`
and Bearer/HMAC authentication, substituting only database storage. It verifies
actual IDs/numbers, project isolation, empty inventory, malformed/duplicate
identity rejection, sanitized database errors, and deprecated official Linq
`phonenumbers.list()`. Modern `phoneNumbers.list()` stays unsupported before
network access because required reputation is unavailable. No capabilities are
invented; the adapter omits optional configuration-derived capability hints.

`language-http.test.ts` additionally runs real JavaScript, Python, Rust and C++
clients against that actual route/authentication boundary. The all-four gate
passes 17 cases: missing authentication plus success, wrong-key 401, cross-project
isolation and sanitized database 500 for each client. Only the database is
substituted; all networking is loopback, with zero writes or native/device calls.
Missing native helper environment variables are explicitly reported as skipped,
so ordinary Bun tests do not require Rust/C++ builds. The full local gate is:

```sh
CHERT_TEST_CPP_CLIENT=/tmp/chert-cpp-sdk-20261017/chert-sdk-route-fixture \
CHERT_TEST_RUST_CLIENT="$PWD/sdk/rust/target/debug/examples/route_fixture" \
bun test sdk/tests/language-http.test.ts
```

Build the test-only helpers first; these paths are local verification artifacts,
not installed services. This proves transport-to-route compatibility, not cloud
deployment, provider parity, device acceptance or live sending. The additive
public inventory behavior remains branch-only pending paired CRM release review;
no Mac installation is required.

## Recorded history and exact alias retrieval

`history-retrieve-http.test.ts` retains actual tenant authentication, cloud
history/single-message handlers and the Linq, Blooio v4 and Sendblue adapters. Its 98 cases use an
isolated database boundary with zero writes or device requests. Coverage includes
ID/GUID/legacy GUID aliases, requested ID plus canonical identity, exact chat
membership, metadata keyset pagination, scoped conversation queries, tenant and
lead/conversation mismatch, ambiguity, malformed/unsupported records and stored
outbound text. Missing or unrecognized send-event statuses remain unknown rather
than becoming failures; the v4 adapter omits those unknown statuses. The
focused mapper suite separately has seven tests and 56 assertions for stable IDs,
text-part consistency, timestamps and refusal to invent lifecycle/transport from
legacy flags. These are scoped offline counts, not production acceptance.

Chat history accepts limit 1–200 (default 200), order asc/desc (default desc)
and cursor, returning `has_more` and nullable `next_cursor`. Cursor-only requests
inherit order and limits may vary. The membership snapshot hashes raw-prefix
IDs/creation times: later appends are excluded, current content/status/receipts
remain visible, and structural changes return 409. Malformed/duplicate IDs,
missing creation times and unsupported records refuse the entire snapshot.
Cursors are unsigned state, not authorization. The handler still loads and sorts
the stored array. Six focused pagination tests cover 405 records, varied page
sizes, ties, mutable fields, structural invalidation and cursor/query rejection.
The actual HTTP fixture additionally walks 606 records through the v4 adapter
(default list limit 50) without omissions/duplicates and verifies tenant/chat
binding, appends and malformed queries. The SDK suite passes 202 tests / 1,676
assertions; these remain local checks, not deployment or load acceptance. Single-message lookup pages tenant lead metadata in batches of 100 under
a 10-second deadline, then filters exact linked conversation JSON aliases; no
all-tenant content scan is used. `ChertRecordedMessage` keeps absent evidence
unknown/null. Blooio v4 recorded retrieval omits unavailable metadata; Linq supports metadata-complete recorded list/retrieve only; incomplete metadata returns 502 for the whole page. This cloud-only branch contract requires paired CRM
review before release, no Mac installation and no protocol/version bump.

The follow-up chat POST now persists its validated request message in the
send-event payload. Outbound recorded GET exposes `direction: outbound` and
text only from an actual stored body or an all-text parts sequence joined with
`\n\n`; mixed rich parts omit flat text. Stored acceptance is not recipient
delivery proof. Tenant metadata paging can approach the 10-second deadline for
large owned-lead sets; a joined database lookup and actual load validation remain
future gates. No performance or endurance claim is made by these fixtures.


The recorded-read fixture also exercises the official Sendblue client through
actual authentication and single-message GET. Explicit outbound read evidence
maps to DELIVERED; inbound local read maps to retrieve-only RECEIVED, while
unknown direction leaves read status absent. GetStatus omits RECEIVED because its
separate official response enum excludes it. Missing/unknown lifecycle remains
absent and no sent/update timestamps are fabricated. The built-package checks
exercise these distinctions in Node, Bun and Deno. This is read mapping of stored
evidence, not new physical read-receipt acceptance or a deployed API change.

Linq history requires actual valid `created_at`/`updated_at`, known status and
explicit direction. Its deprecated delivery/read booleans follow the documented
status enum; they add no receipt evidence. Optional parts are omitted when their
mandatory reaction metadata is absent, without fabricating `reactions: null`.
The official SDK returns a bare Message for retrieve and preserves PagePromise/
async iteration for listing, translating terminal cursors to `''`. Chert bounds
are limit 1–200/default 200, descending by default; these are not claimed as
official Linq defaults. The actual HTTP fixture covers 98 cases, including 605
rows consumed through official Linq async iteration. Legacy coverage remains
pending: new constructors/direct inserts, read-receipt/manual replacements, SQL
tapback RPCs and native writers do not yet provide complete authoritative
per-message `updated_at`. Candidate migration 22 is prepared but unapplied; legacy backfill was not performed. This remains branch-only under paired CRM release hold, with no
Mac installation required.

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
Linq coverage. Paired CRM release hold remains, without a version bump or Mac
installation requirement.

The migration gate used the cached pinned PostgreSQL 18.6 container and applied
the candidate only to disposable databases. A local replace-RPC measurement
changing one record yielded three-sample medians of 0.826 ms / 6.124 ms /
54.078 ms for 100 / 1,000 / 10,000 records. This is a scoped local measurement,
not production performance or load/endurance acceptance.

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
acceptance. Stored JSON/public-history behavior requires paired CRM release
review. No native wire or implementation change or Mac installation is needed
(the EventBuilder change is comment-only).

**Activation prerequisite:** candidate `23_convo-native-guid-dedup.sql` must be
applied in the paired CRM release before enabling inbound multipart/media
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

## Existing-chat uploaded media dispatch (branch candidate)

`bun test tests/chat-media-http.test.ts` runs 30 scenarios through actual
chat POST/authentication/attachment ownership/project-line selection/HMAC send
and message retrieval handlers, substituting only database/native HTTP.
The fixture observes 11 device POST attempts, no native status GETs and four
persisted events. It covers ordered two-attachment sends with/without a caption,
exact attachment GUID persistence, auth/project/line/ownership rejection,
unsupported URL/Live Photo/part order, malformed/partial native responses, and
post-acceptance database failure without permitting retry.

Direct native 200 and complete queued-caption 202 are command evidence only.
Public media acceptance stays queued/unknown, without delivery/read times.
Caption outbox IDs are separate from aggregate status IDs; even mixed historical
JSON containing caption IDs and attachment GUIDs cannot promote delivery. The
focused native status test captures that regression. The helper's loopback 307
check proves one initial signed POST and zero redirected sink requests.

Primary verification passed 36 backend tests/252 assertions (attachment helper
and native status), 210 SDK tests/1756 assertions, and a focused TypeScript
compile using the existing control-plane dependency installation. No Mac package
is changed. This candidate remains under paired CRM release hold; no provider
media adapter, production database, physical reception or all-part reconciliation
is established by these local checks.

## Linq attachment metadata and exact whole-blob uploads

`bun test tests/attachment-metadata-http.test.ts` passes 20 scenarios through
actual Linq `attachments.retrieve`, tenant authentication and Chert metadata GET,
with database substitution only: 18 loopback requests, no writes, storage or
native calls. Cases cover pending/complete upload-object state, database UTC
offsets and microseconds, absent legacy creation metadata, malformed required
fields, tenant isolation, strict headers and sanitized lookup errors. Built
Node/Bun/Deno packages exercise the same read contract. This maps actual stored
metadata; it does not independently inspect a legacy blob or prove delivery.

`bun test ../imessage-server/tests/upload-size.test.ts` passes nine actual PUT
handler/authentication cases with substituted database/storage boundaries. Only
the exact-size case reaches storage and row update (one each); short, oversized,
empty, unauthorized, foreign, expired and MIME-mismatched cases have no writes.
The short-upload regression was observed returning 200 before the change.
Chunked upload size checks are unchanged. These checks do not establish active
storage migration, live upload service or physical attachment reception.

Primary verification: 218 SDK tests/1856 assertions, SDK typecheck, focused
imported attachment/media TypeScript compilation, and built Node/Bun/Deno smoke
checks pass. Shared public contracts remain branch-only under paired CRM release
hold. No Mac installation is required by these cloud/SDK changes.

## Linq registration, stable binary download and storage transport

The new `attachment-create-http` fixture passes 11 scenarios through the actual
SDK, registration/auth, binary PUT/auth, metadata retrieval and capability GET.
Only database/storage boundaries are substituted. It verifies short-upload
rejection, exact byte retrieval, independent upload expiration, old-URL key
revocation plus fresh-key URL retrieval, deleted-row revocation and forwarded
host rejection as a URL authority. The Next development URL-normalization flag
is disabled inside the isolated fixture so actual loopback request authority is
preserved. There are no sends, native calls or external requests.

The backend `attachment-download` fixture passes 26 authorization/object/header
scenarios with no writes. Its legacy unbounded storage mock throws: success
requires the new expected-byte storage boundary. A separate
`attachment-storage-http` fixture passes 25 cases against a real loopback HTTP
storage server with synthetic credentials. It observes seven storage requests,
zero redirect-sink requests, overflow cancellation and an actual 15-second
body-read timeout. The final helper allocates one bounded buffer and returns it
only after exact byte completion. Existing storage methods remain unchanged.

Primary checks pass: 225 SDK tests/1932 assertions, 38 focused backend
tests/256 assertions, focused attachment/media TypeScript compilation and built
Node/Bun/Deno package checks. No active database, storage or Mac is changed.
Stable download URLs are new bearer authorization: staging verification and
paired CRM review are required before production approval. No native media-send
or physical attachment reception is established by this local upload flow.

## Disposable PostgreSQL/PostgREST attachment gate

Run `scripts/test-attachment-postgrest.sh` from the repository root. It requires
the two immutable, already-cached images pinned in the script; it never pulls
images or reads project dotenv files. PostgreSQL 18.6 and official MIT-licensed
PostgREST 16.4 run on an internal Docker network with no published ports. A raw
loopback TCP relay reaches PostgREST through the owned database container.
Cleanup removes only the fixture containers, network and private control files.

The primary run on 2026-10-17 passed 19 cases: actual Linq SDK, application
authentication/handlers, Supabase client, JWT-validated PostgREST and SQL, with
zero module mocks. It observed 26 service-role REST requests, eight direct
authorization probes, four writes, three storage
requests and one stored object. Registration, actual SQL creation timestamp,
exact upload/download bytes, tenant isolation, key rotation and tenant
deactivation were exercised. Cleanup left no fixture containers or network.
Both tables denied missing authorization, a valid anonymous-role JWT, a forged
service-role JWT and an expired correctly signed service-role JWT with HTTP 401
and no fixture secrets or attachment metadata. These direct probes exercise
PostgREST verification and database grants, independently of application auth.

Storage remains an in-memory HTTP substitute. The SQL file is an explicit
disposable fixture, not a production migration or proof of the original schema.
There were zero device requests or live messages. Production storage, staging
authorization and paired CRM compatibility remain separate gates; this test
requires no per-Mac installation.

### Real Storage service candidate — blocked before startup

`scripts/test-attachment-postgrest.sh --real-storage` is an opt-in candidate
using official Apache-2.0 Supabase Storage API 1.83.5, pinned to
`sha256:11473750c5a07d82b010f51746c94c902405ce7576cdc74a070983cf19501742`.
It adds a fixed internal Storage relay and Linux tmpfs object backend, disables
tracing/metrics/Logflare, and substitutes neither database nor Storage responses.
The separate local SQL bootstrap disables automatic role installation so the
REST authenticator is not granted database-superuser membership. These are
disposable fixture roles, not production migration or permission guidance.

The candidate adds six private-object checks to the 19-case flow: missing,
anonymous-role, forged and expired authorization, valid service-role exact-byte
retrieval, and denial through a public URL for the private bucket. **The 25-case
real-service mode has not run.** Its pinned image download failed with Docker
`no space left on device`; the Mac reported about 2.5 GiB free. The cache check
fails before creating fixture resources. Existing images, volumes and build
caches were preserved; no global cleanup was attempted.

The ordinary 19-case real PostgreSQL/PostgREST gate was rerun successfully after
adding this optional mode, retaining its explicit in-memory Storage HTTP boundary.
Both modes refuse image pulls during testing and use no project dotenv files,
production credentials, device requests or live messages. Real Storage startup,
upstream migrations, filesystem xattrs and permissions remain unverified until
space is available. No per-Mac installation is required.

The fixture-only SQL bootstrap was separately executed successfully against a
fresh network-disabled PostgreSQL 18 container, including its superuser-membership
rejection assertion. This checks SQL syntax and the fixture role boundary only;
it does not validate Storage's upstream migrations or service behavior.
An additional ordinary-mode isolation probe with inherited
`CHERT_TEST_REAL_STORAGE=1` and a forbidden nonloopback Storage URL was
interrupted before readiness when the pinned local Docker socket disappeared.
It did not pass. Cleanup for that interrupted run is unconfirmed; inspect its
test-owned network/containers after the same local daemon becomes available.
Do not restart Docker, switch daemons or prune unrelated resources to hide this
environment failure. The earlier normal-mode 19-case run remains the completed
receipt; the hostile-environment probe must be rerun separately.

The cleanup trap now retains an owner-only context plus `resources.txt` when
any exact-ID removal fails, prints only owned resource IDs/path, and changes an
otherwise successful exit to failure. An existing nonzero exit is preserved.
`bun test sdk/tests/attachment-cleanup.test.ts` runs the actual cleanup function
with a local Docker-command stub: success removes the private context; simulated
daemon failure preserves all four IDs with mode 0600 and attempts every cleanup.
Five cases/28 assertions also cover context-removal failure and preservation of
the original exit status; receipt creation uses an owner-only umask and cannot
prevent the final diagnostic if writing fails.
These checks need no Docker daemon and do not prove cleanup of the interrupted
real run. No unrelated Docker resources are selected or pruned.

Pinned source: [release](https://github.com/supabase/storage/releases/tag/v1.83.5),
[configuration](https://github.com/supabase/storage/blob/v1.83.5/src/config.ts),
[role bootstrap](https://github.com/supabase/storage/blob/v1.83.5/migrations/tenant/0002-storage-schema.sql).

## Bounded customer callback transport

`bun test imessage-server/tests/webhook-transport.test.ts` exercises the actual
notifier against loopback receivers: a signed 307 must make zero sink requests,
a stalled 400 body must be cancelled without retaining its content, and a
header stall must abort at the fixed 15-second deadline. The redirect regression
failed before the fix because the old notifier followed the redirect and
reported success. The existing 33-scenario inbound HMAC/dispatch fixture still
passes, including persistence, retries and tenant separation. No callback is
registered, no device is contacted and no production receiver is tested.

Primary verification on 2026-10-17: four transport tests/21 assertions and the
33-scenario inbound fixture pass; focused TypeScript compilation and diff checks
pass. The normal SDK command reports 219 passed and six explicitly skipped
native-helper checks across 225 tests; those require their configured Rust/C++
test executables. A follow-up run of `m4d-live-pipeline.test.ts` with both
existing test executables explicitly configured passes all 32 tests/383
assertions, including those six checks, without SSH or live sends. The
documentation gate still fails on the unrelated unindexed
`docs/evidence/incoming-caller-identity/backport/PLAN.md`.

## Blooio v4 owned direct-chat retrieval

`bun test sdk/tests/chat-retrieve-http.test.ts` passes 18 scenarios through
the actual adapter, tenant authentication, chat GET and shared mapper; only
database storage is substituted. Twelve cloud GETs and 21 database reads
exercise actual target overrides/fallbacks, nullable names, tenant isolation,
required tenant headers, sanitized errors, malformed target and group rejection.
Unsupported request overrides and pre-cancellation make zero cloud requests.
There are zero writes, native requests or external requests.

The getter returns the actual Chert lead ID as chat/contact-record identity,
the single canonical phone target and recorded nullable name. It omits provider
channel, protocol, state, timestamps and capabilities. The shared cloud mapper
now matches the sending recipient override and preserves unknown transport;
three deterministic mapper regressions first failed against the old original
number/iMessage defaults. This public-contract candidate remains under paired
CRM release review, requires no Mac installation and proves neither native chat
membership nor provider identifier portability.

Primary checks pass: 225 SDK tests/1,886 assertions with six native-helper
checks explicitly skipped by the ordinary environment; 29 backend tests/150
assertions across the six affected mapper/history/attachment/webhook files; and
built Node/Bun/Deno smoke checks, including the new chat getter in all three.
Focused v4 package checks pass 63 tests/509 assertions. These are local source
and packaging results, not a deployed or physical getChat acceptance receipt.
Focused imported-route TypeScript compilation also passes. With both existing
native test helpers configured, the affected offline pipeline file passes all
32 tests/383 assertions, covering the six ordinary-environment skips without
SSH or live sends. No per-Mac installation is required by these cloud/SDK changes.

## Full-coverage audit: outstanding webhook work

The initial 2026-10-17 producer audit found only two callers of
`deliverMessagingEvent`: supported single-plaintext inbound messages and native
read receipts. At that checkpoint, sent, observed-sent, failed and delivered events updated
`messaging_send_events` without publishing callbacks. Tapbacks update their own
table; contact-share events are logged. The dispatcher dedup table is not the
public event ledger: `/events`, its stream and replay read `messaging_events`.
Receiving an event therefore does not establish public webhook coverage.

Blooio v4 registration remains unsupported. Its current all-events subscription
contract cannot be fulfilled by mapping registration onto the existing inbound
callback subset. Versioned payloads, durable event identity/time, signing,
replay and delivery scheduling must agree before that endpoint is enabled.
The connected Supabase account does not list the documented Chert project;
the missing original subscription migration has not been reconstructed from
another project's schema. No remote schema or data was changed during this audit.

Pre-repair baseline verification: `bun run test` passed 230 tests with six explicit
native-helper skips (1,914 assertions). Rebuilding the existing Rust examples
offline and C++ helpers, then configuring all four helper paths, passes the
language-route and pipeline suites: 33 tests, 385 assertions, no skips. SDK
typechecking and built distribution smoke checks pass on Node, Bun and Deno.
These checks use local fixtures, make no live sends and do not close the
webhook, read-transition or real Storage acceptance gates.

After integrating the receiver/read-receipt repairs, the SDK gate with all four
native helper paths configured passes **238 tests / 2,002 assertions**, with no
skips or failures. The final malformed-envelope guard also passes its focused
24-case HTTP fixture and the imported receiver dependency-closure typecheck.

`inbound-body-http.test.ts` covers 24 authenticated envelope cases through
the actual receiver. Null, primitives, arrays, absent/non-string/empty types or
event IDs, malformed nested message values and invalid JSON return 400 before dispatch storage. Two positive cases retain missing/empty-body-ID header fallback. Its database
substitute permits only signing-line lookup during malformed cases; accepted extension events may write only their two dedup markers. Any other storage access fails the fixture. The null-body case first reproduced HTTP 500. The repaired
receiver and the existing 33-case inbound fixture pass together; no Mac install
is required and no remote receiver, account or message is touched.

`read-receipt-http.test.ts` covers 24 scenarios through actual HMAC verification, dispatch, conversation replacement and callback signing, substituting only database storage. A pre-fix regression demonstrated that a valid line-A signature could mutate a line-B conversation by naming its GUID. The repair resolves ownership before reading message content and requires one explicit outbound match. Tests cover wrong project/pin/conversation owner, ambiguous lead/GUID, inactive tenant, inbound target, malformed timestamps, shared IDs across two projects, legacy GUID aliases, database retry and failed-callback retry. Four owned mutations and seven loopback callbacks occur; there are no device requests or live messages. The receiver dependency-closure TypeScript check passes after replacing a conditional Supabase select expression with the identical full-field literal needed for strict duplicate checks. These remain cloud-only branch candidates under paired CRM review; no per-Mac installation is required.

## Joined outbound observation and send identity

`outbound-webhook-http.test.ts` covers 63 scenarios through actual native HMAC
verification, dispatch, event persistence, notifier and callback HMAC. Only the
database is substituted. Line-scoped exact GUID/outbox queries precede tenant,
project and lead ownership validation. Frozen send-record recipients remain
authoritative after contact edits; conversation-only observations require an
explicit owned outbound match. Unmatched, ambiguous or foreign identities never
mutate another send. Failed callbacks retry without changing the stored source
snapshot, including when the send record's conversation is unknown.

The new Chert `message_outbound_observed` callback retains actual source type,
ID, time, recipient, GUID/outbox identity and numeric error evidence. It omits
inferred sent/delivered/read state. A final failure or opt-in fallback requires
explicit, non-conflicting failure evidence, a complete one-GUID set and exactly
one bubble under the actual sender's `splitBubbles` function. Legacy scalar GUIDs,
outbox-only records, multipart text, malformed aliases and compound media stay
observation-only. The fixture makes four owned ledger updates, 46 loopback
callbacks and two disabled-fallback checks; there are zero device requests,
Twilio requests or live sends. An out-of-range source `ts` still returns 500
before mutation; source clock validation is not a new supported contract.

The existing pipeline fixture now joins all four adapters to that callback path
using the same durable send rows. Actual cloud routes, `sendFollowUp`, native
metadata, inbound HMAC handling and callback signing execute; cloud auth, DB and
device HTTP remain synthetic boundaries. Four unique mixed-case native UUIDs
and actual recipient overrides map to four exact public send IDs. Missing GUID
metadata or wrong peer produces no callback; duplicate ingestion produces no
new native attempt. The full fixture preserves 18 native HTTP substitutes and
six conversation appends across 16 send cases. No external device is contacted.

Internal `mac_message_guids` and the frozen dispatch recipient remain excluded
from public send/status responses and replay. No schema migration, per-Mac
installation, provider registration or activation is included. This repairs the
Chert observation path; Blooio v4's envelope/signature/scheduler and complete
provider event coverage remain separate acceptance gates under paired CRM review.

Final scoped verification on 2026-10-17: the SDK build/test gate with all four
Rust/C++ helper paths configured passes **239 tests / 2,004 assertions**, with
no skips or failures. SDK typechecking and both imported send-route/receiver
dependency-closure checks pass. Native metadata, delivery and inbound-storage
backend checks pass **36 tests / 289 assertions**. The source diff was reviewed
against the recorded imported revision; no installed device or runtime changed.
The repository documentation gate still reports the pre-existing unindexed
`docs/evidence/incoming-caller-identity/backport/PLAN.md`.


## Frozen-ledger read receipts and confirmed status

`bun test tests/ledger-read-receipt-http.test.ts tests/read-receipt-http.test.ts tests/confirmed-status-http.test.ts` exercises actual authenticated handlers.
The new ledger receipt fixture covers 27 signed requests, four owned conversation
rewrites, nine real loopback callback attempts and twelve expected dispatch
failures. It covers contact/override/conversation edits, ledger-only sends,
compound aggregate protection, exact ownership and same-identity retry before
ledger or GUID persistence; focused helper tests also cover unknown framing.
The unchanged legacy fixture retains its
24 scenarios. Only database storage is substituted; no device request occurs.

The status fixture covers 52 cases with no database writes or native requests.
A persisted physical receipt wins independently of pending/failed customer
callback status. V4 HTTP, actual Sendblue and legacy Blooio consumers traverse
the real GET and report delivered. Linq rejects missing required update metadata;
no timestamp, service or read state is fabricated. Compound sends, malformed or
ambiguous evidence and ownership boundaries remain guarded. This is source
acceptance, not deployment or fresh physical receipt proof.


## Native read wire and real send-write clocks

The versioned fixture now covers 29 signed HTTP scenarios; subscription
registration covers 43. Actual native single-send proof reaches `message.read`
with immutable bytes/signatures, while legacy proofless receipts cannot become
provider reads. Fifty-two status cases include real adapter consumers and
separate physical read/delivery clocks, with no native polls or database writes.
These checks retain the explicit all-event and installed-device acceptance gaps.

`bash scripts/test-send-event-timestamps.sh --pg-bin /absolute/postgres/bin`
runs 21 SQL assertions on an explicit private Unix-socket-only PostgreSQL
cluster. It clears inherited connection settings and removes only the stopped
owned cluster on success. Failure retains diagnostics. On 2026-10-18 this passed
with a task-isolated PostgreSQL 18.6 source build, without Docker or a system
service. Migration 24 remains unapplied; legacy clocks stay unknown, no-op/spoof
writes cannot invent clocks, object collisions fail closed and rollback retains
all records/evidence. The fixture is not production schema or PostgREST proof.

The sanitized SQL receipt is
`/tmp/chert-send-event-timestamps-20261018-receipt.json`, SHA-256
`c6b8019052799421180b86ff79aab36667535430db953ce44634f07f78a64c24`.
It binds the tested migration, fixture, runner, engine version and 21 PASS
notices. The PostgreSQL source archive's official SHA-256 was verified before
the isolated build; no new package or system service was installed.


## Confirmed sent-state integration (2026-10-18)

The exact current native `confirmed-sent:<GUID>` source now reaches canonical
`message_sent`, the qualified v4 `message.sent` envelope and recorded-message GET.
An ordinary native acknowledgement cannot qualify. Unknown ledger/GUID framing
returns retryable 500 before persistence/dedup; same-identity repair delivers once.
Twenty-nine webhook scenarios and 43 subscription scenarios pass. The 52-case
status fixture makes 120 proof queries, zero writes and zero native requests;
read and delivered proof take precedence over sent proof. Observation time is
retained as evidence, never presented as `sent_at` or resource `updated_at`.
This remains source-only acceptance under the paired CRM release hold.


## Real PostgreSQL/PostgREST journal gate — 2026-10-18

Explicit existing tools run the production webhook coordinator, journal and
notifier through the actual Supabase client, PostgREST 16.4 and PostgreSQL 18.6.
Thirteen cases pass: private snapshots precede three real signed callback POSTs,
failed delivery retries preserve bytes/UUID, replay changes only delivery UUID,
duplicate logical delivery does not send again, conflicting payload/tenant
requests fail, and competing appends force a real zero-row CAS and retain both
entries. UUID and JSONB operators, anonymous/forged-token rejection and public
journal projection are exercised. There are no database mocks or native actions.

Run with explicit absolute existing paths:

```sh
CHERT_TEST_JOURNAL_PG_BIN=/absolute/postgres/bin \
CHERT_TEST_JOURNAL_POSTGREST=/absolute/postgrest \
bun test sdk/tests/postgrest-journal.test.ts
```

The runner clears inherited connection settings, uses a private Unix-only
cluster and loopback-only HTTP, bounds fixture/cleanup processes and verifies
the exact owned cluster has stopped before removal. Failed contexts remain for
diagnosis. The disposable schema uses known UUID/JSONB types and explicit
fixture constraints; it does not reconstruct the unavailable authoritative
production CREATE, RLS policy or paired CRM compatibility. The only transport
adaptation removes the Supabase gateway `/rest/v1` prefix for standalone
PostgREST; it does not simulate database responses. The default suite skips
this opt-in gate when either explicit tool path is absent.

Root independently reran the gate successfully. Receipt:
`/tmp/chert-postgrest-journal-20261018-receipt.json`, SHA-256
`414d62b604fd366d760a4b47b2ecff266e48b3946caa16c2e1771f0213fea8f9`.
Official release archive SHA-256 was checked before use; installed tools were
not replaced. This closes the local real-service journal gate, not production
activation, full schema/RLS or device callback acceptance.


## GUID-less uncertain outcome source — 2026-10-18

Current `OutboxWorker.finalizeRowIfDeliveryUnknown` finalizes with `guid:nil`.
The qualified 4103 path therefore binds the exact singleton bridge outbox
operation to its frozen public send and one plaintext request; it does not
require or manufacture an Apple GUID. Canonical failure evidence explicitly
rejects `native_guid`. Missing outbox ownership/framing retries before any
event/dedup; known media, captions, compound/native-SMS/multi-outbox sends
stay observations. Only actual native 4103 maps to `delivery_unconfirmed`,
with a static warning against automatic resend. Other codes are not promoted.

Forty actual webhook scenarios and 49 registration scenarios pass. The
qualified profile now permits only the five explicit producers: received,
sent, delivered, read receipt and this uncertain failure subset. This is not
complete provider all-event coverage or fresh installed-device acceptance.


## Completed uncertainty/status-clock source gate — 2026-10-18

Ninety actual status HTTP scenarios cover 179 proof queries with zero database
writes/native requests. Winning 4103 evidence is independently outbox-scoped
when native GUIDs are absent/empty, callback success is irrelevant, and stronger
read/delivered/sent proof wins. The public uncertain response has four explicit
fields and no raw native error data. Metadata-complete rows traverse actual
official Linq retrieval successfully; legacy missing/null clocks still reject.
Exact missing-column fallback and unrelated-error refusal are separately tested.

Four additional actual authenticated route cases make four local stub-native
GET requests and four mock cache-write attempts (two persisted mock updates).
Modern null/known clocks return the post-write database clock; failed/zero-row
writes fail closed. These are not real device requests or real database writes.
The separate real PostgreSQL/PostgREST scratch check verified actual missing
column error shape and migration-24 clocks before source implementation.

Full suite at this checkpoint: 246 SDK tests / 2,020 assertions and 75 backend
tests / 587 assertions, no failures; the real-service journal opt-in gate was
enabled in the SDK run. Typechecks and diff checks pass.


Final GET concurrency check: four explicit bounded evidence queries now start
together. A deterministic barrier requires all four to be issued before any
result resolves; cardinality/order/validators remain distinct. The status
fixture now covers 91 cases / 201 proof queries, zero writes/native requests;
the separate four-case native-clock fixture retains its exact scope. Root's
four joined HTTP wrappers pass after this refactor. No latency benchmark is
claimed.


### Local native PostgreSQL attachment verification — 2026-10-18

The existing `attachment-postgrest.fixture.mjs` passed **19 cases** using the
previously verified PostgreSQL 18.6 and PostgREST 16.4 native tools. A task-owned
adaptation of the isolated journal runner loaded the existing explicit attachment
SQL fixture; no Docker daemon or shared database was used. Actual Supabase/Next
handlers and genuine Linq SDK made 26 REST requests, eight authorization probes,
four REST writes and three fixture Storage requests. One object was stored in
memory; zero module mocks, device requests or live messages. Exit zero includes
confirmed owned PostgreSQL/PostgREST shutdown. This verifies the explicit fixture
schema, not an authoritative production schema or actual Storage API.

Runner: `/tmp/chert-attachment-native-run.sh` (task-only, SHA-256
`613abe31c0443c8900bde1cd5c1583a9e2eb3282518212f910d93c99672cf0d1`). Receipt:
`/tmp/chert-attachment-native-receipt-20261018.json`, SHA-256 `8cfabee890347e95d8c3c73016855122b38f0c7b1fbf95bc2efd1ea6a18dda51`.
At that metadata-only checkpoint, actual Storage acceptance and physical
attachment reception remained open. See the subsequent local Storage gate below.

This metadata gate is now repeatable from source without Docker (explicit
existing task-owned tool paths only):

```sh
CHERT_TEST_JOURNAL_PG_BIN=/tmp/chert-pg-source-20261017.2kfyicyu/runtime/bin \
CHERT_TEST_JOURNAL_POSTGREST=/tmp/chert-postgrest-native.32uT1SwN/postgrest \
bun test sdk/tests/attachment-native-postgrest.test.ts
```

The repository candidate runner is
`scripts/test-attachment-native-postgrest.sh`; the wrapper validates all 19 case
counts and rejects runner/cleanup failures. No Mac package or install is needed.


### Official local Storage acceptance — 2026-10-18

The optional actual-Storage mode passes **25 cases** through genuine Linq SDK,
real public Next handlers/authentication, PostgreSQL/PostgREST and official
Storage API with its filesystem adapter. No modules or database functions are
mocked. The receipt records 27 REST requests, eight REST authorization probes,
four REST writes, three gateway Storage requests, ten actual Storage requests
and six Storage authorization probes. Private-bucket upload/download preserves
exact bytes; anonymous, anon-token, forged/expired-token and public-object reads
are denied while the service-role read succeeds. Device requests/live messages
remain zero. The metadata-only 19-case mode remains the default.

Source tag `v1.83.5` resolves to signed, verified commit
`c826a70ac6e6f56d3e6033ccb164fb1ff5282570`; independently reconstructed Git tree
`cb64761eef5ce200df4b2714066f68447748e2c5` matches upstream. Source archive SHA-256:
`a053982d08bbf21afa7266701b750e0157155779a4891e688896cc5229988e42`.
The upstream manifest unusually declares package version `1.11.2`; it was not
rewritten to match the release tag. Apache-2.0 LICENSE is retained despite ISC
package metadata. Original manifest/npm lock remain unchanged; 1,099 imported
registry package name/version/integrity entries match that lock. The exact pinned
pg-boss source tree was independently verified before restoring Bun's missing
installation target. Two upstream dev-only MPL lightningcss packages were
removed only from this task installation; official compile does not require them.
The remaining inspected declarations are permissive (`combine-errors` declares
MIT in its README). Existing Node 26.7.0 headers built required `fs-xattr` locally;
official TypeScript/esbuild/path-resolution build then passed. No installed
runtime or project dependency was rewritten.

Repeat using the explicit already-prepared tools (these temporary dependencies
must still exist; this command does not download or install replacements):

```sh
CHERT_TEST_JOURNAL_PG_BIN=/tmp/chert-pg-source-20261017.2kfyicyu/runtime/bin \
CHERT_TEST_JOURNAL_POSTGREST=/tmp/chert-postgrest-native.32uT1SwN/postgrest \
CHERT_TEST_STORAGE_ENTRYPOINT=/tmp/chert-storage-source.Jzfysw/supabase-storage-c826a70/dist/start/server.js \
CHERT_TEST_STORAGE_NODE=/opt/homebrew/Cellar/node/26.7.0/bin/node \
bun test sdk/tests/attachment-native-postgrest.test.ts
```

The runner requires absolute runtime paths, creates its own disposable database,
loads the attachment and Storage fixture SQL, and lets official Storage apply its
migrations. It runs Storage from an empty owned working directory with only a
symlink to verified migrations: an initial run correctly failed when that
relative migrations directory was absent. Its stopped diagnostic context remains
`/tmp/chert-attachment-native.4W2D3acC`. Subsequent default/real gates pass and
confirm owned-process shutdown. Storage binds literal loopback; inherited
environment/dotenv, telemetry, queue workers and external features are disabled;
empty owned AWS files prevent ambient credential lookup without overriding HOME.
Logs/provenance remain under `/tmp/chert-storage-source.Jzfysw/`; final focused
wrapper log is `/tmp/chert-native-storage-wrapper-final.log`.

This proves local object/auth behavior against explicit fixture schemas, not
production schema/RLS, deployment or physical attachment reception. Paired CRM
release holds remain. No installed Mac change is required.


### Exact all-part status candidate — 2026-10-18

`attachment-status-http.fixture.mjs` retains actual authentication, public GET,
cloud helper and loopback native HTTP transport, substituting only its database
boundary. Twenty-eight scenarios issue 44 read-only native GETs and five mocked
cache writes, with zero native sends, callbacks or retries. Every stored media
UUID and caption must have separately validated identity/service/receipt proof;
caption delivery alone cannot settle attachments. The old-worker fixture now
expects exactly one evidence lookup and one caption-GUID lookup, both remaining
queued when proof is absent. This is source/HTTP acceptance, not installation.


### Frozen media and Linq send — 2026-10-18

`chat-media-http.fixture.mjs` now uses actual registered UUID/48hex identities and
complete canonical metadata. Its 37 scenarios preserve auth/ownership/HMAC,
reject malformed metadata and >100 parts before effects, and demonstrate that
metadata changes during the native boundary do not alter the frozen response
or persisted snapshot. Twelve native requests include deliberate uncertain
outcomes; two status GETs never repeat a send, five database writes are modeled.

`linq-media-http.fixture.mjs` uses the genuine SDK through actual registration,
PUT, single-media send, one-hour download and status routes. Eighteen scenarios
make 14 SDK Chert requests, three simulated native POSTs, four evidence GETs and
six modeled database writes. One Storage write/read boundary is in memory;
actual Storage itself is separately exercised by the real-Storage gate. Unknown
reactions are null; actual compact public message IDs are retained. Optional
retrieve parts are omitted, not fabricated. No physical media proof is implied.

Controlled PNG acceptance checkpoint (2026-10-18): run
`e285612e-e8b1-46e9-a39c-a1fd531e552e` stopped during non-send preparation.
Its private journal remains `attempted:false`, with no `.spent` claim or native
GUID. Read-only probes confirmed helper readiness, PID, exact approved chat and
sole peer; account identity did not match. Neither the DB account frame nor the
helper login established the approved sender relation. No account normalization
or send was permitted. The actual caller regression rejects this mismatch before
attachment dispatch. Typed, source-backed sender identity remains required;
this checkpoint is not physical PNG acceptance or an installed-worker upgrade.

### Strict text live harness preparation — 2026-10-18

`m4d-live-text-acceptance.mjs` is a separate one-text harness; the historical
media broker remains disabled. `prepareTextPlan` requires the signed candidate
manifest, a separate owner-only reviewed *installation* receipt and prior
approved exact-GUID sender/recipient evidence. A local candidate is insufficient.
The rebuilt plan freezes production caller/auth source, sender/recipient hashes,
installed pair hashes/PIDs, exact marker, public ID and one permanent receipt
path under the installation receipt directory. Copying a plan cannot create a
fresh attempt. Neither plan creation nor importing the module contacts a device.

The explicit runner flag `--text-live-contract` starts only disposable local
PostgreSQL/PostgREST with fresh credentials. The genuine Blooio SDK calls the
actual cloud auth/recipient route; only database client construction is replaced.
The offline-only extension additionally runs genuine Linq and Sendblue SDKs,
Blooio v4 HTTP and LoopMessage HTTP through their actual authenticated routes.
Five positive synthetic native requests and two uncertainty faults each require
an actual durable reservation and matching stored plaintext fingerprint before
effect. Lost replies and invalid ACKs retain their spent claim and cannot restart. Focused coverage passed 15 tests / 117 assertions;
the latest extension includes seven synthetic effects and **zero live messages**.

The explicit `--live-one-text ABS_OWNER_0600_PLAN` requires a separately verified
installed pair before SSH can send. The fixed-host executor reads native signing
credentials only on M4D and calls the actual versioned loopback HTTP endpoint,
never legacy bridge RPC. It checks a missing exact origin before spending, fsyncs
the permanent claim before effect, validates the actual ACK fingerprint/GUID,
and separately checks exact-GUID plaintext/service/peer evidence in both account
databases. Lost/invalid replies require reconciliation, never a new origin.
Installation receipts now exist and explicit source-bound live plans have run;
these are separate from the synthetic fixture counts above. The current native
pair is R9 (FT-INSTALL-097). Earlier installation and physical receipts must retain their own
revision boundaries; they do not authorize replay of a spent origin or prove
acceptance of every current operation.

### Individual provider plans and typed language clients — 2026-10-18

Version 2 `prepareProviderTextPlan` prepares one selected provider, peer and
marker; it does not preselect a public ID for SDKs without idempotency input.
The real cloud inserts its ID first. The gateway validates that committed row,
checks the exact origin is missing remotely, revalidates the row, and fsyncs the
learned ID/origin/body hash/fingerprint/provider into one permanent claim before
effect. Two concurrent IDs cannot share a claim; copied plans, lost replies and
new IDs never reset it. Version 1 Blooio plans retain their original explicit
flag and deterministic ID. Both versions require an actual separately reviewed
installation receipt. Their own-source and package/lock manifests invalidate
changed caller contracts. The explicit version 2 flag is
`--live-one-text-provider PROVIDER ABS_OWNER_0600_PLAN`; it selects one request,
never a provider/fault loop. Current offline coverage includes one v1 request,
five v2 requests and two uncertainty effects, with 13 stored-fingerprint reads.
One fresh version 2 Sendblue plaintext plan passed on M4D under R2: run
`e5d0a306-135b-4489-be19-8d730d1bb559`, receipt SHA256
`9a6252776741243ea601552a033df0125aa26535be4e3d2f9a4d7f7c38235bcb`.
It confirms exact recipient scalar spaces/CRLF/slash/Unicode and the exact-GUID
sender/recipient iMessage observation; NULL sender scalar required identical
bounded attributed-body bytes. The earlier `e002…` pre-admission failure had no
native effect and stays preserved; the separate original caption failure remains
failed and spent. Historical R7 refused at `selection_graph_bound`. R8 finite selection resolved
that refusal; genuine Linq SDK like-add and like-remove subsequently passed,
including durable caller acceptance and exact events on both accounts. R9 removes
unused recursive code, preserves all four acknowledged journal rows and passes
a fresh no-send inspection. These receipts do not prove current UI state or
other providers' reaction contracts.
See the [dated evidence](../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md).

`typed-text-postgrest.fixture.mjs` separately exercises the built JavaScript/
TypeScript core `ChertClient.sendText` and real Python, Rust and C++ `send_text`
methods through actual authentication, recipient route and PostgreSQL. Its
explicit offline runner mode is `--typed-text-clients` with
`--rust-helper ABS_EXE --cpp-helper ABS_EXE`. No live broker or SSH is imported.
Twenty integration cases verify queued IDs against actual reservations, exact
key replay without another POST, invalid authentication, and lost/malformed ACKs
returning the same 4103 reconciliation ID. Twelve synthetic native POSTs require
committed frozen fingerprints. Eighteen helper guards produce zero HTTP requests.
These are four typed language-client integrations, not additional providers.
The JavaScript case invokes the public built method directly, not raw `request`;
all native HTTP responses remain synthetic, with no physical-device proof.

Run the joined typed checks with existing local tools explicitly configured:

```sh
CHERT_TEST_JOURNAL_PG_BIN=/absolute/postgres/bin \
CHERT_TEST_JOURNAL_POSTGREST=/absolute/postgrest \
CHERT_TEST_RUST_TYPED_CLIENT=/absolute/typed_text_fixture \
CHERT_TEST_CPP_TYPED_CLIENT=/absolute/chert-sdk-typed-text-fixture \
  bun test sdk/tests/typed-text-postgrest.test.ts
```

Partial opt-in fails; ordinary runs without all four variables do not prove this
integration. Rust uses `cargo build --offline --locked --example typed_text_fixture`
in `sdk/rust`; CMake's existing test build creates the C++ helper. These helpers
accept only `--typed-text-fixture` with a literal loopback origin and bounded
synthetic stdin. They never use production credentials or send to a device.

### Four typed reaction clients over real PostgreSQL — 2026-10-18

`typed-reaction-postgrest.fixture.mjs` runs the actual JavaScript/TypeScript
`sendReaction` and Python/Rust/C++ `send_reaction` methods through the actual
authenticated nested Chert reaction POST and disposable PostgreSQL 18.6 /
PostgREST 16.4 with migration 25. The Supabase transport only rewrites its fixed
`/rest/v1` prefix for standalone PostgREST; no database or route handler is mocked.
Native HTTP acknowledgements are synthetic and there is no live execution mode.

The 36 cases produce 12 synthetic native POSTs, eight acknowledged operation
rows and four unknown rows. Each effect requires the exact committed reserved
row/fingerprint before the signed request. Add/remove, same-key replay, invalid
and foreign authentication, custom reactions, invalid header keys, malformed ACKs
and unknown replay are checked. Invalid inputs make zero HTTP requests; replay
and unknown replay add zero native effects. All four clients preserve the mixed-
case `Recorded:Exact.Target_1` alias as one encoded path segment and canonicalize
only the UUID chat. There are zero message GETs or implicit lookups. Twelve
helper CLI/origin guards also reject before any HTTP. These are local integration
checks, not four additional live reaction acceptances or current UI-state proof.

Build the test-only helpers using existing tools, then opt in explicitly:

```sh
cargo build --offline --locked --manifest-path sdk/rust/Cargo.toml --example typed_reaction_fixture
cmake --build /absolute/existing-cpp-build --target chert-sdk-typed-reaction-fixture

CHERT_TEST_JOURNAL_PG_BIN=/absolute/postgres/bin \
CHERT_TEST_JOURNAL_POSTGREST=/absolute/postgrest \
CHERT_TEST_RUST_REACTION_CLIENT=/absolute/typed_reaction_fixture \
CHERT_TEST_CPP_REACTION_CLIENT=/absolute/chert-sdk-typed-reaction-fixture \
CHERT_TEST_PYTHON=/absolute/python3 \
  bun test sdk/tests/typed-reaction-postgrest.test.ts
```

The wrapper selects the offline-only runner mode
`scripts/test-webhook-postgrest.sh --pg-bin ABS_BIN --postgrest ABS_EXE --typed-reaction-contract`.
It creates and stops only its private cluster/loopback PostgREST; original
runner modes and cleanup protections remain unchanged. Configured tests require
all three helper variables and both tool paths; partial opt-in fails. With
neither PostgreSQL nor PostgREST configured, the ordinary suite skips this gate
and supplies no real-database evidence. Helpers accept only
`--typed-reaction-fixture` with a literal `http://127.0.0.1:PORT` origin and bounded
synthetic stdin; keys stay off argv and no device credentials or SSH are used.

The final configured SDK suite passed **436 tests, 0 failures and 4,318 assertions
across 77 files** in 109.98 seconds. Log:
`/tmp/chert-sdk-reactions-all-r3-final-20261018.log`. This aggregate count includes
local integration/transport tests; it is not a physical-device test count.

## Protected receiving context and Sendblue HTTP reactions

`received-context-postgrest.test.ts` applies candidate migration 026 to a disposable
PostgreSQL/PostgREST instance and checks 25 ownership, privilege, immutable-conflict
and failure cases. Customer-editable conversation JSON cannot supply proof to the
owned message GET. The native ingestion path uses the receiving line's private
webhook MAC, independently of tenant API authentication.

`sendblue-reaction-postgrest.test.ts` joins the explicit HTTP adapter to the actual
signed inbound handler, production conversation append, protected ledger, tenant
message and line reads, nested reaction route and migration 025 reservation.
Its 40 cases include all six standard part-zero additions/removals, pre-effect
refusals, mutable-CRM alias/line races and an unknown acknowledgement. Thirteen synthetic native requests check
committed reservation tuples before responding; no live message or reaction is
sent. Run with the existing `CHERT_TEST_JOURNAL_PG_BIN` and
`CHERT_TEST_JOURNAL_POSTGREST` environment variables. The runner also exposes
`--received-contexts` and `--sendblue-reaction-contract` for these isolated gates.

The pinned official Sendblue SDK remains unchanged; it has no reaction method.
The separate `createSendblueReactionFetch` named export is a bounded HTTP subset.
Matching FT-INSTALL-099 native support and cloud migration are required before
physical acceptance; these tests do not establish full provider parity.

Historical device relay bundles may specify `source_export.probe_path` pointing
to the preserved original native probe. The fixture verifies its canonical owned
regular file and original SHA-256. This avoids treating a newly rebuilt probe as
having produced an older frozen export. The bundle's current source hashes bind
local relay code; old exports remain historical observations, not acceptance of
newly installed native code. Omitting the path retains the original build-path
check. Neither mode reruns a send or rewrites the original receipt.


### Native webhook fixture readiness follow-up — 2026-10-18

A full Sendblue3.20.1 regression run passed513 tests and failed the native fixture
preparation phase once. The same focused gate then passed. Its initial stderr was
not retained, so the original cause is not conclusively established. The fixture
had used a fixed200ms assumption before its subscription POST.

The test fixture now waits for a bounded readonly response containing a private
response-only nonce; a different listener cannot admit the POST by echoing request
data. Redirects refuse. Only a successful identity check admits the one subscription
POST. The normal native fixture gate exercises a deliberately600ms-delayed listener
(one POST) and a wrong-nonce listener (zero POSTs), then the actual subscription,
HMAC,503 retry and restart-persistence path. Production HTTP source, deployed
artifacts and original physical receipts are unchanged.


The first rebuilt-harness full rerun correctly refused the old R9 descriptor at
`prepare`: its bound binary/source hashes described the previous test harness.
A separate R10 descriptor binds the rebuilt fixture and the two updated test
files; original physical receipt, spent claim, reconciliation, native event
export and historical producer hashes are unchanged. The complete focused
three-case gate then passed with this descriptor. No device send or production
installation was repeated to refresh a local test-harness binding.


### Account-wide recorded history — 2026-10-18

The new `--account-history` disposable PostgREST mode exercises actual tenant
Bearer authentication and `GET /api/v1/messages`, then the real Sendblue3.20.1
`messages.list` method. Eleven direct HTTP cases plus official-SDK calls verify
cross-tenant isolation, stable filter/order/offset behavior, frozen endpoints
that differ from current lead routing, missing-clock/fact refusals, malformed
source errors, and refusal of an unhandled owned media row rather than partial
success. Route writes and native actions are zero; only local fixture setup
mutates its disposable database. The inherited test runner requires explicit
local PostgreSQL/PostgREST paths and preserves existing live-mode guards.

Pure loader tests additionally cover1001 owned leads/conversations/sends without
per-lead queries, the work cap, final ownership movement, schema fallback and
conflicting duplicate facts. Query regressions retain submillisecond bounds and
reject reversed fractional ranges. Built Node/Bun/Deno coverage includes one
account-wide GET and unsupported-filter rejection without another request.
No new physical messaging or production deployment is claimed by this read path.


Final account-history checkpoint:540 SDK tests/5000 assertions/86files pass;
log `/tmp/chert-account-history-final-sdk-20261018.log`. Backend route closure and
SDK typechecks pass. The documentation gate still identifies the separate
unindexed `docs/evidence/incoming-caller-identity/backport/PLAN.md`.


### Strict media history checkpoint — 2026-10-18

Hosted account history now projects owned strict v1/v2 media intents, preserves
stored caption bytes and resource timestamp precision, and renews attachment
capabilities from current tenant-owned metadata. Sendblue3.20.1 history maps those
capabilities using the configured Chert origin. Scalar native status caches alone
remain unknown; this checkpoint does not establish new physical caption fidelity
or complete provider parity. Existing v1 status-cache updates now pin the frozen
recipient and request body, preventing a concurrent retarget from being overwritten.

Actual HTTP/PostgREST verification covers 18 cases, including metadata ownership,
exact captions, capability signatures, timestamp precision and unchanged ledger
payloads. Built distribution checks pass on Node, Bun and Deno. The complete SDK
run passes **550 tests, zero failures, 5152 assertions across 88 files**:
`/tmp/chert-account-media-final-full-sdk-20261018.log`.
SDK and backend dependency-closure typechecks pass.

An earlier complete run had one official Storage startup timeout (549 pass,
1 fail); its owned runtime log was empty. The isolated Storage gate and complete
rerun pass; no product cause was established and no timeout was relaxed.
Documentation validation remains blocked by the pre-existing unindexed
`docs/evidence/incoming-caller-identity/backport/PLAN.md`.

These changes affect hosted routes and SDKs only: no per-Mac reinstall, device
configuration change, new physical send, shared migration or deployment occurred.
Bound native media evidence persistence is subsequent work, outside this frozen
verification checkpoint.


### Bound media evidence checkpoint — 2026-10-18

Owned single-message status polling now persists an application-owned exact-GUID
native observation bound to tenant, lead, public message, line, canonical media
request, attachment and optional caption hash. The shared validator checks all
identities, native flags and actual receipt clocks against the stored cache.
Contradictory legacy lifecycle aliases also remain unknown. Lost ACK recovery
preserves unconfirmed state and can recover the GUID without inventing an ACK;
subsequent reads continue polling for newer read evidence. Cache CAS additionally
pins the lead. Both public response levels strip the private envelope. Account
history reads persisted proof without polling devices or writing the ledger;
`sent_at` remains null.

The expanded synthetic-proof HTTP/PostgreSQL inventory fixture passes 26 cases.
The shared validator/projection pass 10 tests/114 assertions after a demonstrated
red/green correction for contradictory lifecycle aliases. The producer/recovery
checks pass 40 tests/363 assertions. SDK/backend typechecks and Node/Bun/Deno
built-distribution checks pass.

A root-reviewed fixed GET exporter read one already accepted media GUID from
M4D's currently installed native service. It pinned the existing service binary
SHA, verified endpoint hashes against the immutable accepted plan, and confirmed
PID/start/binary and configuration preservation. One signed GET, zero source
mutations, no send/restart/installation/security change. Private proof SHA256:
`2722302915fc7302acd19fa93a7c9dc9b9019eb6dbaf64782b190af1492ab981`.
Reviewed exporter SHA256:
`d7e04c6e482539c23e58fd9b0d14e6476b00f99f53f12829afde4f87c8ff4743`.

That exact captured response then passed authenticated actual message GET,
one real PostgreSQL cache CAS, account history GET and the genuine Sendblue SDK
list (`DELIVERED`, actual delivery time, no invented send time). Its task-local
ledger was explicitly reconstructed from accepted operation bindings; this is
not original production-ledger recovery or a deployed cloud/native transport
acceptance. Test-only service-client factory injection points the real handlers
at the disposable database; deployed construction was not exercised. Only one
loopback captured-proof GET occurred in that fixture, with
zero native POSTs and no device action. Local receipt SHA256:
`5d99f5ec988ddc7e8fe64c2a1c20d0a88992da51fc2909834e199fcb8b92e8c9`.
Private artifacts remain under `/private/tmp/chert-media-evidence-readonly-20261018/`.

The first complete proof run had one unrelated reaction concurrency fixture
failure: it expected one HTTP202 although the losing request could legitimately
replay the winner after acknowledgement. Exactly one native effect and one
public identity already passed. The test now holds native ACK until the loser
observes reserved/4103, then separately verifies acknowledged replay with no
additional effect. No production reaction semantics or assertions were relaxed;
two isolated PostgreSQL runs pass (38 cases, 22 route cases, 12 synthetic native
POSTs). The failure log remains `/tmp/chert-media-proof-full-sdk-20261018.log`.
A subsequent complete run passes 556 tests/5219 assertions/89 files with no
failures (`/tmp/chert-media-proof-final-sdk-20261018.log`). Final frozen-source
rerun is recorded separately below when complete.

Cloud/SDK changes only: no per-Mac install is required. No shared migration,
deployment, commit or push occurred. Exact received caption fidelity, full
legacy/provider parity and the previously stated physical/transport gaps remain
open. Documentation validation still reports only the pre-existing unindexed
`docs/evidence/incoming-caller-identity/backport/PLAN.md`.


Final frozen-source verification passes **556 tests, zero failures, 5223
assertions across 89 files** (`/tmp/chert-media-proof-frozen-sdk-20261018.log`,
exit0). This includes the lifecycle-alias correction and deterministic reaction
barrier repair. SDK and affected backend typechecks pass; Node/Bun/Deno built
runtime checks pass. Working-tree whitespace validation passes. The known
unindexed-document gate and physical/provider acceptance limits above remain.


### Blooio v4 direct keyed plaintext and panel revalidation — 2026-10-18

The direct explicit-sender plaintext adapter now maps Idempotency-Key to the
existing strict Chert tenant/key fence. Fresh queued receipts return vendor201;
verified historical receipts return200; changed sender/recipient/text returns409.
Lost or unconfirmed ACKs retain the same nonretryable4103 public identity without
another native dispatch. Keyed receipts require the explicit cloud replay flag;
old cloud output is not accepted as equivalent. Historical strict replay occurs
before mutable line health, lead selection or conversation repinning, while the
original chat must still belong to the tenant/project. It reports frozen DM
identity and unknown mutable chat metadata. A demonstrated legacy regression was
fixed: an exact old chat-shaped receipt still reaches the existing legacy replay
verifier, while strict protocols never fall back. First failing full log is
`/tmp/chert-v4-keyed-full-sdk-20261018.log`; focused legacy red/green evidence and
157 helper assertions are retained separately.

Eighteen actual-authentication/PostgreSQL HTTP cases verify this new direct
subset, including inactive-line replay, changed-body conflicts, tenant isolation,
concurrency and lost ACKs. Existing-chat/media keys still refuse; preserving
original provider route and media URL identity remains required before enabling
them. Chert retains keys permanently; official v4 documentation does not define
expiry/reuse semantics. This is not complete idempotency or provider parity.

A fresh controlled M4D run `223deb9b-98e5-448b-9bc0-76477fb75539` passed through
the actual adapter, authentication, root chat handler, disposable PostgreSQL and
reviewed one-use broker into the installed R2 native service. It returned fresh201,
identical-key replay200 and changed-text409 with exactly one native POST and two
committed-reservation checks. GUID `CF6BE270-67FA-4A05-B186-ECB217F2B991` had exact
marker text in both M4D account databases and iMessage service. This is controlled
same-Mac account evidence, not an independent physical-phone/read-transition or
upstream Blooio interoperability test. Test-only service-client injection selected
the disposable database; the cloud deployment construction was not exercised.
No old spent attempt was reused. The root rechecked all56 plan source hashes
without drift and verified both fresh/replay receipt identity.

Private plan SHA256:
`e6a43bcd5465280b3966177299824b1420f980e71014b5bf5598dd6211bcae44`.
Native observation receipt SHA256:
`c403ff0e1a1a9cf6e17df2f7a4ee40f0b0e0be120e88b5cb6f5ea30a40a2916f`.
Separate HTTP acceptance receipt SHA256:
`bc6db3bf06c35d4db0606275e23f3e66b80ca7c5a52c902303b50d4960af20a0`.
Artifacts: `/private/tmp/chert-v4-keyed-text-review-20261018/`.

The full SDK run passes **564 tests, zero failures, 5307 assertions across90
files** (`/tmp/chert-v4-keyed-final-full-sdk-20261018.log`, exit0). Built Node,
Bun and Deno checks exercise fresh/replay behavior and header isolation; affected
backend types pass. No new native package, schema, shared deployment, commit or
push was needed. The known unindexed-document gate remains separate.

The accepted ZPUI candidate was independently reopened and rendered with current
source/font/theme bindings intact. Mouse Refresh, visible Tab focus and Return
remained responsive; displayed application presence and unverified communications/
media state matched its bundled diagnostic worker. This was unchanged-data
interaction, not a readiness transition. Only the newly owned candidate was
closed/terminated afterward; the older original panel process stayed untouched.
Fresh font/theme/packaging checks pass8 tests without skips. Receipt SHA256:
`63e47c6a43a98b302fe75f10c5404a5e61716c9bd33b555286bd7c2aabc1176b`,
`/private/tmp/chert-zpui-minwidth-review/rendered-reverification-20261018.json`.
No Apple application was started, software installed or call placed by panel QA.


Read-only M4D postflight also passes: worker/helper identities, both configuration
hashes, receive-wire0 and all three existing ingress processes remain unchanged.
The sender journal has exactly one new matching text ACK (8 total), with its
previous7 rows preserved; attachments3, reactions5 and recipient text1 remain
unchanged. No additional sends, restarts or configuration changes occurred.
Postflight receipt SHA256:
`a8e2bcea6c7b949d47cd03d924398184396519bd3d5f5d690349d4433e2cd7c3`,
`/private/tmp/chert-v4-keyed-text-review-20261018/post-v4-device-state.json`.
This is a scoped preservation check, not fleet/endurance validation.


### Supported V4 keyed paths and controlled device checks — 2026-10-18

The current adapter now binds original provider route and canonical JSON body
identity for direct explicit-from plaintext, existing-chat plaintext and one
owned PNG/JPEG URL. Authenticated `POST /api/v1/idempotency/lookup` reads the
existing tenant/key reservation before mutable sender routing or media metadata.
The exact marker is persisted with the original intent; context-free historical
rows cannot prove a provider request and refuse this lookup. The older Chert
replay path remains separate. Native wire and database schema are unchanged.

The actual-auth/HTTP/PostgreSQL fixture passes **31 cases**: replay after routing
or metadata changes, ownership isolation, cross-route/text/media conflict,
concurrent reservations, lost ACK identity and four raw invalid-text requests.
Blank and lone-surrogate text on both chat routes are rejected before any
PostgREST write or native dispatch. The fixture has six synthetic native POSTs,
two metadata GETs and no download fetch; this is local verification.

A fresh M4D existing-chat text run `534eafa7-b42e-4292-ae1f-f755d6c51d8b`
returned fresh201, replay200 and changed-text409 through actual adapter/auth/chat/
lookup handlers and disposable PostgreSQL. It made one native POST, three lookup
POSTs and two committed-reservation checks. Exact marker text and GUID
`B1EFE01D-58FB-49EE-ACAA-0474458E39E4` appeared in both controlled account
databases. All67 source bindings matched after acceptance. Private plan SHA256:
`4073cf242a05424df73f893a0c85bb6552882a5845512624232cc49617609b05`.
Observation receipt SHA256:
`64a5653fdc9d93715717c6aa9a0c71fcb88dc69dde21ebc60233ccaa8ed0e546`.
HTTP receipt SHA256:
`1c7f2112af79fde2d9daf66ce61d5fe3b43e18213a1d0789a5edf8aa7a55d4ba`.
Artifacts: `/private/tmp/chert-v4-keyed-chat-text-review-20261018/`.
Read-only postflight SHA256
`287d365a38b2d8228c8cc4580111c9f844cd317eba16e5ed5770330905891573`
confirms worker/helper/configuration/ingress preservation, receive-wire0 and the
original seven text rows plus exactly the two accepted keyed text rows (nine
text ACKs total). Attachments3, reactions5 and recipient text1 were unchanged.

A separate fresh M4D media run `1fc041e9-efc8-4756-bd69-866ff7061603`
used actual registration/upload routes, HTTPS with a task-only trusted CA,
official isolated Storage, PostgreSQL, V4 adapter and native HTTP attachment
resolver/staging connected to the existing R2 helper. It returned fresh201,
identical replay200 and changed-URL409 for the same attachment, with one native
POST and no replay metadata/Storage access. GUID
`5BAB3718-1A69-41A1-8BDF-39FC46F0A5FE` was observed in both account databases;
sender delivered evidence and exact decoded recipient PNG pixels passed.
Messages re-encoded the image: file bytes differ. No caption was tested.
All71 cloud/tool and39 isolated native source bindings matched after acceptance.
Private plan SHA256:
`154ace473cf3afd5b18da4584f42440964fdf4888bc903f486eeca24afc61e35`.
Observation receipt SHA256:
`0f384cb053cd494c1c3dc9c6836167f05158d3b535bcfea098c1d4050038d4f4`.
HTTP receipt SHA256:
`f76c9b3961305bc31a946473b713bf2b99bb312efecd03d5bd7254b79b3b7725`.
Artifacts: `/private/tmp/chert-v4-keyed-media-review-20261018/`.
The owned runner exited0 after its cleanup path; a separate preservation and
process-absence audit is recorded below when available.

The final combined SDK run passes **572 tests, zero failures, 5400 assertions,
90 files**, exit0 (`/tmp/chert-v4-allkeys-final-sdk-20261018.log`). Affected backend
types and built-package Node/Bun/Deno checks pass. These controlled same-Mac
account tests use a disposable service-client construction, not deployed cloud,
independent-phone, upstream vendor interoperability, fresh-read transition or
endurance acceptance. They do not establish universal provider parity. Chert
reservations remain permanent; no expiry/reuse semantics are invented.

No installed worker/helper was upgraded, no security setting changed and M4C was
unused. The temporary isolated native HTTP artifact excludes the new C ABI worker
entry and FaceTime/capture bootstrap; it is not unified-worker runtime proof.
No per-Mac installation entry is required for this cloud/SDK change. No shared
migration, deployment, commit or push occurred. The accepted ZPUI theme/font and
rendered Refresh evidence from the preceding checkpoint remain unchanged.


Read-only media postflight now confirms the isolated task PID and listener are
absent, with original worker/helpers/configurations/ingress and receive-wire0
preserved. The original three attachment journal rows remain byte-identical,
plus exactly one matching new media ACK (four total); text9, reactions5 and
recipient text1 are unchanged. No further send or process/configuration mutation
occurred. Receipt SHA256:
`ab3dc6d4e570904c1fbf35e80640ef0e43f18ff27aa7512828fba34548749f70`,
`/private/tmp/chert-v4-keyed-media-review-20261018/post-v4-keyed-media-device-state.json`.
The first read-only audit invocation returned no accepted result; one bounded
diagnostic reread of the same predicates passed without code changes. Its exact
initial failure cause was not established; no send was retried.


### Linq keyed receipts, legacy Blooio device gate and race repair — 2026-10-18

Implemented separate Linq keyed text/media receipts, profile-specific key limits,
exact frozen media replay and duplicate-PK/timestamp race repairs. Actual HTTP/
PostgreSQL coverage passes42 cases; final SDK579 tests/5431 assertions/91 files
and backend17 tests/343 assertions pass, alongside types and Node/Bun/Deno.

Separate controlled M4D legacy Blooio text, Linq text and Linq PNG runs each
passed fresh/replay/conflict with exactly one native send. Exact text and decoded
image pixels passed across two accounts on that Mac. The caption serialization
experiment found no fix; caption fidelity remains failed. No Mac reinstall,
security/configuration change, shared migration, deployment or push occurred.

[Source-bound plans, receipts, preservation audits and acceptance limits](../../docs/evidence/CHERT_SDK_M4D_2026_10_17.md#linq-keyed-receipts-legacy-blooio-device-gate-and-race-repair--2026-10-18)
remain authoritative. Broader provider parity and independent-device/deployed-
cloud acceptance remain open; the goal stays active.
