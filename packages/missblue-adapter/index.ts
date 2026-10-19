import {ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch} from '@cherthq/imessage';

export const MISSBLUE_CONTRACT = Object.freeze({
  source: 'https://missblue.dev/openapi.json', version: '1.0.0',
  retrieved: '2026-10-18T16:08:25.767398+00:00', sha256: '63ba790ecdfb3e4155ed5af735a41e25f43a3f8d1852b9e53c8791a848df6105',
});
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const publicId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const phone = (v: unknown): v is string => typeof v === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v);
const failure = (status: number, code: string, message: string) => Response.json({error: {code, message}}, {status});
const unsupported = () => failure(501, 'unsupported_feature', 'This Miss Blue operation cannot be represented by this adapter. No mutation was attempted.');
const incompatible = () => failure(502, 'incompatible_response', 'The recorded Chert response cannot establish the requested Miss Blue facts.');
const allowedHeaders = (r: Request) => [...r.headers.keys()].every(k => ['accept', 'authorization', 'content-type'].includes(k));
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === keys.sort().join();
function timestamp(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v.slice(0, 10) + 'T00:00:00Z')).toISOString().slice(0, 10) === v.slice(0, 10);
}
function numbers(value: unknown): Record<string, unknown>[] | null {
  if (!record(value) || !Array.isArray(value.phone_numbers) || value.phone_numbers.length > 10000) return null;
  const ids = new Set<string>(), handles = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const row of value.phone_numbers) {
    if (!record(row) || !uuid(row.id) || !phone(row.phone_number) || row.service !== 'imessage'
      || typeof row.is_active !== 'boolean' || !Array.isArray(row.capabilities)
      || !row.capabilities.every(v => typeof v === 'string') || !row.capabilities.includes('imessage')
      || ids.has(row.id.toLowerCase()) || handles.has(row.phone_number)) return null;
    ids.add(row.id.toLowerCase()); handles.add(row.phone_number);
    result.push({id: row.id.toLowerCase(), handle: row.phone_number, service: 'imessage', disabled: !row.is_active});
  }
  return result;
}
function recorded(value: unknown, id: string): Record<string, unknown> | null {
  if (!record(value) || value.id !== id || value.direction !== 'outbound' || !uuid(value.lead_id)
    || !uuid(value.phone_line_id) || !phone(value.phone) || typeof value.text !== 'string'
    || !value.text.length || value.text.includes('\0') || new TextDecoder('utf-8', {ignoreBOM:true}).decode(new TextEncoder().encode(value.text)) !== value.text
    || new TextEncoder().encode(value.text).length > 16384) return null;
  if (value.response !== undefined && value.response !== null && !record(value.response)) return null;
  const inner = record(value.response) ? value.response : {};
  for (const k of ['status', 'service', 'delivered', 'read', 'error_code', 'error', 'retryable']) {
    if (value[k] !== undefined && inner[k] !== undefined && value[k] !== inner[k]) return null;
  }
  const service = value.service ?? inner.service;
  const delivered = value.delivered ?? inner.delivered, read = value.read ?? inner.read;
  if ((service !== undefined && !['imessage', 'unknown'].includes(service as string))
    || (delivered !== undefined && typeof delivered !== 'boolean') || (read !== undefined && typeof read !== 'boolean')
    || (read === true && delivered !== true)) return null;
  if (value.error_code === 4103 || inner.error_code === 4103 || value.retryable === true || inner.retryable === true) return null;
  let status: string;
  if (['pending', 'queued', 'processing'].includes(value.status as string)) {
    if (delivered === true || read === true) return null;
    status = 'pending';
  } else if (value.status === 'sent') {
    if (service !== 'imessage' || delivered === true || read === true) return null;
    status = 'sent';
  } else if (value.status === 'delivered' || value.status === 'read') {
    if (service !== 'imessage' || delivered !== true || (value.status === 'read' && read !== true)) return null;
    status = value.status;
  } else return null;
  for (const source of [value, inner]) {
    if (source.error !== undefined && source.error !== null) return null;
    if (source.error_code !== undefined || source.ok === false || source.success === false) return null;
  }
  const out: Record<string, unknown> = {id, chat_id: value.lead_id.toLowerCase(), direction: 'outbound',
    recipient: value.phone, text: value.text, status, number_id: value.phone_line_id.toLowerCase()};
  if (service === 'imessage') out.service = 'imessage';
  if (value.created_at !== undefined) {if (!timestamp(value.created_at)) return null; out.created_at = value.created_at;}
  if (value.updated_at !== undefined) {if (!timestamp(value.updated_at)) return null; out.updated_at = value.updated_at;}
  // No message_at: the outbox creation clock is not Apple's original message clock.
  return out;
}
function sendPhone(value: unknown): value is string {
  if (!phone(value)) return false;
  if (value.startsWith('+1')) {
    const n = value.slice(2);
    if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(n) || n.slice(1,3)==='11' || n.slice(4,6)==='11'
      || (n.slice(3,6)==='555' && Number(n.slice(6))>=100 && Number(n.slice(6))<=199)) return false;
  }
  return true;
}
function text(value: unknown): value is string {
  if (typeof value!=='string' || !value.trim() || value.length>16384 || value.includes('\0')) return false;
  const bytes=new TextEncoder().encode(value);
  return bytes.length<=16384 && new TextDecoder('utf-8',{ignoreBOM:true}).decode(bytes)===value;
}
function queued(value: unknown, body: {recipient:string;text:string}): Record<string,unknown>|null {
  if (!record(value) || !record(value.message) || !record(value.chat) || (value.error!==undefined&&value.error!==null) || value.ok===false) return null;
  const m=value.message,c=value.chat;
  if (!exact(m,['id','chat_id','parts','status','direction','created_at','delivered_at','read_at','service']) || !publicId(m.id) || !uuid(m.chat_id) || m.status!=='queued' || m.direction!=='outbound'
    || !timestamp(m.created_at) || m.delivered_at!==null || m.read_at!==null || m.service!=='unknown'
    || !Array.isArray(m.parts) || m.parts.length!==1 || !record(m.parts[0]) || !exact(m.parts[0],['type','value'])
    || m.parts[0].type!=='text' || m.parts[0].value!==body.text || c.id!==m.chat_id || c.is_group!==false || (c.service!==undefined&&c.service!=='unknown')
    || !Array.isArray(c.handles) || c.handles.length!==1 || !record(c.handles[0]) || c.handles[0].address!==body.recipient || (c.handles[0].service!==undefined&&c.handles[0].service!=='unknown')) return null;
  // Public IDs are preserved verbatim. No synthetic UUID, native ID or request ID.
  return {id:m.id,chat_id:m.chat_id,status:'pending',queued:true};
}
function fromError(error: unknown): Response {
  if (error instanceof ChertAPIError) {
    if (error.status === 401) return failure(401, 'unauthorized', 'The Chert credential was not accepted.');
    if (error.status === 404) return failure(404, 'not_found', 'No such resource on a number this credential holds.');
    if (error.status === 429) return failure(429, 'rate_limited', 'The request was rate limited.');
  }
  const response = failure(504, 'command_unconfirmed', 'The request outcome is unconfirmed. Reconcile before retrying.');
  // Preserve only actual public reconciliation IDs, separately from provider fields.
  // A lost Chert HTTP reply or malformed acknowledgement supplies no trusted IDs.
  if (error instanceof ChertAPIError && error.status === 502 && error.code === '4103'
    && record(error.data) && publicId(error.data.message_id) && uuid(error.data.chat_id)) {
    response.headers.set('X-Chert-Message-Id', error.data.message_id);
    response.headers.set('X-Chert-Chat-Id', error.data.chat_id);
  }
  return response;
}
/** Explicit HTTP fetch replacement. Never contacts Miss Blue or invents native identifiers. */
export function createMissBlueFetch(options: {chert: ChertClientOptions}): ChertFetch {
  const client = new ChertClient(options.chert);
  return async (input, init) => {
    const request = new Request(input, init); request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== 'https://api.missblue.dev' || url.username || url.password || url.search || url.hash || !allowedHeaders(request)) return unsupported();
    if (request.method === 'GET' && request.body === null && url.pathname === '/v1/numbers') {
      try {
        const data = numbers(await client.request<unknown>('/phone-numbers', {signal: request.signal}));
        return data ? Response.json({total: data.length, data}) : incompatible();
      } catch (error) {request.signal.throwIfAborted(); return fromError(error);}
    }
    const match = /^\/v1\/messages\/([a-f0-9]{32})$/.exec(url.pathname);
    if (request.method === 'GET' && request.body === null && match) {
      try {
        const result = await client.requestWithResponse<unknown>(`/messages/${match[1]}`, {signal:request.signal});
        const data = result.status === 200 ? recorded(result.data, match[1]!) : null;
        return data ? Response.json(data) : incompatible();
      } catch (error) {request.signal.throwIfAborted(); return fromError(error);}
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      let body:unknown;try {body=await request.json();}catch {return failure(400,'bad_request','Invalid JSON.');}
      if (!record(body) || !exact(body,['number_id','recipient','text'])) return unsupported();
      if (!uuid(body.number_id) || !sendPhone(body.recipient) || !text(body.text)) return failure(400,'bad_request','Provide an owned UUID number_id, canonical phone recipient and lossless nonblank plaintext within 16384 UTF-8 bytes.');
      const numberId=body.number_id.toLowerCase(), recipient=body.recipient, content=body.text;
      try {
        const inventory=await client.request<unknown>('/phone-numbers',{signal:request.signal});
        const lines=numbers(inventory);if(!lines) return incompatible();
        const line=lines.find(v=>v.id===numberId);
        if(!line)return failure(404,'not_found','No such source number is held by this credential.');
        const raw=record(inventory)&&Array.isArray(inventory.phone_numbers)?inventory.phone_numbers.find(v=>record(v)&&typeof v.id==='string'&&v.id.toLowerCase()===numberId):null;
        if(line.disabled!==false || !record(raw) || !Array.isArray(raw.capabilities) || !raw.capabilities.includes('send'))return unsupported();
        request.signal.throwIfAborted();
        // Explicit-from is the actual Chert authority. UUID-to-phone inventory
        // resolution is not an atomic guard against concurrent same-phone reassignment.
        const result=await client.requestWithResponse<unknown>('/chats',{method:'POST',signal:request.signal,
          body:{from:line.handle,to:[recipient],message:{parts:[{type:'text',value:content}]}}});
        const data=result.status===202?queued(result.data,{recipient,text:content}):null;
        return data?Response.json(data,{status:201}):failure(504,'command_unconfirmed','Send outcome is unconfirmed. Reconcile before retrying.');
      } catch(error) {request.signal.throwIfAborted();return fromError(error);}
    }
    if (request.method === 'POST' && url.pathname === '/v1/typing') {
      let body: unknown; try {body = await request.json();} catch {return failure(400, 'bad_request', 'Invalid JSON.');}
      if (!record(body) || !exact(body, ['chat_id', 'active']) || !uuid(body.chat_id) || typeof body.active !== 'boolean') return unsupported();
      const chat = body.chat_id.toLowerCase(), state = body.active ? 'typing' : 'stopped';
      try {
        const result = await client.requestWithResponse<unknown>(`/chats/${chat}/typing`, {method:'POST',body:{state},signal:request.signal});
        if (result.status !== 200 || !record(result.data) || !exact(result.data,['chat_id','state','applied'])
          || result.data.chat_id !== chat || result.data.state !== state || result.data.applied !== true) return failure(504,'command_unconfirmed','Typing outcome is unconfirmed. Do not retry automatically.');
        return new Response(null, {status:204});
      } catch (error) {request.signal.throwIfAborted(); return fromError(error);}
    }
    return unsupported();
  };
}
export default createMissBlueFetch;
