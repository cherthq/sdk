import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, cliHarness } from '../fixtures/cli-harness.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
async function npm(args: string[], cwd: string) {
  const child = spawn('npm', args, { cwd, env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: cwd,
    npm_config_userconfig: '/dev/null', npm_config_globalconfig: join(tmpdir(), 'chert-cli-empty-global-npmrc'), npm_config_cache: join(tmpdir(), 'chert-cli-npm-cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); return stdout;
  } finally { clearTimeout(timer); }
}
test('packed npm artifact installs with production dependencies only and runs the fixture lifecycle outside the checkout', { timeout: 90000 }, async () => {
  const consumer = mkdtempSync(join(tmpdir(), 'chert-consumer-')); const h = await cliHarness();
  try {
    // The test suite already compiled the tree. Avoid racing its build from prepack.
    const pack = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], root)) as { filename: string; files: { path: string }[] }[];
    const artifact = pack[0]!;
    const paths = artifact.files.map(file => file.path);
    assert.ok(paths.includes('dist/src/cli/main.js')); assert.ok(paths.includes('CLI_GUIDE.md')); assert.ok(paths.includes('CLI_USER_GUIDE.md')); assert.ok(paths.includes('LICENSE')); assert.ok(paths.includes('DEVELOPER_GUIDE.md')); assert.ok(paths.includes('COMMANDS.md')); assert.ok(paths.includes('QUICKSTART.md'));
    assert.ok(paths.includes('docs/CLI_ONBOARDING.md'));
    assert.ok(paths.every(path => ['package.json', 'README.md', 'CLI_GUIDE.md', 'CLI_USER_GUIDE.md', 'LICENSE', 'DEVELOPER_GUIDE.md', 'COMMANDS.md', 'QUICKSTART.md', 'docs/BYOR_OWNERSHIP.md', 'docs/CLI_ONBOARDING.md'].includes(path) || /^dist\/src\/.*\.(js|d\.ts)$/.test(path) || /^examples\/byor\/[^/]+$/.test(path) || /^examples\/(student-agent|video-agent)\/[^/]+$/.test(path)), JSON.stringify(paths));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'clean-consumer', version: '1.0.0', private: true }));
    await npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org', join(consumer, artifact.filename)], consumer);
    const installed = join(consumer, 'node_modules/@trychert/facetime');
    assert.equal(lstatSync(installed).isSymbolicLink(), false);
    for (const excluded of ['typescript', 'eslint', 'tsx', '@types/node']) assert.equal(existsSync(join(consumer, 'node_modules', excluded)), false);
    const executable = join(consumer, 'node_modules/.bin/chert');
    assert.ok(realpathSync(executable).startsWith(realpathSync(consumer)));
    assert.equal(lstatSync(realpathSync(executable)).mode & 0o111, 0o111);
    const direct = spawn(executable, ['--version'], { cwd: consumer, env: { PATH: `${dirname(globalThis.process.execPath)}:${globalThis.process.env.PATH}` }, stdio: 'ignore' });
    assert.equal(await new Promise(resolve => direct.once('close', resolve)), 0);
    assert.equal(await cli(executable, ['--help'], {}, consumer).exit, 0);
    assert.equal(await cli(executable, ['--version'], {}, consumer).exit, 0);
    assert.equal(await cli(executable, h.initArgs, {}, consumer).exit, 0);
    const check = h.launch(executable, 'check', consumer); assert.equal(await check.exit, 3); assert.equal(JSON.parse(check.stdout).health.code, 'available');
    assert.equal(h.effects.management, 0);
    const process = h.launch(executable, 'run', consumer); await process.waitConnected();
    const owner = await h.call(); await h.terminal(owner);
    assert.equal(h.authority.commitCount, 1); assert.equal(h.effects.created, 1); assert.equal(h.effects.deleted, 1);
    assert.equal(await process.stop(), 0);
    const status = h.launch(executable, 'status', consumer); assert.equal(await status.exit, 0); assert.equal(JSON.parse(status.stdout).state.pending.cleanup, 0);
  } finally { await h.close(); rmSync(consumer, { recursive: true, force: true }); }
});
