import {ChertClient,ChertAPIError,type ChertClientOptions,type ChertFetch} from '@cherthq/imessage';
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i.test(v);
const phone=(v:unknown):v is string=>typeof v==='string'&&/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(v);
const names=['love','like','dislike','laugh','emphasize','question'];
const failure=(status:number,message:string)=>Response.json({status:'ERROR',message},{status});
/** Explicit HTTP-only subset; the pinned official SDK class is unchanged. No fallback or retries. */
export function createSendblueReactionFetch(options:ChertClientOptions):ChertFetch {
 const chert=new ChertClient(options);
 return async(input,init)=>{
  let request:Request|undefined,body:Record<string,unknown>;
  try {
   request=new Request(input,init);const url=new URL(request.url);
   if(url.origin!=='https://api.sendblue.com'||url.username||url.password||url.pathname!=='/api/send-reaction'||url.search||url.hash||request.method!=='POST')return failure(400,'Unsupported reaction request');
   const reader=request.body?.getReader();if(!reader)return failure(400,'Invalid reaction parameters');
   const chunks:Uint8Array[]=[];let size=0;
   try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return failure(400,'Invalid reaction parameters');}chunks.push(part.value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const value:unknown=JSON.parse(raw);
   if(!record(value)||Object.keys(value).some(k=>!['from_number','message_handle','reaction','part_index'].includes(k))
     ||!phone(value.from_number)||!uuid(value.message_handle)||typeof value.reaction!=='string'
     ||!names.includes(value.reaction.startsWith('-')?value.reaction.slice(1):value.reaction)
     ||(Object.hasOwn(value,'part_index')&&value.part_index!==0))return failure(400,'Unsupported reaction parameters');
   body=value;
  }catch{request?.signal.throwIfAborted();return failure(400,'Invalid reaction request');}
  if(!request)return failure(400,'Invalid reaction request');
  request.signal.throwIfAborted();
  const from=body.from_number as string,handle=body.message_handle as string,reaction=body.reaction as string;
  let messageLookup=true;
  try {
   const row=await chert.request<unknown>(`/messages/${encodeURIComponent(handle)}`,{signal:request.signal});
   messageLookup=false;
   if(!record(row))return failure(422,'unsupported_target');
   const context=row.native_received_context;
   if(row.native_guid!==handle||row.direction!=='inbound'||row.service!=='imessage'
     ||row.id!==handle||!uuid(row.chat_id)||typeof row.id!=='string'||!/^[A-Za-z0-9:_.-]{1,160}(?![\s\S])/.test(row.id)||['.','..'].includes(row.id)
     ||!Array.isArray(row.parts)||row.parts.length!==1||!record(row.parts[0])||row.parts[0].type!=='text'
     ||Object.keys(row.parts[0]).sort().join()!=='type,value'||typeof row.parts[0].value!=='string'||!row.parts[0].value.length||row.parts[0].value.includes('\0')
     ||new TextEncoder().encode(row.parts[0].value).length>16384||new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(row.parts[0].value))!==row.parts[0].value
     ||!record(context)||Object.keys(context).sort().join()!=='associated_message_guid,associated_message_type,balloon_bundle_id,is_from_me,is_group,phone_line_id,primary_guid,receiver,service,source_event_id,version'
     ||context.version!==1||context.primary_guid!==handle||context.receiver!==from||context.service!=='iMessage'
     ||context.is_from_me!==false||context.is_group!==false||context.associated_message_type!==0
     ||context.associated_message_guid!==null||context.balloon_bundle_id!==null||!uuid(context.phone_line_id)
     ||row.phone_line_id!==context.phone_line_id||context.source_event_id!=='recv:'+handle)return failure(422,'unsupported_target');
   const inventory=await chert.request<unknown>('/phone-numbers',{signal:request.signal});
   if(!record(inventory)||!Array.isArray(inventory.phone_numbers))return failure(422,'unsupported_on_this_line');
   const byId=inventory.phone_numbers.filter(v=>record(v)&&v.id===context.phone_line_id);
   const byNumber=inventory.phone_numbers.filter(v=>record(v)&&v.phone_number===from);
   if(byId.length!==1||byNumber.length!==1||byId[0]!==byNumber[0])return failure(422,'unsupported_on_this_line');
   const selected=byId[0];
   if(!record(selected)||selected.service!=='imessage'||selected.is_active!==true||!Array.isArray(selected.capabilities)
     ||!selected.capabilities.includes('imessage')||!selected.capabilities.includes('send'))return failure(422,'unsupported_on_this_line');
   const chatId=row.chat_id.toLowerCase();
   const result=await chert.requestWithResponse<unknown>(`/chats/${chatId}/messages/${encodeURIComponent(handle)}/reactions`,{
    method:'POST',signal:request.signal,body:{reaction:reaction.startsWith('-')?reaction.slice(1):reaction,remove:reaction.startsWith('-'),part_index:0,
     received_target:{primary_guid:handle,phone_line_id:context.phone_line_id,receiver:from}}});
   const receipt=result.data;
   if(result.status!==202||!record(receipt)||Object.keys(receipt).sort().join()!=='chat_id,message_id,operation_id,status'
     ||typeof receipt.operation_id!=='string'||!/^[a-f0-9]{32}(?![\s\S])/.test(receipt.operation_id)
     ||receipt.chat_id!==chatId||receipt.message_id!==handle||receipt.status!=='acknowledged')return failure(502,'Reaction outcome unconfirmed; reconcile before retrying');
   return Response.json({status:'OK',message:'Reaction request sent',message_handle:handle,reaction},{status:200});
  }catch(error){
   request.signal.throwIfAborted();
   if(messageLookup&&error instanceof ChertAPIError&&error.status===404)return failure(404,'The message to react to was not found for this account');
   if(error instanceof ChertAPIError&&error.status===422&&error.code==='4099')return failure(422,'unsupported_target');
   if(error instanceof ChertAPIError)return failure(error.status>=400&&error.status<=599?error.status:502,'Reaction outcome unconfirmed; reconcile before retrying');
   return failure(502,'Reaction outcome unconfirmed; reconcile before retrying');
  }
 };
}
