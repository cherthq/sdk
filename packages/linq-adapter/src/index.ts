import {validKey,canonicalChat,linqRequestContext} from './idempotency.js';
import {queuedMediaMessage} from './media.js';
import { attachmentMetadata, validAttachmentCreate, createdAttachment } from './attachments.js';
import { historyCursor, recordedMessage, recordedPage } from './history.js';
import OfficialLinq, { type ClientOptions } from '@linqapp/sdk';
import { ChertClient, ChertAPIError, type ChertClientOptions } from '@cherthq/imessage';

export * from '@linqapp/sdk';

export type LinqAdapterOptions = ClientOptions & { chert: ChertClientOptions };
const unsupported = (message: string) => Response.json({ error: { code: 'unsupported_provider_contract', message } }, { status: 501 });
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const statuses = new Set(['queued', 'sent', 'delivered', 'failed', 'read']);

function chatIdentifier(segment: string): string | null {
  try {
    const id = decodeURIComponent(segment);
    return id.length > 0 && id.length <= 128 && !/[%/\\?#\x00-\x20\x7f]/.test(id) && id !== '.' && id !== '..' ? id : null;
  } catch { return null; }
}

function assignedNumbers(value: unknown): { phone_numbers: Array<{ id: string; phone_number: string }> } | null {
  if (!object(value) || !Array.isArray(value.phone_numbers)) return null;
  const ids = new Set<string>(), numbers = new Set<string>();
  const rows: Array<{ id: string; phone_number: string }> = [];
  for (const row of value.phone_numbers) {
    if (!object(row) || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id)
      || typeof row.phone_number !== 'string' || !/^\+[1-9]\d{1,14}$/.test(row.phone_number)
      || ids.has(row.id) || numbers.has(row.phone_number)) return null;
    ids.add(row.id); numbers.add(row.phone_number);
    rows.push({ id: row.id, phone_number: row.phone_number });
  }
  return { phone_numbers: rows };
}

/** Uses upstream types and error classes; transports only explicitly supported operations. */
export default class ChertLinqAdapter extends OfficialLinq {
  private readonly adapterOptions: LinqAdapterOptions;
  override request<Rsp>(options: Parameters<OfficialLinq['request']>[0], remainingRetries?: number | null) {
    if (remainingRetries != null && remainingRetries !== 0) throw new TypeError('Explicit retry attempts are unsupported for Chert sends');
    return super.request<Rsp>(options, remainingRetries);
  }
  override withOptions(options: Partial<ClientOptions>): this {
    return new ChertLinqAdapter({ ...this.adapterOptions, ...options, chert: this.adapterOptions.chert }) as this;
  }
  protected override async prepareOptions(options: Parameters<OfficialLinq['buildRequest']>[0]): Promise<void> {
    if (this.maxRetries !== 0 || (options.maxRetries !== undefined && options.maxRetries !== 0)) throw new Error('Linq adapter requires maxRetries: 0');
    const historyURL = new URL(options.path, 'https://linq-adapter.invalid');
    const historyPath = historyURL.pathname;
    const pathKeys = [...historyURL.searchParams.keys()];
    if (/^\/v3\/messages\/[^/]+\/reactions$/.test(historyPath) && (options.method.toUpperCase() !== 'POST'
      || historyURL.search || options.query !== undefined || options.headers !== undefined || options.idempotencyKey !== undefined
      || options.stream || options.__binaryResponse)) throw new Error('Reactions support no request overrides');
    if (historyPath === '/v3/attachments' && (options.method.toUpperCase() !== 'POST' || historyURL.search
      || options.query !== undefined || options.headers !== undefined || options.idempotencyKey !== undefined
      || options.stream || options.__binaryResponse)) throw new Error('Attachment create supports no request overrides');
    if (/^\/v3\/attachments\/[^/]+$/.test(historyPath) && (options.method.toUpperCase() !== 'GET'
      || historyURL.search || options.body !== undefined || options.query !== undefined || options.headers !== undefined
      || options.idempotencyKey !== undefined || options.stream || options.__binaryResponse)) {
      throw new Error('Attachment reads support no query, body, custom headers, idempotency, streaming or binary response');
    }
    if (options.method.toUpperCase() === 'GET' && (/^\/v3\/chats\/[^/]+\/messages$/.test(historyPath) || /^\/v3\/messages\/[^/]+$/.test(historyPath))
      && new Set(pathKeys).size !== pathKeys.length) throw new Error('Duplicate history query parameters are unsupported');
    if (options.method.toUpperCase() === 'GET' && (/^\/v3\/chats\/[^/]+\/messages$/.test(historyPath) || /^\/v3\/messages\/[^/]+$/.test(historyPath))
      && (options.body !== undefined || options.headers !== undefined || options.idempotencyKey !== undefined || options.stream || options.__binaryResponse)) {
      throw new Error('History reads support no body, custom headers, idempotency keys, streaming or binary response');
    }
    if (options.path === '/v3/phonenumbers' && (options.body !== undefined || options.query !== undefined
      || options.headers !== undefined || options.idempotencyKey !== undefined || options.stream || options.__binaryResponse)) {
      throw new Error('Assigned-number reads support no body, query, custom headers, idempotency keys, streaming or binary response');
    }
    if (/^\/v3\/chats\/[^/]+\/(typing|read)$/.test(options.path)) {
      // Upstream control methods supply only Accept through their header builder.
      const headers = options.headers as { values?: Headers; nulls?: Set<string> } | undefined;
      if (options.body !== undefined || options.query !== undefined || options.idempotencyKey !== undefined || options.stream || options.__binaryResponse
        || (headers && (!(headers.values instanceof Headers) || headers.nulls?.size
          || [...headers.values].some(([key, value]) => key !== 'accept' || value !== '*/*')))) {
        throw new Error('Chat controls support no body, query, custom headers, idempotency keys, binary responses or streaming');
      }
    }
    if (object(options.body) && object(options.body.message) && Array.isArray(options.body.message.parts)
      && options.body.message.parts.some(part=>object(part)&&part.type==='media') && (options.query!==undefined||options.__binaryResponse))
      throw new Error('Media sends support no query or binary-response overrides');
    if (/^\/v3\/chats\/[^/]+\/messages$/.test(options.path) && options.method.toUpperCase() === 'POST') {
      if (options.headers !== undefined || options.stream || options.query !== undefined || options.__binaryResponse) throw new Error('Send request overrides are unsupported');
      if (options.idempotencyKey !== undefined) {
        if (!validKey(options.idempotencyKey) || !object(options.body) || !object(options.body.message)) throw new Error('Invalid idempotency key');
        const original = options.body.message.idempotency_key;
        if (original !== undefined && original !== options.idempotencyKey) throw new Error('Conflicting idempotency keys');
        options.body = {...options.body,message:{...options.body.message,idempotency_key:options.idempotencyKey}};
        options.idempotencyKey = undefined;
      }
    }
  }
  constructor(options: LinqAdapterOptions) {
    if (!options?.chert?.baseURL || !options.chert.apiKey) throw new Error('Explicit Chert baseURL and apiKey are required');
    if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error('Linq adapter requires maxRetries: 0; uncertain sends must not be retried');
    if (options.defaultHeaders || options.defaultQuery) throw new Error('Default headers and query parameters are not supported by this adapter');
    const { chert: chertOptions, ...upstream } = options;
    const chert = { ...chertOptions };
    const client = new ChertClient(chert);
    super({ ...upstream, apiKey: 'chert-adapter-local', baseURL: 'https://linq-adapter.invalid', maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin !== 'https://linq-adapter.invalid' || url.hash) return unsupported('Only the configured virtual provider origin is supported. No request was sent.');
        const reactionPath = /^\/v3\/messages\/([^/]+)\/reactions$/.exec(url.pathname);
        if (request.method === 'POST' && reactionPath && !url.search) {
          const id = chatIdentifier(reactionPath[1]!);
          let body: unknown;
          try { body = await request.json(); } catch { return unsupported('Invalid reaction. No request was sent.'); }
          if (!id || !object(body) || !only(body, ['operation', 'type', 'part_index'])
            || typeof body.operation !== 'string' || !['add', 'remove'].includes(body.operation) || typeof body.type !== 'string'
            || !['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'].includes(body.type)
            || (body.part_index !== undefined && body.part_index !== 0)) return unsupported('Only standard reactions on part zero are supported. No request was sent.');
          try {
            const lookup = await client.request<unknown>(`/messages/${encodeURIComponent(id)}`, { signal: request.signal });
            const chatId = object(lookup) ? lookup.chat_id ?? lookup.lead_id : undefined;
            if (!object(lookup) || lookup.id !== id || typeof chatId !== 'string'
              || (lookup.chat_id !== undefined && lookup.lead_id !== undefined && lookup.chat_id !== lookup.lead_id)
              || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/i.test(chatId))
              return Response.json({ error: { code: 'incompatible_response', message: 'Owned message identity unavailable' } }, { status: 502 });
            const result = await client.requestWithResponse<unknown>(`/chats/${chatId}/messages/${encodeURIComponent(id)}/reactions`,
              { method: 'POST', body: { reaction: body.type, remove: body.operation === 'remove', part_index: 0 }, signal: request.signal });
            const ack = result.data;
            if (result.status !== 202 || !object(ack) || Object.keys(ack).sort().join() !== 'chat_id,message_id,operation_id,status'
              || ack.chat_id !== chatId || ack.message_id !== id || ack.status !== 'acknowledged'
              || typeof ack.operation_id !== 'string' || !/^[a-f0-9]{32}(?![\s\S])/.test(ack.operation_id))
              return Response.json({ error: { code: 'outcome_unknown', message: 'Reaction acceptance unconfirmed; do not retry' } }, { status: 502 });
            return Response.json({ status: 'accepted' });
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } },
              { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'outcome_unknown', message: 'Reaction outcome unconfirmed; do not retry' } }, { status: 502 });
          }
        }
        if (request.method === 'GET' && url.pathname === '/v3/phonenumbers' && !url.search) {
          try {
            const response = assignedNumbers(await client.request<unknown>('/phone-numbers', { signal: request.signal }));
            if (!response) return Response.json({ error: { code: 'incompatible_response', message: 'Chert returned invalid assigned-number identities' } }, { status: 502 });
            return Response.json(response);
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'transport_unavailable', message: 'Chert assigned-number read did not complete' } }, { status: 502 });
          }
        }
        if (request.method === 'POST' && url.pathname === '/v3/attachments' && !url.search) {
          let body: unknown;
          try { body = await request.json(); } catch { return unsupported('Invalid attachment registration. No request was sent.'); }
          if (!validAttachmentCreate(body)) return unsupported('Only supported filename, MIME type and size up to 100 MiB are accepted. No request was sent.');
          try {
            const response = createdAttachment(await client.request<unknown>('/attachments', { method: 'POST', body, signal: request.signal }), body, chert);
            return response ? Response.json(response) : Response.json({ error: { code: 'incompatible_response', message: 'Attachment registration response is incompatible; do not retry automatically' } }, { status: 502 });
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'outcome_unknown', message: 'Attachment registration outcome is unknown; do not retry automatically' } }, { status: 502 });
          }
        }
        const attachmentRead = /^\/v3\/attachments\/([^/]+)$/.exec(url.pathname);
        if (request.method === 'GET' && attachmentRead && !url.search) {
          const id = attachmentRead[1]!;
          if (!/^[a-f0-9]{48}$/.test(id)) return unsupported('Only actual Chert attachment IDs are supported. No request was sent.');
          try {
            const result = attachmentMetadata(await client.request<unknown>(`/attachments/${id}`, { signal: request.signal }), id, chert.baseURL);
            return result ? Response.json(result) : Response.json({ error: { code: 'incompatible_response', message: 'Chert attachment metadata is incomplete or incompatible' } }, { status: 502 });
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'transport_unavailable', message: 'Chert attachment read did not complete' } }, { status: 502 });
          }
        }
        const listHistory = /^\/v3\/chats\/([^/]+)\/messages$/.exec(url.pathname);
        const getHistory = /^\/v3\/messages\/([^/]+)$/.exec(url.pathname);
        if (request.method === 'GET' && (listHistory || getHistory)) {
          const id = chatIdentifier((listHistory ?? getHistory)![1]!);
          const entries = [...url.searchParams];
          const limitText = url.searchParams.get('limit');
          const limit = limitText === null ? 200 : Number(limitText);
          const cursor = url.searchParams.get('cursor');
          if (!id || (getHistory && entries.length) || entries.some(([key]) => !['limit', 'cursor'].includes(key))
            || new Set(entries.map(([key]) => key)).size !== entries.length
            || (limitText !== null && (!/^[1-9]\d{0,2}$/.test(limitText) || limit > 200))
            || (cursor !== null && !historyCursor(cursor))) return unsupported('Invalid or unsupported history query. No request was sent.');
          try {
            const path = listHistory ? `/chats/${encodeURIComponent(id)}/messages${url.search}` : `/messages/${encodeURIComponent(id)}`;
            const response = await client.request<unknown>(path, { method: 'GET', signal: request.signal });
            try { return Response.json(listHistory ? recordedPage(response, id, limit, cursor, chert.baseURL) : recordedMessage(response, { id, baseURL: chert.baseURL })); }
            catch { return Response.json({ error: { code: 'incompatible_history', message: 'Recorded history lacks required Linq metadata or has inconsistent identities' } }, { status: 502 }); }
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'history_unavailable', message: 'Chert history could not be read' } }, { status: 502 });
          }
        }
        const control = /^\/v3\/chats\/([^/]+)\/(typing|read)$/.exec(url.pathname);
        const markRead = control?.[2] === 'read';
        if (control && (request.method === 'POST' || (!markRead && request.method === 'DELETE')) && !url.search) {
          const chatId = chatIdentifier(control[1]!);
          if (!chatId) return unsupported('Invalid chat ID. No request was sent.');
          const state = request.method === 'POST' ? 'typing' : 'stopped';
          try {
            const response = await client.request<unknown>(`/chats/${encodeURIComponent(chatId)}/${markRead ? 'mark-read' : 'typing'}`, {
              method: 'POST', ...(markRead ? {} : { body: { state } }), signal: request.signal,
            });
            if (!object(response) || response.chat_id !== chatId || (markRead ? response.applied !== true : response.state !== state) || response.success === false || response.error != null) {
              return Response.json({ error: { code: 'outcome_unknown', message: 'Chert returned an incompatible chat-control acknowledgement. Do not retry automatically.' } }, { status: 502 });
            }
            return new Response(null, { status: 204 });
          } catch (error) {
            request.signal.throwIfAborted();
            if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            return Response.json({ error: { code: 'outcome_unknown', message: 'Chert chat-control request did not complete. Do not retry automatically.' } }, { status: 502 });
          }
        }
        const match = /^\/v3\/chats\/([^/]+)\/messages$/.exec(url.pathname);
        if (request.method !== 'POST' || !match || url.search) return unsupported('Only restricted text sends, metadata history and chat controls are supported. No request was sent.');
        const chatId = chatIdentifier(match[1]!);
        if (!chatId) return unsupported('Invalid chat ID. No request was sent.');
        let body: unknown;
        try { body = await request.json(); } catch { return unsupported('Expected a JSON message body. No request was sent.'); }
        if (!object(body) || !only(body, ['message']) || !object(body.message) || !only(body.message, ['parts','idempotency_key'])
          || !Array.isArray(body.message.parts) || body.message.parts.length !== 1) return unsupported('Only message.parts containing one unmodified text part is supported. No request was sent.');
        const key = body.message.idempotency_key;
        if (key !== undefined && (!validKey(key) || !canonicalChat(chatId))) return unsupported('Invalid idempotency key or keyed chat identity. No request was sent.');
        const part: unknown = body.message.parts[0];
        const media=object(part)&&part.type==='media';
        if (media ? (!only(part,['type','attachment_id'])||typeof part.attachment_id!=='string'||!/^[a-f0-9]{48}(?![\s\S])/.test(part.attachment_id))
          : (!object(part)||!only(part,['type','value'])||part.type!=='text'||typeof part.value!=='string'||!part.value.trim())) return unsupported('Only one unmodified text or uploaded attachment-ID part is supported. No request was sent.');
        try {
          let response: unknown;
          let historical = false;
          const context = key === undefined ? undefined : await linqRequestContext(chatId,body);
          if (context) {
            const lookupResult = await client.requestWithResponse<unknown>('/idempotency/lookup',{method:'POST',body:{key,request:context},signal:request.signal});
            const lookup = lookupResult.data;
            if (lookupResult.status !== 200 || !object(lookup) || (lookup.found !== true && lookup.found !== false)
              || (lookup.found === false && Object.keys(lookup).join() !== 'found')
              || (lookup.found === true && (Object.keys(lookup).sort().join() !== 'found,idempotency,message'
                || !object(lookup.idempotency) || Object.keys(lookup.idempotency).join() !== 'replayed' || lookup.idempotency.replayed !== true)))
              return Response.json({error:{code:'outcome_unknown',message:'Idempotency receipt unavailable; do not retry'}},{status:502});
            if (lookup.found) { response=lookup; historical=true; }
          }
          if (!historical) {
            const sent = await client.requestWithResponse<unknown>(`/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: context ? {message:{...body.message,idempotency_request:context}} : body, signal: request.signal });
            response=sent.data;
            if (key !== undefined && sent.status !== 202) return Response.json({error:{code:'outcome_unknown',message:'Dispatch receipt unavailable; do not retry'}},{status:502});
          }
          if (key !== undefined && (!object(response) || !object(response.idempotency) || Object.keys(response.idempotency).join() !== 'replayed' || typeof response.idempotency.replayed !== 'boolean'))
            return Response.json({error:{code:'outcome_unknown',message:'Idempotency receipt unavailable; do not retry'}},{status:502});
          if (key !== undefined && object(response) && object(response.idempotency) && response.idempotency.replayed === true) historical=true;
          request.signal.throwIfAborted();
          if(media){
            if (key !== undefined && (!object(response) || !object(response.message) || typeof response.message.id !== 'string' || !/^[a-f0-9]{32}(?![\s\S])/.test(response.message.id))) return Response.json({error:{code:'outcome_unknown',message:'Original receipt unavailable'}},{status:502});
            const mapped=queuedMediaMessage(response,chatId,part.attachment_id as string,options.chert.baseURL,historical);
            return mapped?Response.json(mapped,{status:key === undefined ? 202 : 200}):Response.json({error:{code:'outcome_unknown',message:'Chert accepted the request but returned incompatible frozen media metadata. Reconcile before retrying.'}},{status:502});
          }
          const message = object(response) && object(response.message) ? response.message : null;
          if (!message || typeof message.id !== 'string' || !message.id || typeof message.chat_id !== 'string'
            || message.chat_id !== chatId || typeof message.created_at !== 'string' || !Number.isFinite(Date.parse(message.created_at))
            || typeof message.status !== 'string' || !statuses.has(message.status) || !Array.isArray(message.parts)
            || message.parts.length !== 1 || !object(message.parts[0]) || message.parts[0].type !== 'text' || typeof message.parts[0].value !== 'string') {
            return Response.json({ error: { code: 'outcome_unknown', message: 'Chert accepted the request but returned an incompatible response. Do not retry without reconciling the send.' } }, { status: 502 });
          }
          if (key !== undefined && (message.status !== 'queued' || !/^[a-f0-9]{32}(?![\s\S])/.test(message.id) || message.parts[0].value !== (part as Record<string,unknown>).value || !only(message.parts[0],['type','value']) || message.error != null || message.ok === false || message.success === false || message.sent_at != null || message.delivered_at != null || message.read_at != null || message.read === true || message.delivered === true || message.is_read === true || message.is_delivered === true || message.is_sent === true || (message.direction !== undefined && message.direction !== 'outbound'))) return Response.json({error:{code:'outcome_unknown',message:'Original receipt unavailable'}},{status:502});
          return Response.json({ chat_id: message.chat_id, message: {
            id: message.id, created_at: message.created_at, delivery_status: message.status,
            is_read: message.status === 'read', sent_at: null,
            parts: [{ type: 'text', value: message.parts[0].value, reactions: null }],
            ...(typeof message.delivered_at === 'string' || message.delivered_at === null ? { delivered_at: message.delivered_at } : {}),
          } }, { status: key === undefined ? 202 : 200 });
        } catch (error) {
          request.signal.throwIfAborted();
          if (error instanceof ChertAPIError) {
            const response = Response.json({ error: { code: error.code, message: error.message, request_id: error.requestId } }, { status: error.status >= 400 && error.status <= 599 ? error.status : 502 });
            // Explicit Chert diagnostics, not invented Linq error-body fields.
            const data = error.data;
            if (error.status === 502 && error.code === '4103' && object(data) && object(data.error)
              && data.error.code === 4103 && data.error.retryable === false
              && (data.error.status === undefined || data.error.status === 502) && data.chat_id === chatId
              && typeof data.message_id === 'string'
              && (media ? /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?![\s\S])/i : /^[a-f0-9]{32}(?![\s\S])/).test(data.message_id)) {
              response.headers.set('x-chert-message-id', data.message_id);
              response.headers.set('x-chert-chat-id', chatId);
            }
            return response;
          }
          return Response.json({ error: { code: 'outcome_unknown', message: 'Chert request did not complete. Reconcile the send before retrying.' } }, { status: 502 });
        }
      },
    });
    this.adapterOptions = options;
  }
}
export { ChertLinqAdapter, ChertLinqAdapter as LinqAPIV3 };
