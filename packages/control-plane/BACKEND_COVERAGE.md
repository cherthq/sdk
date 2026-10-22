# Backend coverage and handoff

Inspected local `chert-facetime` revision `5051335730663ae52812b764a8be1a8547945fba`, `control-plane/app/api/v1`, plus executable auth, schemas and billing source on October 23, 2026. These contracts may exist in source without deployment. This client never adds backend authority.

| Methods | Actual routes | Authorization / boundary |
| --- | --- | --- |
| beginLogin, pollLogin | POST cli/logins, cli/logins/token | Public device start; secret device code polling. Pending is HTTP 202. Credential returned once on approval. |
| inspectLogin, approveLogin | POST cli/logins/inspect, cli/logins/approve | Signed-in user; approval rechecks owner/admin membership. Human approval required. |
| whoami, logout | GET cli/whoami; POST cli/logout | whoami is project-scoped user/CLI. Logout requires an `ftu_` CLI token, revokes that token only. |
| listCredentials, revokeCredential | GET cli/credentials; DELETE cli/credentials/:id | Owner/admin browser user session and project; CLI/project API keys are refused. |
| listLines, listWorkers | GET lines, workers | Project read scope. Pages are items/total/limit/offset. No GET lines/:id route exists; select from listed authorized lines. |
| listConnectors, enrollConnector, activateConnector, drainConnector, revokeConnector | GET/POST connectors | Owner/admin user principal; existing permitted CLI owner/admin can use connector management. Enrollment returns connection/recovery secrets. Enrollment alone does not activate routing. |
| billingCatalog | GET billing/catalog | Public. Reports enabled state and test-mode plan availability; not entitlement proof. |
| currentCheckout, createCheckout | GET/POST billing/checkout | Owner browser session and project; existing CLI/project keys refused. POST requires stable Idempotency-Key, shared plan and exact current catalog version. No automatic retry. |

Worker `POST workers/:id/diagnostics` is platform-administrator-only and intentionally excluded. It cannot be offered as customer CLI readiness. There are no public worker-detail or line-read detail routes in this inspected API. Internal admin and worker credential endpoints are outside this package.

## Missing for promised one-prompt signup

- Public supported account signup + real WebAuthn/passkey registration and authentication.
- A verified-recipient challenge tied to user/account and onboarding session; expiry, attempt limits, one-time consumption, inbound sender matching and phone normalization.
- Phone identity association with the authenticated account. A locally saved CLI token is not a passkey or phone proof.
- Authorized idempotent project provisioning, paid shared-line tenant allocation, inventory, quota enforcement and entitlement lifecycle.
- Owner-approved billing authorization for coding agents. Do not widen existing CLI credentials implicitly.
- Hosted demo preparation and authorized recipient testing, plus physical call/media acceptance.

These require backend work and isolated/staging verification before production approval. The current checkout implementation is disabled by default and restricted to Stripe test keys; a complete checkout does not grant line access. Dedicated inventory remains unavailable. Never fabricate signup/verification success or substitute the website demonstration.

## Setup context an agent must provide

Determine whether to connect the personal agent's runtime or integrate a repository. Reuse existing account/project/assigned line. Explain the browser approval step, why the human is asked, what credentials stay local, and what still requires their provider/LiveKit credentials. Never collect passwords or passkeys in chat. Describe missing services directly. Distinguish signed in, connector enrolled/active, worker ready, message delivery and verified two-way media. Request an explicitly authorized recipient before a real communication test; setup alone is not consent to send or call.

## Evidence boundary

Injected-fetch unit tests cover path, method, headers, body, pending authentication, permission failure, no retry and secret-redacted errors. They do not establish a deployed API, working user signup, live payment, actual allocation, phone verification, or FaceTime media. No remote mutation was performed for this package.
