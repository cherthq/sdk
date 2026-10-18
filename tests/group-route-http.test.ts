import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('actual group HTTP routes preserve acceptance, durable IDs and missing receipt evidence', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./group-route-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CHERT_M4D_LIVE_CONFIG: '',
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ passed: true, deviceDispatches: 4, liveMessages: 0, loopbackRequests: 8 });
    expect(report.cases).toEqual(['guid-only acceptance', 'no-guid acceptance', 'explicit initial failure',
      'unassigned sender rejected', 'event persistence failure forbids retry', 'recorded status preserves queued']);
  } finally { clearTimeout(timeout); }
}, 20000);
