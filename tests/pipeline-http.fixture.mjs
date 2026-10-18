import {textOperationFingerprint} from '../../imessage-server/lib/sending/text-operation-fingerprint.ts';
import {ChertClient} from '@chert/sdk';
import {isDeepStrictEqual} from 'node:util';
// Real strict reservation/transport and legacy sendFollowUp/mini-server/convo append.
// Only external auth, DB and device HTTP are substituted.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
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
let nativeStatusMode = 'pending';
let pipelineTransportMode = 'bridge';
const devicePosts = [];
const rpcAppends = [];
let failEventRecording = false;
const routeResponses = [];
let nativeQueries = 0;
const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://device.invalid' && url.pathname === '/api/v1/text-operations/v1') {
      assert.equal(init.method,'POST');const body=JSON.parse(init.body);const headers=new Headers(init.headers);
      assert.deepEqual(Object.keys(body).sort(),['from','origin','text','to']);assert.equal(body.from,line.phone_number);
      assert.equal(headers.get('authorization'),'Bearer test-device-key');const[,ts,hash]=headers.get('x-chert-signature').split(',');assert.equal(hash,createHmac('sha256',line.signing_secret).update(`${ts}.${init.body}`).digest('hex'));
      const row=tables.messaging_send_events.find(row=>row.id===body.origin.slice(5));assert.ok(row,'strict intent before native effect');assert.equal(row.response_payload.mac_text_dispatch_state,'reserved');assert.equal(row.phone,body.to);
      devicePosts.push({endpoint:url.pathname,body});return Response.json({origin:body.origin,from:body.from,to:body.to,fingerprint:textOperationFingerprint(body.from,body.to,body.text),preparedGuid:`aBcDeF01-2222-4333-8444-${String(devicePosts.length).padStart(12,'0')}`,state:'acknowledged'},{status:202});
    }
    if(url.origin==='https://device.invalid' && url.pathname.startsWith('/api/v1/text-operations/v1/')) { nativeQueries++;return Response.json({found:false},{status:404}); }
    if (url.origin === 'https://device.invalid' && url.pathname === '/send') {
      const body = JSON.parse(init.body);
      assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-device-key');
      devicePosts.push({ endpoint: url.pathname, body });
      if (pipelineTransportMode === 'bridge-dispatched-pending') return Response.json({
        success: true, message_id: 'msg_bridgeDispatched', guid: `aBcDeF01-2222-4333-8444-${String(devicePosts.length).padStart(12,'0')}`,
        delivered: false, delivery: { isSent: false, isDelivered: false, error: 0 },
      });
      if (pipelineTransportMode === 'bridge-queue') return Response.json({
        fallback_owner: 'none', status: 'pending', success: true, queued: true,
        message_id: 'msg_bridgePending', delivered: false,
        delivery: { isSent: false, isDelivered: false, error: 0 },
      }, { status: 202 });
      if (pipelineTransportMode === 'native-queue') return Response.json({ success: true, fallback_owner: 'native', message_id: 'msg_outboxA', status: 'pending', queued: true, service: 'imessage', delivered: false }, { status: 202 });
      return Response.json({ success: true, guid: `bridge-guid-${devicePosts.length}`, delivered: false, delivery: { isSent: true, isDelivered: false, error: 0 } });
    }
    if (url.origin === 'https://device.invalid' && url.pathname.startsWith('/api/v1/messages/')) {
      nativeQueries++;
      assert.ok(['/api/v1/messages/msg_outboxA', '/api/v1/messages/msg_bridgePending', '/api/v1/messages/msg_bridgeDispatched'].includes(url.pathname), 'only fixture-owned stored outbox IDs may be queried');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-device-key');
      if (['/api/v1/messages/msg_bridgePending', '/api/v1/messages/msg_bridgeDispatched'].includes(url.pathname)) return Response.json({ error: 'message not found' }, { status: 404 });
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
const tenant = { id: 'test-tenant', crm_project_id: 'test-project', auto_create_leads: false, phone_line_id: 'line-a',is_active:true,webhook_url:null,webhook_secret:null,outbound_consecutive_failures:0 };
const line = { id: 'line-a', project_id: 'test-project', phone_number: '+15550000001', status: 'active', health_status: 'healthy', server_url: 'https://device.invalid', api_key: 'test-device-key',signing_secret:'test-device-key',webhook_subscription_id:'native-sub-a' };
const lead = { id: 'chat-a', messaging_tenant_id: tenant.id, project_id: tenant.crm_project_id, number: '+15550000002', convo_id: 'convo-a', details: { phone_line_id: line.id }, name: 'Fixture', created_at: '2026-10-17T00:00:00Z' };
const tables = { phone_lines: [line, { ...line, id: 'other-line', project_id: 'other-project', phone_number: '+15550000009' }], leads: [lead], convo: [{ id: lead.convo_id, messages: [] }], messaging_send_events: [], messaging_tenants: [tenant],tenant_webhook_subscriptions:[],messaging_events:[],webhook_event_dedup:[] };
const valueAt=(row,key)=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]:row[key];
const contains=(actual,wanted)=>Array.isArray(wanted)?Array.isArray(actual)&&wanted.every(part=>actual.some(item=>contains(item,part))):wanted&&typeof wanted==='object'?actual&&typeof actual==='object'&&Object.entries(wanted).every(([key,value])=>contains(actual[key],value)):actual===wanted;
class Query {
  constructor(table) { this.table = table; this.filters = []; }
  select() { return this; }
  eq(key, value) { if(key==='delivery_attempts'){const expected=typeof value==='string'?JSON.parse(value):value;this.filters.push(row=>isDeepStrictEqual(row[key],expected));}else if(['response_payload','request_payload','details'].includes(key)&&typeof value==='string')this.filters.push(row=>isDeepStrictEqual(row[key],JSON.parse(value)));else this.filters.push(row => valueAt(row,key) === value); return this; }
  is(key, value) { this.filters.push(row => (row[key] ?? null) === value); return this; }
  filter(key, operator, value) {
    if (operator === 'eq') return this.eq(key, value);
    assert.equal(operator, 'cs');
    const wanted = JSON.parse(value);
    this.filters.push(row => contains(row[key],wanted));
    return this;
  }
  or(expression){const terms=expression.split(',').map(term=>term.split('.eq.'));this.filters.push(row=>terms.some(([key,value])=>valueAt(row,key)===value));return this;}
  neq(key,value){this.filters.push(row=>valueAt(row,key)!==value);return this;}
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  order(key) { this.sortKey = key; return this; }
  gt(key, value) { this.filters.push(row => row[key] > value); return this; }
  abortSignal() { return this; }
  limit(count) { this.cap = count; return this; }
  insert(value) { this.inserted = { id: `event-${tables.messaging_send_events.length + 1}`, ...(this.table==='messaging_events'?{delivery_attempts:[]}:{}), ...value }; return this; }
  update(value) { this.patch = value; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(onfulfilled, onrejected) {
    try {
      assert.ok(this.table in tables, `Unexpected DB table: ${this.table}`);
      if (this.inserted && this.table === 'messaging_send_events' && failEventRecording) return Promise.resolve({ data: null, error: { message: 'fixture record failure' } }).then(onfulfilled, onrejected);
      let rows;
      if(this.inserted&&['messaging_events','webhook_event_dedup'].includes(this.table)&&tables[this.table].some(row=>row.event_id===this.inserted.event_id&&(this.table!=='messaging_events'||row.tenant_id===this.inserted.tenant_id)))return Promise.resolve({data:null,error:{code:'23505'}}).then(onfulfilled,onrejected);
      if (this.inserted) { tables[this.table].push(this.inserted); rows = [this.inserted]; }
      else rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      if (this.patch) for (const row of rows) Object.assign(row, this.patch);
      if (this.sortKey) rows = rows.toSorted((a, b) => a[this.sortKey].localeCompare(b[this.sortKey]));
      if (this.cap) rows = rows.slice(0, this.cap);
      return Promise.resolve({ data: this.one ? rows[0] ?? null : rows, error: null,count:rows.length }).then(onfulfilled, onrejected);
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
mock.module(modulePath('lib/supabase-server'),()=>({createServerSupabase:()=>database}));
mock.module(modulePath('lib/sms/twilio-send'),()=>({sendSMS:async()=>{throw Error('SMS forbidden');}}));
mock.module(modulePath('lib/core/supabase'), () => ({ createServiceClient: () => database }));
async function authenticate(request) {
  assert.equal(request.headers.get('authorization'), 'Bearer local-test-key');
  return { ok: true, tenant, rawBody: await request.text() };
}
mock.module(modulePath('lib/api-shape/auth-bridge'), () => ({ authForChert: authenticate }));
mock.module(modulePath('lib/messaging/auth'), () => ({ authenticateRequest: authenticate }));
mock.module(modulePath('lib/messaging/mac-forward'), () => ({ forwardSignedJsonToMac: async () => { throw new Error('Group device dispatch must not execute'); } }));
const chats = await import(resolve(app, 'app/api/v1/chats/route.ts'));
const messages = await import(resolve(app, 'app/api/v1/chats/[id]/messages/route.ts'));
const strictText = await import(resolve(app,'app/api/v1/text-operations/v1/route.ts'));
const sends = await import(resolve(app, 'app/api/v1/send/route.ts'));
const messageStatus = await import(resolve(app, 'app/api/v1/messages/[id]/route.ts'));
const { NextRequest } = await import(resolve(root, 'sdk/tests/next-route-platform.mjs'));
const inbound = process.argv.includes('--require-outbound-observation') ? await import(resolve(app,'app/api/imessage/inbound/route.ts')) : null;
const callbacks=[];
const receiver=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const raw=await request.text();const body=JSON.parse(raw);const[,ts,signature]=request.headers.get('x-chert-signature').split(',');assert.equal(signature,createHmac('sha256','callback-secret').update(`${ts}.${raw}`).digest('hex'));assert.equal(body.event,'message_outbound_observed');assert.ok(tables.messaging_events.some(row=>row.event_id===body.event_id&&row.tenant_id===tenant.id),'durable event must precede callback');callbacks.push(body);return new Response(null,{status:204});
}});
if(inbound)tables.tenant_webhook_subscriptions.push({id:'callback-a',tenant_id:tenant.id,url:`http://127.0.0.1:${receiver.port}/callback`,secret:'callback-secret',events:['message_outbound_observed'],version:'2026-04-01',is_active:true,consecutive_failures:0});
const requests = [];
async function captureRoute(response) { const result = await response; routeResponses.push({ status: result.status, body: await result.clone().json() }); return result; }
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  requests.push({ path: new URL(request.url).pathname, headers: Object.fromEntries(request.headers) });
  const req = new NextRequest(request);
  const path = new URL(request.url).pathname;
  if(path==='/api/imessage/inbound'&&inbound)return inbound.POST(req);
  if (path === '/api/v1/chats') return captureRoute(chats.POST(req));
  if (path === '/api/v1/chats/chat-a/messages') return captureRoute(messages.POST(req, { params: Promise.resolve({ id: lead.id }) }));
  if (request.method === 'GET' && path.startsWith('/api/v1/messages/')) return messageStatus.GET(req, { params: Promise.resolve({ id: decodeURIComponent(path.slice('/api/v1/messages/'.length)) }) });
  if(path==='/api/v1/text-operations/v1')return captureRoute(strictText.POST(req));
  if (path === '/api/v1/send') return captureRoute(sends.POST(req));
  return new Response('Unexpected route', { status: 404 });
} });
try {
  const chert = { baseURL: `http://127.0.0.1:${server.port}`, apiKey: 'local-test-key' };
  const sendblue = new Sendblue({ chert });
  const linq = new Linq({ chert });
  const blooio = new Blooio({ chert });
  const blooioV4 = createBlooioV4Fetch({ chert });
  const cases = [];
  const modes = ['bridge', 'native-queue', ...(process.argv.includes('--require-bridge-queue') ? ['bridge-queue'] : []), ...(process.argv.includes('--require-bridge-dispatched-pending') ? ['bridge-dispatched-pending'] : [])];
  for (const mode of modes) {
    pipelineTransportMode = mode;
    if (mode === 'bridge-dispatched-pending') lead.details.sent_to_number = '+15550000003';
    else delete lead.details.sent_to_number;
    for (const adapter of ['sendblue', 'linq', 'blooio', 'blooio-v4','legacy-raw']) {
      if(mode==='bridge-dispatched-pending'&&!['sendblue','blooio'].includes(adapter))lead.details.sent_to_number='+15550000003';else delete lead.details.sent_to_number;
      const text = `actual-pipeline-${mode}-${adapter}`;
      const appendsBefore = rpcAppends.length;
      const postsBefore = devicePosts.length;
      let id, status;
      const eventsBefore = tables.messaging_send_events.length;
      try {
      if (adapter === 'sendblue') {
        const result = await sendblue.messages.send({ from_number: line.phone_number, number: lead.number, content: text });
        id = result.message_handle; status = result.status;
      } else if (adapter === 'linq') {
        const result = await linq.chats.messages.send(lead.id, { message: { parts: [{ type: 'text', value: text }] } });
        id = result.message.id; status = result.message.delivery_status;
      } else if (adapter === 'blooio-v4') {
        const response = await blooioV4(`https://api.blooio.com/v4/chats/${encodeURIComponent(lead.id)}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer vendor-secret' }, body: JSON.stringify({ text }),
        });
        assert.equal(response.status, 201);
        const result = await response.json(); id = result.id; status = result.status;
      } else if(adapter==='legacy-raw'){
        const result=await new ChertClient(chert).request('/send',{method:'POST',body:{phone:lead.number,body:text}});id=result.message_id;status=result.status;
      } else {
        const result = await blooio.messages.send({ to: lead.number, text });
        id = result.message_id; status = result.status;
      }
      } catch (error) {
        if (!['bridge-queue', 'bridge-dispatched-pending'].includes(mode)) throw error;
        assert.equal(devicePosts.length, postsBefore + 1);
        const response = routeResponses.at(-1);
      cases.push({ adapter, mode, queued_accepted: false, lookup_http_status: null, durable: false,
          http_status: response?.status ?? error.status ?? null,
          route_error: response?.body?.error ?? null,
          recorded_status: tables.messaging_send_events.length > eventsBefore ? tables.messaging_send_events.at(-1).status : null,
          native_outbox_id_recorded: tables.messaging_send_events.length > eventsBefore && !!tables.messaging_send_events.at(-1).response_payload?.mac_native_outbox_ids,
          convo_appended: rpcAppends.length > appendsBefore });
        continue;
      }
      assert.ok(id);
      const strict=adapter!=='legacy-raw';
      if (['sendblue', 'linq', 'blooio-v4'].includes(adapter)) {
        const actual = routeResponses.at(-1).body;
        const message = actual.message ?? actual.data?.message;
        assert.equal(message?.service, !strict && mode === 'native-queue' ? 'imessage' : 'unknown', 'creation response must not invent transport without native service evidence');
      }
      assert.equal(routeResponses.at(-1).body.actualRecipient, undefined, 'send HTTP response never exposes internal target metadata');
      assert.equal(routeResponses.at(-1).body.mac_message_guids, undefined, 'send HTTP response never exposes private GUID correlation');
      if (adapter === 'linq') assert.deepEqual(tables.messaging_send_events.find(row => row.id === id).request_payload, { message: { parts: [{ type: 'text', value: text }] } });
      assert.equal(devicePosts.length, postsBefore + 1, 'one SDK send makes exactly one native request');
      const nativePost = devicePosts.at(-1);
      assert.equal(nativePost.endpoint,strict?'/api/v1/text-operations/v1':'/send');
      assert.equal(nativePost.body.to,lead.details.sent_to_number??lead.number);
      assert.equal(tables.messaging_send_events.find(row=>row.id===id)?.phone,nativePost.body.to);
      if(strict){assert.equal(nativePost.body.text,text);assert.equal(nativePost.body.origin,'text_'+id);assert.equal(status,adapter==='sendblue'?'QUEUED':'queued');assert.equal(rpcAppends.length,appendsBefore);}
      else {
      assert.equal(tables.messaging_send_events.find(row => row.id === id)?.phone, nativePost.body.to, 'durable recipient must be frozen from the actual dispatch'); assert.equal(nativePost.body.message, text);
      assert.match(nativePost.body.idempotency_key, /^followup:chat-a:[0-9a-f]{16}:bubble-0$/);
      if (mode === 'bridge') {
        assert.equal(status, adapter === 'sendblue' ? 'SENT' : 'sent');
        assert.equal(rpcAppends.length, appendsBefore + 1);
        assert.equal(rpcAppends.at(-1).p_message.content, text);
        assert.equal(rpcAppends.at(-1).p_message.source, 'api');
      } else {
        assert.equal(status, adapter === 'sendblue' ? 'QUEUED' : 'queued');
        assert.equal(rpcAppends.length, appendsBefore, 'pending sends do not append a confirmed convo message');
        if (mode === 'native-queue') assert.equal(tables.messaging_send_events.find(row => row.id === id)?.response_payload.mac_native_outbox_ids[0], 'msg_outboxA');
        else {
          const payload = tables.messaging_send_events.find(row => row.id === id)?.response_payload;
          assert.equal(payload.mac_native_outbox_ids, undefined, 'bridge pending ownership must not be forged as native SMS ownership');
          assert.equal(payload.mac_bridge_outbox_ids[0], mode === 'bridge-dispatched-pending' ? 'msg_bridgeDispatched' : 'msg_bridgePending');
        }
      }
      }
      const correlation=tables.messaging_send_events.find(row=>row.id===id)?.response_payload?.mac_message_guids;
      if(strict||mode==='bridge-dispatched-pending')assert.deepEqual(correlation,[`aBcDeF01-2222-4333-8444-${String(devicePosts.length).padStart(12,'0')}`]);
      else assert.equal(correlation,undefined);
      const response = await fetch(`${chert.baseURL}/api/v1/messages/${id}`, { headers: { Authorization: 'Bearer local-test-key' } });
      const payload = await response.json();
      assert.equal(payload.actualRecipient, undefined, 'internal target is not a public response field');
      assert.equal(payload.mac_message_guids, undefined, 'native correlation remains internal send metadata');
      if (strict || mode !== 'bridge') { assert.equal(response.status, 200); assert.equal(payload.status, 'queued'); }
      if (adapter === 'legacy-raw' || adapter==='blooio') assert.equal(response.status, 200, '/send always records its returned event ID');
      if (adapter === 'blooio-v4') {
        const beforeStatus = devicePosts.length;
        const statusResponse = await blooioV4(`https://api.blooio.com/v4/chats/${lead.id}/messages/${id}/status`);
        assert.equal(statusResponse.status, 200);
        assert.deepEqual(await statusResponse.json(), { data: { id, status: !strict && mode === 'bridge' ? 'sent' : 'queued' } });
        const wrongChat = await blooioV4(`https://api.blooio.com/v4/chats/wrong-chat/messages/${id}/status`);
        assert.equal(wrongChat.status, 404);
        assert.equal((await wrongChat.json()).data, undefined);
        assert.equal(devicePosts.length, beforeStatus, 'v4 status lookups never send');
      }
        if(inbound&&mode==='bridge-dispatched-pending'){
        const nativeGUID=`aBcDeF01-2222-4333-8444-${String(devicePosts.length).padStart(12,'0')}`;
        const durable=tables.messaging_send_events.find(row=>row.id===id);assert.deepEqual(durable.response_payload.mac_message_guids,[nativeGUID]);
        const event={type:'message_sent_observed',event_id:`send-observed:${nativeGUID}`,ts:Math.floor(Date.now()/1000),phone_line_id:line.id,message:{guid:nativeGUID,recipient:nativePost.body.to,role:'outbound',is_group:false}};
        const postsBeforeObservation=devicePosts.length;const beforeCallbacks=callbacks.length;
        async function observe(payload){const raw=JSON.stringify(payload),ts=Math.floor(Date.now()/1000);return globalThis.fetch(`http://127.0.0.1:${server.port}/api/imessage/inbound`,{method:'POST',headers:{'x-webhook-subscription-id':line.webhook_subscription_id,'x-webhook-signature':`t=${ts},v1=${createHmac('sha256',line.signing_secret).update(`${ts}.${raw}`).digest('hex')}`},body:raw});}
        const savedGUIDs=durable.response_payload.mac_message_guids;delete durable.response_payload.mac_message_guids;
        assert.equal((await observe({...event,event_id:`missing-metadata:${nativeGUID}`})).status,200);assert.equal(callbacks.length,beforeCallbacks,'native observation without durable GUID metadata must not emit a public callback');durable.response_payload.mac_message_guids=savedGUIDs;
        const wrong={...event,event_id:`wrong:${nativeGUID}`,message:{...event.message,recipient:'+15550000099'}};
        const originalError=console.error;let ownershipErrors=0;console.error=(prefix,failure)=>{assert.equal(prefix,'[imessage/inbound] dispatch error:');assert.equal(failure.message,'Outbound observation send ownership mismatch');ownershipErrors++;};
        try{assert.equal((await observe(wrong)).status,500);}finally{console.error=originalError;}assert.equal(ownershipErrors,1);assert.equal(callbacks.length,beforeCallbacks);
        assert.equal((await observe(event)).status,200);assert.equal(callbacks.length,beforeCallbacks+1);const callback=callbacks.at(-1);assert.equal(callback.message_id,id);assert.equal(callback.chat_id,lead.id);assert.equal(callback.phone_line_id,line.id);assert.deepEqual(callback.observation,{source_event_type:event.type,source_event_id:event.event_id,source_time:new Date(event.ts*1000).toISOString(),recipient:nativePost.body.to,native_guid:nativeGUID});for(const key of ['status','sent','delivered'])assert.equal(Object.hasOwn(callback,key),false);assert.equal(durable.status,'processing');
        assert.equal((await observe(event)).status,200);assert.equal(callbacks.length,beforeCallbacks+1);assert.equal(devicePosts.length,postsBeforeObservation);
      }
      cases.push({ adapter, mode, protocol:strict?'strict-text':'legacy-send',queued_accepted: strict || mode !== 'bridge', lookup_status: payload.status, returned_id: id, lookup_http_status: response.status, durable: response.status === 200,
        native_sms_disabled_requested: nativePost.body.native_sms_disabled === true,
        device_reported_delivered: false,
        convo_delivered: rpcAppends.length > appendsBefore ? rpcAppends.at(-1).p_message.delivered : null,
        native_outbox_id_recorded: !!tables.messaging_send_events.find(row => row.id === id)?.response_payload.mac_native_outbox_ids,
        bridge_outbox_id_recorded: !!tables.messaging_send_events.find(row => row.id === id)?.response_payload.mac_bridge_outbox_ids,
        convo_appended: rpcAppends.length > appendsBefore,
        native_guid_correlated_in_convo: rpcAppends.length > appendsBefore && typeof rpcAppends.at(-1).p_message.guid === 'string' });
    }
  }
  const recordFailures = [];
  delete lead.details.sent_to_number; pipelineTransportMode = 'bridge'; failEventRecording = true;
  for (const [adapter, operation] of [
    ['sendblue', () => sendblue.messages.send({ from_number: line.phone_number, number: lead.number, content: 'record-failure-sendblue' })],
    ['linq', () => linq.chats.messages.send(lead.id, { message: { parts: [{ type: 'text', value: 'record-failure-linq' }] } })],
  ]) {
    const before = devicePosts.length;
    await assert.rejects(async () => await operation(), error => error.status === 500);
    assert.equal(devicePosts.length,before,'failed strict reservation must precede effect');
    assert.equal(routeResponses.at(-1).body.error.retryable, false);
    recordFailures.push({ adapter, http_status: routeResponses.at(-1).status, retryable: routeResponses.at(-1).body.error.retryable, native_attempts: devicePosts.length - before });
  }
  failEventRecording = false;
  console.log(JSON.stringify({ outbound_callbacks:callbacks.length, record_failures: recordFailures, scope: 'real SDK/routes/strict reservation+HMAC and legacy sendFollowUp/mini-server/native metadata/convo append; external auth/database/device HTTP substituted', native_endpoints: ['/send','/api/v1/text-operations/v1'], device_posts: devicePosts.length, rpc_appends: rpcAppends.length, cases }));
  if (process.argv.includes('--require-bridge-queue')) assert.ok(cases.filter(result => result.mode === 'bridge-queue' && result.protocol==='legacy-send').length === 1 && cases.filter(result => result.mode === 'bridge-queue' && result.protocol==='legacy-send').every(result => result.queued_accepted && result.durable && result.lookup_status === 'queued' && result.bridge_outbox_id_recorded && !result.native_outbox_id_recorded), 'Bridge pending acceptance must remain queued and durable without forging native SMS ownership');
  if (process.argv.includes('--require-bridge-dispatched-pending')) assert.ok(cases.filter(result => result.mode === 'bridge-dispatched-pending' && result.protocol==='legacy-send').length === 1 && cases.filter(result => result.mode === 'bridge-dispatched-pending' && result.protocol==='legacy-send').every(result => result.queued_accepted && result.durable && result.lookup_status === 'queued' && result.bridge_outbox_id_recorded && !result.native_outbox_id_recorded && !result.convo_appended), 'Actual legacy dispatched response without queued/status/owner must remain durable queued without claiming confirmed delivery or native ownership');
  if (process.argv.includes('--require-observed-delivery')) assert.ok(cases.every(result => result.convo_delivered !== true || result.device_reported_delivered === true), 'Conversation delivery cannot exceed observed native delivery');
  if (process.argv.includes('--require-durable-ids')) assert.ok(cases.every(result => result.durable), 'Every returned SDK message ID must be durable and readable; all repaired send paths must retain their returned IDs');
} finally { await server.stop(true);await receiver.stop(true);globalThis.fetch=fetch; }
