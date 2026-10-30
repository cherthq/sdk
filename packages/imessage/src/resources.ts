export type MessageService = 'imessage' | 'sms' | 'rcs' | 'unknown';
export type MessagePart =
  | { type: 'text'; value: string }
  | { type: 'media'; attachment_id?: string; url?: string; mime_type?: string; name?: string; filename?: string; size_bytes?: number }
  | { type: 'rich_link'; url: string; title?: string; summary?: string; image_url?: string; icon_url?: string };
export interface Chat {
  id: string; display_name: string | null;
  handles: { service: MessageService; address: string; status?: string }[];
  is_group: boolean; service: MessageService; health_score: number | null; created_at: string | null;
}
/** Recorded server facts, not independently verified delivery or channel evidence. */
export interface ChatMessage {
  id: string; chat_id: string; parts: MessagePart[];
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'read'; direction: 'inbound' | 'outbound';
  created_at: string; delivered_at?: string | null; read_at?: string | null; service: MessageService;
  reply_to?: { message_id: string } | null; reactions?: { from_us?: string; from_them?: string } | null;
}
/** No cursor or limit: has_more is only a truncation hint for the newest 200-message window. */
export interface ChatHistory { messages: ChatMessage[]; has_more: boolean }
export interface CreateChatRequest {
  from: string; to: string[];
  message: { parts: MessagePart[]; subject?: string };
  /** Stable caller-owned body key. Reuse only with the identical request. */
  idempotency_key: string; parallel_attachments?: boolean;
}
type ChatSnapshot = { chat: Chat; message: ChatMessage; warnings?: string[] };
/** A later recorded observation; the nested message snapshot may still be queued. */
type SettledChatOutcome =
  | { status: 'sent'; error: null; service: string; delivered: boolean; retryable: false }
  | { status: 'failed'; error: string; service?: string; delivered: false; retryable: false; code: number; transport_error?: unknown };
export type CreateChatResult =
  | (ChatSnapshot & { status?: 'queued' })
  | ((ChatSnapshot | { message_id: string }) & SettledChatOutcome)
  | { status: 'queued'; message_id: string; delivered: false; retryable: false }
  | { status: 'retrying'; error: 'send_retrying'; reason: string; attempt: number; max_attempts: number; lead_id: string; convo_id: string | null; phone_line_id: string | null }
  | { status: 'failed'; error: 'send_failed'; code: number; reason: string; lead_id: string; convo_id: string | null; phone_line_id: string | null; retryable: boolean; attempts: number };
export type MessageLookup = {
  id: string; phone: string; chat_id: string | null; lead_id: string | null;
  convo_id: string | null; phone_line_id: string | null; created_at: string;
} & (
  | { status: 'received'; error: null; chat_id: string; lead_id: string; direction: 'inbound' | 'outbound'; text: string; parts?: MessagePart[]; message_guid: string }
  | { status: 'queued' | 'sent' | 'duplicate' | 'failed'; error: string | null;
      idempotency_key: string | null; external_id: string | null;
      /** Opaque recorded public payloads, not the chat/history message shape. May contain sensitive message content. */
      request: Record<string, unknown> | null; response: Record<string, unknown> | null;
      service?: string; delivered?: boolean; retryable?: boolean; code?: number; transport_error?: unknown }
);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const optionalStrings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => v[k] === undefined || typeof v[k] === 'string');
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const service = (v: unknown): v is MessageService => v === 'imessage' || v === 'sms' || v === 'rcs' || v === 'unknown';
function isPart(v: unknown): v is MessagePart {
  if (!record(v)) return false;
  if (v.type === 'text') return typeof v.value === 'string';
  if (v.type === 'media') return optionalStrings(v, ['attachment_id', 'url', 'mime_type', 'name', 'filename'])
    && (v.size_bytes === undefined || typeof v.size_bytes === 'number' && Number.isFinite(v.size_bytes));
  return v.type === 'rich_link' && typeof v.url === 'string' && optionalStrings(v, ['title', 'summary', 'image_url', 'icon_url']);
}
function isChat(v: unknown): v is Chat {
  return record(v) && typeof v.id === 'string' && nullableString(v.display_name) && typeof v.is_group === 'boolean'
    && service(v.service) && (v.health_score === null || typeof v.health_score === 'number' && Number.isFinite(v.health_score))
    && nullableString(v.created_at) && Array.isArray(v.handles) && v.handles.every(h => record(h) && service(h.service)
      && typeof h.address === 'string' && optionalStrings(h, ['status']));
}
function isChatMessage(v: unknown): v is ChatMessage {
  return record(v) && strings(v, ['id', 'chat_id', 'created_at']) && typeof v.status === 'string'
    && ['queued', 'sent', 'delivered', 'failed', 'read'].includes(v.status)
    && (v.direction === 'inbound' || v.direction === 'outbound') && service(v.service)
    && Array.isArray(v.parts) && v.parts.every(isPart)
    && ['delivered_at', 'read_at'].every(k => v[k] === undefined || nullableString(v[k]))
    && (v.reply_to === undefined || v.reply_to === null || record(v.reply_to) && typeof v.reply_to.message_id === 'string')
    && (v.reactions === undefined || v.reactions === null || record(v.reactions) && optionalStrings(v.reactions, ['from_us', 'from_them']));
}
export function isChatHistory(v: unknown): v is ChatHistory {
  return record(v) && typeof v.has_more === 'boolean' && Array.isArray(v.messages) && v.messages.every(isChatMessage);
}
export function isCreateChatResult(v: unknown): v is CreateChatResult {
  if (!record(v)) return false;
  const snapshot = isChat(v.chat) && isChatMessage(v.message)
    && (v.warnings === undefined || Array.isArray(v.warnings) && v.warnings.every(w => typeof w === 'string'));
  if ((snapshot || typeof v.message_id === 'string') && v.retryable === false) {
    if (v.status === 'sent') return v.error === null && typeof v.service === 'string' && typeof v.delivered === 'boolean';
    if (v.status === 'failed') return typeof v.error === 'string' && optionalStrings(v, ['service']) && v.delivered === false
      && typeof v.code === 'number' && Number.isFinite(v.code);
  }
  if (snapshot) return v.status === undefined || v.status === 'queued';
  if (v.status === 'queued') return typeof v.message_id === 'string' && v.delivered === false && v.retryable === false;
  if (typeof v.reason !== 'string' || typeof v.lead_id !== 'string' || !nullableString(v.convo_id) || !nullableString(v.phone_line_id)) return false;
  if (v.status === 'retrying') return v.error === 'send_retrying' && Number.isInteger(v.attempt) && Number.isInteger(v.max_attempts);
  return v.status === 'failed' && v.error === 'send_failed' && typeof v.code === 'number' && Number.isFinite(v.code)
    && typeof v.retryable === 'boolean' && Number.isInteger(v.attempts);
}
export function isMessageLookup(v: unknown): v is MessageLookup {
  if (!record(v) || !strings(v, ['id', 'phone', 'created_at']) || !['chat_id', 'lead_id', 'convo_id', 'phone_line_id'].every(k => nullableString(v[k]))) return false;
  if (v.status === 'received') return v.error === null && strings(v, ['chat_id', 'lead_id', 'text', 'message_guid'])
    && (v.direction === 'inbound' || v.direction === 'outbound') && (v.parts === undefined || Array.isArray(v.parts) && v.parts.every(isPart));
  return typeof v.status === 'string' && ['queued', 'sent', 'duplicate', 'failed'].includes(v.status)
    && nullableString(v.error) && nullableString(v.idempotency_key) && nullableString(v.external_id)
    && (v.request === null || record(v.request)) && (v.response === null || record(v.response))
    && optionalStrings(v, ['service']) && ['delivered', 'retryable'].every(k => v[k] === undefined || typeof v[k] === 'boolean')
    && (v.code === undefined || typeof v.code === 'number' && Number.isFinite(v.code));
}

/** A deliberately canonical send subset. Rejects unsupported fields rather than silently ignoring policy requests. */
export function validateCreateChat(v: CreateChatRequest): void {
  const exact = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every(k => keys.includes(k));
  const phone = (p: unknown) => typeof p === 'string' && /^\+[1-9][0-9]{1,14}(?![\s\S])/.test(p);
  const recipient = (p: unknown) => phone(p) || typeof p === 'string' && p === p.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+(?![\s\S])/.test(p) && !p.includes('\0');
  const lossless = (s: string) => !s.includes('\0') && new TextDecoder().decode(new TextEncoder().encode(s)) === s;
  if (!record(v) || !exact(v, ['from', 'to', 'message', 'idempotency_key', 'parallel_attachments']) || !phone(v.from)
    || !Array.isArray(v.to) || v.to.length < 1 || v.to.length > 31 || !v.to.every(recipient)
    || typeof v.idempotency_key !== 'string' || !v.idempotency_key || v.idempotency_key.trim() !== v.idempotency_key
    || !lossless(v.idempotency_key) || new TextEncoder().encode(v.idempotency_key).byteLength > 200
    || (v.parallel_attachments !== undefined && typeof v.parallel_attachments !== 'boolean')
    || !record(v.message) || !exact(v.message, ['parts', 'subject'])
    || (v.message.subject !== undefined && (typeof v.message.subject !== 'string' || !lossless(v.message.subject)))
    || !Array.isArray(v.message.parts) || !v.message.parts.length || v.message.parts.length > 100) throw new TypeError('Invalid create chat request');
  let previousText = false;
  for (const part of v.message.parts) {
    if (!isPart(part) || !record(part) || v.to.length > 1 && part.type !== 'text') throw new TypeError('Invalid chat part');
    if (part.type === 'text') {
      if (!exact(part, ['type', 'value']) || !part.value.trim() || !lossless(part.value) || part.value.length > 10_000 || /https?:\/\//i.test(part.value) || previousText) throw new TypeError('Invalid first-message text part');
    } else if (part.type === 'media') {
      if (!exact(part, ['type', 'attachment_id', 'url', 'mime_type', 'name', 'filename', 'size_bytes']) || (!part.attachment_id && !part.url)) throw new TypeError('An uploaded attachment reference is required');
    } else if (!exact(part, ['type', 'url', 'title', 'summary', 'image_url', 'icon_url']) || !/^https?:\/\//.test(part.url)) throw new TypeError('Invalid rich link');
    previousText = part.type === 'text';
  }
}

export function validateResourceOptions(options: { signal?: AbortSignal }): void {
  if (!record(options) || Object.keys(options).some(k => k !== 'signal')
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('Only signal is supported; this resource has no query pagination');
  options.signal?.throwIfAborted();
}
