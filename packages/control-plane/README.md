# @cherthq/control-plane

Private, original MIT TypeScript client for the inspected Chert FaceTime control-plane API. It is not a replacement for the messaging SDK or a media/FaceTime connector runtime. Requires a Fetch-compatible runtime (Node 18+, Bun or a browser).

```ts
import { ChertControlPlane } from '@cherthq/control-plane';
const publicClient = new ChertControlPlane({baseUrl: 'https://facetime.trychert.com'});
const login = await publicClient.beginLogin({device_name: 'My laptop'});
// Display verification_url_complete. The person signs in and approves a project.
// Wait at least login.interval seconds between polls, until expiry; no polling loop is implicit.
const result = await publicClient.pollLogin({device_code: login.device_code});
if (result.status === 'approved') {
  const client = new ChertControlPlane({baseUrl: 'https://facetime.trychert.com',
    token: result.access_token, projectId: result.project.id});
  console.log(await client.whoami());
  console.log(await client.listLines({limit: 20}));
}
```

Keep tokens and connector credentials outside source control. Never print an approved login result: it includes the credential returned once. Credentials are sent only in Authorization headers, except the device code required in the token endpoint's JSON body. Public calls do not receive an existing token. HTTPS origins are required except local HTTP; embedded credentials, paths and URL query/fragment are rejected. Redirects are refused. Each request has a 15-second deadline and responses are capped at 1 MiB. No requests retry automatically. Supply `fetch` for isolated tests or runtime integration.

Methods return the server's `data` payload. `ChertApiError` exposes safe HTTP status and a bounded set of known error codes; it intentionally drops server messages, error bodies and transport errors to avoid credential leakage. Response types describe source contracts, not runtime schema validation or deployment proof. Malformed JSON/envelopes are rejected.

Read [BACKEND_COVERAGE.md](./BACKEND_COVERAGE.md) for permission boundaries and missing onboarding services before automating setup. Methods requiring a browser session do not gain that authority merely because a CLI credential was supplied. Checkout is inspected staging/test-mode functionality, not production provisioning.

Run `bun test packages/control-plane` from the workspace root. Tests use injected fetch and perform no real login, payment, enrollment, message or call.
