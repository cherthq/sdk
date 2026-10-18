import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
test('typing adapters traverse real Chert route and signed native forwarder', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./control-http.fixture.mjs', import.meta.url))], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) } });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toMatchObject({ status: 'passed', verified: 'actual typing route and HMAC forwarder', native_attempts: 22 });
  } finally { clearTimeout(timer); }
}, 15000);
