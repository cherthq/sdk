import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ConnectorWire } from '../../src/transport/connector-wire.js';
import { rig, TOKEN } from '../fixtures/rig.js';

for (const marker of ['', 'unrelated-ping']) test(`an open socket cannot outlive authority freshness (${marker || 'silent'})`, { timeout: 7000 }, async t => {
  const r = rig(); const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const wire = new ConnectorWire(r.connector);
  t.after(async () => { await wire.close(); for (const s of server.clients) s.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); r.connector.close(); r.agent.close(); });
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ...r.scope, connection_generation: r.scope.connection_generation + 1, v: 1, type: 'connection.welcome', message_id: randomUUID(), role: 'standby' }));
    if (marker) { const timer = setInterval(() => socket.ping(marker), 200); socket.once('close', () => clearInterval(timer)); }
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await wire.connect(`http://127.0.0.1:${address.port}`, TOKEN);
  const start = performance.now(); let closed = false; wire.events.once('closed', () => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(closed, true, 'stale authority must disconnect even while TCP is open');
  assert.ok(performance.now() - start < 6500);
});

test('only verified authority heartbeats sustain a connection and loss expires it', { timeout: 14000 }, async t => {
  const r = rig(); const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  const wire = new ConnectorWire(r.connector); let heartbeat: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(heartbeat); await wire.close(); for (const s of server.clients) s.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); r.connector.close(); r.agent.close(); });
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ...r.scope, connection_generation: r.scope.connection_generation + 1, v: 1, type: 'connection.welcome', message_id: randomUUID(), role: 'standby' }));
    heartbeat = setInterval(() => socket.ping('chert-authority-v1'), 200);
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); await wire.connect(`http://127.0.0.1:${address.port}`, TOKEN);
  let closed = false; wire.events.once('closed', () => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 5500)); assert.equal(closed, false);
  clearInterval(heartbeat); await new Promise(resolve => setTimeout(resolve, 5500)); assert.equal(closed, true);
});
