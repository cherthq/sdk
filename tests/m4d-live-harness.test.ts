import { expect, test } from 'bun:test';
// Importing the harness cannot run its --live main or perform SSH.
const harness = await import('../scripts/m4d-live-acceptance.mjs');

test('live harness requires explicit bounded account/run configuration', () => {
  const config = { approval: 'three-reviewed-imessage-only-sends' as const, from: '+15550000001', to: '+15550000002', run: 'abc-123' };
  expect(harness.parseLiveConfig(config)).toBe(config);
  expect(() => harness.parseLiveConfig({ ...config, approval: undefined })).toThrow();
  expect(() => harness.parseLiveConfig({ ...config, run: 'arbitrary content' })).toThrow();
});

test('unreviewed marker cannot reach SSH or native send', async () => {
  await expect(harness.dispatchM4D({ message: 'not-approved' }, {
    approval: 'three-reviewed-imessage-only-sends', from: '+15550000001', to: '+15550000002', run: 'abc-123',
  })).rejects.toThrow('reviewed synthetic');
});

test('v4 approval selects exactly one fixed adapter and excludes the three-send plan', async () => {
  const config = { approval: 'one-reviewed-v4-imessage-only-send' as const, from: '+15550000001', to: '+15550000002', run: 'abc-123' };
  expect(harness.adapterPlan(config)).toEqual(['blooio-v4']);
  expect(harness.adapterPlan({ ...config, approval: 'three-reviewed-imessage-only-sends' })).toEqual(['sendblue', 'linq', 'blooio']);
  await expect(harness.dispatchM4D({ message: 'CHERT-M4D-abc-123-sendblue' }, config)).rejects.toThrow('reviewed synthetic');
});
