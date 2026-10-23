import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { id, scopeSchema } from '../protocol/v1.js';
import { loopbackOrigin, hostedOrigin } from '../transport/http.js';
import { CLIError } from './errors.js';
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{2,99}$/);
const local = z.string().refine(value => { try { loopbackOrigin(value); return true; } catch { return false; } });
const endpoint = z.string().refine(value => { try {
  const u = new URL(value); return u.protocol === 'wss:' && u.pathname === '/' && !u.username && !u.password && !u.search && !u.hash;
} catch { return false; } });
export const developmentSchema = z.strictObject({
  mode: z.literal('loopback-v1'), relay_origin: local, reconcile_origin: local, livekit_api_origin: local,
  scope: scopeSchema.refine(s => s.connection_generation === 0), credential_env: envName, recovery_env: envName,
});
const hosted = z.string().refine(value => { try { hostedOrigin(value); return true; } catch { return false; } });
export const hostedSchema = z.strictObject({
  mode: z.literal('hosted-v1'), control_origin: hosted, relay_origin: hosted, reconcile_origin: hosted,
  scope: scopeSchema.refine(s => s.connection_generation === 0), credential_env: envName, recovery_env: envName,
  credentials_file: z.string().refine(isAbsolute).optional(),
});
export const legacyConfigSchema = z.strictObject({
  schema_version: z.literal(1),
  agent: z.strictObject({ name: id, deployment: id, boot: id }),
  livekit: z.strictObject({ url: endpoint, key_env: envName, secret_env: envName }),
  hook: z.strictObject({ origin: local, secret_env: envName }),
  state_dir: z.string().min(1).refine(isAbsolute),
  transport: z.union([z.strictObject({ mode: z.literal('unconfigured') }), developmentSchema, hostedSchema]),
});
export const roomConfigSchema = legacyConfigSchema.extend({ schema_version: z.literal(2), mode: z.literal('create-room') });
export const byorDevelopmentSchema = developmentSchema.omit({ livekit_api_origin: true });
export const byorConfigSchema = z.strictObject({
  schema_version: z.literal(2), mode: z.literal('byor'),
  handler: z.strictObject({ id, module: z.string().refine(isAbsolute) }),
  state_dir: z.string().refine(isAbsolute),
  transport: z.union([z.strictObject({ mode: z.literal('unconfigured') }), byorDevelopmentSchema, hostedSchema]),
});
export const configSchema = z.union([legacyConfigSchema, roomConfigSchema, byorConfigSchema]).refine(c => c.transport.mode === 'unconfigured' || (c.schema_version === 2 && c.mode === 'byor' ? c.transport.scope.session_mode === 'byor' : c.transport.scope.session_mode !== 'byor'));
export type Config = z.infer<typeof configSchema>;
export type RoomConfig = z.infer<typeof legacyConfigSchema> | z.infer<typeof roomConfigSchema>;
export type ByorConfig = z.infer<typeof byorConfigSchema>;
export function isByor(config: Config): config is ByorConfig { return config.schema_version === 2 && config.mode === 'byor'; }
export function modeOf(config: Config): 'byor' | 'create-room' { return isByor(config) ? 'byor' : 'create-room'; }
export function parseConfig(value: unknown): Config {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new CLIError('invalid_config', 2, 'Use explicit schema_version 2 and mode byor with an absolute trusted handler module, or create-room with its LiveKit/hook target. Legacy schema_version 1 remains room-owned. Store credential references only.');
  return parsed.data;
}
export function privateFile(path: string, max = 16 * 1024 * 1024): void {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o077) !== 0 || s.uid !== process.getuid?.() || s.size > max) throw new CLIError('unsafe_file', 4, 'Use an owner-only regular file (0600), owned by this user, without links.');
}
export function loadConfig(path: string): Config {
  try { privateFile(path, 32768); return parseConfig(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { if (error instanceof CLIError) throw error; throw new CLIError('config_unreadable', 2, 'Create a valid local configuration with chert init --config PATH.'); }
}
export function saveConfig(path: string, config: Config): void {
  const checked = parseConfig(config);
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch { throw new CLIError('config_exists_or_unwritable', 2, 'Choose a new writable config path; init never overwrites an existing file.'); }
  try { writeFileSync(fd, JSON.stringify(checked, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const dir = openSync(dirname(resolve(path)), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function credentialNames(config: Config): string[] {
  return [...new Set([...(isByor(config) ? [] : [config.livekit.key_env, config.livekit.secret_env, config.hook.secret_env]),
    ...(config.transport.mode !== 'unconfigured' ? [config.transport.credential_env, config.transport.recovery_env] : [])])];
}
export function credentialsPresent(config: Config, env: NodeJS.ProcessEnv): boolean {
  return credentialNames(config).every(name => !!env[name] && env[name]!.length <= 8192 && !/[\r\n]/.test(env[name]!));
}

export function configuredEnvironment(config: Config, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (config.transport.mode !== 'hosted-v1' || !config.transport.credentials_file) return env;
  privateFile(config.transport.credentials_file, 4096);
  let tokens: { connection: string; recovery: string };
  try { tokens = z.strictObject({ connection: z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/), recovery: z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/) }).parse(JSON.parse(readFileSync(config.transport.credentials_file, 'utf8'))); }
  catch { throw new CLIError('credentials_unreadable', 4, 'Restore the protected connector credential file or use environment references.'); }
  return { ...env, [config.transport.credential_env]: tokens.connection, [config.transport.recovery_env]: tokens.recovery };
}
