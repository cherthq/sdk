import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PROVIDER_IDS } from './providers';
import { scan } from './scan';
import { apply, human, REPORT, summary, writeReport } from './write';

const USAGE = `Usage: chert-adopt [path] [--from auto|${PROVIDER_IDS.join('|')}] [--write] [--install] [--json] [--allow-dirty]

Detects iMessage provider usage and classifies it against Chert adapter coverage.
Dry run by default. --write rewrites drop-in imports and package.json, adds Chert
env names to .env.example files and writes ${REPORT}. --install also runs the
project's own package manager. No network calls, credentials or telemetry.`;

const LOCKFILES: [string, string[]][] = [['bun.lock', ['bun', 'install']], ['bun.lockb', ['bun', 'install']], ['pnpm-lock.yaml', ['pnpm', 'install']], ['yarn.lock', ['yarn', 'install']], ['package-lock.json', ['npm', 'install']]];

function dirty(root: string): string | null {
  try {
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return status.trim() ? 'the git working tree has uncommitted changes' : null;
  } catch { return 'the path is not inside a git working tree'; }
}

export function main(argv: string[], log = (s: string) => console.log(s), fail = (s: string) => console.error(s)): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      from: { type: 'string', default: 'auto' }, write: { type: 'boolean' }, install: { type: 'boolean' },
      json: { type: 'boolean' }, 'allow-dirty': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (error) { fail(`${(error as Error).message}\n\n${USAGE}`); return 2; }
  const { values, positionals } = parsed;
  if (values.help) { log(USAGE); return 0; }
  const from = values.from!;
  if (positionals.length > 1 || (from !== 'auto' && !PROVIDER_IDS.includes(from)) || (values.install && !values.write)) { fail(USAGE); return 2; }
  const root = resolve(positionals[0] ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) { fail(`chert-adopt: not a directory: ${root}`); return 1; }

  let result = scan(root, from);
  let changed: string[] = [];
  if (values.write) {
    const reason = values['allow-dirty'] ? null : dirty(root);
    if (reason) { fail(`chert-adopt: refusing to write because ${reason}. Commit or stash first, or pass --allow-dirty.`); return 1; }
    changed = apply(result);
    result = scan(root, from);
    if (writeReport(result)) changed.push(REPORT);
    changed.sort();
    if (values.install && changed.some(f => f.endsWith('package.json'))) {
      const command = LOCKFILES.find(([lock]) => existsSync(join(root, lock)))?.[1];
      if (!command) { fail('chert-adopt: no lockfile found; run your package manager install manually.'); return 1; }
      const child = spawnSync(command[0]!, command.slice(1), { cwd: root, stdio: ['ignore', 2, 2] });
      if (child.status !== 0) { fail(`chert-adopt: ${command.join(' ')} failed.`); return 1; }
    }
  }
  if (values.json) {
    log(JSON.stringify({ root, from, mode: values.write ? 'write' : 'dry_run', summary: summary(result.findings), findings: result.findings, changed }, null, 2));
  } else log(human(result, values.write ? 'write' : 'dry run', changed));
  return 0;
}
