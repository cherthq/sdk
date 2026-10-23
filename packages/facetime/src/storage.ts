import { mkdir, open, readFile, lstat, rename, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface Credential { origin: string; token: string; projectId: string; expiresAt: number }
export function credentialDirectory(): string { return join(homedir(), '.config', 'chert', 'facetime'); }
export function assertOutsideProject(directory: string, project: string): void {
  const difference = relative(resolve(project), resolve(directory));
  if (!difference || (!difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(difference))) throw new Error('Credential directory must be outside the project.');
}
export async function readCredential(directory: string): Promise<Credential | undefined> {
  const file = join(directory, 'credential.json');
  let metadata;
  try { metadata = await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8192 || (process.platform !== 'win32' && (metadata.mode & 0o077))) throw new Error('Credential file must be a regular owner-only file.');
  const value = JSON.parse(await readFile(file, 'utf8')) as Credential;
  if (typeof value.origin !== 'string' || !/^ftu_[A-Za-z0-9_-]{43}$/.test(value.token) || !/^[a-f\d-]{36}$/i.test(value.projectId) || !Number.isFinite(value.expiresAt)) throw new Error('Saved credentials are invalid; sign in again.');
  return value;
}
export async function saveCredential(directory: string, value: Credential): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (process.platform !== 'win32' && (metadata.mode & 0o077))) throw new Error('Credential directory must be an owner-only directory.');
  const temporary = join(directory, `credential.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(directory, 'credential.json'));
  } finally { await rm(temporary, { force: true }); }
}
