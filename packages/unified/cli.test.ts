import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('CLI preserves keyed sends and rejects an explicit empty key before HTTP', async () => {
  const requests: unknown[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ success: true, message_id: 'a'.repeat(32), chat_id: 'test_chat', status: 'queued' }, { status: 202 });
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
    return Response.json({ success: true, message_id: 'a'.repeat(32), chat_id: 'test_chat', status: 'queued' }, { status: 202 });
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
  for (const command of [['login'], ['onboard'], ['facetim'], ['facetime', 'statsu'], ['facetime', 'lines', 'extra'], ['imessage', 'sned'], ['context', 'extra']]) {
    const env = { ...process.env }; delete env.CHERT_PROJECT_ID;
    const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), ...command], { env, stdout: 'pipe', stderr: 'pipe' });
    expect(await child.exited).toBe(1);
    expect(JSON.parse(await new Response(child.stderr).text())).toEqual({ error: 'Unknown command. Use --help.', code: 'unknown_command' });
  }
});
