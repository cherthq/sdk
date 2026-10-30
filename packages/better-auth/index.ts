import { type ChertClient } from '@cherthq/imessage';

export type PhoneOTP = { phoneNumber: string; code: string };
export type ChertOTPOptions = {
  client: Pick<ChertClient, 'sendText'>;
  /** Must include the code. Do not claim delivery or invent an expiry here. */
  formatMessage: (otp: Readonly<PhoneOTP>) => string;
};

/** The request may have been accepted. Do not retry or fall back without reconciliation. */
export class ChertOTPDeliveryError extends Error {
  readonly outcome = 'unconfirmed';
  constructor(cause: unknown) {
    super('Verification message outcome unconfirmed. Do not resend or switch channels without reconciliation.', { cause });
    this.name = 'ChertOTPDeliveryError';
  }
}

/**
 * Better Auth phoneNumber({ sendOTP }) transport. Server only; no OTP storage or verification.
 * This hook does not enforce an iMessage-only channel policy or prevent OS-level SMS fallback.
 */
export function chertPhoneOTP({ client, formatMessage }: ChertOTPOptions): (otp: PhoneOTP) => Promise<void> {
  return async ({ phoneNumber, code }) => {
    if (typeof phoneNumber !== 'string' || !/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(phoneNumber)
      || typeof code !== 'string' || !/^[0-9]{4,12}(?![\s\S])/.test(code))
      throw new TypeError('Expected an E.164 phone number and a 4–12 digit verification code.');
    const body = formatMessage({ phoneNumber, code });
    if (typeof body !== 'string' || !body.includes(code))
      throw new TypeError('Verification message must include the code.');
    try {
      // One send only. Better Auth owns issuance and expiry; acceptance is not delivery.
      await client.sendText({ phone: phoneNumber, body });
    } catch (cause) {
      // Until refusals are documented as definitely unsent, all send failures fail closed.
      throw new ChertOTPDeliveryError(cause);
    }
  };
}
