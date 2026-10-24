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
    private: true, type: 'module', dependencies: { '@trychert/sdk': `file:${archive}` },
    devDependencies: { '@types/bun': '1.3.14' },
  }));
  await run(['bun', 'install', '--ignore-scripts']);
  const installed = join(temporary, 'node_modules/@trychert/sdk');
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@trychert/sdk');
  assert.equal(manifest.version, '0.2.0');
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
  const specifier = (path: string) => '@trychert/sdk' + (path === '.' ? '' : path.slice(1));
  writeFileSync(join(temporary, 'exports.mjs'), `
import assert from 'node:assert/strict';
import Client, { ChertClient, ChertAPIError, ChertControlPlane, ChertSDK } from '@trychert/sdk';
import { ChertClient as SubpathClient } from '@trychert/sdk/imessage';
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
const unifiedToken = 'chu_' + 'a'.repeat(43);
const unifiedProject = '11111111-1111-4111-8111-111111111111';
const unifiedRequests = [];
const receipt = {success:true,message_id:'a'.repeat(32),chat_id:'chat_fixture',status:'queued'};
const unified = await ChertSDK.connect({accessToken:unifiedToken,projectId:unifiedProject,fetch:async(url,init)=>{
  const headers = new Headers(init.headers);
  unifiedRequests.push(String(url));
  assert.equal(init.redirect,'error');
  if (String(url).endsWith('/sdk/capabilities')) {
    assert.equal(headers.has('Authorization'),false);
    return Response.json({data:{contract:'chert-unified',contract_version:1,
      auth:{scheme:'Bearer',token_prefix:'chu_',audience:'chert.unified-api:v1',login_url:'https://facetime.trychert.com/api/v1/cli/logins'},
      services:{imessage:{base_url:'https://console.trychert.com/api/v1'},facetime:{base_url:'https://facetime.trychert.com/api/v1'}},
      scopes:['imessage:events:read','imessage:webhooks:manage','imessage:messages:send','facetime:calls:read','facetime:calls:create','facetime:calls:control']}});
  }
  assert.equal(headers.get('Authorization'),'Bearer '+unifiedToken);
  assert.equal(headers.get('X-Chert-Contract'),'chert-unified-v1');
  assert.equal(headers.has('X-Chert-Tenant'),false);
  if (String(url).includes('console.')) {
    assert.equal(String(url),'https://console.trychert.com/api/v1/text-operations/v1');
    assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{phone:'+15555550123',body:'Hello',idempotency_key:'consumer'});
    return Response.json(receipt,{status:202,headers:{'X-Chert-Contract':'chert-unified-v1'}});
  }
  assert.equal(headers.get('X-Chert-Project-Id'),unifiedProject);
  return Response.json({data:{id:'call'}},{status:201,headers:{'X-Chert-Contract':'chert-unified-v1'}});
}});
assert.deepEqual(await unified.imessage.sendText({phone:'+15555550123',body:'Hello',idempotency_key:'consumer'}),receipt);
assert.equal((await unified.facetime.createCall({direction:'outbound',mode:'managed',assistant_id:'assistant',destination:'+15555550123',media:{audio:true,video:false}},'consumer-call')).id,'call');
assert.equal(unifiedRequests.length,3);
await assert.rejects(ChertSDK.connect({accessToken:unifiedToken,projectId:unifiedProject,fetch:async(_,init)=>{
  assert.equal(new Headers(init.headers).has('Authorization'),false);
  return new Response(null,{status:404});
}}),{code:'unsupported_unified_backend'});
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
  writeFileSync(join(temporary, 'distribution.mjs'), readFileSync(join(root, 'tests/distribution-smoke.mjs'), 'utf8').replaceAll('@cherthq/', '@trychert/sdk/'));
  for (const runtime of [['node'], ['bun'], ['deno', 'run', '--no-config', '--node-modules-dir=manual', '--allow-env', '--allow-read']]) {
    await run([...runtime, 'exports.mjs']);
    await run([...runtime, 'distribution.mjs']);
  }
  for (const runtime of ['node', 'bun']) {
    for (const bin of Object.values(manifest.bin)) await run([runtime, join(installed, String(bin)), '--help']);
    for (const channel of ['imessage', 'facetime', 'adopt']) await run([runtime, join(installed, manifest.bin['chert-sdk']), channel, '--help']);
  }
  await run(['bun', 'x', '--no-install', 'chert-sdk', '--help']);
  // Resolve every shipped declaration using both supported TS resolution modes.
  writeFileSync(join(temporary, 'consumer.ts'), subpaths.map((path, i) => `import * as api${i} from '${specifier(path)}';\nvoid api${i};`).join('\n') + `
import {ChertClient, verifyWebhook, type MessagingStreamFrame, type MessagingEventPage} from '@trychert/sdk';
async function events(client: ChertClient, signal: AbortSignal) {
  const page: MessagingEventPage = await client.listEvents({limit:2,cursor:'opaque'}, {signal});
  const secret: string = (await client.createWebhookSubscription({url:'https://receiver.example/events'})).subscription.secret;
  for await (const frame of client.streamEvents({since:'opaque',signal,reconnect:true})) {
    const event: MessagingStreamFrame = frame; void event; break;
  }
  return verifyWebhook(JSON.stringify(page), 'untrusted', secret);
}
void events;
import {ChertControlPlane} from '@trychert/sdk/facetime';
declare const billing: ChertControlPlane;
const status: boolean = (await billing.billingStatus()).shared_available;
const url: string = (await billing.createCheckout({plan:'dedicated'},'stable-key')).url;
// @ts-expect-error The obsolete preview catalog model is not a checkout request.
billing.createCheckout({plan_id:'shared',catalog_version:'2026-10-22'},'stable-key');
void status; void url;
import { ChertSDK, type CreateCall, type IncomingCallDecision, type IncomingCallWebhook, type AssistantConfig } from '@trychert/sdk';
const video: CreateCall = {direction:'outbound',mode:'customer_managed',line_id:'line',destination:'+61400000000',media:{audio:true,video:true},livekit_url:'wss://room.example',participant_token:'synthetic',remote_participant_identity:'agent'};
const managed: AssistantConfig = {instructions:'Help',openai:{provider:'openai',model:'gpt-realtime-2.1'},voice:{provider:'openai',voice_id:'marin'},interruption:{},escalation:{},video:{mode:'avatar',provider:'anam',avatar_id:'avatar'},inbound_policy:'auto_answer',media_defaults:{audio:true,video:true}};
async function example(client: ChertControlPlane, sdk: ChertSDK, incoming: IncomingCallWebhook): Promise<IncomingCallDecision> {
  const call = await sdk.facetime.createCall(video, 'stable-video-key');
  const observed: string | undefined = call.media_status.video;
  await client.updateAssistant('assistant', {expected_draft_revision:1,draft_config:managed});
  await client.endCall(call.id, 'stable-end-key');
  return incoming.data.media.video && observed === 'rendered' ? {action:'accept',livekit_url:'wss://room.example',participant_token:'synthetic',remote_participant_identity:'agent'} : {action:'decline'};
}
// @ts-expect-error Managed calls must not carry BYOR credentials.
const invalid: CreateCall = {...video,mode:'managed',assistant_id:'assistant'};
const audioOnly: CreateCall = {...video,media:{audio:true,video:false}};
const managedVideo: CreateCall = {direction:'outbound',mode:'managed',assistant_id:'assistant',destination:'person@example.com',media:{audio:false,video:true}};
// @ts-expect-error Customer-managed video requires audio.
const noAudio: CreateCall = {...video,media:{audio:false,video:true}};
// @ts-expect-error A call must request at least one medium.
const noMedia: CreateCall = {...managedVideo,media:{audio:false,video:false}};
void example; void invalid; void audioOnly; void managedVideo; void noAudio; void noMedia;
`);
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['ESNext', 'bundler']]) {
    await run(['bun', 'x', '--no-install', 'tsc', '--noEmit', '--strict', '--target', 'ES2022', '--module', module, '--moduleResolution', resolution, '--types', 'bun', 'consumer.ts']);
  }
  console.log('Isolated archive installation, exports, behavior, CLI and declaration checks passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
