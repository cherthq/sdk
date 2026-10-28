# Call video composition (proposal, unreleased)

Status: draft contract for review. Nothing here is implemented or published.

Agents should be able to say "the call video is this page", and to put an HTML
page over live video (captions, UI, annotations, branding). This proposal adds
one declarative resource, the call's **video composition**, built from the
existing pieces:

- **Base video ingest** uses the #17 media session (WHIP publish grant, same
  limits and validation).
- **HTML layers** are #18 living sessions (same runtime, page bridge, state,
  events, input, signed message webhook).

There is no third transport. The composition is the call's single publish
slot.

## Common case: the call video is a page

```ts
await client.setCallVideo(callId, { page: 'https://agent.example/live.html' }, idempotencyKey);
```

This is sugar for a composition with one opaque, full-frame page layer. The
page is rendered by the #18 runtime and published as the call's video; voice
continues on the existing call path. `clearCallVideo(callId)` stops it and frees
the publish slot.

A `page` is either a URL string or `{ url, digest? }` (ad-hoc, see Open
question 1) or `{ deployment_id }` (an existing #18 deployment, pinned and
immutable).

## Layers

```ts
await client.setCallVideo(callId, {
  layers: [
    { id: 'base', source: { kind: 'camera' } },                 // z 0
    { id: 'captions', z: 1, page: { deployment_id },            // above it
      region: { x: 0, y: 0.75, width: 1, height: 0.25 },        // normalized
      background: 'transparent', opacity: 1, input: ['pointer'] },
  ],
}, idempotencyKey);
```

```ts
type BaseSource =
  | { kind: 'camera' }   // the agent publishes frames over a #17 WHIP grant
  | { kind: 'managed' }; // a backend-provided source the line advertises

interface Region { x: number; y: number; width: number; height: number } // 0..1 of the output frame

type VideoLayer =
  | { id: string; source: BaseSource }                 // base layer, always z 0
  | { id: string; z: number; page: PageRef; region?: Region; // default full frame
      background?: 'opaque' | 'transparent';             // default 'opaque'
      opacity?: number;                                  // 0..1, default 1
      input?: LivingInputKind[]; initial_state?: LivingJson };

interface CallVideoComposition {
  composition_id: string; call_id: string; revision: number;
  status: 'starting' | 'live' | 'stopping' | 'stopped' | 'failed';
  output: { width: number; height: number; fps: number };   // effective
  layers: Array<
    | { id: string; z: 0; source: BaseSource; publish?: MediaSessionGrant } // camera base only
    | { id: string; z: number; living_session: LivingSession; region: Region;
        background: 'opaque' | 'transparent'; opacity: number }>;
  error_code: string | null;
}
```

Rules:

- **Z-order.** Layer `z` values are unique integers. The base layer, if any, is
  z 0; page layers are z ≥ 1 and paint in ascending order. Without a base layer,
  the lowest page layer must be opaque and full frame (that is the "call video
  is this page" case).
- **Alpha.** `background: 'transparent'` renders the page with an alpha channel:
  the document and root backgrounds are transparent, and CSS transparency shows
  the layer below. Compositing is premultiplied source-over, then multiplied by
  `opacity`. `'opaque'` fills the region with the page as rendered.
- **Placement.** `region` is normalized to the output frame. The page viewport
  is the region's size in output pixels, rounded down to even and clamped to the
  living-service limits; the effective viewport is returned on the living
  session. Regions may extend only within the frame.
- **v1 bounds.** At most one base layer and one page layer (`max_layers: 2`).
  The model already allows more; the capability advertises the real limit.
- **Updates.** `setCallVideo` is a desired-state PUT. An optional `revision`
  makes it compare-and-set (it must equal the current revision; the response
  carries the next one); without it the PUT replaces unconditionally. Changing region, opacity or z of an existing layer `id` keeps its
  living session and base ingest running. Removing the page layer leaves the
  base on air; adding one does not restart the base. Page state, events and
  input keep using `setLivingState`, `sendLivingEvent` and `sendLivingInput` with
  the layer's `living_session.session_id`.

### Bases

- **`camera`**: the response carries a #17 publish grant on the base layer
  (`content: 'camera'`, same limits). The agent publishes with `ChertVideoSource`
  and `whipTransport`, exactly as today; the grant routes into the compositor
  instead of straight to the call.
- **Customer LiveKit track**: Chert never joins the customer's LiveKit room or
  holds its credentials. The customer subscribes to the track with
  `@livekit/rtc-node` and feeds its frames into `ChertVideoSource` over the
  `camera` base grant. The SDK adds `liveKitTrackFrames(rtc, videoStream)`, the
  inverse of the existing `liveKitVideoTransport`, so that is one line.
- **`managed`**: a source the backend provides for the line, used only when the
  capability lists it.

## Frame rate, publish slot, where it composes

- **Composition is server-side,** in the Chert media pipeline next to the #18
  page renderer. The caller receives one composed video track. The SDK never
  composites, and nothing changes in the caller's FaceTime client.
- **Output fps** = min(base fps, grant limit). Page layers render at their own
  effective fps (min(requested, manifest, grant limits), never above output
  fps); the compositor emits on the base cadence and reuses each layer's latest
  frame. With no base, output fps is the bottom page layer's fps. Expect up to
  one output frame of added latency on the base.
- **One publish slot.** An active composition is the call's single publish
  occupant. Camera, living surface and screen remain mutually exclusive with it:
  a direct `createMediaSession({ direction: 'publish' })` or `attachLivingService`
  while a composition is live returns `409 media_session_conflict` /
  `living_surface_conflict`, and `setCallVideo` while one of those is live returns
  `409 media_session_conflict`. Screen content cannot be a base in v1.
- **Interactivity.** The overlay stays interactive the same way a #18 surface
  is: only agent-relayed input, only declared kinds. Pointer `x`/`y` stay
  normalized to the **output frame**; input outside the layer's region is
  rejected (`living_input_not_allowed`), inside it is mapped to page
  coordinates. The FaceTime caller cannot click the page.

## Capability

Explicit and versioned, never inferred from `custom_video` or
`living_services`:

```json
"video_composition": { "version": 1, "supported": true, "max_layers": 2,
  "bases": ["camera", "managed"], "page_alpha": true, "regions": true,
  "max_width": 1920, "max_height": 1080, "max_fps": 30 }
```

## HTTP and errors

- `PUT /api/v1/calls/{call_id}/video` with `Idempotency-Key`: body
  `{ revision?, layers }`, response `CallVideoComposition`.
- `GET /api/v1/calls/{call_id}/video`; `DELETE /api/v1/calls/{call_id}/video`.
- Errors: `video_composition_unsupported` (409), `composition_invalid` (422,
  bad z, region, alpha or layer count), `composition_revision_conflict` (409),
  `composition_base_unavailable` (409, e.g. `managed` not provisioned), plus
  existing `media_session_conflict`, `living_deployment_not_ready`,
  `living_input_not_allowed`, `call_not_active`, `call_ended`.
- Timeline: payload-free `call_video.live | updated | failed | stopped`.

## Open questions for the backend

1. Can `PUT .../video` accept an ad-hoc `{ url }` page and create an implicit,
   unpinned deployment server-side? If not, `setCallVideo({ page: url })` runs
   create, wait-ready and attach in the SDK, and stays one call for the agent.
2. Can the renderer produce an alpha channel from a transparent page, and at
   what fps for a 1920×270 strip over 1080p?
3. Can an already-live camera session be adopted as the base (re-routed into
   the compositor) without a new WHIP session, or must the agent republish?
4. Which `managed` sources exist today, if any? If none, `bases` omits it.
