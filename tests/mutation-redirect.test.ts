import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('mutation transports refuse 307 re-POSTs and plaintext email uncertainty is nonretryable', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./mutation-redirect.fixture.mjs', import.meta.url))], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, initialPosts: 4, sinkPosts: 0, liveMessages: 0 });
  } finally { clearTimeout(timer); }
}, 15000);
