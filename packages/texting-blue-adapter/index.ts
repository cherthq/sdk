import {ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch} from '@cherthq/imessage';

export const TEXTING_BLUE_CONTRACT = Object.freeze({
  source: 'https://docs.texting.blue/api/messages', retrieved: '2026-10-19', baseURL: 'https://api.texting.blue/v1',
});
const origin = 'https://api.texting.blue';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const publicId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const failure = (status: number, code: string, message: string) => Response.json({error: {code, message}}, {status});
const unsupported = () => failure(501, 'unsupported_feature', 'This Texting Blue operation is not supported by the Chert adapter. No message was sent.');
const unknown = () => failure(502, 'outcome_unknown', 'Send outcome is unconfirmed. Reconcile before retrying.');

function content(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000 || value.includes('\0')) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 16384 && new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes) === value;
}
function queued(value: unknown, to: string, text: string): {id: string; created_at: string} | null {
  if (!record(value) || !record(value.message) || !record(value.chat) || (value.error !== undefined && value.error !== null) || value.ok === false) return null;
  const m = value.message, c = value.chat;
  if (!publicId(m.id) || !uuid(m.chat_id) || m.status !== 'queued' || m.direction !== 'outbound' || !timestamp(m.created_at)
    || (m.delivered_at !== undefined && m.delivered_at !== null) || (m.read_at !== undefined && m.read_at !== null)
    || (m.service !== undefined && m.service !== 'unknown')
    || !Array.isArray(m.parts) || m.parts.length !== 1 || !record(m.parts[0]) || !exact(m.parts[0], ['type', 'value'])
    || m.parts[0].type !== 'text' || m.parts[0].value !== text
    || c.id !== m.chat_id || c.is_group !== false || !Array.isArray(c.handles) || c.handles.length !== 1
    || !record(c.handles[0]) || c.handles[0].address !== to) return null;
  return {id: m.id, created_at: m.created_at};
}
function fromError(error: unknown): Response {
  if (error instanceof ChertAPIError) {
    if (error.status === 400 || error.status === 422) return failure(400, 'invalid_request', 'The request was rejected before sending.');
    if (error.status === 401) return failure(401, 'unauthorized', 'The Chert credential was not accepted.');
    if (error.status === 403) return failure(403, 'forbidden', 'The Chert credential cannot send from this number.');
    if (error.status === 404) return failure(404, 'not_found', 'The "from" number is not held by this credential.');
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

/** Fetch replacement for the Texting Blue send endpoint. Never contacts Texting Blue. */
export function createTextingBlueFetch(options: {chert: ChertClientOptions}): ChertFetch {
  const client = new ChertClient(options.chert);
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname !== '/v1/messages/send' || request.method !== 'POST' || url.search || url.hash
      || url.username || url.password || [...request.headers.keys()].some(k => !['accept', 'content-type', 'x-api-key'].includes(k))) return unsupported();
    let body: unknown;
    try { body = await request.json(); } catch { return failure(400, 'invalid_request', 'Invalid JSON. No message was sent.'); }
    if (!record(body) || !exact(body, ['to', 'from', 'content'])) return unsupported();
    if (!phone(body.to) || !phone(body.from) || body.to === body.from || !content(body.content))
      return failure(400, 'invalid_request', 'Provide E.164 to/from and lossless nonblank content of at most 5,000 characters.');
    const to = body.to, from = body.from, text = body.content;
    try {
      const result = await client.requestWithResponse<unknown>('/chats', {method: 'POST', signal: request.signal,
        body: {from, to: [to], message: {parts: [{type: 'text', value: text}]}}});
      const receipt = result.status === 202 ? queued(result.data, to, text) : null;
      if (!receipt) return unknown();
      return Response.json({id: receipt.id, status: 'queued', to, from, content: text, media_url: null, created_at: receipt.created_at}, {status: 202});
    } catch (error) {
      request.signal.throwIfAborted();
      return fromError(error);
    }
  };
}
export default createTextingBlueFetch;
