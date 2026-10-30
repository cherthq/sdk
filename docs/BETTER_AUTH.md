# Better Auth: iMessage phone transport alongside email

**Source preview; not included in npm 0.2.3.** This integration adds the server-only
`@trychert/sdk/better-auth` subpath in the next SDK release. It is not a separate
auth system or package. Better Auth is optional: the SDK transport has no Better
Auth runtime dependency. Tested against Better Auth 1.7.14's
[phone-number sendOTP hook](https://www.better-auth.com/docs/plugins/phone-number).

Better Auth generates and stores codes, verifies them, consumes them and enforces
expiry and attempt limits. Chert sends one plaintext message through
`ChertClient.sendText` (`POST /api/v1/send`). Keep the Chert key server-side.
Use a Chert messaging credential with a working iMessage line; a FaceTime key is
not a messaging key. This transport cannot select or provision a sender line.
**It does not guarantee iMessage-only delivery or prevent device-level SMS
fallback. Do not use this preview where that guarantee is required.**

## Run the example from this checkout

```sh
bun install --frozen-lockfile
bun run build
CHERT_API_KEY=... BETTER_AUTH_SECRET=... bun examples/better-auth/server.ts
```

Use a random Better Auth secret of at least 32 characters, not the literal `...`.
The HTTP-only example listens on loopback port 3000 and exposes Better Auth's
`/api/auth/*` endpoints. It uses a disposable in-memory database, not production
storage. Browser integration functions are in
[`examples/better-auth/client.ts`](../examples/better-auth/client.ts).

1. Create an account with `authClient.signUp.email({ email, password, name })`.
2. While signed in, call `authClient.phoneNumber.sendOtp({ phoneNumber })`.
3. Enter the received code using
   `authClient.phoneNumber.verify({ phoneNumber, code, updatePhoneNumber: true })`.
4. The same account now has its original email **and** a verified phone number.
   `signIn.email` still works; a fresh `sendOtp` + `verify` can sign in by phone.

Email is not replaced. Keep existing email verification, email OTP, password
reset or magic-link plugins and mail sender configured as before. The example
supports email/password login; it does not send verification email or claim that
the email address is verified. No synthetic email or phone-only auto-signup is
enabled. An email address cannot be supplied to the phone hook in place of an
E.164 phone number.

## Configure the hook

```ts
import { phoneNumber } from 'better-auth/plugins';
import { ChertClient } from '@trychert/sdk/imessage';
import { chertPhoneOTP } from '@trychert/sdk/better-auth';

const apiKey = process.env.CHERT_API_KEY;
if (!apiKey) throw new Error('Set CHERT_API_KEY.');
const plugin = phoneNumber({
  otpLength: 6, expiresIn: 300, allowedAttempts: 3,
  phoneNumberValidator: value => /^\+[1-9][0-9]{1,14}(?![\s\S])/.test(value),
  sendOTP: chertPhoneOTP({
    client: new ChertClient({ apiKey }),
    formatMessage: ({ code }) => `Your Example App code is ${code}. Expires in 5 minutes.`,
  }),
});
```

The hook accepts 4–12 digit codes and E.164 recipients. `formatMessage` must
include the exact code; keep the stated expiry consistent with `expiresIn`.
Better Auth's separate `sendPasswordResetOTP` hook is **not** enabled implicitly;
configure a purpose-specific transport there if phone password reset is wanted.

## Acceptance, limitations and abuse protection

- `queued`, `sent` and `duplicate` receipts mean server acceptance/dispatch,
  **not delivery or successful verification**. Only Better Auth's verify endpoint
  establishes phone ownership. The hook resolves to `void`, as Better Auth expects.
- A send failure throws `ChertOTPDeliveryError` with `outcome: 'unconfirmed'` and
  the original `cause`. This intentionally includes refusals whose definitely-unsent
  semantics are not yet a documented contract. Inspect the cause server-side;
  never serialize it or OTP/request bodies into public responses or logs.
- No automatic retry, fallback, lookup probe or second code is sent. Timeouts,
  malformed success receipts and upstream failures can follow acceptance. Do not
  switch to SMS or resend after these without reconciliation. The transport cannot
  determine whether a recipient supports iMessage or guarantee that a non-iMessage
  recipient will be rejected. SDK-managed SMS fallback is **not available yet**,
  pending a documented definitive-unsent refusal contract.
- Sender-email refusal mapping and its friendly error copy are **not available
  yet**, pending the backend contract. Do not promise that an Apple ID email sender
  works, or confuse email account login with an iMessage sender identity.
- Phone-format validation is not an iMessage reachability check. This adapter
  makes no OS-level SMS-fallback-prevention guarantee; require a separately
  verified line policy if your application must never use SMS.
- Await the hook if immediate failure propagation matters. Better Auth 1.7.14 can
  run sends in its configured background-task handler; then an HTTP success does
  not prove even transport acceptance. Account-enumeration/timing protection is
  the app's responsibility; use uniform responses and never detach an unhandled promise.
- Better Auth defaults to 300-second expiry, three attempts and phone-plugin
  throttling of 10 requests per 60 seconds when its rate limiter is enabled. The
  example explicitly enables database-backed throttling (in-memory in this demo)
  with stricter send/verify rules. In production add durable per-phone/account issuance limits, IP abuse
  protection, spend caps and consent controls. This transport has no process-local
  limiter that would silently reset across workers.
- Better Auth stores a verification value before sending. A failed send does not
  mean no code exists; don't turn a transport exception into an alternate login
  proof. Run Better Auth migrations, configure persistent storage and review its
  OTP storage/atomic-consumption guarantees for your deployment.
- A delivered code persists in the recipient's Messages app and Apple's storage;
  server-side redaction cannot remove those copies. SMS has the same inherent
  recipient-side persistence limitation. Keep codes short-lived and single-use,
  with expiry and consumption enforced by Better Auth, not by this transport.
