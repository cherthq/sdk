import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('official SDK adapters traverse HTTP and actual Chert route handlers', async () => {
  // Subprocess keeps the database/auth/device mocks out of other SDK tests.
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./route-http.fixture.mjs', import.meta.url))], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CHERT_M4D_LIVE_CONFIG: '', NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) } });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toMatchObject({ verified: 'actual imported Chert routes over loopback HTTP', status: 'passed' });
  } finally { clearTimeout(timeout); }
}, 20000);
