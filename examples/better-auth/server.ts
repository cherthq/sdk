import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { phoneNumber } from 'better-auth/plugins';
import { ChertClient } from '@trychert/sdk/imessage';
import { chertPhoneOTP } from '@trychert/sdk/better-auth';

const apiKey = process.env.CHERT_API_KEY;
const secret = process.env.BETTER_AUTH_SECRET;
if (!apiKey || !secret) throw new Error('Set CHERT_API_KEY and BETTER_AUTH_SECRET.');

// Development database only: use a persistent adapter and migrations before deployment.
export const auth = betterAuth({
  baseURL: 'http://localhost:3000', secret,
  database: memoryAdapter({ user: [], session: [], account: [], verification: [], rateLimit: [] }),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: 'database', customRules: {
    '/phone-number/send-otp': { window: 60, max: 3 },
    '/phone-number/verify': { window: 60, max: 5 },
  } },
  plugins: [phoneNumber({
    otpLength: 6, expiresIn: 300, allowedAttempts: 3,
    phoneNumberValidator: value => /^\+[1-9][0-9]{1,14}(?![\s\S])/.test(value),
    sendOTP: chertPhoneOTP({ client: new ChertClient({ apiKey }),
      formatMessage: ({ code }) => `Example App verification code: ${code}. Expires in 5 minutes. Never share this code.`,
    }),
    // No signUpOnVerification: link a phone to the signed-in email account instead.
  })],
});

if (import.meta.main) Bun.serve({ hostname: '127.0.0.1', port: 3000, fetch: request => auth.handler(request) });
