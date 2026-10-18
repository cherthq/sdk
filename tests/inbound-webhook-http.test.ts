import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('real HMAC inbound HTTP dispatch delivers only owned plaintext and preserves retries', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./inbound-webhook-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, cases: 46, callbacks: 9, liveMessages: 0,
      dispatchErrors: 9, verificationWarnings: 1 });
  } finally { clearTimeout(timeout); }
}, 20000);
