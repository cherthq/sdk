import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuredEnvironment, credentialsPresent, privateFile, type ByorConfig } from '../cli/config.js';
import { sameScope, type Decision } from '../protocol/v1.js';
import { CLIError } from '../cli/errors.js';
import { inspectHosted } from '../cli/backend.js';
import { statePermissions, writerLocked } from '../cli/state.js';
import { systemClock } from '../runtime/deadline.js';
import { ConnectorWire } from '../transport/connector-wire.js';
import { reconciliationClient } from '../transport/reconcile.js';
import { loadHandler } from './handler.js';
import { ByorJournal, byorJournalSchema, complete } from './journal.js';
import { ByorConnector } from './connector.js';
import type { ByorHandler } from './contract.js';
export function byorStatus(config: ByorConfig) {
  const permissions = statePermissions(config.state_dir);
  const path = join(config.state_dir, 'journal.json');
  let retained = { entries: 0, central_pending: 0, application_pending: 0, cleanup_pending: 0 };
  if (existsSync(path)) {
    privateFile(path);
    const data = byorJournalSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!data.success || data.data.handler.id !== config.handler.id || data.data.handler.module !== config.handler.module || (config.transport.mode !== 'unconfigured' && !sameScope(data.data.scope, config.transport.scope, false))) throw new CLIError('mode_or_handler_mismatch', 4, 'Retain the original mode, handler and state for recovery. Use a fresh state directory/binding for a handoff.');
    const entries = Object.values(data.data.entries);
    retained = { entries: entries.length, central_pending: entries.filter(e => !e.authoritative_terminal).length,
      application_pending: entries.filter(e => e.events.some(x => !x.acknowledged)).length,
      cleanup_pending: entries.filter(e => !e.settled || e.cleanup !== 'clean').length };
  }
  return { mode: 'byor', handler: config.handler, transport: config.transport.mode, state: { permissions, writer_locked: writerLocked(config.state_dir), retained },
    authorization: 'unverified', limitation: 'Saved state only; application acknowledgment is not cleanup proof.' };
}
export async function applicationHealth(handler: ByorHandler): Promise<'available' | 'unavailable' | 'unknown'> {
  if (!handler.health) return 'unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([Promise.resolve().then(() => handler.health!()), new Promise(resolve => { timer = setTimeout(() => resolve('unknown'), 1000); })]);
    return result === 'available' || result === 'unavailable' ? result : 'unknown';
  } catch { return 'unknown'; } finally { clearTimeout(timer); }
}
export async function byorCheck(config: ByorConfig, env: NodeJS.ProcessEnv) {
  const state = byorStatus(config);
  const handler = await loadHandler(config.handler.module);
  return { ...state, credentials: credentialsPresent(config, env) ? 'present' : 'missing',
    health: { code: await applicationHealth(handler), readiness: 'Per-call accept must explicitly assert ready.' },
    recovery: handler.recover ? 'application_callback' : 'application_recovery_missing',
    lifecycle: handler.lifecycle ? 'application_callback' : 'application_lifecycle_missing',
    authorization: config.transport.mode === 'hosted-v1' ? await inspectHosted(config, env) : { status: 'unverified' }, admission_enabled: false };
}
export async function runByor(config: ByorConfig, rawEnv: NodeJS.ProcessEnv, signal: AbortSignal, emit: (data: Record<string, unknown>) => void, recoveryOnly = false, builtin?: ByorHandler): Promise<number> {
  if (config.transport.mode === 'unconfigured') throw new CLIError('backend_unconfigured', 6, 'Enroll this BYOR config in standby and explicitly activate only after review.');
  if (config.transport.scope.session_mode !== 'byor') throw new CLIError('mode_mismatch', 2, 'The binding must be enrolled for BYOR. Keep old bindings/state on their original mode.');
  const env = configuredEnvironment(config, rawEnv);
  if (!credentialsPresent(config, env)) throw new CLIError('credentials_missing', 3, 'Inject the configured connection/recovery credentials. BYOR needs no wrapper LiveKit master key.');
  statePermissions(config.state_dir, true);
  if (existsSync(join(config.state_dir, 'adapter.json'))) throw new CLIError('mode_mismatch', 4, 'Create-room adapter receipts exist. Keep the original config/state for recovery and choose fresh BYOR state.');
  if (writerLocked(config.state_dir)) throw new CLIError('writer_locked', 4, 'Preserve the journal and resolve the existing writer or crash lock.');
  let journal: ByorJournal;
  try { journal = new ByorJournal(config.transport.scope, config.handler, join(config.state_dir, 'journal.json')); }
  catch { throw new CLIError('journal_unavailable', 4, 'Journal mode, handler, scope or writer conflicts. Recover with the original config; never reset state.'); }
  let connector: ByorConnector | undefined; let wire: ConnectorWire | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined; let tick: Promise<void> = Promise.resolve();
  let stopping = false, disconnected = false, failed = false;
  let finish!: () => void; const stopped = new Promise<void>(resolve => { finish = resolve; });
  const stop = () => { stopping = true; connector?.drain(); finish(); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    // Journal identity is validated BEFORE executing trusted application code.
    const handler = builtin ?? await loadHandler(config.handler.module);
    connector = new ByorConnector(config.transport.scope, journal, handler, systemClock); connector.disconnect();
    const read = reconciliationClient(config.transport.reconcile_origin, env[config.transport.recovery_env]!, config.transport.mode === 'hosted-v1');
    await connector.tick(read);
    connector.health = await applicationHealth(handler);
    wire = new ConnectorWire(connector);
    // Every decision, including one the connector makes before the application is asked, is reported.
    wire.events.on('decision', (decision: Decision) => emit({ code: 'call_decision', mode: 'byor', call_id: decision.call_id, action: decision.action,
      ...(decision.action === 'decline' ? { reason: decision.reason } : {}) }));
    wire.events.on('closed', () => { if (!stopping) { disconnected = true; emit({ code: 'transport_closed', mode: 'byor', reason: wire!.diagnostics.at(-1) ?? 'closed_by_relay' }); stop(); } });
    if (signal.aborted) stop();
    if (!stopping) {
      try { await wire.connect(config.transport.relay_origin, env[recoveryOnly ? config.transport.recovery_env : config.transport.credential_env]!, config.transport.mode === 'hosted-v1'); }
      catch { throw new CLIError('transport_unavailable', 6, 'BYOR transport failed; preserve retained calls and reconcile with the original binding.'); }
      let observation = '';
      const observe = () => {
        const next = `${connector!.health}:${connector!.check()}`;
        if (next === observation) return;
        observation = next;
        emit({ code: 'runtime_observation', mode: 'byor', phase: 'connected', health: connector!.health, admission: connector!.check(), recovery: handler.recover ? 'application_callback' : 'application_recovery_missing' });
      };
      observe();
      const sample = () => { if (!stopping) timer = setTimeout(() => {
        tick = (async () => {
          await connector!.tick(read);
          if (!stopping) { connector!.health = await applicationHealth(handler); observe(); }
        })().catch(() => { failed = true; stop(); }).finally(sample);
      }, 250); };
      sample(); await stopped;
    }
    clearTimeout(timer); connector.close(); await wire.close(); await tick;
    const count = Object.values(journal.snapshot().entries).filter(e => !complete(e)).length;
    emit({ code: 'runtime_stopped', mode: 'byor', retained: count, action: 'Keep the original journal/module/application recovery owner. No customer agent was stopped.' });
    return failed ? 4 : disconnected ? 6 : count ? 3 : 0;
  } finally {
    stopping = true; clearTimeout(timer); signal.removeEventListener('abort', stop);
    connector?.close(); await wire?.close(); await tick; journal.close();
  }
}
