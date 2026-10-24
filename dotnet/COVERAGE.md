# chert-sdk .NET public API coverage

This directory contains an open-source HTTP client, examples and synthetic
contract fixtures. It does not distribute service implementations, infrastructure
configuration, deployment procedures or private source references. Contract tests
describe observable requests/responses; they do not establish live availability.

| Surface | Implemented / tested | Boundary |
| --- | --- | --- |
| Package/namespace/assembly | NuGet `chert-sdk`; namespace/assembly `TryChert`, .NET 8, dependency-free, MIT | Unpublished preview |
| Unified client | Legacy independent channels; opt-in `ConnectAsync` validates unauthenticated capabilities and binds one session/project with response contract echoes | Proposed version-1 contract, no deployed guarantee, no login/refresh/fallback |
| iMessage | Raw JSON, strict text and six standard reactions, typed receipts/errors | No vendor adapters or media helpers |
| FaceTime calls | Create/list/get/answer/reject/end/events/transcript | API acknowledgements, not device/media proof |
| FaceTime destinations | Managed/BYOR, direct destinations, links and typed groups | Server permissions and availability remain authoritative |
| FaceTime inventory | Paged lines/workers | No automatic pagination or readiness inference |
| FaceTime login/access | Device login, identity/logout and credential list/revoke | Human approval; no automatic browser flow/storage |
| FaceTime connectors | Enrollment; list/activate/drain/revoke | No connector runtime; enrollment is not activation |
| FaceTime billing | `GET /billing` status; checkout/cancel/validate_coupon actions via `POST /billing` | Signed-in user bearer plus project UUID; idempotency key on every POST; no purchase or allocation guarantee |
| Other JSON APIs | Authenticated raw request methods | No typed wrappers for every administration resource |
| Safety | No retries, redirects, cookies, ambient proxies/credentials; deadlines, bounds and redacted formatting | Cancellation or lost response does not prove absence of effects |
| Tests | Real loopback HTTP with synthetic credentials and public wire fixtures | No live calls, messages or payments |
| Exact artifact gate | ZIP allowlist, metadata/license/dependencies, empty-cache package consumer, safe example and SHA-256 | Publication requires separate authorization |

Billing status distinguishes a null entitlement from a missing/malformed response.
Typed entitlement fields describe plan, status, fulfillment and validity; unknown
response fields remain accessible. Checkout returns a URL, not an entitlement.
Cancellation is a request acknowledgement, not proof that access has ended.
See [preview migration](README.md#billing-and-preview-migration) for removal of
the earlier unsupported catalog/checkout subpaths.

## Release boundaries

Release remains held pending live contract verification and explicit approval.
Local tests do not authorize financial actions, messages, calls, credential changes
or deployment. This SDK is not a media runtime, server implementation, full vendor
adapter suite, account signup system or webhook server.
