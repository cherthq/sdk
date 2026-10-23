// Read-only, exact-room inventory. Does not open or mutate either journal.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';
import { assertSupportedRuntime, sanitizedFailure } from '../src/adapters/livekit-operation.js';
import { projectFingerprint } from '../src/adapters/livekit-hook.js';
import { marker } from '../src/adapters/livekit.js';
import type { Entry } from '../src/runtime/journal.js';
assertSupportedRuntime();
const latch = JSON.parse(readFileSync('.local/adapter-diagnostic-exception-20260925.json', 'utf8'));
const preflight = JSON.parse(readFileSync('docs/ADAPTER_DIAGNOSTIC_PREFLIGHT.json', 'utf8'));
const sdk = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { failover: false, requestTimeout: 2 });
const dispatch = new AgentDispatchClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { failover: false, requestTimeout: 2 });
const inventories: unknown[] = [];
for (const [label, directory] of [['original', '.local/adapter-livekit'], ['diagnostic', latch.directory]] as const) {
  const journal = JSON.parse(readFileSync(`${directory}/journal.json`, 'utf8'));
  const receipts = JSON.parse(readFileSync(`${directory}/adapter.json`, 'utf8'));
  for (const entry of Object.values(journal.entries) as Entry[]) {
    const receipt = receipts[entry.marker];
    const rooms = await sdk.listRooms([entry.room]);
    let dispatches: unknown;
    try { dispatches = (await dispatch.listDispatch(entry.room)).map(d => ({ id: d.id, name: d.agentName, room: d.room, jobs: d.state?.jobs.map(j => ({ id: j.id, status: j.state?.status, worker: j.state?.workerId })) })); }
    catch (error) { dispatches = { state: 'unknown', ...sanitizedFailure(error), status: error && typeof error === 'object' && 'status' in error ? error.status : undefined }; }
    inventories.push({ label, operation: entry.job, room: entry.room, acknowledged_sid: receipt.roomSid,
      observed_rooms: rooms.map(r => ({ sid: r.sid, sid_matches: r.sid === receipt.roomSid, marker_matches: r.metadata === marker(entry), participants: r.numParticipants })),
      dispatches, phase: receipt.phase, cleanup_debt: entry.cleanup_debt, create_pending: entry.create_pending });
  }
}
const hashes = Object.fromEntries(Object.keys(preflight.original_sha256).map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
const unchanged = Object.entries(hashes).every(([p, hash]) => preflight.original_sha256[p] === hash);
const workers = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter(c => /^(?:\S*\/)?node\s.*\/scripts\/connector-worker\.mjs(?:\s|$)/.test(c.trim())).length;
const output = { at: new Date().toISOString(), runtime: process.version, project: projectFingerprint(process.env.LIVEKIT_URL!), read_only: true,
  inventories, prior_evidence_unchanged: unchanged, original_sha256: hashes, local_probe_workers: workers,
  unrelated_demo_files_unchanged: Object.entries(preflight.unrelated_demo_files as Record<string, string>).every(([p, hash]) => createHash('sha256').update(readFileSync('/Users/garygao/demo-agent-0/' + p)).digest('hex') === hash) };
writeFileSync('docs/ADAPTER_DIAGNOSTIC_FINAL_INVENTORY.json', JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(output, null, 2));
