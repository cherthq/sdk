import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
// Explicit opt-in child only; importing/running without its guard cannot reach a device.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { resolve, dirname, isAbsolute } from 'node:path';
import { accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import Blooio from '../packages/blooio-adapter/index.ts';
import Linq from '../packages/linq-adapter/src/index.ts';
import Sendblue from '../packages/sendblue-adapter/index.ts';
import { createBlooioV4Fetch } from '../packages/blooio-v4-adapter/index.ts';
import { validateConfig, providerForPlan, createReceipt, createBroker, remote, observationEvidence, assertLocalFixtureRequest } from '../scripts/m4d-live-pipeline.mjs';
const offline = process.argv[2] === '--offline-pipeline-contract';
const fault = offline ? process.argv[3] : undefined;
const allowedFaults = ['--failed-sdk-status', '--wrong-outbox-correlation', '--native-owner-correlation', '--wrong-route-id', '--wrong-language-body','--unsupported-live-text-protocol'];
if (fault !== undefined) assert.ok(allowedFaults.includes(fault));
const failedSDK = fault === '--failed-sdk-status';
assert.deepEqual(process.argv.slice(2), offline
  ? ['--offline-pipeline-contract', ...(fault ? [fault] : [])]
  : ['--reviewed-m4d-pipeline-child']);
const config = validateConfig(JSON.parse(process.env.CHERT_PIPELINE_CONFIG ?? 'null'));
const provider = providerForPlan(config);
const language = ['python', 'rust', 'cpp'].includes(provider);
const helper = provider === 'cpp' ? process.env.CHERT_PIPELINE_CPP_CLIENT : provider === 'rust' ? process.env.CHERT_PIPELINE_RUST_CLIENT : null;
if (language && provider !== 'python') {
  assert.ok(helper && isAbsolute(helper), 'explicit absolute language helper required before attempt');
  accessSync(helper, constants.X_OK);
}
const routePath = language ? '/api/v1/send' : provider==='blooio'?'/api/v1/text-operations/v1': ['sendblue', 'blooio-v4'].includes(provider) ? '/api/v1/chats' : '/api/v1/chats/chat-a/messages';
const journal = createReceipt(process.env.CHERT_PIPELINE_RECEIPT, config, true);
journal.save({ environment: offline ? 'offline-contract' : 'reviewed-live' });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = resolve(root, 'imessage-server');
const realFetch = globalThis.fetch;
const execute = offline ? async payload => {
  assert.equal(payload.action, 'send');
  return { status: 200, body: { success: true, message_id: 'msg_OFFLINE', guid: '23C408BF-2EE4-4B46-9DF3-A8383597FBBE', delivered: false, delivery: { isSent: false, isDelivered: false, error: 0 } } };
} : remote;
const broker = createBroker(config, journal, execute);
let localOrigin = null;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === 'https://device.invalid' && url.pathname === '/api/v1/text-operations/v1') {
    // Historical live broker only authorizes /send. New protocol requires a new review;
    // refuse BEFORE spending the attempt or calling any device/SSH executor.
    assert.equal(offline && fault!=='--unsupported-live-text-protocol',true,'Strict text live protocol is not authorized by the historical plan');
    assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
    const headers=new Headers(init.headers),body=JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);assert.equal(body.from,config.from);assert.equal(body.to,config.to);assert.equal(body.text,config.marker);
    assert.equal(headers.get('authorization'),'Bearer fixture-device-key');
    const[,ts,hash]=headers.get('x-chert-signature').split(',');assert.equal(hash,createHmac('sha256','fixture-device-key').update(`${ts}.${init.body}`).digest('hex'));
    const intent=tables.messaging_send_events.find(row=>row.id===body.origin.slice(5));assert.ok(intent,'reserved identity before effect');assert.equal(intent.response_payload.mac_text_dispatch_state,'reserved');assert.equal(intent.phone,config.to);assert.equal(intent.phone_line_id,line.id);
    assert.equal(journal.receipt.attempted,false);journal.save({attempted:true,outcome:'offline-strict-attempt-recorded-before-ack',native:{http_status:202,origin:body.origin,prepared_guid:'23C408BF-2EE4-4B46-9DF3-A8383597FBBE',state:'acknowledged'}});
    return Response.json({origin:body.origin,from:body.from,to:body.to,fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:'23C408BF-2EE4-4B46-9DF3-A8383597FBBE',state:'acknowledged'},{status:202});
  }
  if (url.origin === 'https://device.invalid') return broker(input, init);
  assertLocalFixtureRequest(input, init, localOrigin, routePath);
  return realFetch(input, init);
};
await plugin({ name: 'live-pipeline-local-routes', setup(build) {
  build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve(app, path.slice(2) + '.ts') }));
  build.onResolve({ filter: /^next\/server$/ }, () => ({ path: resolve(root, 'sdk/tests/next-route-platform.mjs') }));
}});
const tenant = { id: 'fixture-tenant', crm_project_id: 'fixture-project', auto_create_leads: false, phone_line_id: 'line-a' };
const line = { id: 'line-a', project_id: tenant.crm_project_id, phone_number: config.from, status: 'active', health_status: 'healthy', server_url: 'https://device.invalid', api_key: 'fixture-device-key' };
const lead = { id: 'chat-a', messaging_tenant_id: tenant.id, project_id: tenant.crm_project_id, number: config.to, convo_id: 'convo-a', details: { phone_line_id: line.id }, name: 'Synthetic acceptance', created_at: new Date().toISOString() };
const tables = { phone_lines: [line], leads: [lead], convo: [{ id: lead.convo_id, messages: [] }], messaging_send_events: [], messaging_tenants: [tenant] };
const rpcAppends = [];
const failEventRecording = false;
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => ['response_payload','request_payload','details'].includes(key)&&typeof value==='string'?isDeepStrictEqual(row[key],JSON.parse(value)):row[key] === value); return this; }
  is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this; }
  filter(key, operator, value) {
    assert.equal(operator, 'cs');
    const wanted = JSON.parse(value);
    this.filters.push(row => Array.isArray(row[key]) && wanted.every(part => row[key].some(item => Object.entries(part).every(([name, value]) => item[name] === value))));
    return this;
  }
  limit(count) { this.cap = count; return this; }
  insert(value) { this.inserted = { id: `event-${tables.messaging_send_events.length + 1}`, ...value }; return this; }
  update(value) { this.patch = value; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(onfulfilled, onrejected) {
    try {
      assert.ok(this.table in tables, `Unexpected DB table: ${this.table}`);
      if (this.inserted && this.table === 'messaging_send_events' && failEventRecording) return Promise.resolve({ data: null, error: { message: 'fixture record failure' } }).then(onfulfilled, onrejected);
      let rows;
      if (this.inserted) { tables[this.table].push(this.inserted); rows = [this.inserted]; }
      else rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      if (this.patch) for (const row of rows) Object.assign(row, this.patch);
      if (this.cap) rows = rows.slice(0, this.cap);
      return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(onfulfilled, onrejected);
    } catch (error) { return Promise.reject(error).then(onfulfilled, onrejected); }
  }
}
const database = {
  from: table => new Query(table),
  async rpc(name, parameters) {
    assert.equal(name, 'append_convo_message');
    const convo = tables.convo.find(row => row.id === parameters.p_convo_id);
    assert.ok(convo, 'append targets an existing fixture conversation');
    assert.ok(parameters.p_idempotency_key);
    rpcAppends.push(parameters);
    convo.messages.push(parameters.p_message);
    return { data: null, error: null };
  },
};
const modulePath = path => resolve(app, path + '.ts');
mock.module(modulePath('lib/core/supabase'), () => ({ createServiceClient: () => database }));
async function authenticate(request) {
  assert.equal(request.headers.get('authorization'), 'Bearer fixture-local-key');
  return { ok: true, tenant, rawBody: await request.text() };
}
mock.module(modulePath('lib/messaging/auth'), () => ({ authenticateRequest: authenticate }));
mock.module(modulePath('lib/api-shape/auth-bridge'), () => ({ authForChert: authenticate }));
// sendFollowUp, mini-server and appendConvoMessage are intentionally NOT mocked.
const strictText=await import(resolve(app,'app/api/v1/text-operations/v1/route.ts'));
const sends = await import(resolve(app, 'app/api/v1/send/route.ts'));
const chatMessages = await import(resolve(app, 'app/api/v1/chats/[id]/messages/route.ts'));
const chats = await import(resolve(app, 'app/api/v1/chats/route.ts'));
const { NextRequest } = await import(resolve(root, 'sdk/tests/next-route-platform.mjs'));
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  try { assertLocalFixtureRequest(request, undefined, localOrigin, routePath); }
  catch { return Response.json({error:'unreviewed fixture request'}, {status:400}); }
  if (language) {
    let input;
    try { input = await request.clone().json(); }
    catch { return Response.json({error:'unreviewed fixture request'}, {status:400}); }
    if (request.headers.get('authorization') !== 'Bearer fixture-local-key'
      || !input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== 'body,phone'
      || input.phone !== config.to || input.body !== config.marker)
      return Response.json({error:'unreviewed fixture request'}, {status:400});
  }
  const req = new NextRequest(request);
  const response = language ? await sends.POST(req) : provider==='blooio'?await strictText.POST(req): ['sendblue', 'blooio-v4'].includes(provider) ? await chats.POST(req)
    : await chatMessages.POST(req, { params: Promise.resolve({ id: lead.id }) });
  const body = await response.clone().json();
  const id = body.message_id ?? body.message?.id;
  const status = body.status ?? body.message?.status;
  journal.save({ route: { path: routePath, http_status: response.status, message_id: typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null,
    status: ['queued', 'pending', 'sent', 'failed'].includes(status) ? status : null } });
  // Offline-only fault at the local HTTP boundary, after the actual route ran.
  if (failedSDK) return Response.json(body.message ? { ...body, message: { ...body.message, status: 'failed' } } : { ...body, status: 'failed' }, { status: response.status });
  return response;
} });
localOrigin = `http://127.0.0.1:${server.port}`;
const python = String.raw`
import json,re,sys
from urllib.parse import urlsplit
from chert import ChertClient,ChertAPIError
assert len(sys.argv)==3 and sys.argv[1]=='--one-reviewed-pipeline-send'
u=urlsplit(sys.argv[2])
assert re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}',sys.argv[2]) and u.port<=65535
raw=sys.stdin.buffer.read(16385)
assert len(raw)<=16384
b=json.loads(raw)
assert set(b)=={'phone','body'} and re.fullmatch(r'\+[1-9]\d{1,14}',b['phone'])
assert re.fullmatch(r'CHERT-M4D-PIPELINE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-python',b['body'])
try:
 data=ChertClient(sys.argv[2],'fixture-local-key',timeout=45).request('/send',method='POST',body=b)
 print(json.dumps({'ok':True,'data':data}))
except ChertAPIError as e:
 print(json.dumps({'ok':False,'status':e.status,'code':e.code,'display':str(e)}))
`;
async function languageSend() {
 const command = provider === 'python' ? ['python3','-c',python] : [helper];
 const child = Bun.spawn([...command,'--one-reviewed-pipeline-send',localOrigin], {
  stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{...process.env,PYTHONPATH:resolve(root,'sdk/python')},
 });
 const timer=setTimeout(()=>child.kill(),60000);
 const bounded = async stream => {
  const reader=stream.getReader();const chunks=[];let size=0;
  for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){child.kill();throw new Error('Language evidence exceeds limit');}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
 };
 child.stdin.write(JSON.stringify({phone:fault === '--wrong-language-body' ? '+15550000003' : config.to,body:config.marker}));child.stdin.end();
 try {
  const [code,stdout,stderr]=await Promise.all([child.exited,bounded(child.stdout),bounded(child.stderr)]);
  assert.equal(code,0,'language evidence unavailable; never resend');assert.equal(stderr,'','language evidence unavailable; never resend');
  const result=JSON.parse(stdout);
  if(result.ok!==true)throw Object.assign(new Error('Language send outcome unconfirmed'),{status:Number.isInteger(result.status)?result.status:undefined});
  assert.ok(result.data && typeof result.data==='object' && !Array.isArray(result.data));return result.data;
 } finally {clearTimeout(timer);}
}
try {
  let sdk = null;
  try {
    const chert = { baseURL: `http://127.0.0.1:${server.port}`, apiKey: 'fixture-local-key' };
    let id, status;
    if (language) {
      const result = await languageSend(); id = result.message_id; status = result.status;
    } else if (provider === 'blooio') {
      const result = await new Blooio({ chert }).messages.send({ to: config.to, text: config.marker });
      id = result.message_id; status = result.status;
    } else if (provider === 'linq') {
      const result = await new Linq({ chert }).chats.messages.send(lead.id, { message: { parts: [{ type: 'text', value: config.marker }] } });
      id = result.message.id; status = result.message.delivery_status;
    } else if (provider === 'sendblue') {
      const result = await new Sendblue({ chert }).messages.send({ from_number: config.from, number: config.to, content: config.marker });
      id = result.message_handle;
      status = { QUEUED: 'queued', SENT: 'sent', DELIVERED: 'delivered', ERROR: 'failed' }[result.status];
    } else {
      const response = await createBlooioV4Fetch({ chert })('https://api.blooio.com/v4/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.from, to: config.to, text: config.marker }),
      });
      if (response.status !== 201) throw Object.assign(new Error('v4 send outcome unconfirmed'), { status: response.status });
      const result = await response.json(); id = result.id; status = result.status;
    }
    sdk = { message_id: typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null,
      status: ['pending', 'queued', 'sent', 'delivered', 'failed'].includes(status) ? status : null };
    journal.save({ sdk });
  } catch (error) {
    journal.save({ sdk: { http_status: Number.isInteger(error.status) ? error.status : null, outcome: 'unconfirmed-no-resend' } });
  }
  // Offline-only corruption after the actual route/SDK ran; never enabled by live flags.
  const faultEvent = tables.messaging_send_events.find(row => row.id === sdk?.message_id);
  if (faultEvent && fault === '--wrong-outbox-correlation') {if(['blooio','linq','sendblue','blooio-v4'].includes(provider))faultEvent.response_payload.mac_message_guids=['550e8400-e29b-41d4-a716-446655440000'];else faultEvent.response_payload.mac_bridge_outbox_ids=['msg_WRONG'];}
  if (faultEvent && fault === '--native-owner-correlation') faultEvent.response_payload.mac_native_outbox_ids = [journal.receipt.native.message_id];
  if (fault === '--wrong-route-id') journal.save({ route: { ...journal.receipt.route, message_id: 'wrong-event' } });
  journal.save({ local_database: { event_count: tables.messaging_send_events.length,
    event_statuses: tables.messaging_send_events.map(row => ['processing', 'ok', 'dedup', 'sent', 'failed'].includes(row.status) ? row.status : 'unknown'),
    append_count: rpcAppends.length, append_delivered: rpcAppends.map(row => row.p_message.delivered === true),
    returned_id_persisted: !!sdk?.message_id && tables.messaging_send_events.some(row => row.id === sdk.message_id) } });
  const strictOffline=offline && ['linq','sendblue','blooio-v4','blooio'].includes(provider);
  let observation = strictOffline ? {complete:true,exact_prepared_guid:'23C408BF-2EE4-4B46-9DF3-A8383597FBBE',service:'iMessage',is_from_me:false} : { complete: false, reason: 'no-valid-native-id' };
  if (/^msg_[A-Za-z0-9]+$/.test(journal.receipt.native?.message_id ?? '')) {
    try {
      observation = offline ? { complete: true, exact_outbox_id: 'msg_OFFLINE', guid: '23C408BF-2EE4-4B46-9DF3-A8383597FBBE', service: 'iMessage', is_from_me: false } : await remote({ action: 'observe', from: config.from, to: config.to, marker: config.marker,
        message_id: journal.receipt.native.message_id, guid: journal.receipt.native.guid,
        idempotency_key: journal.receipt.native_idempotency_key }, 90000);
    } catch { observation = { complete: false, reason: 'observation-unavailable-no-resend' }; }
  }
  if(!strictOffline) observation = observationEvidence(observation);
  journal.save({ recipient: observation });
  const persisted = tables.messaging_send_events.find(row => row.id === sdk?.message_id);
  const bridgeIDs = persisted?.response_payload?.mac_bridge_outbox_ids;
  const correlation = {
    sdk_route_match: !!sdk?.message_id && journal.receipt.route?.message_id === sdk.message_id,
    ...(strictOffline?{exact_prepared_guid:Array.isArray(persisted?.response_payload?.mac_message_guids)&&persisted.response_payload.mac_message_guids.length===1&&persisted.response_payload.mac_message_guids[0]===journal.receipt.native.prepared_guid}:{exact_bridge_id: Array.isArray(bridgeIDs) && bridgeIDs.length === 1 && bridgeIDs[0] === journal.receipt.native?.message_id}),
    native_ownership_absent: persisted?.response_payload?.mac_native_outbox_ids === undefined,
  };
  journal.save({ correlation });
  // Durable evidence is already on disk before evaluating acceptance assertions.
  assert.equal(journal.receipt.attempted, true);
  assert.ok(sdk?.message_id, 'SDK outcome unconfirmed; never resend');
  assert.ok(['pending', 'queued', 'sent', 'delivered'].includes(sdk.status), 'SDK did not report successful acceptance; never resend');
  assert.ok(journal.receipt.route?.http_status >= 200 && journal.receipt.route.http_status < 300, 'route did not accept the attempt');
  assert.ok(persisted && ['processing', 'ok'].includes(persisted.status), 'successful durable event missing');
  assert.equal(correlation.sdk_route_match, true, 'SDK and route event IDs differ');
  assert.equal(strictOffline?correlation.exact_prepared_guid:correlation.exact_bridge_id,true,'durable event lost actual native identity');
  assert.equal(correlation.native_ownership_absent, true, 'bridge event incorrectly claims native SMS ownership');
  assert.equal(observation.complete, true, 'exact native outbox GUID / recipient iMessage evidence incomplete; never resend');
  if(strictOffline)assert.equal(observation.exact_prepared_guid,journal.receipt.native.prepared_guid);else assert.equal(observation.exact_outbox_id, journal.receipt.native.message_id);
  assert.equal(observation.service, 'iMessage');
  assert.equal(observation.is_from_me, false);
  assert.ok(strictOffline?observation.exact_prepared_guid:observation.guid);
  journal.save({ passed: true, outcome: offline ? 'offline-contract-only' : 'exact-guid-recipient-imessage-confirmed' });
  console.log(JSON.stringify({ status: 'passed', receipt: journal.path, attempts: 1 }));
} catch {
  journal.save({ passed: false, outcome: 'acceptance-incomplete-no-resend' });
  console.error(JSON.stringify({ status: 'incomplete', receipt: journal.path, action: 'reconcile existing native ID; do not rerun' }));
  process.exitCode = 1;
} finally {
  server.stop(true); globalThis.fetch = realFetch; journal.close();
}
