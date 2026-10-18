import { afterEach, expect, spyOn, test } from 'bun:test';
import { unwrapChert } from './index';

const timestamp = 1800000000;
const secret = 'fixture-secret-not-a-provider-key';
const event = () => ({ type: 'message_received', event_id: 'recv:guid-1', ts: timestamp,
  message: { guid: 'guid-1', role: 'inbound', status: 'received', recipient: '+15550000002',
    parts: [{ type: 'text', text: 'Hello 🌙', value: 'Hello 🌙' }], text: 'Hello 🌙',
    service: 'imessage', created_at: timestamp, phone_line_id: 'line-a' } });
afterEach(() => { mockClock?.mockRestore(); mockClock = undefined; });
let mockClock: ReturnType<typeof spyOn<DateConstructor, 'now'>> | undefined;
function clock() { mockClock = spyOn(Date, 'now').mockReturnValue(timestamp * 1000); }
async function signed(body: string, ts = timestamp) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`)));
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return new Headers({ 'X-Webhook-Signature': `t=${ts},v1=${hex}`, 'x-chert-signature': `v1,${ts},${hex}`,
    'X-Webhook-Event': 'message_received', 'X-Webhook-Event-Id': 'recv:guid-1', 'X-Webhook-Timestamp': String(ts) });
}
test('real native HMAC accepts both header formats and returns only observed Sendblue fields', async () => {
  clock(); const body = JSON.stringify(event()); const headers = await signed(body);
  const expected = { eventId: 'recv:guid-1', message: { message_handle: 'guid-1', content: 'Hello 🌙',
    status: 'RECEIVED' as const, is_outbound: false, from_number: '+15550000002' } };
  expect(await unwrapChert(body, headers, { secret })).toEqual(expected);
  headers.delete('x-chert-signature');
  expect(await unwrapChert(body, headers, { secret })).toEqual(expected);
  const legacy = await signed(body); legacy.delete('x-webhook-signature');
  expect(await unwrapChert(body, legacy, { secret })).toEqual(expected);
  // Deduplication is explicitly the receiver's durable responsibility.
  expect(await unwrapChert(body, legacy, { secret })).toEqual(expected);
});
test('tamper and wrong secret fail authentication before parsing', async () => {
  clock(); const body = JSON.stringify(event()); const headers = await signed(body);
  await expect(unwrapChert('{broken', headers, { secret })).rejects.toThrow('authentication failed');
  await expect(unwrapChert(body, headers, { secret: 'wrong' })).rejects.toThrow('authentication failed');
  await expect(unwrapChert('{broken', await signed('{broken'), { secret })).rejects.toThrow('not valid JSON');
});
test('rejects timestamps outside the signed five minute window', async () => {
  clock(); const body = JSON.stringify(event());
  for (const delta of [-301, 301]) await expect(unwrapChert(body, await signed(body, timestamp + delta), { secret })).rejects.toThrow('replay window');
  for (const delta of [-300, 300]) expect((await unwrapChert(body, await signed(body, timestamp + delta), { secret })).eventId).toBe('recv:guid-1');
});
test('rejects missing, malformed, duplicate and conflicting signatures', async () => {
  clock(); const body = JSON.stringify(event());
  await expect(unwrapChert(body, {}, { secret })).rejects.toThrow('missing');
  await expect(unwrapChert(body, {}, { secret: '' })).rejects.toThrow('secret');
  for (const value of ['t=01,v1=' + 'a'.repeat(64), 't=1,v1=xyz', 't=1,v1=' + 'g'.repeat(64), 't=1,v1=' + 'a'.repeat(63)]) {
    await expect(unwrapChert(body, { 'x-webhook-signature': value }, { secret })).rejects.toThrow('Malformed');
  }
  const duplicate = await signed(body); duplicate.append('x-webhook-signature', duplicate.get('x-webhook-signature')!);
  await expect(unwrapChert(body, duplicate, { secret })).rejects.toThrow('Malformed');
  const conflict = await signed(body); conflict.set('x-chert-signature', `v1,${timestamp},${'a'.repeat(64)}`);
  await expect(unwrapChert(body, conflict, { secret })).rejects.toThrow('Conflicting');
});
test('rejects contradictory metadata headers', async () => {
  clock(); const body = JSON.stringify(event());
  for (const name of ['x-webhook-event', 'x-webhook-event-id', 'x-webhook-timestamp', 'x-chert-event-id']) {
    const headers = await signed(body); headers.set(name, 'wrong');
    await expect(unwrapChert(body, headers, { secret })).rejects.toThrow('match');
  }
});
test('rejects signed unsupported identity, outgoing, group, media and multipart payloads', async () => {
  clock();
  const cases: unknown[] = [null, { ...event(), type: 'read_receipt' }, { ...event(), event_id: 'recv:other' }];
  for (const patch of [ { role: 'outbound' }, { status: 'sent' }, { guid: '' }, { recipient: 'email@example.com' },
    { is_group: true }, { is_group: 1 }, { is_group: 0 }, { is_group: null }, { is_group: 'false' },
    { chat_participants: 'not-an-array' }, { chat_participants: null }, { chat_participants: [123] },
    { chat_participants: ['+15550000009'] }, { chat_participants: ['a', 'b'] }, { parts: [] },
    { parts: [{ type: 'image', url: 'https://example.invalid/a' }] },
    { parts: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] },
    { parts: [{ type: 'text', text: 'Hello 🌙', effect: 'loud' }] },
    { parts: [{ type: 'text', text: 'Hello 🌙', value: 'different' }] }, { text: 'different' } ]) {
    cases.push({ ...event(), message: { ...event().message, ...patch } });
  }
  for (const value of cases) { const body = JSON.stringify(value); await expect(unwrapChert(body, await signed(body), { secret })).rejects.toThrow(); }
});

test('native boxed BOOL false and an exact single peer preserve the supported DM context', async () => {
  clock();
  for (const participants of [[], ['+15550000002']]) {
    const payload = { ...event(), message: { ...event().message, is_group: false, chat_participants: participants } };
    const body = JSON.stringify(payload);
    expect((await unwrapChert(body, await signed(body), { secret })).message.from_number).toBe('+15550000002');
  }
});
function cloudEvent(){const native=event();return {...native,event:'message_received',timestamp:new Date(timestamp*1000).toISOString(),chat_id:'chat-owned',phone_line_id:'line-a'};}
test('actual cloud envelope retains signed event/native identity and refuses contradictory cloud routing',async()=>{
 clock();const cloud=cloudEvent(),body=JSON.stringify(cloud);
 expect((await unwrapChert(body,await signed(body),{secret})).message.message_handle).toBe('guid-1');
 for(const patch of [{event:'message_sent'},{chat_id:''},{phone_line_id:'foreign-line'},{timestamp:'invalid'},{timestamp:new Date((timestamp+1)*1000).toISOString()},{message:{...cloud.message,phone_line_id:undefined}},{chat_id:'chat\nforeign'}]){
  const raw=JSON.stringify({...cloud,...patch});await expect(unwrapChert(raw,await signed(raw),{secret})).rejects.toThrow();
 }
});

test('signed cloud media/groups/peer and native identity conflicts never convert',async()=>{
 clock();const cloud=cloudEvent();
 for(const message of [{...cloud.message,is_group:true},{...cloud.message,parts:[{type:'media',url:'https://never-fetched.invalid'}]},{...cloud.message,recipient:'+15550000002\n'},{...cloud.message,guid:'guid-1\n'},{...cloud.message,chat_participants:['+15550000003']}]){
  const raw=JSON.stringify({...cloud,message});await expect(unwrapChert(raw,await signed(raw),{secret})).rejects.toThrow();
 }
 const raw=JSON.stringify(cloud);await expect(unwrapChert(raw+' ',await signed(raw),{secret})).rejects.toThrow('authentication failed');
});
