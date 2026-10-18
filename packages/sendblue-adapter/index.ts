import { listAccountHistory } from './account-history.js';
import OfficialSendblue, { APIError, type ClientOptions } from 'sendblue';
import type { TypingIndicatorSendParams } from 'sendblue/resources/typing-indicators';
import type { MessageResponse, MessageRetrieveResponse } from 'sendblue/resources/messages/messages';
import { ChertClient, ChertAPIError, validateMediaCapability, type ChertClientOptions } from '@chert/sdk';

export * from 'sendblue';
export { unwrapChert } from './webhooks.js';
export type SendblueAdapterOptions = ClientOptions & { chert: ChertClientOptions };
type FinalRequestOptions = OfficialSendblue.RequestOptions & { method: NonNullable<OfficialSendblue.RequestOptions['method']>; path: string };
const virtualBase = 'https://sendblue.chert.invalid';

function unsupported(message: string): Response {
  return Response.json({ error: { code: 'unsupported_feature', message } }, { status: 501 });
}

function typingParameters(value: unknown): value is TypingIndicatorSendParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).every(key => ['from_number', 'number', 'state'].includes(key)) &&
    typeof fields.from_number === 'string' && /^\+[1-9]\d{1,14}$/.test(fields.from_number) &&
    typeof fields.number === 'string' && /^\+[1-9]\d{1,14}$/.test(fields.number) &&
    (fields.state === undefined || fields.state === 'start' || fields.state === 'stop');
}

interface ChertSendResponse {
  message: {
    id?: string;
    chat_id?: string;
    status?: string;
    created_at?: string;
    direction?: string;
    parts?: Array<{ type: string; value?: string; attachment_id?: string }>;
    attachments?: unknown[];
  };
}

function validCaption(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 16384 || value.includes('\0')) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 16384 && new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes) === value;
}
function captionedParts(value: unknown): {caption: string; attachmentId: string} | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [text, media] = value;
  if (!text || typeof text !== 'object' || !media || typeof media !== 'object'
    || Object.keys(text).sort().join() !== 'type,value' || text.type !== 'text' || !validCaption(text.value)
    || Object.keys(media).sort().join() !== 'attachment_id,type' || media.type !== 'media'
    || typeof media.attachment_id !== 'string' || !/^[a-f0-9]{48}(?![\s\S])/.test(media.attachment_id)) return null;
  return {caption: text.value, attachmentId: media.attachment_id};
}

function mapMessage(result: ChertSendResponse, input: Record<string, unknown>): MessageResponse {
  if (!result || typeof result.message !== 'object' || !result.message) {
    throw new Error('Chert send response has no message record');
  }
  const message = result.message;
  const statuses: Record<string, MessageResponse['status']> = {
    queued: 'QUEUED', sent: 'SENT', delivered: 'DELIVERED', read: 'DELIVERED', failed: 'ERROR',
  };
  if (message.status !== undefined && !statuses[message.status]) {
    throw new Error('Chert returned an unsupported message status');
  }
  const response: MessageResponse = {};
  if (typeof message.id === 'string') response.message_handle = message.id;
  if (typeof message.created_at === 'string') response.date_created = message.created_at;
  if (message.status !== undefined) response.status = statuses[message.status];
  if (message.direction === 'outbound' || message.direction === 'inbound') response.is_outbound = message.direction === 'outbound';
  if (message.parts?.length === 1 && message.parts[0]?.type === 'text' && typeof message.parts[0].value === 'string') {
    response.content = message.parts[0].value;
  }
  response.from_number = input.from_number as string;
  response.number = input.number as string;
  return response;
}

function recordedTarget(url: URL): { id: string; retrieve: boolean } | null {
  let id: string | null = null;
  let retrieve = false;
  if (url.pathname === '/api/status' && [...url.searchParams.keys()].length === 1) id = url.searchParams.get('handle');
  else if (!url.search) {
    const match = /^\/api\/v2\/messages\/([^/]+)$/.exec(url.pathname);
    if (match) { try { id = decodeURIComponent(match[1]); retrieve = true; } catch { return null; } }
  }
  return id && /^[A-Za-z0-9:_-]+$/.test(id) ? { id, retrieve } : null;
}
function mapRecorded(value: unknown, id: string): Pick<MessageResponse, 'message_handle' | 'status' | 'number' | 'content' | 'is_outbound'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recorded message');
  const row = value as Record<string, unknown>;
  if (row.id !== id) throw new Error('Recorded message identity mismatch');
  const mapped: Pick<MessageResponse, 'message_handle' | 'status' | 'number' | 'content' | 'is_outbound'> = { message_handle: id };
  if (row.status === 'queued') mapped.status = 'QUEUED';
  else if (row.status === 'sent') mapped.status = row.delivered === true ? 'DELIVERED' : 'SENT';
  else if (row.status === 'delivered' || (row.status === 'read' && row.direction === 'outbound')) mapped.status = 'DELIVERED';
  else if (row.status === 'failed') mapped.status = 'ERROR';
  if (typeof row.phone === 'string') mapped.number = row.phone;
  if (typeof row.text === 'string') mapped.content = row.text;
  if (row.direction === 'inbound' || row.direction === 'outbound') mapped.is_outbound = row.direction === 'outbound';
  return mapped;
}

function mapRetrieved(value: unknown, id: string, baseURL: string): Pick<MessageRetrieveResponse.Data, 'message_handle' | 'status' | 'number' | 'content' | 'is_outbound' | 'media_url'> {
  // mapRecorded validates identity and preserves the narrower getStatus schema.
  const mapped: Pick<MessageRetrieveResponse.Data, 'message_handle' | 'status' | 'number' | 'content' | 'is_outbound' | 'media_url'> = mapRecorded(value, id);
  const row = value as Record<string, unknown>;
  if (row.status === 'received' || (row.status === 'read' && row.direction === 'inbound')) mapped.status = 'RECEIVED';
  const record = (v:unknown):v is Record<string,unknown> => v!==null&&typeof v==='object'&&!Array.isArray(v);
  const parts = record(row.request)&&record(row.request.message)?row.request.message.parts:undefined;
  const attachments = record(row.response)?row.response.attachments:undefined;
  if ((Array.isArray(parts)&&parts.some(p=>record(p)&&p.type==='media')) || attachments!==undefined) {
    const caption = captionedParts(parts);
    const attachmentId = caption?.attachmentId ?? (Array.isArray(parts) && parts.length === 1 && record(parts[0])
      && Object.keys(parts[0]).sort().join(',')==='attachment_id,type' && parts[0].type==='media' ? parts[0].attachment_id : undefined);
    if(row.direction!=='outbound'||row.parts!==undefined||typeof attachmentId!=='string'
      ||(caption && row.text!==caption.caption)
      ||!Array.isArray(attachments)||attachments.length!==1)throw new Error('Incompatible recorded media');
    const media=validateMediaCapability(attachments[0],attachmentId,baseURL);
    if(!media)throw new Error('Incompatible recorded media');
    mapped.media_url=media.download_url;
  }
  return mapped;
}

/** Official Sendblue resources with an explicit, limited Chert transport. */
export class SendblueAPI extends OfficialSendblue {
  private readonly adapterOptions: SendblueAdapterOptions;
  override request<Rsp>(options: Parameters<OfficialSendblue['request']>[0], remainingRetries?: number | null) {
    if (remainingRetries != null && remainingRetries !== 0) throw new TypeError('Explicit retry attempts are unsupported for Chert sends');
    return super.request<Rsp>(options, remainingRetries);
  }

  constructor(options: SendblueAdapterOptions) {
    if (!options?.chert) throw new TypeError('Explicit chert connection options are required');
    if (options.maxRetries !== undefined && options.maxRetries !== 0) {
      throw new TypeError('Chert sends require maxRetries: 0 to avoid duplicate messages');
    }
    const chert = new ChertClient(options.chert);
    const transport: NonNullable<ClientOptions['fetch']> = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== virtualBase || url.hash) return unsupported('Only the configured virtual provider origin is supported');
      if (url.pathname === '/api/send-typing-indicator' && request.method === 'POST' && !url.search) {
        let body: unknown;
        try { body = await request.json(); } catch { return unsupported('Expected typing parameters'); }
        if (!typingParameters(body)) return unsupported('Only canonical E.164 from_number/number and optional start/stop state are supported');
        const state = body.state === 'stop' ? 'stopped' : 'typing';
        try {
          const result = await chert.request<unknown>('/typing', { method: 'POST', signal: request.signal,
            body: { from: body.from_number, to: body.number, state } });
          const row = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
          if (!row || row.from !== body.from_number || row.to !== body.number || row.state !== state || row.applied !== true ||
              typeof row.chat_id !== 'string' || !row.chat_id || row.success === false || row.ok === false ||
              row.error != null || row.error_message != null || (row.status !== undefined && row.status !== 'SENT')) {
            return Response.json({ error: { code: 'outcome_unknown', message: 'Chert did not confirm application of the requested typing state. Do not retry automatically.' } }, { status: 502 });
          }
          return Response.json({ number: row.to, status: 'SENT' });
        } catch (error) {
          request.signal.throwIfAborted();
          if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message } }, {
            status: error.status >= 400 && error.status <= 599 ? error.status : 502,
            headers: error.requestId ? { 'x-request-id': error.requestId } : undefined,
          });
          return Response.json({ error: { code: 'outcome_unknown', message: 'Chert typing request did not complete. Do not retry automatically.' } }, { status: 502 });
        }
      }
      if(request.method==='GET'&&url.origin===virtualBase&&url.pathname==='/api/v2/messages'){
        try{return Response.json(await listAccountHistory(chert,url.searchParams,request.signal,options.chert.baseURL));}
        catch(error){
          request.signal.throwIfAborted();
          if(error instanceof ChertAPIError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status>=400&&error.status<=599?error.status:502,headers:error.requestId?{'x-request-id':error.requestId}:undefined});
          return Response.json({error:{code:'invalid_account_history',message:'Chert account history unavailable'}},{status:502});
        }
      }
      const read = request.method === 'GET' && url.origin === virtualBase ? recordedTarget(url) : null;
      if (read) {
        try {
          const result = await chert.request<unknown>(`/messages/${encodeURIComponent(read.id)}`, { method: 'GET', signal: request.signal });
          try { return Response.json(read.retrieve ? { data: mapRetrieved(result, read.id, options.chert.baseURL) } : mapRecorded(result, read.id)); }
          catch { return Response.json({ error: { message: 'Chert returned an incompatible recorded-message response' } }, { status: 502 }); }
        } catch (error) {
          if (error instanceof ChertAPIError) return Response.json({ error: { code: error.code, message: error.message } }, {
            status: error.status, headers: error.requestId ? { 'x-request-id': error.requestId } : undefined,
          });
          throw error;
        }
      }
      if (url.origin !== virtualBase || url.pathname !== '/api/send-message' || request.method !== 'POST' || url.search) {
        return unsupported('Only direct sends, recorded-message reads and explicit-sender typing are supported');
      }
      const body: unknown = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) return unsupported('Expected text send parameters');
      const fields = body as Record<string, unknown>;
      if (Object.keys(fields).some(key => !['from_number', 'number', 'content', 'media_url'].includes(key))) {
        return unsupported('Callbacks, cards and other send options are unsupported');
      }
      const mediaSend = fields.media_url !== undefined;
      if (mediaSend && fields.content !== undefined && fields.content !== '' && !validCaption(fields.content)) {
        return Response.json({ error: { message: 'Caption must be lossless nonempty UTF-8 text within 16384 bytes' } }, { status: 400 });
      }
      const caption = mediaSend && validCaption(fields.content) ? fields.content : undefined;
      if (typeof fields.from_number !== 'string' || !/^\+[1-9]\d{1,14}$/.test(fields.from_number) || typeof fields.number !== 'string' || !/^\+[1-9]\d{1,14}$/.test(fields.number)
        || (mediaSend ? typeof fields.media_url !== 'string' || !fields.media_url : typeof fields.content !== 'string' || !fields.content.trim())) {
        return Response.json({ error: { message: 'Canonical E.164 from_number/number and content or media_url are required' } }, { status: 400 });
      }
      try {
        let attachmentId: string | undefined;
        if (mediaSend) {
          const imported = await chert.request<{attachment_id?: unknown; uploaded?: unknown}>('/attachments/import', {
            method: 'POST', signal: request.signal, body: { url: fields.media_url },
          });
          if (typeof imported?.attachment_id !== 'string' || !/^[a-f0-9]{48}(?![\s\S])/.test(imported.attachment_id) || imported.uploaded !== true) {
            return Response.json({ error: { message: 'Chert returned an incompatible media import' } }, { status: 502 });
          }
          attachmentId = imported.attachment_id;
          request.signal.throwIfAborted();
        }
        const result = await chert.request<ChertSendResponse>('/chats', {
          method: 'POST', signal: request.signal,
          body: { from: fields.from_number, to: [fields.number], message: { parts: attachmentId
            ? [...(caption === undefined ? [] : [{ type: 'text', value: caption }]), { type: 'media', attachment_id: attachmentId }]
            : [{ type: 'text', value: fields.content }] } },
        });
        try {
          const mapped = mapMessage(result, fields);
          if (attachmentId) {
            const attachment = result.message.attachments;
            const media = Array.isArray(attachment) && attachment.length === 1
              ? validateMediaCapability(attachment[0], attachmentId, options.chert.baseURL) : null;
            if (!media) throw new Error('Incompatible media receipt');
            mapped.media_url = media.download_url;
            if (caption !== undefined) {
              const actual = captionedParts(result.message.parts);
              if (!actual || actual.caption !== caption || actual.attachmentId !== attachmentId) throw new Error('Incompatible caption receipt');
              mapped.content = actual.caption;
            }
          }
          return Response.json(mapped);
        } catch {
          if (attachmentId) {
            const id = result?.message?.id, chat = result?.message?.chat_id;
            const data = typeof id === 'string' && /^[a-f0-9]{32}(?![\s\S])/.test(id)
              ? { message_id: id, ...(typeof chat === 'string' && /^[A-Za-z0-9:_-]{1,160}(?![\s\S])/.test(chat) ? { chat_id: chat } : {}) } : undefined;
            return Response.json({ error: { code: '4103', message: 'Media outcome unconfirmed; reconcile before retrying', retryable: false, ...(data ? { data } : {}) } }, { status: 502 });
          }
          return Response.json({ error: { message: 'Chert returned an invalid send response' } }, { status: 502 });
        }
      } catch (error) {
        if (error instanceof ChertAPIError) {
          const headers = error.requestId ? { 'x-request-id': error.requestId } : undefined;
          return Response.json({ error: { code: error.code, message: error.message, data: error.data } }, { status: error.status, headers });
        }
        throw error;
      }
    };
    super({
      ...options, baseURL: virtualBase, apiKey: undefined, apiSecret: undefined,
      accessToken: 'chert-adapter', fetch: transport, maxRetries: 0, logLevel: 'off',
    });
    this.adapterOptions = options;
  }

  override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    if ((options.maxRetries ?? 0) !== 0 || this.maxRetries !== 0) {
      throw APIError.generate(501, { error: { message: 'Retries are unsupported for Chert sends' } }, undefined, new Headers());
    }
    if (new URL(options.path, virtualBase).pathname === '/api/send-typing-indicator' &&
        (options.method.toUpperCase() !== 'POST' || options.query !== undefined || options.headers !== undefined ||
         options.fetchOptions !== undefined || options.defaultBaseURL !== undefined || !typingParameters(options.body))) {
      throw APIError.generate(501, { error: { message: 'Unsupported typing parameters or request overrides' } }, undefined, new Headers());
    }
    if(new URL(options.path,virtualBase).pathname==='/api/v2/messages'&&
      (options.method.toUpperCase()!=='GET'||options.body!==undefined||options.headers!==undefined
        ||options.fetchOptions!==undefined||options.defaultBaseURL!==undefined)){
      throw APIError.generate(501,{error:{message:'Unsupported account history request overrides'}},undefined,new Headers());
    }
    if (options.idempotencyKey !== undefined || options.stream || options.__binaryResponse) {
      throw APIError.generate(501, { error: { message: 'This request feature is unsupported by the Chert adapter' } }, undefined, new Headers());
    }
  }

  override withOptions(options: Partial<ClientOptions>): this {
    return new SendblueAPI({ ...this.adapterOptions, ...options, chert: this.adapterOptions.chert }) as this;
  }
}

export default SendblueAPI;

export { createSendblueReactionFetch } from "./reactions.js";
