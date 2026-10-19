import {ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch} from '@cherthq/imessage';

export const CONTIGUITY_CONTRACT = Object.freeze({
  source: 'https://docs.contiguity.com/api-reference/product/imessage/send.md', retrieved: '2026-10-19',
  apiVersion: 'v2026.9.27', baseURL: 'https://api.contiguity.com/send',
});
const origin = 'https://api.contiguity.com';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const publicId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const chatId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const markup = /\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^\s*][^*]*\*|_[^\s_][^_]*_/;
const localId = (prefix: string) => prefix + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

function envelope(object: 'response' | 'error', data: Record<string, unknown>, status: number): Response {
  // id/timestamp identify this adapter response; they are not Contiguity or Chert request IDs.
  return Response.json({id: localId(object === 'error' ? 'err_' : 'req_'), timestamp: Date.now(),
    api_version: CONTIGUITY_CONTRACT.apiVersion, object, data}, {status});
}
const failure = (status: number, error: string) => envelope('error', {error, status}, status);
const unsupported = () => failure(501, 'This Contiguity operation is not supported by the Chert adapter. Nothing was sent.');
const unknown = () => failure(502, 'Outcome is unconfirmed. Reconcile before retrying.');

function text(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 16384 && new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes) === value;
}
function chatQueued(value: unknown, to: string, body: string): string | null {
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
function textQueued(value: unknown): string | null {
  if (!record(value) || !exact(value, ['success', 'message_id', 'chat_id', 'status']) || value.success !== true
    || value.status !== 'queued' || !publicId(value.message_id) || !chatId(value.chat_id)) return null;
  return value.message_id;
}
function fromError(error: unknown): Response {
  if (error instanceof ChertAPIError) {
    if (error.status === 400 || error.status === 422) return failure(400, 'Bad Request');
    if (error.status === 401) return failure(401, 'Unauthorized');
    if (error.status === 403 || error.status === 404) return failure(403, 'Forbidden');
    if (error.status === 429) return failure(429, 'Too Many Requests');
  }
  const response = unknown();
  if (error instanceof ChertAPIError && error.status === 502 && error.code === '4103'
    && record(error.data) && publicId(error.data.message_id) && chatId(error.data.chat_id)) {
    response.headers.set('X-Chert-Message-Id', error.data.message_id);
    response.headers.set('X-Chert-Chat-Id', error.data.chat_id);
  }
  return response;
}
async function json(request: Request): Promise<Record<string, unknown> | null> {
  try { const v: unknown = await request.json(); return record(v) ? v : null; } catch { return null; }
}

/** Fetch replacement for Contiguity's iMessage send and typing endpoints. Never contacts Contiguity. */
export function createContiguityFetch(options: {chert: ChertClientOptions}): ChertFetch {
  const client = new ChertClient(options.chert);
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== origin || request.method !== 'POST' || url.search || url.hash || url.username || url.password
      || [...request.headers.keys()].some(k => !['accept', 'authorization', 'content-type'].includes(k))) return unsupported();
    if (url.pathname === '/send/imessage') {
      const body = await json(request);
      if (!body) return failure(400, 'Bad Request');
      if (Object.keys(body).some(k => !['to', 'from', 'message'].includes(k))) return unsupported();
      if (!phone(body.to) || (body.from !== undefined && body.from !== null && !phone(body.from)) || body.from === body.to || !text(body.message))
        return failure(400, 'Provide an E.164 phone `to`, optional E.164 `from`, and lossless nonblank `message` within 16384 UTF-8 bytes.');
      if (markup.test(body.message)) return unsupported();
      const to = body.to, message = body.message, from = body.from ?? null;
      try {
        let id: string | null;
        if (from === null) {
          const result = await client.requestWithResponse<unknown>('/text-operations/v1', {method: 'POST', signal: request.signal, body: {phone: to, body: message}});
          id = result.status === 202 ? textQueued(result.data) : null;
        } else {
          const result = await client.requestWithResponse<unknown>('/chats', {method: 'POST', signal: request.signal,
            body: {from, to: [to], message: {parts: [{type: 'text', value: message}]}}});
          id = result.status === 202 ? chatQueued(result.data, to, message) : null;
        }
        return id ? envelope('response', {message_id: id}, 200) : unknown();
      } catch (error) { request.signal.throwIfAborted(); return fromError(error); }
    }
    if (url.pathname === '/send/imessage/typing') {
      const body = await json(request);
      if (!body) return failure(400, 'Bad Request');
      if (!exact(body, ['to', 'from', 'action']) || !phone(body.from) || !phone(body.to) || body.to === body.from
        || (body.action !== 'start' && body.action !== 'stop')) return unsupported();
      const from = body.from, to = body.to, state = body.action === 'start' ? 'typing' : 'stopped';
      try {
        const row = await client.request<unknown>('/typing', {method: 'POST', signal: request.signal, body: {from, to, state}});
        if (!record(row) || row.from !== from || row.to !== to || row.state !== state || row.applied !== true || !chatId(row.chat_id)
          || row.success === false || row.ok === false || (row.error !== undefined && row.error !== null)) return unknown();
        return envelope('response', {status: state === 'typing' ? 'started' : 'stopped'}, 200);
      } catch (error) { request.signal.throwIfAborted(); return fromError(error); }
    }
    return unsupported();
  };
}
export default createContiguityFetch;
