import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const temporary = mkdtempSync(join(tmpdir(), 'chert-sdk-package-'));
async function run(args: string[], cwd = temporary) {
  const child = Bun.spawn(args, { cwd, stdout: 'inherit', stderr: 'inherit' });
  assert.equal(await child.exited, 0, args.join(' '));
}
try {
  const archive = process.env.CHERT_PACKAGE_ARCHIVE ?? join(temporary, 'sdk.tgz');
  if (!process.env.CHERT_PACKAGE_ARCHIVE) await run(['bun', 'pm', 'pack', '--ignore-scripts', '--filename', archive], root);
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies: { 'chert-sdk': `file:${archive}` },
    devDependencies: { '@types/bun': '1.3.14' },
  }));
  await run(['bun', 'install', '--ignore-scripts']);
  const installed = join(temporary, 'node_modules/chert-sdk');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'chert-sdk');
  assert.deepEqual(manifest.bin, { 'chert-sdk': './dist/unified/cli.js' });
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.ok(!existsSync(join(temporary, 'node_modules/@cherthq')));
  assert.ok(!existsSync(join(installed, 'dist/onboarding')));
  for (const version of Object.values(manifest.dependencies)) assert.ok(!String(version).includes('workspace:'));
  assert.ok(!existsSync(join(installed, 'packages')));
  assert.ok(!existsSync(join(installed, '.env')));
  for (const target of Object.values(manifest.exports)) {
    for (const path of typeof target === 'string' ? [target] : Object.values(target as Record<string, string>))
      assert.ok(existsSync(join(installed, path)), `Missing export ${path}`);
  }
  const subpaths = Object.keys(manifest.exports).filter(path => path !== './package.json');
  const portable = subpaths;
  const specifier = (path: string) => 'chert-sdk' + (path === '.' ? '' : path.slice(1));
  writeFileSync(join(temporary, 'exports.mjs'), `
import assert from 'node:assert/strict';
import Client, { ChertClient, ChertAPIError, ChertControlPlane, ChertSDK } from 'chert-sdk';
import { ChertClient as SubpathClient } from 'chert-sdk/imessage';
assert.equal(Client, ChertClient);
assert.equal(Client, SubpathClient);
assert.equal(typeof ChertAPIError, 'function');
assert.equal(typeof ChertControlPlane, 'function');
const sdk = new ChertSDK({ projectId: 'fixture-project', imessage: {baseURL: 'https://message.example', apiKey: 'fixture'}, facetime: {baseUrl: 'https://facetime.example', token: 'fixture'} });
assert.ok(sdk.imessage instanceof ChertClient);
assert.ok(sdk.facetime instanceof ChertControlPlane);
assert.ok(new ChertControlPlane());
const requests = [];
const intercept = async (url, init) => {
  requests.push({ url: String(url), headers: new Headers(init.headers), redirect: init.redirect });
  return Response.json({ data: {} });
};
const defaults = new ChertSDK({ projectId: 'project', imessage: { apiKey: 'message-key', fetch: intercept }, facetime: { token: 'face-token', fetch: intercept } });
await defaults.imessage.request('/whoami');
await defaults.facetime.whoami();
assert.deepEqual(requests.map(r => r.url), ['https://console.trychert.com/api/v1/whoami', 'https://facetime.trychert.com/api/v1/cli/whoami']);
assert.equal(requests[0].headers.get('Authorization'), 'Bearer message-key');
assert.equal(requests[0].headers.has('x-chert-project-id'), false);
assert.equal(requests[1].headers.get('Authorization'), 'Bearer face-token');
assert.equal(requests[1].headers.get('x-chert-project-id'), 'project');
for (const request of requests) assert.equal(request.redirect, 'error');
const billingRequests = [];
const billingReplies = [
  {entitlement:null,needs_reconciliation:false,sales_enabled:true,shared_available:true,dedicated_available:false},
  {url:'https://checkout.example/session'},
  {status:'cancellation_requested',message:'Refresh status'},
  {code:'EXAMPLE',percent_off:10,mode:'test',monthly_total:2250,currency:'usd'},
];
const billing = new ChertControlPlane({token:'user-fixture',projectId:'11111111-1111-4111-8111-111111111111',fetch:async(url,init)=>{
  billingRequests.push({url:String(url),method:init.method,headers:new Headers(init.headers),body:init.body ? JSON.parse(init.body) : undefined});
  return Response.json({data:billingReplies[billingRequests.length-1]});
}});
assert.deepEqual(await billing.billingStatus(),billingReplies[0]);
assert.deepEqual(await billing.createCheckout({plan:'dedicated',coupon_code:'EXAMPLE'},'checkout-key'),billingReplies[1]);
assert.deepEqual(await billing.cancelSubscription('cancel-key'),billingReplies[2]);
assert.deepEqual(await billing.validateCoupon('EXAMPLE','coupon-key'),billingReplies[3]);
assert.deepEqual(billingRequests.map(r=>r.body),[undefined,{action:'checkout',plan:'dedicated',coupon_code:'EXAMPLE'},{action:'cancel'},{action:'validate_coupon',coupon_code:'EXAMPLE'}]);
assert.deepEqual(billingRequests.map(r=>r.method),['GET','POST','POST','POST']);
for (const request of billingRequests) { assert.equal(request.url,'https://facetime.trychert.com/api/v1/billing'); assert.equal(request.headers.get('Authorization'),'Bearer user-fixture'); }
assert.deepEqual(billingRequests.slice(1).map(r=>r.headers.get('Idempotency-Key')),['checkout-key','cancel-key','coupon-key']);
for (const name of ${JSON.stringify(portable.map(specifier))}) assert.ok(Object.keys(await import(name)).length, name);
console.log('All portable unified exports loaded without workspace packages.');
`);
  // Reuse the existing behavioral distribution contract against the installed archive.
  writeFileSync(join(temporary, 'distribution.mjs'), readFileSync(join(root, 'tests/distribution-smoke.mjs'), 'utf8').replaceAll('@cherthq/', 'chert-sdk/'));
  for (const runtime of [['node'], ['bun'], ['deno', 'run', '--no-config', '--node-modules-dir=manual', '--allow-env', '--allow-read']]) {
    await run([...runtime, 'exports.mjs']);
    await run([...runtime, 'distribution.mjs']);
  }
  for (const runtime of ['node', 'bun']) {
    for (const bin of Object.values(manifest.bin)) await run([runtime, join(installed, String(bin)), '--help']);
    for (const channel of ['imessage', 'facetime', 'adopt']) await run([runtime, join(installed, manifest.bin['chert-sdk']), channel, '--help']);
  }
  // Resolve every shipped declaration using both supported TS resolution modes.
  writeFileSync(join(temporary, 'consumer.ts'), subpaths.map((path, i) => `import * as api${i} from '${specifier(path)}';\nvoid api${i};`).join('\n') + `
import {ChertControlPlane} from 'chert-sdk/facetime';
declare const billing: ChertControlPlane;
const status: boolean = (await billing.billingStatus()).shared_available;
const url: string = (await billing.createCheckout({plan:'dedicated'},'stable-key')).url;
// @ts-expect-error The obsolete preview catalog model is not a checkout request.
billing.createCheckout({plan_id:'shared',catalog_version:'2026-10-22'},'stable-key');
void status; void url;
`);
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'bundler']]) {
    await run(['bun', 'x', '--no-install', 'tsc', '--noEmit', '--strict', '--target', 'ES2022', '--module', module, '--moduleResolution', resolution, '--types', 'bun', 'consumer.ts']);
  }
  console.log('Isolated archive installation, exports, behavior, CLI and declaration checks passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
