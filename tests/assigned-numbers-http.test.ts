import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('official deprecated Linq phone listing uses actual tenant authentication and assigned line IDs', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./assigned-numbers-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, cases: 32, httpRequests: 29,
      lineReads: 25, writes: 0, deviceRequests: 0, actualAuth: true });
  } finally { clearTimeout(timeout); }
}, 20000);
