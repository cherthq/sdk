import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCommand, scaffold } from '../../src/cli/new.js';
import { CLIError } from '../../src/cli/errors.js';

const sandbox = () => mkdtempSync(join(tmpdir(), 'chert-new-'));
async function code(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { assert.ok(error instanceof CLIError, String(error)); return error.code; }
  return assert.fail('expected a CLIError');
}

test('new: copies the student starter, writes .env.local with the folder name as the agent name, and leaves the lock and secrets out', () => {
  const cwd = sandbox();
  try {
    const made = scaffold({ dir: 'my-agent' }, cwd);
    const target = join(cwd, 'my-agent');
    assert.equal(made.dir, target); assert.equal(made.starter, 'student-agent'); assert.equal(made.agent, 'my-agent');
    for (const name of ['agent.mjs', 'greet.mjs', 'package.json', 'README.md', '.env.example', '.gitignore', '.env.local', 'AGENTS.md', 'CLAUDE.md']) assert.ok(existsSync(join(target, name)), name);
    for (const name of ['package-lock.json', 'node_modules', 'face.mjs']) assert.equal(existsSync(join(target, name)), false, name);
    const env = readFileSync(join(target, '.env.local'), 'utf8');
    assert.match(env, /^AGENT_NAME=my-agent$/m); assert.match(env, /^LIVEKIT_URL=wss:\/\/YOUR_PROJECT\.livekit\.cloud$/m); assert.match(env, /^OPENAI_API_KEY=YOUR_OPENAI_API_KEY$/m);
    assert.equal(statSync(join(target, '.env.local')).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(target, 'agent.mjs'), 'utf8'), readFileSync(new URL('../../../examples/student-agent/agent.mjs', import.meta.url), 'utf8'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('new: --video copies the video starter with its face, and --agent sets the name', () => {
  const cwd = sandbox();
  try {
    const made = scaffold({ dir: 'video', video: true, agent: 'team-otter' }, cwd);
    assert.equal(made.starter, 'video-agent'); assert.equal(made.agent, 'team-otter');
    assert.ok(existsSync(join(made.dir, 'face.mjs'))); assert.ok(existsSync(join(made.dir, 'greet.mjs')));
    assert.match(readFileSync(join(made.dir, '.env.local'), 'utf8'), /^AGENT_NAME=team-otter$/m);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('new: a folder name that is not a valid agent name is cleaned into one, and a bad --agent is refused', async () => {
  const cwd = sandbox();
  try {
    const made = scaffold({ dir: 'Team Otter!' }, cwd);
    assert.equal(made.agent, 'team-otter');
    assert.equal(await code(Promise.resolve().then(() => scaffold({ dir: 'other', agent: 'no spaces here' }, cwd))), 'invalid_agent_name');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('new: refuses a folder that already has files, accepts an empty one, and needs a name', async () => {
  const cwd = sandbox();
  try {
    mkdirSync(join(cwd, 'taken')); writeFileSync(join(cwd, 'taken', 'notes.txt'), 'x');
    assert.equal(await code(Promise.resolve().then(() => scaffold({ dir: 'taken' }, cwd))), 'new_target_exists');
    assert.equal(readdirSync(join(cwd, 'taken')).length, 1);
    mkdirSync(join(cwd, 'empty'));
    assert.equal(scaffold({ dir: 'empty' }, cwd).agent, 'empty');
    assert.equal(await code(Promise.resolve().then(() => scaffold({ dir: '' }, cwd))), 'missing_input');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('new: the command prints what it made and the next three commands', async () => {
  const cwd = sandbox(); const records: Record<string, unknown>[] = [];
  try {
    assert.equal(await newCommand(['my-agent'], records.push.bind(records), cwd), 0);
    const record = records.find(r => r.code === 'new_created')!;
    assert.ok(record); assert.equal(record.agent, 'my-agent');
    const message = String(record.message);
    assert.match(message, /cd my-agent && npm install/); assert.match(message, /npm start/); assert.match(message, /chert dev --agent my-agent/); assert.match(message, /\.env\.local/);
    assert.equal(await code(newCommand(['--bogus', 'x'], records.push.bind(records), cwd)), 'invalid_usage');
    assert.equal(await code(newCommand([], records.push.bind(records), cwd)), 'missing_input');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
