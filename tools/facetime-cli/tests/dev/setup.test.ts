import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearDevSetup, devSettings, saveDevSetup } from '../../src/dev/setup.js';

const project = '40a51cbd-d3c8-450d-a9b4-4f82dd8741cd';
const other = '5ee3afd6-f248-45a5-9fe8-bf30c4c961e7';
const secret = 'SECRET_SENTINEL_never_print_or_copy';
const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'chert-setup-'));
  const path = join(home, 'credentials with spaces.env');
  writeFileSync(path, `LIVEKIT_URL=wss://fixture.livekit.invalid\nLIVEKIT_API_KEY="key with spaces"\nLIVEKIT_API_SECRET='${secret}'\n`, { mode: 0o600 });
  return { home, path, close: () => rmSync(home, { recursive: true, force: true }) };
}
function cli(home: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [executable, ...args, '--json'], { encoding: 'utf8', timeout: 10000,
    cwd: tmpdir(), env: { PATH: process.env.PATH, CHERT_HOME: home, ...env } });
}

test('setup saves only explicit defaults owner-only; actual dev loads them from another directory', () => {
  const f = fixture();
  try {
    const setup = cli(f.home, ['setup', '--env-file', f.path, '--project', project]);
    assert.equal(setup.status, 0, setup.stderr);
    const savedPath = join(f.home, 'dev-defaults.json');
    assert.deepEqual(JSON.parse(readFileSync(savedPath, 'utf8')), { schema_version: 1, project, env_file: f.path });
    assert.equal(statSync(savedPath).mode & 0o777, 0o600);
    assert.ok(!(setup.stdout + setup.stderr).includes(secret));
    const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c2ln`;
    // Local origin rejection proves dev passed the credential checks without making a request.
    const dev = cli(f.home, ['dev', '--agent', 'demo-agent-0', '--muse', '--backend', 'http://invalid.test'], { CHERT_USER_ACCESS_TOKEN: token });
    assert.equal(dev.status, 2, dev.stderr);
    assert.equal(JSON.parse(dev.stderr).code, 'invalid_origin');
    assert.ok(!(dev.stdout + dev.stderr).includes(secret));
  } finally { f.close(); }
});

test('env files are data: no shell expansion, auth/origin overrides, or global process mutation', () => {
  const f = fixture();
  try {
    const marker = join(f.home, 'must-not-exist');
    const literal = `$(touch ${marker})`;
    writeFileSync(f.path, `LIVEKIT_URL=wss://fixture.livekit.invalid\nLIVEKIT_API_KEY='${literal}'\nLIVEKIT_API_SECRET="line1\nline2"\nCHERT_USER_ACCESS_TOKEN=untrusted\nCHERT_CONTROL_ORIGIN=https://untrusted.test\nCHERT_HOME=/untrusted\nNODE_OPTIONS=--untrusted\n`);
    const env = { KEEP: 'present' };
    const loaded = devSettings(f.home, { 'env-file': f.path }, env);
    assert.deepEqual(loaded.env, { KEEP: 'present', LIVEKIT_URL: 'wss://fixture.livekit.invalid', LIVEKIT_API_KEY: literal, LIVEKIT_API_SECRET: 'line1\nline2' });
    assert.deepEqual(env, { KEEP: 'present' });
    assert.equal(existsSync(marker), false);
  } finally { f.close(); }
});

test('explicit flags override saved defaults; shell credentials override file values', () => {
  const f = fixture();
  try {
    saveDevSetup(f.home, project, f.path, {});
    assert.equal(devSettings(f.home, {}, {}).project, project);
    const alternative = join(f.home, 'other.env');
    writeFileSync(alternative, 'LIVEKIT_API_KEY=other-key\nLIVEKIT_API_SECRET=other-secret\n');
    const loaded = devSettings(f.home, { project: other, 'env-file': alternative }, { LIVEKIT_API_SECRET: 'shell-secret' });
    assert.equal(loaded.project, other);
    assert.equal(loaded.env.LIVEKIT_API_KEY, 'other-key');
    assert.equal(loaded.env.LIVEKIT_API_SECRET, 'shell-secret');
    assert.equal(loaded.env.LIVEKIT_URL, undefined, 'explicit file replaces the saved file');
  } finally { f.close(); }
});

test('missing or corrupt saved settings fail closed, without leaking file contents', () => {
  const f = fixture();
  try {
    saveDevSetup(f.home, project, f.path, {});
    rmSync(f.path);
    assert.throws(() => devSettings(f.home, {}, {}), { code: 'env_file_unreadable' });
    writeFileSync(join(f.home, 'dev-defaults.json'), secret);
    const result = cli(f.home, ['doctor']);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).code, 'invalid_dev_setup');
    assert.ok(!result.stderr.includes(secret));
    clearDevSetup(f.home);
    assert.deepEqual(devSettings(f.home, {}, {}), { env: {} });
  } finally { f.close(); }
});

test('failed setup preserves earlier defaults; clear leaves login and recovery state alone', () => {
  const f = fixture();
  try {
    saveDevSetup(f.home, project, f.path, {});
    const path = join(f.home, 'dev-defaults.json');
    const before = readFileSync(path, 'utf8');
    assert.throws(() => saveDevSetup(f.home, 'invalid', f.path, {}), { code: 'invalid_project' });
    assert.throws(() => saveDevSetup(f.home, other, join(f.home, 'missing'), {}), { code: 'env_file_unreadable' });
    assert.equal(readFileSync(path, 'utf8'), before);
    writeFileSync(join(f.home, 'credentials.json'), secret);
    writeFileSync(join(f.home, 'journal.json'), 'retained');
    assert.equal(cli(f.home, ['setup', '--clear']).status, 0);
    assert.equal(existsSync(path), false);
    assert.equal(readFileSync(join(f.home, 'credentials.json'), 'utf8'), secret);
    assert.equal(readFileSync(join(f.home, 'journal.json'), 'utf8'), 'retained');
  } finally { f.close(); }
});

test('doctor accepts --env-file and checks the parsed settings without a session', () => {
  const f = fixture();
  try {
    writeFileSync(f.path, `LIVEKIT_URL=https://invalid.test\nLIVEKIT_API_KEY=key\nLIVEKIT_API_SECRET=${secret}`);
    const result = cli(f.home, ['doctor', '--env-file', f.path, '--project', project]);
    assert.equal(result.status, 3, result.stderr);
    const checks = JSON.parse(result.stdout).checks as { name: string; status: string; detail: string }[];
    assert.equal(checks.find(check => check.name === 'session')?.status, 'fail');
    assert.equal(checks.find(check => check.name === 'livekit')?.status, 'fail');
    assert.ok(!result.stdout.includes(secret));
  } finally { f.close(); }
});

test('setup requires explicit env file and project, rejects conflicts, and validates credentials locally', () => {
  const f = fixture();
  try {
    for (const args of [[], ['--env-file', f.path], ['--project', project], ['--clear', '--project', project]]) {
      assert.equal(cli(f.home, ['setup', ...args]).status, 2);
    }
    writeFileSync(f.path, 'LIVEKIT_URL=wss://fixture.livekit.invalid');
    assert.throws(() => saveDevSetup(f.home, project, f.path, {}), { code: 'livekit_credentials_missing' });
    assert.equal(existsSync(join(f.home, 'dev-defaults.json')), false);
  } finally { f.close(); }
});
