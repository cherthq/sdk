import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('actual mark-read HTTP handler checks ownership and HMAC-signed native acknowledgement', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./mark-read-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, deviceRequests: 33, deviceAttempts: 34,
      liveReadChanges: 0, cases: 38 });
  } finally { clearTimeout(timeout); }
}, 20000);
