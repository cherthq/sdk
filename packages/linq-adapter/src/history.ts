import {frozenMediaPart} from './media.js';
import type { Message } from '@linqapp/sdk/resources/messages/messages';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validID = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && !/[%/\\?#\x00-\x20\x7f]/.test(value) && value !== '.' && value !== '..';
export const historyCursor = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
const invalid = () => new Error('Incompatible recorded history');
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const day = value.slice(0, 10), parsedDay = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(parsedDay) && new Date(parsedDay).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}
export function recordedMessage(value: unknown, expected: { id?: string; chatId?: string; baseURL?: string }): Message {
  if (!record(value) || !validID(value.id) || (expected.id !== undefined && value.id !== expected.id)) throw invalid();
  const chatID = value.chat_id ?? value.lead_id;
  if (!validID(chatID) || (value.chat_id !== undefined && value.lead_id !== undefined && value.chat_id !== value.lead_id)
    || (expected.chatId !== undefined && chatID !== expected.chatId)
    || !timestamp(value.created_at) || !timestamp(value.updated_at)
    || (value.direction !== 'inbound' && value.direction !== 'outbound')) throw invalid();
  const status = value.status;
  if (status !== 'pending' && status !== 'queued' && status !== 'sent' && status !== 'delivered'
    && status !== 'received' && status !== 'read' && status !== 'failed') throw invalid();
  const message: Message = { id: value.id, chat_id: chatID, created_at: value.created_at, updated_at: value.updated_at,
    delivery_status: status, is_from_me: value.direction === 'outbound', is_read: status === 'read',
    // These deprecated booleans are defined by Linq's delivery_status enum.
    is_delivered: status === 'delivered' || status === 'read' };
  if (value.parts !== undefined) {
    if (!Array.isArray(value.parts) || value.parts.some(part => !record(part) || part.type !== 'text'
      || typeof part.value !== 'string' || Object.keys(part).some(key => !['type', 'value', 'reactions'].includes(key))
      || (part.reactions !== undefined && part.reactions !== null))) throw invalid();
    // Preserve the optional field only when every part has actual nullable reaction evidence.
    if (value.parts.every(part => record(part) && part.reactions === null))
      message.parts = value.parts.map(part => ({ type: 'text', value: (part as { value: string }).value, reactions: null }));
  }
  const requestParts = record(value.request) && record(value.request.message) ? value.request.message.parts : undefined;
  const attachments = record(value.response) ? value.response.attachments : undefined;
  const requestedMedia = Array.isArray(requestParts) && requestParts.some(part => record(part) && part.type === 'media');
  if (requestedMedia || attachments !== undefined) {
    if (value.direction !== 'outbound' || value.parts !== undefined || !expected.baseURL
      || !Array.isArray(requestParts) || requestParts.length !== 1 || !record(requestParts[0])
      || Object.keys(requestParts[0]).sort().join(',') !== 'attachment_id,type' || requestParts[0].type !== 'media'
      || typeof requestParts[0].attachment_id !== 'string' || !/^[a-f0-9]{48}(?![\s\S])/.test(requestParts[0].attachment_id)
      || !Array.isArray(attachments) || attachments.length !== 1) throw invalid();
    const part = frozenMediaPart(attachments[0], requestParts[0].attachment_id, expected.baseURL);
    if (!part) throw invalid();
    message.parts = [part];
  }
  for (const field of ['sent_at', 'delivered_at', 'read_at'] as const) {
    if (value[field] !== undefined) {
      if (value[field] !== null && !timestamp(value[field])) throw invalid();
      message[field] = value[field] as string | null;
    }
  }
  return message;
}
export function recordedPage(value: unknown, chatId: string, limit: number, cursor: string | null, baseURL?: string): { messages: Message[]; next_cursor: string } {
  if (!record(value) || !Array.isArray(value.messages) || value.messages.length > limit || typeof value.has_more !== 'boolean'
    || (value.has_more ? !value.messages.length || !historyCursor(value.next_cursor) || value.next_cursor === cursor : value.next_cursor !== null)) throw invalid();
  const messages = value.messages.map(message => recordedMessage(message, { chatId, baseURL }));
  if (new Set(messages.map(message => message.id)).size !== messages.length) throw invalid();
  return { messages, next_cursor: value.has_more ? value.next_cursor as string : '' };
}
