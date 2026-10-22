import { test, expect } from 'bun:test';
import { mkdtemp, readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/main.js';
import { readCredential, saveCredential } from '../src/storage.js';

const origin = 'https://chert.example', projectId = '11111111-1111-4111-8111-111111111111';
const token = `ftu_${'A'.repeat(43)}`, device = `fdc_${'B'.repeat(43)}`;
const start = { device_code: device, user_code: 'ABCD-EFGH', verification_url: origin + '/cli', verification_url_complete: origin + '/cli?code=ABCD-EFGH', expires_in: 60, interval: 1 };
async function fixture(action: (root: string, cwd: string, credentialDir: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'chert-cli-'));
  const cwd = join(root, 'project'), credentialDir = join(root, 'private');
  await mkdir(cwd);
  try { await action(root, cwd, credentialDir); } finally { await rm(root, { recursive: true, force: true }); }
}
function transport(replies: unknown[], seen: { url: string; method?: string }[]): typeof fetch {
  return (async (url: RequestInfo | URL, options?: RequestInit) => {
    seen.push({ url: String(url), method: options?.method });
    const reply = replies.shift();
    if (reply === undefined) throw new Error('Unexpected HTTP request');
    return Response.json({ data: reply });
  }) as unknown as typeof fetch;
}
test('setup detects a project, reports paid prerequisites and does no HTTP or file writes', async () => fixture(async (_root, cwd, credentialDir) => {
  await writeFile(join(cwd, 'package.json'), '{}');
  const result = await run(['setup', '--backend', origin], { cwd, credentialDir, env: {}, fetch: (() => { throw new Error('No network'); }) as unknown as typeof fetch });
  expect(result.status).toBe('blocked'); expect(result.target).toBe('project');
  expect(JSON.stringify(result)).toContain('Ask the user which paid plan');
  expect(await readCredential(credentialDir)).toBeUndefined();
}));
test('explicit personal target wins; env secrets never appear in output or modified files', async () => fixture(async (_root, cwd, credentialDir) => {
  const secret = 'SECRET_LIVEKIT_TEST';
  const env = `LIVEKIT_URL=wss://lk.example\nLIVEKIT_API_KEY=${secret}\nLIVEKIT_API_SECRET=${secret}\nAGENT_NAME=resident\n`;
  await writeFile(join(cwd, '.env.local'), env);
  const result = await run(['setup', '--backend', origin, '--target', 'personal', '--plan', 'dedicated'], { cwd, credentialDir, env: {} });
  expect(result.target).toBe('personal'); expect(JSON.stringify(result)).not.toContain(secret);
  expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(env);
}));
test('device approval waits for pending then stores owner-only credential outside project', async () => fixture(async (_root, cwd, credentialDir) => {
  const seen: { url: string; method?: string }[] = [], output: unknown[] = [];
  let clock = 0;
  const result = await run(['login', '--backend', origin], { cwd, credentialDir, now: () => clock, pause: async n => { clock += n; }, emit: record => output.push(record), fetch: transport([start, { status: 'pending' }, { status: 'approved', access_token: token, project: { id: projectId }, expires_in: 3600 }], seen) });
  expect(result.status).toBe('signed_in'); expect(seen).toHaveLength(3);
  expect((await stat(join(credentialDir, 'credential.json'))).mode & 0o777).toBe(0o600);
  expect(JSON.stringify([result, ...output])).not.toContain(token);
  expect(JSON.stringify([result, ...output])).not.toContain(device);
  expect((await readCredential(credentialDir))?.projectId).toBe(projectId);
}));
test('foreign approval origin and malformed token fail without saving', async () => fixture(async (_root, cwd, credentialDir) => {
  const common = { cwd, credentialDir, pause: async () => {} };
  await expect(run(['login', '--backend', origin], { ...common, fetch: transport([{ ...start, verification_url_complete: 'https://evil.example/cli?code=ABCD-EFGH' }], []) })).rejects.toThrow('approval');
  await expect(run(['login', '--backend', origin], { ...common, fetch: transport([start, { status: 'approved', access_token: 'bad', project: { id: projectId }, expires_in: 3600 }], []) })).rejects.toThrow('invalid credential');
  expect(await readCredential(credentialDir)).toBeUndefined();
}));
test('expired or denied approval never saves credentials or retries an uncertain outcome', async () => fixture(async (_root, cwd, credentialDir) => {
  let clock = 0;
  await expect(run(['login', '--backend', origin], { cwd, credentialDir, now: () => clock, pause: async n => { clock += n; }, fetch: transport([{ ...start, expires_in: 1 }], []) })).rejects.toThrow('expired');
  await expect(run(['login', '--backend', origin], { cwd, credentialDir, pause: async () => {}, fetch: transport([start, { status: 'denied' }], []) })).rejects.toThrow('not approved');
  expect(await readCredential(credentialDir)).toBeUndefined();
}));
test('doctor reads identity lines workers only; distinguishes configuration from connected media', async () => fixture(async (_root, cwd, credentialDir) => {
  await saveCredential(credentialDir, { origin, token, projectId, expiresAt: Date.now() + 60000 });
  const seen: { url: string; method?: string }[] = [];
  const result = await run(['doctor'], { cwd, credentialDir, env: { LIVEKIT_URL: 'wss://lk.example', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret', AGENT_NAME: 'resident' }, fetch: transport([{ project: { id: projectId }, role: 'owner' }, { items: [{ id: 'line', status: 'available', worker_id: 'worker', inbound_policy: 'customer_decides', default_assistant_id: null }], total: 1 }, { items: [{ id: 'worker', status: 'accepting', enabled: true, last_heartbeat_at: new Date().toISOString() }], total: 1 }], seen) });
  expect(result.status).toBe('configuration_ready');
  expect(seen.map(item => new URL(item.url).pathname)).toEqual(['/api/v1/cli/whoami', '/api/v1/lines', '/api/v1/workers']);
  expect(seen.every(item => item.method === 'GET')).toBe(true);
  expect(JSON.stringify(result)).toContain('does not implement chert dev');
}));
test('credential storage inside project is refused before beginning login', async () => fixture(async (_root, cwd) => {
  await expect(run(['login', '--backend', origin], { cwd, credentialDir: join(cwd, 'credentials'), fetch: (() => { throw new Error('No network'); }) as unknown as typeof fetch })).rejects.toThrow('outside');
}));
test('doctor fails closed on missing lines, stale workers and wrong project identity', async () => fixture(async (_root, cwd, credentialDir) => {
  await saveCredential(credentialDir, { origin, token, projectId, expiresAt: Date.now() + 60000 });
  const dependencies = { cwd, credentialDir, env: {} };
  const result = await run(['doctor'], { ...dependencies, fetch: transport([{ project: { id: projectId }, role: 'member' }, { items: [], total: 0 }, { items: [], total: 0 }], []) });
  expect(result.status).toBe('blocked'); expect(JSON.stringify(result)).toContain('owner or admin');
  const stale = await run(['doctor'], { ...dependencies, fetch: transport([{ project: { id: projectId }, role: 'owner' }, { items: [{ id: 'line', status: 'available', worker_id: 'worker', inbound_policy: 'customer_decides', default_assistant_id: null }], total: 1 }, { items: [{ id: 'worker', status: 'accepting', enabled: true, last_heartbeat_at: '2000-01-01T00:00:00Z' }], total: 1 }], []) });
  expect(JSON.stringify(stale)).toContain('fresh heartbeat');
  await expect(run(['doctor'], { ...dependencies, fetch: transport([{ project: { id: 'another-project' }, role: 'owner' }, { items: [], total: 0 }, { items: [], total: 0 }], []) })).rejects.toThrow('invalid or paginated');
}));
