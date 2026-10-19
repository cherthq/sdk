import {validateMediaCapability,validateFrozenMediaCapability} from '@cherthq/imessage';
import type {MediaPartResponse} from '@linqapp/sdk/resources/shared';
import type {MessageSendResponse} from '@linqapp/sdk/resources/chats/messages';
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,re:RegExp):v is string=>typeof v==='string'&&re.exec(v)?.[0]===v;
const timestamp=(v:unknown):v is string=>exact(v,/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v.slice(0,10)+'T00:00:00Z')).toISOString().slice(0,10)===v.slice(0,10);
export function queuedMediaMessage(raw:unknown,chat:string,id:string,baseURL:string,historical=false):MessageSendResponse|null{
 if(!record(raw)||!record(raw.message))return null;
 const m=raw.message;
 if(!exact(m.id,/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i)||m.chat_id!==chat||!timestamp(m.created_at)||m.status!=='queued'
  ||m.sent_at!=null||m.delivered_at!=null||m.read_at!=null||m.delivered===true||m.read===true||m.is_read===true||m.is_sent===true||m.is_delivered===true||(m.direction!==undefined&&m.direction!=='outbound')||m.ok===false||m.success===false||m.error!=null
  ||!Array.isArray(m.parts)||m.parts.length!==1||!record(m.parts[0])||Object.keys(m.parts[0]).sort().join(',')!=='attachment_id,type'||m.parts[0].type!=='media'||m.parts[0].attachment_id!==id
  ||!Array.isArray(m.attachments)||m.attachments.length!==1||!record(m.attachments[0]))return null;
 const part=frozenMediaPart(m.attachments[0],id,baseURL,historical);if(!part)return null;
 return{chat_id:chat,message:{id:m.id,created_at:m.created_at,delivery_status:'queued',is_read:false,sent_at:null,parts:[part]}};
}
/** Preserve Linq's provider schema around the shared, provider-neutral validator. */
export function frozenMediaPart(value:unknown,id:string,baseURL:string,historical=false):MediaPartResponse|null{
 const a=(historical?validateFrozenMediaCapability:validateMediaCapability)(value,id,baseURL);
 return a?{type:'media',id:a.attachment_id,filename:a.filename,mime_type:a.content_type,size_bytes:a.size_bytes,url:a.download_url,reactions:null}:null;
}
