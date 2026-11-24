// Runs unchanged against a clean installed npm archive (Node and Bun).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChertControlPlane, ChertApiError } from '@trychert/sdk/facetime';

const call = '11111111-1111-4111-8111-111111111111';
const operation = '22222222-2222-4222-8222-222222222222';
const body = { recipient: { type: 'phone_number', value: '+12125550102' } };
let status = 202, payload = { data: { id: operation, call_id: call, status: 'queued' } };
const requests = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push({ path: req.url, method: req.method, headers: req.headers, body: raw && JSON.parse(raw) });
  res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 307 ? { Location: '/sink' } : {}) });
  res.end(JSON.stringify(payload));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const client = new ChertControlPlane({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'fixture', projectId: 'project' });
  assert.deepEqual(await client.addCallParticipant(call, body, 'stable-add-person'), payload.data);
  assert.equal(requests[0].path, `/api/v1/calls/${call}/participants`);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, body);
  assert.equal(requests[0].headers['idempotency-key'], 'stable-add-person');
  assert.equal(requests[0].headers.authorization, 'Bearer fixture');
  assert.equal(requests[0].headers['x-chert-project-id'], 'project');
  status = 200;
  for (const state of ['queued', 'dispatching', 'submitted', 'already_present', 'failed', 'unknown']) {
    payload.data.status = state;
    assert.equal((await client.getCallParticipant(call, operation)).status, state);
    assert.equal(requests.at(-1).method, 'GET');
    assert.equal(requests.at(-1).path, `/api/v1/calls/${call}/participants/${operation}`);
    assert.equal(requests.at(-1).headers['idempotency-key'], undefined);
  }
  for (const state of ['submitted', 'already_present']) {
    payload.data.status = state;
    assert.equal((await client.addCallParticipant(call, body, 'stable-add-person')).status, state);
  }
  let before = requests.length;
  for (const invalid of [{ ...body, worker_id: 'private' }, { recipient: { type: 'email', value: 'a@example.com' } },
    { recipient: { type: 'phone_number', value: '+12125550102\n' } }, { recipient: { ...body.recipient, extra: true } }])
    await assert.rejects(client.addCallParticipant(call, invalid, 'stable-add-person'), TypeError);
  await assert.rejects(client.addCallParticipant(call, body, 'short'), TypeError);
  assert.equal(requests.length, before);
  for (const data of [{ id: operation, call_id: 'other', status: 'queued' },
    { id: operation, call_id: call, status: 'joined' }, null]) {
    payload = { data };
    await assert.rejects(client.addCallParticipant(call, body, 'stable-add-person'), { code: 'invalid_response' });
  }
  payload = { data: { id: 'other', call_id: call, status: 'submitted' } };
  await assert.rejects(client.getCallParticipant(call, operation), { code: 'invalid_response' });
  for (const [http, code] of [[409, 'participant_failed'], [502, 'participant_outcome_unknown']]) {
    status = http;
    payload = { error: { code, message: 'private-text', details: { operation_id: operation, secret: 'private-text' } } };
    before = requests.length;
    await assert.rejects(client.addCallParticipant(call, body, 'stable-add-person'), error => {
      assert.ok(error instanceof ChertApiError);
      assert.equal(error.code, code); assert.equal(error.operationId, operation);
      assert.equal(JSON.stringify(error).includes('private-text'), false);
      return true;
    });
    assert.equal(requests.length, before + 1);
  }
  payload.error.details.operation_id = 'private-text';
  await assert.rejects(client.addCallParticipant(call, body, 'stable-add-person'), error => error.operationId === undefined);
  status = 307; before = requests.length;
  await assert.rejects(client.addCallParticipant(call, body, 'stable-add-person'), { code: 'network_error' });
  assert.equal(requests.length, before + 1);
  console.log('participants consumer: passed (requests, states, validation, uncertainty, redirects)');
} finally { await new Promise(resolve => server.close(resolve)); }
