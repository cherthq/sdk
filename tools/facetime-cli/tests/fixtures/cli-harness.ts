import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { AgentDispatch, Room, ParticipantInfo, JobRestartPolicy, TokenVerifier, TrackType } from 'livekit-server-sdk';
import { mac, projectFingerprint, type HookSnapshot } from '../../src/adapters/livekit-hook.js';
import { parseFrame, ownerOf, type Incoming, type Owner } from '../../src/protocol/v1.js';
import { systemClock } from '../../src/runtime/deadline.js';
import { ControlPlane } from './control-plane.js';
import { Relay } from './relay.js';
import { body, listen, closeServer, post, INTERNAL, reply, bearer } from './http.js';
import { baseScope, TOKEN, RECOVERY } from './rig.js';
export const SECRETS = { LIVEKIT_API_KEY: 'SYNTHETIC_LIVEKIT_KEY', LIVEKIT_API_SECRET: 'SYNTHETIC_LIVEKIT_SECRET_at_least_32_characters',
  CHERT_HOOK_SECRET: 'SYNTHETIC_HOOK_SECRET_at_least_32_characters', CHERT_CONNECTOR_TOKEN: TOKEN, CHERT_RECOVERY_TOKEN: RECOVERY };
export async function until(predicate: () => boolean, timeout = 10000): Promise<void> {
  const end = performance.now() + timeout;
  while (!predicate()) { if (performance.now() > end) throw new Error('fixture_wait_timeout'); await pause(10); }
}
export function cli(executable: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string, processTimeout = 25000) {
  const child = spawn(process.execPath, [executable, ...args], { cwd, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; let exited = false;
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', code => { exited = true; resolve(code); }); });
  const timer = setTimeout(() => child.kill('SIGKILL'), processTimeout); void exit.finally(() => clearTimeout(timer));
  return { child, exit, get stdout() { return stdout; }, get stderr() { return stderr; },
    async waitCode(code: string) { await until(() => stdout.includes(`"code":"${code}"`) || exited); assert.ok(stdout.includes(`"code":"${code}"`), stdout + stderr); },
    async waitConnected() { await until(() => stdout.includes('"phase":"connected"') || exited); assert.ok(stdout.includes('"phase":"connected"'), stdout + stderr); },
    async stop() { if (!exited) child.kill('SIGTERM'); return exit; },
  };
}
export async function cliHarness(mode: 'create-room' | 'byor' = 'create-room') {
  const scope = mode === 'byor' ? { ...baseScope, session_mode: 'byor' as const } : baseScope;
  const directory = mkdtempSync(join(tmpdir(), 'chert-cli-test-'));
  const authority = new ControlPlane(systemClock);
  authority.enroll(TOKEN, scope); authority.enroll(RECOVERY, scope, true); authority.activate(TOKEN, 0);
  const relay = new Relay(authority, systemClock); await relay.start();
  const h: HookSnapshot = { project: projectFingerprint('wss://cli-fixture.invalid'), name: 'fixture-agent', deployment: 'fixture', boot: 'fixture-boot',
    worker: 'fixture-worker', sequence: 0, observed_at: Date.now(), challenge: '', connected: true, draining: false, capacity: 1, session: null };
  const rooms = new Map<string, Room>(); let dispatch: AgentDispatch | undefined; let participants: ParticipantInfo[] = [];
  const effects = { created: 0, deleted: 0, explicitDispatch: 0, cancelled: 0, management: 0, health: 0 };
  let badSignature = false, stale = false, recoveryFailure = false, malformedManagement = false, redirectManagement = false;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  const server = createServer((req, res) => {
    void (async () => {
      assert.equal(req.method, 'POST');
      const raw = (await body(req)).toString();
      if (req.url === '/reconcile') {
        if (recoveryFailure) { reply(res, { code: 'unavailable' }, 503); return; }
        const result = await authority.reconcile(bearer(req), JSON.parse(raw) as Owner); reply(res, result); return;
      }
      if (['/health', '/cancel', '/drain'].includes(req.url ?? '')) {
        assert.equal(req.headers['x-chert-mac'], mac(SECRETS.CHERT_HOOK_SECRET, req.url!, raw));
        const request = JSON.parse(raw) as { challenge: string; payload: { operation?: string } };
        if (req.url === '/health') effects.health++;
        else if (req.url === '/cancel') {
          effects.cancelled++; h.cancelled_operation = request.payload.operation;
          if (h.session) { h.session.cancelled = true; h.session.status = 'ended'; }
        } else throw new Error('CLI must not drain the agent');
        h.sequence++; h.challenge = request.challenge; h.observed_at = Date.now() - (stale ? 5000 : 0);
        const response = JSON.stringify(h);
        res.writeHead(200, { 'x-chert-mac': badSignature ? '0'.repeat(64) : mac(SECRETS.CHERT_HOOK_SECRET, 'response', response) }); res.end(response); return;
      }
      effects.management++;
      if (malformedManagement) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('SECRET_FROM_SDK_BODY_SENTINEL'); return; }
      if (redirectManagement) { res.writeHead(307, { location: 'https://must-never-contact.invalid/' }); res.end(); return; }
      await new TokenVerifier(SECRETS.LIVEKIT_API_KEY, SECRETS.LIVEKIT_API_SECRET).verify(bearer(req));
      const request = JSON.parse(raw) as { name: string; metadata: string; names?: string[]; room: string; dispatchId?: string; agents?: { agentName: string; deployment: string; metadata: string; restartPolicy: string }[] };
      const method = req.url?.split('/').at(-1);
      if (method === 'ListRooms') { reply(res, { rooms: [...rooms.values()].filter(r => !request.names?.length || request.names.includes(r.name)).map(r => r.toJson()) }); return; }
      if (method === 'CreateRoom') {
        effects.created++;
        if (hold) await hold;
        assert.equal(request.agents?.length, 1); const agent = request.agents![0]!;
        assert.equal(agent.restartPolicy, 'JRP_NEVER');
        const signed = JSON.parse(agent.metadata) as { spec: string; signature: string };
        assert.equal(signed.signature, mac(SECRETS.CHERT_HOOK_SECRET, 'dispatch', signed.spec));
        const spec = JSON.parse(signed.spec) as { operation: string; marker: string; nonce: string; participant: string; room: string };
        const room = new Room({ name: request.name, metadata: request.metadata, sid: 'RM_fixture' }); rooms.set(room.name, room);
        h.session = { operation: spec.operation, room: spec.room, marker: spec.marker, nonce: spec.nonce, participant: spec.participant, job: 'AJ_fixture', dispatch: 'AD_fixture', worker: h.worker, status: 'ready', cancelled: false, track: 'TR_fixture' };
        dispatch = new AgentDispatch({ id: 'AD_fixture', room: room.name, agentName: agent.agentName, deployment: agent.deployment,
          metadata: agent.metadata, restartPolicy: JobRestartPolicy.JRP_NEVER,
          state: { jobs: [{ id: 'AJ_fixture', dispatchId: 'AD_fixture', state: { status: 1, participantIdentity: spec.participant, workerId: h.worker } }] } });
        participants = [new ParticipantInfo({ identity: spec.participant, attributes: { 'chert.job': 'AJ_fixture', 'chert.nonce': spec.nonce },
          tracks: [{ sid: 'TR_fixture', type: TrackType.AUDIO }] })];
        reply(res, room.toJson()); return;
      }
      if (method === 'ListDispatch') { reply(res, { agentDispatches: dispatch ? [dispatch.toJson()] : [] }); return; }
      if (method === 'ListParticipants') { reply(res, { participants: participants.map(p => p.toJson()) }); return; }
      if (method === 'DeleteDispatch') { assert.equal(request.dispatchId, dispatch?.id); assert.equal(request.room, dispatch?.room); dispatch = undefined; reply(res, {}); return; }
      if (method === 'DeleteRoom') { assert.ok(rooms.has(request.room)); rooms.delete(request.room); participants = []; effects.deleted++; reply(res, {}); return; }
      if (method === 'CreateDispatch') effects.explicitDispatch++;
      throw new Error('Unexpected management method');
    })().catch(() => reply(res, { code: 'fixture_failure' }, 500));
  });
  const origin = await listen(server);
  const devPath = join(directory, 'development.json');
  writeFileSync(devPath, JSON.stringify({ mode: 'loopback-v1', relay_origin: relay.origin, reconcile_origin: origin, livekit_api_origin: origin,
    scope, credential_env: 'CHERT_CONNECTOR_TOKEN', recovery_env: 'CHERT_RECOVERY_TOKEN' }));
  const configPath = join(directory, 'config.json'); const statePath = join(directory, 'state');
  const initArgs = ['init', '--config', configPath, '--non-interactive', '--json', '--agent-name', h.name, '--deployment', h.deployment, '--boot', h.boot,
    '--livekit-url', 'wss://cli-fixture.invalid', '--hook-origin', origin, '--state-dir', statePath, '--development', devPath];
  const children: ChildProcess[] = [];
  return { directory, devPath, authority, relay, h, rooms, effects, origin, initArgs, configPath, statePath,
    set malformedManagement(value: boolean) { malformedManagement = value; }, set redirectManagement(value: boolean) { redirectManagement = value; },
    get recoveryFailure() { return recoveryFailure; }, set recoveryFailure(value: boolean) { recoveryFailure = value; },
    set badSignature(value: boolean) { badSignature = value; }, set stale(value: boolean) { stale = value; },
    holdCreate() { hold = new Promise<void>(resolve => { release = resolve; }); }, releaseCreate() { release?.(); hold = undefined; },
    launch(executable: string, command = 'run', cwd?: string) { const p = cli(executable, [command, '--config', configPath, '--json'], SECRETS, cwd); children.push(p.child); return p; },
    snapshot() { return JSON.parse(readFileSync(join(statePath, 'journal.json'), 'utf8')) as { entries: Record<string, { state: string; cleanup_debt: boolean; reconcile_debt: boolean; create_pending: boolean; terminal: boolean }> }; },
    async incoming(request: Incoming = authority.register(TOKEN)) {
      const response = await post(`${relay.origin}/incoming`, request, INTERNAL); assert.equal(response.status, 200);
      const decision = parseFrame(await response.text()); assert.equal(decision.type, 'call.decision');
      if (decision.type !== 'call.decision') throw new Error('decision_expected');
      return { request, decision };
    },
    async call() {
      const { request, decision } = await this.incoming(); assert.equal(decision.action, 'accept', JSON.stringify(decision.action === 'decline' ? decision.reason : ''));
      const receipt = await authority.commit(TOKEN, decision); relay.deliver(receipt);
      return ownerOf(request);
    },
    async terminal(owner: Owner) {
      const event = authority.lifecycle(TOKEN, owner, 'ended'); relay.deliver(event);
      await until(() => !rooms.size && Object.values(this.snapshot().entries).every(e => !e.cleanup_debt && !e.reconcile_debt && e.terminal));
    },
    async close() { release?.(); for (const p of children) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); await relay.close(); await closeServer(server); rmSync(directory, { recursive: true, force: true }); },
  };
}
