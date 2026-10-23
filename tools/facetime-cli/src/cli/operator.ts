import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { configSchema, configuredEnvironment, developmentSchema, byorDevelopmentSchema, isByor, modeOf, loadConfig, parseConfig, saveConfig, type Config } from './config.js';
import { check, status } from './diagnostics.js';
import { CLIError } from './errors.js';
import { backendCommand } from './backend.js';
import { backendCommands } from './names.js';
import { run } from './run.js';
import { byorCheck, byorStatus, runByor } from '../byor/run.js';
import { callbackScaffold } from '../byor/scaffold.js';

const backendOptions = ['backend','project','line','relay-origin','output-config','credentials-file','environment','binding','expected-binding','assignment-generation'];
const initOptions = ['mode', 'handler-module', 'handler-id', 'agent-name', 'deployment', 'boot', 'livekit-url', 'hook-origin', 'state-dir', 'livekit-key-env', 'livekit-secret-env', 'hook-secret-env', 'development'];
function options(args: string[], command: string) {
  const values: Record<string, string> = {};
  const booleans = new Set(command === 'init' ? ['json', 'non-interactive'] : ['run', 'byor', 'create-room'].includes(command) ? ['json', 'recovery'] : ['json']);
  const allowed = new Set(['config', ...(command === 'init' ? initOptions : backendCommands.includes(command) ? backendOptions : [])]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith('--')) throw new CLIError('invalid_usage', 2, 'Use --help for supported commands and flags.');
    const key = flag.slice(2);
    if (key in values || (!allowed.has(key) && !booleans.has(key))) throw new CLIError('invalid_usage', 2, 'Unknown or duplicate flag. Use --help; credentials must be environment references.');
    if (booleans.has(key)) values[key] = 'true';
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new CLIError('missing_input', 2, 'Provide a value for each required option; see --help.');
      values[key] = value;
    }
  }
  if (!values.config) throw new CLIError('missing_config_path', 2, 'Supply --config PATH explicitly; no active project or configuration is inferred.');
  return values;
}
async function init(values: Record<string, string>): Promise<void> {
  const selected = values.mode ?? (['agent-name','livekit-url','hook-origin'].some(k => values[k]) ? 'legacy' : 'byor');
  if (!['byor','create-room','legacy'].includes(selected)) throw new CLIError('invalid_mode', 2, 'Choose --mode byor or --mode create-room.');
  if (selected === 'byor') {
    if (!values['state-dir']) throw new CLIError('missing_input', 2, 'Supply --state-dir ABSOLUTE_PATH.');
    if (['agent-name','deployment','boot','livekit-url','hook-origin','hook-secret-env','livekit-key-env','livekit-secret-env'].some(k => values[k])) throw new CLIError('mode_mismatch', 2, 'BYOR uses application callbacks; remove create-room adapter flags.');
    const configPath = resolve(values.config!); const source = join(dirname(configPath), 'chert-handler.ts');
    const module = values['handler-module'] ?? join(dirname(configPath), 'chert-handler.js');
    if (existsSync(configPath) || (!values['handler-module'] && existsSync(source))) throw new CLIError('config_exists_or_unwritable', 2, 'Choose new config/scaffold paths; existing files are never overwritten.');
    const transport = values.development ? byorDevelopmentSchema.parse(JSON.parse(readFileSync(values.development, 'utf8'))) : { mode: 'unconfigured' };
    const config = parseConfig({ schema_version: 2, mode: 'byor', state_dir: values['state-dir'], handler: { id: values['handler-id'] ?? 'application-v1', module }, transport });
    saveConfig(configPath, config);
    if (!values['handler-module']) writeFileSync(source, callbackScaffold, { flag: 'wx', mode: 0o600 });
    return;
  }
  const fields = ['agent-name', 'deployment', 'boot', 'livekit-url', 'hook-origin', 'state-dir'];
  const missing = fields.filter(k => !values[k]);
  if (missing.length && (values['non-interactive'] || values.json || !process.stdin.isTTY)) throw new CLIError('missing_input', 2, `Provide required options: ${missing.map(k => '--' + k).join(', ')}.`);
  if (missing.length) {
    const prompts = createInterface({ input: process.stdin, output: process.stderr });
    try { for (const key of missing) values[key] = await prompts.question(`${key} (no secrets): `); }
    finally { prompts.close(); }
  }
  let transport: Config['transport'] = { mode: 'unconfigured' };
  if (values.development) {
    try { transport = developmentSchema.parse(JSON.parse(readFileSync(values.development, 'utf8'))); }
    catch { throw new CLIError('invalid_development_config', 2, 'Provide the documented loopback-v1 description with literal loopback origins, exact scope and environment references.'); }
  }
  const value = parseConfig({ schema_version: selected === 'legacy' ? 1 : 2, ...(selected === 'create-room' ? {mode:'create-room'} : {}), agent: { name: values['agent-name'], deployment: values.deployment, boot: values.boot },
    livekit: { url: values['livekit-url'], key_env: values['livekit-key-env'] ?? 'LIVEKIT_API_KEY', secret_env: values['livekit-secret-env'] ?? 'LIVEKIT_API_SECRET' },
    hook: { origin: values['hook-origin'], secret_env: values['hook-secret-env'] ?? 'CHERT_HOOK_SECRET' },
    state_dir: values['state-dir'], transport });
  saveConfig(resolve(values.config!), configSchema.parse(value));
}
/** The connector and enrollment commands. Loaded only when one of them is run. */
export async function operatorCommand(command: string, rest: string[], output: (data: Record<string, unknown>, error?: boolean) => void): Promise<number> {
  const values = options(rest, command);
  if (command === 'init') { await init(values); output({ code: 'configuration_saved', authorization: 'unverified', action: 'Start the supported agent separately and run chert check. No enrollment or routing change occurred.' }); return 0; }
  const config = loadConfig(resolve(values.config!));
  if (backendCommands.includes(command)) { output(await backendCommand(command, values, config, process.env)); return 0; }
  if ((command === 'byor' || command === 'create-room') && modeOf(config) !== command || command === 'run' && config.schema_version !== 1) throw new CLIError('mode_mismatch', 2, 'Use the command matching the saved mode. Legacy run is only for v1 create-room config; mode handoff needs fresh binding/state.');
  if (command === 'status') { output({ code: 'local_status', ...(isByor(config) ? byorStatus(config) : status(config)) }); return 0; }
  const env = configuredEnvironment(config, process.env);
  if (command === 'check') { output({ code: 'check_incomplete', ...await (isByor(config) ? byorCheck(config, env) : check(config, env)) }); return 3; }
  const controller = new AbortController(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { return await (isByor(config) ? runByor(config, env, controller.signal, output, values.recovery === 'true') : run(config, env, controller.signal, output, values.recovery === 'true')); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
