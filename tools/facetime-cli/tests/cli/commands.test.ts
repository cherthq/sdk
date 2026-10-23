import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
test('compiled chert executable provides help without configuration or credentials', () => {
  const result = spawnSync(process.execPath, [executable, '--help', '--all'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /init/); assert.match(result.stdout, /check/); assert.match(result.stdout, /run/); assert.match(result.stdout, /status/);
});

import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, chmodSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, cliHarness, SECRETS } from '../fixtures/cli-harness.js';
import { saveConfig, type Config } from '../../src/cli/config.js';
import { liveKitAPI } from '../../src/adapters/livekit.js';
const initFlags = ['--non-interactive', '--agent-name', 'fixture-agent', '--deployment', 'fixture', '--boot', 'fixture-boot',
  '--livekit-url', 'wss://fixture.invalid', '--hook-origin', 'http://127.0.0.1:1'];
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'cli-command-'));
  return { directory, config: join(directory, 'config.json'), state: join(directory, 'state'), close() { rmSync(directory, { recursive: true, force: true }); } };
}
for (const args of [['login', '--nope'], ['init'], ['init', '--config', '/unused', '--non-interactive'], ['run', '--config', '/unused', '--token', 'SECRET_SENTINEL']]) {
  test(`usage errors are JSON and sanitized: ${args.slice(0, 2).join(' ')}`, async () => {
    const p = cli(executable, [...args, '--json']); assert.equal(await p.exit, 2);
    assert.ok(JSON.parse(p.stderr).code); assert.ok(!p.stderr.includes('SECRET_SENTINEL')); assert.equal(p.stdout, '');
  });
}
test('init is private, exclusive, non-allocating and never saves environment values', async () => {
  const w = workspace();
  try {
    const args = ['init', '--config', w.config, ...initFlags, '--state-dir', w.state, '--json'];
    const first = cli(executable, args, SECRETS); assert.equal(await first.exit, 0);
    const saved = readFileSync(w.config, 'utf8'); const config = JSON.parse(saved) as Config;
    assert.equal(config.transport.mode, 'unconfigured'); assert.equal(statSync(w.config).mode & 0o777, 0o600);
    assert.equal(existsSync(w.state), false);
    for (const secret of Object.values(SECRETS)) assert.ok(!saved.includes(secret) && !first.stdout.includes(secret));
    const second = cli(executable, args); assert.equal(await second.exit, 2); assert.equal(readFileSync(w.config, 'utf8'), saved);
    const run = cli(executable, ['run', '--config', w.config, '--json'], SECRETS);
    assert.equal(await run.exit, 6); assert.equal(JSON.parse(run.stderr).code, 'backend_not_implemented'); assert.equal(existsSync(w.state), false);
  } finally { w.close(); }
});
for (const fault of ['unknown_key', 'secret_value', 'wrong_version', 'remote_hook', 'relative_state', 'url_credentials', 'unsafe_permissions', 'symlink'] as const) {
  test(`config rejects ${fault} before effects`, async () => {
    const w = workspace();
    try {
      const init = cli(executable, ['init', '--config', w.config, ...initFlags, '--state-dir', w.state]); assert.equal(await init.exit, 0);
      const value = JSON.parse(readFileSync(w.config, 'utf8'));
      if (fault === 'unknown_key') value.secret = 'SECRET_SENTINEL';
      if (fault === 'secret_value') value.livekit.secret_env = 'actual-secret-SENTINEL';
      if (fault === 'wrong_version') value.schema_version = 99;
      if (fault === 'remote_hook') value.hook.origin = 'https://remote.invalid';
      if (fault === 'relative_state') value.state_dir = './state';
      if (fault === 'url_credentials') value.livekit.url = 'wss://user:SECRET_SENTINEL@host.invalid';
      writeFileSync(w.config, JSON.stringify(value));
      if (fault === 'unsafe_permissions') chmodSync(w.config, 0o644);
      if (fault === 'symlink') { const copy = join(w.directory, 'copy'); writeFileSync(copy, JSON.stringify(value), { mode: 0o600 }); rmSync(w.config); symlinkSync(copy, w.config); }
      const p = cli(executable, ['check', '--config', w.config, '--json']);
      assert.ok([2, 4].includes((await p.exit)!)); assert.ok(!p.stderr.includes('SECRET_SENTINEL')); assert.equal(existsSync(w.state), false);
    } finally { w.close(); }
  });
}
test('unsupported Node rejects before reading config or printing supplied input', () => {
  const p = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `Object.defineProperty(process.versions, 'node', { value: '20.19.6' }); process.argv = ['node', 'chert', 'init', '--config', 'SECRET_SENTINEL', '--json']; await import(${JSON.stringify(executable)});`],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(p.status, 5, p.stderr); assert.equal(JSON.parse(p.stderr).code, 'unsupported_runtime'); assert.ok(!p.stderr.includes('SECRET_SENTINEL'));
});
for (const health of ['available', 'unavailable', 'unknown', 'stale', 'signature', 'missing_credentials'] as const) {
  test(`check separates ${health} health from authorization and allocates nothing`, async () => {
    const h = await cliHarness();
    try {
      const init = cli(executable, h.initArgs); assert.equal(await init.exit, 0);
      if (health === 'unavailable') h.h.connected = false;
      if (health === 'unknown') h.h.connected = null;
      if (health === 'stale') h.stale = true;
      if (health === 'signature') h.badSignature = true;
      const p = cli(executable, ['check', '--config', h.configPath, '--json'], health === 'missing_credentials' ? {} : SECRETS);
      assert.equal(await p.exit, 3); const report = JSON.parse(p.stdout);
      const expected = health === 'available' ? 'available' : health === 'unavailable' ? 'agent_unavailable' : 'agent_availability_unknown';
      assert.equal(report.health.code, expected); assert.equal(report.admission_enabled, false); assert.equal(report.authorization.status, 'unverified');
      assert.equal(h.effects.management, 0); assert.equal(h.effects.created, 0); assert.equal(h.effects.explicitDispatch, 0);
      for (const secret of Object.values(SECRETS)) assert.ok(!(p.stdout + p.stderr).includes(secret));
    } finally { await h.close(); }
  });
}
test('status is read-only and marks saved observations non-live; unsafe state refuses runtime', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    mkdirSync(h.statePath, { mode: 0o755 });
    const p = h.launch(executable); assert.equal(await p.exit, 4); assert.equal(h.effects.management, 0);
    chmodSync(h.statePath, 0o700);
    writeFileSync(join(h.statePath, 'journal.json'), 'bad', { mode: 0o600 });
    const status = h.launch(executable, 'status'); assert.equal(await status.exit, 4); assert.equal(JSON.parse(status.stderr).code, 'journal_unreadable');
    assert.equal(readFileSync(join(h.statePath, 'journal.json'), 'utf8'), 'bad');
  } finally { await h.close(); }
});
test('development SDK override cannot use a non-loopback destination', () => {
  assert.throws(() => liveKitAPI('wss://fixture.invalid', 'fake', 'fake', 'https://external.invalid'));
});
test('version works without configuration', async () => {
  const p = cli(executable, ['--version']); assert.equal(await p.exit, 0); assert.match(p.stdout, /^chert \d+\.\d+\.\d+(-[a-z0-9.]+)?\n$/);
});
test('init schema rejects a development backend that points outside literal loopback', async () => {
  const h = await cliHarness();
  try {
    const path = h.initArgs.at(-1)!; const dev = JSON.parse(readFileSync(path, 'utf8')); dev.relay_origin = 'http://localhost:1234'; writeFileSync(path, JSON.stringify(dev));
    const p = cli(executable, h.initArgs); assert.equal(await p.exit, 2); assert.equal(existsSync(h.configPath), false);
  } finally { await h.close(); }
});
// Keep this import exercised as a public configuration boundary, not a fixture fallback.
test('programmatic config writer applies the same strict schema', () => {
  assert.throws(() => saveConfig('/unused', {} as Config), /invalid_config/);
});

test('orphaned adapter evidence blocks a new runtime journal', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    mkdirSync(h.statePath, { mode: 0o700 }); writeFileSync(join(h.statePath, 'adapter.json'), '{}', { mode: 0o600 });
    const p = h.launch(executable); assert.equal(await p.exit, 4); assert.equal(JSON.parse(p.stderr).code, 'orphaned_receipts');
    assert.equal(existsSync(join(h.statePath, 'journal.json')), false);
  } finally { await h.close(); }
});
