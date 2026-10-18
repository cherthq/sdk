import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('actual direct and existing-chat typing routes bind sender, target and native acknowledgement', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./direct-typing-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({ passed: true, cases: 59, deviceRequests: 30,
      deviceAttempts: 31, dbWrites: 0, liveTypingChanges: 0, actualAuth: true, redirectSinkPosts: 0 });
  } finally { clearTimeout(timeout); }
}, 20000);
