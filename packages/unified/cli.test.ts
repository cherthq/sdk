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
      const child = Bun.spawn(['node', resolve(import.meta.dir, '../../dist/unified/cli.js'), 'imessage', 'send', '--phone', '+61412345678', '--body', 'hello', '--idempotency-key', key], {
        env: { ...process.env, CHERT_PROJECT_ID: 'fixture', CHERT_BASE_URL: server.url.origin, CHERT_API_KEY: 'fixture' },
        stdout: 'pipe', stderr: 'pipe',
      });
      expect(await child.exited).toBe(exit);
      if (key === '') expect(requests).toEqual([]);
    }
    expect(requests).toEqual([{ phone: '+61412345678', body: 'hello', idempotency_key: 'stable-key' }]);
  } finally { server.stop(true); }
});
