import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
for (const [name, ...entries] of [['imessage', 'src/index.ts'], ['linq-adapter', 'src/index.ts'], ['sendblue-adapter', 'index.ts'], ['blooio-adapter', 'index.ts'], ['blooio-v4-adapter', 'index.ts'], ['loopmessage-adapter', 'index.ts'], ['missblue-adapter', 'index.ts'], ['texting-blue-adapter', 'index.ts'], ['contiguity-adapter', 'index.ts'], ['bluereacher-adapter', 'index.ts'], ['jared-adapter', 'index.ts'], ['adopt', 'src/main.ts', 'src/cli.ts']]) {
  const directory = resolve(root, 'packages', name);
  const result = await Bun.build({ entrypoints: entries.map(entry => resolve(directory, entry)), outdir: resolve(directory, 'dist'),
    target: 'node', format: 'esm', packages: 'external', sourcemap: 'external' });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${name}`);
  const declaration = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'ES2022',
    '--module', 'ESNext', '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'bun', '--outDir', 'dist', entries[0]],
    { cwd: directory, stdout: 'inherit', stderr: 'inherit' });
  if (await declaration.exited !== 0) throw new Error(`Declaration build failed: ${name}`);
}
