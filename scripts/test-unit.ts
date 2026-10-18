import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
function tests(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist' ? tests(resolve(dir, e.name)) : e.isFile() && e.name.endsWith('.test.ts') && !e.name.includes('postgrest') ? [resolve(dir, e.name)] : []); }
const files = [...tests(resolve(root, 'packages')), ...['client.test.ts', 'strict-core.test.ts', 'standalone.test.ts'].map(f => resolve(root, 'tests', f))];
const child = Bun.spawn([process.execPath, '--no-env-file', 'test', ...files], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);
