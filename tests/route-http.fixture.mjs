import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
// Isolated process: real route code; only external auth, database and device dispatch are mocked.
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'bun:test';
import { plugin } from 'bun';
import Sendblue from '../packages/sendblue-adapter/index.ts';
import Linq from '../packages/linq-adapter/src/index.ts';
import Blooio from '../packages/blooio-adapter/index.ts';
import { createBlooioV4Fetch } from '../packages/blooio-v4-adapter/index.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = resolve(root, 'imessage-server');
const live = process.argv.includes('--live-reviewed-fixture') && process.env.CHERT_M4D_LIVE_CONFIG
  ? await import('../scripts/m4d-live-acceptance.mjs') : null;
const liveConfig = live ? live.parseLiveConfig(JSON.parse(process.env.CHERT_M4D_LIVE_CONFIG)) : null;
let nativeStatusMode = 'pending';
let nativeQueries = 0;
const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!live && url.origin === 'https://device.invalid' && url.pathname === '/api/v1/text-operations/v1') {
      assert.equal(init?.method,'POST');const headers=new Headers(init?.headers),raw=init.body,body=JSON.parse(raw);
      assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);
      assert.equal(headers.get('authorization'),'Bearer test-device-key');
      const signature=headers.get('x-chert-signature').split(',');
      assert.equal(signature[2],createHmac('sha256',line.api_key).update(`${signature[1]}.${raw}`).digest('hex'));
      const row=tables.messaging_send_events.find(row=>`text_${row.id}`===body.origin);
      assert.ok(row&&row.status==='processing','durable intent must precede dispatch');
      assert.equal(row.response_payload.mac_text_dispatch_state,'reserved');assert.equal(row.phone,body.to);
      dispatches.push({phoneLineId:line.id,message:body.text});
      if(mode==='uncertain')return Response.json({error:'unknown'},{status:502});
      const nativeGuid=`${row.id.slice(0,8)}-${row.id.slice(8,12)}-${row.id.slice(12,16)}-${row.id.slice(16,20)}-${row.id.slice(20)}`;
      return Response.json({origin:body.origin,from:body.from,to:body.to,fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:nativeGuid,state:'acknowledged'},{status:202});
    }
    if (!live && url.origin === 'https://device.invalid' && url.pathname.startsWith('/api/v1/message-evidence/')) {
      nativeQueries++;const guid=decodeURIComponent(url.pathname.split('/').at(-1));
      assert.ok(tables.messaging_send_events.some(row=>row.response_payload.mac_message_guids?.includes(guid)));
      return Response.json({evidence_source:'chat_db_exact_guid',guid,recipient:lead.number,sender:line.phone_number,service:'imessage',is_sent:false,is_delivered:false,is_read:false,has_attachments:false});
    }
    if (!live && url.origin === 'https://device.invalid' && url.pathname.startsWith('/api/v1/messages/')) {
      nativeQueries++;
      assert.equal(url.pathname, '/api/v1/messages/msg_outboxA', 'only the owned stored outbox ID may be queried');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-device-key');
      if (nativeStatusMode === 'unavailable') return Response.json({ error: 'message not found' }, { status: 404 });
      return Response.json({ fallback_owner: 'native', message_id: 'msg_outboxA',
        status: nativeStatusMode === 'delivered' ? 'sent' : nativeStatusMode,
        service: 'imessage', delivered: nativeStatusMode === 'delivered',
        ...(nativeStatusMode === 'failed' ? { error: 'fixture failure', sms_attempted: false } : {}),
      });
    }
    assert.equal(url.hostname, '127.0.0.1', 'integration fixture permits loopback HTTP only');
    return fetch(input, init);
  };
await plugin({ name: 'actual-route-resolution', setup(build) {
  build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve(app, path.slice(2) + '.ts') }));
  build.onResolve({ filter: /^next\/server$/ }, () => ({ path: resolve(root, 'sdk/tests/next-route-platform.mjs') }));
}});
const tenant = { id: 'test-tenant', crm_project_id: 'test-project', auto_create_leads: false, phone_line_id: 'line-a' };
const line = { id: 'line-a', project_id: 'test-project', phone_number: liveConfig?.from ?? '+15550000001', status: 'active', health_status: 'healthy', server_url: 'https://device.invalid', api_key: 'test-device-key' };
const lead = { id: 'chat-a', messaging_tenant_id: tenant.id, project_id: tenant.crm_project_id, number: liveConfig?.to ?? '+15550000002', convo_id: 'convo-a', details: { phone_line_id: line.id }, name: 'Fixture', created_at: '2026-10-17T00:00:00Z' };
const tables = { phone_lines: [line, { ...line, id: 'other-line', project_id: 'other-project', phone_number: '+15550000009' }], leads: [lead], convo: [{ id: lead.convo_id, messages: [] }], messaging_send_events: [], messaging_events: [], messaging_tenants: [tenant] };
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => ['response_payload','request_payload','details'].includes(key) && typeof value==='string' ? JSON.stringify(row[key])===value : row[key] === value); return this; }
  is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this; }
  filter(key, operator, value) {
    assert.equal(operator, 'cs');
    const wanted = JSON.parse(value);
    this.filters.push(row => Array.isArray(row[key]) && wanted.every(part => row[key].some(item => Object.entries(part).every(([name, value]) => item[name] === value))));
    return this;
  }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  order(key) { this.sortKey = key; return this; }
  gt(key, value) { this.filters.push(row => row[key] > value); return this; }
  abortSignal() { return this; }
  limit(count) { this.cap = count; return this; }
  insert(value) { this.inserted = { id: `event-${tables.messaging_send_events.length + 1}`, ...value }; return this; }
  update(value) { this.patch = value; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(onfulfilled, onrejected) {
    try {
      assert.ok(this.table in tables, `Unexpected DB table: ${this.table}`);
      let rows;
      if (this.inserted) { tables[this.table].push(this.inserted); rows = [this.inserted]; }
      else rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      if (this.patch) for (const row of rows) Object.assign(row, this.patch);
      if (this.sortKey) rows = rows.toSorted((a, b) => a[this.sortKey].localeCompare(b[this.sortKey]));
      if (this.cap) rows = rows.slice(0, this.cap);
      return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null }).then(onfulfilled, onrejected);
    } catch (error) { return Promise.reject(error).then(onfulfilled, onrejected); }
  }
}
const database = { from: table => new Query(table) };
const modulePath = path => resolve(app, path + '.ts');
mock.module(modulePath('lib/core/supabase'), () => ({ createServiceClient: () => database }));
async function authenticate(request) {
  assert.equal(request.headers.get('authorization'), 'Bearer local-test-key');
  return { ok: true, tenant, rawBody: await request.text() };
}
mock.module(modulePath('lib/api-shape/auth-bridge'), () => ({ authForChert: authenticate }));
mock.module(modulePath('lib/messaging/auth'), () => ({ authenticateRequest: authenticate }));
let mode = 'queued';
const dispatches = [];
mock.module(modulePath('lib/sending/follow-up-send'), () => ({ sendFollowUp: async args => {
  dispatches.push({ ...args, supabase: undefined });
  if (live) return live.dispatchM4D(args, liveConfig);
  if (mode === 'uncertain') return { ok: false, status: 502, body: { error: 'Unconfirmed device response', errorEnvelope: { code: 4103, message: 'Unconfirmed device response', retryable: false } } };
  return { ok: true, status: 200, body: { success: true, phoneLineId: line.id }, nativeSend: { pending: mode === 'queued', nativeDelivered: false, nativeService: 'imessage', mac_native_outbox_ids: ['msg_outboxA'] } };
} }));
mock.module(modulePath('lib/messaging/mac-forward'), () => ({ forwardSignedJsonToMac: async () => { throw new Error('Group device dispatch must not execute'); } }));
const chats = await import(resolve(app, 'app/api/v1/chats/route.ts'));
const messages = await import(resolve(app, 'app/api/v1/chats/[id]/messages/route.ts'));
const sends = await import(resolve(app, 'app/api/v1/send/route.ts'));
const strictSends = await import(resolve(app, 'app/api/v1/text-operations/v1/route.ts'));
const messageStatus = await import(resolve(app, 'app/api/v1/messages/[id]/route.ts'));
const { NextRequest } = await import(resolve(root, 'sdk/tests/next-route-platform.mjs'));
const requests = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  requests.push({ path: new URL(request.url).pathname, headers: Object.fromEntries(request.headers) });
  const req = new NextRequest(request);
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/chats') return chats.POST(req);
  if (path === '/api/v1/chats/chat-a/messages') return messages.POST(req, { params: Promise.resolve({ id: lead.id }) });
  if (request.method === 'GET' && path.startsWith('/api/v1/messages/')) return messageStatus.GET(req, { params: Promise.resolve({ id: decodeURIComponent(path.slice('/api/v1/messages/'.length)) }) });
  if (path === '/api/v1/send') return sends.POST(req);
  if (path === '/api/v1/text-operations/v1') return strictSends.POST(req);
  return new Response('Unexpected route', { status: 404 });
} });
try {
  const chert = { baseURL: `http://127.0.0.1:${server.port}`, apiKey: 'local-test-key' };
  if (live) {
    const report = await live.runLiveAdapters({ Sendblue, Linq, Blooio, createBlooioV4Fetch, chert }, liveConfig);
    console.log(JSON.stringify(report));
    if (!report.passed) process.exitCode = 1;
  } else {
  const sendblue = new Sendblue({ apiKey: 'vendor-secret', apiSecret: 'vendor-secret', chert });
  const input = { from_number: line.phone_number, number: lead.number, content: 'actual route fixture' };
  const queued = await sendblue.messages.send(input);
  assert.equal(queued.status, 'QUEUED'); assert.ok(queued.message_handle);
  assert.equal(tables.messaging_send_events.at(-1).status, 'processing');
  assert.equal(tables.messaging_send_events.at(-1).response_payload.status, 'queued');
  assert.equal(queued.from_number, line.phone_number);
  assert.equal(dispatches.at(-1).phoneLineId, line.id);
  mode = 'sent';
  const sent = await sendblue.messages.send(input);
  assert.equal(sent.status, 'QUEUED', 'strict native acknowledgement is never send evidence'); assert.equal(sent.date_updated, undefined);
  const linq = new Linq({ apiKey: 'vendor-secret', chert });
  const existing = await linq.chats.messages.send('chat-a', { message: { parts: [{ type: 'text', value: 'existing chat' }] } });
  assert.deepEqual(tables.messaging_send_events.find(row => row.id === existing.message.id).request_payload, { message: { parts: [{ type: 'text', value: 'existing chat' }] } });
  assert.equal(existing.message.delivery_status, 'queued'); assert.equal(dispatches.at(-1).phoneLineId, line.id);
  const beforeRejected = dispatches.length;
  await assert.rejects(async () => await sendblue.messages.send({ ...input, from_number: '+15550000009' }), error => error.status === 403);
  assert.equal(dispatches.length, beforeRejected);
  const blooio = new Blooio({ apiKey: 'vendor-secret', chert });
  mode = 'queued';
  const legacy = await blooio.messages.send({ to: lead.number, text: 'legacy route fixture' });
  assert.equal(legacy.status, 'queued'); assert.equal(legacy.message_id, tables.messaging_send_events.at(-1).id);
  const storedEvent = tables.messaging_send_events.find(event => event.id === legacy.message_id);
  const resetStatus = () => { storedEvent.status = 'processing'; storedEvent.response_payload = { status: 'queued', mac_native_outbox_ids: ['msg_outboxA'] }; };
  const sendsBeforeStatus = dispatches.length;
  for (const [native, expected] of [['pending', 'queued'], ['sent', 'sent'], ['delivered', 'delivered'], ['failed', 'failed'], ['unavailable', 'queued']]) {
    resetStatus(); nativeStatusMode = native;
    const before = nativeQueries;
    const status = await blooio.messages.getStatus(legacy.message_id);
    assert.equal(status.message_id, legacy.message_id); assert.equal(status.status, expected);
    assert.equal(nativeQueries, before + 1);
  }
  resetStatus(); nativeStatusMode = 'delivered';
  const retrieved = await blooio.messages.retrieve(legacy.message_id);
  assert.equal(retrieved.message_id, legacy.message_id); assert.equal(retrieved.status, 'delivered');
  assert.equal(retrieved.external_id, lead.number); assert.equal(retrieved.protocol, 'imessage');
  assert.equal(retrieved.time_sent, undefined); assert.equal(retrieved.direction, 'outbound');
  const sendblueStatus = await sendblue.messages.getStatus({ handle: legacy.message_id });
  assert.equal(sendblueStatus.message_handle, legacy.message_id); assert.equal(sendblueStatus.status, 'DELIVERED');
  assert.equal(sendblueStatus.number, lead.number); assert.equal(sendblueStatus.from_number, undefined);
  const sendblueRetrieved = await sendblue.messages.retrieve(legacy.message_id);
  assert.equal(sendblueRetrieved.data.message_handle, legacy.message_id); assert.equal(sendblueRetrieved.data.status, 'DELIVERED');
  assert.equal(sendblueRetrieved.data.date_updated, undefined); assert.equal(sendblueRetrieved.data.is_outbound, true);
  const queriesBeforeCached = nativeQueries;
  assert.equal((await blooio.messages.getStatus(legacy.message_id)).status, 'delivered');
  assert.equal(nativeQueries, queriesBeforeCached + 1, 'confirmed delivery survives while status reads still reconcile the exact native identity');
  nativeStatusMode = 'unavailable';
  const queriesBeforeOutage = nativeQueries;
  assert.equal((await blooio.messages.getStatus(legacy.message_id)).status, 'delivered', 'native outage must retain previously observed delivery');
  assert.equal(nativeQueries, queriesBeforeOutage + 1, 'cached delivery still reconciles only the exact owned native ID');
  tables.messaging_send_events.push({ ...storedEvent, id: 'foreign-event', tenant_id: 'foreign-tenant', response_payload: { status: 'queued', mac_native_outbox_ids: ['msg_foreign'] } });
  const beforeForeign = nativeQueries;
  await assert.rejects(async () => await blooio.messages.getStatus('foreign-event'), error => error.status === 404);
  await assert.rejects(async () => await sendblue.messages.getStatus({ handle: 'foreign-event' }), error => error.status === 404);
  await assert.rejects(async () => await sendblue.messages.retrieve('foreign-event'), error => error.status === 404);
  assert.equal(nativeQueries, beforeForeign, 'foreign tenant event is rejected before native query');
  assert.equal(dispatches.length, sendsBeforeStatus, 'status queries never send messages');
  nativeStatusMode = 'pending';
  const v4Response = await createBlooioV4Fetch({ chert })('https://api.blooio.com/v4/messages', {
    method: 'POST', body: JSON.stringify({ from: line.phone_number, to: lead.number, text: 'v4 route fixture' }),
  });
  assert.equal(v4Response.status, 201);
  const v4Body = await v4Response.json();
  assert.equal(v4Body.status, 'queued'); assert.equal(v4Body.chat_id, lead.id); assert.ok(v4Body.id);
  assert.equal(dispatches.at(-1).phoneLineId, line.id);
  const beforeV4Status = dispatches.length;
  const v4Status = await createBlooioV4Fetch({ chert })(`https://api.blooio.com/v4/chats/${lead.id}/messages/${v4Body.id}/status`);
  assert.equal(v4Status.status, 200); assert.deepEqual(await v4Status.json(), { data: { id: v4Body.id, status: 'queued' } });
  const v4WrongChat = await createBlooioV4Fetch({ chert })(`https://api.blooio.com/v4/chats/wrong-chat/messages/${v4Body.id}/status`);
  assert.equal(v4WrongChat.status, 404); assert.equal((await v4WrongChat.json()).data, undefined);
  assert.equal(dispatches.length, beforeV4Status);
  // A /send key must not replay its private transport payload through /chats.
  const replayKey = 'fixture-cross-endpoint-key';
  const replayRequest = { from: line.phone_number, to: [lead.number], message: { parts: [{ type: 'text', value: 'replay fixture' }], idempotency_key: replayKey } };
  const rawPost = (path, body) => fetch(`${chert.baseURL}${path}`, { method: 'POST', headers: { authorization: 'Bearer local-test-key', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const originalSend = await rawPost('/api/v1/send', { phone: lead.number, body: 'replay fixture', idempotency_key: replayKey });
  assert.equal(originalSend.status, 202);
  const originalEvent = tables.messaging_send_events.find(event => event.idempotency_key === replayKey && event.tenant_id === tenant.id);
  assert.deepEqual(originalEvent.response_payload.mac_native_outbox_ids, ['msg_outboxA']);
  originalEvent.response_payload.mac_bridge_outbox_ids = ['msg_privateBridge'];
  originalEvent.response_payload.mac_future_private = 'must-not-leak';
  const beforeReplay = dispatches.length;
  const crossReplay = await rawPost('/api/v1/chats', replayRequest);
  const crossBody = await crossReplay.json();
  assert.ok(!JSON.stringify(crossBody).includes('mac_'), 'cross-endpoint replay must not expose private outbox identities');
  assert.equal(crossReplay.status, 409, 'a /send response is not a /chats response');
  assert.equal(crossBody.error.retryable, false);
  assert.equal(dispatches.length, beforeReplay);
  // An exact, verifiable chat replay also strips future private mac_ fields.
  originalEvent.request_payload = replayRequest;
  originalEvent.response_payload = { chat: { id: lead.id }, message: { id: 'replayed-message', status: 'queued' }, mac_native_outbox_ids: ['msg_outboxA'], mac_bridge_outbox_ids: ['msg_privateBridge'], mac_future_private: 'must-not-leak', native_attachment_guids: ['private-attachment-guid'], native_caption_outbox_ids: ['private-caption-id'] };
  const validReplay = await rawPost('/api/v1/chats', replayRequest);
  assert.equal(validReplay.status, 200);
  assert.deepEqual(await validReplay.json(), { chat: { id: lead.id }, message: { id: 'replayed-message', status: 'queued' } });
  const mismatchReplay = await rawPost('/api/v1/chats', { ...replayRequest, message: { ...replayRequest.message, parts: [{ type: 'text', value: 'different intent' }] } });
  assert.equal(mismatchReplay.status, 409);
  const validResponsePayload = originalEvent.response_payload;
  originalEvent.response_payload = null;
  assert.equal((await rawPost('/api/v1/chats', replayRequest)).status, 409, 'an incomplete recorded attempt must not dispatch again');
  originalEvent.response_payload = validResponsePayload;
  assert.equal(dispatches.length, beforeReplay);
  // A foreign tenant's matching key cannot prevent this tenant's dispatch.
  originalEvent.tenant_id = 'foreign-tenant';
  const foreignReplay = await rawPost('/api/v1/chats', replayRequest);
  assert.equal(foreignReplay.status, 202);
  assert.equal(dispatches.length, beforeReplay + 1);
  mode = 'uncertain';
  for (const send of [() => sendblue.messages.send(input), () => linq.chats.messages.send('chat-a', { message: { parts: [{ type: 'text', value: 'uncertain' }] } }), () => blooio.messages.send({ to: lead.number, text: 'uncertain' })]) {
    const before = dispatches.length;
    const requestsBefore = requests.length;
    await assert.rejects(async () => await send(), error => error.status === 502 && String(error.error?.code ?? error.error?.error?.code) === '4103');
    assert.equal(dispatches.length, before + 1, 'uncertain outcome must never retry dispatch');
    assert.equal(requests.length, requestsBefore + 1, 'uncertain outcome must never retry HTTP');
  }
  for (const request of requests) assert.ok(!JSON.stringify(request.headers).includes('vendor-secret'));
  console.log(JSON.stringify({ verified: 'actual imported Chert routes over loopback HTTP', requests: requests.length, dispatches: dispatches.length, native_status_queries: nativeQueries, mocked: ['authentication', 'database', 'device dispatch', 'native status HTTP'], status: 'passed' }));
  }
} finally { await server.stop(true); }
