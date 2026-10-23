import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { Fault, MAX_FRAME, parseFrame, safeCode, type Code } from '../protocol/v1.js';
import type { Scope, Incoming, Decision, Receipt, Lifecycle, Cancel, Ack } from '../protocol/v1.js';
export interface CallTransportHandler {
  scope: Scope;
  disconnect(): void;
  reconnect(scope: Scope, role: 'active' | 'standby' | 'draining'): void;
  incoming(frame: Incoming): Promise<Decision>;
  committed(frame: Receipt): void;
  lifecycle(frame: Lifecycle): Ack;
  cancel(frame: Cancel): Ack;
}
import { loopbackOrigin, hostedOrigin } from './http.js';
export class ConnectorWire {
  socket?: WebSocket;
  readonly events = new EventEmitter();
  readonly diagnostics: Code[] = [];
  constructor(readonly connector: CallTransportHandler) {}
  async connect(origin: string, token: string, hosted = false): Promise<void> {
    const url = hosted ? hostedOrigin(origin) : loopbackOrigin(origin); url.protocol = hosted ? 'wss:' : 'ws:'; url.pathname = '/connect';
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 2000, maxPayload: MAX_FRAME, followRedirects: false, perMessageDeflate: false });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let welcomed = false;
      let freshness: ReturnType<typeof setTimeout> | undefined;
      const renewFreshness = () => {
        clearTimeout(freshness);
        freshness = setTimeout(() => {
          this.diagnostics.push('transport_failure');
          socket.terminate();
        }, 5000);
        freshness.unref();
      };
      const timer = setTimeout(() => { socket.terminate(); reject(new Fault('transport_failure')); }, 2000);
      socket.once('close', () => { clearTimeout(timer); clearTimeout(freshness); });
      // Only an authenticated authority-poll heartbeat proves relay freshness.
      // TCP liveness, unrelated pings and business frames cannot extend it.
      socket.on('ping', bytes => {
        if (welcomed && this.socket === socket && bytes.toString() === 'chert-authority-v1') renewFreshness();
      });
      socket.on('error', () => { this.diagnostics.push('transport_failure'); reject(new Fault('transport_failure')); });
      socket.on('close', () => { if (this.socket === socket) this.connector.disconnect(); this.events.emit('closed'); reject(new Fault('transport_failure')); });
      socket.on('message', (bytes, binary) => {
        void (async () => {
          if (this.socket !== socket) return;
          if (binary) throw new Fault('invalid_frame');
          const frame = parseFrame(bytes.toString());
          if (!welcomed && frame.type !== 'connection.welcome') throw new Fault('forbidden');
          if (frame.type === 'connection.welcome') {
            if (welcomed || frame.connection_generation <= this.connector.scope.connection_generation) throw new Fault('stale_generation');
            this.connector.reconnect(frame, frame.role); welcomed = true; clearTimeout(timer); renewFreshness(); resolve();
          }
          else if (frame.type === 'call.incoming') {
            const decision = await this.connector.incoming(frame);
            if (this.socket === socket && socket.readyState === WebSocket.OPEN && decision.connection_generation === this.connector.scope.connection_generation) socket.send(JSON.stringify(decision));
            this.events.emit('decision', decision);
          } else if (frame.type === 'decision.committed') this.connector.committed(frame);
          else if (frame.type === 'call.lifecycle') socket.send(JSON.stringify(this.connector.lifecycle(frame)));
          else if (frame.type === 'call.cancel') socket.send(JSON.stringify(this.connector.cancel(frame)));
          else throw new Fault('invalid_frame');
          this.events.emit('frame', frame);
        })().catch(error => { this.diagnostics.push(safeCode(error)); socket.close(1008, safeCode(error)); });
      });
    });
  }
  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.terminate(); });
  }
}
