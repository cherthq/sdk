import { ChertAPIError, ChertClient, validateMediaCapability } from '@cherthq/imessage';
import type { MessageListResponse } from 'sendblue/resources/messages/messages';

const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const phone=(v:unknown):v is string=>typeof v==='string'&&/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9:_.-]{1,160}(?![\s\S])/.test(v)&&v!=='.'&&v!=='..';
const iso=(v:unknown):v is string=>{
  if(typeof v!=='string')return false;
  const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|([+-])(\d\d):(\d\d))(?![\s\S])/.exec(v);
  if(!m)return false;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1]!&&Number(m[4])<24&&Number(m[5])<60&&Number(m[6])<60
    &&(!m[7]||(Number(m[8])<24&&Number(m[9])<60))&&Number.isFinite(Date.parse(v));
};
// Preserve decimal precision that Date.parse truncates below milliseconds.
function compareTime(a:string,b:string):number {
  const seconds=Math.floor(Date.parse(a)/1000)-Math.floor(Date.parse(b)/1000);
  if(seconds)return seconds;
  const af=/\.(\d+)/.exec(a)?.[1]??'',bf=/\.(\d+)/.exec(b)?.[1]??'';
  const width=Math.max(af.length,bf.length),left=af.padEnd(width,'0'),right=bf.padEnd(width,'0');
  return left<right?-1:left>right?1:0;
}
const invalid=()=>new ChertAPIError(502,'invalid_account_history','Chert returned incompatible account history');
const unsupported=()=>new ChertAPIError(501,'unsupported_feature','Unsupported account history query');
const statuses:Record<string,string>={QUEUED:'queued',SENT:'sent',DELIVERED:'delivered',RECEIVED:'received',ERROR:'failed'};

/** One provider request becomes one tenant-owned Chert read; no client-side fanout. */
export function accountHistoryQuery(query: URLSearchParams): URLSearchParams {
  const result=new URLSearchParams();
  for(const [key,value] of query){
    if(query.getAll(key).length!==1)throw unsupported();
    if(['number','from_number','to_number','sendblue_number'].includes(key)){
      if(!phone(value))throw unsupported();result.set(key==='sendblue_number'?'line_number':key,value);
    }else if(['limit','offset'].includes(key)){
      if(!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(value))throw unsupported();
      const n=Number(value);if(!Number.isSafeInteger(n)||(key==='limit'?(n<1||n>200):n>10000))throw unsupported();result.set(key,value);
    }else if(/^(?:created|updated|sent)_at_(?:gte|lte)(?![\s\S])/.test(key)){
      if(!iso(value))throw unsupported();result.set(key,value);
    }else if(key==='is_outbound'){
      if(value!=='true'&&value!=='false')throw unsupported();result.set('direction',value==='true'?'outbound':'inbound');
    }else if(key==='order_by'){
      const fields={createdAt:'created_at',updatedAt:'updated_at',sentAt:'sent_at'};if(!Object.hasOwn(fields,value))throw unsupported();result.set(key,fields[value as keyof typeof fields]);
    }else if(key==='order_direction'){
      if(value!=='asc'&&value!=='desc')throw unsupported();result.set(key,value);
    }else if(key==='status'){
      if(!Object.hasOwn(statuses,value))throw unsupported();result.set(key,statuses[value]!);
    }else if(key==='service'){
      if(value!=='iMessage')throw unsupported();result.set(key,'imessage');
    }else if(key==='message_type'){
      if(value!=='message')throw unsupported();result.set('is_group','false');
    }else throw unsupported();
  }
  for(const clock of ['created','updated','sent']){
    const a=result.get(`${clock}_at_gte`),b=result.get(`${clock}_at_lte`);
    if(a&&b&&compareTime(a,b)>0)throw unsupported();
  }
  return result;
}

export function mapAccountHistory(value:unknown, query:URLSearchParams,baseURL?:string):MessageListResponse {
  if(!record(value)||!Array.isArray(value.messages)||!record(value.pagination))throw invalid();
  const p=value.pagination;
  if(typeof p.has_more!=='boolean'||!Number.isSafeInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>200
    ||!Number.isSafeInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>10000
    ||!Number.isSafeInteger(p.total)||Number(p.total)<0||value.messages.length>Number(p.limit)
    ||value.messages.length!==Math.min(Number(p.limit),Math.max(0,Number(p.total)-Number(p.offset)))
    ||p.has_more!==(Number(p.offset)+value.messages.length<Number(p.total))
    ||(query.has('limit')&&Number(query.get('limit'))!==p.limit)||(query.has('offset')&&Number(query.get('offset'))!==p.offset))throw invalid();
  const seen=new Set<string>();
  const data:NonNullable<MessageListResponse['data']>=value.messages.map((r:unknown)=>{
    if(!record(r)||!id(r.id)||!id(r.chat_id)||seen.has(r.id))throw invalid();seen.add(r.id);
    if(!['strict_text_intent','strict_media_intent','unknown'].includes(String(r.endpoint_source)))throw invalid();
    for(const key of ['from','to','line_number'])if(r[key]!==null&&!phone(r[key]))throw invalid();
    for(const key of ['created_at','updated_at','sent_at'])if(r[key]!==null&&r[key]!==undefined&&!iso(r[key]))throw invalid();
    if(r.endpoint_source==='unknown'&&[r.from,r.to,r.line_number,r.phone_line_id,r.is_group].some(v=>v!==null))throw invalid();
    if(r.is_group!==null&&typeof r.is_group!=='boolean')throw invalid();
    if(!['imessage','sms','rcs','unknown'].includes(String(r.service)))throw invalid();
    if(!['inbound','outbound','unknown'].includes(String(r.direction)))throw invalid();
    const out:NonNullable<MessageListResponse['data']>[number]={message_handle:r.id};
    if(r.endpoint_source==='strict_text_intent'||r.endpoint_source==='strict_media_intent'){
      if(!phone(r.from)||!phone(r.to)||r.line_number!==r.from||r.direction!=='outbound'||r.is_group!==false
        ||typeof r.phone_line_id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i.test(r.phone_line_id))throw invalid();
      out.from_number=r.from;out.to_number=r.to;out.sendblue_number=r.line_number;
      out.number=r.to;
    }
    if(r.direction!=='unknown')out.is_outbound=r.direction==='outbound';
    if(r.is_group!==null)out.message_type=r.is_group?'group':'message';
    if(!['queued','sent','delivered','read','received','failed','unknown'].includes(String(r.status)))throw invalid();
    const status=Object.entries(statuses).find(([,v])=>v===r.status)?.[0];
    if(status)out.status=status as typeof out.status;
    else if(r.status==='read'&&r.direction==='outbound')out.status='DELIVERED';
    else if(r.status==='read'&&r.direction==='inbound')out.status='RECEIVED';
    if(r.sent_at)out.date_sent=r.sent_at as string;if(r.updated_at)out.date_updated=r.updated_at as string;
    if(r.service==='imessage')out.service='iMessage';
    if(r.endpoint_source==='strict_media_intent'){
      if(!baseURL||!Array.isArray(r.parts)||!Array.isArray(r.attachments)||r.attachments.length!==1)throw invalid();
      const parts=r.parts,media=parts.at(-1),caption=parts.length===2?parts[0]:undefined;
      if((parts.length!==1&&parts.length!==2)||!record(media)||media.type!=='media'
        ||Object.keys(media).sort().join(',')!=='attachment_id,type'||typeof media.attachment_id!=='string')throw invalid();
      if(caption!==undefined){
        if(!record(caption)||Object.keys(caption).sort().join(',')!=='type,value'||caption.type!=='text'||typeof caption.value!=='string'
          ||!caption.value.trim()||caption.value.includes('\0')||new TextEncoder().encode(caption.value).length>16384
          ||new TextDecoder().decode(new TextEncoder().encode(caption.value))!==caption.value)throw invalid();
        out.content=caption.value;
      }
      if(!record(r.attachments[0])||Object.keys(r.attachments[0]).sort().join(',')!=='attachment_id,content_type,download_url,download_url_expires_at,filename,size_bytes')throw invalid();
      const capability=validateMediaCapability(r.attachments[0],media.attachment_id,baseURL);
      if(!capability)throw invalid();out.media_url=capability.download_url;
    }else if(r.attachments!==undefined)throw invalid();
    if(r.parts!==undefined){
      if(!Array.isArray(r.parts)||r.parts.some((part:unknown)=>!record(part)||typeof part.type!=='string'||(part.type==='text'&&typeof part.value!=='string')))throw invalid();
      if(r.parts.length&&r.parts.every((part:unknown)=>record(part)&&part.type==='text'&&typeof part.value==='string'))
        out.content=r.parts.map((part:Record<string,unknown>)=>part.value).join('\n\n');
    }
    return out;
  });
  return {data,pagination:{hasMore:p.has_more,limit:Number(p.limit),offset:Number(p.offset),total:Number(p.total)}};
}

export async function listAccountHistory(chert:ChertClient,query:URLSearchParams,signal?:AbortSignal,baseURL?:string):Promise<MessageListResponse>{
  const translated=accountHistoryQuery(query);signal?.throwIfAborted();
  const result=await chert.request<unknown>(`/messages${translated.size?'?'+translated:''}`,{signal});
  return mapAccountHistory(result,translated,baseURL);
}
