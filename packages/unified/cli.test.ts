import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('CLI preserves keyed sends and rejects an explicit empty key before HTTP', async () => {
  const requests: unknown[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ status: 'queued', message_id: '550e8400-e29b-41d4-a716-446655440000', chat_id: 'test_chat', lead_id: 'test_chat', lead_created: false, convo_id: 'convo-1', phone_line_id: 'line-1' }, { status: 202 });
  } });
  try {
    for (const [key, exit] of [['', 1], ['stable-key', 0]] as const) {
      const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), 'imessage', 'send', '--phone', '+61412345678', '--body', 'hello', '--idempotency-key', key, '--confirm'], {
        env: { ...process.env, CHERT_PROJECT_ID: 'fixture', CHERT_BASE_URL: server.url.origin, CHERT_API_KEY: 'fixture' },
        stdout: 'pipe', stderr: 'pipe',
      });
      expect(await child.exited).toBe(exit);
      if (key === '') {
        expect(JSON.parse(await new Response(child.stderr).text()).code).toBe('invalid_idempotency_key');
        expect(requests).toEqual([]);
      }
    }
    expect(requests).toEqual([{ phone: '+61412345678', body: 'hello', idempotency_key: 'stable-key' }]);
  } finally { server.stop(true); }
});

test('CLI requires caller confirmation and an idempotency key before sending', async () => {
  let requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++;
    return Response.json({ status: 'queued', message_id: '550e8400-e29b-41d4-a716-446655440000', chat_id: 'test_chat', lead_id: 'test_chat', lead_created: false, convo_id: 'convo-1', phone_line_id: 'line-1' }, { status: 202 });
  } });
  try {
    for (const [flags, code] of [
      [[], 'idempotency_key_required'],
      [['--idempotency-key', 'stable-key'], 'send_confirmation_required'],
    ] as const) {
      const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), 'imessage', 'send', '--phone', '+61412345678', '--body', 'hello', ...flags], {
        env: { ...process.env, CHERT_PROJECT_ID: 'fixture', CHERT_BASE_URL: server.url.origin, CHERT_API_KEY: '[REDACTED:api-key]' },
        stdout: 'pipe', stderr: 'pipe',
      });
      expect(await child.exited).toBe(1);
      expect(JSON.parse(await new Response(child.stderr).text()).code).toBe(code);
    }
    expect(requests).toBe(0);
  } finally { server.stop(true); }
});

test('CLI preserves a safe SDK error code without exposing server text or response data', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return Response.json({ error: { code: 'tenant_not_verified', message: 'private customer content' }, secret: 'private-token' }, { status: 403 });
  } });
  try {
    const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), 'imessage', 'send', '--phone', '+61412345678', '--body', 'hello', '--idempotency-key', 'stable-key', '--confirm'], {
      env: { ...process.env, CHERT_PROJECT_ID: 'fixture', CHERT_BASE_URL: server.url.origin, CHERT_API_KEY: '[REDACTED:api-key]' },
      stdout: 'pipe', stderr: 'pipe',
    });
    expect(await child.exited).toBe(1);
    const error = await new Response(child.stderr).text();
    expect(JSON.parse(error).code).toBe('tenant_not_verified');
    expect(error).not.toContain('private customer content');
    expect(error).not.toContain('private-token');
  } finally { server.stop(true); }
});

test('CLI reports unknown commands as such, even without credentials', async () => {
  for (const command of [['login'], ['onboard'], ['facetim'], ['facetime', 'statsu'], ['facetime', 'lines', 'extra'], ['imessage', 'sned'], ['context', 'extra'], ['context', '--offline', 'extra'], ['context', '--bogus'], ['billing'], ['billing', 'refund'], ['billing', 'status', 'extra']]) {
    const env = { ...process.env }; delete env.CHERT_PROJECT_ID;
    const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), ...command], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(1);
    expect(JSON.parse(await new Response(child.stderr).text())).toEqual({ error: 'Unknown command. Use --help.', code: 'unknown_command' });
  }
}, 20_000);

test('context reports account and docs context without exposing credential values', async () => {
  const paths: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname; paths.push(path);
    if (request.headers.get('authorization') !== 'Bearer context-secret-token') return Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
    if (path === '/api/v1/cli/whoami') return Response.json({ data: { email: 'dev@example.test', project: { id: 'p', name: 'Demo' }, role: 'owner' }, request_id: 'r1' });
    if (path === '/api/v1/lines') return Response.json({ data: { items: [{ id: 'l1', supports_video: true }], total: 1, limit: 50, offset: 0 }, request_id: 'r2' });
    return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  } });
  const cli = resolve(import.meta.dir, '../../dist/unified/cli.js');
  const run = async (args: string[], env: Record<string, string | undefined>) => {
    const child = Bun.spawn(['node', cli, 'context', ...args], { env: { PATH: process.env.PATH, ...env }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out] = [await child.exited, await new Response(child.stdout).text()];
    return { code, out, json: JSON.parse(out) };
  };
  try {
    const env = { CHERT_PROJECT_ID: '22000000-0000-4000-8000-000000000002', CHERT_FACETIME_TOKEN: 'context-secret-token', CHERT_FACETIME_URL: server.url.origin, CHERT_API_KEY: 'imessage-secret-key' };
    const online = await run([], env);
    expect(online.code).toBe(0);
    expect(online.out).not.toContain('context-secret-token');
    expect(online.out).not.toContain('imessage-secret-key');
    expect(online.json.account.facetime.identity.data.email).toBe('dev@example.test');
    expect(online.json.account.facetime.lines.data.items[0].supports_video).toBe(true);
    expect(online.json.configured.imessage.CHERT_API_KEY).toBe(true);
    expect(online.json.docs.setup).toEndWith('/docs/SETUP.md');
    expect(online.json.channels).toEqual(['imessage', 'facetime']);
    expect(paths.sort()).toEqual(['/api/v1/cli/whoami', '/api/v1/lines']);

    paths.length = 0;
    const offline = await run(['--offline'], env);
    expect(offline.json.account.facetime).toBe('skipped');
    expect(paths).toEqual([]);

    const rejected = await run([], { ...env, CHERT_FACETIME_TOKEN: 'wrong-token' });
    expect(rejected.code).toBe(0);
    expect(rejected.json.account.facetime.identity).toEqual({ error: 'unauthorized' });

    const leaky = await run(['--offline'], { CHERT_FACETIME_URL: 'https://user:hunter2@facetime.example/?token=abc', CHERT_BASE_URL: 'https://console.example/api/v1' });
    expect(leaky.out).not.toContain('hunter2');
    expect(leaky.out).not.toContain('token=abc');
    expect(leaky.json.configured.facetime.origin).toBe('invalid');
    expect(leaky.json.configured.imessage.origin).toBe('https://console.example');

    const bare = await run([], {});
    expect(bare.code).toBe(0);
    expect(bare.json.projectId).toBeNull();
    expect(bare.json.missing).toEqual(['CHERT_PROJECT_ID', 'CHERT_API_KEY', 'CHERT_FACETIME_TOKEN']);
    expect(bare.json.account.facetime).toBe('not_configured');
  } finally { server.stop(true); }
}, 20_000);

test('billing CLI gates mutations before HTTP and passes Stripe-hosted next steps through', async () => {
  const seen: { method: string; body: unknown; key: string | null }[] = [];
  let reply: unknown = { status: 'requires_payment_method', url: 'https://checkout.stripe.com/c/pay/cs_x' };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    seen.push({ method: request.method, body: request.method === 'POST' ? await request.json() : undefined, key: request.headers.get('idempotency-key') });
    return Response.json({ data: reply });
  } });
  const cli = resolve(import.meta.dir, '../../dist/unified/cli.js');
  const run = async (...args: string[]) => {
    const child = Bun.spawn(['node', cli, 'billing', ...args], { env: { PATH: process.env.PATH, CHERT_PROJECT_ID: 'p', CHERT_FACETIME_TOKEN: 'billing-token', CHERT_FACETIME_URL: server.url.origin }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = [await child.exited, await new Response(child.stdout).text(), await new Response(child.stderr).text()];
    return { code, json: JSON.parse(out || err) };
  };
  try {
    for (const [args, code] of [
      [['buy', '--idempotency-key', 'buy-key-01', '--confirm'], 'invalid_request'],            // plan required
      [['buy', '--plan', 'gold', '--idempotency-key', 'buy-key-01', '--confirm'], 'invalid_request'],
      [['cancel', '--plan', 'shared', '--idempotency-key', 'cancel-key-1', '--confirm'], 'invalid_request'],
      [['buy', '--plan', 'dedicated', '--confirm'], 'idempotency_key_required'],
      [['switch', '--plan', 'shared', '--idempotency-key', 'switch-key-1', '--confirm'], 'unknown_command'], // plan switching is unavailable
      [['buy', '--plan', 'shared', '--idempotency-key', 'buy-key-01'], 'billing_confirmation_required'],
    ] as const) expect((await run(...args)).json.code).toBe(code);
    expect(seen).toEqual([]);
    const card = await run('buy', '--plan', 'dedicated', '--idempotency-key', 'buy-key-01', '--confirm');
    expect([card.code, card.json.data]).toEqual([0, { status: 'requires_payment_method', url: 'https://checkout.stripe.com/c/pay/cs_x' }]);
    reply = { status: 'requires_action', url: 'https://evil.example/phish' };
    expect((await run('buy', '--plan', 'shared', '--idempotency-key', 'buy-key-02', '--confirm')).json.code).toBe('invalid_response');
    reply = { entitlement: null, needs_reconciliation: false, sales_enabled: true, shared_available: true, dedicated_available: false, payment_method: { brand: 'visa', last4: '4242' } };
    expect((await run('status')).json.data.payment_method).toEqual({ brand: 'visa', last4: '4242' });
    expect(seen).toEqual([{ method: 'POST', body: { action: 'purchase', plan: 'dedicated' }, key: 'buy-key-01' },
      { method: 'POST', body: { action: 'purchase', plan: 'shared' }, key: 'buy-key-02' }, { method: 'GET', body: undefined, key: null }]);
  } finally { server.stop(true); }
}, 30_000);

test('setup walkthrough: iMessage needs no project ID, and project API keys get a clear identity answer', async () => {
  const paths: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname; paths.push(path);
    if (path === '/api/v1/lines') return Response.json({ data: { items: [], total: 0, limit: 50, offset: 0 } });
    if (path.startsWith('/api/v1/send')) return Response.json({ status: 'queued', message_id: '550e8400-e29b-41d4-a716-446655440000', chat_id: 'test_chat', lead_id: 'test_chat', lead_created: false, convo_id: 'convo-1', phone_line_id: 'line-1' }, { status: 202 });
    return Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
  } });
  const cli = resolve(import.meta.dir, '../../dist/unified/cli.js');
  const run = async (args: string[], env: Record<string, string>) => {
    const child = Bun.spawn(['node', cli, ...args], { env: { PATH: process.env.PATH!, ...env }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = [await child.exited, await new Response(child.stdout).text(), await new Response(child.stderr).text()];
    return { code, json: JSON.parse(out || err) };
  };
  try {
    const sent = await run(['imessage', 'send', '--phone', '+61412345678', '--body', 'hi', '--idempotency-key', 'stable-key', '--confirm'], { CHERT_BASE_URL: server.url.origin, CHERT_API_KEY: 'imessage-key' });
    expect([sent.code, sent.json.projectId]).toEqual([0, null]);
    const ft = { CHERT_PROJECT_ID: '22000000-0000-4000-8000-000000000002', CHERT_FACETIME_TOKEN: 'ftk_project_api_key', CHERT_FACETIME_URL: server.url.origin };
    paths.length = 0;
    const status = await run(['facetime', 'status'], ft);
    expect([status.code, status.json.code]).toEqual([1, 'status_requires_cli_login']);
    expect(paths).toEqual([]);
    const lines = await run(['facetime', 'lines'], ft);
    expect([lines.code, lines.json.data.total]).toEqual([0, 0]);
    const context = await run(['context'], ft);
    expect(context.json.account.facetime.identity).toEqual({ error: 'requires_cli_login' });
    expect(context.json.account.facetime.lines.data.total).toBe(0);
    expect(paths).not.toContain('/api/v1/cli/whoami');
  } finally { server.stop(true); }
}, 30_000);
