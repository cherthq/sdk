import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { reconciliationClient } from '../../src/transport/reconcile.js';
import { loopbackFetchPolicy } from '../../src/cli/network-policy.js';
import { listen, closeServer, reply } from '../fixtures/http.js';
import { rig } from '../fixtures/rig.js';
for (const mode of ['malformed', 'oversized', 'forbidden', 'unavailable', 'redirect'] as const) {
  test(`reconciliation ${mode} never settles uncertainty or follows redirects`, async () => {
    const server = createServer((_req, res) => {
      if (mode === 'malformed') { res.end('SECRET_SENTINEL'); return; }
      if (mode === 'oversized') { res.end(' '.repeat(40000)); return; }
      if (mode === 'redirect') { res.writeHead(307, { location: 'https://must-never-contact.invalid' }); res.end(); return; }
      reply(res, { status: 'unknown' }, mode === 'forbidden' ? 403 : 503);
    });
    const origin = await listen(server);
    try {
      const read = reconciliationClient(origin, 'SYNTHETIC_SECRET');
      assert.deepEqual(await read(rig().request()), { status: mode === 'forbidden' ? 'forbidden' : 'unknown' });
    } finally { await closeServer(server); }
  });
}
test('development process fetch policy rejects non-loopback network before invoking fetch', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  const restore = loopbackFetchPolicy(['http://127.0.0.1:1234']);
  try {
    await assert.rejects(fetch('https://external.invalid'), /forbidden/); assert.equal(calls, 0);
    await fetch('http://127.0.0.1:1234/health'); assert.equal(calls, 1);
  } finally { restore(); globalThis.fetch = original; }
});
