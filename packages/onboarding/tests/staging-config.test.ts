import { describe, test, expect } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readStagingConfig, StagingConfigError } from '../src/http/staging-config';

function environment(dataDirectory = '/tmp/chert-staging-config-test'): Record<string, string> {
  return {
    CHERT_DEPLOYMENT_ENV: 'staging',
    CHERT_ONBOARDING_KEY: Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64url'),
    CHERT_PROXY_SECRET:'proxy_fixture_secret_abcdefghijklmnopqrstuvwxyz',
    CHERT_WORKER_INBOUND_SECRET: 'inbound_fixture_secret_abcdefghijklmnopqrstuvwxyz',
    CHERT_WORKER_OUTBOUND_SECRET: 'outbound_fixture_secret_abcdefghijklmnopqrstuvwxyz',
    CHERT_MAIN_LINE: '+14155550100',
    CHERT_STAGING_RECIPIENTS: '+14155550101,+14155550102',
    CHERT_ONBOARDING_DATA_DIR: dataDirectory,
    CHERT_PUBLIC_ORIGIN: 'https://setup.example.test',
    CHERT_WORKER_ORIGIN: 'http://127.0.0.1:4194',
    STRIPE_SECRET_KEY: 'sk_test_fixture_not_a_real_key',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture_not_a_real_secret',
    STRIPE_SHARED_PRICE_ID: 'price_fixture_shared',
    STRIPE_DEDICATED_PRICE_ID: 'price_fixture_dedicated'
  };
}
function refuses(patch: Record<string, string | undefined>, field: string): void {
  const env = { ...environment(), ...patch };
  let error: unknown;
  try { readStagingConfig(env); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(StagingConfigError);
  expect((error as Error).message).toContain(field);
  for (const key of ['CHERT_ONBOARDING_KEY', 'CHERT_WORKER_INBOUND_SECRET', 'CHERT_WORKER_OUTBOUND_SECRET', 'CHERT_PROXY_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    if (env[key]) expect((error as Error).message).not.toContain(env[key]!);
  }
}
describe('staging configuration gates', () => {
  test('accepts explicit test-mode configuration with safe defaults and recipient deduplication', () => {
    const config = readStagingConfig({ ...environment(), CHERT_STAGING_RECIPIENTS: '+14155550101, +14155550102,+14155550101' });
    expect(config.publicOrigin).toBe('https://setup.example.test');
    expect(config.workerOrigin).toBe('http://127.0.0.1:4194');
    expect(config.recipients).toEqual(['+14155550101', '+14155550102']);
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.port).toBe(4193); expect(config.faceTimeEnabled).toBe(false);
    expect(readStagingConfig({ ...environment(), CHERT_FACETIME_ENABLED: 'true', CHERT_ONBOARDING_PORT: '5000' }).faceTimeEnabled).toBe(true);
  });
  test('requires staging mode, secrets and test Stripe credentials without reflecting values', () => {
    for (const mode of [undefined, '', 'production', 'test']) refuses({ CHERT_DEPLOYMENT_ENV: mode }, 'CHERT_DEPLOYMENT_ENV');
    for (const key of ['CHERT_ONBOARDING_KEY', 'CHERT_WORKER_INBOUND_SECRET', 'CHERT_WORKER_OUTBOUND_SECRET', 'CHERT_PROXY_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) refuses({ [key]: undefined }, key);
    refuses({ STRIPE_SECRET_KEY: 'sk_live_fixture_secret' }, 'STRIPE_SECRET_KEY');
    refuses({ STRIPE_WEBHOOK_SECRET: 'wrong_fixture_secret' }, 'STRIPE_WEBHOOK_SECRET');
    refuses({ CHERT_ONBOARDING_KEY: 'short' }, 'CHERT_ONBOARDING_KEY');
    refuses({CHERT_PROXY_SECRET:'weak'},'CHERT_PROXY_SECRET');
    refuses({CHERT_PROXY_SECRET:environment().CHERT_WORKER_INBOUND_SECRET},'CHERT_PROXY_SECRET');
    refuses({ CHERT_WORKER_INBOUND_SECRET: 'weak' }, 'CHERT_WORKER_INBOUND_SECRET');
    refuses({ CHERT_WORKER_OUTBOUND_SECRET: 'weak' }, 'CHERT_WORKER_OUTBOUND_SECRET');
    refuses({ CHERT_WORKER_OUTBOUND_SECRET: environment().CHERT_WORKER_INBOUND_SECRET }, 'CHERT_WORKER_OUTBOUND_SECRET');
    refuses({ CHERT_WORKER_OUTBOUND_SECRET: environment().CHERT_ONBOARDING_KEY }, 'CHERT_WORKER_OUTBOUND_SECRET');
    refuses({ CHERT_WORKER_INBOUND_SECRET: environment().CHERT_ONBOARDING_KEY }, 'CHERT_WORKER_OUTBOUND_SECRET');
  });
  test('requires public HTTPS origin and refuses credential-bearing URLs, paths and query fragments', () => {
    for (const value of ['http://setup.example.test', 'http://localhost:4193', 'https://user:password@setup.example.test', 'https://setup.example.test/path', 'https://setup.example.test?token=secret', 'https://setup.example.test#token', 'not a URL']) refuses({ CHERT_PUBLIC_ORIGIN: value }, 'CHERT_PUBLIC_ORIGIN');
    for (const value of ['http://worker.example.test', 'https://user:password@worker.example.test', 'http://127.0.0.1:4194/path']) refuses({ CHERT_WORKER_ORIGIN: value }, 'CHERT_WORKER_ORIGIN');
  });
  test('requires explicit E.164 allowlist capped at twenty excluding the main line', () => {
    for (const value of [undefined, '', '*', '14155550101', '+14155550100', '+14155550101,']) refuses({ CHERT_STAGING_RECIPIENTS: value }, 'CHERT_STAGING_RECIPIENTS');
    const twenty = Array.from({ length: 20 }, (_, index) => '+1415555' + String(101 + index).padStart(4, '0'));
    expect(readStagingConfig({ ...environment(), CHERT_STAGING_RECIPIENTS: twenty.join(',') }).recipients).toHaveLength(20);
    refuses({ CHERT_STAGING_RECIPIENTS: [...twenty, '+14155550150'].join(',') }, 'CHERT_STAGING_RECIPIENTS');
    refuses({ CHERT_MAIN_LINE: '4155550100' }, 'CHERT_MAIN_LINE');
  });
  test('requires absolute data location and distinct prices, and validates port and boolean values', () => {
    for (const value of [undefined, '', './data', 'data', '/tmp/bad\u0000path']) refuses({ CHERT_ONBOARDING_DATA_DIR: value }, 'CHERT_ONBOARDING_DATA_DIR');
    for (const key of ['STRIPE_SHARED_PRICE_ID', 'STRIPE_DEDICATED_PRICE_ID']) refuses({ [key]: undefined }, key);
    refuses({ STRIPE_DEDICATED_PRICE_ID: environment().STRIPE_SHARED_PRICE_ID }, 'STRIPE_SHARED_PRICE_ID/STRIPE_DEDICATED_PRICE_ID');
    refuses({ STRIPE_SHARED_PRICE_ID: 'not_price' }, 'STRIPE_SHARED_PRICE_ID/STRIPE_DEDICATED_PRICE_ID');
    for (const value of ['0', '65536', '-1', '1.5', 'NaN', '']) refuses({ CHERT_ONBOARDING_PORT: value }, 'CHERT_ONBOARDING_PORT');
    for (const value of ['1', 'yes', 'TRUE', '']) refuses({ CHERT_FACETIME_ENABLED: value }, 'CHERT_FACETIME_ENABLED');
  });
});

test('check-config subprocess emits only safe summary and creates no runtime data or network requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chert-config-check-'));
  try {
    const env = environment(join(directory, 'must-not-be-created'));
    const script = resolve(import.meta.dir, '../src/http/staging.ts');
    const guard = join(directory, 'network-guard.ts');
    await writeFile(guard, `globalThis.fetch = (() => { throw new Error('network forbidden in check-config'); }) as typeof fetch; Bun.serve = (() => { throw new Error('listener forbidden in check-config'); }) as typeof Bun.serve;`);
    const child = Bun.spawn([process.execPath, '--no-env-file', '--preload', guard, script, '--check-config'], { env, cwd: directory, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(0); expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({ status: 'configured', mode: 'staging', recipientCount: 2, billing: 'stripe-test', productionReady: false });
    for (const key of ['CHERT_ONBOARDING_KEY','CHERT_WORKER_INBOUND_SECRET','CHERT_WORKER_OUTBOUND_SECRET','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','CHERT_MAIN_LINE','CHERT_STAGING_RECIPIENTS','CHERT_ONBOARDING_DATA_DIR']) expect(stdout).not.toContain(env[key]);
    expect(await readdir(directory)).toEqual(['network-guard.ts']);
    const invalid = Bun.spawn([process.execPath, '--no-env-file', '--preload', guard, script, '--check-config'], { env: { ...env, STRIPE_SECRET_KEY: 'sk_live_fixture_secret' }, cwd: directory, stdout: 'pipe', stderr: 'pipe' });
    const [invalidOut, invalidError, invalidCode] = await Promise.all([new Response(invalid.stdout).text(), new Response(invalid.stderr).text(), invalid.exited]);
    expect(invalidCode).toBe(1); expect(invalidOut).toBe(''); expect(invalidError).toContain('STRIPE_SECRET_KEY'); expect(invalidError).not.toContain('sk_live_fixture_secret');
    expect(await readdir(directory)).toEqual(['network-guard.ts']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
