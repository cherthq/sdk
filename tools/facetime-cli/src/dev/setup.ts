import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { CLIError } from '../cli/errors.js';

const schema = z.object({ schema_version: z.literal(1), project: z.uuid(), env_file: z.string().min(1).refine(isAbsolute) }).strict();
const keys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
const filename = 'dev-defaults.json';

/** Parse data only. Never execute shell syntax or import auth, origins, or Node options. */
function environment(path: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let parsed: NodeJS.ProcessEnv;
  try {
    if (statSync(path).size > 1024 * 1024) throw new Error();
    parsed = parseEnv(readFileSync(path, 'utf8'));
  } catch { throw new CLIError('env_file_unreadable', 2, 'Cannot read the LiveKit env file. Check --env-file or run chert setup again.'); }
  const loaded = { ...env };
  for (const key of keys) if (loaded[key] === undefined && parsed[key] !== undefined) loaded[key] = parsed[key];
  return loaded;
}
/** AGENT_NAME from an env file, or nothing when the file is absent, unreadable or does not name one. */
function agentIn(path: string): string | undefined {
  try { return statSync(path).size > 1024 * 1024 ? undefined : parseEnv(readFileSync(path, 'utf8')).AGENT_NAME || undefined; } catch { return undefined; }
}
/** The LiveKit values a starter's env file still holds as written: the names, for a message that says what to fill in. */
export function placeholders(env: NodeJS.ProcessEnv): string[] { return keys.filter(key => /^(wss:\/\/)?YOUR_/.test(env[key] ?? '')); }
/** Those names as a sentence, for chert dev and chert doctor alike. */
export const unfilledSentence = (names: string[]) => `${names.join(', ')} still ${names.length === 1 ? 'holds its YOUR_ placeholder' : 'hold the YOUR_ placeholders'}`;

/** Explicit one-time selection; does not authenticate, claim a line, or allocate resources. */
export function saveDevSetup(home: string, project: string, path: string, env: NodeJS.ProcessEnv): void {
  const result = schema.safeParse({ schema_version: 1, project, env_file: resolve(path) });
  if (!result.success) throw new CLIError('invalid_project', 2, 'Supply a project UUID with --project.');
  const loaded = environment(result.data.env_file, env);
  if (keys.some(key => !loaded[key])) throw new CLIError('livekit_credentials_missing', 3, 'Setup needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the env file or shell.');
  if (!/^wss:\/\/[^/?#@]+\/?$/.test(loaded.LIVEKIT_URL!)) throw new CLIError('livekit_url_invalid', 2, 'LIVEKIT_URL must look like wss://your-project.livekit.cloud');
  const temporary = join(home, `${filename}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(result.data) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, join(home, filename));
  } finally { rmSync(temporary, { force: true }); }
}

export function clearDevSetup(home: string): void { rmSync(join(home, filename), { force: true }); }

/** The files an agent keeps its LiveKit keys in, looked for in the folder the command is run from. */
const folderFiles = ['.env.local', '.env'];
/** The three LiveKit values from the first folder file that has any of them. A file that is absent or unreadable is skipped. */
function fromFolder(folder: string, env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; file: string } | undefined {
  for (const name of folderFiles) {
    const file = join(folder, name);
    let loaded: NodeJS.ProcessEnv;
    try { loaded = environment(file, env); } catch { continue; }
    if (keys.some(key => loaded[key] !== env[key])) return { env: loaded, file };
  }
  return undefined;
}

/**
 * Where the LiveKit keys and the project come from, most explicit first: the shell, --env-file, a saved setup, then
 * .env.local or .env in the folder the command is run from. So in an agent's own folder nothing needs setting up.
 * `envFile` names a folder file that was used, so the command can say so. `agent` is AGENT_NAME from the shell, else
 * from the same file the agent itself reads, so the name is typed once.
 */
export function devSettings(home: string, values: Record<string, string>, env: NodeJS.ProcessEnv, folder: string = process.cwd()): { project?: string; env: NodeJS.ProcessEnv; envFile?: string; agent?: string } {
  let saved: z.infer<typeof schema> | undefined;
  try { saved = schema.parse(JSON.parse(readFileSync(join(home, filename), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CLIError('invalid_dev_setup', 2, 'Saved dev setup is unreadable. Run chert setup again or chert setup --clear.');
  }
  const project = values.project ?? saved?.project;
  if (project && !z.uuid().safeParse(project).success) throw new CLIError('invalid_project', 2, 'Supply a project UUID with --project.');
  const path = values['env-file'] ?? saved?.env_file;
  const named = (files: string[]) => { const agent = env.AGENT_NAME || files.map(agentIn).find(Boolean); return agent ? { agent } : {}; };
  // A named or saved env file comes first for the name too, then the folder's own file: the one the agent itself reads.
  if (path) return { ...(project ? { project } : {}), env: environment(path, env), ...named([path, ...folderFiles.map(name => join(folder, name))]) };
  const found = keys.every(key => env[key]) ? undefined : fromFolder(folder, env);
  return { ...(project ? { project } : {}), env: found?.env ?? env, ...(found ? { envFile: found.file } : {}), ...named(folderFiles.map(name => join(folder, name))) };
}
