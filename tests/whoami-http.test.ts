import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
test('legacy identity uses actual whoami and authentication code', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./whoami-http.fixture.mjs', import.meta.url))], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) } });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toMatchObject({ status: 'passed', verified: 'official SDK and real whoami/auth route over loopback', requests: 4, mocked: ['database'] });
  } finally { clearTimeout(timer); }
}, 15000);
