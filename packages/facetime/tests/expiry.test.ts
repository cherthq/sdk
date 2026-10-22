import { test, expect } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startOnboarding, reapExpiredOnboarding } from '../src/onboard.js';

const input = { baseUrl: 'https://chert.example', phone: '+14155550123', consent: true, agent: 'codex', target: 'project' as const };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'chert-expiry-test-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function helper(root: string, now: () => number, expiresAt: number) {
  let requests = 0;
  const fetch = (async () => {
    requests++;
    if (requests !== 1) throw new Error('Expiry must not contact the service.');
    return Response.json({ sessionId: 'session_expiry_123', pollCapability: 'protected-capability-'.repeat(3), expiresAt, state: 'waiting' });
  }) as unknown as typeof globalThis.fetch;
  const started = await startOnboarding(input, { temporaryRoot: root, now, fetch });
  const file = String(started.helperFile);
  await writeFile(join(dirname(file), 'completion.json'), '{"token":"protected-receipt"}', { mode: 0o600 });
  await writeFile(join(dirname(file), 'continuation.md'), 'Protected continuation', { mode: 0o600 });
  return { file, fetch, requestCount: () => requests };
}
async function expectErased(file: string) {
  for (const name of ['state.json', 'completion.json', 'continuation.md']) {
    await expect(readFile(join(dirname(file), name))).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

test('expiry reaper erases helper and saved handoff automatically without further HTTP', async () => fixture(async root => {
  let clock = 1000;
  const { file, fetch, requestCount } = await helper(root, () => clock, clock + 125000);
  const sleeps: number[] = [];
  const result = await reapExpiredOnboarding(file, { now: () => clock, fetch, pause: async ms => { sleeps.push(ms); clock += ms; } });
  expect(result.status).toBe('expired');
  expect(sleeps).toEqual([60000, 60000, 5000]);
  expect(requestCount()).toBe(1);
  await expectErased(file);
}));

test('early timer wake recalculates remaining TTL and preserves unexpired files', async () => fixture(async root => {
  let clock = 1000;
  const { file, fetch, requestCount } = await helper(root, () => clock, clock + 90000);
  const sleeps: number[] = [];
  const result = await reapExpiredOnboarding(file, { now: () => clock, fetch, pause: async ms => {
    sleeps.push(ms);
    expect(await readFile(file, 'utf8')).toContain('protected-capability');
    expect(await readFile(join(dirname(file), 'completion.json'), 'utf8')).toContain('protected-receipt');
    clock += sleeps.length === 1 ? 10000 : ms;
  } });
  expect(sleeps).toEqual([60000, 60000, 20000]);
  expect(result.status).toBe('expired');
  expect(requestCount()).toBe(1);
  await expectErased(file);
}));

test('reaper treats an already cleaned helper as cleaned without sleeping or HTTP', async () => fixture(async root => {
  const { file, fetch, requestCount } = await helper(root, () => 1000, 2000);
  for (const name of ['state.json', 'completion.json', 'continuation.md']) await rm(join(dirname(file), name));
  const result = await reapExpiredOnboarding(file, { now: () => 3000, fetch, pause: async () => { throw new Error('Already cleaned helper must not sleep.'); } });
  expect(result.status).toBe('cleaned');
  expect(requestCount()).toBe(1);
}));

test.skipIf(process.platform === 'win32')('reaper refuses unsafe state permissions before deleting protected files', async () => fixture(async root => {
  const { file, fetch, requestCount } = await helper(root, () => 1000, 2000);
  await chmod(file, 0o644);
  await expect(reapExpiredOnboarding(file, { now: () => 3000, fetch })).rejects.toThrow('owner-only');
  expect(await readFile(join(dirname(file), 'completion.json'), 'utf8')).toContain('protected-receipt');
  expect(requestCount()).toBe(1);
}));

test('reaper refuses a symlink state without deleting its target or protected handoff', async () => fixture(async root => {
  const { file, fetch, requestCount } = await helper(root, () => 1000, 2000);
  const target = join(root, 'original-state.json');
  await writeFile(target, await readFile(file), { mode: 0o600 });
  await rm(file);
  await symlink(target, file);
  await expect(reapExpiredOnboarding(file, { now: () => 3000, fetch })).rejects.toThrow('owner-only');
  expect(await readFile(target, 'utf8')).toContain('protected-capability');
  expect(await readFile(join(dirname(file), 'completion.json'), 'utf8')).toContain('protected-receipt');
  expect(requestCount()).toBe(1);
}));

test('a busy helper lock has a bounded cleanup wait and is never forcibly removed',async()=>fixture(async root=>{
 let clock=1000;const {file,fetch}=await helper(root,()=>clock,2000);clock=3000;
 const lock=join(dirname(file),'poll.lock');await writeFile(lock,'',{mode:0o600});let sleeps=0;
 const result=await reapExpiredOnboarding(file,{now:()=>clock,fetch,pause:async ms=>{sleeps++;clock+=ms;}});
 expect(result.status).toBe('cleanup_blocked');expect(sleeps).toBe(59);expect(await readFile(lock,'utf8')).toBe('');expect(await readFile(file,'utf8')).toContain('protected-capability');
}));

test('helper reports automatic cleanup only after its scheduler confirms startup',async()=>fixture(async root=>{
 let scheduled='';const result=await startOnboarding(input,{temporaryRoot:root,fetch:(async()=>Response.json({sessionId:'session_scheduled_123',pollCapability:'capability-'.repeat(5),expiresAt:Date.now()+60000,state:'waiting'}))as unknown as typeof fetch,scheduleExpiry:async file=>{scheduled=file;expect(await readFile(file,'utf8')).toContain('capability-');}});
 expect(result.automaticCleanup).toBe(true);expect(scheduled).toBe(String(result.helperFile));
}));
test('scheduler failure retains a recoverable helper and reports its path without credentials',async()=>fixture(async root=>{
 let scheduled='';let message='';try{await startOnboarding(input,{temporaryRoot:root,fetch:(async()=>Response.json({sessionId:'session_schedule_fail',pollCapability:'hidden-secret-capability-'.repeat(3),expiresAt:Date.now()+60000,state:'waiting'}))as unknown as typeof fetch,scheduleExpiry:async file=>{scheduled=file;throw Error('unsafe provider detail');}});}catch(error){message=(error as Error).message;}
 expect(message).toContain(scheduled);expect(message).toContain('automatic expiry cleanup');expect(message).not.toContain('hidden-secret');expect(message).not.toContain('unsafe provider');expect(await readFile(scheduled,'utf8')).toContain('hidden-secret-capability');
}));
