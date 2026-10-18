// Real Chert typing route and HMAC forwarder; only auth/DB/device HTTP substituted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import { createBlooioV4Fetch } from '../packages/blooio-v4-adapter/index.ts';
import Linq from '../packages/linq-adapter/src/index.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = resolve(root, 'imessage-server');
await plugin({ name: 'actual-control-route-resolution', setup(build) {
  build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve(app, path.slice(2) + '.ts') }));
  build.onResolve({ filter: /^next\/server$/ }, () => ({ path: resolve(root, 'sdk/tests/next-route-platform.mjs') }));
} });
const tenant = { id: 'control-tenant', crm_project_id: 'control-project' };
const line = { id: 'line-a', project_id: tenant.crm_project_id, phone_number: '+15550000001', status: 'active', server_url: 'https://device.invalid', signing_secret: 'synthetic-signing-key', api_key: 'synthetic-device-key' };
const lead = { id: 'chat-a', project_id: tenant.crm_project_id, number: '+15550000002', messaging_tenant_id: tenant.id, details: { phone_line_id: line.id } };
const tables = { leads: [lead], phone_lines: [line] };
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  async maybeSingle() { assert.ok(this.table in tables); return { data: tables[this.table].find(row => this.filters.every(filter => filter(row))) ?? null, error: null }; }
}
mock.module(resolve(app, 'lib/core/supabase.ts'), () => ({ createServiceClient: () => ({ from: table => new Query(table) }) }));
mock.module(resolve(app, 'lib/api-shape/auth-bridge.ts'), () => ({ authForChert: async req => {
  assert.equal(req.headers.get('authorization'), 'Bearer local-control-key');
  return { ok: true, tenant, rawBody: await req.text() };
} }));
const typing = await import(resolve(app, 'app/api/v1/chats/[id]/typing/route.ts'));
const { NextRequest } = await import(resolve(root, 'sdk/tests/next-route-platform.mjs'));
const originalFetch = globalThis.fetch;
const nativeCalls = [];
let nativeStatus = 200;
let nativeBody = { ok: true, applied: true };
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init); const url = new URL(request.url);
  if (url.origin === 'https://device.invalid') {
    assert.equal(url.pathname, `/api/v1/chats/${lead.number}/typing`);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-device-key');
    const body = await request.text();
    const [version, timestamp, signature] = request.headers.get('x-chert-signature').split(',');
    assert.equal(version, 'v1'); assert.match(timestamp, /^\d+$/);
    assert.equal(signature, crypto.createHmac('sha256', line.signing_secret).update(`${timestamp}.${body}`).digest('hex'));
    const parsed = JSON.parse(body); assert.equal(parsed.from, line.phone_number); assert.equal(parsed.to, lead.number); assert.equal(typeof parsed.isTyping, 'boolean');
    assert.ok(!body.includes('vendor-secret')); nativeCalls.push(parsed);
    return Response.json(nativeStatus === 200 ? { chat_id: lead.number, from: line.phone_number, ...nativeBody } : { error: 'unsupported in bridge mode' }, { status: nativeStatus });
  }
  assert.equal(url.hostname, '127.0.0.1', 'fixture never contacts a real device or vendor');
  return originalFetch(input, init);
};
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const match = /^\/api\/v1\/chats\/([^/]+)\/typing$/.exec(new URL(request.url).pathname);
  assert.ok(match); assert.equal(request.method, 'POST');
  return typing.POST(new NextRequest(request), { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) });
} });
try {
  const chert = { baseURL: `http://127.0.0.1:${server.port}`, apiKey: 'local-control-key' };
  const v4 = createBlooioV4Fetch({ chert });
  const linq = new Linq({ apiKey: 'vendor-secret', chert });
  const operation = async (adapter, chat, on) => {
    if (adapter === 'v4') {
      const response = await v4(`https://api.blooio.com/v4/chats/${chat}/typing`, { method: on ? 'POST' : 'DELETE', headers: { Authorization: 'Bearer vendor-secret' } });
      const body = await response.json();
      if (!response.ok) return response.status;
      assert.deepEqual(body, { data: { chat_id: chat, state: on ? 'started' : 'stopped' } });
      return 200;
    }
    try { await (on ? linq.chats.typing.start(chat) : linq.chats.typing.stop(chat)); return 200; }
    catch (error) { return error.status; }
  };
  for (const adapter of ['v4', 'linq']) {
    for (const on of [true, false]) {
      const before = nativeCalls.length; assert.equal(await operation(adapter, lead.id, on), 200);
      assert.equal(nativeCalls.length, before + 1); assert.deepEqual(nativeCalls.at(-1), { to: lead.number, from: line.phone_number, isTyping: on });
    }
    const before = nativeCalls.length;
    lead.messaging_tenant_id = 'foreign-tenant'; assert.equal(await operation(adapter, lead.id, true), 404); lead.messaging_tenant_id = tenant.id;
    lead.details.phone_line_id = undefined; assert.equal(await operation(adapter, lead.id, true), 422); lead.details.phone_line_id = line.id;
    lead.details.is_group = true; lead.details.group_chat_guid = 'iMessage;+;synthetic-group';
    assert.equal(await operation(adapter, lead.id, true), 501); delete lead.details.is_group; delete lead.details.group_chat_guid;
    assert.equal(nativeCalls.length, before, 'invalid tenant/line/group never reaches native');
    for (const body of [
      { ok: true, applied: true, from: undefined },
      { ok: true, applied: false }, { ok: true }, { ok: true, applied: 1 },
      { ok: true, applied: 'true' }, { ok: false, applied: true }, { applied: true },
      { ok: true, applied: true, chat_id: 'foreign-target' },
    ]) {
      nativeBody = body;
      const attemptsBefore = nativeCalls.length;
      assert.equal(await operation(adapter, lead.id, true), 502, 'HTTP200 without explicit native application must not claim typing');
      assert.equal(nativeCalls.length, attemptsBefore + 1, 'unconfirmed application never retries');
    }
    nativeBody = { ok: true, applied: true };
    const beforeFailure = nativeCalls.length;
    nativeStatus = 501; assert.equal(await operation(adapter, lead.id, true), 501); nativeStatus = 200;
    assert.equal(nativeCalls.length, beforeFailure + 1, 'native failure is attempted once and never claimed applied');
  }
  console.log(JSON.stringify({ status: 'passed', verified: 'actual typing route and HMAC forwarder', native_attempts: nativeCalls.length, mocked: ['auth', 'database', 'native HTTP'] }));
} finally { await server.stop(true); globalThis.fetch = originalFetch; }
