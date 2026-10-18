import OfficialBlooio, { APIError, type ClientOptions } from '@blooio/sdk';
import type { MeRetrieveResponse } from '@blooio/sdk/resources/me';
import type { MessageSendResponse, MessageRetrieveResponse, MessageGetStatusResponse } from '@blooio/sdk/resources/messages';
import { ChertClient, ChertAPIError, type ChertClientOptions } from '@chert/sdk';

export * from '@blooio/sdk';
export type BlooioAdapterOptions = ClientOptions & { chert: ChertClientOptions };
type FinalRequestOptions = Parameters<OfficialBlooio['buildRequest']>[0];
const virtualBase = 'https://blooio.chert.invalid';

function failure(status: number, message: string): Response {
  return Response.json({ error: { code: status === 501 ? 'unsupported_feature' : 'invalid_response', message } }, { status });
}

function strictText(value: unknown, max: number): value is string {
  return typeof value === 'string' && !value.includes('\0') && value.trim().length > 0 && new TextEncoder().encode(value).length <= max
    && new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}
function mapSend(value: unknown): MessageSendResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Chert response');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join() !== 'chat_id,message_id,status,success' || result.success !== true
    || typeof result.message_id !== 'string' || !/^[a-f0-9]{32}(?![\s\S])/.test(result.message_id)
    || typeof result.chat_id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}(?![\s\S])/.test(result.chat_id)
    || result.status !== 'queued') throw new Error('Invalid strict text receipt');
  return {message_id:result.message_id,status:'queued'};
}

function readTarget(path: string): { id: string; statusOnly: boolean } | null {
  const match = /^\/v1\/api\/messages\/([^/]+)(\/status)?$/.exec(path);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9:_-]+$/.test(id) ? { id, statusOnly: Boolean(match[2]) } : null;
  } catch { return null; }
}
function mapRead(value: unknown, id: string, statusOnly: boolean): MessageRetrieveResponse | MessageGetStatusResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Chert response');
  const row = value as Record<string, unknown>;
  if (row.id !== id) throw new Error('Chert returned a different message');
  const result: MessageRetrieveResponse = { message_id: id };
  if (row.status === 'sent' && row.delivered === true) result.status = 'delivered';
  else if (typeof row.status === 'string' && ['pending', 'queued', 'sent', 'delivered', 'failed'].includes(row.status)) result.status = row.status as MessageRetrieveResponse['status'];
  if (!statusOnly) {
    if (typeof row.phone === 'string') result.external_id = row.phone;
    if (row.direction === 'inbound' || row.direction === 'outbound') result.direction = row.direction;
    if (typeof row.service === 'string' && ['imessage', 'sms', 'rcs'].includes(row.service)) result.protocol = row.service;
  }
  return result;
}

function mapIdentity(value: unknown): MeRetrieveResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).is_active !== 'boolean') throw new Error('Invalid Chert identity response');
  return { valid: (value as { is_active: boolean }).is_active };
}

/** Published 0.0.2 SDK text sends, tenant-scoped recorded reads and authenticated identity. */
export class Blooio extends OfficialBlooio {
  private readonly adapterOptions: BlooioAdapterOptions;
  override request<Rsp>(options: Parameters<OfficialBlooio['request']>[0], remainingRetries?: number | null) {
    if (remainingRetries != null && remainingRetries !== 0) throw new TypeError('Explicit retry attempts are unsupported for Chert sends');
    return super.request<Rsp>(options, remainingRetries);
  }

  constructor(options: BlooioAdapterOptions) {
    if (!options?.chert) throw new TypeError('Explicit chert connection options are required');
    if (options.maxRetries !== undefined && options.maxRetries !== 0) {
      throw new TypeError('Chert sends require maxRetries: 0 to avoid duplicate messages');
    }
    const chert = new ChertClient(options.chert);
    const transport: NonNullable<ClientOptions['fetch']> = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const identity = request.method === 'GET' && url.pathname === '/v1/api/me';
      const read = request.method === 'GET' ? readTarget(url.pathname) : null;
      if (url.origin !== virtualBase || url.search || url.hash || (!identity && !read && (url.pathname !== '/v1/api/messages' || request.method !== 'POST'))) {
        return failure(501, 'Only legacy text sends, recorded-message reads and identity are supported');
      }
      const fields = identity || read ? null : await request.json() as Record<string, unknown>;
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!identity && !read && idempotencyKey !== null && !strictText(idempotencyKey,200)) return failure(400,'Invalid idempotency key');
      try {
        if (identity) {
          const result = await chert.request<unknown>('/whoami', { method: 'GET', signal: request.signal });
          try { return Response.json(mapIdentity(result)); }
          catch { return failure(502, 'Chert returned an incompatible identity response'); }
        }
        if (read) {
          const result = await chert.request<unknown>(`/messages/${encodeURIComponent(read.id)}`, { method: 'GET', signal: request.signal });
          try { return Response.json(mapRead(result, read.id, read.statusOnly)); }
          catch { return failure(502, 'Chert returned an incompatible recorded-message response'); }
        }
        const result = await chert.requestWithResponse<unknown>('/text-operations/v1', {
          method: 'POST', signal: request.signal,
          body: {
            phone: fields!.to, body: fields!.text,
            ...(idempotencyKey !== null ? { idempotency_key: idempotencyKey } : {}),
          },
        });
        try { if(result.status!==202)throw new Error('Unexpected strict response status');return Response.json(mapSend(result.data),{status:202}); }
        catch { return failure(502, 'Chert returned an invalid send response'); }
      } catch (error) {
        if (error instanceof ChertAPIError) {
          return Response.json({ error: { code: error.code, message: error.message, data: error.data } }, {
            status: error.status, headers: error.requestId ? { 'x-request-id': error.requestId } : undefined,
          });
        }
        throw error;
      }
    };
    super({ ...options, apiKey: 'chert-adapter', baseURL: virtualBase, fetch: transport, maxRetries: 0, logLevel: 'off' });
    this.adapterOptions = { ...options, apiKey: 'chert-adapter' };
  }

  override async prepareOptions(options: FinalRequestOptions): Promise<void> {
    const reject = (status: number, message: string): never => {
      throw APIError.generate(status, { error: { message } }, undefined, new Headers());
    };
    if ((options.maxRetries ?? 0) !== 0 || this.maxRetries !== 0) reject(501, 'Retries are unsupported for Chert sends');
    const identity = options.method.toUpperCase() === 'GET' && options.path === '/v1/api/me';
    const read = options.method.toUpperCase() === 'GET' && readTarget(options.path);
    if ((!identity && !read && (options.path !== '/v1/api/messages' || options.method.toUpperCase() !== 'POST')) ||
        options.stream || options.__binaryResponse || options.idempotencyKey !== undefined ||
        (options.query && Object.keys(options.query).length)) reject(501, 'Unsupported legacy Blooio operation');
    if (identity || read) {
      if (options.body !== undefined) reject(501, 'Identity and recorded-message reads do not accept a body');
      return;
    }
    if (!options.body || typeof options.body !== 'object' || Array.isArray(options.body)) reject(400, 'Expected text send parameters');
    const body = options.body as Record<string, unknown>;
    if (Object.keys(body).some(key => !['to', 'text'].includes(key))) reject(501, 'Attachments, metadata and unknown fields are unsupported');
    if (typeof body.to !== 'string' || !/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(body.to) || !strictText(body.text,16384)) {
      reject(400, 'Canonical E.164 recipient and nonempty lossless UTF-8 text up to 16 KiB are required');
    }
  }

  override withOptions(options: Partial<ClientOptions>): this {
    return new Blooio({ ...this.adapterOptions, ...options, chert: this.adapterOptions.chert }) as this;
  }
}

export default Blooio;
