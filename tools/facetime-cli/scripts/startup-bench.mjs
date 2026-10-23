// Median wall time of light commands, in milliseconds. Run after `npm run build`: node scripts/startup-bench.mjs [runs]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = process.env.CHERT_BENCH_MAIN ?? fileURLToPath(new URL('../dist/src/cli/main.js', import.meta.url)), runs = Number(process.argv[2] ?? 20);
const home = mkdtempSync(join(tmpdir(), 'chert-bench-'));
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const time = args => median(Array.from({ length: runs }, () => { const t = performance.now(); spawnSync(process.execPath, args, { env: { ...process.env, CHERT_HOME: home }, stdio: 'ignore' }); return performance.now() - t; }));
try {
  const rows = [['node -e 0', ['-e', '0']], ['chert --version', [main, '--version']], ['chert --help', [main, '--help']], ['chert nonsense', [main, 'nonsense']],
    ['chert whoami --json', [main, 'whoami', '--json']], ['chert logout --json', [main, 'logout', '--json']], ['chert doctor --json', [main, 'doctor', '--json']]];
  for (const [name, args] of rows) console.log(`${name.padEnd(22)} ${time(args).toFixed(0).padStart(4)} ms`);
} finally { rmSync(home, { recursive: true, force: true }); }
