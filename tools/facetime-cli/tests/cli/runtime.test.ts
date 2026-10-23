import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, cliHarness, until, SECRETS } from '../fixtures/cli-harness.js';
import { TOKEN } from '../fixtures/rig.js';
const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
test('CLI actual adapter traverses HTTP/WS, commits once, acknowledges terminal and cleans; status does not take writer lock', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    const p = h.launch(executable); await p.waitConnected();
    const check = h.launch(executable, 'check'); assert.equal(await check.exit, 3); assert.equal(JSON.parse(check.stdout).state.writer_locked, true);
    const status = h.launch(executable, 'status'); assert.equal(await status.exit, 0);
    assert.equal(JSON.parse(status.stdout).observation.live, false);
    const second = h.launch(executable); assert.equal(await second.exit, 4); assert.equal(JSON.parse(second.stderr).code, 'writer_locked');
    h.holdCreate();
    const request = h.authority.register(TOKEN);
    const one = h.incoming(request); const two = h.incoming(request);
    await until(() => h.effects.created === 1); h.releaseCreate();
    const [a, b] = await Promise.all([one, two]); assert.equal(a.decision.action, 'accept'); assert.equal(b.decision.action, 'accept');
    const receipts = await Promise.all([h.authority.commit(TOKEN, a.decision), h.authority.commit(TOKEN, b.decision)]);
    h.relay.deliver(receipts[0]!);
    await until(() => Object.values(h.snapshot().entries)[0]?.state === 'accepted');
    assert.equal(h.authority.commitCount, 1); await h.terminal(request);
    assert.equal(h.effects.created, 1); assert.equal(h.effects.deleted, 1); assert.equal(h.effects.explicitDispatch, 0);
    const reused = await h.call(); await h.terminal(reused); assert.equal(h.effects.created, 2);
    assert.equal(await p.stop(), 0); assert.equal(existsSync(join(h.statePath, 'journal.json.lock')), false);
    for (const secret of Object.values(SECRETS)) assert.ok(!(p.stdout + p.stderr + readFileSync(join(h.statePath, 'journal.json'), 'utf8') + readFileSync(join(h.statePath, 'adapter.json'), 'utf8')).includes(secret));
  } finally { await h.close(); }
});
for (const reason of ['interrupt', 'disconnect', 'lost_receipt'] as const) {
  test(`${reason} preserves possibly accepted work; reopened runtime reconciles without redispatch`, async () => {
    const h = await cliHarness();
    try {
      assert.equal(await cli(executable, h.initArgs).exit, 0);
      const p = h.launch(executable); await p.waitConnected();
      if (reason === 'lost_receipt') h.relay.dropReceipts = true;
      const owner = await h.call(); h.recoveryFailure = true;
      if (reason === 'disconnect') h.relay.closeSockets(); else p.child.kill('SIGTERM');
      assert.equal(await p.exit, reason === 'disconnect' ? 6 : 3);
      assert.equal(h.rooms.size, 1); assert.equal(h.effects.deleted, 0);
      assert.ok(Object.values(h.snapshot().entries).some(e => !e.terminal));
      const before = h.effects.created;
      const reopened = h.launch(executable); await reopened.waitConnected();
      const denied = await h.incoming(); assert.equal(denied.decision.action, 'decline'); assert.equal(h.effects.created, before);
      // Lost lifecycle is recovered through authenticated authority reads.
      h.authority.lifecycle(TOKEN, owner, 'ended'); h.recoveryFailure = false;
      await until(() => h.rooms.size === 0 && Object.values(h.snapshot().entries).every(e => !e.cleanup_debt));
      assert.equal(h.effects.created, 1); assert.equal(h.effects.deleted, 1); assert.equal(await reopened.stop(), 0);
    } finally { await h.close(); }
  });
}
test('interrupt during preparation joins local completion and cleans only its owned late room', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    const p = h.launch(executable); await p.waitConnected(); h.holdCreate();
    // Socket close makes the fixture HTTP fail; do not treat it as acceptance.
    const request = h.incoming().catch(() => undefined);
    await until(() => h.effects.created === 1); p.child.kill('SIGTERM'); h.releaseCreate();
    await request; assert.equal(await p.exit, 0); assert.equal(h.rooms.size, 0); assert.equal(h.effects.deleted, 1);
  } finally { await h.close(); }
});
test('unavailable agent declines with no SDK allocations while runtime remains connected', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0); h.h.connected = false;
    const p = h.launch(executable); await p.waitConnected();
    const { decision } = await h.incoming(); assert.equal(decision.action, 'decline');
    if (decision.action === 'decline') assert.equal(decision.reason, 'agent_unavailable');
    assert.equal(h.effects.created, 0); assert.equal(await p.stop(), 0);
  } finally { await h.close(); }
});
test('failed relay authorization is actionable and releases its new local writer', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    const p = cli(executable, ['run', '--config', h.configPath, '--json'], { ...SECRETS, CHERT_CONNECTOR_TOKEN: 'FOREIGN_SECRET_SENTINEL' });
    assert.equal(await p.exit, 6); assert.ok(!p.stderr.includes('FOREIGN_SECRET_SENTINEL'));
    assert.equal(h.effects.created, 0); assert.equal(existsSync(join(h.statePath, 'journal.json.lock')), false);
  } finally { await h.close(); }
});
test('a stale crash lock is never automatically removed or used as permission to discard evidence', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    const p = h.launch(executable); await p.waitConnected(); p.child.kill('SIGKILL'); await p.exit;
    const path = join(h.statePath, 'journal.json'); const before = readFileSync(path);
    const again = h.launch(executable); assert.equal(await again.exit, 4); assert.deepEqual(readFileSync(path), before);
    // No state-clearing or implicit dead-PID recovery command is exposed.
    const reset = cli(executable, ['reset', '--config', h.configPath, '--json']); assert.equal(await reset.exit, 2);
  } finally { await h.close(); }
});
test('foreign binding cannot reopen an existing journal', async () => {
  const h = await cliHarness();
  try {
    assert.equal(await cli(executable, h.initArgs).exit, 0);
    const p = h.launch(executable); await p.waitConnected(); assert.equal(await p.stop(), 0);
    const config = JSON.parse(readFileSync(h.configPath, 'utf8')); config.transport.scope.instance_id = 'foreign'; writeFileSync(h.configPath, JSON.stringify(config));
    const again = h.launch(executable); assert.equal(await again.exit, 4); assert.equal(h.effects.created, 0);
  } finally { await h.close(); }
});
for (const fault of ['malformed', 'redirect'] as const) {
  test(`SDK ${fault} failure stays local and never logs raw error bodies`, async () => {
    const h = await cliHarness();
    try {
      assert.equal(await cli(executable, h.initArgs).exit, 0);
      const p = h.launch(executable); await p.waitConnected();
      if (fault === 'malformed') h.malformedManagement = true; else h.redirectManagement = true;
      const { decision } = await h.incoming(); assert.equal(decision.action, 'decline');
      assert.equal(await p.stop(), 3); assert.equal(h.effects.created, 0);
      assert.ok(!(p.stdout + p.stderr).includes('SECRET_FROM_SDK_BODY_SENTINEL'));
      assert.ok(!(p.stdout + p.stderr).includes('SyntaxError'));
    } finally { await h.close(); }
  });
}
