import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, BEGIN_MARK, END_MARK } from '../../src/cli/context.js';
import { commands, mainHelp } from '../../src/cli/help.js';
import { cliVersion } from '../../src/cli/version.js';
import { developerCommands } from '../../src/cli/names.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const chert = (args: string[]) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, CHERT_HOME: '/nonexistent/chert' } });

test('context: one Markdown block from the help and the guide, with every developer command and the rules an agent must keep', () => {
  const { markdown, version } = context();
  assert.equal(version, cliVersion());
  for (const command of commands.filter(entry => !entry.advanced)) assert.match(markdown, new RegExp(`\`chert ${command.name}`), command.name);
  assert.match(markdown, /within 10 s(econds)? of bridge_ready/i, 'the greeting rule');
  assert.match(markdown, /exactly one unmuted audio track/, 'one audio track');
  assert.match(markdown, /\.env\.local/); assert.match(markdown, /[Nn]ever (read aloud, )?print/, 'the secrets rule');
  assert.match(markdown, /Exit codes/); assert.match(markdown, /130/, 'exit codes');
  assert.match(markdown, /--json/); assert.match(markdown, /schema_version/);
  assert.match(markdown, /--takeover/); assert.match(markdown, /--force/);
  assert.match(markdown, /one call at a time/i, 'the shared line');
  for (const code of ['agent_warm', 'call_bridge_ready', 'call_declined', 'dev_stopped', 'line_in_use', 'dev_reconnected']) assert.ok(markdown.includes(code), code);
  assert.doesNotMatch(markdown, /\b30 minutes\b/, 'policy numbers stay with Chert');
});

test('context: bounded for Codex and Claude Code, marked once, and free of secrets and dashes', () => {
  const { markdown, version } = context();
  const lines = markdown.split('\n');
  assert.ok(lines.length <= 150, `${lines.length} lines`);
  assert.ok(Buffer.byteLength(markdown) <= 12 * 1024, `${Buffer.byteLength(markdown)} bytes`);
  assert.equal(markdown.split(BEGIN_MARK).length - 1, 1); assert.equal(markdown.split(END_MARK).length - 1, 1);
  assert.ok(lines[0]!.startsWith(BEGIN_MARK) && lines[0]!.includes(`chert ${version}`), lines[0]);
  assert.equal(lines.at(-1), END_MARK);
  assert.doesNotMatch(markdown, /[–—]/, 'no dashes');
  assert.doesNotMatch(markdown, /(sk|wss|APIK|SECRET)[-_][A-Za-z0-9]{8,}/, 'no key-like values');
  for (const line of lines) assert.ok(line.length <= 400, `long line: ${line.slice(0, 60)}`);
});

test('context: chert context prints the block, --json returns it with the version, and the help lists the command', () => {
  assert.ok(developerCommands.includes('context'));
  assert.match(mainHelp(), /^\s+context\s+/m);
  const text = chert(['context']);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, context().markdown + '\n');
  const json = chert(['context', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const record = JSON.parse(json.stdout);
  assert.equal(record.schema_version, 1); assert.equal(record.command, 'context'); assert.equal(record.code, 'context');
  assert.equal(record.markdown, context().markdown); assert.equal(record.version, cliVersion());
  const bad = chert(['context', '--nope']);
  assert.equal(bad.status, 2);
});
