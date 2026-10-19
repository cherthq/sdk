import {ChertClient} from '@cherthq/imessage';

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const idPattern=/^[a-f0-9]{48}(?![\s\S])/;
const tenantPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/;
const signaturePattern=/^[a-f0-9]{64}(?![\s\S])/;
export class MediaSourceError extends Error {
  constructor(public readonly code:'unsupported_feature'|'invalid_response',public readonly status:501|502){
    super(code==='unsupported_feature'?'Unsupported image URL.':'Chert returned incompatible uploaded image metadata.');
  }
}
const invalid=():never=>{throw new MediaSourceError('invalid_response',502);};
function image(v:Record<string,unknown>):boolean {
  return typeof v.size_bytes==='number'&&Number.isSafeInteger(v.size_bytes)&&v.size_bytes>0&&v.size_bytes<=100*1024*1024
    &&typeof v.filename==='string'&&v.filename.length>0&&v.filename.length<=255&&!/[\\/\x00-\x1f\x7f]/.test(v.filename)
    &&((v.content_type==='image/png'&&/\.png$/i.test(v.filename))||(v.content_type==='image/jpeg'&&/\.jpe?g$/i.test(v.filename)))
    &&!['live_photo','companion_attachment_id','live_photo_uuid','live_photo_uuid_mismatch'].some(key=>v[key]!==undefined);
}
function capability(raw:unknown,origin:string):{id:string;url:string}|null {
  if(typeof raw!=='string')return null;
  try{
    const u=new URL(raw), match=/^\/api\/v1\/attachments\/([a-f0-9]{48})\/download(?![\s\S])/.exec(u.pathname);
    const tenant=u.searchParams.get('tenant'),signature=u.searchParams.get('signature');
    if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||u.hash||u.href!==raw||!match
      ||!tenant||!tenantPattern.test(tenant)||!signature||!signaturePattern.test(signature)
      ||u.search!==`?tenant=${tenant}&signature=${signature}`)return null;
    return{id:match[1]!,url:raw};
  }catch{return null;}
}
/** Pure request-shape validation; no network or ownership attestation. */
export function validateMediaSourceURL(baseURL:string,originalURL:string):void {
  let parsed:URL,origin:string;
  try{
    origin=new URL(baseURL).origin;parsed=new URL(originalURL);
    if(!originalURL||originalURL.length>4096||/[\x00-\x20\x7f]/.test(originalURL)||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw 0;
  }catch{throw new MediaSourceError('unsupported_feature',501);}
  if(!capability(originalURL,origin)&&(parsed.origin===origin||/^\/api\/v1\/attachments\//.test(parsed.pathname)))throw new MediaSourceError('unsupported_feature',501);
}
/** Call only after historical idempotency lookup. Never fetches a supplied URL;
 * SSRF/DNS/redirect enforcement belongs to the authenticated server importer.
 * originalURL is not normalized or changed in the caller's request hash.
 * This does not deduplicate concurrent imports: the caller must recheck its
 * original idempotency context after import / on a dispatch conflict. Duplicate
 * imports can leave additional uploaded objects; this helper never sends. */
export async function resolveMediaSource(client:ChertClient,baseURL:string,originalURL:string,signal?:AbortSignal):Promise<{id:string;url:string}> {
  signal?.throwIfAborted();
  validateMediaSourceURL(baseURL,originalURL);
  const origin=new URL(baseURL).origin;
  let source=capability(originalURL,origin);
  let imported:Record<string,unknown>|null=null;
  if(!source){
    const result=await client.requestWithResponse<unknown>('/attachments/import',{method:'POST',body:{url:originalURL},signal});
    signal?.throwIfAborted();
    const v=result.data;
    if(result.status!==200||!record(v)||Object.keys(v).sort().join()!=='attachment_id,content_type,download_url,filename,size_bytes,uploaded'
      ||typeof v.attachment_id!=='string'||!idPattern.test(v.attachment_id)||v.uploaded!==true||!image(v))return invalid();
    imported=v;source=capability(v.download_url,origin);
    if(!source||source.id!==v.attachment_id)invalid();
  }
  const result=await client.requestWithResponse<unknown>(`/attachments/${source!.id}`,{method:'GET',signal});
  signal?.throwIfAborted();
  const meta=record(result.data)&&record(result.data.attachment)?result.data.attachment:null;
  if(result.status!==200||!meta||meta.attachment_id!==source!.id||meta.download_url!==source!.url||!image(meta)
    ||typeof meta.uploaded_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})(?![\s\S])/.test(meta.uploaded_at)||!Number.isFinite(Date.parse(meta.uploaded_at)))invalid();
  if(imported&&['filename','content_type','size_bytes'].some(k=>imported![k]!==meta![k]))invalid();
  return source!;
}
