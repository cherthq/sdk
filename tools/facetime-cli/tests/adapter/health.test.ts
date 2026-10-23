import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AuthenticatedHook, mac } from '../../src/adapters/livekit-hook.js';
import { Availability } from '../../src/runtime/availability.js';
import { systemClock } from '../../src/runtime/deadline.js';
const secret = 'test-health-secret';
const expected = { project: 'test', name: 'test', deployment: 'test', boot: 'test' };
for (const problem of ['none', 'signature', 'challenge', 'boot', 'project', 'name', 'deployment', 'stale', 'replay'] as const) {
  test(`authenticated hook rejects ${problem} and invalidates prior health`, async () => {
    let sequence = 0, bad = false;
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      assert.equal(req.headers['x-chert-mac'], mac(secret, '/health', raw));
      const request = JSON.parse(raw);
      const h = { ...expected, worker: 'worker', sequence: ++sequence, observed_at: Date.now(), challenge: request.challenge,
        connected: true, draining: false, capacity: 1, session: null };
      if (bad && ['boot', 'project', 'name', 'deployment', 'challenge'].includes(problem)) Object.assign(h, { [problem]: 'wrong' });
      if (bad && problem === 'stale') h.observed_at -= 5000;
      if (bad && problem === 'replay') h.sequence = 1;
      const body = JSON.stringify(h);
      res.writeHead(200, { 'x-chert-mac': bad && problem === 'signature' ? '0'.repeat(64) : mac(secret, 'response', body) }); res.end(body);
    });
    server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const hook = new AuthenticatedHook(`http://127.0.0.1:${address.port}`, secret, expected);
      const availability = new Availability(systemClock, 'internal-credential', expected);
      await hook.refresh(availability, 'internal-credential'); assert.equal(availability.check(), 'available');
      bad = true; await hook.refresh(availability, 'internal-credential');
      assert.equal(availability.check(), problem === 'none' ? 'available' : 'agent_availability_unknown');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
test('authenticated cancellation metadata does not invalidate subsequent availability samples', async () => {
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    const response = JSON.stringify({ ...expected, worker: 'worker', sequence: 1, observed_at: Date.now(), challenge: request.challenge,
      connected: true, draining: false, capacity: 1, session: null, cancelled_operation: 'previous-operation' });
    res.writeHead(200, { 'x-chert-mac': mac(secret, 'response', response) }); res.end(response);
  });
  server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const hook = new AuthenticatedHook(`http://127.0.0.1:${address.port}`, secret, expected);
    const availability = new Availability(systemClock, 'internal-credential', expected);
    await hook.refresh(availability, 'internal-credential'); assert.equal(availability.check(), 'available');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
