# FaceTime API coverage

Paths below are relative to `/api/v1`. A supported SDK method does not guarantee
that a service feature is enabled for your project. Authorization is enforced by
the service; the SDK does not upgrade or exchange credentials implicitly.

| Methods | Routes | Credentials and behavior |
| --- | --- | --- |
| beginLogin, pollLogin | POST cli/logins, cli/logins/token | No bearer token. Keep the device code secret; respect polling interval and expiry. |
| inspectLogin, approveLogin | POST cli/logins/inspect, cli/logins/approve | Signed-in user; human project approval required. |
| whoami, logout | GET cli/whoami; POST cli/logout | Inspect the current project identity; logout revokes the supplied CLI credential. |
| listCredentials, revokeCredential | GET cli/credentials; DELETE cli/credentials/:id | Signed-in project owner/admin. |
| listLines, listWorkers | GET lines, workers | Project read permission; explicit pagination. |
| listConnectors, enrollConnector, activateConnector, drainConnector, revokeConnector | GET/POST connectors | Authorized owner/admin; enrollment returns credentials that must not be logged. Enrollment does not imply activation. |
| billingStatus | GET billing | Signed-in user and project UUID. Returns entitlement (possibly null), reconciliation and availability flags. |
| createCheckout | POST billing | `{action:'checkout',plan:'shared'\|'dedicated',coupon_code?}`; returns `{url}`. |
| cancelSubscription | POST billing | `{action:'cancel'}`; returns a cancellation request acknowledgment, not immediate loss of access. |
| validateCoupon | POST billing | `{action:'validate_coupon',coupon_code}`; returns discount information. |

All billing methods require a signed-in user token and owner/admin project
membership. CLI, worker and project API keys cannot substitute for a user session.
Each billing POST requires a caller-owned `Idempotency-Key` of 8–200 characters
after trimming. The SDK does not retry payments or other requests automatically.
Refresh billing status after checkout or cancellation; a checkout URL or browser
redirect is not proof of an active entitlement or an assigned line. Availability
and coupon eligibility are service-controlled; the SDK promises no inventory.

## Preview migration

The successor removes `billingCatalog`, `currentCheckout` and `BillingCatalog`:
there is no equivalent public catalog or checkout-lifecycle API. Use
`billingStatus()` for current entitlement and availability. `createCheckout`
now accepts `{plan, coupon_code?}` and returns `{url}`; the former
`{plan_id, catalog_version}` request and checkout-row response are not compatible.
Update consumers explicitly rather than treating checkout completion as access.
This does not change installed versions of the published `@trychert/sdk` package.

## Limits

Use an existing account and authorized project. This SDK does not register
accounts, collect passwords/passkeys, provision a personal iMessage number, or
implement a media runtime. Verify feature availability before sending messages,
placing calls, or purchasing service. Tests use synthetic credentials and local
HTTP/fetch fixtures; they do not establish live payment, delivery or media success.
