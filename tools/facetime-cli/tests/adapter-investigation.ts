// Offline diagnosis only: never loads environment files or starts a worker.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { assertSupportedRuntime, sanitizedFailure } from '../src/adapters/livekit-operation.js';
import { Budget } from '../src/runtime/deadline.js';
assertSupportedRuntime();
const directory = '.local/adapter-livekit';
const hashes = Object.fromEntries(['journal.json', 'adapter.json', 'result.json'].map(name => [name,
  createHash('sha256').update(readFileSync(`${directory}/${name}`)).digest('hex')]));
const journal = JSON.parse(readFileSync(`${directory}/journal.json`, 'utf8'));
const adapters = JSON.parse(readFileSync(`${directory}/adapter.json`, 'utf8'));
const entries = Object.values(journal.entries) as { room: string; job: string; marker: string; create_pending: boolean; cleanup_debt: boolean }[];
assert.equal(entries.length, 1); const entry = entries[0]!;
const original = adapters[entry.marker];
let fetches = 0;
const oldFetch = globalThis.fetch;
const cases: unknown[] = [];
try {
  globalThis.fetch = async () => { fetches++; return new Response(JSON.stringify({ id: 'mock-dispatch', room: 'mock-room', agentName: 'mock-agent' }), { status: 200 }); };
  for (const ms of [3588.123, 3588]) {
    fetches = 0;
    const client = new AgentDispatchClient('https://example.invalid', 'offline-key', 'offline-secret-at-least-32-characters', { failover: false, requestTimeout: ms / 1000 });
    try { await client.createDispatch('mock-room', 'mock-agent'); cases.push({ input_ms: ms, fetch_invocations: fetches, outcome: 'mock_acknowledgment' }); }
    catch (error) { cases.push({ input_ms: ms, fetch_invocations: fetches, outcome: 'rejected', ...sanitizedFailure(error) }); }
  }
} finally { globalThis.fetch = oldFetch; }
let mono = 0, wall = 10000;
const budget = new Budget({ mono: () => mono, wall: () => wall }, { created_at: wall, sent_at: wall, deadline_at: wall + 5000, prepare_deadline_at: wall + 4000, remaining_ms: 5000 });
wall += 411; mono = 410.9; const integer = budget.remaining(true); mono = 411.1; const fractional = budget.remaining(true);
const result = {
  node: process.version, checked_at: new Date().toISOString(), sdk: '2.19.0', network: 'fetch_replaced_no_network', original_sha256: hashes,
  original: { operation: entry.job, room: entry.room, room_sid: original.roomSid, phase: original.phase,
    create_pending: entry.create_pending, cleanup_debt: entry.cleanup_debt, actual_dispatch_id_recorded: !!original.dispatchId,
    actual_job_id_recorded: !!original.actualJob, target_recorded: !!original.target, operation_audit_recorded: !!original.audit,
    exact_sdk_timeout_recorded: false, original_error_class_code_recorded: false, request_send_evidence_recorded: false },
  reproduction: cases, rounded_elapsed_counterexample: { rounded_ms: 411, remaining_ms: [integer, fractional] },
  root_cause_attribution: 'unresolved', original_settlement: 'unknown', new_live_allocations: 0,
};
writeFileSync('docs/ADAPTER_INVESTIGATION_EVIDENCE.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ node: process.version, offline_cases: cases, original_settlement: result.original_settlement, new_live_allocations: 0 }));
