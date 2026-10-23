import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from '../fixtures/cli-harness.js';
import { parseFrame } from '../../src/protocol/v1.js';
const executable = new URL('../../src/cli/main.js', import.meta.url).pathname;
test('receiver-free init defaults to BYOR and generates a trusted callback without LiveKit or a hook', async () => {
  const root = mkdtempSync(join(tmpdir(), 'byor-init-'));
  try {
    const config = join(root, 'config.json');
    const result = cli(executable, ['init', '--config', config, '--state-dir', join(root, 'state'), '--non-interactive', '--json'], {}, root);
    assert.equal(await result.exit, 0, result.stderr);
    const saved = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(saved.schema_version, 2); assert.equal(saved.mode, 'byor');
    assert.equal(saved.livekit, undefined); assert.equal(saved.hook, undefined);
    assert.match(readFileSync(join(root, 'chert-handler.ts'), 'utf8'), /ByorHandler/);
    const mismatch = cli(executable, ['create-room', '--config', config, '--json'], {}, root);
    assert.equal(await mismatch.exit, 2); assert.equal(JSON.parse(mismatch.stderr).code, 'mode_mismatch');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('BYOR transport carries a pinned mode and explicit duration beyond the prototype ceiling', () => {
  const frame = parseFrame(JSON.stringify({v:1,type:'call.decision',message_id:'message',project_id:'project',line_id:'line',binding_id:'binding',binding_epoch:1,instance_id:'instance',connection_generation:1,call_id:'call',request_id:'request',session_mode:'byor',action:'accept',livekit_url:'wss://example.test',participant_token:'token',remote_participant_identity:'application-agent',session_expires_at:700000}));
  assert.equal(frame.type, 'call.decision');
});
test('explicit create-room startup stays idle and legacy run remains distinct from v2 mode', async () => {
  const { cliHarness } = await import('../fixtures/cli-harness.js');
  const h=await cliHarness();
  let running: ReturnType<typeof cli>|undefined;
  try {
    const init=cli(executable,[...h.initArgs,'--mode','create-room']);assert.equal(await init.exit,0,init.stderr);
    assert.equal(JSON.parse(readFileSync(h.configPath,'utf8')).mode,'create-room');
    const legacy=h.launch(executable,'run');assert.equal(await legacy.exit,2);assert.equal(JSON.parse(legacy.stderr).code,'mode_mismatch');
    running=h.launch(executable,'create-room');await running.waitConnected();assert.equal(h.effects.created,0);assert.equal(h.effects.explicitDispatch,0);
    const owner=await h.call();await h.terminal(owner);assert.equal(await running.stop(),0);
  } finally {await running?.stop();await h.close();}
});
