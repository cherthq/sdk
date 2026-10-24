import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ChertClient, ChertAPIError, verifyWebhook } from '@cherthq/imessage';
import Linq from '@cherthq/linq-adapter';
import Sendblue, { unwrapChert, createSendblueReactionFetch } from '@cherthq/sendblue-adapter';
import Blooio from '@cherthq/blooio-adapter';

// Run the shipped stream parser and signature verifier on all supported runtimes.
{
  const record = { id: 'row', event_id: 'producer', type: 'message.received', payload: { text: 'hello 🌍' } };
  let cancelled = false;
  const client = new ChertClient({ apiKey: 'event-only', fetch: async (url, init) => {
    assert.equal(new URL(url).searchParams.get('since'), 'opaque|cursor');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer event-only');
    assert.equal(init.redirect, 'error');
    const bytes = new TextEncoder().encode(': heartbeat\r\n\r\ndata: ' + JSON.stringify(record) + '\r\n\r\n');
    let i = 0;
    return new Response(new ReadableStream({
      pull(controller) { if (i < bytes.length) controller.enqueue(bytes.slice(i, ++i)); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  for await (const frame of client.streamEvents({ since: 'opaque|cursor' })) {
    assert.deepEqual(frame, { event: 'message', data: record }); break;
  }
  assert.equal(cancelled, true);
  const raw = JSON.stringify(record), timestamp = Math.floor(Date.now() / 1000), secret = 'synthetic';
  const signature = 'v1,' + timestamp + ',' + createHmac('sha256', secret).update(timestamp + '.' + raw).digest('hex');
  assert.equal(await verifyWebhook(raw, signature, secret), true);
  assert.equal(await verifyWebhook(raw + ' ', signature, secret), false);
  console.log('Built messaging SSE and raw webhook verification passed.');
}

// Keep video behavior in the portable and exact-installed-artifact gates.
{
  const { ChertControlPlane } = await import('@cherthq/control-plane');
  const calls = [];
  const client = new ChertControlPlane({ token: 'video-only', projectId: 'project', fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ data: { id: 'call', media_status: { video: 'rendered' } } }, { status: 201 });
  } });
  const input = { direction: 'outbound', mode: 'customer_managed', line_id: 'line', destination: '+61400000000',
    media: { audio: true, video: true }, livekit_url: 'wss://room.example', participant_token: 'synthetic', remote_participant_identity: 'agent' };
  assert.equal((await client.createCall(input, 'portable-video-key')).media_status.video, 'rendered');
  await client.endCall('call', 'portable-end-key');
  assert.deepEqual(calls.map(c => c.url), ['https://facetime.trychert.com/api/v1/calls', 'https://facetime.trychert.com/api/v1/calls/call/end']);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
  assert.deepEqual(JSON.parse(calls[1].init.body), {});
  for (const { init } of calls) {
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer video-only');
    assert.equal(init.headers['x-chert-project-id'], 'project');
  }
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'portable-video-key');
  console.log('Built FaceTime video API preserves default routing, credentials, media and explicit end.');
}

// Exercise the built reaction API under each supported runtime, including
// identity preservation and a response that must never become acceptance.
{
  const chat = 'a1111111-b222-c333-d444-e55555555555', message = 'Msg:CASE';
  const ack = { operation_id: 'e'.repeat(32), chat_id: chat, message_id: message, status: 'acknowledged' };
  let requests = 0, malformed = false;
  const client = new ChertClient({ baseURL: 'https://chert.example', apiKey: 'reaction-only', fetch: async (input, init) => {
    const request = new Request(input, init); requests++;
    assert.equal(request.url, `https://chert.example/api/v1/chats/${chat}/messages/Msg%3ACASE/reactions`);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer reaction-only');
    assert.equal(request.headers.get('idempotency-key'), malformed ? null : 'key  with spaces');
    assert.deepEqual(await request.json(), { reaction: 'like', remove: true, part_index: 0 });
    return Response.json(malformed ? { ...ack, status: 'applied' } : ack, { status: 202 });
  } });
  const receipt = await client.sendReaction(chat.toUpperCase(), message, { reaction: 'like', remove: true }, { idempotencyKey: 'key  with spaces' });
  assert.deepEqual(receipt, ack);
  assert.equal(Object.isFrozen(receipt), true);
  malformed = true;
  await assert.rejects(() => client.sendReaction(chat, message, { reaction: 'like', remove: true }), error => error instanceof ChertAPIError && error.code === 'unconfirmed_reaction_outcome');
  await assert.rejects(() => client.sendReaction(chat, '../escape', { reaction: 'like' }), TypeError);
  assert.equal(requests, 2);

  let reads = 0, posts = 0;
  const linq = new Linq({ chert: { baseURL: 'https://chert.example', apiKey: 'linq-reaction-only', fetch: async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.headers.get('authorization'), 'Bearer linq-reaction-only');
    if (request.method === 'GET') {
      reads++;
      assert.equal(request.url, 'https://chert.example/api/v1/messages/Msg%3ACASE');
      return Response.json({ id: message, lead_id: chat });
    }
    posts++;
    assert.equal(request.url, `https://chert.example/api/v1/chats/${chat}/messages/Msg%3ACASE/reactions`);
    assert.deepEqual(await request.json(), { reaction: 'like', remove: false, part_index: 0 });
    return Response.json(ack, { status: 202 });
  } } });
  assert.deepEqual(await linq.messages.addReaction(message, { operation: 'add', type: 'like' }), { status: 'accepted' });
  assert.equal(reads, 1); assert.equal(posts, 1);
  console.log('Built core and official Linq reaction acceptance passed; malformed acknowledgement and unsafe IDs rejected.');
}

// Built HTTP-only Sendblue export: this fixture checks runtime packaging and
// fail-closed translation. Durable provenance is tested by the real-PG gate.
{
  const guid='A50E8400-E29B-41D4-A716-446655440000';
  const chat='b50e8400-e29b-41d4-a716-446655440000';
  const line='c50e8400-e29b-41d4-a716-446655440000', from='+15550000001';
  let proof=true, malformed=false, posts=0;
  const transport=createSendblueReactionFetch({baseURL:'https://chert.example',apiKey:'distribution-only',fetch:async(input,init)=>{
    const request=new Request(input,init),path=new URL(request.url).pathname;
    assert.equal(request.headers.get('authorization'),'Bearer distribution-only');
    if(path==='/api/v1/messages/'+guid)return Response.json({id:guid,native_guid:guid,chat_id:chat,direction:'inbound',service:'imessage',phone_line_id:line,parts:[{type:'text',value:'received text'}],...(proof?{native_received_context:{version:1,primary_guid:guid,receiver:from,service:'iMessage',is_from_me:false,is_group:false,associated_message_type:0,associated_message_guid:null,balloon_bundle_id:null,phone_line_id:line,source_event_id:'recv:'+guid}}:{})});
    if(path==='/api/v1/phone-numbers')return Response.json({phone_numbers:[{id:line,phone_number:from,service:'imessage',is_active:true,capabilities:['imessage','send']}]});
    assert.equal(request.method,'POST');assert.equal(path,`/api/v1/chats/${chat}/messages/${guid}/reactions`);
    assert.deepEqual(await request.json(),{reaction:'like',remove:true,part_index:0,
      received_target:{primary_guid:guid,phone_line_id:line,receiver:from}});posts++;
    return Response.json({operation_id:'a'.repeat(32),chat_id:chat,message_id:guid,status:malformed?'applied':'acknowledged'},{status:202});
  }});
  const send=()=>transport('https://api.sendblue.com/api/send-reaction',{method:'POST',body:JSON.stringify({from_number:from,message_handle:guid,reaction:'-like'})});
  const accepted=await send();assert.equal(accepted.status,200);
  assert.deepEqual(await accepted.json(),{status:'OK',message:'Reaction request sent',message_handle:guid,reaction:'-like'});
  proof=false;assert.equal((await send()).status,422);assert.equal(posts,1);
  proof=true;malformed=true;assert.equal((await send()).status,502);assert.equal(posts,2);
  console.log('Built Sendblue HTTP reaction subset passed; absent proof and malformed acknowledgement fail closed without retry.');
}

const calls = [];
let identityActive = true;
const chert = { baseURL: 'https://chert.example', apiKey: 'chert-only', fetch: async (input, init) => {
  const request = new Request(input, init);
  calls.push({ url: request.url, key: request.headers.get('authorization'), body: request.body === null ? null : await request.json() });
  if (request.url.endsWith('/attachments/' + 'a'.repeat(48))) return Response.json({ attachment: { attachment_id: 'a'.repeat(48), filename: 'photo.png', content_type: 'image/png', size_bytes: 42, created_at: '2026-10-17T00:00:00.123456+00:00', uploaded_at: '2026-10-17T00:01:00+00:00', blob_url: 'private-must-not-return' } });
  if (request.url.endsWith('/api/v1/attachments') && request.method === 'POST') return Response.json({
    attachment_id: 'b'.repeat(48), upload_url: 'https://chert.example/api/v1/attachments/' + 'b'.repeat(48) + '/upload',
    download_url: 'https://chert.example/api/v1/attachments/' + 'b'.repeat(48) + '/download?tenant=21000000-0000-4000-8000-000000000001&signature=' + 'c'.repeat(64),
    expires_at: new Date(Date.now()+900000).toISOString(), http_method: 'PUT',
    required_headers: {authorization:'Bearer <your-signing-secret>', 'content-type':'image/png'},
  });
  if (request.url.endsWith('/text-operations/v1')) return Response.json({success:true,message_id:'a'.repeat(32),chat_id:'chat-id',status:'queued'},{status:202});
  if (request.url.endsWith('/whoami')) return Response.json({ is_active: identityActive, plan: 'starter', api_key: 'must-not-return', devices: ['must-not-return'] });
  if (request.url.endsWith('/phone-numbers')) return Response.json({ phone_numbers: [{ id: '21000000-0000-4000-8000-000000000011', phone_number: '+15551234567', capabilities: ['imessage'], api_key: 'must-not-return' }] });
  if (request.method === 'GET' && request.url.endsWith('/chats/chat-id')) return Response.json({chat:{id:'chat-id',display_name:'Recorded contact',is_group:false,handles:[{address:'+15557654321',service:'unknown'}],service:'unknown',health_score:99}});
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/v1/chats/chat-id/messages') {
    const continuation = new URL(request.url).searchParams.has('cursor');
    return Response.json({ messages: [{ id: continuation ? 'history-2' : 'history-1', chat_id: 'chat-id', parts: [{ type: 'text', value: 'recorded history' }], status: 'received', direction: 'inbound', service: 'unknown', created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T01:00:00Z' }], has_more: !continuation, next_cursor: continuation ? null : 'opaque_next' });
  }
  if (request.url.endsWith('/messages/linq-recorded')) return Response.json({ id: 'linq-recorded', chat_id: 'chat-id', status: 'read', direction: 'outbound', created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T01:00:00Z' });
  if (request.url.endsWith('/messages/read-id')) return Response.json({ id: 'read-id', direction: 'outbound', status: 'read' });
  if (request.url.endsWith('/messages/recorded-id')) return Response.json({ id: 'recorded-id', lead_id: 'chat-id', text: 'recorded inbound', direction: 'inbound', status: 'received', service: 'unknown', created_at: null });
  if (request.url.endsWith('/mark-read')) return Response.json({ chat_id: 'chat-id', applied: true });
  if (request.url.endsWith('/api/v1/typing')) return Response.json({ ...calls.at(-1).body, applied: true, chat_id: 'chat-id' });
  if (request.url.endsWith('/typing')) return Response.json({ chat_id: 'chat-id', state: calls.at(-1).body.state });
  return Response.json(request.url.endsWith('/send') ? { message_id: 'real-id', status: 'queued' } : {
    message: { id: 'real-id', chat_id: 'chat-id', created_at: '2026-10-17T00:00:00Z', status: 'queued', parts: [{ type: 'text', value: 'hello' }] },
  });
} };
assert.equal(typeof new ChertClient(chert).request, 'function');
const linq = new Linq({ chert });
assert.equal((await linq.chats.messages.send('chat-id', { message: { parts: [{ type: 'text', value: 'hello' }] } })).message.delivery_status, 'queued');
assert.equal((await new Sendblue({ chert }).messages.send({ from_number: '+15551234567', number: '+15557654321', content: 'hello' })).status, 'QUEUED');
assert.equal((await new Blooio({ chert }).messages.send({ to: '+15557654321', text: 'hello' })).status, 'queued');
assert.deepEqual(calls.map(call => call.url), ['https://chert.example/api/v1/chats/chat-id/messages', 'https://chert.example/api/v1/chats', 'https://chert.example/api/v1/text-operations/v1']);
assert.ok(calls.every(call => call.key === 'Bearer chert-only'));
console.log('Built ESM packages: core and three real upstream SDK adapters passed synthetic transport checks.');

const { createBlooioV4Fetch } = await import('@cherthq/blooio-v4-adapter');
const v4 = createBlooioV4Fetch({ chert });
const v4Response = await v4('https://api.blooio.com/v4/messages', {method:'POST',body:JSON.stringify({from:'+15551234567',to:'+15557654321',text:'hello'})});
assert.equal(v4Response.status, 201);
assert.deepEqual(await v4Response.json(), {id:'real-id',chat_id:'chat-id',status:'queued'});
assert.equal(calls.at(-1).url,'https://chert.example/api/v1/chats');
console.log('Blooio v4 built HTTP adapter passed synthetic transport checks.');
// The same fixed golden runs against bundled code under Node, Bun and Deno.
const keyedText='  exact keyed / Café 🌅\r\n  ';
const keyedRequest={version:1,profile:'blooio-v4',route:'/v4/messages',body_sha256:'85ac4a0a6cf97efd86576e893767634d81dbe64956a2d8ffc5fd9b7837f030df'};
const queuedMessage={id:'c'.repeat(32),chat_id:'chat-keyed',status:'queued'};
const keyedV4Calls=[];let keyedDispatches=0;
const keyedV4=createBlooioV4Fetch({chert:{baseURL:'https://chert.example',apiKey:'keyed-chert-only',fetch:async(input,init)=>{
  const request=new Request(input,init);keyedV4Calls.push(new URL(request.url).pathname);
  assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer keyed-chert-only');
  assert.equal(request.headers.get('idempotency-key'),null);const body=await request.json();
  if(request.url.endsWith('/idempotency/lookup')){
    assert.deepEqual(body,{key:'built-v4-key',request:keyedRequest});
    return Response.json(keyedDispatches?{found:true,message:queuedMessage,idempotency:{replayed:true}}:{found:false});
  }
  assert.equal(request.url,'https://chert.example/api/v1/chats');keyedDispatches++;
  assert.deepEqual(body,{from:'+15551234567',to:['+15557654321'],message:{parts:[{type:'text',value:keyedText}],idempotency_key:'built-v4-key',idempotency_request:keyedRequest}});
  return Response.json({message:queuedMessage,idempotency:{replayed:false}},{status:202});
}}});
for(const [status,body] of [[201,{text:keyedText,to:'+15557654321',from:'+15551234567'}],[200,{from:'+15551234567',to:'+15557654321',text:keyedText}]]){
  const result=await keyedV4('https://api.blooio.com/v4/messages',{method:'POST',headers:{'Idempotency-Key':'built-v4-key',authorization:'Bearer vendor-only','content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(result.status,status);assert.deepEqual(await result.json(),queuedMessage);
}
assert.deepEqual(keyedV4Calls,['/api/v1/idempotency/lookup','/api/v1/chats','/api/v1/idempotency/lookup']);assert.equal(keyedDispatches,1);
const builtImageId='a'.repeat(48),builtImageTenant='10000000-0000-4000-8000-000000000001';
const builtImageURL=`https://chert.example/api/v1/attachments/${builtImageId}/download?tenant=${builtImageTenant}&signature=${'b'.repeat(64)}`;
const imageBody={attachments:[builtImageURL]};
const expectedImageHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(imageBody))))).map(v=>v.toString(16).padStart(2,'0')).join('');
const imageContext={version:1,profile:'blooio-v4',route:'/v4/chats/chat-keyed/messages',body_sha256:expectedImageHash};
let replayImageReads=0;
const imageReplay=createBlooioV4Fetch({chert:{baseURL:'https://chert.example',apiKey:'keyed-chert-only',fetch:async(input,init)=>{
  const request=new Request(input,init);replayImageReads++;assert.equal(request.url,'https://chert.example/api/v1/idempotency/lookup');assert.equal(request.method,'POST');
  assert.deepEqual(await request.json(),{key:'image-key',request:imageContext});
  return Response.json({found:true,message:queuedMessage,idempotency:{replayed:true}});
}}});
const replayImage=await imageReplay('https://api.blooio.com/v4/chats/chat-keyed/messages',{method:'POST',headers:{'Idempotency-Key':'image-key'},body:JSON.stringify(imageBody)});
assert.equal(replayImage.status,200);assert.deepEqual(await replayImage.json(),queuedMessage);assert.equal(replayImageReads,1); // No metadata read or send.
const imageCalls=[];
const freshImage=createBlooioV4Fetch({chert:{baseURL:'https://chert.example',apiKey:'keyed-chert-only',fetch:async(input,init)=>{
  const request=new Request(input,init),path=new URL(request.url).pathname;imageCalls.push([request.method,path]);
  assert.equal(request.headers.get('authorization'),'Bearer keyed-chert-only');
  if(path.endsWith('/idempotency/lookup')){assert.deepEqual(await request.json(),{key:'image-fresh',request:imageContext});return Response.json({found:false});}
  if(request.method==='GET'){assert.equal(path,'/api/v1/attachments/'+builtImageId);return Response.json({attachment:{attachment_id:builtImageId,download_url:builtImageURL,uploaded_at:'2026-10-17T00:00:00Z',size_bytes:4,filename:'image.png',content_type:'image/png'}});}
  assert.equal(path,'/api/v1/chats/chat-keyed/messages');assert.deepEqual(await request.json(),{message:{parts:[{type:'media',attachment_id:builtImageId}],idempotency_key:'image-fresh',idempotency_request:imageContext}});
  return Response.json({message:queuedMessage,idempotency:{replayed:false}},{status:202});
}}});
assert.equal((await freshImage('https://api.blooio.com/v4/chats/chat-keyed/messages',{method:'POST',headers:{'Idempotency-Key':'image-fresh'},body:JSON.stringify(imageBody)})).status,201);
assert.deepEqual(imageCalls,[['POST','/api/v1/idempotency/lookup'],['GET','/api/v1/attachments/'+builtImageId],['POST','/api/v1/chats/chat-keyed/messages']]);
console.log('Built Blooio v4 keys preserve canonical UTF8/URL hashes, fresh201/replay200 and lookup-before-media without duplicate sends.');

const directChat=await v4('https://api.blooio.com/v4/chats/chat-id');
assert.equal(directChat.status,200);
assert.deepEqual(await directChat.json(),{data:{id:'chat-id',contact:{contact_id:'chat-id',identifier:'+15557654321',name:'Recorded contact'},group:null}});
assert.deepEqual(calls.at(-1),{url:'https://chert.example/api/v1/chats/chat-id',key:'Bearer chert-only',body:null});
console.log('Built Blooio v4 direct-chat getter preserves recorded contact identity only.');
const directContact=await v4('https://api.blooio.com/v4/contacts/chat-id');
assert.equal(directContact.status,200);
assert.deepEqual(await directContact.json(),{data:{id:'chat-id',name:'Recorded contact'}});
assert.deepEqual(calls.at(-1),{url:'https://chert.example/api/v1/chats/chat-id',key:'Bearer chert-only',body:null});
const beforeContactGuard=calls.length;
assert.equal((await v4('https://api.blooio.com/v4/contacts/chat-id?expand=identities')).status,501);
assert.equal(calls.length,beforeContactGuard);
console.log('Built Blooio v4 contact getter returns actual owned ID/name without invented metadata.');

const timestamp = Math.floor(Date.now() / 1000);
const rawEvent = JSON.stringify({ type: 'message_received', event_id: 'recv:fixture-guid', message: {
  guid: 'fixture-guid', role: 'inbound', status: 'received', recipient: '+15551234567',
  parts: [{ type: 'text', text: 'fixture inbound' }],
} });
const encoder = new TextEncoder();
const webhookKey = await crypto.subtle.importKey('raw', encoder.encode('fixture-only-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signed = new Uint8Array(await crypto.subtle.sign('HMAC', webhookKey, encoder.encode(`${timestamp}.${rawEvent}`)));
const hex = Array.from(signed, value => value.toString(16).padStart(2, '0')).join('');
const webhookHeaders = { 'x-webhook-signature': `t=${timestamp},v1=${hex}` };
assert.deepEqual(await unwrapChert(rawEvent, webhookHeaders, { secret: 'fixture-only-secret' }), {
  eventId: 'recv:fixture-guid', message: { message_handle: 'fixture-guid', content: 'fixture inbound',
    status: 'RECEIVED', is_outbound: false, from_number: '+15551234567' },
});
await assert.rejects(unwrapChert(rawEvent.replace('fixture inbound', 'tampered'), webhookHeaders, { secret: 'fixture-only-secret' }));
console.log('Built Sendblue Chert webhook helper verified a signed fixture and rejected tampering.');

await linq.chats.typing.start('chat-id');
await linq.chats.typing.stop('chat-id');
for (const method of ['POST', 'DELETE']) {
  const response = await v4('https://api.blooio.com/v4/chats/chat-id/typing', { method });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { chat_id: 'chat-id', state: method === 'POST' ? 'started' : 'stopped' } });
}
assert.deepEqual(calls.slice(-4).map(call => call.body.state), ['typing', 'stopped', 'typing', 'stopped']);
assert.ok(calls.slice(-4).every(call => call.url === 'https://chert.example/api/v1/chats/chat-id/typing' && call.key === 'Bearer chert-only'));
console.log('Built Linq and Blooio v4 typing adapters passed synthetic transport checks.');

const identityClient = new Blooio({ apiKey: 'vendor-must-not-leak', chert });
for (const active of [true, false]) {
  identityActive = active;
  const before = calls.length;
  assert.deepEqual(await identityClient.me.retrieve(), { valid: active });
  assert.equal(calls.length, before + 1);
  assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/whoami', key: 'Bearer chert-only', body: null });
}
console.log('Built legacy Blooio identity subset passed active-state checks without invented metadata.');

const beforeMarkRead = calls.length;
assert.equal(await linq.chats.markAsRead('chat-id'), null);
assert.equal(calls.length, beforeMarkRead + 1);
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/chats/chat-id/mark-read', key: 'Bearer chert-only', body: null });
console.log('Built official Linq markAsRead mapped an explicit application acknowledgement to void.');

const sendblueTyping = new Sendblue({ chert });
for (const state of [undefined, 'start', 'stop']) {
  const before = calls.length;
  assert.deepEqual(await sendblueTyping.typingIndicators.send({ from_number: '+15551234567', number: '+15557654321', ...(state ? { state } : {}) }), { number: '+15557654321', status: 'SENT' });
  assert.equal(calls.length, before + 1);
  assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/typing', key: 'Bearer chert-only', body: { from: '+15551234567', to: '+15557654321', state: state === 'stop' ? 'stopped' : 'typing' } });
}
console.log('Built official Sendblue typing subset mapped explicit-sender default/start/stop acknowledgements.');

const beforeNumbers = calls.length;
assert.deepEqual(await linq.phonenumbers.list(), { phone_numbers: [{ id: '21000000-0000-4000-8000-000000000011', phone_number: '+15551234567' }] });
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/phone-numbers', key: 'Bearer chert-only', body: null });
assert.equal(calls.length, beforeNumbers + 1);
await assert.rejects(async () => linq.phoneNumbers.list(), error => error.status === 501);
assert.equal(calls.length, beforeNumbers + 1);
console.log('Built Linq assigned-number subset preserves actual identities; modern reputation rejects before dispatch.');

const retrieved = await v4('https://api.blooio.com/v4/chats/chat-id/messages/recorded-id');
assert.equal(retrieved.status, 200);
assert.deepEqual(await retrieved.json(), { data: { id: 'recorded-id', chat_id: 'chat-id', text: 'recorded inbound', direction: 'inbound', status: 'received' } });
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/messages/recorded-id', key: 'Bearer chert-only', body: null });
const beforeFragment = calls.length;
const fragment = await v4('https://api.blooio.com/v4/messages#unsupported', { method: 'POST', body: JSON.stringify({ from: '+15551234567', to: '+15557654321', text: 'must not send' }) });
assert.equal(fragment.status, 501);
assert.equal(calls.length, beforeFragment);
console.log('Built Blooio v4 recorded retrieval preserves evidence and fragment sends reject before dispatch.');

const firstPage = await v4('https://api.blooio.com/v4/chats/chat-id/messages');
assert.equal(firstPage.status, 200);
assert.deepEqual(await firstPage.json(), { data: [{ id: 'history-1', chat_id: 'chat-id', text: 'recorded history', status: 'received', direction: 'inbound' }], has_more: true, next_cursor: 'opaque_next' });
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/chats/chat-id/messages?order=desc&limit=50', key: 'Bearer chert-only', body: null });
const nextPage = await v4('https://api.blooio.com/v4/chats/chat-id/messages?cursor=opaque_next&limit=1');
assert.equal(nextPage.status, 200);
assert.deepEqual(await nextPage.json(), { data: [{ id: 'history-2', chat_id: 'chat-id', text: 'recorded history', status: 'received', direction: 'inbound' }], has_more: false, next_cursor: null });
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/chats/chat-id/messages?limit=1&cursor=opaque_next', key: 'Bearer chert-only', body: null });
console.log('Built Blooio v4 list uses default 50, opaque continuation and observed fields only.');

const sendblueReads = new Sendblue({ chert });
{
  let reads=0;
  const history=new Sendblue({chert:{baseURL:'https://chert.example',apiKey:'history-only',fetch:async(input,init)=>{
    const req=new Request(input,init);reads++;
    assert.equal(req.method,'GET');
    assert.equal(req.headers.get('authorization'),'Bearer history-only');
    assert.equal(req.url,'https://chert.example/api/v1/messages?from_number=%2B15550000001&limit=1&offset=0&order_by=created_at');
    return Response.json({messages:[{id:'a'.repeat(32),chat_id:'41000000-0000-4000-8000-000000000001',parts:[{type:'text',value:'Recorded exact text'}],direction:'outbound',status:'queued',service:'unknown',from:'+15550000001',to:'+15550000002',line_number:'+15550000001',phone_line_id:'61000000-0000-4000-8000-000000000001',is_group:false,created_at:'2026-10-18T00:00:00.000Z',updated_at:null,sent_at:null,endpoint_source:'strict_text_intent'}],pagination:{has_more:false,limit:1,offset:0,total:1}});
  }}});
  assert.deepEqual(await history.messages.list({from_number:'+15550000001',limit:1,offset:0,order_by:'createdAt'}),{data:[{message_handle:'a'.repeat(32),from_number:'+15550000001',to_number:'+15550000002',sendblue_number:'+15550000001',number:'+15550000002',is_outbound:true,message_type:'message',status:'QUEUED',content:'Recorded exact text'}],pagination:{hasMore:false,limit:1,offset:0,total:1}});
  await assert.rejects(()=>history.messages.list({worker_id:'unavailable'}),error=>error.status===501);
  assert.equal(reads,1);
  console.log('Built Sendblue account-wide list uses one owned GET, frozen endpoints and truthful offset pagination.');
}
assert.deepEqual(await sendblueReads.messages.retrieve('recorded-id'), { data: { message_handle: 'recorded-id', content: 'recorded inbound', is_outbound: false, status: 'RECEIVED' } });
assert.deepEqual(await sendblueReads.messages.getStatus({ handle: 'recorded-id' }), { message_handle: 'recorded-id', content: 'recorded inbound', is_outbound: false });
assert.deepEqual(await sendblueReads.messages.retrieve('read-id'), { data: { message_handle: 'read-id', status: 'DELIVERED', is_outbound: true } });
assert.deepEqual(await sendblueReads.messages.getStatus({ handle: 'read-id' }), { message_handle: 'read-id', status: 'DELIVERED', is_outbound: true });
console.log('Built Sendblue recorded reads retain explicit received/read evidence within each official response schema.');

const linqHistory = await linq.chats.messages.list('chat-id', { limit: 1 });
assert.equal(linqHistory.messages[0].id, 'history-1');
assert.equal(linqHistory.messages[0].delivery_status, 'received');
assert.equal(linqHistory.messages[0].is_read, false);
assert.equal(linqHistory.hasNextPage(), true);
const linqNext = await linqHistory.getNextPage();
assert.equal(linqNext.messages[0].id, 'history-2');
assert.equal(linqNext.next_cursor, '');
assert.equal(linqNext.hasNextPage(), false);
const linqRecorded = await linq.messages.retrieve('linq-recorded');
assert.equal(linqRecorded.id, 'linq-recorded');
assert.equal(linqRecorded.is_from_me, true);
assert.equal(linqRecorded.is_read, true);
assert.equal(linqRecorded.is_delivered, true);
assert.equal(Date.parse(linqRecorded.updated_at), Date.parse('2026-10-17T01:00:00Z'));
assert.equal(Object.hasOwn(linqRecorded, 'parts'), false);
console.log('Built Linq history preserves PagePromise continuation, required evidence and top-level retrieval.');

for (const channel of ['+15551234567', '21000000-0000-4000-8000-000000000011']) {
  const before = calls.length;
  const response = await v4(`https://api.blooio.com/v4/channels/${encodeURIComponent(channel)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { id: '21000000-0000-4000-8000-000000000011', address: '+15551234567' } });
  assert.equal(calls.length, before + 1);
  assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/phone-numbers', key: 'Bearer chert-only', body: null });
}
const beforeChannelAlias = calls.length;
assert.equal((await v4('https://api.blooio.com/v4/channels/ch_provider_alias')).status, 501);
assert.equal(calls.length, beforeChannelAlias);
console.log('Built Blooio v4 assigned-channel identity checks passed.');

assert.deepEqual(await linq.attachments.retrieve('a'.repeat(48)), {
  id: 'a'.repeat(48), filename: 'photo.png', content_type: 'image/png', size_bytes: 42,
  created_at: '2026-10-17T00:00:00.123456+00:00', status: 'complete',
});
assert.deepEqual(calls.at(-1), { url: 'https://chert.example/api/v1/attachments/' + 'a'.repeat(48), key: 'Bearer chert-only', body: null });
console.log('Built Linq attachment retrieval preserves actual metadata and upload state.');

const registered = await linq.attachments.create({filename:'fixture.png',content_type:'image/png',size_bytes:4});
assert.equal(registered.attachment_id,'b'.repeat(48));
assert.equal(registered.http_method,'PUT');
assert.deepEqual(registered.required_headers,{authorization:'Bearer chert-only','content-type':'image/png'});
assert.equal(calls.at(-1).url,'https://chert.example/api/v1/attachments');
assert.deepEqual(calls.at(-1).body,{filename:'fixture.png',content_type:'image/png',size_bytes:4});
console.log('Built Linq attachment registration returns scoped upload credentials after URL validation.');

// Exercise the built shared capability validator through the genuine Sendblue SDK.
const mediaID = 'd'.repeat(48);
const mediaExpiry = Math.floor(Date.now() / 1000) + 3600;
const mediaCapability = {
  attachment_id: mediaID, filename: 'recorded.png', content_type: 'image/png', size_bytes: 42,
  download_url: `https://chert.example/api/v1/attachments/${mediaID}/download?tenant=21000000-0000-4000-8000-000000000001&signature=${'e'.repeat(64)}&expires=${mediaExpiry}`,
  download_url_expires_at: new Date(mediaExpiry * 1000).toISOString(),
};
let mediaFault = null;
const mediaRequests = [];
const mediaSDK = new Sendblue({ chert: {
  baseURL: 'https://chert.example', apiKey: 'chert-media-only',
  fetch: async (input, init) => {
    const request = new Request(input, init);
    mediaRequests.push({ url: request.url, method: request.method });
    assert.ok(['https://chert.example/api/v1/messages/recorded-media','https://chert.example/api/v1/messages'].includes(request.url));
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('authorization'), 'Bearer chert-media-only');
    assert.equal(request.body, null);
    const capability = { ...mediaCapability };
    if (mediaFault === 'malformed') capability.size_bytes = 0;
    if (mediaFault === 'foreign') capability.download_url = capability.download_url.replace('chert.example', 'foreign.example');
    if(request.url.endsWith('/messages'))return Response.json({messages:[{
      id:'history-media',chat_id:'41000000-0000-4000-8000-000000000001',direction:'outbound',status:'unknown',service:'unknown',
      from:'+15551234567',to:'+15557654321',line_number:'+15551234567',phone_line_id:'61000000-0000-4000-8000-000000000001',
      is_group:false,endpoint_source:'strict_media_intent',created_at:'2026-10-18T00:00:00Z',updated_at:null,sent_at:null,
      parts:[{type:'text',value:'  Exact / Café 🌅\r\n  '},{type:'media',attachment_id:mediaID}],attachments:[capability],
    }],pagination:{has_more:false,limit:50,offset:0,total:1}});
    return Response.json({ id: 'recorded-media', direction: 'outbound', status: 'queued', phone: '+15557654321',
      request: { message: { parts: [{ type: 'media', attachment_id: mediaID }] } },
      response: { attachments: [capability] } });
  },
} });
assert.deepEqual((await mediaSDK.messages.retrieve('recorded-media')).data, {
  message_handle: 'recorded-media', status: 'QUEUED', number: '+15557654321', is_outbound: true,
  media_url: mediaCapability.download_url,
});
const narrowMediaStatus = await mediaSDK.messages.getStatus({ handle: 'recorded-media' });
assert.equal(Object.hasOwn(narrowMediaStatus, 'media_url'), false);
assert.deepEqual(await mediaSDK.messages.list(),{data:[{message_handle:'history-media',from_number:'+15551234567',to_number:'+15557654321',sendblue_number:'+15551234567',number:'+15557654321',is_outbound:true,message_type:'message',content:'  Exact / Café 🌅\r\n  ',media_url:mediaCapability.download_url}],pagination:{hasMore:false,limit:50,offset:0,total:1}});
console.log('Built Sendblue media history validates one owned capability and exact caption without inventing delivery or fetching the URL.');
for (const fault of ['malformed', 'foreign']) {
  mediaFault = fault;
  const before = mediaRequests.length;
  await assert.rejects(async () => await mediaSDK.messages.retrieve('recorded-media'), error => error.status === 502);
  assert.equal(mediaRequests.length, before + 1);
}
assert.equal(mediaRequests.length, 5);
assert.ok(mediaRequests.every(request => request.method === 'GET' && ['https://chert.example/api/v1/messages/recorded-media','https://chert.example/api/v1/messages'].includes(request.url)));
assert.equal(mediaRequests.filter(request=>request.url==='https://chert.example/api/v1/messages').length,1);
console.log('Built Sendblue recorded-media retrieval validates capabilities: four owned GETs, zero POSTs or URL fetches; getStatus stays narrow.');

const mediaSendRequests=[];
let sendCaption;
const mediaSendSDK=new Sendblue({chert:{...chert,fetch:async(input,init)=>{
  const request=new Request(input,init);mediaSendRequests.push(request);
  assert.equal(request.headers.get('authorization'),'Bearer chert-only');
  if(request.url==='https://chert.example/api/v1/attachments/import'){
    assert.deepEqual(await request.json(),{url:'https://cdn.example/Photo.png'});
    return Response.json({attachment_id:mediaID,uploaded:true});
  }
  assert.equal(request.url,'https://chert.example/api/v1/chats');
  const parts=[...(sendCaption===undefined?[]:[{type:'text',value:sendCaption}]),{type:'media',attachment_id:mediaID}];
  assert.deepEqual(await request.json(),{from:'+15551234567',to:['+15557654321'],message:{parts}});
  return Response.json({message:{id:'d'.repeat(32),status:'queued',parts,attachments:[mediaCapability]}});
}}});
assert.deepEqual(await mediaSendSDK.messages.send({from_number:'+15551234567',number:'+15557654321',media_url:'https://cdn.example/Photo.png'}),{
  message_handle:'d'.repeat(32),status:'QUEUED',from_number:'+15551234567',number:'+15557654321',media_url:mediaCapability.download_url,
});
assert.equal(mediaSendRequests.length,2);
sendCaption=' exact\r\n💬 ';
assert.equal((await mediaSendSDK.messages.send({from_number:'+15551234567',number:'+15557654321',media_url:'https://cdn.example/Photo.png',content:sendCaption})).content,sendCaption);
assert.equal(mediaSendRequests.length,4);
console.log('Built Sendblue media and caption sends each import on the server then make one strict send, preserving exact caption bytes.');

const {createLoopMessageFetch}=await import('@cherthq/loopmessage-adapter');
const loop=createLoopMessageFetch({chert});
const loopBefore=calls.length;
const loopResponse=await loop('https://a.loopmessage.com/api/v1/message/send/',{method:'POST',headers:{authorization:'vendor-only','content-type':'application/json'},body:JSON.stringify({contact:'+15557654321',text:'hello',channel:'imessage'})});
assert.equal(loopResponse.status,200);
assert.deepEqual(await loopResponse.json(),{message_id:'a'.repeat(32),contact:'+15557654321',text:'hello'});
assert.equal(calls.length,loopBefore+1);
assert.equal(calls.at(-1).key,'Bearer chert-only');
const loopRejected=await loop('https://a.loopmessage.com/api/v1/message/send/',{method:'POST',body:JSON.stringify({contact:'+15557654321',text:'hello',channel:'imessage',sender:'unmapped'})});
assert.equal(loopRejected.status,501);assert.equal(calls.length,loopBefore+1);
console.log('Built LoopMessage strict plaintext queue receipt and zero-effect unsupported sender checks passed.');

let loopStatusCalls=0;
const loopStatusID='a'.repeat(32);
let loopStatusRecord={id:loopStatusID,direction:'outbound',status:'read',service:'imessage',delivered:true,read:true,error:null,phone:'+15557654321',text:'observed text'};
const loopStatus=createLoopMessageFetch({chert:{...chert,fetch:async(input,init)=>{
  const request=new Request(input,init);loopStatusCalls++;
  assert.equal(request.url,`https://chert.example/api/v1/messages/${loopStatusID}`);
  assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Bearer chert-only');
  return Response.json(loopStatusRecord);
}}});
const loopStatusURL=`https://a.loopmessage.com/api/v1/message/status/${loopStatusID}/`;
let loopObserved=await loopStatus(loopStatusURL);
assert.equal(loopObserved.status,200);
assert.deepEqual(await loopObserved.json(),{message_id:loopStatusID,status:'delivered',contact:'+15557654321',text:'observed text'});
loopStatusRecord={...loopStatusRecord,error:'private-contradictory-error'};
loopObserved=await loopStatus(loopStatusURL);
assert.equal(loopObserved.status,502);assert.deepEqual(await loopObserved.json(),{error_code:100,message:'Recorded status unavailable.'});
const loopBadStatus=await loopStatus(loopStatusURL+'?unsupported=1');
assert.equal(loopBadStatus.status,501);assert.equal(loopStatusCalls,2);
console.log('Built LoopMessage status requires actual iMessage delivery evidence and refuses contradictions with GET only.');


// Built core typed operation: injected HTTP only, never a live endpoint.
const coreTextCalls = [];
const coreQueued = {success:true,message_id:'a'.repeat(32),chat_id:'chat-core',status:'queued'};
let coreTextMode = 'queued';
const coreText = new ChertClient({baseURL:'https://chert.example',apiKey:'core-only-key',tenant:'core-fixture',fetch:async(input,init)=>{
  const request=new Request(input,init);
  assert.equal(request.url,'https://chert.example/api/v1/text-operations/v1');
  assert.equal(request.method,'POST');assert.equal(init.redirect,'error');
  assert.equal(request.headers.get('authorization'),'Bearer core-only-key');
  assert.equal(request.headers.get('x-chert-tenant'),'core-fixture');
  coreTextCalls.push(await request.json());
  if(coreTextMode==='error4103')return Response.json({error:{code:4103,message:'private-core-error',retryable:false},message_id:'b'.repeat(32),chat_id:'chat-core'},{status:502,headers:{'x-trace-id':'core-trace'}});
  if(coreTextMode==='native-uuid')return Response.json({...coreQueued,message_id:'550e8400-e29b-41d4-a716-446655440000'},{status:202});
  if(coreTextMode==='extra-field')return Response.json({...coreQueued,service:'imessage'},{status:202});
  if(coreTextMode==='wrong-status')return Response.json(coreQueued,{status:200});
  return Response.json(coreQueued,{status:202});
}});
const coreInput={phone:'+15550000002',body:'  exact / core text 🌙\n',idempotency_key:' core-key/🌙\n'};
assert.deepEqual(await coreText.sendText(coreInput),coreQueued);
assert.deepEqual(coreTextCalls,[coreInput]);
for(const mode of ['native-uuid','extra-field','wrong-status']){
  coreTextMode=mode;const before=coreTextCalls.length;
  await assert.rejects(coreText.sendText(coreInput),error=>error instanceof ChertAPIError&&error.status===502&&error.code==='unconfirmed_text_outcome');
  assert.equal(coreTextCalls.length,before+1,'invalid receipt must not retry');
}
coreTextMode='error4103';
const coreBeforeError=coreTextCalls.length;
await assert.rejects(coreText.sendText(coreInput),error=>{
  assert.ok(error instanceof ChertAPIError);assert.equal(error.status,502);assert.equal(error.code,'4103');assert.equal(error.requestId,'core-trace');
  assert.equal(error.data.message_id,'b'.repeat(32));assert.equal(error.data.chat_id,'chat-core');
  assert.ok(!String(error).includes('private-core-error'));assert.ok(!String(error).includes('core-only-key'));
  return true;
});
assert.equal(coreTextCalls.length,coreBeforeError+1,'unknown outcome must not retry');
const coreBeforeInvalid=coreTextCalls.length;
for(const invalid of [{...coreInput,phone:'15550000002'},{...coreInput,body:'\ufeff'},{...coreInput,body:'x\0y'},
  {...coreInput,body:'\ud800'},{...coreInput,idempotency_key:'x'.repeat(201)},{...coreInput,unknown:true}]){
  await assert.rejects(coreText.sendText(invalid),TypeError);
}
assert.equal(coreTextCalls.length,coreBeforeInvalid,'invalid strict text must cause zero HTTP calls');
console.log('Built core sendText validates exact queued202 receipts, preserves explicit4103 IDs and rejects invalid inputs without HTTP/retries.');

// Built Linq option normalization and WebCrypto hashing must work identically
// in Node, Bun and Deno; historical media receipts never renew their URL.
{
  const chat='41000000-0000-4000-8000-000000000001', id='d'.repeat(32);
  const text='  exact keyed / Café 🌅\r\n  ',key='built-linq-key';
  const body={message:{parts:[{type:'text',value:text}]}};
  const context={version:1,profile:'linq-v3',route:`/v3/chats/${chat}/messages`,body_sha256:'0d10cf0f3c37fbf77b84b1f90396995f3f1d0a65f41fe0a0617938d52388ef1d'};
  const message={id,chat_id:chat,status:'queued',created_at:'2026-10-18T00:00:00Z',parts:body.message.parts};
  const calls=[];let dispatches=0;
  const client=new Linq({chert:{baseURL:'https://chert.example',apiKey:'linq-key-only',fetch:async(input,init)=>{
    const request=new Request(input,init);calls.push(request.url);
    assert.equal(request.method,'POST');assert.equal(request.headers.get('authorization'),'Bearer linq-key-only');
    assert.equal(request.headers.get('idempotency-key'),null);
    if(request.url.endsWith('/idempotency/lookup')){
      assert.deepEqual(await request.json(),{key,request:context});
      return Response.json(dispatches?{found:true,message,idempotency:{replayed:true}}:{found:false});
    }
    assert.equal(request.url,`https://chert.example/api/v1/chats/${chat}/messages`);
    assert.deepEqual(await request.json(),{message:{parts:body.message.parts,idempotency_key:key,idempotency_request:context}});
    dispatches++;return Response.json({message,idempotency:{replayed:false}},{status:202});
  }}});
  const before=JSON.stringify(body);
  for(let i=0;i<2;i++){
    const result=await client.chats.messages.send(chat,body,{idempotencyKey:key}).withResponse();
    assert.equal(result.response.status,200);assert.equal(result.data.message.id,id);
    assert.equal(result.data.message.parts[0].value,text);
  }
  assert.equal(JSON.stringify(body),before);assert.equal(dispatches,1);assert.equal(calls.length,3);
  await assert.rejects(async()=>await client.chats.messages.send(chat,{message:{...body.message,idempotency_key:'other'}},{idempotencyKey:key}));
  assert.equal(calls.length,3);

  const attachment='e'.repeat(48),expires='1970-01-01T00:00:01.000Z';
  const url=`https://chert.example/api/v1/attachments/${attachment}/download?tenant=11000000-0000-4000-8000-000000000001&signature=${'a'.repeat(64)}&expires=1`;
  const frozen={attachment_id:attachment,filename:'original.png',content_type:'image/png',size_bytes:70,download_url:url,download_url_expires_at:expires};
  let mediaRequests=0;
  const media=new Linq({chert:{baseURL:'https://chert.example',apiKey:'linq-key-only',fetch:async(input,init)=>{
    const request=new Request(input,init);mediaRequests++;
    assert.equal(request.url,'https://chert.example/api/v1/idempotency/lookup');assert.equal(request.method,'POST');
    const lookup=await request.json();assert.equal(lookup.key,'original-media');assert.equal(lookup.request.profile,'linq-v3');assert.equal(lookup.request.route,context.route);
    return Response.json({found:true,message:{...message,parts:[{type:'media',attachment_id:attachment}],attachments:[frozen]},idempotency:{replayed:true}});
  }}});
  const original=await media.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:attachment}],idempotency_key:'original-media'}}).withResponse();
  assert.equal(original.response.status,200);assert.equal(original.data.message.parts[0].url,url);
  assert.equal(original.data.message.parts[0].filename,frozen.filename);assert.equal(mediaRequests,1);
  console.log('Built Linq keyed Unicode hash, option normalization, replay and expired original media receipt passed.');
}

// The inherited pinned Standard Webhooks verifier is local-only. These bytes
// test authentication, not Chert-generated Linq callback schema coverage.
{
  const {createHmac}=await import('node:crypto');
  const key=Buffer.from('0123456789abcdef0123456789abcdef'),secret='whsec_'+key.toString('base64');
  const raw='{"event_id":"built-verifier","data":{"text":" exact / Café 🌅 "}}';
  const id='built-verifier',timestamp=String(Math.floor(Date.now()/1000));let requests=0;
  const headers={'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+createHmac('sha256',key).update(`${id}.${timestamp}.${raw}`).digest('base64')};
  const client=new Linq({webhookSecret:secret,chert:{baseURL:'https://chert.example',apiKey:'local-only',fetch:async()=>{requests++;throw new Error('Unexpected verifier HTTP');}}});
  assert.deepEqual(client.webhooks.unwrap(raw,{headers}),JSON.parse(raw));
  assert.deepEqual(client.webhooks.unwrap(raw,{headers}),JSON.parse(raw)); // consumer owns deduplication
  assert.throws(()=>client.webhooks.unwrap(raw+' ',{headers}));
  assert.throws(()=>client.webhooks.unwrap(raw,{headers:{}}));
  const stale=String(Number(timestamp)-600);
  assert.throws(()=>client.webhooks.unwrap(raw,{headers:{...headers,'webhook-timestamp':stale,'webhook-signature':'v1,'+createHmac('sha256',key).update(`${id}.${stale}.${raw}`).digest('base64')}}));
  assert.deepEqual(client.webhooks.unwrap(raw,{}),JSON.parse(raw)); // explicitly parse-only
  assert.equal(requests,0);
  console.log('Built inherited Linq webhook verifier passed raw-byte authentication; no HTTP, schema conversion or replay cache claimed.');
}

{
  const id='11000000-0000-4000-8000-000000000001';
  const rootURL='https://receiver.test';
  let stored={id,url:rootURL,events:['message_received','message_delivered'],version:'blooio-v4/2026-10-01',is_active:true,secret:'never-public'};
  const calls=[];
  const transport=createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'fixture',fetch:async(input,init)=>{
    const request=new Request(input,init);
    assert.equal(request.url,`https://chert.test/api/v1/webhook-subscriptions/${id}`);
    calls.push(request.method);
    if(request.method==='GET')return Response.json({subscription:stored});
    if(request.method==='PATCH'){
      const body=await request.json();assert.deepEqual(body,{url:rootURL,is_active:false});
      stored={...stored,...body};return Response.json({subscription:stored});
    }
    assert.equal(request.method,'DELETE');return Response.json({id,deleted:true});
  }}});
  const endpoint=`https://api.blooio.com/v4/webhooks/${id}`;
  let response=await transport(endpoint);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{data:{id,url:rootURL,event_types:['message.received','message.delivered'],status:'active',api_version:'2026-10-01'}});
  response=await transport(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:rootURL,status:'disabled'})});
  assert.equal(response.status,200);assert.equal((await response.json()).data.url,rootURL);
  response=await transport(endpoint,{method:'DELETE'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{data:{id,deleted:true}});
  assert.deepEqual(calls,['GET','GET','PATCH','GET','DELETE']);
  response=await transport(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_types:['message.received']})});
  assert.equal(response.status,422);assert.equal(calls.length,5);
  console.log('Built V4 qualified webhook GET/PATCH/DELETE and retired-filter zero-HTTP boundaries passed.');
}

// MissBlue's built ESM export runs directly in JavaScript under all three runtimes.
{
  const { createMissBlueFetch, MISSBLUE_CONTRACT } = await import('@cherthq/missblue-adapter');
  assert.equal(MISSBLUE_CONTRACT.version, '1.0.0');
  let reads = 0;
  const id = 'd50e8400-e29b-41d4-a716-446655440000';
  const transport = createMissBlueFetch({ chert: {
    baseURL: 'https://chert.example', apiKey: 'distribution-only',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.url, 'https://chert.example/api/v1/phone-numbers');
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.get('authorization'), 'Bearer distribution-only');
      reads++;
      return Response.json({phone_numbers: [{id, phone_number: '+15550000001', service: 'imessage', is_active: true, capabilities: ['imessage', 'send']}]});
    },
  }});
  const inventory = await transport('https://api.missblue.dev/v1/numbers');
  assert.equal(inventory.status, 200);
  assert.deepEqual(await inventory.json(), {total: 1, data: [{id, handle: '+15550000001', service: 'imessage', disabled: false}]});
  const rejected = await transport('https://api.missblue.dev/v1/messages', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({number_id: id, recipient: '+15550000002', text: 'fixture', service: 'sms'})});
  assert.equal(rejected.status, 501);
  assert.equal(reads, 1);
  console.log('Built MissBlue inventory preserves owned facts; unsupported SMS requests refuse before HTTP.');
}

{
  const { createMissBlueFetch } = await import('@cherthq/missblue-adapter');
  const line = 'd50e8400-e29b-41d4-a716-446655440000', message = 'f'.repeat(32);
  let posts = 0;
  const transport = createMissBlueFetch({chert: {baseURL: 'https://chert.example', apiKey: 'distribution-only', fetch: async (input, init) => {
    const request = new Request(input, init);
    if (request.method === 'GET') return Response.json({phone_numbers: [{id: line, phone_number: '+15558670001', service: 'imessage', is_active: true, capabilities: ['imessage', 'send']}]});
    posts++;
    return Response.json({error: {code: 4103, retryable: false, message: 'private detail'}, message_id: message, chat_id: line}, {status: 502});
  }}});
  const response = await transport('https://api.missblue.dev/v1/messages', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({number_id: line, recipient: '+15558670002', text: 'fixture'})});
  assert.equal(response.status, 504);
  assert.equal(response.headers.get('x-chert-message-id'), message);
  assert.equal(response.headers.get('x-chert-chat-id'), line);
  assert.equal(posts, 1);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
  console.log('Built MissBlue unknown outcome retains validated Chert reconciliation IDs without retry.');
}

{
  const { createTextingBlueFetch } = await import('@cherthq/texting-blue-adapter');
  let posts = 0;
  const transport = createTextingBlueFetch({chert: {baseURL: 'https://chert.example', apiKey: 'distribution-only', fetch: async () => { posts++; return Response.json({}, {status: 202}); }}});
  const rejected = await transport('https://api.texting.blue/v1/messages/send', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({to: '+14155551234', from: '+14155559876', content: 'x', media_url: 'https://example.com/a.png'})});
  assert.equal(rejected.status, 501);
  const malformed = await transport('https://api.texting.blue/v1/messages/send', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({to: '+14155551234', from: '+14155559876', content: 'x'})});
  assert.equal(malformed.status, 502);
  assert.equal(posts, 1);
  console.log('Built Texting Blue adapter refuses media before HTTP and never accepts a malformed receipt.');
}

{
  const { createContiguityFetch, CONTIGUITY_CONTRACT } = await import('@cherthq/contiguity-adapter');
  assert.equal(CONTIGUITY_CONTRACT.apiVersion, 'v2026.9.27');
  let posts = 0;
  const transport = createContiguityFetch({chert: {baseURL: 'https://chert.example', apiKey: 'distribution-only', fetch: async (input, init) => {
    posts++; const request = new Request(input, init);
    assert.equal(request.url, 'https://chert.example/api/v1/text-operations/v1');
    return Response.json({success: true, message_id: 'a'.repeat(32), chat_id: 'chat-a', status: 'queued'}, {status: 202});
  }}});
  const rejected = await transport('https://api.contiguity.com/send/imessage', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({to: '+14155551234', message: 'x', fallback: {when: ['imessage_fails']}})});
  assert.equal(rejected.status, 501);
  const accepted = await transport('https://api.contiguity.com/send/imessage', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({to: '+14155551234', message: 'x'})});
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).data, {message_id: 'a'.repeat(32)});
  assert.equal(posts, 1);
  console.log('Built Contiguity adapter refuses SMS fallback before HTTP and maps strict queue acceptance.');
}

{
  const { createBlueReacherFetch } = await import('@cherthq/bluereacher-adapter');
  let requests = 0;
  const transport = createBlueReacherFetch({chert: {baseURL: 'https://chert.example', apiKey: 'distribution-only', fetch: async () => { requests++; return Response.json({}); }}});
  const drip = await transport('https://api.bluereacher.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({to: '+16465550119', message: 'x'})});
  assert.equal(drip.status, 501);
  assert.equal((await drip.json()).error, 'unsupported_feature');
  assert.equal(requests, 0);
  console.log('Built Blue Reacher adapter refuses default drip sends before HTTP.');
}

{
  const { createJaredFetch } = await import('@cherthq/jared-adapter');
  assert.throws(() => createJaredFetch({origin: 'http://example.com:3005', chert: {baseURL: 'https://chert.example', apiKey: 'k'}}), TypeError);
  let posts = 0;
  const transport = createJaredFetch({origin: 'http://localhost:3005', chert: {baseURL: 'https://chert.example', apiKey: 'distribution-only', fetch: async () => {
    posts++; return Response.json({success: true, message_id: 'a'.repeat(32), chat_id: 'chat-a', status: 'queued'}, {status: 202});
  }}});
  const ok = await transport('http://localhost:3005/message', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({body: {message: 'x'}, recipient: {handle: '+14155551234'}})});
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '');
  const group = await transport('http://localhost:3005/message', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({body: {message: 'x'}, recipient: {handle: 'iMessage;+;chat1'}})});
  assert.equal(group.status, 501);
  assert.equal(posts, 1);
  console.log('Built Jared adapter maps strict queue acceptance to empty 200 and refuses group handles before HTTP.');
}
