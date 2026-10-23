import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { CLIError } from '../cli/errors.js';
import type { Credential } from '../cli/login.js';
import { Fault } from '../protocol/v1.js';
import { boundedText, hostedOrigin } from '../transport/http.js';
import { printable } from './frame.js';

export const cliCredentialPattern = /^ftu_[A-Za-z0-9_-]{43}$/;
const startedSchema = z.object({ device_code: z.string().regex(/^fdc_[A-Za-z0-9_-]{43}$/), user_code: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
  verification_url: z.string().url(), verification_url_complete: z.string().url(),
  expires_in: z.number().int().positive().max(3600), interval: z.number().int().positive().max(60) });
// Only what the credential cannot work without is strict. The credential is handed over once, so a cosmetic field
// that is too long or missing must not throw it away.
const approvedSchema = z.object({ status: z.literal('approved'), access_token: z.string().regex(cliCredentialPattern), email: z.string().nullish(),
  project: z.object({ id: z.string().uuid(), name: z.string().nullish() }), device_name: z.string().nullish(), expires_in: z.number().int().positive() });

/** Starting a login can be asked again. The answer to a poll cannot: it may be the only copy of the credential, so it is waited for longer. */
const START_TIMEOUT_MS = 10_000, POLL_TIMEOUT_MS = 60_000;

export interface DeviceLoginDeps {
  fetch: typeof fetch;
  pause(ms: number, signal: AbortSignal): Promise<void>;
  /** Opens the address in the default browser. False when there is no browser to open. */
  open(url: string): Promise<boolean>;
  now(): number;
}
export interface DeviceLoginInput { origin: string; deviceName: string; openBrowser: boolean; onboardingRequestKey?: string; signal: AbortSignal; emit(record: Record<string, unknown>): void }

/** The name shown on the approval page, so the person approving can recognise their own computer. */
export function deviceName(): string {
  const name = hostname().replace(/\.(local|lan|home)$/i, '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80);
  return name || 'This computer';
}

/** macOS `open` or Linux `xdg-open`, detached. No shell is involved and the address is passed as one argument. */
export async function openInBrowser(url: string): Promise<boolean> {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise(resolve => {
    try {
      const child = spawn(command, [url], { stdio: 'ignore', detached: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

export const deviceLoginDeps: DeviceLoginDeps = {
  fetch: (input, init) => fetch(input, init),
  pause: (ms, signal) => sleep(ms, undefined, { signal }).catch(() => {}),
  open: openInBrowser,
  now: () => Date.now(),
};

/**
 * Sign in without a secret ever passing through the terminal: Chert issues a short code, a signed-in owner or admin
 * approves it in the browser, and this process collects a credential for that one project.
 */
export async function deviceLogin(input: DeviceLoginInput, deps: DeviceLoginDeps = deviceLoginDeps): Promise<Credential> {
  let base: URL;
  try { base = hostedOrigin(input.origin); } catch { throw new CLIError('invalid_origin', 2, 'The Chert address must be https://HOST with no path or credentials.'); }
  if (input.onboardingRequestKey && !z.string().uuid().safeParse(input.onboardingRequestKey).success) throw new CLIError('invalid_onboarding_scope', 2, 'The saved browser setup key is invalid.');
  const invalid = () => new CLIError('backend_response_invalid', 6, 'Chert returned an unexpected response. Update the CLI, or try again shortly.');
  const unreachable = () => new CLIError('backend_unreachable', 6, 'Could not reach Chert. Check the network and try again.');
  const cancelled = () => new CLIError('login_cancelled', 130, 'Sign-in cancelled. Nothing was saved.');
  const post = (path: string, body: unknown, timeoutMs: number) => deps.fetch(new URL(path, base), { method: 'POST', redirect: 'error', signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = async (response: Response): Promise<unknown> => (JSON.parse(await boundedText(response, 16384)) as { data: unknown }).data;

  let response: Response;
  try { response = await post('/api/v1/cli/logins', { device_name: input.deviceName }, START_TIMEOUT_MS); }
  catch { throw input.signal.aborted ? cancelled() : unreachable(); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 405) throw new CLIError('login_unsupported', 6, 'This Chert server does not offer browser sign-in yet. Use chert login --with-token < token.txt');
    if (response.status === 429) throw new CLIError('login_busy', 6, 'Chert has too many sign-ins waiting. Try again in a few minutes.');
    throw new CLIError('login_unavailable', 6, 'Chert could not start a sign-in. Try again shortly.');
  }
  let started: z.infer<typeof startedSchema>;
  try { started = startedSchema.parse(await data(response)); } catch { throw invalid(); }
  // A Chert server puts the approval page on its own origin. The address the developer is sent to must be on the origin
  // that was asked, whatever the response says, and it is printed, copied and opened as the raw string, so it must be
  // plain printable ASCII (an address is, by construction).
  const page = new URL(started.verification_url), direct = new URL(started.verification_url_complete);
  if ([page, direct].some(url => url.protocol !== 'https:') || /[^\x21-\x7e]/.test(started.verification_url) || /[^\x21-\x7e]/.test(started.verification_url_complete)) throw invalid();
  const elsewhere = [page, direct].find(url => url.origin !== base.origin);
  if (elsewhere) throw new CLIError('login_origin_mismatch', 6, `This Chert server sent a sign-in page on a different address (${elsewhere.host}). Update the CLI or check --backend.`);
  if (direct.pathname !== page.pathname || direct.searchParams.get('code') !== started.user_code) throw invalid();

  if (input.onboardingRequestKey) {
    page.searchParams.set('onboard', input.onboardingRequestKey);
    direct.searchParams.set('onboard', input.onboardingRequestKey);
    started.verification_url = page.href; started.verification_url_complete = direct.href;
  }
  const address = started.verification_url.replace(/^https:\/\//, '');
  const opened = input.openBrowser && await deps.open(started.verification_url_complete);
  if (input.openBrowser && !opened) input.emit({ code: 'login_browser_unavailable', message: 'Could not open a browser on this computer.' });
  input.emit({ code: 'login_code', user_code: started.user_code, verification_url: started.verification_url, verification_url_complete: started.verification_url_complete,
    expires_in: started.expires_in, browser_opened: opened,
    message: input.onboardingRequestKey
      ? `${opened ? 'Your browser is open.' : `Open ${started.verification_url_complete}.`} Confirm that the browser shows this sign-in code:\n\n    ${started.user_code}\n\nSign in, enter your name and number, then text the displayed phone verification code. Waiting for setup… (Ctrl+C to pause)`
      : opened
      ? `Your browser is open at ${address}\nConfirm that it shows this code, then approve:\n\n    ${started.user_code}\n\nWaiting for approval… (Ctrl+C to cancel)`
      : `Open ${started.verification_url} on any device and enter this code:\n\n    ${started.user_code}\n\nWaiting for approval… (Ctrl+C to cancel)` });

  const expired = () => new CLIError('login_expired', 3, `The sign-in code expired before it was approved. Run chert ${input.onboardingRequestKey ? 'onboard' : 'login'} again.`);
  const interrupted = () => new CLIError('login_interrupted', 3, `This sign-in was cut off before Chert's answer reached this computer, and the code can no longer be used. Run chert ${input.onboardingRequestKey ? 'onboard' : 'login'} again. `
    + 'If the code had been approved, a credential was issued that this computer does not hold: a project owner or admin can revoke it from the Chert dashboard.');
  const deadline = deps.now() + started.expires_in * 1000;
  // Chert marks the login redeemed before it replies, so a poll whose answer never arrived may have been the one that
  // carried the credential. Only an answer that the login is still waiting rules that out.
  let lost = false;
  for (;;) {
    await deps.pause(started.interval * 1000, input.signal);
    if (input.signal.aborted) throw cancelled();
    if (deps.now() > deadline) throw lost ? interrupted() : expired();
    let poll: Response;
    try { poll = await post('/api/v1/cli/logins/token', { device_code: started.device_code }, POLL_TIMEOUT_MS); }
    catch { if (input.signal.aborted) throw cancelled(); lost = true; continue; }
    if (poll.status === 404 || poll.status === 410) { await poll.body?.cancel(); throw lost ? interrupted() : expired(); }
    // Still waiting, or a passing fault: ask again. Any other refusal will not change by asking again.
    if (poll.status === 202 || poll.status === 408 || poll.status === 429 || poll.status >= 500) {
      await poll.body?.cancel();
      // A 5xx may be a gateway answering in Chert's place: it says nothing about what the request did there.
      if (poll.status === 202) lost = false; else if (poll.status >= 500) lost = true;
      continue;
    }
    if (poll.status !== 200) { await poll.body?.cancel(); throw new CLIError('login_unavailable', 6, 'Chert refused this sign-in. Update the CLI, then run chert login again.'); }
    let text: string;
    // A body that stops arriving is the same loss as a reply that never came; a body that is not an answer is refused.
    try { text = await boundedText(poll, 16384); }
    catch (error) { if (input.signal.aborted) throw cancelled(); if (error instanceof Fault) throw invalid(); lost = true; continue; }
    let answer: unknown;
    try { answer = (JSON.parse(text) as { data: unknown }).data; } catch { throw invalid(); }
    if ((answer as { status?: unknown } | null)?.status === 'pending') { lost = false; continue; }
    const parsed = approvedSchema.safeParse(answer);
    if (!parsed.success) throw invalid();
    const approved = parsed.data;
    const email = printable(approved.email, 320), project = printable(approved.project.name, 200), device = printable(approved.device_name, 200);
    return { access_token: approved.access_token, expires_at: deps.now() + approved.expires_in * 1000, ...(email ? { email } : {}), kind: 'cli',
      ...(input.onboardingRequestKey ? { onboarding_request_key: input.onboardingRequestKey } : {}),
      project_id: approved.project.id, ...(project ? { project_name: project } : {}), ...(device ? { device_name: device } : {}), origin: base.origin };
  }
}

/**
 * Ask Chert to revoke a command-line credential. True when Chert revoked it now; false when Chert answers that there
 * was nothing left to revoke (it had already ended). Throws when Chert said neither.
 */
export async function revokeCredential(origin: string, token: string, request: typeof fetch = deviceLoginDeps.fetch): Promise<boolean> {
  if (!cliCredentialPattern.test(token)) throw new Error('not_revocable');
  const response = await request(new URL('/api/v1/cli/logout', hostedOrigin(origin)), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('revocation_failed'); }
  return z.object({ data: z.object({ revoked: z.boolean() }) }).parse(JSON.parse(await boundedText(response, 16384))).data.revoked;
}
