import { createServer } from 'node:net';
import { chmodSync } from 'node:fs';
// Event-loop liveness only. No provider/config credentials or admin methods.
const server = createServer(socket => {
  socket.setTimeout(1000, () => socket.destroy());
  socket.on('error', () => undefined);
  socket.end('{"ok":true}\n');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen('/state/chert-pilot/ipc/node.sock', resolve);
});
chmodSync('/state/chert-pilot/ipc/node.sock', 0o600);
try {
  await import('../node_modules/chert-local-transport-proof/dist/src/cli/main.js');
} finally {
  server.close();
}
