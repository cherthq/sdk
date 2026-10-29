# Chert FaceTime client

The `@trychert/sdk/facetime` export provides typed HTTP methods for the Chert FaceTime
API. This guide targets `@trychert/sdk@0.2.3`; the
[npm package page](https://www.npmjs.com/package/@trychert/sdk) lists available
versions. Use a reviewed local tarball for local validation. See the root guide
for supported Node, Bun and Deno versions.

```ts
import { ChertControlPlane } from '@trychert/sdk/facetime';
const publicClient = new ChertControlPlane();
const login = await publicClient.beginLogin({device_name: 'My laptop'});
// Display verification_url_complete for the person to approve their project.
// Wait at least login.interval seconds between polls, until expiry.
const result = await publicClient.pollLogin({device_code: login.device_code});
if (result.status === 'approved') {
  const client = new ChertControlPlane({token: result.access_token, projectId: result.project.id});
  const lines = await client.listLines({limit: 20});
}
```

The default origin is `https://facetime.trychert.com`. Optional `baseUrl` overrides
must be HTTPS origins (or loopback HTTP), not API paths: `/api/v1` is appended once.
Empty/null overrides are rejected. iMessage uses its separate default origin and
credentials. Feature availability must be verified for your project; defaults
are not a promise of production readiness.

## Billing

Use a **signed-in user session**, not the CLI credential returned above. Supply
the project UUID; billing requires owner/admin membership. Read-only example:

```ts
const billing = new ChertControlPlane({token: userSessionToken, projectId});
const status = await billing.billingStatus();
// With explicit user authorization to purchase:
// const {url} = await billing.createCheckout({plan: 'shared'}, stableRequestKey);
// Navigate to url; refresh billingStatus afterward to check entitlement.
```

`cancelSubscription(key)` and `validateCoupon(code, key)` also require a stable
caller-owned idempotency key. Checkout completion does not guarantee line access.
See [API coverage and preview migration](./BACKEND_COVERAGE.md) for the removal of
the obsolete catalog/checkout-row helpers and all credential boundaries.

Never log login results, session tokens or connector credentials. Public login
requests do not receive configured bearer credentials. Redirects are refused;
requests have a 15-second deadline and a 1 MiB response limit. There are no automatic
retries. Methods return the response `data` payload; TypeScript models do not
perform runtime schema validation. Malformed JSON/envelopes are rejected.
`ChertApiError` exposes HTTP status and safe codes, omitting response bodies and
server/transport messages. Supply `fetch` for isolated tests.

Run `bun test packages/control-plane`. Tests perform no real login, payment,
enrollment, message or call.

## Calls and video

The source preview includes `createCall`, `getCall`, `listCalls`,
`getCallEvents`, `answerCall`, `rejectCall` and `endCall`. Use a project key with
the required `facetime:read`/`facetime:write` permission or an authorized user
session. A CLI login does not grant call-write permission. Call mutations require
stable caller-owned idempotency keys; reconcile uncertain outcomes before retrying.

```ts
// Invoke only with recipient consent and an authorized video-enabled line.
async function placeVideoCall(client: ChertControlPlane, key: string) {
  return client.createCall({
    direction: 'outbound', mode: 'customer_managed',
    line_id: authorizedLineId, destination: authorizedDestination,
    media: {audio: true, video: true},
    livekit_url: customerRoomUrl,
    participant_token: callScopedParticipantToken,
    remote_participant_identity: customerAgentIdentity,
  }, key);
}
// Deliberately not invoked. Never log room credentials or the request body.
```

Customer-managed calls require an explicit line, audio enabled and all three
room fields; do not supply an assistant. Managed calls require `assistant_id`
and at least one requested medium, without room credentials. The HTTP client
does not transport frames or implement LiveKit subscriptions. An accepted call
or media event does not prove that a recipient saw or heard anything.

BYOR applications join their own LiveKit room using their own participant
credential. The `participant_token` supplied to Chert is a separate, call-scoped
participant credential with room join, publish and subscribe permission; do not
reuse it for the application participant. Call creation returns metadata, not
a client join token. There is no public managed-room observer/join endpoint in
this client. Use LiveKit's client APIs for audio/video tracks; requesting video
does not establish that the selected service/line can transmit or receive it.

For inbound calls, authenticate `IncomingCallWebhook` before acting on it.
Return an `IncomingCallDecision` to that webhook: either `{action:'decline'}` or
`{action:'accept',livekit_url,participant_token,remote_participant_identity}`.
These room credentials are not arguments to `answerCall`. Configure the line's
`customer_decides` inbound policy and your authorized integration separately.

`getCall` returns detail events in `facetime_call_events`; `getCallEvents` returns
a normalized `{call_id,events}` timeline, not a stream or raw track callbacks.
There is no FaceTime SSE/WebSocket event endpoint represented by these APIs.
Applications may poll snapshots explicitly, deduplicating by event ID rather
than assuming a contiguous or non-null sequence.
Treat event payloads and transcripts as sensitive. `updateLine` supports settings
such as `video_framing: 'fit' | 'fill'` and inbound policy. Assistant methods manage
drafts and publish versions; updates require `expected_draft_revision`. Assistant
video configuration is separate from line framing and does not supply credentials
or guarantee service availability. There is no arbitrary call PATCH method.
