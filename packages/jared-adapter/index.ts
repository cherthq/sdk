import {ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch} from '@cherthq/imessage';

export const JARED_CONTRACT = Object.freeze({
  source: 'https://github.com/ZekeSnider/Jared/blob/969f145321deacfc41401fb7728053f240dad465/Jared/JaredWebServer.swift',
  commit: '969f145321deacfc41401fb7728053f240dad465', retrieved: '2026-10-19',
});
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();
const sendId = (v: unknown): v is string => typeof v === 'string' && /^(?:[a-f0-9]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(v);
const chatId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v);
const plain = (status: number, message: string) => new Response(message, {status, headers: {'content-type': 'text/plain; charset=utf-8'}});
const unsupported = () => plain(501, 'Unsupported Jared request for the Chert adapter. No message was sent.');

function text(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 16384 && new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes) === value;
}
function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port
    || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new TypeError('Jared origin must be an explicit loopback http://host:port with no path');
  return url.origin;
}

/** Fetch replacement for Jared's local `POST /message`. Never contacts Jared or Messages.app. */
export function createJaredFetch(options: {chert: ChertClientOptions; origin: string}): ChertFetch {
  const client = new ChertClient(options.chert);
  const origin = loopbackOrigin(options.origin);
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== origin || url.pathname !== '/message' || request.method !== 'POST' || url.search || url.hash
      || url.username || url.password || [...request.headers.keys()].some(k => !['accept', 'content-type'].includes(k))) return unsupported();
    let body: unknown;
    try { body = await request.json(); } catch { return plain(400, 'Invalid JSON. No message was sent.'); }
    if (!record(body) || !exact(body, ['body', 'recipient']) || !record(body.body) || !exact(body.body, ['message'])
      || !record(body.recipient) || !exact(body.recipient, ['handle'])) return unsupported();
    const handle = body.recipient.handle, message = body.body.message;
    if (!phone(handle)) return unsupported();
    if (!text(message)) return plain(400, 'A lossless nonblank text body within 16384 UTF-8 bytes is required.');
    try {
      await client.sendText({phone: handle, body: message}, {signal: request.signal});
      return new Response(null, {status: 200});
    } catch (error) {
      request.signal.throwIfAborted();
      if (error instanceof ChertAPIError && (error.status === 400 || error.status === 422)) return plain(400, 'The request was rejected before sending.');
      if (error instanceof ChertAPIError && error.code === 'unconfirmed_text_outcome') return plain(502, 'Send outcome unconfirmed; reconcile before retrying.');
      const response = plain(502, 'Send request did not complete; reconcile before retrying.');
      if (error instanceof ChertAPIError && error.status === 502 && error.code === '4103' && record(error.data)
        && sendId(error.data.message_id)) {
        // CRM's flat /send failure body carries message_id only; chat_id when present.
        response.headers.set('X-Chert-Message-Id', error.data.message_id);
        if (chatId(error.data.chat_id)) response.headers.set('X-Chert-Chat-Id', error.data.chat_id);
      }
      return response;
    }
  };
}
export default createJaredFetch;
