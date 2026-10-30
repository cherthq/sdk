import { expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { phoneNumber } from 'better-auth/plugins';
import { ChertClient, ChertAPIError } from '../imessage/src/index.js';
import { chertPhoneOTP, ChertOTPDeliveryError } from './index.js';

const otp = { phoneNumber: '+15555550123', code: '190284' };
const formatMessage = ({ code }: { code: string }) => `Example verification code: ${code}.`;

test('Better Auth hook sends once through the strict public send route for every accepted status', async () => {
  for (const status of ['queued', 'sent', 'duplicate']) {
    const requests: unknown[] = [];
    const client = new ChertClient({ apiKey: 'fixture', fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ status, message_id: 'message_123', chat_id: 'chat_123' }, { status: status === 'queued' ? 202 : 200 });
    } });
    const sendOTP = chertPhoneOTP({ client, formatMessage });
    const plugin = phoneNumber({ sendOTP }); // Compile against the real extension point.
    if (!plugin.options) throw new Error('Missing plugin options');
    await plugin.options.sendOTP(otp);
    expect(requests).toEqual([{ url: 'https://console.trychert.com/api/v1/send', body: { phone: otp.phoneNumber, body: formatMessage(otp) } }]);
  }
});

test('uncertain sends never retry or fall back, and retain the cause without including the code', async () => {
  for (const cause of [new TypeError('network failure'), new ChertAPIError(502, 'unconfirmed_text_outcome', 'unconfirmed'), new ChertAPIError(429, 'rate_limited', 'limited')]) {
    let attempts = 0;
    const sendOTP = chertPhoneOTP({ client: { async sendText() { attempts++; throw cause; } }, formatMessage });
    try { await sendOTP(otp); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ChertOTPDeliveryError);
      if (!(error instanceof ChertOTPDeliveryError)) throw error;
      expect(error.outcome).toBe('unconfirmed');
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(otp.code);
    }
    expect(attempts).toBe(1);
  }
});

test('email handles are not phone identifiers, and missing codes never dispatch', async () => {
  let attempts = 0;
  const client = { async sendText(): Promise<never> { attempts++; throw new Error('must not send'); } };
  for (const phoneNumber of ['person@example.com', '+15555550123\n', '15555550123'])
    await expect(chertPhoneOTP({ client, formatMessage })({ ...otp, phoneNumber })).rejects.toBeInstanceOf(TypeError);
  await expect(chertPhoneOTP({ client, formatMessage: () => 'Missing code' })(otp)).rejects.toBeInstanceOf(TypeError);
  expect(attempts).toBe(0);
});

test('real Better Auth retains email login while attaching and consuming a verified phone on the same account', async () => {
  let code = '';
  const auth = betterAuth({
    baseURL: 'http://localhost:3000', secret: 'fixture-secret-at-least-32-characters-long',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], rateLimit: [] }), emailAndPassword: { enabled: true },
    plugins: [phoneNumber({
      phoneNumberValidator: value => /^\+[1-9][0-9]{1,14}$/.test(value),
      sendOTP: chertPhoneOTP({ formatMessage, client: new ChertClient({ apiKey: 'fixture', fetch: async (_, init) => {
        code = String(JSON.parse(String(init?.body)).body).match(/\b[0-9]{6}\b/)?.[0] ?? '';
        return Response.json({ status: 'queued', message_id: 'm1', chat_id: 'c1' }, { status: 202 });
      } }) }), expiresIn: 300, allowedAttempts: 3,
    })],
  });
  const post = (path: string, body: unknown, cookie = '') => auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', cookie }, body: JSON.stringify(body),
  }));
  const account = { email: 'person@example.com', password: 'a-long-fixture-password', name: 'Example' };
  const signup = await post('/sign-up/email', account);
  expect(signup.status).toBe(200);
  const cookie = signup.headers.get('set-cookie')?.split(';')[0] ?? '';
  expect(cookie).not.toBe('');
  expect((await post('/phone-number/send-otp', { phoneNumber: otp.phoneNumber }, cookie)).status).toBe(200);
  expect(code).toMatch(/^[0-9]{6}$/);
  const verified = await post('/phone-number/verify', { phoneNumber: otp.phoneNumber, code, updatePhoneNumber: true }, cookie);
  expect(verified.status).toBe(200);
  expect(await verified.json()).toMatchObject({ status: true, user: { email: account.email, phoneNumber: otp.phoneNumber, phoneNumberVerified: true } });
  expect((await post('/phone-number/verify', { phoneNumber: otp.phoneNumber, code }, cookie)).status).toBe(400);
  const emailLogin = await post('/sign-in/email', account);
  expect(emailLogin.status).toBe(200);
  expect(await emailLogin.json()).toMatchObject({ user: { email: account.email, phoneNumber: otp.phoneNumber, phoneNumberVerified: true } });
  expect((await post('/phone-number/send-otp', { phoneNumber: otp.phoneNumber })).status).toBe(200);
  const phoneLogin = await post('/phone-number/verify', { phoneNumber: otp.phoneNumber, code });
  expect(phoneLogin.status).toBe(200);
  expect(await phoneLogin.json()).toMatchObject({ user: { email: account.email, phoneNumber: otp.phoneNumber, phoneNumberVerified: true } });
});

test('Better Auth owns expiry, wrong-code limits and request throttling', async () => {
  for (const scenario of ['expiry', 'attempts', 'rate']) {
    let code = '';
    let sends = 0;
    const auth = betterAuth({
      baseURL: 'http://localhost:3000', secret: 'fixture-secret-at-least-32-characters-long',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [], rateLimit: [] }),
      rateLimit: { enabled: scenario === 'rate', storage: 'database', customRules: { '/phone-number/send-otp': { window: 60, max: 1 } } },
      plugins: [phoneNumber({ expiresIn: scenario === 'expiry' ? 1 : 300, allowedAttempts: 1,
        sendOTP: chertPhoneOTP({ formatMessage, client: { async sendText(input) {
          sends++; code = input.body.match(/\b[0-9]{6}\b/)?.[0] ?? '';
          return { success: true, status: 'queued', message_id: 'm1', chat_id: 'c1' };
        } } }),
      })],
    });
    const post = (path: string, body: unknown) => auth.handler(new Request(`http://localhost:3000/api/auth/phone-number/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': '127.0.0.1' }, body: JSON.stringify(body),
    }));
    expect((await post('send-otp', { phoneNumber: otp.phoneNumber })).status).toBe(200);
    if (scenario === 'rate') {
      expect((await post('send-otp', { phoneNumber: otp.phoneNumber })).status).toBe(429);
      expect(sends).toBe(1);
    } else {
      if (scenario === 'expiry') await Bun.sleep(1100);
      else expect((await post('verify', { phoneNumber: otp.phoneNumber, code: code === '999999' ? '111111' : '999999' })).status).toBe(400);
      const result = await post('verify', { phoneNumber: otp.phoneNumber, code });
      expect(result.ok).toBe(false);
      expect(await result.json()).toMatchObject({ code: scenario === 'expiry' ? 'OTP_EXPIRED' : 'TOO_MANY_ATTEMPTS' });
    }
  }
});
