import {ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch} from '@cherthq/imessage';

export const BLUEREACHER_CONTRACT = Object.freeze({
  source: 'https://bluereacher.com/docs/api-reference/send-message', retrieved: '2026-10-19', baseURL: 'https://api.bluereacher.com/v1',
});
const origin = 'https://api.bluereacher.com';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const publicId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
// Blue Reacher does not publish its error envelope; this shape mirrors its success envelope.
const failure = (status: number, error: string, message: string) => Response.json({success: false, error, message}, {status});
const unsupported = () => failure(501, 'unsupported_feature', 'This Blue Reacher operation is not supported by the Chert adapter. Nothing was sent.');
const unknown = () => failure(502, 'outcome_unknown', 'Send outcome is unconfirmed. Reconcile before retrying.');

function text(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 16384 && new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes) === value;
}
function line(inventory: unknown, id: string): {handle: string; sendable: boolean} | null | 'invalid' {
  if (!record(inventory) || !Array.isArray(inventory.phone_numbers)) return 'invalid';
  const matches = inventory.phone_numbers.filter(row => record(row) && typeof row.id === 'string' && row.id.toLowerCase() === id);
  if (matches.length === 0) return null;
  const row = matches[0];
  if (matches.length !== 1 || !record(row) || !uuid(row.id) || !phone(row.phone_number) || row.service !== 'imessage'
    || typeof row.is_active !== 'boolean' || !Array.isArray(row.capabilities) || !row.capabilities.every(c => typeof c === 'string')) return 'invalid';
  return {handle: row.phone_number, sendable: row.is_active && row.capabilities.includes('imessage') && row.capabilities.includes('send')};
}
function queued(value: unknown, to: string, body: string): string | null {
  if (!record(value) || !record(value.message) || !record(value.chat) || (value.error !== undefined && value.error !== null) || value.ok === false) return null;
  const m = value.message, c = value.chat;
  if (!publicId(m.id) || !uuid(m.chat_id) || m.status !== 'queued' || m.direction !== 'outbound' || !timestamp(m.created_at)
    || (m.delivered_at !== undefined && m.delivered_at !== null) || (m.read_at !== undefined && m.read_at !== null)
    || (m.service !== undefined && m.service !== 'unknown')
    || !Array.isArray(m.parts) || m.parts.length !== 1 || !record(m.parts[0]) || !exact(m.parts[0], ['type', 'value'])
    || m.parts[0].type !== 'text' || m.parts[0].value !== body
    || c.id !== m.chat_id || c.is_group !== false || !Array.isArray(c.handles) || c.handles.length !== 1
    || !record(c.handles[0]) || c.handles[0].address !== to) return null;
  return m.id;
}
function fromError(error: unknown): Response {
  if (error instanceof ChertAPIError) {
    if (error.status === 400 || error.status === 422) return failure(400, 'invalid_request', 'The request was rejected before sending.');
    if (error.status === 401) return failure(401, 'invalid_api_key', 'The Chert credential was not accepted.');
    if (error.status === 403 || error.status === 404) return failure(403, 'device_not_owned', 'device_id is not held by this credential.');
    if (error.status === 429) return failure(429, 'rate_limited', 'The request was rate limited.');
  }
  const response = unknown();
  if (error instanceof ChertAPIError && error.status === 502 && error.code === '4103'
    && record(error.data) && publicId(error.data.message_id) && uuid(error.data.chat_id)) {
    response.headers.set('X-Chert-Message-Id', error.data.message_id);
    response.headers.set('X-Chert-Chat-Id', error.data.chat_id);
  }
  return response;
}

/** Fetch replacement for Blue Reacher instant 1:1 text sends. Never contacts Blue Reacher. */
export function createBlueReacherFetch(options: {chert: ChertClientOptions}): ChertFetch {
  const client = new ChertClient(options.chert);
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname !== '/v1/messages' || request.method !== 'POST' || url.search || url.hash
      || url.username || url.password || [...request.headers.keys()].some(k => !['accept', 'authorization', 'content-type'].includes(k))) return unsupported();
    let body: unknown;
    try { body = await request.json(); } catch { return failure(400, 'invalid_json', 'Body malformed, empty or not a JSON object.'); }
    if (!record(body)) return failure(400, 'invalid_json', 'Body malformed, empty or not a JSON object.');
    if (!exact(body, ['to', 'message', 'send_mode', 'device_id']) || body.send_mode !== 'instant' || !uuid(body.device_id)) return unsupported();
    if (!phone(body.to)) return failure(400, 'invalid_phone', 'to must be an E.164 phone number.');
    if (!text(body.message)) return failure(400, 'message_required', 'Provide lossless nonblank text within 16384 UTF-8 bytes.');
    const to = body.to, message = body.message, deviceId = body.device_id.toLowerCase();
    try {
      const selected = line(await client.request<unknown>('/phone-numbers', {signal: request.signal}), deviceId);
      if (selected === 'invalid') return failure(502, 'incompatible_response', 'Chert line inventory cannot establish device_id. Nothing was sent.');
      if (!selected) return failure(403, 'device_not_owned', 'device_id is not held by this credential.');
      if (!selected.sendable) return failure(409, 'no_online_device', 'The selected line cannot send iMessage now.');
      if (selected.handle === to) return failure(400, 'invalid_phone', 'to must differ from the sending line.');
      request.signal.throwIfAborted();
      // Inventory lookup then explicit-from send is not an atomic line-identity guard.
      const result = await client.requestWithResponse<unknown>('/chats', {method: 'POST', signal: request.signal,
        body: {from: selected.handle, to: [to], message: {parts: [{type: 'text', value: message}]}}});
      const id = result.status === 202 ? queued(result.data, to, message) : null;
      return id ? Response.json({success: true, message_id: id, mode: 'instant', status: 'dispatched', device_id: deviceId}) : unknown();
    } catch (error) { request.signal.throwIfAborted(); return fromError(error); }
  };
}
export default createBlueReacherFetch;
