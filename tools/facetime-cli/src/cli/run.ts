import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LiveKitAdapter, liveKitAPI } from '../adapters/livekit.js';
import { AdapterReceipts } from '../adapters/livekit-receipts.js';
import { Connector } from '../runtime/connector.js';
import { FileJournal } from '../runtime/journal.js';
import { systemClock } from '../runtime/deadline.js';
import { ConnectorWire } from '../transport/connector-wire.js';
import { reconciliationClient } from '../transport/reconcile.js';
import { credentialsPresent, type RoomConfig } from './config.js';
import { CLIError } from './errors.js';
import { loopbackFetchPolicy } from './network-policy.js';
import { healthContext } from './diagnostics.js';
import { pending, saveObservation, statePermissions, writerLocked, type Observation } from './state.js';

export async function run(config: RoomConfig, env: NodeJS.ProcessEnv, signal: AbortSignal, emit: (data: Record<string, unknown>) => void, recoveryOnly = false): Promise<number> {
  if (config.transport.mode === 'unconfigured') throw new CLIError('backend_not_implemented', 6, 'Enroll a standby connector, review its binding, then explicitly activate it before expecting incoming calls.');
  if (!credentialsPresent(config, env)) throw new CLIError('credentials_missing', 3, 'Inject the credential environment variables referenced in config; never put values in flags or config.');
  statePermissions(config.state_dir, true);
  if (writerLocked(config.state_dir)) throw new CLIError('writer_locked', 4, 'Another writer or an unreviewed crash lock exists. Stop the writer or review dead-writer recovery; preserve all journal and adapter receipts.');
  if (existsSync(join(config.state_dir, 'adapter.json')) && !existsSync(join(config.state_dir, 'journal.json'))) throw new CLIError('orphaned_receipts', 4, 'Adapter receipts exist without their journal. Preserve the directory and recover the matching journal before running.');
  let journal: FileJournal;
  try { journal = new FileJournal(join(config.state_dir, 'journal.json'), config.transport.scope); }
  catch { throw new CLIError('journal_unavailable', 4, 'Cannot acquire or reopen the journal for this exact binding. Preserve existing state and resolve the writer/identity conflict.'); }
  let connector: Connector | undefined, wire: ConnectorWire | undefined;
  let tick: Promise<void> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false, disconnected = false, failed = false;
  let finish!: () => void;
  const stopped = new Promise<void>(resolve => { finish = resolve; });
  const stop = () => { stopping = true; connector?.drain(); finish(); };
  signal.addEventListener('abort', stop, { once: true });
  const hosted = config.transport.mode === 'hosted-v1';
  const apiOrigin = config.transport.mode === 'loopback-v1' ? config.transport.livekit_api_origin : undefined;
  const restoreFetch = apiOrigin ? loopbackFetchPolicy([config.hook.origin, apiOrigin, config.transport.reconcile_origin]) : () => {};
  try {
    const context = healthContext(config, env[config.hook.secret_env]!);
    const adapter = new LiveKitAdapter(liveKitAPI(config.livekit.url, env[config.livekit.key_env]!, env[config.livekit.secret_env]!, apiOrigin),
      context.hook, new AdapterReceipts(join(config.state_dir, 'adapter.json')),
      { ...context.expected, url: config.livekit.url, hookSecret: env[config.hook.secret_env]! });
    connector = new Connector(config.transport.scope, journal, adapter, context.availability, systemClock);
    connector.disconnect();
    wire = new ConnectorWire(connector);
    const reconcile = reconciliationClient(config.transport.reconcile_origin, env[config.transport.recovery_env]!, hosted);
    let last = '';
    const observe = (phase: Observation['phase']) => {
      const value: Observation = { schema_version: 1, at: Date.now(), pid: process.pid, phase, health: context.availability.check(), admission: connector!.check() };
      saveObservation(config.state_dir, value);
      const code = `${phase}:${value.health}:${value.admission}`;
      if (code !== last) { last = code; emit({ code: 'runtime_observation', ...value, development_only: !hosted }); }
    };
    observe('starting');
    wire.events.on('closed', () => { if (!stopping) { disconnected = true; stop(); } });
    await context.hook.refresh(context.availability, context.credential);
    // Reconcile retained calls before a welcome can enable new admission.
    await connector.tick(reconcile);
    if (signal.aborted) stop();
    if (!stopping) {
      try { await wire.connect(config.transport.relay_origin, env[recoveryOnly ? config.transport.recovery_env : config.transport.credential_env]!, hosted); }
      catch { throw new CLIError('transport_unavailable', 6, 'Relay connection/authorization failed. Retained work requires reconciliation; no activation was inferred.'); }
      observe('connected');
      const sample = () => {
        if (stopping) return;
        timer = setTimeout(() => {
          tick = (async () => {
            await context.hook.refresh(context.availability, context.credential);
            await connector!.tick(reconcile);
            observe(connector!.connected ? 'connected' : 'disconnected');
          })().catch(() => { failed = true; stop(); }).finally(sample);
        }, 1000);
      };
      sample(); await stopped;
    }
    connector.drain(); observe(disconnected ? 'disconnected' : 'stopping');
    stopping = true; clearTimeout(timer);
    connector.close(); await wire.close(); await tick;
    await connector.settleLocalWork();
    observe('stopped');
    const work = pending(config.state_dir);
    emit({ code: 'runtime_stopped', retained: work, action: 'Keep state for the next run. Accepted or uncertain work is preserved; the customer agent was not stopped.' });
    return failed ? 4 : disconnected ? 6 : connector.debt() ? 3 : 0;
  } finally {
    stopping = true; clearTimeout(timer); signal.removeEventListener('abort', stop);
    connector?.close(); await wire?.close(); await tick;
    try { await connector?.settleLocalWork(); } finally { restoreFetch(); journal.close(); }
  }
}
