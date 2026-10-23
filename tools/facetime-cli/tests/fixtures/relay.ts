import { createServer, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { Fault, MAX_FRAME, decisionSchema, digest, key, parseFrame, sameOwner, sameScope, safeCode, type Code, type Decision, type Frame, type Incoming, type Scope } from '../../src/protocol/v1.js';
import { Budget, type Scheduler } from '../../src/runtime/deadline.js';
import type { ControlPlane } from './control-plane.js';
import { bearer, body, closeServer, INTERNAL, listen, reply, verify } from './http.js';
interface Completed { incoming: Incoming; budget: Budget; fingerprint: string; stop: () => void }
interface Connection { socket: WebSocket; scope: Scope; token: string; completed: Map<string, Completed> }
function decisionFingerprint(decision: Decision): string {
  const { message_id: _delivery, ...semantic } = decisionSchema.parse(decision);
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}
interface Pending { incoming: Incoming; budget: Budget; connection: Connection; res: ServerResponse; stop: () => void }
export class Relay {
  readonly events = new EventEmitter();
  readonly diagnostics: Code[] = [];
  readonly server = createServer((req, res) => { void this.http(req, res); });
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  private connections = new Map<string, Connection>();
  private pending = new Map<string, Set<Pending>>();
  origin = '';
  dropReceipts = false;
  dropLifecycle = false;
  dropAcks = false;
  constructor(readonly authority: ControlPlane, readonly clock: Scheduler) {
    this.server.on('upgrade', (req, socket, head) => {
      try {
        if (req.url !== '/connect') throw new Fault('forbidden');
        const token = bearer(req); const scope = authority.connect(token);
        this.wss.handleUpgrade(req, socket, head, ws => {
          const connection: Connection = { socket: ws, scope, token, completed: new Map() };
          const old = this.connections.get(scope.binding_id); old?.socket.close(1000, 'replaced');
          this.connections.set(scope.binding_id, connection);
          ws.on('error', () => { this.diagnostics.push('invalid_frame'); });
          ws.on('message', (bytes, binary) => {
            try {
              if (binary) throw new Fault('invalid_frame');
              const frame = parseFrame(bytes.toString());
              if (!('call_id' in frame) || !sameScope(scope, frame, frame.type === 'call.decision')) throw new Fault('forbidden');
              authority.authenticate(token, frame, frame.type === 'call.decision');
              if (frame.type === 'call.decision') {
                const completed = connection.completed.get(key(frame));
                const fingerprint = decisionFingerprint(frame);
                if (completed) {
                  if (!sameOwner(completed.incoming, frame)) throw new Fault('forbidden');
                  completed.budget.assert();
                  if (completed.fingerprint !== fingerprint) throw new Fault('request_conflict');
                  // Transport replay only: never commit, resend credentials or renew the budget.
                  return;
                }
                const requests = [...(this.pending.get(key(frame)) ?? [])];
                if (!requests.length) throw new Fault('forbidden');
                // Validate the entire fan-out before completing any HTTP request.
                for (const pending of requests) {
                  if (pending.connection !== connection || !sameOwner(pending.incoming, frame)) throw new Fault('forbidden');
                  pending.budget.assert();
                }
                const earliest = requests.reduce((a, b) => a.budget.remaining() <= b.budget.remaining() ? a : b);
                const record: Completed = { incoming: earliest.incoming, budget: earliest.budget, fingerprint, stop: () => undefined };
                const requestKey = key(frame);
                record.stop = clock.schedule(record.budget.remaining(), () => connection.completed.delete(requestKey));
                connection.completed.set(requestKey, record);
                for (const pending of requests) this.finish(pending, frame);
              } else if (frame.type === 'lifecycle.ack' || frame.type === 'cancel.ack') {
                if (!this.dropAcks) authority.acknowledge(token, frame);
                this.events.emit('ack', frame);
              } else throw new Fault('invalid_frame');
            } catch (error) { this.diagnostics.push(safeCode(error)); ws.close(1008, safeCode(error)); }
          });
          ws.on('close', () => {
            for (const completed of connection.completed.values()) completed.stop();
            connection.completed.clear();
            if (this.connections.get(scope.binding_id) === connection) this.connections.delete(scope.binding_id);
            for (const requests of this.pending.values()) for (const pending of [...requests]) if (pending.connection === connection) this.finish(pending, { code: 'relay_unavailable' }, 503);
            this.events.emit('closed');
          });
          ws.send(JSON.stringify({ ...scope, v: 1, type: 'connection.welcome', message_id: randomUUID(), role: authority.role(scope) }));
          const heartbeat = setInterval(() => {
            try { authority.authenticate(token, scope, false, true); ws.ping('chert-authority-v1'); }
            catch { ws.close(1008, 'authority_unavailable'); }
          }, 1000);
          heartbeat.unref(); ws.once('close', () => clearInterval(heartbeat));
          this.events.emit('connected', scope);
        });
      } catch { socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); }
    });
  }
  async start(): Promise<void> { this.origin = await listen(this.server); }
  private finish(pending: Pending, value: unknown, status = 200): void {
    pending.stop(); const set = this.pending.get(key(pending.incoming)); set?.delete(pending);
    if (!set?.size) this.pending.delete(key(pending.incoming));
    reply(pending.res, value, status);
  }
  private async http(req: import('node:http').IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (bearer(req) !== INTERNAL) throw new Fault('forbidden');
      const bytes = await body(req); verify(bytes, req.headers['x-signature']);
      const frame = parseFrame(bytes);
      if (req.method !== 'POST') throw new Fault('invalid_frame');
      if (req.url === '/event') { this.deliver(frame); reply(res, { ok: true }); return; }
      if (req.url !== '/incoming' || frame.type !== 'call.incoming') throw new Fault('invalid_frame');
      this.authority.verifyIncoming(frame);
      const connection = this.connections.get(frame.binding_id);
      if (!connection || !sameScope(connection.scope, frame)) throw new Fault('relay_unavailable');
      this.authority.authenticate(connection.token, frame);
      const budget = new Budget(this.clock, frame); budget.assert();
      const completed = connection.completed.get(key(frame));
      if (completed) {
        if (!sameOwner(completed.incoming, frame)) throw new Fault('forbidden');
        if (digest(completed.incoming) !== digest(frame)) throw new Fault('request_conflict');
        completed.budget.assert();
        // The transient response is gone. A late HTTP retry must reconcile.
        reply(res, { code: 'acceptance_uncertain' }, 409); return;
      }
      const requests = this.pending.get(key(frame)) ?? new Set<Pending>();
      if ([...requests].some(p => digest(p.incoming) !== digest(frame))) throw new Fault('request_conflict');
      const pending: Pending = { incoming: frame, budget, connection, res, stop: () => undefined };
      pending.stop = this.clock.schedule(budget.remaining(), () => { this.finish(pending, { code: 'deadline_exceeded' }, 408); this.cancelPending(pending); });
      requests.add(pending); this.pending.set(key(frame), requests);
      res.on('close', () => {
        if (!res.writableEnded && requests.has(pending)) { this.finish(pending, { code: 'transport_failure' }, 499); this.cancelPending(pending); }
      });
      connection.socket.send(JSON.stringify(frame)); this.events.emit('incoming', frame);
    } catch (error) { const code = safeCode(error); this.diagnostics.push(code); reply(res, { code }, code === 'forbidden' || code === 'invalid_signature' ? 403 : 400); }
  }
  private cancelPending(pending: Pending): void {
    // The authority, not the relay, versions and records this terminal cancellation.
    try { this.deliver(this.authority.cancel(pending.connection.token, pending.incoming)); }
    catch { this.diagnostics.push('acceptance_uncertain'); }
  }
  deliver(frame: Frame): void {
    if (frame.type === 'decision.committed' && this.dropReceipts) return;
    if (frame.type === 'call.lifecycle' && this.dropLifecycle) return;
    if (!['decision.committed', 'call.lifecycle', 'call.cancel'].includes(frame.type)) throw new Fault('invalid_frame');
    const connection = this.connections.get(frame.binding_id);
    if (!connection || !sameScope(connection.scope, frame, false)) throw new Fault('relay_unavailable');
    this.authority.authenticate(connection.token, frame, false);
    connection.socket.send(JSON.stringify(frame));
  }
  replay(token: string, cursor: number): void { for (const event of this.authority.replay(token, cursor)) this.deliver(event); }
  closeSockets(): void { for (const connection of this.connections.values()) connection.socket.terminate(); }
  async close(): Promise<void> { this.closeSockets(); await new Promise<void>(resolve => this.wss.close(() => resolve())); await closeServer(this.server); }
}
