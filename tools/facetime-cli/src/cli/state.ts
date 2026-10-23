import { existsSync, lstatSync, mkdirSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { journalSchema } from '../runtime/journal.js';
import { codes } from '../protocol/v1.js';
import { privateFile } from './config.js';
import { CLIError } from './errors.js';
export function statePermissions(directory: string, create = false): 'missing' | 'private' {
  if (!existsSync(directory)) {
    if (!create) return 'missing';
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const s = lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0) throw new CLIError('unsafe_state', 4, 'Use an owner-only state directory (0700), owned by this user, on a durable local POSIX filesystem.');
  for (const name of ['journal.json', 'journal.json.lock', 'journal.json.tmp', 'journal.json.recovery', 'adapter.json', 'adapter.json.tmp', 'observation.json', 'observation.json.tmp']) {
    const path = join(directory, name);
    // lstat catches dangling symlinks, too.
    try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    privateFile(path);
  }
  return 'private';
}
export function pending(directory: string) {
  const path = join(directory, 'journal.json');
  if (!existsSync(path)) return { entries: 0, active: 0, cleanup: 0, uncertain: 0, creating: 0, observed_at: null };
  try {
    privateFile(path);
    const snapshot = journalSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const values = Object.values(snapshot.entries);
    return { entries: values.length, active: values.filter(e => !e.terminal).length,
      cleanup: values.filter(e => e.cleanup_debt).length, uncertain: values.filter(e => e.reconcile_debt).length,
      creating: values.filter(e => e.create_pending).length, observed_at: lstatSync(path).mtimeMs };
  } catch { throw new CLIError('journal_unreadable', 4, 'Journal is unreadable or invalid. Preserve it for recovery; do not delete or reset state.'); }
}
export function writerLocked(directory: string): boolean { return existsSync(join(directory, 'journal.json.lock')); }
export const observationSchema = z.strictObject({
  schema_version: z.literal(1), at: z.number().int().positive(), pid: z.number().int().positive(),
  phase: z.enum(['starting', 'connected', 'disconnected', 'stopping', 'stopped']),
  health: z.union([z.literal('available'), codes]), admission: z.union([z.literal('available'), codes]),
});
export type Observation = z.infer<typeof observationSchema>;
export function saveObservation(directory: string, value: Observation): void {
  const path = join(directory, 'observation.json');
  const fd = openSync(`${path}.tmp`, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(observationSchema.parse(value))); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(`${path}.tmp`, path);
  const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function observation(directory: string) {
  const path = join(directory, 'observation.json');
  if (!existsSync(path)) return null;
  try {
    privateFile(path); const data = observationSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return { ...data, age_ms: Math.max(0, Date.now() - data.at), live: false, limitation: 'Saved observation only; status does not verify liveness or authorization.' };
  } catch { throw new CLIError('observation_unreadable', 4, 'Saved status is invalid; preserve journal and inspect state permissions.'); }
}
