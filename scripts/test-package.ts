import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const temporary = mkdtempSync(join(tmpdir(), 'chert-sdk-package-'));
async function run(args: string[], cwd = temporary) {
  const child = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' });
  assert.equal(await child.exited, 0, args.join(' '));
}
try {
  const archive = process.env.CHERT_PACKAGE_ARCHIVE ?? join(temporary, 'sdk.tgz');
  if (!process.env.CHERT_PACKAGE_ARCHIVE) await run(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', archive], root);
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies: { '@trychert/sdk': `file:${archive}` },
    devDependencies: { '@types/bun': '1.3.14' },
  }));
  await run(['bun', 'install', '--ignore-scripts']);
  const installed = join(temporary, 'node_modules/@trychert/sdk');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@trychert/sdk');
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.ok(!existsSync(join(temporary, 'node_modules/@cherthq')));
  assert.ok(!existsSync(join(installed, 'dist/onboarding')));
  for (const version of Object.values(manifest.dependencies)) assert.ok(!String(version).includes('workspace:'));
  assert.ok(!existsSync(join(installed, 'packages')));
  assert.ok(!existsSync(join(installed, '.env')));
  for (const target of Object.values(manifest.exports)) {
    for (const path of typeof target === 'string' ? [target] : Object.values(target as Record<string, string>))
      assert.ok(existsSync(join(installed, path)), `Missing export ${path}`);
  }
  const subpaths = Object.keys(manifest.exports).filter(path => path !== './package.json');
  const portable = subpaths;
  const specifier = (path: string) => '@trychert/sdk' + (path === '.' ? '' : path.slice(1));
  writeFileSync(join(temporary, 'exports.mjs'), `
import assert from 'node:assert/strict';
import Client, { ChertClient, ChertAPIError, ChertControlPlane, ChertSDK } from '@trychert/sdk';
import { ChertClient as SubpathClient } from '@trychert/sdk/imessage';
assert.equal(Client, ChertClient);
assert.equal(Client, SubpathClient);
assert.equal(typeof ChertAPIError, 'function');
assert.equal(typeof ChertControlPlane, 'function');
const sdk = new ChertSDK({ projectId: 'fixture-project', imessage: {baseURL: 'https://message.example', apiKey: 'fixture'}, facetime: {baseUrl: 'https://facetime.example', token: 'fixture'} });
assert.ok(sdk.imessage instanceof ChertClient);
assert.ok(sdk.facetime instanceof ChertControlPlane);
for (const name of ${JSON.stringify(portable.map(specifier))}) assert.ok(Object.keys(await import(name)).length, name);
console.log('All portable unified exports loaded without workspace packages.');
`);
  // Reuse the existing behavioral distribution contract against the installed archive.
  writeFileSync(join(temporary, 'distribution.mjs'), readFileSync(join(root, 'tests/distribution-smoke.mjs'), 'utf8').replaceAll('@cherthq/', '@trychert/sdk/'));
  for (const runtime of [['node'], ['bun'], ['deno', 'run', '--no-config', '--node-modules-dir=manual', '--allow-env', '--allow-read']]) {
    await run([...runtime, 'exports.mjs']);
    await run([...runtime, 'distribution.mjs']);
  }
  for (const runtime of ['node', 'bun']) {
    for (const bin of Object.values(manifest.bin)) await run([runtime, join(installed, String(bin)), '--help']);
    for (const channel of ['imessage', 'facetime', 'adopt']) await run([runtime, join(installed, manifest.bin['chert-sdk']), channel, '--help']);
  }
  // Resolve every shipped declaration using both supported TS resolution modes.
  writeFileSync(join(temporary, 'consumer.ts'), subpaths.map((path, i) => `import * as api${i} from '${specifier(path)}';\nvoid api${i};`).join('\n'));
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'bundler']]) {
    await run(['bun', 'x', '--no-install', 'tsc', '--noEmit', '--strict', '--target', 'ES2022', '--module', module, '--moduleResolution', resolution, '--types', 'bun', 'consumer.ts']);
  }
  console.log('Isolated archive installation, exports, behavior, CLI and declaration checks passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
