# Chert FaceTime client

The `chert-sdk/facetime` export provides typed HTTP methods for the Chert FaceTime
API. The successor package is not yet published; use a reviewed local tarball for
preview testing. See the root guide for supported Node, Bun and Deno versions.

```ts
import { ChertControlPlane } from 'chert-sdk/facetime';
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
