// Explicit real-service test harness. Never imported by the default test suite.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { fork, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, readFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import { Connector } from '../src/runtime/connector.js';
import { FileJournal } from '../src/runtime/journal.js';
import { Availability } from '../src/runtime/availability.js';
import { systemClock } from '../src/runtime/deadline.js';
import { AuthenticatedHook, projectFingerprint, type HookSnapshot } from '../src/adapters/livekit-hook.js';
import { AdapterReceipts } from '../src/adapters/livekit-receipts.js';
import { assertSupportedRuntime, sanitizedFailure } from '../src/adapters/livekit-operation.js';
import { LiveKitAdapter, liveKitAPI, validateReady, marker } from '../src/adapters/livekit.js';
import { ControlPlane } from './fixtures/control-plane.js';
import { Relay } from './fixtures/relay.js';
import { ConnectorWire } from './fixtures/connector-wire.js';
import { baseScope, TOKEN, RECOVERY } from './fixtures/rig.js';
import { INTERNAL, post } from './fixtures/http.js';
import { parseFrame, safeCode, type Incoming, type Frame } from '../src/protocol/v1.js';

import { reserveRun, reserveQualification, reserveReadinessReview, reserveCorrelationReview, evidenceHashes, onceDispatch } from './fixtures/diagnostic-run.js';

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), pause(5000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(resolve => child.once('exit', () => resolve())); }
}
async function run() {
  if (process.argv[2] !== '--real' || !process.argv[3]) throw new Error('explicit_invocation_required');
  assertSupportedRuntime();
  const demo = resolve(process.argv[3]);
  const url = process.env.LIVEKIT_URL, key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) throw new Error('missing_credentials');
  if (process.argv.length > 5 || (process.argv[4] && !['--diagnostic-exception-20260925', '--qualification-20260929-1', '--qualification-20260929-2', '--readiness-review-20260929', '--correlation-review-20260929'].includes(process.argv[4]))) throw new Error('invalid_test_arguments');
  const runningWorkers = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n')
    .filter(command => /^(?:\S*\/)?node\s.*\/scripts\/connector-worker\.mjs(?:\s|$)/.test(command.trim()));
  if (runningWorkers.length) throw new Error('prior_local_probe_worker_running');
  const { directory, runId, instance, originalHashes } = process.argv[4] === '--correlation-review-20260929'
    ? reserveCorrelationReview(resolve('.local'))
    : process.argv[4] === '--readiness-review-20260929'
    ? reserveReadinessReview(resolve('.local'))
    : process.argv[4]?.startsWith('--qualification-20260929-')
    ? reserveQualification(resolve('.local'), process.argv[4].endsWith('-1') ? 1 : 2)
    : reserveRun(resolve('.local'), process.argv[4] === '--diagnostic-exception-20260925');
  const resultPath = join(directory, 'result.json');
  const hookSecret = randomBytes(32).toString('hex');
  const scope = { ...baseScope, instance_id: instance, binding_id: randomUUID() };
  const config = { url, project: projectFingerprint(url), name: `chert-connector-test-${runId}`, deployment: `chert-test-${runId}`, boot: runId, hookSecret };
  const management = new RoomServiceClient(url, key, secret, { failover: false, requestTimeout: 2 });
  const initialRooms: Awaited<ReturnType<typeof management.listRooms>> = [];
  const result: Record<string, unknown> = { node: process.version, sdk: '2.19.0', agents: '1.8.0', rtc: '0.13.35',
    started_at: new Date().toISOString(), run_id: runId, instance_id: instance, worker_name: config.name, deployment: config.deployment, boot: config.boot, project: config.project, prior_local_probe_workers: runningWorkers.length, original_status: 'unresolved', original_sha256: originalHashes, redispatch: false, status: 'running', provider_sessions: 0, before_room_count: initialRooms.length,
    room_creates: 0, dispatch_creates: 0, deleted_rooms: 0, stage: 'worker_start' };
  const save = () => writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); save();
  let child: ChildProcess | undefined, connector: Connector | undefined, journal: FileJournal | undefined, relay: Relay | undefined, wire: ConnectorWire | undefined;
  let call: Incoming | undefined, adapter: LiveKitAdapter | undefined;
  const authority = new ControlPlane(systemClock);
  const api = liveKitAPI(url, key, secret); // Runtime/config validation precedes network effects.
  let healthHook: AuthenticatedHook | undefined;
  let lastHealth: HookSnapshot | undefined;
  let lastDispatches: Awaited<ReturnType<typeof api.dispatches>> = [];
  let lastParticipants: Awaited<ReturnType<typeof api.participants>> = [];
  const event = (type: Frame['type']) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { wire?.events.off('frame', listener); reject(new Error('event_delivery_timeout')); }, 1000);
    const listener = (frame: Frame) => { if (frame.type === type) { clearTimeout(timer); wire?.events.off('frame', listener); resolve(); } };
    wire!.events.on('frame', listener);
  });
  authority.persistReceipt = receipt => {
    const fd = openSync(join(directory, 'acceptance.json'), 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ committed_at: new Date().toISOString(), receipt }, null, 2) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  };
  try {
    if (originalHashes) {
      const oldJournal = JSON.parse(readFileSync(resolve('.local/adapter-livekit/journal.json'), 'utf8'));
      const oldEntry = Object.values(oldJournal.entries)[0] as { room: string; job: string; cleanup_debt: boolean; create_pending: boolean };
      const rooms = await api.rooms([oldEntry.room]);
      let dispatchInventory: unknown;
      try { dispatchInventory = { count: (await api.dispatches(oldEntry.room)).length }; }
      catch (error) { dispatchInventory = { status: 'unknown', ...sanitizedFailure(error) }; }
      result.original_inventory = { at: new Date().toISOString(), operation: oldEntry.job, room: oldEntry.room,
        rooms: rooms.length, dispatch: dispatchInventory, cleanup_debt: oldEntry.cleanup_debt, create_pending: oldEntry.create_pending, settlement: 'unknown' };
    }
    initialRooms.push(...await management.listRooms()); result.before_room_count = initialRooms.length; save();
    child = fork(join(demo, 'scripts/connector-worker.mjs'), [], { cwd: demo, execPath: process.execPath, execArgv: [],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret,
        LIVEKIT_AGENT_DEPLOYMENT: config.deployment, CHERT_PROBE_SECRET: hookSecret, CHERT_PROBE_BOOT: runId, CHERT_PROBE_NAME: config.name },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker_start_timeout')), 10000);
      child!.once('message', message => {
        clearTimeout(timer); const ready = message as { origin: string; runtime: string };
        result.worker_runtime = ready.runtime;
        if (ready.runtime !== process.version) { reject(new Error('worker_runtime_mismatch')); return; }
        resolve(ready.origin);
      });
      child!.once('exit', () => { clearTimeout(timer); reject(new Error('worker_exit')); });
    });
    // Only the four identity fields are used by the verifier.
    healthHook = new AuthenticatedHook(origin, hookSecret, { project: config.project, name: config.name, deployment: config.deployment, boot: config.boot });
    const hookCall = healthHook.call.bind(healthHook);
    healthHook.call = async (...args) => { const h = await hookCall(...args); lastHealth = h; return h; };
    const availability = new Availability(systemClock, hookSecret, { project: config.project, name: config.name, deployment: config.deployment });
    const started = performance.now();
    while (true) {
      await healthHook.refresh(availability, hookSecret);
      if (availability.check() === 'available') break;
      if (performance.now() - started > 15000) throw new Error('worker_availability_timeout');
      await pause(100);
    }
    result.worker_start_ms = Math.round(performance.now() - started); result.stage = 'idle'; save();
    for (let i = 0; i < 3; i++) {
      await healthHook.refresh(availability, hookSecret); assert.equal(availability.check(), 'available'); await pause(250);
    }
    const idleRooms = await management.listRooms();
    result.idle_new_rooms = idleRooms.filter(r => !initialRooms.some(before => before.sid === r.sid)).length;
    result.idle_jobs = (await healthHook.call('/health')).session === null ? 0 : 1;
    assert.equal(result.idle_new_rooms, 0); assert.equal(result.idle_jobs, 0);
    // AuthenticatedHook binds exactly the selected instance; create no worker from runtime.
    const create = api.create, remove = api.removeRoom;
    api.create = onceDispatch(async (...args) => { result.room_creates = Number(result.room_creates) + 1; save(); const t = performance.now(); const r = await create(...args); result.room_create_ms = Math.round(performance.now() - t); result.room_triggered_dispatches = 1; return r; });
    api.dispatch = async () => { throw new Error('explicit_dispatch_forbidden_for_room_topology'); };
    api.removeRoom = async room => { await remove(room); result.deleted_rooms = Number(result.deleted_rooms) + 1; };
    const listDispatches = api.dispatches, listParticipants = api.participants, token = api.token;
    api.dispatches = async room => { lastDispatches = await listDispatches(room); return lastDispatches; };
    api.participants = async room => { lastParticipants = await listParticipants(room); return lastParticipants; };
    api.token = async entry => {
      assert.equal(lastDispatches.length, 1); assert.ok(lastHealth);
      assert.equal(validateReady(entry, lastDispatches[0]!, lastHealth, lastParticipants), true);
      result.readiness = { at: new Date().toISOString(), operation: entry.job, room: entry.room,
        dispatch: lastDispatches[0]!.id, job: lastHealth.session!.job, worker: lastHealth.worker,
        participant: entry.participant, track: lastHealth.session!.track, nonce_matches: true, nested_job_room_omitted: lastDispatches[0]!.state!.jobs[0]!.room === undefined,
        exact_ready_predicate: true, sole_unmuted_audio: true, decoded_audio: false };
      save(); return token(entry);
    };
    authority.enroll(TOKEN, scope); authority.enroll(RECOVERY, scope, true); authority.activate(TOKEN, 0);
    relay = new Relay(authority, systemClock); await relay.start();
    journal = new FileJournal(join(directory, 'journal.json'), scope);
    const receipts = new AdapterReceipts(join(directory, 'adapter.json'));
    adapter = new LiveKitAdapter(api, healthHook, receipts, config);
    connector = new Connector(scope, journal, adapter, availability, systemClock);
    wire = new ConnectorWire(connector); await wire.connect(relay.origin, TOKEN);
    await healthHook.refresh(availability, hookSecret);
    call = authority.register(TOKEN); result.stage = 'dispatch'; save();
    const prepare = performance.now();
    result.deadlines = { created_at: call.created_at, prepare_deadline_at: call.prepare_deadline_at,
      decision_deadline_at: call.deadline_at, resource_expires_at: call.resource_expires_at };
    const a = await post(`${relay.origin}/incoming`, call, INTERNAL);
    const first = parseFrame(await a.text());
    assert.equal(first.type, 'call.decision');
    if (first.type !== 'call.decision') throw new Error('wrong_frame');
    result.readiness_checks = adapter.lastReadiness ?? null;
    result.decision = first.action; result.preparation_ms = Math.round(performance.now() - prepare);
    result.stage = 'readiness'; save();
    if (first.action === 'decline') { result.decline_reason = first.reason; throw new Error('live_preparation_declined'); }
    assert.equal(result.dispatch_creates, 0); assert.equal(result.room_triggered_dispatches, 1);
    // Commit immediately within the original five-second decision budget.
    const acceptance = await authority.commit(TOKEN, first);
    result.accepted_at = new Date().toISOString(); result.acceptance_version = acceptance.call_version;
    const delivered = event('decision.committed');
    await post(`${relay.origin}/event`, acceptance, INTERNAL); await delivered;
    assert.equal(journal.get(call)!.state, 'accepted');
    result.acceptance_delivered = true; result.authority_commits = authority.commitCount;
    const entry = journal.get(call)!; const receipt = receipts.get(entry)!;
    result.actual_job_correlated = !!receipt.actualJob && receipt.actualJob !== entry.job;
    result.room_sid = receipt.roomSid;
    const grants = await new TokenVerifier(key, secret).verify(first.participant_token);
    assert.equal(first.livekit_url, url); assert.equal(grants.sub, `bridge_${call.request_id}`);
    assert.equal(grants.video?.room, entry.room); assert.equal(grants.video?.roomJoin, true);
    assert.equal(grants.video?.canPublish, true); assert.equal(grants.video?.canSubscribe, true);
    assert.equal(grants.video?.canPublishData, false);
    assert.equal(first.remote_participant_identity, entry.participant);
    result.bridge = { signature_verified: true, call_scoped_room: true, call_scoped_identity: true, publication_and_subscription: true, token_logged: false, bridge_connected: false };
    await healthHook.refresh(availability, hookSecret); assert.equal(availability.check(), 'agent_capacity_exhausted'); result.full_health_verified = true;
    assert.equal(await adapter.inspect(entry), 'owned');
    const terminal = authority.lifecycle(RECOVERY, call, 'ended');
    const terminalDelivered = event('call.lifecycle');
    await post(`${relay.origin}/event`, terminal, INTERNAL); await terminalDelivered;
    for (let i = 0; i < 20 && !authority.acks.has(terminal.event_id); i++) await pause(25);
    assert.ok(authority.acks.has(terminal.event_id));
    result.terminal = { event: terminal.event_id, version: terminal.call_version, delivered: true, acknowledged: true };
    const cleanup = performance.now();
    for (let i = 0; i < 5 && connector.debt(); i++) { await pause(100); await connector.flushCleanup(); }
    result.cleanup_ms = Math.round(performance.now() - cleanup);
    assert.equal(connector.debt(), 0);
    const ended = await healthHook.call('/health');
    assert.equal(ended.session?.status, 'ended'); assert.equal(ended.session?.job, receipt.actualJob);
    result.job_ended = { job: ended.session.job, worker: ended.session.worker, status: ended.session.status, at: new Date().toISOString() };
    const drained = await healthHook.call('/drain'); assert.equal(drained.draining, true); result.draining_health_verified = true;
    result.stage = 'done'; result.status = 'passed';
  } catch (error) {
    result.failed_at = new Date().toISOString();
    result.readiness_checks = adapter?.lastReadiness ?? null;
    result.failure_observation = { hook: lastHealth ? { worker: lastHealth.worker, connected: lastHealth.connected,
      job: lastHealth.session?.job, status: lastHealth.session?.status, track: lastHealth.session?.track } : null,
      dispatches: lastDispatches.map(d => ({ id: d.id, room: d.room, name: d.agentName,
        jobs: d.state?.jobs.map(j => ({ id: j.id, dispatch: j.dispatchId, worker: j.state?.workerId, status: j.state?.status, participant: j.state?.participantIdentity })) })),
      participants: lastParticipants.map(p => ({ identity: p.identity, tracks: p.tracks.map(t => ({ sid: t.sid, type: t.type, muted: t.muted })) })) };
    result.status = 'failed'; result.error = safeCode(error); result.failure = sanitizedFailure(error);
    // Never print raw SDK errors, tokens, room metadata or customer URLs.
  } finally {
    result.stage_before_cleanup = result.stage;
    if (connector && call && journal?.get(call)) {
      const terminal = authority.lifecycle(RECOVERY, call, 'ended'); connector.lifecycle(terminal);
      await connector.flushCleanup().catch(() => {});
      result.cleanup_debt = connector.debt();
      const adapterReceipt = new AdapterReceipts(join(directory, 'adapter.json')).get(journal.get(call)!);
      result.adapter_phase = adapterReceipt?.phase;
      result.operation = { logical: journal.get(call)!.job, room: journal.get(call)!.room, room_sid: adapterReceipt?.roomSid,
        dispatch: adapterReceipt?.dispatchId, actual_job: adapterReceipt?.actualJob };
      if (healthHook) {
        try {
          const h = await healthHook.call('/health');
          result.final_hook = { connected: h.connected, worker: h.worker, draining: h.draining,
            session: h.session ? { job: h.session.job, worker: h.session.worker, status: h.session.status, cancelled: h.session.cancelled } : null };
        } catch (error) { result.final_hook_error = sanitizedFailure(error); }
      }
      result.operation_audit = adapterReceipt?.audit ?? [];
      result.cleanup_evidence = adapterReceipt?.cleanup ?? [];
      result.topology = adapterReceipt?.topology;
    }
    connector?.close(); await wire?.close(); await relay?.close();
    if (child) await stopWorker(child);
    result.worker_stopped = !!child && (child.exitCode !== null || child.signalCode !== null);
    result.worker_exit = child ? { code: child.exitCode, signal: child.signalCode } : null;
    try {
      const after = await management.listRooms();
      const entries = journal ? Object.values(journal.snapshot().entries) : [];
      result.final_global_list_owned_room_count = after.filter(room => entries.some(e => e.room === room.name)).length;
      const owned = entries.length ? await management.listRooms(entries.map(e => e.room)) : [];
      result.final_owned_rooms = owned.length;
      const retained = new AdapterReceipts(join(directory, 'adapter.json'));
      result.final_scoped_room_observations = owned.map(room => {
        const entry = entries.find(e => e.room === room.name);
        return { sid: room.sid, sid_matches: !!entry && room.sid === retained.get(entry)?.roomSid, marker_matches: !!entry && room.metadata === marker(entry) };
      });
      result.unrelated_rooms_unchanged = initialRooms.every(before => after.some(r => r.sid === before.sid && r.metadata === before.metadata));
      result.baseline_unrelated_rooms = initialRooms.length;
    } catch { result.final_owned_rooms = 'unknown'; result.status = 'failed'; }
    if (result.cleanup_debt !== undefined && result.cleanup_debt !== 0 || result.final_owned_rooms !== 0) result.status = 'failed';
    if (originalHashes) {
      result.original_sha256_after = evidenceHashes(resolve('.local/adapter-livekit'));
      result.original_evidence_unchanged = JSON.stringify(result.original_sha256_after) === JSON.stringify(originalHashes);
      if (!result.original_evidence_unchanged) result.status = 'failed';
    }
    journal?.close(); result.finished_at = new Date().toISOString(); save();
    console.log(readFileSync(resultPath, 'utf8'));
  }
  if (result.status !== 'passed' || result.cleanup_debt !== 0 || result.final_owned_rooms !== 0) process.exitCode = 1;
}
await run().catch(() => { console.error('adapter_test_blocked; inspect sanitized result and retained local receipts'); process.exitCode = 1; });
