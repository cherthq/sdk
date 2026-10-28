import { dirname, relative, resolve } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = resolve(import.meta.dir, '..');
const entriesByPackage = [['control-plane', 'index.ts'], ['media', 'index.ts', 'livekit.ts'], ['imessage', 'src/index.ts'], ['linq-adapter', 'src/index.ts'], ['sendblue-adapter', 'index.ts'], ['blooio-adapter', 'index.ts'], ['blooio-v4-adapter', 'index.ts'], ['loopmessage-adapter', 'index.ts'], ['missblue-adapter', 'index.ts'], ['texting-blue-adapter', 'index.ts'], ['contiguity-adapter', 'index.ts'], ['bluereacher-adapter', 'index.ts'], ['jared-adapter', 'index.ts'], ['adopt', 'src/main.ts', 'src/cli.ts']];
for (const [name, ...entries] of entriesByPackage) {
  const directory = resolve(root, 'packages', name);
  rmSync(resolve(directory, 'dist'), { recursive: true, force: true });
  const result = await Bun.build({ entrypoints: entries.map(entry => resolve(directory, entry)), outdir: resolve(directory, 'dist'),
    target: 'node', format: 'esm', packages: 'external', sourcemap: 'external' });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${name}`);
  const declaration = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'ES2022',
    '--module', 'ESNext', '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'bun', '--outDir', 'dist', ...(name === 'media' ? entries : [entries[0]])],
    { cwd: directory, stdout: 'inherit', stderr: 'inherit' });
  if (await declaration.exited !== 0) throw new Error(`Declaration build failed: ${name}`);
}

// Keep the development workspace entry points, but ship their code together.
// Relative internal imports preserve class identity and need no private packages.
const distribution = resolve(root, 'dist');
rmSync(distribution, { recursive: true, force: true });
const internal = new Map(entriesByPackage.map(([name, entry]) => [
  `@cherthq/${name}`, resolve(distribution, name, entry.split('/').at(-1)!.replace(/\.ts$/, '.js')),
]));
function copyDistribution(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = resolve(source, entry.name), to = resolve(destination, entry.name);
    if (entry.isDirectory()) { copyDistribution(from, to); continue; }
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue;
    const text = readFileSync(from, 'utf8').replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => {
      const target = internal.get(specifier);
      if (target) {
        const path = relative(dirname(to), target);
        return `${prefix}${quote}${path.startsWith('.') ? path : './' + path}${quote}`;
      }
      // Declaration imports must also resolve in NodeNext consumers.
      if (entry.name.endsWith('.d.ts') && specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier))
        return `${prefix}${quote}${specifier}.js${quote}`;
      return match;
    });
    writeFileSync(to, text);
  }
}
for (const [name] of entriesByPackage) {
  copyDistribution(resolve(root, 'packages', name, 'dist'), resolve(distribution, name));
}
rmSync(resolve(root, 'packages/unified/dist'), { recursive: true, force: true });
const unified = await Bun.build({ entrypoints: [resolve(root, 'packages/unified/index.ts'), resolve(root, 'packages/unified/cli.ts')], outdir: resolve(root, 'packages/unified/dist'), target: 'node', format: 'esm', packages: 'external' });
if (!unified.success) throw new AggregateError(unified.logs, 'Unified build failed');
const declarations = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--declaration', '--emitDeclarationOnly', '--strict', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'bun', '--outDir', 'dist', 'index.ts'], { cwd: resolve(root, 'packages/unified'), stdout: 'inherit', stderr: 'inherit' });
if (await declarations.exited !== 0) throw new Error('Unified declarations failed');
copyDistribution(resolve(root, 'packages/unified/dist'), resolve(distribution, 'unified'));
const index = `export * from './imessage/index.js';
export { default } from './imessage/index.js';
export * from './control-plane/index.js';
export * from './unified/index.js';
`;
for (const extension of ['js', 'd.ts']) writeFileSync(resolve(distribution, `index.${extension}`), index);
