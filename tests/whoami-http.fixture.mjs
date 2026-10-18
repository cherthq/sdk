// Real official SDK, Chert whoami route and bearer/tenant auth; only DB substituted.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import Blooio, { AuthenticationError, NotFoundError } from '../packages/blooio-adapter/index.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = resolve(root, 'imessage-server');
await plugin({ name: 'actual-whoami-resolution', setup(build) {
  build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve(app, path.slice(2) + '.ts') }));
  build.onResolve({ filter: /^next\/server$/ }, () => ({ path: resolve(root, 'sdk/tests/next-route-platform.mjs') }));
} });
const tenant = { id: 'identity-tenant', tenant_slug: 'identity', signing_secret: 'synthetic-chert-key', is_active: true, requires_tenant_header: false, email: null, label: 'Synthetic', credit_balance: 11, leadgen_credit_balance: 22 };
let databaseReads = 0;
class Query {
  constructor() { this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  async maybeSingle() { databaseReads++; return { data: this.filters.every(filter => filter(tenant)) ? tenant : null, error: null }; }
}
mock.module(resolve(app, 'lib/core/supabase.ts'), () => ({ createServiceClient: () => ({ from(table) { assert.equal(table, 'messaging_tenants'); return new Query(); } }) }));
const whoami = await import(resolve(app, 'app/api/v1/whoami/route.ts'));
const { NextRequest } = await import(resolve(root, 'sdk/tests/next-route-platform.mjs'));
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init); const url = new URL(request.url);
  assert.equal(url.hostname, '127.0.0.1', 'no vendor, cloud or device access permitted');
  assert.equal(url.pathname, '/api/v1/whoami'); assert.equal(request.method, 'GET');
  assert.ok(!JSON.stringify([...request.headers]).includes('vendor-secret'));
  requests++; return originalFetch(input, init);
};
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) { return whoami.GET(new NextRequest(request)); } });
try {
  const config = { baseURL: `http://127.0.0.1:${server.port}`, apiKey: tenant.signing_secret, tenant: tenant.tenant_slug };
  const client = new Blooio({ apiKey: 'vendor-secret', defaultHeaders: { 'x-vendor-key': 'vendor-secret' }, chert: config });
  assert.deepEqual(await client.me.retrieve(), { valid: true });
  tenant.is_active = false;
  await assert.rejects(async () => await client.me.retrieve(), error => error instanceof NotFoundError && error.status === 404);
  tenant.is_active = true;
  const badKey = new Blooio({ chert: { ...config, apiKey: 'invalid-key' } });
  await assert.rejects(async () => await badKey.me.retrieve(), error => error instanceof AuthenticationError && error.status === 401);
  tenant.requires_tenant_header = true;
  const noSlug = new Blooio({ chert: { ...config, tenant: undefined } });
  await assert.rejects(async () => await noSlug.me.retrieve(), error => error instanceof AuthenticationError && error.status === 401);
  assert.equal(requests, 4, 'each identity call makes exactly one HTTP request');
  assert.equal(databaseReads, 4, 'real authentication resolves the synthetic tenant each time');
  console.log(JSON.stringify({ status: 'passed', verified: 'official SDK and real whoami/auth route over loopback', requests, mocked: ['database'] }));
} finally { await server.stop(true); globalThis.fetch = originalFetch; }
