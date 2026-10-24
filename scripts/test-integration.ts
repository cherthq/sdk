import { resolve } from 'node:path';

// Public SDK tests only: no service credentials or external source checkout.
if (process.argv.length !== 2) {
  console.error('This command accepts no arguments; it runs local SDK contract tests only.');
  process.exit(1);
}
const child = Bun.spawn([process.execPath, '--no-env-file', 'scripts/test-unit.ts'], {
  cwd: resolve(import.meta.dir, '..'),
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'test' },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await child.exited);
