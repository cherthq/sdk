import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
for (const [name, entry] of [['sdk', 'src/index.ts'], ['linq-adapter', 'src/index.ts'], ['sendblue-adapter', 'index.ts'], ['blooio-adapter', 'index.ts'], ['blooio-v4-adapter', 'index.ts'], ['loopmessage-adapter', 'index.ts']]) {
  const directory = resolve(root, 'packages', name);
  const result = await Bun.build({ entrypoints: [resolve(directory, entry)], outdir: resolve(directory, 'dist'),
    target: 'node', format: 'esm', packages: 'external', sourcemap: 'external' });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${name}`);
  const declaration = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'ES2022',
    '--module', 'ESNext', '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'bun', '--outDir', 'dist', entry],
    { cwd: directory, stdout: 'inherit', stderr: 'inherit' });
  if (await declaration.exited !== 0) throw new Error(`Declaration build failed: ${name}`);
}
