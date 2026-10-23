import {resolveMediaSource, validateMediaSourceURL, MediaSourceError} from './media-source';
import {recordedMedia} from './recorded-media';
import {manageWebhook} from './webhook-management';
import {createV4IdempotencyRequest} from './idempotency';
import { ChertAPIError, ChertClient, DEFAULT_IMESSAGE_BASE_URL, type ChertClientOptions, type ChertFetch } from '@cherthq/imessage';

export const BLOOIO_V4_CONTRACT = {
  url: 'https://docs.blooio.com/openapi.json', version: '4.0.0-beta',
  sha256: '069fa87a9702f802607bcf7341df4d6ae237ac52658eece5d4b4e6378ba40f73',
} as const;
const error = (code: string, message: string, status = 501) => Response.json({ error: { code, message } }, { status });
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function identifier(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value && value.length <= 160 && !/[\\/%?#\u0000-\u0020\u007f]/.test(value) && value !== '.' && value !== '..' ? value : null;
  } catch { return null; }
}

const lineIDValid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const phoneValid = (value: unknown): value is string => typeof value === 'string' && /^\+[1-9]\d{1,14}$/.test(value);
const lifecycleStatuses = new Set(['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'superseded', 'received']);
const cursorValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
const readAllowed = (request: Request) => request.body === null && [...request.headers.keys()].every(key =>
  ['authorization', 'accept', 'content-type', 'x-chert-tenant'].includes(key));

/** Explicit v4 HTTP fetch replacement; no unverified upstream JavaScript SDK signature. */
export function createBlooioV4Fetch(options: { chert: ChertClientOptions }): ChertFetch {
  const client = new ChertClient(options.chert);
  const baseURL = options.chert.baseURL === undefined ? DEFAULT_IMESSAGE_BASE_URL : options.chert.baseURL;
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.hash) return error('unsupported_feature', 'URL fragments are unsupported. No request was sent.');
    const webhook = await manageWebhook(request,client);
    if(webhook)return webhook;
    const chatPath = /^\/v4\/(chats|contacts)\/([^/]+)$/.exec(url.pathname);
    if (url.origin === 'https://api.blooio.com' && request.method === 'GET' && chatPath) {
      const id = identifier(chatPath[2]!);
      if (!id || url.search || !readAllowed(request)) return error('unsupported_feature', 'Only an owned direct chat read without overrides is supported.');
      try {
        const response = await client.request<unknown>(`/chats/${encodeURIComponent(id)}`, { signal: request.signal });
        const invalid = () => error('invalid_response', 'Chert returned incompatible direct chat metadata.', 502);
        if (!record(response) || !record(response.chat)) return invalid();
        const chat = response.chat;
        if (chat.id !== id) return invalid();
        if (chat.is_group === true) return error('unsupported_feature', 'Group chat retrieval is unsupported.');
        if (chat.is_group !== false || (chat.display_name !== null && typeof chat.display_name !== 'string')
          || !Array.isArray(chat.handles) || chat.handles.length !== 1 || !record(chat.handles[0])
          || !phoneValid(chat.handles[0].address)) return invalid();
        if (chatPath[1] === 'contacts') return Response.json({data:{id:chat.id,name:chat.display_name}});
        return Response.json({ data: { id: chat.id, contact: { contact_id: chat.id,
          identifier: chat.handles[0].address, name: chat.display_name }, group: null } });
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('chat_unavailable', 'Chert direct chat metadata could not be read.', 502);
      }
    }
    if (url.origin === 'https://api.blooio.com' && request.method === 'GET' && url.pathname === '/v4/channels') {
      if (url.search || !readAllowed(request)) return error('unsupported_feature', 'Assigned channel listing accepts no filters, pagination or overrides.');
      try {
        const result = await client.request<unknown>('/phone-numbers', { method: 'GET', signal: request.signal });
        const invalid = () => error('invalid_response', 'Chert assigned inventory cannot form a complete channel page.', 502);
        if (!record(result) || !Array.isArray(result.phone_numbers) || result.phone_numbers.length > 50) return invalid();
        const ids = new Set<string>(), phones = new Set<string>();
        const data: Array<{ id: string; address: string }> = [];
        for (const line of result.phone_numbers) {
          if (!record(line) || !lineIDValid(line.id) || !phoneValid(line.phone_number)
            || ids.has(line.id) || phones.has(line.phone_number)) return invalid();
          ids.add(line.id); phones.add(line.phone_number);
          data.push({ id: line.id, address: line.phone_number });
        }
        return Response.json({ data, has_more: false, next_cursor: null });
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('inventory_unavailable', 'Chert assigned lines could not be read.', 502);
      }
    }
    const channelPath = /^\/v4\/channels\/([^/]+)$/.exec(url.pathname);
    if (url.origin === 'https://api.blooio.com' && request.method === 'GET' && channelPath) {
      const reference = identifier(channelPath[1]!);
      if ((!lineIDValid(reference) && !phoneValid(reference)) || url.search || !readAllowed(request))
        return error('unsupported_feature', 'Only an assigned Chert line UUID or canonical phone is supported.');
      try {
        const result = await client.request<unknown>('/phone-numbers', { method: 'GET', signal: request.signal });
        const invalid = () => error('invalid_response', 'Chert returned incompatible assigned line inventory.', 502);
        if (!record(result) || !Array.isArray(result.phone_numbers)) return invalid();
        const ids = new Set<string>(), phones = new Set<string>();
        let selected: { id: string; address: string } | undefined;
        for (const line of result.phone_numbers) {
          if (!record(line) || !lineIDValid(line.id) || !phoneValid(line.phone_number)
            || ids.has(line.id) || phones.has(line.phone_number)) return invalid();
          ids.add(line.id); phones.add(line.phone_number);
          if (line.id === reference || line.phone_number === reference) selected = { id: line.id, address: line.phone_number };
        }
        return selected ? Response.json({ data: selected }) : error('channel_not_found', 'Assigned channel was not found.', 404);
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('inventory_unavailable', 'Chert assigned lines could not be read.', 502);
      }
    }
    const listPath = /^\/v4\/chats\/([^/]+)\/messages$/.exec(url.pathname);
    if (url.origin === 'https://api.blooio.com' && request.method === 'GET' && listPath) {
      const chatID = identifier(listPath[1]!);
      const entries = [...url.searchParams];
      const order = url.searchParams.get('order');
      const limitText = url.searchParams.get('limit') ?? '50';
      const limit = Number(limitText);
      const cursor = url.searchParams.get('cursor');
      if (!chatID || !readAllowed(request) || entries.some(([key]) => !['order', 'limit', 'cursor'].includes(key)) ||
          new Set(entries.map(([key]) => key)).size !== entries.length ||
          (order !== null && order !== 'asc' && order !== 'desc') || !/^[1-9]\d{0,2}$/.test(limitText) || limit > 200 ||
          (cursor !== null && !cursorValid(cursor))) return error('unsupported_feature', 'Invalid or unsupported history request.');
      const query = new URLSearchParams();
      // Native continuation inherits its bound order when omitted; first page defaults desc.
      if (order !== null || cursor === null) query.set('order', order ?? 'desc');
      query.set('limit', String(limit));
      if (cursor !== null) query.set('cursor', cursor);
      try {
        const page = await client.request<unknown>(`/chats/${encodeURIComponent(chatID)}/messages?${query}`, { method: 'GET', signal: request.signal });
        const invalidPage = () => error('invalid_response', 'Chert returned an incompatible history page.', 502);
        if (!record(page) || !Array.isArray(page.messages) || page.messages.length > limit || typeof page.has_more !== 'boolean' ||
            (page.has_more ? !page.messages.length || !cursorValid(page.next_cursor) || page.next_cursor === cursor : page.next_cursor !== null)) return invalidPage();
        const ids = new Set<string>();
        const data: Record<string, unknown>[] = [];
        for (const row of page.messages) {
          if (!record(row) || typeof row.id !== 'string' || identifier(row.id) !== row.id || ids.has(row.id) || row.chat_id !== chatID || !Array.isArray(row.parts)) return invalidPage();
          ids.add(row.id);
          const hasMedia=row.parts.some(part=>record(part)&&part.type==='media')||row.attachments!==undefined;
          const media=hasMedia?recordedMedia(row.parts,row.attachments,baseURL):null;
          if(hasMedia&&!media)return invalidPage();
          if(!hasMedia&&row.parts.some(part=>!record(part)||part.type!=='text'||typeof part.value!=='string'||(part.text!==undefined&&part.text!==part.value)))return invalidPage();
          const joined=media?media.text??'':row.parts.map(part=>(part as {value:string}).value).join('\n\n');
          if(row.text!==undefined&&row.text!==null&&row.text!==joined)return invalidPage();
          const text=media?media.text:row.parts.length||typeof row.text==='string'?joined:undefined;
          data.push({ id: row.id, chat_id: chatID,
            ...(media?{attachments:media.attachments}:{}),
            ...(text !== undefined ? { text } : {}),
            ...(typeof row.status === 'string' && lifecycleStatuses.has(row.status) ? { status: row.status } : {}),
            ...(row.direction === 'inbound' || row.direction === 'outbound' ? { direction: row.direction } : {}),
          });
        }
        return Response.json({ data, has_more: page.has_more, next_cursor: page.next_cursor });
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('history_unavailable', 'Chert history could not be read.', 502);
      }
    }
    const typingPath = /^\/v4\/chats\/([^/]+)\/typing$/.exec(url.pathname);
    if (url.origin === 'https://api.blooio.com' && typingPath && ['POST', 'DELETE'].includes(request.method)) {
      const chatID = identifier(typingPath[1]!);
      if (!chatID || url.search || url.hash || request.headers.has('Idempotency-Key')) {
        return error('unsupported_feature', 'Invalid or unsupported typing request.');
      }
      const rawBody = await request.text();
      let body: unknown = {};
      if (request.method === 'DELETE' && rawBody.length) return error('unsupported_feature', 'Stop typing does not accept a body.');
      if (rawBody.length) {
        try { body = JSON.parse(rawBody); } catch { return error('unsupported_feature', 'Typing requires a JSON object or no body.'); }
      }
      if (!record(body) || Object.keys(body).some(key => key !== 'state') ||
          (body.state !== undefined && body.state !== 'started' && body.state !== 'stopped')) {
        return error('unsupported_feature', 'Only typing state started or stopped is supported.');
      }
      const state = request.method === 'DELETE' || body.state === 'stopped' ? 'stopped' : 'typing';
      try {
        const result = await client.request<unknown>(`/chats/${encodeURIComponent(chatID)}/typing`, {
          method: 'POST', body: { state }, signal: request.signal,
        });
        if (!record(result) || result.chat_id !== chatID || result.state !== state || result.error != null) {
          return error('outcome_unknown', 'Chert returned an incompatible typing response. Do not assume the indicator changed.', 502);
        }
        return Response.json({ data: { chat_id: result.chat_id, state: result.state === 'typing' ? 'started' : 'stopped' } });
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('outcome_unknown', 'Chert typing request did not complete. Do not assume the indicator changed.', 502);
      }
    }
    const statusPath = /^\/v4\/chats\/([^/]+)\/messages\/([^/]+)(\/status)?$/.exec(url.pathname);
    if (url.origin === 'https://api.blooio.com' && request.method === 'GET' && statusPath && !url.search && !url.hash) {
      const chatID = identifier(statusPath[1]!);
      const messageID = identifier(statusPath[2]!);
      if (!chatID || !messageID) return error('unsupported_feature', 'Invalid chat or message identifier.');
      if (!readAllowed(request)) {
        return error('unsupported_feature', 'Recorded-message reads accept no body or unsupported headers.');
      }
      const retrieve = !statusPath[3];
      try {
        const result = await client.request<unknown>(`/messages/${encodeURIComponent(messageID)}`, { method: 'GET', signal: request.signal });
        if (!record(result) || result.lead_id !== chatID) return error('not_found', 'Message not found in this chat.', 404);
        if (result.id !== messageID) return error('invalid_response', 'Chert returned an incompatible message identity.', 502);
        const status = typeof result.status === 'string' &&
          lifecycleStatuses.has(result.status) ? result.status : undefined;
        const stored=record(result.response)?result.response:null;
        const intent=record(result.request)&&record(result.request.message)?result.request.message:null;
        const hasMedia=retrieve&&(stored?.attachments!==undefined||(Array.isArray(intent?.parts)&&intent.parts.some(part=>record(part)&&part.type==='media')));
        const media=hasMedia?recordedMedia(intent?.parts,stored?.attachments,baseURL):null;
        if(hasMedia&&(!media||(media.text!==undefined?result.text!==media.text:result.text!==undefined&&result.text!=='')))return error('invalid_response','Chert returned incompatible recorded media.',502);
        return Response.json({ data: { id: result.id,
          ...(retrieve ? { chat_id: chatID,
            ...(media?{attachments:media.attachments}:{}),
            ...(typeof result.text === 'string' ? { text: result.text } : {}),
            ...(result.direction === 'inbound' || result.direction === 'outbound' ? { direction: result.direction } : {}),
          } : {}),
          ...(status !== undefined ? { status } : {}),
        } });
      } catch (failure) {
        request.signal.throwIfAborted();
        if (failure instanceof ChertAPIError) {
          const response = error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);
          if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
          return response;
        }
        return error('status_unavailable', 'Chert status could not be read.', 502);
      }
    }
    const direct = url.pathname === '/v4/messages';
    const reply = /^\/v4\/chats\/[^/]+\/messages$/.test(url.pathname);
    if (url.origin !== 'https://api.blooio.com' || request.method !== 'POST' || url.search || (!direct && !reply)) {
      return error('unsupported_feature', 'Only Blooio v4 plaintext send, existing-chat reply and chat-scoped recorded-message/status and typing requests are recognized. No message was sent.');
    }
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (idempotencyKey !== null && (!idempotencyKey.length || idempotencyKey.includes('\0')
      || new TextEncoder().encode(idempotencyKey).length > 200
      || new TextDecoder('utf-8', {fatal:true}).decode(new TextEncoder().encode(idempotencyKey)) !== idempotencyKey
      || [...request.headers.keys()].some(key=>!['authorization','accept','content-type','x-chert-tenant','idempotency-key'].includes(key))))
      return error('unsupported_feature','Unsupported idempotency key or request options. No message was sent.');
    let body: unknown;
    try { body = await request.json(); } catch { return error('unsupported_feature', 'A JSON plaintext message is required. No message was sent.'); }
    const media = record(body) && Object.hasOwn(body,'attachments');
    const allowed = direct ? ['from', 'to', 'text'] : media ? ['text','attachments'] : ['text'];
    const textValid = record(body) && typeof body.text === 'string' && !!body.text.trim();
    let attachment: {id:string;url:string}|null=null;
    if (media && record(body)) {
      if (direct || !Array.isArray(body.attachments) || body.attachments.length!==1 || typeof body.attachments[0]!=='string'
        || Object.hasOwn(body,'text') || !identifier(url.pathname.split('/')[3]!)
        || [...request.headers.keys()].some(key=>!['authorization','accept','content-type','x-chert-tenant','idempotency-key'].includes(key)))
        return error('unsupported_feature','Only one owned canonical image URL in an existing chat is supported.');
      // Source validation/import happens after historical replay lookup. Keep
      // the original provider URL untouched in the frozen request identity.
      try {validateMediaSourceURL(baseURL,body.attachments[0]);}
      catch(failure){if(failure instanceof MediaSourceError)return error(failure.code,failure.message,failure.status);throw failure;}
      attachment={id:'',url:body.attachments[0]};
    }
    if (!record(body) || Object.keys(body).some(key => !allowed.includes(key)) || (!media&&!textValid)
      || (direct && (typeof body.from !== 'string' || !/^\+[1-9]\d{1,14}$/.test(body.from) || typeof body.to !== 'string' || !/^\+[1-9]\d{1,14}$/.test(body.to)))
      ) {
      return error('unsupported_feature', 'Unsupported routing or content options. No message was sent.');
    }
    const expectedChat = direct ? null : identifier(url.pathname.split('/')[3]!);
    if (!direct && !expectedChat)
      return error('unsupported_feature','A canonical owned chat ID is required. No request was sent.');
    let importedSource=false;
    let dispatched=false, phase:'lookup'|'metadata'|'dispatch'='lookup';
    let requestContext: Awaited<ReturnType<typeof createV4IdempotencyRequest>> | null = null;
    const keyedReceipt = (result: unknown, lookup=false): Response | null => {
      const message=record(result)&&record(result.message)?result.message:null;
      const replay=record(result)&&record(result.idempotency)?result.idempotency:null;
      if (!message || typeof message.id!=='string' || !/^[a-f0-9]{32}(?![\s\S])/.test(message.id)
        || typeof message.chat_id!=='string' || identifier(message.chat_id)!==message.chat_id
        || (expectedChat!==null && message.chat_id!==expectedChat) || message.status!=='queued'
        || !replay || Object.keys(replay).join()!=='replayed' || typeof replay.replayed!=='boolean'
        || (lookup && (replay.replayed!==true || Object.keys(message).sort().join()!=='chat_id,id,status'))) return null;
      return Response.json({id:message.id,chat_id:message.chat_id,status:message.status},{status:replay.replayed?200:201});
    };
    const lookup = async (): Promise<Response|null> => {
      phase='lookup';
      const result=await client.requestWithResponse<unknown>('/idempotency/lookup',{method:'POST',signal:request.signal,
        body:{key:idempotencyKey,request:requestContext}});
      request.signal.throwIfAborted();
      if(result.status!==200 || !record(result.data)) return error('outcome_unknown','Chert returned an incompatible replay lookup.',502);
      const data=result.data;
      if(Object.keys(data).join()==='found' && data.found===false)return null;
      if(Object.keys(data).sort().join()==='found,idempotency,message' && data.found===true){
        const replay=keyedReceipt(data,true);if(replay)return replay;
      }
      return error('outcome_unknown','Chert returned an incompatible replay lookup.',502);
    };
    try {
      if(idempotencyKey!==null){
        requestContext=await createV4IdempotencyRequest(direct?'/v4/messages':`/v4/chats/${encodeURIComponent(expectedChat!)}/messages`,body);
        request.signal.throwIfAborted();
        const prior=await lookup();if(prior)return prior;
      }
      if(attachment){
        phase='metadata';
        try {const originalURL=attachment.url;attachment=await resolveMediaSource(client,baseURL,originalURL,request.signal);importedSource=attachment.url!==originalURL;}
        catch(failure){
          request.signal.throwIfAborted();
          if(idempotencyKey!==null){const raced=await lookup();if(raced)return raced;}
          if(failure instanceof MediaSourceError)return error(failure.code,failure.message,failure.status);
          throw failure;
        }
        // Concurrent importers can resolve one original URL to distinct owned
        // IDs. Prefer an already frozen provider receipt before dispatch.
        if(importedSource&&idempotencyKey!==null){const raced=await lookup();if(raced)return raced;}
      }
      dispatched=true;phase='dispatch';
      const result = await client.request<unknown>(direct ? '/chats' : url.pathname.slice('/v4'.length), {
        method: 'POST', signal: request.signal,
        body: direct ? { from: body.from, to: [body.to], message: { parts: [{ type: 'text', value: body.text }], ...(idempotencyKey === null ? {} : {idempotency_key:idempotencyKey,idempotency_request:requestContext}) } }
          : { message: { parts: attachment ? [{type:'media',attachment_id:attachment.id}] : [{ type: 'text', value: body.text }], ...(idempotencyKey === null ? {} : {idempotency_key:idempotencyKey,idempotency_request:requestContext}) } },
      });
      const message = record(result) && record(result.message) ? result.message : null;
      if (!message || typeof message.id !== 'string' || !message.id || typeof message.chat_id !== 'string' || !message.chat_id
        || (expectedChat !== null && message.chat_id !== expectedChat)
        || typeof message.status !== 'string' || !['queued', 'sent', 'delivered', 'read', 'failed'].includes(message.status)) {
        return error('outcome_unknown', 'Chert returned an incompatible send response. Reconcile the send before retrying.', 502);
      }
      if(idempotencyKey!==null)return keyedReceipt(result)??error('outcome_unknown','Chert returned an incompatible keyed send receipt. Reconcile the send before retrying.',502);
      return Response.json({ id: message.id, chat_id: message.chat_id, status: message.status }, { status: 201 });
    } catch (failure) {
      request.signal.throwIfAborted();
      if (failure instanceof ChertAPIError && failure.status===409 && importedSource && idempotencyKey!==null && dispatched) {
        // Resolve only against the original route/body identity. A changed URL
        // still conflicts; no native send is retried.
        try {const raced=await lookup();if(raced)return raced;} catch(reconciliationFailure) {
          request.signal.throwIfAborted();
          if(reconciliationFailure instanceof ChertAPIError && reconciliationFailure.status===409)return error(reconciliationFailure.code,reconciliationFailure.message,409);
          return error('outcome_unknown','Chert replay could not be reconciled.',502);
        }
      }
      if (failure instanceof ChertAPIError) {
        const data=failure.data;
        // Preserve only the owned public reconciliation identity, never raw
        // native errors, attachment capabilities or private ledger metadata.
        const reconciliation=(dispatched||idempotencyKey!==null)&&failure.status===502&&failure.code==='4103'&&record(data)&&record(data.error)
          &&data.error.retryable===false&&typeof data.chat_id==='string'
          &&(direct ? identifier(data.chat_id)===data.chat_id : (attachment!==null||idempotencyKey!==null)&&data.chat_id===expectedChat)
          &&typeof data.message_id==='string'&&(direct ? /^[a-f0-9]{32}(?![\s\S])/.test(data.message_id)
            : /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?![\s\S])/i.test(data.message_id))
          ? {message_id:data.message_id,chat_id:data.chat_id,retryable:false}:null;
        const response = reconciliation
          ? Response.json({error:{code:failure.code,message:failure.message,details:reconciliation}},{status:failure.status})
          : error(failure.code, failure.message, failure.status >= 400 && failure.status <= 599 ? failure.status : 502);

        if (failure.requestId) response.headers.set('x-request-id', failure.requestId);
        return response;
      }
      return dispatched||phase==='lookup' ? error('outcome_unknown', 'Chert request did not complete. Reconcile the send before retrying.', 502) : error('attachment_unavailable','Chert image metadata could not be read. No message was sent.',502);
    }
  };
}
export default createBlooioV4Fetch;
