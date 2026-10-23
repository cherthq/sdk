// Explicit, read-only service audit; never imported by default tests.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { liveKitAPI, marker } from '../src/adapters/livekit.js';
import { assertSupportedRuntime, sanitizedFailure } from '../src/adapters/livekit-operation.js';
import { projectFingerprint } from '../src/adapters/livekit-hook.js';
import type { Entry } from '../src/runtime/journal.js';
assertSupportedRuntime();
const mode = process.argv[2] ?? '';
const correlation = process.argv[3] === '--correlation-review';
const review = correlation || process.argv[3] === '--readiness-review';
const prefix = correlation ? 'CORRELATION_REVIEW' : review ? 'READINESS_REVIEW' : 'QUALIFICATION';
if (process.argv[3] && !review) throw new Error('invalid_audit_arguments');
if (!['preflight', 'final'].includes(mode ?? '')) throw new Error('explicit_audit_mode_required');
const url = process.env.LIVEKIT_URL!, key = process.env.LIVEKIT_API_KEY!, secret = process.env.LIVEKIT_API_SECRET!;
const api = liveKitAPI(url, key, secret);
const old = JSON.parse(readFileSync('.local/adapter-diagnostic-exception-20260925.json', 'utf8'));
const runs: [string, string][] = [['original', resolve('.local/adapter-livekit')], ['diagnostic', old.directory]];
for (const slot of [1, 2]) {
  const path = `.local/adapter-qualification-20260929-${slot}.json`;
  if (existsSync(path)) runs.push([`qualification_${slot}`, JSON.parse(readFileSync(path, 'utf8')).directory]);
}
if (review && existsSync('.local/adapter-readiness-review-20260929.json')) runs.push(['readiness_review', JSON.parse(readFileSync('.local/adapter-readiness-review-20260929.json', 'utf8')).directory]);
if (correlation && existsSync('.local/adapter-correlation-review-20260929.json')) runs.push(['correlation_review', JSON.parse(readFileSync('.local/adapter-correlation-review-20260929.json', 'utf8')).directory]);
const inventories = [];
for (const [label, directory] of runs) {
  if (!existsSync(join(directory, 'journal.json'))) { inventories.push({ label, state: 'no_journal' }); continue; }
  const journal = JSON.parse(readFileSync(join(directory, 'journal.json'), 'utf8'));
  const receipts = JSON.parse(readFileSync(join(directory, 'adapter.json'), 'utf8'));
  for (const entry of Object.values(journal.entries) as Entry[]) {
    const r = receipts[entry.marker];
    let rooms: unknown, dispatches: unknown;
    try { rooms = (await api.rooms([entry.room])).map(room => ({ sid: room.sid, sid_matches: room.sid === r.roomSid, marker_matches: room.metadata === marker(entry) })); }
    catch (error) { rooms = { status: 'unknown', ...sanitizedFailure(error) }; }
    try { dispatches = { count: (await api.dispatches(entry.room)).length }; }
    catch (error) { dispatches = { status: 'unknown', ...sanitizedFailure(error) }; }
    inventories.push({ label, operation: entry.job, room: entry.room, room_sid: r.roomSid, rooms, dispatches,
      phase: r.phase, create_pending: entry.create_pending, cleanup_debt: entry.cleanup_debt,
      audit_decision: label === 'original' ? 'Retain debt: unacknowledged dispatch; original send/settlement evidence missing.' :
        label === 'diagnostic' ? 'Retain debt: historical final hook lacks complete operation/nonce/marker and no durable exact terminal/deletion receipt. Do not fabricate them from room absence.' :
          r.phase === 'clean' && !entry.cleanup_debt ? 'Verified new cleanup; durable exact terminal/deletion evidence present.' : 'Unresolved new run; no further allocations.' });
  }
}
const baseline = JSON.parse(readFileSync(`docs/ADAPTER_${prefix}_BASELINE.json`, 'utf8'));
const unchanged = Object.entries(baseline.historical_sha256 as Record<string, string>).every(([path, hash]) => createHash('sha256').update(readFileSync(path)).digest('hex') === hash);
const demoBaseline = JSON.parse(readFileSync('docs/ADAPTER_DIAGNOSTIC_PREFLIGHT.json', 'utf8'));
const demoUnchanged = Object.entries(demoBaseline.unrelated_demo_files as Record<string, string>).every(([path, hash]) => createHash('sha256').update(readFileSync('/Users/garygao/demo-agent-0/' + path)).digest('hex') === hash);
const workers = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter(c => /^(?:\S*\/)?node\s.*\/scripts\/connector-worker\.mjs(?:\s|$)/.test(c.trim())).length;
const result = { at: new Date().toISOString(), mode, node: process.version, project: projectFingerprint(url), read_only: true,
  inventories, historical_evidence_unchanged: unchanged, unrelated_demo_files_unchanged: demoUnchanged, local_probe_workers: workers };
writeFileSync(`docs/ADAPTER_${prefix}_${mode.toUpperCase()}_INVENTORY.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
