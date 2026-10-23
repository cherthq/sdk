import { createServer, type IncomingMessage } from 'node:http';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { privateFile } from './config.js';
import { CLIError } from './errors.js';

const credentialSchema = z.strictObject({
  access_token: z.string().min(1).max(8192).regex(/^[^\r\n]+$/),
  expires_at: z.number().int().positive(),
  email: z.string().max(320).optional(),
  // Set by browser sign-in: a Chert command-line credential is bound to one project.
  kind: z.literal('cli').optional(),
  project_id: z.string().uuid().optional(),
  /** Stable browser setup intent, reused by CLI onboarding after authorization. */
  onboarding_request_key: z.string().uuid().optional(),
  project_name: z.string().max(200).optional(),
  device_name: z.string().max(200).optional(),
  /** The Chert address that issued the credential, so later commands and sign-out go back to the same place. */
  origin: z.string().max(300).optional(),
});
export type Credential = z.infer<typeof credentialSchema>;
export interface CredentialStore { save(value: Credential): void; load(): Credential | undefined; clear(): void }

/** Owner-only file store: directory 0700, file 0600, written atomically. */
export function credentialStore(dir: string): CredentialStore {
  const file = join(dir, 'credentials.json');
  return {
    save(value) {
      const checked = credentialSchema.parse(value);
      mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
      const temporary = `${file}.${process.pid}.tmp`;
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(checked) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, file);
    },
    load() {
      try { privateFile(file, 16384); return credentialSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); }
      catch { return undefined; }
    },
    clear() { rmSync(file, { force: true }); },
  };
}

export function whoami(store: CredentialStore): { signed_in: boolean; email?: string; expires_at?: number; project_id?: string; project_name?: string } {
  const value = store.load();
  if (!value || value.expires_at <= Date.now()) return { signed_in: false };
  return { signed_in: true, ...(value.email ? { email: value.email } : {}), expires_at: value.expires_at,
    ...(value.project_id ? { project_id: value.project_id } : {}), ...(value.project_name ? { project_name: value.project_name } : {}) };
}

/** `revoke` resolves false when the issuer answers that the credential had already ended, and throws when it confirmed nothing. */
export async function logout(store: CredentialStore, revoke: (token: string) => Promise<boolean | void>): Promise<{ signed_out: true; revoked: boolean; already_ended?: true }> {
  const value = store.load();
  let revoked = false, ended = false;
  if (value) { try { ended = await revoke(value.access_token) === false; revoked = !ended; } catch { revoked = false; } }
  store.clear();
  return { signed_out: true, revoked, ...(ended ? { already_ended: true as const } : {}) };
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(request: IncomingMessage, limit = 16384): Promise<string> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += (chunk as Buffer).length; if (size > limit) throw new Error('too_large'); chunks.push(chunk as Buffer); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Loopback callback for browser login. The session arrives in a POST body, never in the URL. */
export async function startLoginCallback(options: { state: string; timeoutMs: number }): Promise<{ url: string; result: Promise<Credential>; close(): void }> {
  let settle!: (value: Credential) => void, fail!: (error: Error) => void;
  const result = new Promise<Credential>((resolve, reject) => { settle = resolve; fail = reject; });
  const server = createServer(async (request, response) => {
    const reply = (status: number) => { response.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end(status === 200 ? 'Signed in. You can close this tab.\n' : 'Rejected.\n'); };
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/callback' || url.search) return reply(400);
    try {
      const parsed = z.object({ state: z.string(), access_token: z.string(), expires_at: z.number(), email: z.string().optional() }).parse(JSON.parse(await body(request)));
      if (!same(parsed.state, options.state)) return reply(400);
      const credential = credentialSchema.parse({ access_token: parsed.access_token, expires_at: parsed.expires_at, ...(parsed.email ? { email: parsed.email } : {}) });
      reply(200); settle(credential);
    } catch { reply(400); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new CLIError('login_unavailable', 6, 'Could not open a local login callback.'); }
  const timer = setTimeout(() => fail(new Error('login_timeout')), options.timeoutMs);
  const close = () => { clearTimeout(timer); server.closeAllConnections(); server.close(); };
  void result.then(close, close);
  return { url: `http://127.0.0.1:${address.port}/callback`, result, close };
}
