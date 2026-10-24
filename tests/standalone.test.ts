import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('local contract command rejects arguments instead of forwarding them', () => {
  for (const argument of ['--live', '--check', '/external/checkout']) {
    const result = Bun.spawnSync([process.execPath, '--no-env-file', 'scripts/test-integration.ts', argument], {
      cwd: resolve(import.meta.dir, '..'),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain('local SDK contract tests only');
  }
});
