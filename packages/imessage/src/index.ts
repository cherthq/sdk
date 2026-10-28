import { readEventStream, type MessagingStreamFrame, type StreamEventsOptions, type EventListOptions, type MessagingEventPage, type RecordedMessagingEvent, type WebhookSubscription, type CreateWebhookSubscription, type UpdateWebhookSubscription } from './events.js';
export { verifyWebhook, type MessagingEvent, type StreamedMessagingEvent, type MessagingWebhookEvent, type MessagingStreamFrame, type StreamEventsOptions, type EventListOptions, type MessagingEventPage, type RecordedMessagingEvent, type WebhookSubscription, type CreateWebhookSubscription, type UpdateWebhookSubscription } from './events.js';

export type ChertFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export const DEFAULT_IMESSAGE_BASE_URL = 'https://console.trychert.com';
export type ChertClientOptions = {
  /** Defaults to https://console.trychert.com; overrides may include a deployment path prefix. */
  baseURL?: string;
  apiKey: string;
  tenant?: string;
  fetch?: ChertFetch;
};
export type StrictTextRequest = { phone: string; body: string; idempotency_key?: string };
/**
 * Server acceptance of one text send, not delivery proof. `success` is set by the SDK.
 * `queued`: accepted for a line (HTTP 202); `sent`: dispatched to a line; `duplicate`: the line's duplicate check already had this message (message_id is a new record).
 */
export type QueuedTextReceipt = { success: true; message_id: string; chat_id: string; status: 'queued' | 'sent' | 'duplicate' };
export type SendTextOptions = { signal?: AbortSignal };
export type StandardReaction = 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question';
export type ReactionRequest = { reaction: StandardReaction; remove?: boolean };
export type SendReactionOptions = { signal?: AbortSignal; idempotencyKey?: string };
export type ReadonlyReactionReceipt = Readonly<{
  operation_id: string; chat_id: string; message_id: string; status: 'acknowledged';
}>;
export type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

export class ChertAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly data: unknown = null,
  ) { super(message); this.name = 'ChertAPIError'; }
}

/** Explicit credentials, no provider fallback and no automatic retries. */
export class ChertClient {
  readonly #base: URL;
  readonly #key: string;
  readonly #tenant?: string;
  readonly #fetch: ChertFetch;
  constructor(options: ChertClientOptions) {
    const rawURL = options.baseURL === undefined ? DEFAULT_IMESSAGE_BASE_URL : options.baseURL;
    let base: URL;
    try {
      if (typeof rawURL !== 'string' || /[\x00-\x20\x7f\\?#]/.test(rawURL) || !/^https?:\/\//i.test(rawURL)
        || rawURL.split('/').slice(3).some(segment => {
          const decoded = decodeURIComponent(segment);
          return decoded === '.' || decoded === '..' || /[/\\\x00-\x20\x7f]/.test(decoded);
        })) throw new TypeError();
      base = new URL(rawURL);
    } catch { throw new TypeError('Invalid Chert baseURL'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.search || base.hash)
      throw new TypeError('Chert baseURL must use HTTPS (or loopback HTTP), without credentials, query or fragment');
    if (!options.apiKey?.trim() || /[\r\n]/.test(options.apiKey)) throw new TypeError('An explicit Chert API key is required');
    if (options.tenant !== undefined && (!options.tenant.trim() || /[\r\n]/.test(options.tenant))) throw new TypeError('Invalid Chert tenant');
    if (base.pathname === '/') base.pathname = '/api/v1';
    this.#base = new URL(base.href.replace(/\/+$/, '') + '/');
    this.#key = options.apiKey;
    this.#tenant = options.tenant;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  /** Strict plaintext acceptance only. Never generates keys, retries or falls back. */
  async sendText(body: StrictTextRequest, options: SendTextOptions = {}): Promise<QueuedTextReceipt> {
    const lossless=(value:string)=>new TextDecoder().decode(new TextEncoder().encode(value))===value;
    if(!isRecord(body)||Object.keys(body).some(key=>!['phone','body','idempotency_key'].includes(key))
      ||typeof body.phone!=='string'||!/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(body.phone)
      ||typeof body.body!=='string'||!body.body.trim()||body.body.includes('\0')||!lossless(body.body)
      ||new TextEncoder().encode(body.body).byteLength>16384
      ||(Object.hasOwn(body,'idempotency_key')&&(typeof body.idempotency_key!=='string'||!body.idempotency_key.length
        ||body.idempotency_key.includes('\0')||body.idempotency_key.trim()!==body.idempotency_key||!lossless(body.idempotency_key)||new TextEncoder().encode(body.idempotency_key).byteLength>200)))
      throw new TypeError('Invalid strict text request');
    if(!isRecord(options)||Object.keys(options).some(key=>key!=='signal')
      ||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))throw new TypeError('Invalid strict text options');
    options.signal?.throwIfAborted();
    // CRM's flat send envelope: 202 queued, or 200 sent/duplicate, with extra lead/line fields.
    const result=await this.#performRequest<unknown>('/send',{method:'POST',body,signal:options.signal},true);
    const data=result.data,id=/^[A-Za-z0-9:_-]{1,160}(?![\s\S])/;
    if(!isRecord(data)||!(result.status===202?data.status==='queued':result.status===200&&(data.status==='sent'||data.status==='duplicate'))
      ||typeof data.message_id!=='string'||!id.test(data.message_id)||typeof data.chat_id!=='string'||!id.test(data.chat_id))
      throw new ChertAPIError(502,'unconfirmed_text_outcome','Text outcome unconfirmed; reconcile before retrying',result.requestId,data);
    return {success:true,message_id:data.message_id,chat_id:data.chat_id,status:data.status as QueuedTextReceipt['status']};
  }
  /** One explicit standard reaction dispatch; no applied/current-state claim. */
  async sendReaction(chatId: string, messageId: string, body: ReactionRequest,
    options: SendReactionOptions = {}): Promise<ReadonlyReactionReceipt> {
    if(typeof chatId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i.test(chatId)
      ||typeof messageId!=='string'||!/^[A-Za-z0-9:_.-]{1,160}(?![\s\S])/.test(messageId)||messageId==='.'||messageId==='..'
      ||!isRecord(body)||Object.keys(body).some(key=>!['reaction','remove'].includes(key))
      ||!['love','like','dislike','laugh','emphasize','question'].includes(body.reaction)
      ||(body.remove!==undefined&&typeof body.remove!=='boolean'))throw new TypeError('Invalid strict reaction request');
    if(!isRecord(options)||Object.keys(options).some(key=>!['signal','idempotencyKey'].includes(key))
      ||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))
      ||(options.idempotencyKey!==undefined&&(typeof options.idempotencyKey!=='string'
        ||!/^[\x20-\x7e]{1,200}(?![\s\S])/.test(options.idempotencyKey)
        ||options.idempotencyKey.startsWith(' ')||options.idempotencyKey.endsWith(' '))))
      throw new TypeError('Invalid strict reaction options');
    const canonicalChat=chatId.toLowerCase(),signal=options.signal,key=options.idempotencyKey;
    const frozenBody={reaction:body.reaction,remove:body.remove??false,part_index:0};
    const unknown=(requestId:string|null=null,data:unknown=null)=>new ChertAPIError(502,'unconfirmed_reaction_outcome',
      'Reaction outcome unconfirmed; reconcile before retrying',requestId,data);
    signal?.throwIfAborted();
    let result:{status:number;data:unknown;requestId:string|null};
    try {
      result=await this.#performRequest<unknown>(`/chats/${canonicalChat}/messages/${encodeURIComponent(messageId)}/reactions`,
        {method:'POST',body:frozenBody,signal},false,key);
    } catch(error) {
      signal?.throwIfAborted();
      if(error instanceof ChertAPIError) {
        if((error.code==='invalid_response'&&error.status===502)||error.status<400
          ||(error.code==='request_failed'&&error.status===502&&isRecord(error.data)&&error.data.success===false))
          throw unknown(error.requestId,error.data);
        throw error;
      }
      throw unknown();
    }
    const data=result.data;
    if(result.status!==202||!isRecord(data)||Object.keys(data).sort().join()!=='chat_id,message_id,operation_id,status'
      ||typeof data.operation_id!=='string'||!/^[a-f0-9]{32}(?![\s\S])/.test(data.operation_id)
      ||data.chat_id!==canonicalChat||data.message_id!==messageId||data.status!=='acknowledged')
      throw unknown(result.requestId,data);
    return Object.freeze({operation_id:data.operation_id,chat_id:canonicalChat,message_id:messageId,status:'acknowledged'});
  }
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.requestWithResponse<T>(path, options)).data;
  }
  async requestWithResponse<T>(path: string, options: RequestOptions = {}): Promise<{status:number;data:T}> {
    const {status,data}=await this.#performRequest<T>(path,options);
    return {status,data};
  }
  listEvents(query: EventListOptions = {}, options: SendTextOptions = {}): Promise<MessagingEventPage> {
    const params = new URLSearchParams();
    for (const key of ['type', 'status', 'lead_id', 'since', 'cursor'] as const) {
      if (query[key] !== undefined) params.set(key, query[key]!);
    }
    if (query.limit !== undefined) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new TypeError('Event limit must be 1–200');
      params.set('limit', String(query.limit));
    }
    return this.request(`/events?${params}`, options);
  }
  getEvent(id: string, options: SendTextOptions = {}): Promise<RecordedMessagingEvent> {
    return this.request(`/events/${this.#resourceId(id)}`, options);
  }
  listWebhookSubscriptions(options: SendTextOptions = {}): Promise<{ subscriptions: WebhookSubscription[] }> {
    return this.request('/webhook-subscriptions', options);
  }
  getWebhookSubscription(id: string, options: SendTextOptions = {}): Promise<{ subscription: WebhookSubscription }> {
    return this.request(`/webhook-subscriptions/${this.#resourceId(id)}`, options);
  }
  createWebhookSubscription(body: CreateWebhookSubscription, options: SendTextOptions = {}): Promise<{ subscription: WebhookSubscription & { secret: string } }> {
    return this.request('/webhook-subscriptions', { ...options, method: 'POST', body });
  }
  updateWebhookSubscription(id: string, body: UpdateWebhookSubscription, options: SendTextOptions = {}): Promise<{ subscription: WebhookSubscription }> {
    return this.request(`/webhook-subscriptions/${this.#resourceId(id)}`, { ...options, method: 'PATCH', body });
  }
  deleteWebhookSubscription(id: string, options: SendTextOptions = {}): Promise<{ deleted: true; id: string }> {
    return this.request(`/webhook-subscriptions/${this.#resourceId(id)}`, { ...options, method: 'DELETE' });
  }
  /** Authenticated SSE, not a delivery guarantee. No reconnect after transport failure or unexpected EOF. */
  async *streamEvents(options: StreamEventsOptions = {}): AsyncGenerator<MessagingStreamFrame> {
    let since = options.since;
    do {
      options.signal?.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', abort, { once: true });
      let continuation: string | undefined;
      try {
        const url = new URL('events/stream', this.#base);
        if (since !== undefined) url.searchParams.set('since', since);
        const headers = new Headers({ Authorization: `Bearer ${this.#key}`, Accept: 'text/event-stream' });
        if (this.#tenant) headers.set('X-Chert-Tenant', this.#tenant);
        const response = await this.#fetch(url, { headers, signal: controller.signal, redirect: 'error' });
        const requestId = response.headers.get('x-trace-id') ?? response.headers.get('x-request-id');
        if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream' || !response.body) {
          await response.body?.cancel();
          throw new ChertAPIError(response.ok ? 502 : response.status, 'stream_unavailable', 'Messaging event stream unavailable', requestId);
        }
        try {
          for await (const frame of readEventStream(response.body)) {
            options.signal?.throwIfAborted();
            if (frame.event === 'close' && isRecord(frame.data) && typeof frame.data.reconnect_with_since === 'string')
              continuation = frame.data.reconnect_with_since;
            yield frame;
            if (frame.event === 'close') break;
          }
        } catch (error) {
          options.signal?.throwIfAborted();
          throw new ChertAPIError(502, 'invalid_event_stream', 'Event stream interrupted or invalid; reconcile before reconnecting', requestId);
        }
      } finally {
        controller.abort();
        options.signal?.removeEventListener('abort', abort);
      }
      if (!options.reconnect) return;
      if (continuation === undefined) throw new ChertAPIError(502, 'event_stream_closed', 'Event stream ended without a continuation; reconcile before reconnecting');
      since = continuation;
      // Bound reconnection rate even if an endpoint closes immediately.
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.signal!.reason); };
        const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(); }, 1000);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    } while (true);
  }
  #resourceId(id: string): string {
    if (typeof id !== 'string' || !id || id === '.' || id === '..') throw new TypeError('A resource ID is required');
    return encodeURIComponent(id);
  }
  async #performRequest<T>(path: string, options: RequestOptions, strictText=false, idempotencyKey?:string): Promise<{status:number;data:T;requestId:string|null}> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) throw new TypeError('Expected a Chert-relative API path');
    const url = new URL(path.slice(1), this.#base);
    if (url.origin !== this.#base.origin || !url.pathname.startsWith(this.#base.pathname)) throw new TypeError('API path escapes the Chert baseURL');
    const headers = new Headers({ Authorization: `Bearer ${this.#key}`, Accept: 'application/json' });
    if (this.#tenant) headers.set('X-Chert-Tenant', this.#tenant);
    if (idempotencyKey!==undefined) headers.set('Idempotency-Key',idempotencyKey);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await this.#fetch(url, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, body, signal: options.signal, redirect: 'error' });
    const requestId = response.headers.get('x-trace-id') ?? response.headers.get('x-request-id');
    if (response.status === 204) return {status:204,data:undefined as T,requestId};
    let data: unknown;
    try { data = await response.json(); }
    catch { if(strictText&&response.ok)throw new ChertAPIError(502,'unconfirmed_text_outcome','Text outcome unconfirmed; reconcile before retrying',requestId);
      throw new ChertAPIError(response.status >= 400 ? response.status : 502, 'invalid_response', 'Chert returned a non-JSON response; reconcile any send before retrying', requestId); }
    if(strictText&&response.ok&&isRecord(data)&&data.success===false)
      throw new ChertAPIError(502,'unconfirmed_text_outcome','Text outcome unconfirmed; reconcile before retrying',requestId,data);
    if (!response.ok || (isRecord(data) && data.success === false)) {
      const error = isRecord(data) ? (isRecord(data.error) ? data.error : data) : null;
      const code = error && (typeof error.code === 'string' || typeof error.code === 'number') ? String(error.code) : 'request_failed';
      // Server bodies may contain customer content. Keep them out of exception messages/logs.
      throw new ChertAPIError(response.ok ? 502 : response.status, code, `Chert request failed (${response.status}); reconcile uncertain sends before retrying`, requestId, data);
    }
    return {status:response.status,data:data as T,requestId};
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export default ChertClient;

export {validateFrozenMediaCapability,validateMediaCapability,type ChertMediaCapability} from './media.js';
