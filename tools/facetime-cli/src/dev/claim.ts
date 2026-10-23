import { z } from 'zod';
import { scopeSchema, type Scope } from '../protocol/v1.js';
import { boundedText, hostedOrigin } from '../transport/http.js';
import { CLIError } from '../cli/errors.js';
import { printable } from './frame.js';

const uuid = z.string().uuid();
const lineSchema = z.object({ id: uuid, display_name: z.string().nullish(), masked_identity: z.string().nullish(), status: z.string(), worker_id: z.string().nullish(),
  inbound_policy: z.string(), default_assistant_id: z.string().nullable(), current_call_id: z.string().nullable(), assignment_generation: z.number().int().nonnegative(),
  /** Chert's view of the route and the switch: `paused | awaiting_worker | configured` and `enabled | paused`. Older servers omit them. */
  routing_status: z.string().nullish(), activation_intent: z.string().nullish() });
/** The Mac behind a line, as the server last heard from it. */
const workerSchema = z.object({ id: uuid, status: z.string(), enabled: z.boolean().optional(), last_heartbeat_at: z.string().nullish() });
const bindingSchema = z.object({ name: z.string(), scope: scopeSchema, state: z.enum(['standby', 'active', 'draining', 'revoked']), connected: z.boolean(), environment: z.string() });
const credentialsSchema = z.strictObject({ connection: z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/), recovery: z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/) });
export type Line = z.infer<typeof lineSchema>;
export type Worker = z.infer<typeof workerSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export interface Project { id: string; name: string; role: string }
export interface Enrollment { scope: Scope; credentials: z.infer<typeof credentialsSchema> }
/**
 * A project's name and the caller's role are printed in messages and errors, and an owner or admin chooses the name:
 * control characters are removed so neither can draw on the terminal. A role that needed cleaning is not one of ours.
 */
const shown = (name: string | null | undefined, role: string): Pick<Project, 'name' | 'role'> =>
  ({ name: printable(name, 200) ?? 'your project', role: printable(role, 40) === role ? role : 'unknown' });

/** The control-plane operations `chert dev` performs on the developer's behalf. */
export interface Control {
  callReadiness?(project: string, line: string, call: string): Promise<'waiting' | 'ready' | 'terminal'>;
  projects(): Promise<Project[]>;
  lines(project: string): Promise<Line[]>;
  /** The Macs behind the project's lines. Absent on a client that cannot read them. */
  workers?(project: string): Promise<Worker[]>;
  /** Chert's clock, in milliseconds since the epoch, from an unauthenticated request; undefined when it cannot be read. */
  serverTime?(): Promise<number | undefined>;
  bindings(project: string): Promise<Binding[]>;
  enroll(project: string, line: string, name: string): Promise<Enrollment>;
  activate(project: string, binding: string, expected: string | null, generation: number): Promise<void>;
  drain(project: string, binding: string): Promise<void>;
  revoke(project: string, binding: string): Promise<void>;
}

/** `signedInProject` is the one project a command-line credential (`ftu_`) was approved for; a browser session token needs none. */
export function controlClient(origin: string, token: string, signedInProject?: string): Control {
  let base: URL;
  try { base = hostedOrigin(origin); } catch { throw new CLIError('invalid_origin', 2, 'The Chert address must be https://HOST with no path or credentials.'); }
  const invalid = () => new CLIError('backend_response_invalid', 6, 'Chert returned an unexpected response. Update the CLI, or try again shortly.');
  const shaped = async <T>(schema: z.ZodType<T>, value: Promise<unknown>): Promise<T> => { const parsed = schema.safeParse(await value); if (!parsed.success) throw invalid(); return parsed.data; };
  async function request(path: string, project?: string, input?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, base), { method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(project ? { 'x-chert-project-id': project } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) });
    } catch { throw new CLIError('backend_unreachable', 6, 'Could not reach Chert. Check the network and try again.'); }
    if (response.status === 401) { await response.body?.cancel(); throw new CLIError('login_required', 3, 'Your Chert session is missing or expired. Run chert login.'); }
    if (!response.ok) {
      await response.body?.cancel();
      // Chert does not say why, by design. The status still separates the two things a developer can act on.
      if (response.status === 403) throw new CLIError('backend_request_forbidden', 3, 'Chert refused this for your account. Connecting an agent needs the owner or admin role on the project. Check with chert whoami.');
      if (response.status === 409) throw new CLIError('backend_request_conflict', 6, 'The line changed while this command ran: another session took it, a call is in progress, or its settings changed. Run chert doctor, then try again.');
      throw new CLIError('backend_request_rejected', 6, 'Chert rejected the request. Check project membership (owner or admin) and that the line is free.');
    }
    try { return (JSON.parse(await boundedText(response, 1024 * 1024)) as { data: unknown }).data; } catch { throw invalid(); }
  }
  const manage = (project: string, input: Record<string, unknown>) => request('/api/v1/connectors', project, input);
  return {
    async callReadiness(project, line, call) {
      const result = await shaped(z.object({ id: uuid, project_id: uuid, line_id: uuid, status: z.string(),
        facetime_call_events: z.array(z.object({ event_type: z.string(), source: z.string() })) }),
      request(`/api/v1/calls/${encodeURIComponent(call)}`, project));
      if (result.id !== call || result.project_id !== project || result.line_id !== line) throw invalid();
      if (['ended', 'failed', 'rejected'].includes(result.status)) return 'terminal';
      return result.status === 'active' && result.facetime_call_events.some(e => e.event_type === 'bridge_ready' && e.source === 'worker') ? 'ready' : 'waiting';
    },
    async projects() {
      if (token.startsWith('ftu_')) {
        // A command-line credential cannot list projects: it belongs to exactly one, and Chert reports the current role in it.
        if (!signedInProject) throw new CLIError('login_required', 3, 'This credential needs its project. Run chert login.');
        const me = await shaped(z.object({ role: z.string(), project: z.object({ id: uuid, name: z.string().nullish() }) }), request('/api/v1/cli/whoami', signedInProject));
        if (me.project.id !== signedInProject) throw invalid();
        return [{ id: me.project.id, ...shown(me.project.name, me.role) }];
      }
      const rows = await shaped(z.array(z.object({ role: z.string(), facetime_projects: z.object({ id: uuid, name: z.string() }) })), request('/api/v1/projects'));
      return rows.map(row => ({ id: row.facetime_projects.id, ...shown(row.facetime_projects.name, row.role) }));
    },
    async lines(project) { return (await shaped(z.object({ items: z.array(lineSchema) }), request('/api/v1/lines?limit=100', project))).items; },
    async workers(project) { return (await shaped(z.object({ items: z.array(workerSchema) }), request('/api/v1/workers?limit=100', project))).items; },
    async serverTime() {
      // The Date header of any answer is Chert's clock to the second; the health route needs no session.
      try {
        const response = await fetch(new URL('/api/health', base), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        const at = Date.parse(response.headers.get('date') ?? '');
        return Number.isFinite(at) ? at : undefined;
      } catch { return undefined; }
    },
    async bindings(project) { return shaped(z.array(bindingSchema), request('/api/v1/connectors', project)); },
    async enroll(project, line, name) {
      return shaped(z.object({ scope: scopeSchema, state: z.literal('standby'), credentials: credentialsSchema }),
        manage(project, { action: 'enroll', line_id: line, name, environment: 'production', session_mode: 'byor' }));
    },
    async activate(project, binding, expected, generation) { await manage(project, { action: 'activate', binding_id: binding, expected_binding_id: expected, assignment_generation: generation }); },
    async drain(project, binding) { await manage(project, { action: 'drain', binding_id: binding }); },
    async revoke(project, binding) { await manage(project, { action: 'revoke', binding_id: binding }); },
  };
}

/**
 * A session's name says who holds the line, with which agent and, with a time slot, until when, because a shared line has
 * no other way to tell: `dev-<agent> by <email> until <HH:MM>`. Chert stores it as free text of at most 100 characters
 * and shows it to the project's owners and admins, who can already see each other.
 */
export function sessionName(agent: string, holder?: string, until?: string): string {
  const slot = until && UNTIL.test(until) ? ` until ${until}` : '';
  const who = printable(holder, 320), by = who && HOLDER.test(who) && ` by ${who}`.length + slot.length <= 95 ? ` by ${who}` : '';
  // The address is kept whole or left out: a cut address would name someone who does not exist. The time is always kept,
  // and the agent part gives way first.
  return `dev-${agent.slice(0, 96 - by.length - slot.length)}${by}${slot}`;
}
/** The shapes this tool writes. Anything else in a name is shown as a name, not read as a person or a time. */
const AGENT = /^[A-Za-z0-9_.-]{1,96}$/, HOLDER = /^[\x21-\x7e]+@[\x21-\x7e]+$/, UNTIL = /^([01]\d|2[0-3]):[0-5]\d$/;
function readName(name: string): { clean: string; agent?: string; holder?: string; until?: string } {
  const clean = printable(name, 100) ?? 'unnamed';
  const [, agent, holder, until] = /^dev-(.+?)(?: by (.+?))?(?: until ([0-9:]+))?$/.exec(clean) ?? [];
  if (!agent || !AGENT.test(agent) || (holder !== undefined && !HOLDER.test(holder)) || (until !== undefined && !UNTIL.test(until))) return { clean };
  return { clean, agent, ...(holder ? { holder } : {}), ...(until ? { until } : {}) };
}
/** A session's name as a person reads it. A name this tool did not write is shown as it is, cleaned. */
export function describeSession(name: string): string {
  const { clean, agent, holder } = readName(name);
  if (!agent) return `a session named "${clean}"`;
  return holder ? `${holder} (agent "${agent}")` : `a session for agent "${agent}"`;
}
/** The end of the holder's time slot, HH:MM on their clock, when their session was started with one. */
export const heldUntil = (name: string): string | undefined => readName(name).until;
/** The same, to start a sentence: an email address keeps its own case. */
export const sessionSubject = (name: string) => describeSession(name).replace(/^a /, 'A ');

export interface Claim { project: Project; line: Line; scope: Scope; credentials: Enrollment['credentials']; replaced?: string; readiness: LineReadiness }

/** A doctor-style verdict on one thing: the Mac behind the line. Shared by `chert dev` and `chert doctor`. */
export interface Check { name: string; status: 'pass' | 'warn' | 'fail' | 'skip'; detail: string; fix?: string }
/** A Mac that has not been heard from within the dashboard's one-minute boundary cannot answer, whatever the line status says. */
export const HEARTBEAT_STALE_MS = 60_000;
export const elapsed = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3600_000)} h`;
export function workerCheck(worker: Worker | undefined, now: number): Check {
  if (!worker) return { name: 'worker', status: 'skip', detail: 'The Mac behind this line is not listed.' };
  const fix = 'The Mac for this line must be online and accepting calls before chert dev can answer. Anish checks it in Chert MAU (chert-mau line) and sets it accepting.';
  const warn = (detail: string): Check => ({ name: 'worker', status: 'warn', detail, fix });
  if (worker.enabled === false) return warn('The Mac behind this line is disabled.');
  if (worker.status === 'offline' || worker.status === 'draining') return warn(`The Mac behind this line is ${worker.status}.`);
  const at = worker.last_heartbeat_at ? Date.parse(worker.last_heartbeat_at) : Number.NaN;
  if (!Number.isFinite(at)) return warn('The Mac behind this line has never checked in.');
  // Chert stamps the heartbeat and this computer supplies `now`: a clock a little slow here puts a fresh heartbeat ahead of it.
  if (at - now >= HEARTBEAT_STALE_MS) return { name: 'worker', status: 'warn', detail: `The Mac behind this line last checked in ${elapsed(at - now)} ahead of this computer's clock; the clocks disagree, so its freshness cannot be judged.`,
    fix: 'Set this computer\'s date and time automatically, then run chert doctor again.' };
  const age = Math.max(0, now - at);
  if (age >= HEARTBEAT_STALE_MS) return warn(`The Mac behind this line last checked in ${elapsed(age)} ago; calls will not be answered until it is back.`);
  return { name: 'worker', status: 'pass', detail: `The Mac behind this line checked in ${elapsed(age)} ago.` };
}

/** Whether Chert would route a call to this line now, the plain reason when not, and who fixes it. */
export interface LineReadiness { ok: boolean; code?: string; detail: string; fix?: string; /** One line for the opening screen. */ summary: string }
const CONSOLE_ROUTING = 'A project admin opens the line in the console (Workers & Lines) and sets Routing to "Your webhook" and Assistant to "Unassigned".';
const MAC_FIX = 'Anish checks the Mac in Chert MAU (chert-mau line) and sets the worker accepting.';
/** A shared line (Gary's pilot): the project reaches a pool line through an allocation, and the line's switch is Chert's, not the project's. */
const SHARED_FIX = 'Chert enables the pool line when the pilot opens; there is nothing to press in your console. Run chert onboard --status for the allocation state.';
export function lineReadiness(line: Line, worker: Worker | undefined, now: number, options: { workersListed: boolean; /** The project was onboarded with chert onboard and reaches a pool line through an allocation. */ shared?: boolean }): LineReadiness {
  const label = printable(line.display_name, 80) ?? printable(line.masked_identity, 80) ?? 'The line';
  const policy = printable(line.inbound_policy, 40) ?? 'unknown', routing = printable(line.routing_status, 40), activation = printable(line.activation_intent, 40), status = printable(line.status, 40) ?? 'unknown';
  const mac = worker ? workerCheck(worker, now) : undefined;
  const macWords = mac ? (mac.status === 'pass' ? mac.detail.replace('The Mac behind this line checked in', 'Mac checked in').replace(/\.$/, '') : mac.detail.replace('The Mac behind this line', 'Mac').replace(/\.$/, ''))
    : options.workersListed ? 'Mac not listed' : 'Mac state unknown';
  const summary = `${label}: ${status}, routing ${routing ?? 'not reported'}, calls ${activation === 'enabled' ? 'enabled' : activation ?? 'not reported'}, ${macWords}`;
  const no = (code: string, detail: string, fix: string): LineReadiness => ({ ok: false, code, detail, fix, summary });
  if (policy !== 'customer_decides' || line.default_assistant_id !== null)
    return no('line_not_customer_decides', `${label} is routed as "${policy}"${line.default_assistant_id !== null ? ' with a hosted assistant' : ''}; a chert dev session needs "customer decides" with no assistant, so calls never reach it.`, CONSOLE_ROUTING);
  if (line.current_call_id !== null) return no('line_in_call', 'A call is in progress on this line.', 'Wait for it to end, then run chert dev again.');
  if (activation === 'paused' || routing === 'paused') {
    if (options.shared) return no('shared_line_paused', `Calls are paused on the shared line ${label} by Chert, not by your project.`, SHARED_FIX);
    return no('line_paused', `Calls are paused on ${label}.`, 'A project admin presses Enable calls on the line in the console (Workers & Lines).');
  }
  if (routing === 'awaiting_worker') return no('line_unacknowledged', `The Mac has not acknowledged ${label}'s settings yet: it must report a confirmed receiving identity and be accepting.`, `Wait 30 s and run chert dev again. If it stays, ${MAC_FIX}`);
  if (status === 'draining') return no('line_draining', `${label} is draining: it finishes its current work and takes no new calls.`, MAC_FIX);
  if (status !== 'available') return no('line_offline', `${label} is ${status}: the Mac behind it is not accepting calls, or has not confirmed the receiving identity.`, MAC_FIX);
  if (mac && mac.status === 'warn') return no('worker_unavailable', mac.detail, mac.fix ?? MAC_FIX);
  return { ok: true, detail: `${label} can take calls.`, summary };
}

/** Choose the project and its line, refuse a line that is in use or cannot take calls, then enroll and activate a fresh binding. */
export async function claimLine(control: Control, options: { name: string; project?: string; takeover?: boolean; /** Take a line Chert says cannot take calls yet; the reason is kept for the opening screen. */ force?: boolean; now?: number; /** Whether this project was onboarded with chert onboard (a saved onboarding session): it reaches a pool line through an allocation. */ shared?: (projectId: string) => boolean }): Promise<Claim> {
  const projects = await control.projects();
  const candidates = options.project ? projects.filter(p => p.id === options.project) : projects;
  if (!candidates.length) throw new CLIError('project_required', 2, options.project ? 'That project is not one of yours. Run chert projects to list them.' : 'Your account has no Chert project yet. Ask Chert to add you to one.');
  if (candidates.length > 1) throw new CLIError('project_selection_required', 2, `Choose one with --project ID: ${candidates.map(p => `${p.name} (${p.id})`).join(', ')}`);
  const project = candidates[0]!;
  if (!['owner', 'admin'].includes(project.role)) throw new CLIError('project_role_insufficient', 3, `Connecting an agent needs the owner or admin role on ${project.name}; yours is ${project.role}.`);
  const lines = await control.lines(project.id);
  const shared = options.shared?.(project.id) ?? false;
  // A shared project lists its pool line only while its allocation is current (expired, released or unqualified: no line at all).
  if (!lines.length && shared) throw new CLIError('shared_allocation_inactive', 3, `${project.name}'s shared line allocation is not active: it expired, was released, or its pool line is not qualified right now. Run chert onboard --status; after expiry, chert onboard requests a new allocation.`);
  if (!lines.length) throw new CLIError('line_required', 3, `${project.name} has no FaceTime line yet. A Chert admin assigns one to this project in the Admin panel (Assignments).`);
  if (lines.length > 1) throw new CLIError('project_requires_one_line', 3, `${project.name} has ${lines.length} lines; connectors need a project with exactly one.`);
  const line = lines[0]!;
  // Taking the line now would cut that call off, whoever holds the line and whether or not their session is still alive.
  // --takeover does not change this: it is for a holder who agrees, between calls.
  if (line.current_call_id !== null) throw new CLIError('line_in_call', 3, 'A call is in progress on this line. Wait for it to end, then run chert dev again.');
  // Pre-flight: Chert's own view of the route, the switch and the Mac. A line that cannot take calls is refused with the reason
  // and who fixes it, so a team never sits "on the line" while every call declines. --force keeps the reason on the opening screen.
  let worker: Worker | undefined; let workersListed = false;
  if (control.workers && line.worker_id) {
    try { worker = (await control.workers(project.id)).find(w => w.id === line.worker_id); workersListed = true; }
    catch { /* an unreadable Mac list is not a reason to stop; the line's own status still decides */ }
  }
  const readiness = lineReadiness(line, worker, options.now ?? Date.now(), { workersListed, shared });
  if (!readiness.ok && !options.force) throw new CLIError(readiness.code!, 3, `${readiness.detail} ${readiness.fix ?? ''}`.trim());
  const active = (await control.bindings(project.id)).find(b => b.state === 'active');
  if (active?.connected && !options.takeover) {
    const until = heldUntil(active.name);
    throw new CLIError('line_in_use', 3, until ? `${sessionSubject(active.name)} is on this line until ${until}. Try again then, or ask them to stop with Ctrl+C, or run chert dev --takeover to replace them.`
      : `${sessionSubject(active.name)} is on this line now. Ask them to stop with Ctrl+C, or run chert dev --takeover to replace them.`);
  }
  const enrollment = await control.enroll(project.id, line.id, options.name);
  if (enrollment.scope.project_id !== project.id || enrollment.scope.line_id !== line.id || enrollment.scope.session_mode !== 'byor') {
    await control.revoke(project.id, enrollment.scope.binding_id).catch(() => {});
    throw new CLIError('binding_mismatch', 6, 'The returned binding does not match the chosen project and line.');
  }
  try { await control.activate(project.id, enrollment.scope.binding_id, active?.scope.binding_id ?? null, line.assignment_generation); }
  catch (error) { await control.revoke(project.id, enrollment.scope.binding_id).catch(() => {}); throw error; }
  return { project, line, scope: enrollment.scope, credentials: enrollment.credentials, readiness, ...(active ? { replaced: active.scope.binding_id } : {}) };
}

/** Stop routing calls here. The credential is revoked only when no call work is left to recover. */
export async function releaseLine(control: Control, project: string, binding: string, retained: number): Promise<void> {
  await control.drain(project, binding);
  if (retained === 0) await control.revoke(project, binding);
}
