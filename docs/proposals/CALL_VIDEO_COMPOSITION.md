# Call video composition (proposal, unreleased)

Status: draft, implemented in source on `feat/video-composition` (TypeScript, plus native
parity without URL pages). Unreleased: nothing here is published, and the backend
does not serve it yet.

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

A `page` is `{ deployment_id }` (a ready #18 deployment) or a URL. **The
call-video resource only accepts deployment IDs; it never loads a URL.** For a
URL page (`'https://…'` or `{ url, digest?, name?, viewport?, fps? }`) the SDK
creates a living service, waits until the deployment is `ready` (default 60 s,
`living_deployment_not_ready` otherwise), then sends its `deployment_id`. Retrying
with the same idempotency key reuses the same deployment. To show one page on many
calls, deploy once and pass `{ deployment_id }`. Native SDKs accept deployment IDs
only.

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
        background: 'opaque' | 'transparent'; opacity: number;
        input: LivingInputKind[] }>;   // [] when not interactive
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
  the layer below. The server compositor blends premultiplied RGBA source-over,
  multiplied by `opacity`, before the final video encode (alpha never travels over
  WebRTC). `'opaque'` fills the region with the page as rendered. Transparent
  layers work only where the capability reports `page_alpha: true`; otherwise the
  PUT fails with `composition_invalid`.
- **Placement.** `region` is normalized to the output frame. The page viewport
  is the region's size in output pixels, rounded down to even and clamped to the
  living-service limits; the effective viewport is returned on the living
  session. Regions must stay within the frame (x + width ≤ 1 and y + height ≤ 1, with a
  1e-9 tolerance for floating-point rounding).
- **v1 bounds.** At most two layers (`max_layers: 2`), at most one of them a base.
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
  instead of straight to the call. An already-live standalone camera session
  cannot be adopted: clear it and republish to the composition's grant. Updating
  a composition keeps the base session it already owns.
- **Customer LiveKit track**: Chert never joins the customer's LiveKit room or
  holds its credentials. The customer subscribes to the track with
  `@livekit/rtc-node` and feeds its frames into `ChertVideoSource` over the
  `camera` base grant. The SDK adds `liveKitTrackFrames(rtc, videoStream)`, the
  inverse of the existing `liveKitVideoTransport`, so that is one line.
- **`managed`**: a source the backend provides for the line, used only when the
  capability lists it. No managed source is composable yet, so `bases` omits it
  today and the PUT returns `composition_base_unavailable`.

## Frame rate, publish slot, where it composes

- **Composition is server-side,** in the Chert media pipeline next to the #18
  page renderer. The caller receives one composed video track. The SDK never
  composites, and nothing changes in the caller's FaceTime client.
- **Output fps** = min(base fps, grant limit, the capability's `max_fps`). The
  capability's `max_fps` is a measured compositor rate, not the grant limit. Page layers render at their own
  effective fps (min(requested, manifest, grant limits), never above output
  fps); the compositor emits on the base cadence and reuses each layer's latest
  frame. With no base, output fps is the bottom page layer's fps. Expect up to
  one output frame of added latency on the base.
- **One publish slot.** An active composition is the call's single publish
  occupant. Its camera grant and page sessions are children of that one slot, so
  they never conflict with the composition itself. Camera, living surface and screen remain mutually exclusive with it:
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
  "bases": ["camera"], "page_alpha": false, "regions": true,
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

## Backend decisions (2026-10-28)

1. No implicit or unpinned URL deployment at the PUT; the SDK deploys URL pages
   first and sends the immutable deployment ID.
2. Alpha is blended by the server compositor before the encode. `page_alpha`
   stays false until that path exists and is tested, and `max_fps` is a measured
   compositor capability.
3. No adoption of a live camera session in v1; republish to the composition's
   base grant. Updates keep the owned base session.
4. No composable `managed` base yet; `bases` omits it.
5. `/api/v1/calls/{id}/video`, the error codes and `call_video.*` events are
   accepted. The camera grant and page sessions are owned by the composition's
   one slot; standalone camera, living and screen resources conflict with it.
