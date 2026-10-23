import { randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { CLIError } from '../cli/errors.js';
import { describeSession, heldUntil, lineReadiness, sessionSubject, workerCheck, type Check, type Control, type Project } from './claim.js';
import { printable } from './frame.js';
import { unfilledSentence } from './setup.js';
import type { DispatchAPI } from './dispatch-handler.js';

export type { Check };
export { workerCheck };
export interface DoctorDeps {
  /** Absent when there is no usable session. */
  control?: Control;
  /** Absent when the LiveKit variables are missing or malformed. */
  api?: DispatchAPI;
  session: { signed_in: boolean; expires_at?: number; email?: string };
  /** `unfilled` names the values a starter's env file still holds as placeholders. */
  livekit: { url?: string; missing: string[]; invalid?: boolean; unfilled?: string[] };
  agentTimeoutMs?: number; pollMs?: number; slowJoinMs?: number;
  /** Whether a project was onboarded with chert onboard (a saved onboarding session): it reaches a pool line through an allocation. */
  shared?: (projectId: string) => boolean;
}
const skip = (name: string, detail: string): Check => ({ name, status: 'skip', detail });
const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** The time a sign-in has left, in the unit a person would use: days for a browser sign-in, hours, then minutes for a session token. */
function timeLeft(minutes: number): string {
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return minutes >= 1440 ? count(Math.floor(minutes / 1440), 'day') : minutes >= 60 ? count(Math.floor(minutes / 60), 'hour') : `${minutes} min`;
}
/** Read-only checks of everything `chert dev` needs. Reports every problem, not just the first.
 * The only thing it creates is one short-lived test room in the developer's own LiveKit project. */
export async function runDoctor(input: { agent?: string; project?: string; /** The agent name found in the folder, offered in the hint; the check itself stays opt-in because it runs a real job. */ known?: string }, deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const { session, control } = deps;

  if (!session.signed_in) checks.push({ name: 'session', status: 'fail', detail: 'Not signed in.', fix: 'Run chert login.' });
  else {
    const minutes = session.expires_at === undefined ? undefined : Math.max(0, Math.round((session.expires_at - Date.now()) / 60_000));
    const who = session.email ? `Signed in as ${session.email}` : 'Signed in';
    checks.push(minutes !== undefined && minutes < 15
      ? { name: 'session', status: 'warn', detail: `${who}; the session expires in ${minutes} min.`, fix: 'Run chert login again before a long session: stopping cleanly needs a valid session.' }
      : { name: 'session', status: 'pass', detail: `${who}${minutes !== undefined ? `; ${timeLeft(minutes)} left` : ''}.` });
  }

  let project: Project | undefined;
  if (!control) checks.push(skip('chert', 'Needs a session.'), skip('clock', 'Needs a session.'), skip('project', 'Needs a session.'), skip('line', 'Needs a session.'), skip('worker', 'Needs a session.'), skip('line_free', 'Needs a session.'));
  else {
    let projects: Project[] | undefined;
    try { projects = await control.projects(); checks.push({ name: 'chert', status: 'pass', detail: 'Chert is reachable and accepted the session.' }); }
    catch (error) {
      const code = error instanceof CLIError ? error.code : 'unknown';
      checks.push(code === 'login_required' ? { name: 'chert', status: 'fail', detail: 'Chert rejected the session (expired or invalid).', fix: 'Run chert login.' }
        : code === 'backend_unreachable' ? { name: 'chert', status: 'fail', detail: 'Could not reach Chert.', fix: 'Check the network, then try again.' }
        : { name: 'chert', status: 'fail', detail: `Chert answered unexpectedly (${code}).`, fix: 'Update the CLI or try again shortly.' });
    }
    // A call's timing is judged on this computer's clock: more than a quarter second ahead of Chert's and every call is declined over timing.
    if (!control.serverTime) checks.push(skip('clock', 'This Chert version does not tell its time.'));
    else {
      const before = Date.now(); const server = await control.serverTime().catch(() => undefined); const after = Date.now();
      if (server === undefined) checks.push(skip('clock', 'Could not read Chert\'s time.'));
      else {
        const local = (before + after) / 2, skew = local - server, fix = 'Set this computer\'s date and time automatically (System Settings, General, Date & Time), then run chert doctor again.';
        if (skew >= 1_000) checks.push({ name: 'clock', status: 'warn', detail: `This computer's clock is ${(skew / 1000).toFixed(1)} s ahead of Chert's; calls are declined over timing when it is more than a quarter second ahead.`, fix });
        else if (skew <= -5_000) checks.push({ name: 'clock', status: 'warn', detail: `This computer's clock is ${(-skew / 1000).toFixed(1)} s behind Chert's; call deadlines then look longer than they are.`, fix });
        else checks.push({ name: 'clock', status: 'pass', detail: `This computer's clock is within ${Math.max(1, Math.round(Math.abs(skew) / 1000))} s of Chert's.` });
      }
    }
    if (!projects) checks.push(skip('project', 'Needs Chert.'), skip('line', 'Needs Chert.'), skip('worker', 'Needs Chert.'), skip('line_free', 'Needs Chert.'));
    else {
      const candidates = input.project ? projects.filter(p => p.id === input.project) : projects;
      if (!candidates.length) checks.push({ name: 'project', status: 'fail', detail: input.project ? 'That project is not one of yours.' : 'Your account has no Chert project.', fix: input.project ? `Yours: ${projects.map(p => `${p.name} (${p.id})`).join(', ') || 'none'}` : 'Ask Chert to add you to a project.' });
      else if (candidates.length > 1) checks.push({ name: 'project', status: 'fail', detail: `You belong to ${candidates.length} projects.`, fix: `Choose one with --project ID: ${candidates.map(p => `${p.name} (${p.id})`).join(', ')}` });
      else {
        project = candidates[0]!;
        checks.push(['owner', 'admin'].includes(project.role)
          ? { name: 'project', status: 'pass', detail: `${project.name}: your role is ${project.role}.` }
          : { name: 'project', status: 'fail', detail: `${project.name}: your role is ${project.role}.`, fix: 'Connecting an agent needs the owner or admin role. Ask a project owner to change it.' });
      }
      if (!project) checks.push(skip('line', 'Needs one project.'), skip('worker', 'Needs one project.'), skip('line_free', 'Needs one project.'));
      else {
        let oneLine = true; let linesRead = false; let workerId: string | null | undefined;
        try {
          const lines = await control.lines(project.id); const line = lines[0];
          // The name, the masked address and the status are server text, and a person chose the name: cleaned before they are shown.
          const named = printable(line?.display_name, 80), address = printable(line?.masked_identity, 80);
          linesRead = true; oneLine = lines.length === 1;
          if (oneLine) workerId = line?.worker_id;
          const shared = deps.shared?.(project.id) ?? false;
          if (!line && shared) checks.push({ name: 'line', status: 'fail', detail: 'Your shared line allocation is not active: it expired, was released, or its pool line is not qualified right now.', fix: 'Run chert onboard --status; after expiry, chert onboard requests a new allocation.' });
          else if (!line) checks.push({ name: 'line', status: 'fail', detail: 'The project has no FaceTime line.', fix: 'Ask Chert to assign one.' });
          else if (lines.length > 1) checks.push({ name: 'line', status: 'fail', detail: `The project has ${lines.length} lines.`, fix: 'Connectors need a project with exactly one line.' });
          else {
            // The same reasons chert dev refuses with, so doctor and dev never disagree. The Mac has its own check below.
            const readiness = lineReadiness(line, undefined, Date.now(), { workersListed: false, shared });
            if (readiness.ok) checks.push({ name: 'line', status: 'pass', detail: `${named ?? 'Line'} (${address ?? 'address hidden'}) is available.` });
            else if (readiness.code === 'line_not_customer_decides') checks.push({ name: 'line', status: 'fail', detail: readiness.detail, ...(readiness.fix ? { fix: readiness.fix } : {}) });
            else checks.push({ name: 'line', status: 'warn', detail: readiness.code === 'line_in_call' ? `${named ?? 'The line'} has a call in progress.` : readiness.detail, ...(readiness.fix ? { fix: readiness.fix } : {}) });
          }
        } catch { checks.push({ name: 'line', status: 'fail', detail: 'Could not read the project\'s line.', fix: 'Check your role on the project.' }); }
        // The server's line status is its own view; the Mac's heartbeat says whether anyone can answer.
        if (!linesRead) checks.push(skip('worker', 'Needs the project\'s line.'));
        else if (!oneLine) checks.push(skip('worker', 'Needs a project with exactly one line.'));
        else if (!workerId) checks.push(skip('worker', 'The line does not name the Mac behind it.'));
        else if (!control.workers) checks.push(skip('worker', 'This Chert version does not report the Mac behind the line.'));
        else try { checks.push(workerCheck((await control.workers(project.id)).find(w => w.id === workerId), Date.now())); }
        catch { checks.push(skip('worker', 'Could not read the Mac behind this line.')); }
        if (!oneLine) checks.push(skip('line_free', 'Needs a project with exactly one line.'));
        else try {
          const active = (await control.bindings(project.id)).find(b => b.state === 'active');
          checks.push(!active ? { name: 'line_free', status: 'pass', detail: 'No session holds the line.' }
            : active.connected ? { name: 'line_free', status: 'fail', detail: `${sessionSubject(active.name)} is on the line ${heldUntil(active.name) ? `until ${heldUntil(active.name)}` : 'now'}.`, fix: 'Ask them to stop, or start chert dev with --takeover to replace them.' }
            : { name: 'line_free', status: 'pass', detail: `The last session (${describeSession(active.name)}) is not connected and will be replaced.` });
        } catch { checks.push(skip('line_free', 'Needs the owner or admin role.')); }
      }
    }
  }

  let livekitOk = false;
  if (deps.livekit.missing.length) checks.push({ name: 'livekit', status: 'fail', detail: 'LiveKit variables are not set.', fix: `Run this from your agent's folder, where .env.local holds ${deps.livekit.missing.join(', ')}, or export them.` });
  else if (deps.livekit.unfilled?.length) checks.push({ name: 'livekit', status: 'fail', detail: `${unfilledSentence(deps.livekit.unfilled)}.`, fix: 'Put your LiveKit values in .env.local.' });
  else if (deps.livekit.invalid || !deps.api) checks.push({ name: 'livekit', status: 'fail', detail: 'LIVEKIT_URL is not a wss:// address.', fix: 'It must look like wss://your-project.livekit.cloud' });
  else {
    try { await deps.api.listParticipants('chert-doctor-preflight'); livekitOk = true; }
    catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 404) livekitOk = true;
      else checks.push(status === 401 || status === 403
        ? { name: 'livekit', status: 'fail', detail: 'LiveKit rejected the API key and secret.', fix: 'Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET belong to the project in LIVEKIT_URL.' }
        : { name: 'livekit', status: 'fail', detail: 'Could not reach the LiveKit project.', fix: 'Check LIVEKIT_URL and the network.' });
    }
    if (livekitOk) checks.push({ name: 'livekit', status: 'pass', detail: 'LiveKit accepted the credentials.' });
  }

  if (!input.agent) checks.push(skip('agent', input.known ? `Pass --agent ${input.known} to check that your agent joins a test room.` : 'Pass --agent NAME to check that your agent joins a test room.'));
  else if (!livekitOk || !deps.api) checks.push(skip('agent', 'Needs working LiveKit credentials.'));
  else {
    const api = deps.api; const room = `chert-doctor-${randomBytes(9).toString('base64url')}`;
    const started = performance.now(); let joined: number | undefined; let failed = false;
    try {
      await api.createRoom(room, { metadata: JSON.stringify({ chert_doctor: true }), maxParticipants: 2, emptyTimeout: 30, agentName: input.agent, agentMetadata: JSON.stringify({ chert_doctor: true }) });
      const end = started + (deps.agentTimeoutMs ?? 15_000);
      while (performance.now() < end) {
        if ((await api.listParticipants(room)).some(p => p.kind === 'agent')) { joined = performance.now() - started; break; }
        await pause(deps.pollMs ?? 100);
      }
    } catch { failed = true; }
    await api.deleteRoom(room).catch(() => {});
    if (failed) checks.push({ name: 'agent', status: 'fail', detail: 'LiveKit could not create a test room.', fix: 'Try again; if it persists, check the LiveKit project.' });
    else if (joined === undefined) checks.push({ name: 'agent', status: 'fail', detail: `"${input.agent}" did not join a test room within ${seconds(deps.agentTimeoutMs ?? 15_000)} s.`,
      fix: `Start your agent, and check it registers with agent_name="${input.agent}" on this LiveKit project.` });
    else if (joined > (deps.slowJoinMs ?? 3_500)) checks.push({ name: 'agent', status: 'warn', detail: `"${input.agent}" joined in ${seconds(joined)} s: too slow to answer a ringing call directly, so calls rely on the warm room chert dev keeps.` });
    else checks.push({ name: 'agent', status: 'pass', detail: `"${input.agent}" joined in ${seconds(joined)} s.` });
  }
  return checks;
}

const marks: Record<Check['status'], string> = { pass: '✓', warn: '!', fail: '✗', skip: '-' };
export function renderChecks(checks: Check[]): string {
  const width = Math.max(...checks.map(c => c.name.length));
  const lines = checks.map(c => `${marks[c.status]} ${c.name.padEnd(width)}  ${c.detail}${c.fix ? `\n  ${' '.repeat(width)}  → ${c.fix}` : ''}`);
  const failed = checks.filter(c => c.status === 'fail').length, warned = checks.filter(c => c.status === 'warn').length;
  lines.push('', failed ? `${failed} ${failed === 1 ? 'problem' : 'problems'} to fix before chert dev will work.` : warned ? 'Connectivity checked, with warnings. Media readiness is unverified.' : 'Connectivity checked. Agent membership does not verify media readiness.');
  return lines.join('\n');
}
