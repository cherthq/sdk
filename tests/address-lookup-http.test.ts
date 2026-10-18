import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('actual address lookup authenticates tenants, signs raw bytes and rejects unowned lines', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./address-lookup-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, cases: 30, deviceCalls: 14,
      liveProbes: 0, actualAuth: true, redirectLeaks: 0 });
  } finally { clearTimeout(timeout); }
}, 20000);
