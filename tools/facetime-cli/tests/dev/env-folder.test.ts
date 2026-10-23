import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devSettings, saveDevSetup } from '../../src/dev/setup.js';

const project = '40a51cbd-d3c8-450d-a9b4-4f82dd8741cd';
const secret = 'SECRET_SENTINEL_never_print_or_copy';
const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const keys = (url: string) => `LIVEKIT_URL=${url}\nLIVEKIT_API_KEY=key\nLIVEKIT_API_SECRET=${secret}\nOPENAI_API_KEY=not-for-chert\nCHERT_USER_ACCESS_TOKEN=must-not-load\n`;
function folders() {
  // The real path, as a spawned command sees its working folder (the temporary folder is behind a link on macOS).
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'chert-home-'))), folder = realpathSync(mkdtempSync(join(tmpdir(), 'chert-agent-')));
  return { home, folder, close: () => { rmSync(home, { recursive: true, force: true }); rmSync(folder, { recursive: true, force: true }); } };
}

test('no setup: the LiveKit keys are read from .env.local in the folder the command is run from', () => {
  const f = folders();
  try {
    writeFileSync(join(f.folder, '.env.local'), keys('wss://local.livekit.invalid'));
    const settings = devSettings(f.home, {}, {}, f.folder);
    assert.equal(settings.env.LIVEKIT_URL, 'wss://local.livekit.invalid'); assert.equal(settings.env.LIVEKIT_API_KEY, 'key'); assert.equal(settings.env.LIVEKIT_API_SECRET, secret);
    assert.equal(settings.envFile, join(f.folder, '.env.local'), 'and the command can say which file it used');
    assert.equal(settings.env.OPENAI_API_KEY, undefined, 'only the three LiveKit values are taken');
    assert.equal(settings.env.CHERT_USER_ACCESS_TOKEN, undefined, 'a sign-in is never taken from a folder file');
    assert.equal(settings.project, undefined, 'the project comes from the sign-in, not from the folder');
  } finally { f.close(); }
});

test('no setup: .env is used when there is no .env.local, and .env.local wins when both exist', () => {
  const f = folders();
  try {
    writeFileSync(join(f.folder, '.env'), keys('wss://plain.livekit.invalid'));
    assert.equal(devSettings(f.home, {}, {}, f.folder).env.LIVEKIT_URL, 'wss://plain.livekit.invalid');
    assert.equal(devSettings(f.home, {}, {}, f.folder).envFile, join(f.folder, '.env'));
    writeFileSync(join(f.folder, '.env.local'), keys('wss://local.livekit.invalid'));
    assert.equal(devSettings(f.home, {}, {}, f.folder).env.LIVEKIT_URL, 'wss://local.livekit.invalid');
  } finally { f.close(); }
});

test('no setup: the shell, --env-file and a saved setup each come before the folder file', () => {
  const f = folders();
  try {
    writeFileSync(join(f.folder, '.env.local'), keys('wss://folder.livekit.invalid'));
    const shell = { LIVEKIT_URL: 'wss://shell.livekit.invalid', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' };
    const fromShell = devSettings(f.home, {}, shell, f.folder);
    assert.equal(fromShell.env.LIVEKIT_URL, 'wss://shell.livekit.invalid'); assert.equal(fromShell.envFile, undefined, 'a complete shell needs no file');
    const partial = devSettings(f.home, {}, { LIVEKIT_URL: 'wss://shell.livekit.invalid' }, f.folder);
    assert.equal(partial.env.LIVEKIT_URL, 'wss://shell.livekit.invalid', 'a shell value still wins'); assert.equal(partial.env.LIVEKIT_API_KEY, 'key', 'and the file fills what is missing');
    const explicit = join(f.home, 'explicit.env'); writeFileSync(explicit, keys('wss://explicit.livekit.invalid'));
    const flagged = devSettings(f.home, { 'env-file': explicit }, {}, f.folder);
    assert.equal(flagged.env.LIVEKIT_URL, 'wss://explicit.livekit.invalid'); assert.equal(flagged.envFile, undefined);
    saveDevSetup(f.home, project, explicit, {});
    const saved = devSettings(f.home, {}, {}, f.folder);
    assert.equal(saved.env.LIVEKIT_URL, 'wss://explicit.livekit.invalid'); assert.equal(saved.project, project); assert.equal(saved.envFile, undefined);
  } finally { f.close(); }
});

test('no setup: a folder file with no LiveKit values, or one that cannot be read, is left alone', () => {
  const f = folders();
  try {
    writeFileSync(join(f.folder, '.env.local'), 'OPENAI_API_KEY=x\n');
    const none = devSettings(f.home, {}, {}, f.folder);
    assert.equal(none.env.LIVEKIT_URL, undefined); assert.equal(none.envFile, undefined);
    writeFileSync(join(f.folder, '.env'), keys('wss://plain.livekit.invalid'));
    assert.equal(devSettings(f.home, {}, {}, f.folder).envFile, join(f.folder, '.env'), 'the next file is tried');
    assert.equal(devSettings(f.home, {}, {}, join(f.folder, 'missing')).envFile, undefined, 'a folder that does not exist is not an error');
  } finally { f.close(); }
});

test('no setup: chert doctor run from the agent folder finds the keys, says which file, and never prints them', () => {
  const f = folders();
  try {
    writeFileSync(join(f.folder, '.env.local'), keys('wss://local.livekit.invalid'));
    const run = (cwd: string, args: string[] = []) => spawnSync(process.execPath, [executable, 'doctor', ...args], { encoding: 'utf8', timeout: 20000, cwd, env: { PATH: process.env.PATH, CHERT_HOME: f.home } });
    const inFolder = run(f.folder);
    assert.match(inFolder.stdout, /Using the LiveKit keys in \.env\.local from this folder\./); assert.doesNotMatch(inFolder.stdout, /LiveKit variables are not set/);
    assert.ok(!(inFolder.stdout + inFolder.stderr).includes(secret));
    const records = run(f.folder, ['--json']).stdout.trim().split('\n').map(line => JSON.parse(line) as { code: string; path?: string });
    assert.equal(records.find(record => record.code === 'livekit_env_file')!.path, join(f.folder, '.env.local'));
    const elsewhere = run(f.home);
    assert.doesNotMatch(elsewhere.stdout, /Using the LiveKit keys/); assert.match(elsewhere.stdout, /\.env\.local/, 'the fix says where to put them');
  } finally { f.close(); }
});
