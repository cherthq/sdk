import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devSettings, placeholders, unfilledSentence } from '../../src/dev/setup.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const example = fileURLToPath(new URL('../../../examples/student-agent/', import.meta.url));
function scratch() { const folder = realpathSync(mkdtempSync(join(tmpdir(), 'chert-agent-'))); return { folder, close: () => rmSync(folder, { recursive: true, force: true }) }; }
const chert = (args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, CHERT_HOME: join(cwd, '.chert-home'), ...env } });

test('agent name: read from the folder file so it is typed once; the shell and --agent come first', () => {
  const s = scratch();
  try {
    const home = join(s.folder, 'home'); mkdirSync(home);
    writeFileSync(join(s.folder, '.env.local'), 'LIVEKIT_URL=wss://x.livekit.invalid\nLIVEKIT_API_KEY=k\nLIVEKIT_API_SECRET=s\nAGENT_NAME=from-file\n');
    assert.equal(devSettings(home, {}, {}, s.folder).agent, 'from-file');
    assert.equal(devSettings(home, {}, { AGENT_NAME: 'from-shell' }, s.folder).agent, 'from-shell');
    assert.equal(devSettings(home, {}, { LIVEKIT_URL: 'wss://y.livekit.invalid', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }, s.folder).agent, 'from-file', 'keys in the shell do not hide the name in the file');
    assert.equal(devSettings(home, { 'env-file': join(s.folder, '.env.local') }, {}, join(s.folder, 'home')).agent, 'from-file', 'a named env file is read for it too');
    // A saved or named env file that holds only the keys: the name still comes from the folder the command is run in.
    writeFileSync(join(home, 'keys.env'), 'LIVEKIT_URL=wss://z.livekit.invalid\nLIVEKIT_API_KEY=k\nLIVEKIT_API_SECRET=s\n');
    const elsewhere = devSettings(home, { 'env-file': join(home, 'keys.env') }, {}, s.folder);
    assert.equal(elsewhere.agent, 'from-file'); assert.equal(elsewhere.env.LIVEKIT_URL, 'wss://z.livekit.invalid', 'and the keys still come from the named file');
    assert.equal(devSettings(home, {}, {}, home).agent, undefined);
    assert.equal(devSettings(home, {}, {}, s.folder).env.AGENT_NAME, undefined, 'the name is returned, not put in the environment');
  } finally { s.close(); }
});

test('placeholders: keys still reading YOUR_ are named, so the fix is obvious', () => {
  assert.deepEqual(placeholders({ LIVEKIT_URL: 'wss://YOUR_PROJECT.livekit.cloud', LIVEKIT_API_KEY: 'YOUR_LIVEKIT_API_KEY', LIVEKIT_API_SECRET: 'real' }), ['LIVEKIT_URL', 'LIVEKIT_API_KEY']);
  assert.deepEqual(placeholders({ LIVEKIT_URL: 'wss://mine.livekit.cloud', LIVEKIT_API_KEY: 'APIabc', LIVEKIT_API_SECRET: 'real' }), []);
});

test('placeholders: chert dev and chert doctor say it in one sentence, singular for one value', () => {
  assert.equal(unfilledSentence(['LIVEKIT_API_SECRET']), 'LIVEKIT_API_SECRET still holds its YOUR_ placeholder');
  assert.equal(unfilledSentence(['LIVEKIT_URL', 'LIVEKIT_API_KEY']), 'LIVEKIT_URL, LIVEKIT_API_KEY still hold the YOUR_ placeholders');
});

test('agent folder: an AGENT_NAME chert cannot use is refused by dev and never offered by doctor', () => {
  const s = scratch();
  try {
    writeFileSync(join(s.folder, '.env.local'), 'LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud\nLIVEKIT_API_KEY=YOUR_KEY\nLIVEKIT_API_SECRET=YOUR_SECRET\nAGENT_NAME=my agent\n');
    const token = `a.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c`;
    const dev = chert(['dev', '--json'], s.folder, { CHERT_USER_ACCESS_TOKEN: token });
    assert.equal(dev.status, 2); assert.equal(JSON.parse(dev.stderr).code, 'invalid_agent_name');
    const doctor = chert(['doctor'], s.folder, { CHERT_USER_ACCESS_TOKEN: token, CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9' });
    assert.match(doctor.stdout, /Pass --agent NAME to check/); assert.doesNotMatch(doctor.stdout, /my agent/);
    const named = chert(['doctor', '--agent', 'my agent', '--json'], s.folder, { CHERT_USER_ACCESS_TOKEN: token });
    assert.equal(named.status, 2); assert.equal(JSON.parse(named.stderr).code, 'invalid_agent_name', 'doctor checks --agent with the same rule as dev');
  } finally { s.close(); }
});

test('agent folder: with the example env file, chert dev needs no --agent and says to fill in the keys', () => {
  const s = scratch();
  try {
    mkdirSync(join(s.folder, 'otter'));
    copyFileSync(join(example, '.env.example'), join(s.folder, 'otter', '.env.local'));
    const token = `a.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c`;
    const result = chert(['dev'], join(s.folder, 'otter'), { CHERT_USER_ACCESS_TOKEN: token });
    assert.equal(result.status, 3);
    assert.equal(result.stderr, 'Put your LiveKit values in .env.local: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET still hold the YOUR_ placeholders. (livekit_credentials_placeholder)\n');
    const doctor = chert(['doctor'], join(s.folder, 'otter'), { CHERT_USER_ACCESS_TOKEN: token, CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9' });
    assert.equal(doctor.status, 3); assert.match(doctor.stdout, /✗ livekit +LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET still hold the YOUR_ placeholders\./);
    assert.match(doctor.stdout, /Pass --agent team-otter-agent to check/, 'doctor offers the name it found, and does not run the paid check unasked');
    assert.match(chert(['dev'], s.folder, { CHERT_USER_ACCESS_TOKEN: token }).stderr, /^Name your agent: chert dev --agent my-agent, or set AGENT_NAME in \.env\.local\./);
  } finally { s.close(); }
});
