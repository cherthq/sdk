import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceHashes, reserveRun, onceDispatch } from '../fixtures/diagnostic-run.js';

test('default refuses retained state; explicit exception preserves it and is single use', () => {
  const root = mkdtempSync(join(tmpdir(), 'diagnostic-run-'));
  try {
    const original = join(root, 'adapter-livekit'); mkdirSync(original);
    for (const name of ['journal.json', 'adapter.json', 'result.json']) writeFileSync(join(original, name), '{"retained":true}');
    const before = evidenceHashes(original);
    assert.throws(() => reserveRun(root, false), /prior_test_receipt_present/);
    const run = reserveRun(root, true);
    assert.notEqual(run.directory, original); assert.notEqual(run.instance, 'instance_1');
    assert.deepEqual(run.originalHashes, before); assert.deepEqual(evidenceHashes(original), before);
    const latch = readFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'utf8');
    assert.equal(JSON.parse(latch).original_status, 'unresolved');
    assert.throws(() => reserveRun(root, true), /EEXIST/);
    assert.equal(readFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), 'utf8'), latch);
    assert.deepEqual(evidenceHashes(original), before);
    assert.throws(() => reserveRun(root, false), /prior_test_receipt_present/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('exception requires original evidence and cannot create an unlinked run', () => {
  const root = mkdtempSync(join(tmpdir(), 'diagnostic-run-'));
  try { assert.throws(() => reserveRun(root, true), /ENOENT/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('one application dispatch budget is consumed even when the first rejects', async () => {
  let calls = 0;
  const dispatch = onceDispatch(async () => { calls++; throw new Error('uncertain_network'); });
  await assert.rejects(dispatch(), /uncertain_network/);
  assert.throws(() => dispatch(), /already_attempted/); assert.equal(calls, 1);
});

import { reserveQualification } from '../fixtures/diagnostic-run.js';
test('qualification slots preserve both old runs, consume failures and gate the second on complete cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'qualification-'));
  try {
    for (const name of ['adapter-livekit', 'old-diagnostic']) {
      mkdirSync(join(root, name));
      for (const file of ['journal.json', 'adapter.json', 'result.json']) writeFileSync(join(root, name, file), '{}');
    }
    writeFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), JSON.stringify({ directory: join(root, 'old-diagnostic') }));
    const original = evidenceHashes(join(root, 'adapter-livekit')), old = evidenceHashes(join(root, 'old-diagnostic'));
    assert.throws(() => reserveQualification(root, 2), /ENOENT/);
    const first = reserveQualification(root, 1);
    assert.throws(() => reserveQualification(root, 1), /EEXIST/);
    writeFileSync(join(first.directory, 'result.json'), JSON.stringify({ status: 'failed' }));
    assert.throws(() => reserveQualification(root, 2), /first_qualification_not_clean/);
    const success = { status: 'passed', cleanup_debt: 0, final_owned_rooms: 0, acceptance_delivered: true, authority_commits: 1,
      bridge: { signature_verified: true }, terminal: { acknowledged: true }, worker_stopped: true };
    for (const field of ['cleanup_debt', 'authority_commits']) {
      writeFileSync(join(first.directory, 'result.json'), JSON.stringify({ ...success, [field]: 2 }));
      assert.throws(() => reserveQualification(root, 2), /first_qualification_not_clean/);
    }
    writeFileSync(join(first.directory, 'result.json'), JSON.stringify(success));
    const second = reserveQualification(root, 2); assert.notEqual(first.runId, second.runId);
    assert.throws(() => reserveQualification(root, 2), /EEXIST/);
    assert.deepEqual(evidenceHashes(join(root, 'adapter-livekit')), original);
    assert.deepEqual(evidenceHashes(join(root, 'old-diagnostic')), old);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { reserveReadinessReview } from '../fixtures/diagnostic-run.js';
test('reviewed retry is single use, preserves all prior runs and does not unlock old slot', () => {
  const root = mkdtempSync(join(tmpdir(), 'readiness-review-'));
  try {
    for (const dir of ['adapter-livekit', 'old-diagnostic', 'qualification']) {
      mkdirSync(join(root, dir));
      for (const file of ['journal.json', 'adapter.json', 'result.json']) writeFileSync(join(root, dir, file), '{}');
    }
    writeFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), JSON.stringify({ directory: join(root, 'old-diagnostic') }));
    writeFileSync(join(root, 'adapter-qualification-20260929-1.json'), JSON.stringify({ directory: join(root, 'qualification') }));
    assert.throws(() => reserveReadinessReview(root), /cleanup_incomplete/);
    writeFileSync(join(root, 'qualification/result.json'), JSON.stringify({ status: 'failed', cleanup_debt: 0, adapter_phase: 'clean', worker_stopped: true }));
    const hashes = ['adapter-livekit', 'old-diagnostic', 'qualification'].map(dir => evidenceHashes(join(root, dir)));
    const run = reserveReadinessReview(root);
    assert.notEqual(run.directory, join(root, 'qualification'));
    assert.throws(() => reserveReadinessReview(root), /EEXIST/);
    assert.throws(() => reserveQualification(root, 2), /first_qualification_not_clean/);
    assert.deepEqual(['adapter-livekit', 'old-diagnostic', 'qualification'].map(dir => evidenceHashes(join(root, dir))), hashes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { reserveCorrelationReview } from '../fixtures/diagnostic-run.js';
test('correlation review requires clean previous run, is single use and preserves its evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'correlation-review-'));
  try {
    for (const dir of ['adapter-livekit', 'old-diagnostic', 'prior-review']) {
      mkdirSync(join(root, dir));
      for (const file of ['journal.json', 'adapter.json', 'result.json']) writeFileSync(join(root, dir, file), '{}');
    }
    writeFileSync(join(root, 'adapter-diagnostic-exception-20260925.json'), JSON.stringify({ directory: join(root, 'old-diagnostic') }));
    writeFileSync(join(root, 'adapter-readiness-review-20260929.json'), JSON.stringify({ directory: join(root, 'prior-review') }));
    assert.throws(() => reserveCorrelationReview(root), /cleanup_incomplete/);
    writeFileSync(join(root, 'prior-review/result.json'), JSON.stringify({ cleanup_debt: 0, adapter_phase: 'clean', worker_stopped: true }));
    const before = evidenceHashes(join(root, 'prior-review'));
    const run = reserveCorrelationReview(root);
    assert.notEqual(run.directory, join(root, 'prior-review'));
    assert.throws(() => reserveCorrelationReview(root), /EEXIST/);
    assert.deepEqual(evidenceHashes(join(root, 'prior-review')), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
