import { createAuthClient } from 'better-auth/client';
import { phoneNumberClient } from 'better-auth/client/plugins';

// Browser integration. Existing email verification/reset plugins can remain enabled.
export const authClient = createAuthClient({ baseURL: 'http://localhost:3000', plugins: [phoneNumberClient()] });

export async function createEmailAccount(email: string, password: string, name: string) {
  return authClient.signUp.email({ email, password, name });
}
export async function signInWithEmail(email: string, password: string) {
  return authClient.signIn.email({ email, password });
}
// Call while signed into the email account, then collect the code from iMessage.
export async function sendPhoneCode(phoneNumber: string) {
  return authClient.phoneNumber.sendOtp({ phoneNumber });
}
export async function attachPhone(phoneNumber: string, code: string) {
  return authClient.phoneNumber.verify({ phoneNumber, code, updatePhoneNumber: true });
}
// After attachment, the SAME account can also sign in by requesting and verifying a fresh phone code.
export async function signInWithPhone(phoneNumber: string, code: string) {
  return authClient.phoneNumber.verify({ phoneNumber, code });
}
