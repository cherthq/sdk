import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('package: the two starters ship inside the npm package, without their lockfiles, secrets or node_modules', { timeout: 60000 }, async () => {
  const child = spawn('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, env: { PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: tmpdir(),
    npm_config_userconfig: '/dev/null', npm_config_cache: join(tmpdir(), 'chert-cli-npm-cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(exit, 0, stderr);
  const paths = (JSON.parse(stdout) as { files: { path: string }[] }[])[0]!.files.map(file => file.path);
  for (const starter of ['student-agent', 'video-agent']) for (const name of ['agent.mjs', 'greet.mjs', '.env.example', 'package.json', 'README.md', 'AGENTS.md', 'CLAUDE.md'])
    assert.ok(paths.includes(`examples/${starter}/${name}`), `examples/${starter}/${name} in ${paths.filter(p => p.startsWith('examples/')).join(', ')}`);
  assert.ok(paths.includes('examples/video-agent/face.mjs'));
  for (const path of paths.filter(p => p.startsWith('examples/'))) assert.doesNotMatch(path, /node_modules|\.env\.local|package-lock\.json/, path);
});
