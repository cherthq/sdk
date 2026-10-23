import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TokenVerifier } from 'livekit-server-sdk';
import { liveKitDispatchAPI } from '../../src/dev/dispatch-handler.js';

const KEY = 'APIfixturekey', SECRET = 'fixture-secret-at-least-32-characters-long';
type Handler = (method: string, body: Record<string, unknown>) => { status?: number; json: unknown };
async function server(handler: Handler) {
  const seen: { method: string; body: Record<string, unknown>; authorization: string }[] = [];
  const http = createServer((request, response) => {
    let raw = ''; request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const method = request.url!.split('/').at(-1)!; const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      seen.push({ method, body, authorization: String(request.headers.authorization) });
      const result = handler(method, body);
      response.writeHead(result.status ?? 200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result.json));
    });
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { url, seen, close: () => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()); }) };
}

test('livekit: creating a room sends one request that carries the agent dispatch, limits and metadata', async () => {
  const s = await server((_method, body) => ({ json: { name: body.name, sid: 'RM_1' } }));
  try {
    const room = await liveKitDispatchAPI(s.url, KEY, SECRET).createRoom('chert-op', { metadata: '{"chert_call":"c"}', maxParticipants: 2, emptyTimeout: 60, agentName: 'support', agentMetadata: '{"m":1}' });
    assert.deepEqual(room, { name: 'chert-op', sid: 'RM_1' });
    assert.equal(s.seen.length, 1); assert.equal(s.seen[0]!.method, 'CreateRoom');
    const body = s.seen[0]!.body;
    assert.equal(body.name, 'chert-op'); assert.equal(body.maxParticipants, 2); assert.equal(body.emptyTimeout, 60); assert.equal(body.metadata, '{"chert_call":"c"}');
    assert.deepEqual(body.agents, [{ agentName: 'support', metadata: '{"m":1}' }]);
    // The request is signed with a short-lived token; the secret itself is never sent.
    assert.ok(!JSON.stringify(s.seen).includes(SECRET));
    await new TokenVerifier(KEY, SECRET).verify(s.seen[0]!.authorization.replace('Bearer ', ''));
  } finally { await s.close(); }
});

test('livekit: only participants of kind AGENT are reported as agents', async () => {
  const s = await server(() => ({ json: { participants: [{ identity: 'chert-bridge-1', kind: 'STANDARD' }, { identity: 'sip-1', kind: 'SIP' }, { identity: 'agent-AJ_9', kind: 'AGENT' }, { identity: 'no-kind' }] } }));
  try {
    assert.deepEqual(await liveKitDispatchAPI(s.url, KEY, SECRET).listParticipants('room'), [
      { identity: 'chert-bridge-1', kind: 'standard' }, { identity: 'sip-1', kind: 'standard' }, { identity: 'agent-AJ_9', kind: 'agent' }, { identity: 'no-kind', kind: 'standard' }]);
  } finally { await s.close(); }
});

test('livekit: deleting a room that is already gone succeeds; any other failure is raised', async () => {
  const gone = await server(() => ({ status: 404, json: { code: 'not_found', msg: 'room not found' } }));
  try { await liveKitDispatchAPI(gone.url, KEY, SECRET).deleteRoom('room'); } finally { await gone.close(); }
  for (const status of [401, 500]) {
    const failing = await server(() => ({ status, json: { code: 'internal', msg: 'x' } }));
    try { await assert.rejects(liveKitDispatchAPI(failing.url, KEY, SECRET).deleteRoom('room')); } finally { await failing.close(); }
  }
});

test('livekit: a rejected key surfaces as an error from createRoom, not as an empty room', async () => {
  const s = await server(() => ({ status: 401, json: { code: 'unauthenticated', msg: 'invalid token' } }));
  try { await assert.rejects(liveKitDispatchAPI(s.url, KEY, SECRET).createRoom('r', { metadata: '', maxParticipants: 2, emptyTimeout: 60, agentName: 'a', agentMetadata: '' })); }
  finally { await s.close(); }
});

test('livekit: a room that no longer exists has no participants (not an error), so a closed warm room is noticed', async () => {
  const s = await server(() => ({ status: 404, json: { code: 'not_found', msg: 'requested room does not exist' } }));
  try { assert.deepEqual(await liveKitDispatchAPI(s.url, KEY, SECRET).listParticipants('gone'), []); } finally { await s.close(); }
  const failing = await server(() => ({ status: 500, json: { code: 'internal', msg: 'x' } }));
  try { await assert.rejects(liveKitDispatchAPI(failing.url, KEY, SECRET).listParticipants('room')); } finally { await failing.close(); }
});

test('livekit: Muse reads publication evidence, updates administrative metadata and allows cleanup grace after bridge departure', async () => {
  const s = await server((method, body) => ({ json: method === 'ListParticipants' ? { participants: [{ identity: 'agent', kind: 'AGENT',
    attributes: { 'chert.muse.ready': '1' }, tracks: [{ source: 'MICROPHONE', type: 'AUDIO', muted: false }, { source: 'CAMERA', type: 'VIDEO', muted: false }] }] }
    : { name: body.name, sid: 'RM_1' } }));
  try {
    const api = liveKitDispatchAPI(s.url, KEY, SECRET);
    const [participant] = await api.listParticipants('muse-room');
    assert.equal(participant!.attributes!['chert.muse.ready'], '1');
    assert.deepEqual(participant!.tracks, [{ source: 2, muted: false, type: 0 }, { source: 1, muted: false, type: 1 }]);
    await api.updateMetadata!('muse-room', '{"chert_muse":{"state":"bound"}}');
    assert.equal(s.seen.at(-1)!.method, 'UpdateRoomMetadata');
    await api.createRoom('muse-room', { metadata: '', maxParticipants: 2, emptyTimeout: 180, departureTimeout: 60, agentName: 'demo-agent-0', agentMetadata: '{}' });
    assert.equal(s.seen.at(-1)!.body.departureTimeout, 60);
  } finally { await s.close(); }
});
