export type ChertMediaCapability={attachment_id:string;filename:string;content_type:string;size_bytes:number;download_url:string;download_url_expires_at:string};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,re:RegExp):v is string=>typeof v==='string'&&re.exec(v)?.[0]===v;
const timestamp=(v:unknown):v is string=>exact(v,/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v.slice(0,10)+'T00:00:00Z')).toISOString().slice(0,10)===v.slice(0,10);
/** Validate public metadata/capability structure, never fetch, renew or claim HMAC verification.
 * Ownership and signature authority remain with the authenticated Chert API. */
function parseMediaCapability(value:unknown,id:string,baseURL:string,fresh:boolean):ChertMediaCapability|null{
 if(!exact(id,/^[a-f0-9]{48}$/)||!record(value))return null;
 const a=value;
 if(a.attachment_id!==id||typeof a.filename!=='string'||!a.filename.trim()||a.filename.length>255||/[\\/\x00-\x1f\x7f]/.test(a.filename)
  ||!exact(a.content_type,/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/)||typeof a.size_bytes!=='number'||!Number.isSafeInteger(a.size_bytes)||a.size_bytes<=0||a.size_bytes>100*1024*1024
  ||typeof a.download_url!=='string'||!timestamp(a.download_url_expires_at))return null;
 try{
  const base=new URL(baseURL),url=new URL(a.download_url);
  if((base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))||base.username||base.password||base.search||base.hash)return null;
  if(base.pathname==='/')base.pathname='/api/v1';
  const expiry=url.searchParams.get('expires'),tenant=url.searchParams.get('tenant'),signature=url.searchParams.get('signature');
  if(url.origin!==base.origin||url.href!==a.download_url||url.username||url.password||url.hash||url.pathname!==`${base.pathname.replace(/\/+$/,'')}/attachments/${id}/download`
   ||[...url.searchParams].length!==3||['tenant','signature','expires'].some(k=>url.searchParams.getAll(k).length!==1)
   ||!exact(tenant,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)||!exact(signature,/^[a-f0-9]{64}$/)||!exact(expiry,/^[1-9]\d{0,12}$/))return null;
  const ms=Number(expiry)*1000;if(!Number.isSafeInteger(ms)||(fresh&&(ms<=Date.now()||ms>Math.floor(Date.now()/1000)*1000+3600000))||new Date(ms).toISOString()!==a.download_url_expires_at)return null;
 }catch{return null;}
 return{attachment_id:id,filename:a.filename,content_type:a.content_type,size_bytes:a.size_bytes,download_url:a.download_url,download_url_expires_at:a.download_url_expires_at};
}
/** Validate a newly issued capability, including its remaining one-hour lifetime. */
export function validateMediaCapability(value:unknown,id:string,baseURL:string):ChertMediaCapability|null{return parseMediaCapability(value,id,baseURL,true);}
/** Validate an original receipt structurally. An expired URL is not renewed or promised usable. */
export function validateFrozenMediaCapability(value:unknown,id:string,baseURL:string):ChertMediaCapability|null{return parseMediaCapability(value,id,baseURL,false);}
