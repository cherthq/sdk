import type { MessageContent } from 'sendblue/resources/messages/messages';

type Signature = { timestamp: number; hex: string };
function signature(value: string, legacy: boolean): Signature {
  const match = (legacy ? /^v1,(0|[1-9]\d*),([a-f0-9]{64})$/i : /^t=(0|[1-9]\d*),v1=([a-f0-9]{64})$/i).exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Malformed Chert webhook signature');
  return { timestamp: Number(match[1]), hex: match[2].toLowerCase() };
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Verify a direct Mac Chert webhook before converting its supported plaintext event. */
export async function unwrapChert(rawBody: string, inputHeaders: Headers | Record<string, string>, options: { secret: string }): Promise<{ eventId: string; message: MessageContent }> {
  if (typeof options?.secret !== 'string' || !options.secret.length) throw new TypeError('An explicit Chert webhook secret is required');
  const headers = new Headers(inputHeaders);
  const modern = headers.get('x-webhook-signature');
  const legacy = headers.get('x-chert-signature');
  if (!modern && !legacy) throw new Error('Chert webhook signature is missing');
  const parsed = signature(modern ?? legacy!, !modern);
  if (modern && legacy) {
    const other = signature(legacy, true);
    if (other.timestamp !== parsed.timestamp || other.hex !== parsed.hex) throw new Error('Conflicting Chert webhook signatures');
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > 300) throw new Error('Chert webhook timestamp is outside the replay window');
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', encoder.encode(options.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(parsed.hex.match(/../g)!, pair => parseInt(pair, 16));
  if (!await globalThis.crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${parsed.timestamp}.${rawBody}`))) {
    throw new Error('Chert webhook authentication failed');
  }
  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { throw new Error('Authenticated Chert webhook is not valid JSON'); }
  if (!record(event) || event.type !== 'message_received' || typeof event.event_id !== 'string' || !record(event.message)) throw new Error('Unsupported Chert webhook event');
  const message = event.message;
  // Cloud fanout preserves the native identity and adds signed routing context.
  // The configured subscription secret is the tenant boundary; no tenant ID is
  // present in this wire, so do not manufacture one from chat/line identifiers.
  if (event.event !== undefined || event.chat_id !== undefined) {
    const identity = (value: unknown): value is string => typeof value === 'string'
      && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value);
    if (event.event !== 'message_received' || !identity(event.event_id) || !identity(message.guid) || !identity(event.chat_id) || !identity(event.phone_line_id)
      || message.phone_line_id !== event.phone_line_id
      || event.timestamp !== new Date(parsed.timestamp * 1000).toISOString()) {
      throw new Error('Unsupported Chert cloud webhook context');
    }
  }

  if (typeof message.guid !== 'string' || !message.guid || event.event_id !== `recv:${message.guid}`
    // EventBuilder boxes a BOOL variable: present metadata must identify a DM.
    || (message.is_group !== undefined && message.is_group !== false)
    || (message.chat_participants !== undefined && (!Array.isArray(message.chat_participants)
      || message.chat_participants.length > 1
      || message.chat_participants.some(peer => typeof peer !== 'string' || peer !== message.recipient)))
    || message.role !== 'inbound' || message.status !== 'received' || !Array.isArray(message.parts) || message.parts.length !== 1
    || typeof message.recipient !== 'string' || /^\+[1-9]\d{1,14}$/.exec(message.recipient)?.[0] !== message.recipient) throw new Error('Unsupported Chert incoming message identity');
  const part: unknown = message.parts[0];
  if (!record(part) || part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()
    || Object.keys(part).some(key => !['type', 'text', 'value'].includes(key))
    || (part.value !== undefined && part.value !== part.text) || (message.text !== undefined && message.text !== part.text)) throw new Error('Only unmodified single-part Chert plaintext is supported');
  for (const name of ['x-webhook-event', 'x-chert-event']) {
    if (headers.has(name) && headers.get(name) !== event.type) throw new Error('Chert event header does not match its signed body');
  }
  for (const name of ['x-webhook-event-id', 'x-chert-event-id']) {
    if (headers.has(name) && headers.get(name) !== event.event_id) throw new Error('Chert event identity does not match its signed body');
  }
  for (const name of ['x-webhook-timestamp', 'x-chert-timestamp']) {
    if (headers.has(name) && headers.get(name) !== String(parsed.timestamp)) throw new Error('Chert timestamp header does not match its signature');
  }
  return { eventId: event.event_id, message: {
    message_handle: message.guid, content: part.text, status: 'RECEIVED', is_outbound: false, from_number: message.recipient,
  } };
}
