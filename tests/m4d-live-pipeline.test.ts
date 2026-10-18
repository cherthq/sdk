import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { approval, validateConfig, createReceipt, createBroker, nativeEvidence, providerForPlan, planFromArgs, assertLocalFixtureRequest } from '../scripts/m4d-live-pipeline.mjs';
const config = { approval, run: '550e8400-e29b-41d4-a716-446655440000', marker: 'CHERT-M4D-PIPELINE-550e8400-e29b-41d4-a716-446655440000-blooio', mode: 'bridge' as const, from: '+15550000001', to: '+15550000002' };
const body = { to: config.to, message: config.marker, idempotency_key: 'followup:chat-a:0123456789abcdef:bubble-0' };
const request = (value = body) => new Request('https://device.invalid/send', { method: 'POST', headers: { Authorization: 'Bearer fixture-device-key', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

test('unique private receipt and explicit UUID/account plan are mandatory', () => {
  expect(validateConfig(config)).toBe(config);
  for (const update of [{ approval: 'old-four-sends' }, { run: 'abc' }, { to: config.from }, { mode: 'imcore' }, { marker: 'arbitrary' }]) expect(() => validateConfig({ ...config, ...update })).toThrow();
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-')); const path = join(dir, 'receipt.json');
  try {
    const journal = createReceipt(path, config);journal.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => createReceipt(path, config)).toThrow();
    const text = readFileSync(path, 'utf8');expect(text).not.toContain(config.from);expect(text).not.toContain(config.to);
  } finally { rmSync(dir, { recursive: true }); }
});

test('actual generated native key survives; attempt is persisted before transport and never reused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-')); const path = join(dir, 'receipt.json');
  const journal = createReceipt(path, config);let calls = 0;
  const native = { message_id: 'msg_EXACT', status: 'pending', queued: true, success: true, fallback_owner: 'none', error: config.to, debug_secret: 'must-not-persist' };
  const broker = createBroker(config, journal, async payload => {
    calls++;expect(JSON.parse(readFileSync(path, 'utf8')).attempted).toBe(true);
    expect(payload.body).toEqual({ ...body, native_sms_disabled: true });
    return { status: 202, body: native };
  });
  try {
    const response = await broker(request());expect(response.status).toBe(202);expect(await response.json()).toEqual(native);
    await expect(broker(request())).rejects.toThrow('already spent');expect(calls).toBe(1);
    const receipt = readFileSync(path, 'utf8');expect(receipt).not.toContain('must-not-persist');expect(receipt).not.toContain(config.to);
    expect(JSON.parse(receipt).native_idempotency_key).toBe(body.idempotency_key);
    journal.close();expect(() => createReceipt(path, config, true)).toThrow('cannot be replayed');
  } finally { rmSync(dir, { recursive: true }); }
});

test('unsafe payload cannot spend an attempt and uncertain SSH cannot authorize resend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-'));const path = join(dir, 'receipt.json');
  const journal = createReceipt(path, config);let calls = 0;
  const broker = createBroker(config, journal, async () => { calls++;throw new Error('remote sensitive secret'); });
  try {
    for (const update of [{ to: '+15550000003' }, { message: 'not-marker' }, { idempotency_key: 'replacement' }, { native_sms_disabled: true }]) await expect(broker(request({ ...body, ...update }))).rejects.toThrow();
    expect(journal.receipt.attempted).toBe(false);expect(calls).toBe(0);
    await expect(broker(request())).rejects.toThrow('outcome unknown');
    await expect(broker(request())).rejects.toThrow('already spent');expect(calls).toBe(1);
    expect(readFileSync(path, 'utf8')).not.toContain('remote sensitive secret');
  } finally { journal.close();rmSync(dir, { recursive: true }); }
});

test('native receipt whitelist excludes arbitrary bodies, unknown service and error strings', () => {
  expect(nativeEvidence({ status: 202, body: { success: true, message_id: config.to, guid: 'bad/guide', service: config.to, status: config.to, error: 'secret', delivery: { error: 42, detail: 'secret' } } })).toEqual({ http_status: 202, success: true, delivery: { error: 42 } });
});

async function offlinePipeline(provider: 'blooio' | 'linq' | 'sendblue' | 'blooio-v4' | 'python' | 'rust' | 'cpp') {
  const selected = { ...config, provider, approval: `one-reviewed-${provider}-production-pipeline-send`, marker: `CHERT-M4D-PIPELINE-${config.run}-${provider}` };
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-'));const path = join(dir, 'receipt.json');
  createReceipt(path, selected).close();
  try {
    const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname, '--offline-pipeline-contract'], {
      env: { ...process.env, CHERT_PIPELINE_CONFIG: JSON.stringify(selected), CHERT_PIPELINE_RECEIPT: path,
        NODE_PATH: new URL('../../control-plane/node_modules', import.meta.url).pathname }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout).status).toBe('passed');
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt.outcome).toBe('offline-contract-only');expect(receipt.attempted).toBe(true);
    expect(receipt.route.http_status).toBeGreaterThanOrEqual(200);expect(receipt.route.http_status).toBeLessThan(300);expect(receipt.sdk.status).toBe('queued');
    expect(receipt.local_database.returned_id_persisted).toBe(true);
    expect(receipt.local_database.append_count).toBe(0);
    const strict=['linq','sendblue','blooio-v4','blooio'].includes(provider);
    if(strict){expect(receipt.native.http_status).toBe(202);expect(receipt.native.state).toBe('acknowledged');expect(receipt.native.prepared_guid).toBe('23C408BF-2EE4-4B46-9DF3-A8383597FBBE');expect(receipt.native).not.toHaveProperty('delivered');expect(receipt.native).not.toHaveProperty('message_id');expect(receipt.correlation).toEqual({sdk_route_match:true,exact_prepared_guid:true,native_ownership_absent:true});}
    else{expect(receipt.native.http_status).toBe(200);expect(receipt.native).not.toHaveProperty('fallback_owner');expect(receipt.native).not.toHaveProperty('status');expect(receipt.native).not.toHaveProperty('queued');expect(receipt.native.delivered).toBe(false);expect(receipt.native.delivery).toEqual({isSent:false,isDelivered:false,error:0});expect(receipt.correlation).toEqual({sdk_route_match:true,exact_bridge_id:true,native_ownership_absent:true});expect(receipt.native.message_id).toBe('msg_OFFLINE');}
    expect(receipt.provider).toBe(provider);
    expect(receipt.route.path).toBe(['python', 'rust', 'cpp'].includes(provider) ? '/api/v1/send' : provider==='blooio'?'/api/v1/text-operations/v1': provider === 'linq' ? '/api/v1/chats/chat-a/messages' : '/api/v1/chats');
  } finally { rmSync(dir, { recursive: true }); }
}
test.each(['blooio', 'linq', 'sendblue', 'blooio-v4'] as const)('%s runs real SDK/local HTTP against current strict-ACK or legacy HTTP200 wire offline', offlinePipeline);
for (const provider of ['python', 'rust', 'cpp'] as const) {
  const configured = provider === 'python' || !!process.env[provider === 'rust' ? 'CHERT_PIPELINE_RUST_CLIENT' : 'CHERT_PIPELINE_CPP_CLIENT'];
  test.skipIf(!configured)(`${provider} actual language client runs the guarded pipeline offline`, () => offlinePipeline(provider));
}

async function failedStatus(provider: 'blooio' | 'python' | 'rust' | 'cpp') {
  const selected = { ...config, provider, approval: `one-reviewed-${provider}-production-pipeline-send`, marker: `CHERT-M4D-PIPELINE-${config.run}-${provider}` };
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-'));const path = join(dir, 'receipt.json');
  createReceipt(path, selected).close();
  try {
    const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname,
      '--offline-pipeline-contract', '--failed-sdk-status'], {
      env: { ...process.env, CHERT_PIPELINE_CONFIG: JSON.stringify(selected), CHERT_PIPELINE_RECEIPT: path,
        NODE_PATH: new URL('../../control-plane/node_modules', import.meta.url).pathname }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1);expect(stdout).toBe('');expect(JSON.parse(stderr).status).toBe('incomplete');
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt.passed).toBe(false);expect(receipt.outcome).toBe('acceptance-incomplete-no-resend');
    expect(receipt.attempted).toBe(true);if(provider==='blooio'){expect(receipt.sdk.http_status).toBe(502);expect(receipt.sdk.outcome).toBe('unconfirmed-no-resend');}else expect(receipt.sdk.status).toBe('failed');
    expect(receipt.route.http_status).toBe(202);expect(receipt.local_database.returned_id_persisted).toBe(provider!=='blooio');
    expect(receipt.recipient.complete).toBe(true);expect(receipt.local_database.append_count).toBe(0);
  } finally { rmSync(dir, { recursive: true }); }
 }
for (const provider of ['blooio', 'python', 'rust', 'cpp'] as const) {
  const configured = !['rust','cpp'].includes(provider) || !!process.env[provider === 'rust' ? 'CHERT_PIPELINE_RUST_CLIENT' : 'CHERT_PIPELINE_CPP_CLIENT'];
  test.skipIf(!configured)(`${provider} genuine SDK failed status cannot pass with persisted ID and recipient evidence`, () => failedStatus(provider));
}

test.each(['--failed-sdk-status', '--wrong-outbox-correlation', '--native-owner-correlation', '--wrong-route-id', '--wrong-language-body'])('offline fault %s is rejected by the live child before receipt or transport access', async fault => {
  const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname,
    '--reviewed-m4d-pipeline-child', fault], {
    env: { ...process.env, CHERT_PIPELINE_CONFIG: '', CHERT_PIPELINE_RECEIPT: '' }, stdout: 'pipe', stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).not.toBe(0);expect(stdout).toBe('');expect(stderr).toContain('AssertionError');
  expect(stderr).not.toContain('SSH');
});

test.each(['m4d-live-pipeline.mjs', 'm4d-live-acceptance.mjs'])('actual remote opener in %s ignores proxies and redirects without network requests', async filename => {
  const source = readFileSync(new URL(`../scripts/${filename}`, import.meta.url), 'utf8');
  const start = source.indexOf('class NoRedirect(');const end = source.indexOf('\ndef request(', start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  const construction = source.slice(start, end);
  const program = `import urllib.request\n${construction}\nassert urllib.request.getproxies().get('http') == 'http://proxy.invalid:8080'\nassert all(not h.proxies for h in opener.handlers if isinstance(h,urllib.request.ProxyHandler))\nassert any(isinstance(h,NoRedirect) for h in opener.handlers)\nassert NoRedirect().redirect_request(None,None,None,None,None,None) is None\nprint('offline-opener-verified')\n`;
  const child = Bun.spawn(['python3', '-c', program], { env: { ...process.env,
    http_proxy: 'http://proxy.invalid:8080', HTTP_PROXY: '', https_proxy: 'http://proxy.invalid:8080' }, stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });expect(stdout.trim()).toBe('offline-opener-verified');
});


test('each provider needs its own explicit CLI plan and exact provider-bound marker', async () => {
  for (const provider of ['blooio', 'linq', 'sendblue', 'blooio-v4', 'python', 'rust', 'cpp'] as const) {
    const plan = planFromArgs([`--one-reviewed-${provider}-pipeline-send`]);
    expect(plan.provider).toBe(provider);
    const selected = { ...config, ...plan, marker: `CHERT-M4D-PIPELINE-${config.run}-${provider}` };
    expect(providerForPlan(validateConfig(selected))).toBe(provider);
    const foreign = provider === 'linq' ? 'sendblue' : 'linq';
    expect(() => validateConfig({ ...selected, provider: foreign })).toThrow();
    expect(() => validateConfig({ ...selected, marker: `CHERT-M4D-PIPELINE-${config.run}-${foreign}` })).toThrow();
    const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-'));const path = join(dir, 'receipt.json');
    const journal = createReceipt(path, selected);let calls = 0;
    const broker = createBroker(selected, journal, async () => { calls++;throw new Error('unknown transport'); });
    try {
      await expect(broker(request({ ...body, message: `CHERT-M4D-PIPELINE-${config.run}-${foreign}` }))).rejects.toThrow();
      expect(calls).toBe(0);expect(journal.receipt.attempted).toBe(false);
      await expect(broker(request({ ...body, message: selected.marker }))).rejects.toThrow('outcome unknown');
      await expect(broker(request({ ...body, message: selected.marker }))).rejects.toThrow('already spent');
      expect(calls).toBe(1);
    } finally { journal.close();rmSync(dir, { recursive: true }); }
  }
  for (const args of [[], ['--live'], ['--one-reviewed-unknown-pipeline-send'], ['--one-reviewed-linq-pipeline-send', '--one-reviewed-sendblue-pipeline-send']]) expect(() => planFromArgs(args)).toThrow();
});


test('local fixture guard pins origin, path and method, denying before server assignment', () => {
  const origin = 'http://127.0.0.1:12345';const path = '/api/v1/send';
  expect(() => assertLocalFixtureRequest(origin + path, { method: 'POST' }, origin, path)).not.toThrow();
  for (const [input, init, expectedOrigin] of [
    [origin + path, { method: 'POST' }, null],
    ['http://127.0.0.1:54321' + path, { method: 'POST' }, origin],
    [origin + '/unreviewed-action', { method: 'POST' }, origin],
    [origin + path + '?unexpected=1', { method: 'POST' }, origin],
    [origin + path, { method: 'DELETE' }, origin],
    [new Request(origin + path), undefined, origin],
  ] as const) expect(() => assertLocalFixtureRequest(input, init, expectedOrigin, path)).toThrow();
});

test.each(['--wrong-outbox-correlation', '--native-owner-correlation', '--wrong-route-id'])('acceptance rejects %s even with genuine SDK success and recipient evidence', async fault => {
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-'));const path = join(dir, 'receipt.json');
  createReceipt(path, config).close();
  try {
    const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname,
      '--offline-pipeline-contract', fault], {
      env: { ...process.env, CHERT_PIPELINE_CONFIG: JSON.stringify(config), CHERT_PIPELINE_RECEIPT: path,
        NODE_PATH: new URL('../../control-plane/node_modules', import.meta.url).pathname }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1);expect(stdout).toBe('');expect(JSON.parse(stderr).status).toBe('incomplete');
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    expect(receipt.passed).toBe(false);expect(receipt.sdk.status).toBe('queued');expect(receipt.recipient.complete).toBe(true);
  } finally { rmSync(dir, { recursive: true }); }
});


test.each(['rust', 'cpp'] as const)('%s missing helper refuses before claiming or spending a receipt', async provider => {
  const selected = { ...config, provider, approval: `one-reviewed-${provider}-production-pipeline-send`, marker: `CHERT-M4D-PIPELINE-${config.run}-${provider}` };
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-')); const path = join(dir, 'receipt.json');
  createReceipt(path, selected).close();
  try {
    const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname, '--offline-pipeline-contract'], {
      env: { ...process.env, CHERT_PIPELINE_RUST_CLIENT: '', CHERT_PIPELINE_CPP_CLIENT: '', CHERT_PIPELINE_CONFIG: JSON.stringify(selected), CHERT_PIPELINE_RECEIPT: path,
        NODE_PATH: new URL('../../control-plane/node_modules', import.meta.url).pathname }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).not.toBe(0); expect(stdout).toBe(''); expect(stderr).toContain('explicit absolute language helper required');
    const receipt = JSON.parse(readFileSync(path, 'utf8')); expect(receipt.attempted).toBe(false); expect(receipt.passed).toBe(false);
    expect(receipt).not.toHaveProperty('environment');
  } finally { rmSync(dir, { recursive: true }); }
});


for (const provider of ['rust', 'cpp'] as const) {
  const helper = process.env[provider === 'rust' ? 'CHERT_PIPELINE_RUST_CLIENT' : 'CHERT_PIPELINE_CPP_CLIENT'];
  test.skipIf(!helper)(`${provider} dedicated helper rejects wrong CLI, origin, marker and fields before transport`, async () => {
    const valid = { phone: config.to, body: `CHERT-M4D-PIPELINE-${config.run}-${provider}` };
    for (const [args, input] of [
      [['--wrong-guard', 'http://127.0.0.1:1'], valid],
      [['--one-reviewed-pipeline-send', 'http://127.0.0.1:1/unreviewed'], valid],
      [['--one-reviewed-pipeline-send', 'http://127.0.0.1:1'], { ...valid, body: config.marker }],
      [['--one-reviewed-pipeline-send', 'http://127.0.0.1:1'], { ...valid, extra: true }],
    ] as const) {
      const child = Bun.spawn([helper!, ...args], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
      child.stdin.write(JSON.stringify(input)); child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code).not.toBe(0); expect(stdout).toBe(''); expect(stderr).not.toContain(config.marker);
      } finally { clearTimeout(timer); }
    }
  });
}


test('language wrong-body rejection is sanitized before route and native attempt', async () => {
  const selected = { ...config, provider: 'python', approval: 'one-reviewed-python-production-pipeline-send', marker: `CHERT-M4D-PIPELINE-${config.run}-python` };
  const dir = mkdtempSync(join(tmpdir(), 'chert-pipeline-test-')); const path = join(dir, 'receipt.json');
  createReceipt(path, selected).close();
  try {
    const child = Bun.spawn([process.execPath, '--no-install', new URL('./m4d-live-pipeline.fixture.mjs', import.meta.url).pathname, '--offline-pipeline-contract', '--wrong-language-body'], {
      env: { ...process.env, CHERT_PIPELINE_CONFIG: JSON.stringify(selected), CHERT_PIPELINE_RECEIPT: path, NODE_PATH: new URL('../../control-plane/node_modules', import.meta.url).pathname }, stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1); expect(stdout).toBe(''); expect(JSON.parse(stderr).status).toBe('incomplete');
    for (const secret of [config.from,config.to,'+15550000003',selected.marker]) expect(stdout+stderr).not.toContain(secret);
    const receipt = JSON.parse(readFileSync(path, 'utf8')); expect(receipt.attempted).toBe(false); expect(receipt.passed).toBe(false);
    expect(receipt.local_database.event_count).toBe(0); expect(receipt.sdk.http_status).toBe(400); expect(receipt).not.toHaveProperty('native');
  } finally { rmSync(dir, { recursive: true }); }
});


test.each(['linq','sendblue','blooio-v4','blooio'] as const)('%s historical live plan refuses new text protocol before spending attempt',async provider=>{
 const selected={...config,provider,approval:`one-reviewed-${provider}-production-pipeline-send`,marker:`CHERT-M4D-PIPELINE-${config.run}-${provider}`};
 const dir=mkdtempSync(join(tmpdir(),'chert-pipeline-protocol-'));const path=join(dir,'receipt.json');createReceipt(path,selected).close();
 try{
  const child=Bun.spawn([process.execPath,'--no-install',new URL('./m4d-live-pipeline.fixture.mjs',import.meta.url).pathname,'--offline-pipeline-contract','--unsupported-live-text-protocol'],{env:{...process.env,CHERT_PIPELINE_CONFIG:JSON.stringify(selected),CHERT_PIPELINE_RECEIPT:path,NODE_PATH:new URL('../../control-plane/node_modules',import.meta.url).pathname},stdout:'pipe',stderr:'pipe'});
  const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code).toBe(1);expect(stdout).toBe('');expect(JSON.parse(stderr).status).toBe('incomplete');const receipt=JSON.parse(readFileSync(path,'utf8'));expect(receipt.attempted).toBe(false);expect(receipt.local_database.event_count).toBe(1);expect(receipt.local_database.append_count).toBe(0);expect(receipt.sdk.http_status).toBe(502);expect(receipt.outcome).toBe('acceptance-incomplete-no-resend');
 }finally{rmSync(dir,{recursive:true});}
});
