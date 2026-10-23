import { appendFileSync, closeSync, fsyncSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Connector } from '../../src/runtime/connector.js';
import { FileJournal } from '../../src/runtime/journal.js';
import { Availability } from '../../src/runtime/availability.js';
import { systemClock, type Scheduler } from '../../src/runtime/deadline.js';
import { Fault, ownerSchema, parseFrame, receiptSchema, safeCode, type Frame, type Incoming, type Owner } from '../../src/protocol/v1.js';
import { FakeAgent } from './agent.js';
import { ControlPlane, type Reconciliation } from './control-plane.js';
import { Relay } from './relay.js';
import { ConnectorWire } from './connector-wire.js';
import { bearer, body, closeServer, INTERNAL, listen, post, reply, verify } from './http.js';
import { baseScope, HEALTH, healthy, RECOVERY, TOKEN } from './rig.js';

export function waitEvent<T>(events: EventEmitter, name: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { events.off(name, handler); reject(new Error(`event_timeout_${name}`)); }, 3000);
    const handler = (value: T) => { if (predicate(value)) { clearTimeout(timer); events.off(name, handler); resolve(value); } };
    events.on(name, handler);
  });
}
export interface Sample { request_ms: number; preparation_ms: number; response_ms: number; commit_ms: number; total_ms: number }
export async function network(clock: Scheduler = systemClock) {
  const directory = mkdtempSync(join(tmpdir(), 'chert-proof-'));
  const ledger = openSync(join(directory, 'commits.jsonl'), 'a', 0o600);
  const authority = new ControlPlane(clock);
  authority.persistReceipt = receipt => { appendFileSync(ledger, JSON.stringify(receipt) + '\n'); fsyncSync(ledger); };
  authority.enroll(TOKEN, baseScope); authority.enroll(RECOVERY, baseScope, true); authority.activate(TOKEN, 0);
  const relay = new Relay(authority, clock); await relay.start();
  const journal = new FileJournal(join(directory, 'journal.json'), baseScope);
  const availability = new Availability(clock, HEALTH, { project: 'livekit_fake', name: 'agent', deployment: 'local' });
  const agent = new FakeAgent(clock);
  const connector = new Connector(baseScope, journal, agent, availability, clock);
  const wire = new ConnectorWire(connector);
  const healthContext = { availability, clock, sequence: 0 };
  healthy(healthContext);
  const stages = new Map<string, { arrived: number; prepareStarted?: number; decisionSent?: number }>();
  const samples: Sample[] = [];
  const originalPrepare = agent.prepare.bind(agent);
  agent.prepare = async (...args) => {
    const stage = stages.get(args[0].owner.request_id);
    if (stage) stage.prepareStarted = performance.now();
    return originalPrepare(...args);
  };
  wire.events.on('decision', (decision: { request_id: string }) => {
    const stage = stages.get(decision.request_id); if (stage) stage.decisionSent = performance.now();
  });
  const api = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST') throw new Fault('invalid_frame');
      const token = bearer(req);
      if (req.url === '/reconcile') {
        // Scope credential is checked before parsing or returning call data.
        authority.authenticate(token, undefined, false, true);
        const owner = ownerSchema.safeParse(JSON.parse((await body(req)).toString()));
        if (!owner.success) throw new Fault('invalid_frame');
        reply(res, await authority.reconcile(token, owner.data)); return;
      }
      if (token !== INTERNAL) throw new Fault('forbidden');
      const bytes = await body(req); verify(bytes, req.headers['x-signature']);
      if (req.url !== '/call' || req.method !== 'POST' || bytes.toString() !== '{}') throw new Fault('invalid_frame');
      healthy(healthContext);
      const started = performance.now();
      const incoming = authority.register(TOKEN);
      stages.set(incoming.request_id, { arrived: started });
      const abort = new AbortController();
      res.once('close', () => { if (!res.writableEnded) abort.abort(); });
      const result = await post(`${relay.origin}/incoming`, incoming, INTERNAL, abort.signal);
      if (!result.ok) throw new Fault('transport_failure');
      const decision = parseFrame(await result.text());
      if (decision.type !== 'call.decision') throw new Fault('invalid_frame');
      const commitStarted = performance.now();
      const receipt = await authority.commit(TOKEN, decision);
      const committed = performance.now();
      await post(`${relay.origin}/event`, receipt, INTERNAL);
      const stage = stages.get(incoming.request_id)!;
      samples.push({ request_ms: (stage.prepareStarted ?? started) - started, preparation_ms: (stage.decisionSent ?? commitStarted) - (stage.prepareStarted ?? started),
        response_ms: commitStarted - (stage.decisionSent ?? commitStarted), commit_ms: committed - commitStarted, total_ms: committed - started });
      stages.delete(incoming.request_id);
      reply(res, { action: receipt.action, owner: ownerSchema.parse(Object.fromEntries(Object.keys(ownerSchema.shape).map(k => [k, incoming[k as keyof Incoming]]))) });
    })().catch(error => reply(res, { code: safeCode(error) }, 400));
  });
  const origin = await listen(api);
  await wire.connect(relay.origin, TOKEN);
  async function reconcile(owner: Owner): Promise<Reconciliation> {
    const response = await post(`${origin}/reconcile`, owner, RECOVERY);
    if (!response.ok) return { status: 'forbidden' };
    const schema = z.union([
      z.strictObject({ status: z.enum(['unknown', 'forbidden', 'not_found']) }),
      z.strictObject({ status: z.literal('known'), receipt: receiptSchema, terminal: z.boolean() }),
    ]);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Fault('invalid_frame');
    return parsed.data;
  }
  return {
    directory, authority, relay, journal, connector, agent, wire, origin, samples, reconcile,
    async call() {
      const response = await post(`${origin}/call`, {}, INTERNAL);
      if (!response.ok) throw new Fault('transport_failure');
      const parsed = z.strictObject({ action: z.enum(['accept', 'decline']), owner: ownerSchema }).parse(await response.json());
      return parsed;
    },
    async end(owner: Owner) {
      const ack = waitEvent(relay.events, 'ack');
      await post(`${relay.origin}/event`, authority.lifecycle(RECOVERY, owner, 'ended'), INTERNAL);
      await ack; await connector.flushCleanup();
    },
    async reconnect() { await wire.connect(relay.origin, TOKEN); await connector.reconcile(reconcile); relay.replay(TOKEN, journal.snapshot().cursor); },
    async close() { connector.close(); await wire.close(); await relay.close(); await closeServer(api); agent.close(); journal.close(); closeSync(ledger); rmSync(directory, { recursive: true, force: true }); },
    frame(type: Frame['type']) { return waitEvent<Frame>(wire.events, 'frame', f => f.type === type); },
  };
}
