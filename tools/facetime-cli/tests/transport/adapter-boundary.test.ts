import test from 'node:test';
import assert from 'node:assert/strict';
import { rig } from '../fixtures/rig.js';
test('connector forwards only adapter-provided call-scoped bridge credentials', async () => {
  const r = rig();
  const prepare = r.agent.prepare.bind(r.agent);
  r.agent.prepare = async (...args) => Object.assign(await prepare(...args), {
    bridge: { livekit_url: 'wss://adapter.invalid', participant_token: 'ADAPTER_CALL_TOKEN' },
  });
  const decision = await r.connector.incoming(r.request());
  assert.equal(decision.action, 'accept');
  if (decision.action === 'accept') {
    assert.equal(decision.livekit_url, 'wss://adapter.invalid');
    assert.equal(decision.participant_token, 'ADAPTER_CALL_TOKEN');
  }
  assert.ok(!JSON.stringify(r.journal.snapshot()).includes('ADAPTER_CALL_TOKEN'));
  r.connector.close(); r.agent.close();
});
