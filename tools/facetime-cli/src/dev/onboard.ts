import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { privateFile } from '../cli/config.js';
import { CLIError } from '../cli/errors.js';
import { boundedText, hostedOrigin } from '../transport/http.js';
import { deviceLoginDeps, type DeviceLoginDeps } from './device-login.js';

const uuid = z.string().uuid();
const resumeSchema = z.strictObject({ request_key: uuid, session_id: uuid.optional() });
export type OnboardingResume = z.infer<typeof resumeSchema>;
export interface OnboardingStore { load(): OnboardingResume | undefined; create(): OnboardingResume; save(value: OnboardingResume): void; clear(): void }
const sessionSchema = z.object({ id: uuid, status: z.enum(['awaiting_verification', 'ready', 'demo_running', 'complete', 'cancelled', 'expired']),
  verification_url: z.string().url(), expires_at: z.string().datetime({ offset: true }),
  line: z.object({ id: uuid, receiving_number: z.string().regex(/^\+[1-9][0-9]{6,14}$/) }), demo_call_id: uuid.nullish() });
export type OnboardingSession = z.infer<typeof sessionSchema>;

/** Where a project's resume key lives: one file per control plane and project, named by a digest of both. */
function onboardingFile(home: string, origin: string, project: string): string {
  return join(home, 'onboarding', `${createHash('sha256').update(JSON.stringify([origin, project])).digest('hex')}.json`);
}
/** The project went through `chert onboard` here (a saved session, readable or not): it reaches a pool line through a shared allocation. */
export function onboardingSaved(home: string, origin: string, project: string): boolean { return existsSync(onboardingFile(home, origin, project)); }
/** Resume keys live beside credentials, but never include phone numbers, verification codes or provider secrets. */
export function onboardingStore(home: string, origin: string, project: string): OnboardingStore {
  const file = onboardingFile(home, origin, project);
  const dir = join(home, 'onboarding');
  const prepare = () => { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); };
  const load = () => {
    if (!existsSync(file)) return undefined;
    try { privateFile(file, 4096); return resumeSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); }
    catch { throw new CLIError('onboarding_state_unreadable', 4, 'The saved onboarding state is unreadable or unsafe. Restore its owner-only file before retrying; do not discard an uncertain demo request.'); }
  };
  const write = (path: string, value: OnboardingResume) => {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(resumeSchema.parse(value)) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  };
  return {
    load,
    create() {
      prepare();
      const value = { request_key: randomUUID() };
      try { write(file, value); return value; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return load()!; throw error; }
    },
    save(value) {
      prepare(); const temp = `${file}.${randomUUID()}.tmp`;
      try { write(temp, value); renameSync(temp, file); } finally { if (existsSync(temp)) unlinkSync(temp); }
    },
    clear() { if (existsSync(file)) { privateFile(file, 4096); unlinkSync(file); } },
  };
}

export interface OnboardingInput {
  origin: string; token: string; project: string; signal: AbortSignal; openBrowser: boolean;
  statusOnly?: boolean; cancel?: boolean; restart?: boolean; skipDemo?: boolean; waitSeconds?: number;
  emit(record: Record<string, unknown>): void;
}
const actions: Record<string, string> = {
  shared_worker_upgrade_required: 'This line has not passed shared-call qualification. Your onboarding state is saved; retry after Chert qualifies the line.',
  line_busy: 'The physical line is serving a call or awaiting cleanup. No demo is queued. Resume chert onboard once Chert confirms it is available.',
  outbound_unavailable: 'The assigned line has not been qualified for the hosted outbound audio/video demo. Your verification is saved; contact Chert support.',
  shared_line_incompatible: 'This selected line has not passed shared-call qualification. Your onboarding state is saved; contact Chert support.',
  shared_cleanup_pending: 'The physical line is waiting for confirmed cleanup of its previous call. No demo is queued. Resume chert onboard after Chert confirms the line is available.',
  outbound_audio_unsupported: 'The assigned line cannot currently place the outbound audio demo. Your verification is saved; contact Chert support.',
  outbound_video_unsupported: 'The assigned line cannot currently place the outbound video demo. Your verification is saved; contact Chert support.',
  outbound_disabled: 'The hosted outbound demo is temporarily unavailable. Your verification is saved; retry chert onboard after Chert enables it.',
  trial_exhausted: 'This account has already used its trial grant. Reuse your existing project or review billing; restarting onboarding does not reset the trial.',
  shared_trial_exhausted: 'This account has already used its trial. Your project is saved; restarting onboarding does not reset the trial.',
  shared_trial_unconfigured: 'Trial onboarding is not available yet. Your request is saved; retry after Chert opens the pilot.',
  shared_entitlement_expired: 'This project entitlement expired. Your project is saved, but new work is paused; review billing to reactivate subject to line availability.',
  shared_allocation_draining: 'The old allocation still has cleanup or usage obligations. Your project is saved; wait for Chert to reconcile it before requesting another line.',
  trial_auth_required: 'Confirm your signed-in account in the browser before requesting trial credit.',
  shared_no_capacity: 'All eligible shared project slots are occupied. No request is queued. Retry chert onboard later; your request key is saved.',
  shared_allocation_unavailable: 'The shared allocation is no longer available. Inspect chert onboard --status, then restart after this session expires or is cancelled.',
  shared_project_has_dedicated_line: 'This project already has a dedicated line. Keep using chert dev for that project, or choose a different project for shared onboarding.',
  shared_session_expired: 'This onboarding session expired or was cancelled. Inspect chert onboard --status, then use --restart when ready.',
  shared_pool_unavailable: 'Shared onboarding is not enabled for this project yet. Your existing line and agent are unchanged.',
  shared_recipient_conflict: 'This phone already routes to another project on the allocated line. Return to the verification page for a compatible allocation.',
  recipient_verification_required: 'Complete the inbound iMessage verification in the browser before requesting the demo.',
  recipient_not_verified: 'Complete the inbound iMessage verification in the browser before requesting the demo.',
  recipient_confirmation_pending: 'The verification reply is still pending. Run chert onboard again shortly.',
  free_credit_required: 'This project needs an approved FaceTime credit grant before the demo can run.',
  credit_exhausted: 'This project has insufficient FaceTime credit for the demo. Your verification is saved; retry after an approved credit grant.',
  shared_minutes_limit: 'This project has used its daily FaceTime allowance. Retry after the next UTC day starts.',
  shared_contact_limit: 'This project has reached its lifetime contact limit. Removing a contact or changing lines does not reset it.',
  shared_quota_exceeded: 'The project has reached its shared usage allowance. Retry after the allowance resets.',
  shared_line_busy: 'The physical line is serving a call or awaiting cleanup. No demo is queued. Run chert onboard again when it is available.',
  onboarding_expired: 'This onboarding session expired. Run chert onboard --restart to begin a new verification.',
  demo_unavailable: 'The hosted demo is not configured for this shared line yet. Your verification is saved; retry when the pilot is enabled.',
};

/** Compose existing project login, shared allocation and hosted demo APIs. No connector protocol or provider credential changes. */
export async function runOnboarding(input: OnboardingInput, store: OnboardingStore, deps: DeviceLoginDeps = deviceLoginDeps): Promise<number> {
  let base: URL;
  try { base = hostedOrigin(input.origin); uuid.parse(input.project); } catch { throw new CLIError('invalid_onboarding_scope', 2, 'Use a valid Chert HTTPS origin and the project approved during browser sign-in.'); }
  const cancelled = () => new CLIError('onboarding_interrupted', 130, 'Onboarding paused. Run chert onboard to resume, or chert onboard --cancel to cancel new work. Any admitted call keeps its normal cleanup.');
  const invalid = () => new CLIError('backend_response_invalid', 6, 'Chert returned an unexpected onboarding response. Your resume state is retained; update the CLI or retry shortly.');
  if (input.signal.aborted) throw cancelled();
  async function request(path: string, method = 'GET', requestKey?: string): Promise<OnboardingSession> {
    if (input.signal.aborted) throw cancelled();
    let response: Response;
    try {
      response = await deps.fetch(new URL(path, base), { method, redirect: 'error', signal: AbortSignal.any([input.signal, AbortSignal.timeout(10000)]),
        headers: { authorization: `Bearer ${input.token}`, 'x-chert-project-id': input.project, 'content-type': 'application/json', ...(requestKey ? { 'idempotency-key': requestKey } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}) });
    } catch { throw input.signal.aborted ? cancelled() : new CLIError('backend_unreachable', 6, 'Could not reach Chert. Run chert onboard again to resume the same request; no new project or demo is requested.'); }
    let body: unknown;
    try { body = JSON.parse(await boundedText(response, 16384)); } catch { throw input.signal.aborted ? cancelled() : invalid(); }
    if (!response.ok) {
      const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
      const known = code.success && Object.hasOwn(actions, code.data.error.code) ? code.data.error.code : undefined;
      if (known) {
        const billing = new URL('/billing', base);
        billing.searchParams.set('project', input.project);
        const needsBilling = ['trial_exhausted', 'shared_trial_exhausted', 'shared_entitlement_expired', 'credit_exhausted'].includes(known);
        throw new CLIError(known, 3, actions[known]! + (needsBilling ? ` Manage this project: ${billing.toString()}` : ''));
      }
      if (response.status === 401) throw new CLIError('login_required', 3, 'Your Chert sign-in expired or was revoked. Run chert login, then chert onboard to resume.');
      if (response.status === 403) throw new CLIError('onboarding_forbidden', 3, 'This onboarding belongs to its initiating project owner or admin. Sign in as that person; project API keys cannot approve verification.');
      if (response.status === 404 || response.status === 405) throw new CLIError('onboarding_unavailable', 6, 'This Chert server does not have this onboarding session or feature. Check the server and saved project before starting again.');
      throw new CLIError('onboarding_not_ready', 6, 'Chert could not continue onboarding. The saved request can be retried with chert onboard; do not start another demo.');
    }
    const parsed = z.object({ data: sessionSchema }).safeParse(body);
    if (!parsed.success) throw invalid();
    const session = parsed.data.data;
    let page: URL;
    try { page = new URL(session.verification_url); } catch { throw invalid(); }
    if (page.origin !== base.origin || page.username || page.password || page.hash || page.pathname !== '/cli/onboarding'
      || page.searchParams.get('session') !== session.id || page.searchParams.get('project') !== input.project
      || /[^\x21-\x7e]/.test(session.verification_url)) throw invalid();
    if (path !== '/api/v1/onboarding' && path.split('/')[4] !== session.id) throw invalid();
    return session;
  }
  const show = (session: OnboardingSession) => input.emit({ code: 'onboarding_status', session_id: session.id, status: session.status,
    line_id: session.line.id, receiving_number: session.line.receiving_number, expires_at: session.expires_at,
    ...(session.demo_call_id ? { demo_call_id: session.demo_call_id } : {}),
    message: `Onboarding: ${session.status.replaceAll('_', ' ')}. Shared line: ${session.line.receiving_number}.` });
  let resume = store.load();
  const alreadyStarted = Boolean(resume);
  if (!resume && (input.statusOnly || input.cancel)) throw new CLIError('onboarding_not_started', 3, 'No onboarding is saved for this project. Run chert onboard to begin.');
  resume ??= store.create();
  // Persist the start key before the first request. A lost response reuses it, including after process restart.
  let session: OnboardingSession;
  if (resume.session_id) session = await request(`/api/v1/onboarding/${resume.session_id}`);
  else {
    if (input.statusOnly || input.cancel) throw new CLIError('onboarding_start_uncertain', 3, 'The first onboarding response was not saved. Run chert onboard to recover it using the original request key, then inspect or cancel it.');
    session = await request('/api/v1/onboarding', 'POST', resume.request_key);
    resume = { ...resume, session_id: session.id }; store.save(resume);
  }
  if (input.restart && alreadyStarted) {
    if (!['cancelled', 'expired', 'complete'].includes(session.status)) throw new CLIError('onboarding_active', 3, 'This onboarding is still active. Resume it, or use chert onboard --cancel before --restart.');
    store.clear(); resume = store.create();
    session = await request('/api/v1/onboarding', 'POST', resume.request_key);
    resume = { ...resume, session_id: session.id }; store.save(resume);
  }
  if (input.cancel) { session = await request(`/api/v1/onboarding/${session.id}`, 'DELETE'); show(session); return 0; }
  if (input.statusOnly) { show(session); return 0; }
  if (session.status === 'awaiting_verification') {
    const opened = input.openBrowser && await deps.open(session.verification_url);
    input.emit({ code: 'onboarding_verification', session_id: session.id, verification_url: session.verification_url, browser_opened: opened,
      message: `${opened ? 'Your browser is open. Complete' : `Open ${session.verification_url} to complete`} the inbound iMessage verification. Chert will reply “Verified”. Waiting here; Ctrl+C pauses.` });
    const deadline = Math.min(Date.parse(session.expires_at), deps.now() + (input.waitSeconds ?? 600) * 1000);
    while (session.status === 'awaiting_verification') {
      if (deps.now() >= deadline) { show(session); throw new CLIError('onboarding_waiting', 3, 'Verification is still pending. Run chert onboard to resume with the same project and allocation.'); }
      await deps.pause(2000, input.signal);
      if (input.signal.aborted) throw cancelled();
      session = await request(`/api/v1/onboarding/${session.id}`);
    }
  }
  if (session.status === 'ready' && !input.skipDemo) session = await request(`/api/v1/onboarding/${session.id}/demo`, 'POST', resume.request_key);
  show(session);
  if (session.status === 'expired' || session.status === 'cancelled') throw new CLIError(`onboarding_${session.status}`, 3, 'This onboarding has ended. Run chert onboard --restart to start another verification.');
  if (session.status === 'ready' || session.status === 'demo_running' || session.status === 'complete') {
    input.emit({ code: 'onboarding_handoff', project_id: input.project, demo_requested: Boolean(session.demo_call_id),
      next_commands: ['chert setup --env-file .env.local --project ' + input.project, 'chert doctor', 'chert dev'],
      message: (session.status === 'demo_running' ? 'The hosted demo was requested. Answer the FaceTime call; admission does not confirm audio/video worked.\n' : '')
        + 'For your own agent, put its LiveKit/provider credentials in your local env file, start the agent, then run chert doctor and chert dev. Keep both processes running for local calls. See docs/CLI_ONBOARDING.md for the existing deployment path.' });
    return 0;
  }
  throw new CLIError('onboarding_not_ready', 3, 'Onboarding is not ready yet. Run chert onboard to resume.');
}
