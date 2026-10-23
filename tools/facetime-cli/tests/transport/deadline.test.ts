import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from '../../src/runtime/deadline.js';

const timing = { created_at: 10_000, sent_at: 10_000, deadline_at: 15_000, prepare_deadline_at: 14_000, remaining_ms: 5000 };
function clock() { return { time: 10_000, elapsed: 0, wall() { return this.time; }, mono() { return this.elapsed; } }; }

test('clock rollback cannot renew final or preparation budgets', () => {
  const c = clock(); const b = new Budget(c, timing);
  c.elapsed = 4000; c.time = 9000;
  assert.equal(b.remaining(true), 0);
  c.elapsed = 5000;
  assert.equal(b.remaining(), 0);
});
test('signed smaller remaining budget and queue delay are charged', () => {
  const c = clock(); c.time += 1000;
  const b = new Budget(c, { ...timing, remaining_ms: 2000 });
  assert.equal(b.remaining(), 1000);
  assert.equal(b.remaining(true), 0);
});
test('invalid ordering and excessive future skew fail closed', () => {
  const c = clock();
  assert.throws(() => new Budget(c, { ...timing, prepare_deadline_at: 15_000 }), /invalid_deadline/);
  assert.throws(() => new Budget(c, { ...timing, sent_at: 11_000 }), /invalid_deadline/);
});
test('4s preparation and 5s final boundaries are exclusive', () => {
  const c = clock(); const b = new Budget(c, timing);
  c.elapsed = 4000; c.time = 14_000;
  assert.equal(b.remaining(true), 0); assert.equal(b.remaining(), 1000);
  c.elapsed = 5000; c.time = 15_000; assert.equal(b.remaining(), 0);
});
test('resource expiry retains its monotonic cap across rollback before allocation', () => {
  const c = clock(); const b = new Budget(c, timing);
  c.elapsed = 1000; c.time -= 1000;
  assert.equal(b.resourceRemaining(70_000), 59_000);
});

test('a ten-second decision window with nine seconds to prepare is accepted, as the deployed control plane sends it', () => {
  const c = clock();
  const b = new Budget(c, { created_at: 10_000, sent_at: 10_000, deadline_at: 20_000, prepare_deadline_at: 19_000, remaining_ms: 10_000 });
  assert.equal(b.remaining(), 10_000); assert.equal(b.remaining(true), 9_000);
  c.elapsed = 9_000; c.time = 19_000;
  assert.equal(b.remaining(true), 0); assert.equal(b.remaining(), 1_000);
});
test('a window longer than ten seconds still fails closed', () => {
  const c = clock();
  assert.throws(() => new Budget(c, { created_at: 10_000, sent_at: 10_000, deadline_at: 20_001, prepare_deadline_at: 19_001, remaining_ms: 10_001 }), /invalid_deadline/);
  assert.throws(() => new Budget(c, { created_at: 10_000, sent_at: 10_000, deadline_at: 20_000, prepare_deadline_at: 19_500, remaining_ms: 10_000 }), /invalid_deadline/);
});
