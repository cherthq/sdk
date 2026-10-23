// Test-only authorization bookkeeping. Never imported by the connector runtime.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function evidenceHashes(root: string): Record<string, string> {
  return Object.fromEntries(['journal.json', 'adapter.json', 'result.json'].map(name => [name,
    createHash('sha256').update(readFileSync(join(root, name))).digest('hex')]));
}
export function reserveRun(root: string, exception: boolean) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const original = join(root, 'adapter-livekit');
  if (!exception) {
    if (existsSync(original) && readdirSync(original).length) throw new Error('prior_test_receipt_present');
    mkdirSync(original, { recursive: true, mode: 0o700 });
    return { directory: original, runId: randomUUID(), instance: randomUUID(), originalHashes: undefined };
  }
  const originalHashes = evidenceHashes(original);
  const runId = randomUUID(), instance = randomUUID();
  const directory = join(root, `adapter-diagnostic-${runId}`);
  // One owner-authorized exception, consumed before any network/worker effects.
  // A failed or interrupted run cannot silently consume another authorization.
  const fd = openSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ authorized: 'Owner explicitly permits one isolated diagnostic test despite unresolved original dispatch',
      recorded_at: new Date().toISOString(), runId, instance, directory, original, originalHashes,
      original_status: 'unresolved', original_debt: 'preserved', original_identity: 'retired from test reuse; worker name was not recorded',
      limit: { application_dispatches: 1, redispatch: false }, production_admission_override: false }, null, 2) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  mkdirSync(directory, { mode: 0o700 });
  return { directory, runId, instance, originalHashes };
}
export function onceDispatch<T extends unknown[], R>(invoke: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
  let consumed = false;
  return (...args) => {
    if (consumed) throw new Error('diagnostic_dispatch_already_attempted');
    consumed = true; return invoke(...args);
  };
}

// This owner-authorized qualification is separate from the consumed September 25
// exception. Each slot is consumed durably before any worker/network effects.
export function reserveQualification(root: string, slot: 1 | 2) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const originalHashes = evidenceHashes(join(root, 'adapter-livekit'));
  const old = JSON.parse(readFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'utf8')) as { directory: string };
  const diagnosticHashes = evidenceHashes(old.directory);
  if (slot === 2) {
    const first = JSON.parse(readFileSync(join(root, 'adapter-qualification-20260929-1.json'), 'utf8')) as { directory: string };
    const result = JSON.parse(readFileSync(join(first.directory, 'result.json'), 'utf8'));
    if (result.status !== 'passed' || result.cleanup_debt !== 0 || result.final_owned_rooms !== 0 ||
        !result.acceptance_delivered || result.authority_commits !== 1 || !result.bridge?.signature_verified ||
        !result.terminal?.acknowledged || !result.worker_stopped) throw new Error('first_qualification_not_clean');
  }
  const runId = randomUUID(), instance = randomUUID(), directory = join(root, `adapter-qualification-${runId}`);
  const fd = openSync(join(root, `adapter-qualification-20260929-${slot}.json`), 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ authorized: 'September 29 owner-authorized provider-free qualification', slot, runId, instance, directory,
      at: new Date().toISOString(), originalHashes, diagnosticHashes, retiredDiagnostic: old.directory,
      historical_debts: 'quarantined; unchanged', production_admission_override: false,
      limit: { room_triggered_dispatches: 1, explicit_dispatches: 0, redispatch: false } }, null, 2) + '\n'); fsyncSync(fd);
  } finally { closeSync(fd); }
  const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  mkdirSync(directory, { mode: 0o700 });
  return { directory, runId, instance, originalHashes };
}

// Fresh owner review after qualification 1 failed. Does not unlock qualification 2.
export function reserveReadinessReview(root: string) {
  const old = JSON.parse(readFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'utf8')) as { directory: string };
  const prior = JSON.parse(readFileSync(join(root, 'adapter-qualification-20260929-1.json'), 'utf8')) as { directory: string };
  const previous = JSON.parse(readFileSync(join(prior.directory, 'result.json'), 'utf8'));
  if (previous.cleanup_debt !== 0 || previous.adapter_phase !== 'clean' || !previous.worker_stopped) throw new Error('prior_qualification_cleanup_incomplete');
  const originalHashes = evidenceHashes(join(root, 'adapter-livekit'));
  const historicalHashes = { original: originalHashes, diagnostic: evidenceHashes(old.directory), qualification: evidenceHashes(prior.directory) };
  const runId = randomUUID(), instance = randomUUID(), directory = join(root, `adapter-readiness-review-${runId}`);
  const fd = openSync(join(root, 'adapter-readiness-review-20260929.json'), 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ authorized: 'Owner asks to try again after reviewing qualification failure; one new isolated provider-free attempt',
      at: new Date().toISOString(), runId, instance, directory, historicalHashes, previousRun: prior.directory,
      historical_debts: 'unchanged and unresolved', production_admission_override: false,
      limit: { room_triggered_dispatches: 1, explicit_dispatches: 0, redispatch: false } }, null, 2) + '\n'); fsyncSync(fd);
  } finally { closeSync(fd); }
  const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  mkdirSync(directory, { mode: 0o700 });
  return { directory, runId, instance, originalHashes };
}

// Separate one-use authorization after the room-correlation fix.
export function reserveCorrelationReview(root: string) {
  const old = JSON.parse(readFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'utf8')) as { directory: string };
  const prior = JSON.parse(readFileSync(join(root, 'adapter-readiness-review-20260929.json'), 'utf8')) as { directory: string };
  const previous = JSON.parse(readFileSync(join(prior.directory, 'result.json'), 'utf8'));
  if (previous.cleanup_debt !== 0 || previous.adapter_phase !== 'clean' || !previous.worker_stopped) throw new Error('prior_qualification_cleanup_incomplete');
  const originalHashes = evidenceHashes(join(root, 'adapter-livekit'));
  const historicalHashes = { original: originalHashes, diagnostic: evidenceHashes(old.directory), readinessReview: evidenceHashes(prior.directory) };
  const runId = randomUUID(), instance = randomUUID(), directory = join(root, `adapter-correlation-review-${runId}`);
  const fd = openSync(join(root, 'adapter-correlation-review-20260929.json'), 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ authorized: 'Owner asks to test and review the room-correlation fix; one new isolated provider-free attempt',
      at: new Date().toISOString(), runId, instance, directory, historicalHashes, previousRun: prior.directory,
      historical_debts: 'unchanged and unresolved', production_admission_override: false,
      limit: { room_triggered_dispatches: 1, explicit_dispatches: 0, redispatch: false } }, null, 2) + '\n'); fsyncSync(fd);
  } finally { closeSync(fd); }
  const parent = openSync(root, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  mkdirSync(directory, { mode: 0o700 });
  return { directory, runId, instance, originalHashes };
}
