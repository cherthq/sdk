import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { allFlags, commands, commandHelp, commandReference, mainHelp, closest, operatorHelp } from '../../src/cli/help.js';
import { developerCommands, operatorCommands } from '../../src/cli/names.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const chert = (args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, CHERT_HOME: '/nonexistent/chert-help-test', ...env } });

test('help: the developer commands, how to start, and where the rest is; never wider than 80 columns', () => {
  const text = mainHelp();
  assert.deepEqual(commands.map(command => command.name).sort(), [...developerCommands].sort(), 'every developer command has help and nothing else does');
  for (const command of commands.filter(entry => !entry.advanced)) assert.match(text, new RegExp(`^  ${command.name} +${command.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  for (const heading of ['USAGE', 'COMMANDS', 'FLAGS', 'GET STARTED']) assert.match(text, new RegExp(`^${heading}$`, 'm'));
  assert.match(text, /docs\.trychert\.com/); assert.match(text, /chert --help --all/);
  for (const heading of ['VIDEO', 'LEARN MORE']) assert.match(text, new RegExp(`^${heading}$`, 'm'));
  assert.match(text, /camera track from the participant that\s+speaks/); assert.match(text, /chert guide video/);
  for (const name of operatorCommands) assert.doesNotMatch(text, new RegExp(`^  ${name} `, 'm'), `${name} stays out of the short help`);
  for (const help of [text, ...commands.map(command => commandHelp(command.name)!)]) for (const line of help.split('\n')) assert.ok(line.length <= 80, line);
  assert.equal(commandHelp('enroll'), undefined);
});

test('help: -h, --help, a bare chert in a pipe and --help --all', () => {
  for (const args of [['--help'], ['-h'], []]) { const result = chert(args); assert.equal(result.status, 0); assert.equal(result.stdout, mainHelp() + '\n'); }
  const all = chert(['--help', '--all']);
  assert.equal(all.status, 0); assert.ok(all.stdout.startsWith(mainHelp())); assert.match(all.stdout, /\nADVANCED\n/); assert.ok(all.stdout.includes(operatorHelp));
  for (const name of operatorCommands) assert.match(all.stdout, new RegExp(name));
  assert.equal(chert(['-v']).stdout, chert(['--version']).stdout); assert.match(chert(['-v']).stdout, /^chert \d+\.\d+\.\d+/);
});

test('help: each command prints its own help with --help or -h, before doing anything', () => {
  for (const command of commands) for (const flag of ['--help', '-h']) {
    const result = chert([command.name, flag]);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, commandHelp(command.name) + '\n');
    for (const heading of ['USAGE', 'FLAGS', 'EXAMPLES']) assert.match(result.stdout, new RegExp(`^${heading}$`, 'm'));
  }
  assert.equal(chert(['dev', '--agent', 'x', '--help']).stdout, commandHelp('dev') + '\n', 'help wins over other flags, and nothing is contacted');
  const operator = chert(['enroll', '--help']);
  assert.equal(operator.status, 0); assert.equal(operator.stdout, operatorHelp + '\n');
});

test('help: every documented flag is accepted and every undocumented one is refused', () => {
  for (const command of commands) {
    for (const [flag] of allFlags(command)) {
      const [name, value] = flag.split(' ');
      // An unreachable address and an empty input keep the command from doing anything; what matters is that parsing accepts the flag.
      const result = spawnSync(process.execPath, [executable, command.name, name!, ...(value ? [value === 'ORIGIN' ? 'https://127.0.0.1:9' : value === 'UUID' ? '11000000-0000-4000-8000-000000000001' : 'x'] : []), '--json'],
        { encoding: 'utf8', input: '', env: { PATH: process.env.PATH, CHERT_HOME: '/nonexistent/chert-help-test', CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9' } });
      assert.doesNotMatch(result.stderr, /Unknown or duplicate flag/, `${command.name} ${name}: ${result.stderr}`);
    }
    const refused = chert([command.name, '--not-a-flag', '--json']);
    assert.equal(refused.status, 2); assert.equal(JSON.parse(refused.stderr).code, 'invalid_usage');
  }
});

test('help: a mistyped command is named, with the nearest command when there is one', () => {
  assert.equal(closest('dvo'), 'dev'); assert.equal(closest('docter'), 'doctor'); assert.equal(closest('logn'), 'login'); assert.equal(closest('LOGOUT'), 'logout');
  assert.equal(closest('frobnicate'), undefined);
  const near = chert(['docter']);
  assert.equal(near.status, 2); assert.equal(near.stderr, 'Unknown command "docter". Did you mean chert doctor? Run chert --help. (invalid_command)\n'); assert.equal(near.stdout, '');
  assert.equal(chert(['frobnicate']).stderr, 'Unknown command "frobnicate". Run chert --help. (invalid_command)\n');
  const record = JSON.parse(chert(['docter', '--json']).stderr);
  assert.equal(record.code, 'invalid_command'); assert.match(record.action, /Did you mean chert doctor/);
  assert.equal(chert(['--nope']).stderr, 'Run chert --help. (invalid_command)\n');
});

test('reference: COMMANDS.md is the help, rendered; a flag changed in one place fails here', () => {
  const page = readFileSync(new URL('../../../COMMANDS.md', import.meta.url), 'utf8');
  assert.equal(page, commandReference(), 'run node scripts/command-reference.mjs after changing src/cli/help.ts');
  for (const command of commands) { assert.match(page, new RegExp(`^## chert ${command.name}$`, 'm')); for (const [flag] of allFlags(command)) assert.ok(page.includes(`| \`${flag}\` |`), `${command.name} ${flag}`); }
  for (const link of page.matchAll(/\]\(([A-Z_]+\.md)\)/g)) assert.doesNotThrow(() => readFileSync(new URL(`../../../${link[1]}`, import.meta.url)), link[1]);
});
