import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyContext, context, BEGIN_MARK, END_MARK, type ContextFS } from '../../src/cli/context.js';
import { CLIError } from '../../src/cli/errors.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const chert = (args: string[]) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, CHERT_HOME: '/nonexistent/chert' } });
const block = context().markdown;
const fresh = () => mkdtempSync(join(tmpdir(), 'chert-context-'));

test('write: an empty folder gets AGENTS.md with the block and CLAUDE.md importing it; a second run changes nothing', () => {
  const dir = fresh();
  try {
    const first = applyContext(dir, 'write');
    assert.deepEqual(first.actions, [{ file: 'AGENTS.md', action: 'created' }, { file: 'CLAUDE.md', action: 'created' }]);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), block + '\n');
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    const again = applyContext(dir, 'write');
    assert.deepEqual(again.actions, [{ file: 'AGENTS.md', action: 'unchanged' }, { file: 'CLAUDE.md', action: 'unchanged' }]);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), block + '\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write: user text outside the marks survives; a stale block is replaced in place; a file without a block gets it appended', () => {
  const dir = fresh();
  try {
    const stale = `${BEGIN_MARK} (chert 0.0.1; refresh: chert context --write) -->\n# old\n${END_MARK}`;
    writeFileSync(join(dir, 'AGENTS.md'), `# My agent\n\nKeep this.\n\n${stale}\n\nAnd this after.\n`);
    const result = applyContext(dir, 'write');
    assert.deepEqual(result.actions[0], { file: 'AGENTS.md', action: 'updated' });
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), `# My agent\n\nKeep this.\n\n${block}\n\nAnd this after.\n`);
    writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n\nRules of my own.\n');
    applyContext(dir, 'write');
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), `# Mine\n\nRules of my own.\n\n${block}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write: CLAUDE.md without the import gets it appended and is otherwise left alone; with it, nothing changes', () => {
  const dir = fresh();
  try {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Team notes\nUse bun.');
    const result = applyContext(dir, 'write');
    assert.deepEqual(result.actions[1], { file: 'CLAUDE.md', action: 'appended' });
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Team notes\nUse bun.\n@AGENTS.md\n');
    assert.deepEqual(applyContext(dir, 'write').actions[1], { file: 'CLAUDE.md', action: 'unchanged' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write: a symlinked AGENTS.md or CLAUDE.md is refused with exit 4 and nothing is written; .env.local is never opened', () => {
  const dir = fresh();
  try {
    writeFileSync(join(dir, '.env.local'), 'LIVEKIT_API_SECRET=SECRET_SENTINEL_not_to_be_read\n', { mode: 0o600 });
    const opened: string[] = [];
    const spy: ContextFS = {
      readFile: path => { opened.push(path); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; },
      writeFile: (path, text) => { opened.push(path); writeFileSync(path, text); },
      lstat: path => { try { const s = lstatSync(path); return { symlink: s.isSymbolicLink(), file: s.isFile(), directory: s.isDirectory() }; } catch { return undefined; } },
    };
    applyContext(dir, 'write', spy);
    assert.ok(opened.every(path => !path.endsWith('.env.local')), opened.join(','));
    assert.ok(opened.some(path => path.endsWith('AGENTS.md')));
    mkdirSync(join(dir, 'elsewhere')); writeFileSync(join(dir, 'elsewhere', 'AGENTS.md'), 'theirs\n');
    rmSync(join(dir, 'AGENTS.md')); symlinkSync(join(dir, 'elsewhere', 'AGENTS.md'), join(dir, 'AGENTS.md'));
    assert.throws(() => applyContext(dir, 'write'), (error: unknown) => error instanceof CLIError && error.code === 'context_target_symlink' && error.exit === 4);
    assert.equal(readFileSync(join(dir, 'elsewhere', 'AGENTS.md'), 'utf8'), 'theirs\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check: current is exit 0, missing is exit 3, stale is exit 3, and --json lists the actions; a folder that does not exist is a usage error', () => {
  const dir = fresh();
  try {
    const missing = chert(['context', '--check', dir, '--json']);
    assert.equal(missing.status, 3); assert.equal(JSON.parse(missing.stderr).code, 'context_missing');
    const written = chert(['context', '--write', dir, '--json']);
    assert.equal(written.status, 0, written.stderr);
    const record = JSON.parse(written.stdout);
    assert.equal(record.code, 'context_written'); assert.deepEqual(record.actions.map((a: { action: string }) => a.action), ['created', 'created']);
    assert.equal(chert(['context', '--check', dir]).status, 0);
    writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(dir, 'AGENTS.md'), 'utf8').replace(/chert [^;]+;/, 'chert 0.0.1;'));
    const stale = chert(['context', '--check', dir, '--json']);
    assert.equal(stale.status, 3); assert.equal(JSON.parse(stale.stderr).code, 'context_stale');
    const text = chert(['context', '--write', dir]);
    assert.equal(text.status, 0); assert.match(text.stdout, /AGENTS\.md: updated/); assert.match(text.stdout, /CLAUDE\.md: unchanged/);
    assert.equal(chert(['context', '--write', join(dir, 'nope')]).status, 2);
    assert.equal(chert(['context', '--write', dir, '--check']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
