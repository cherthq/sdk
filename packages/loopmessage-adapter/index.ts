import { ChertAPIError, ChertClient, type ChertClientOptions, type ChertFetch } from '@cherthq/imessage';
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(status:number,message:string)=>Response.json({success:false,code:100,message},{status});
const publicID=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}(?![\s\S])/.test(value);
const chatID=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,160}(?![\s\S])/.test(value);
const statusFailure=(status:number)=>Response.json({error_code:100,message:'Recorded status unavailable.'},{status});
function recordedStatus(value:unknown,id:string):Record<string,unknown>|null {
  if(!record(value)||value.id!==id||value.direction!=='outbound'||typeof value.status!=='string')return null;
  if(value.response!==undefined&&value.response!==null&&!record(value.response))return null;
  const nested=record(value.response)?value.response:{};
  for(const key of ['status','delivered','read','service','error_code','error','success','ok','retryable'])
    if(value[key]!==undefined&&nested[key]!==undefined&&value[key]!==nested[key])return null;
  const service=value.service??nested.service,delivered=value.delivered??nested.delivered,read=value.read??nested.read;
  if(service!==undefined&&service!=='imessage'&&service!=='unknown')return null;
  if((delivered!==undefined&&typeof delivered!=='boolean')||(read!==undefined&&typeof read!=='boolean'))return null;
  if(nested.status!==undefined&&nested.status!==value.status)return null;
  if(!['queued','pending','processing','sent','delivered','read','failed','unknown','duplicate','received'].includes(value.status))return null;
  const errorCode=value.error_code??nested.error_code;
  if(errorCode!==undefined&&(!Number.isSafeInteger(errorCode)))return null;
  const uncertain=errorCode===4103;
  if(read===true&&delivered===false)return null;
  if(!uncertain&&['delivered','read'].includes(value.status)&&delivered===true){
    for(const source of [value,nested]){
      if((source.error!==undefined&&source.error!==null)
        ||(source.success!==undefined&&source.success!==true)||(source.ok!==undefined&&source.ok!==true)
        ||source.error_code!==undefined||(source.retryable!==undefined&&source.retryable!==false)
        ||['retry_after','retry_after_ms','retryAfter','retry_delay'].some(key=>source[key]!==undefined))return null;
    }
  }
  let status='unknown';
  if(!uncertain&&['queued','pending','processing','sent'].includes(value.status))status='processing';
  if(!uncertain&&['delivered','read'].includes(value.status)&&delivered===true&&service==='imessage')status='delivered';
  const result:Record<string,unknown>={message_id:id,status};
  if(value.phone!==undefined){if(typeof value.phone!=='string'||!/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(value.phone))return null;result.contact=value.phone;}
  if(value.text!==undefined){if(typeof value.text!=='string')return null;result.text=value.text;}
  return result;
}

/** Narrow Conversation HTTP compatibility, not an upstream JavaScript SDK replacement. */
export function createLoopMessageFetch(options:{chert:ChertClientOptions}):ChertFetch {
  const client=new ChertClient(options.chert);
  return async(input,init)=>{
    const request=new Request(input,init);
    request.signal.throwIfAborted();
    const url=new URL(request.url);
    const statusPath=/^\/api\/v1\/message\/status\/([a-f0-9]{32})\/$/.exec(url.pathname);
    if(url.origin==='https://a.loopmessage.com'&&url.pathname.startsWith('/api/v1/message/status/')&&!statusPath)return statusFailure(501);
    if(url.origin==='https://a.loopmessage.com'&&statusPath){
      if(request.method!=='GET'||url.search||url.hash||request.body!==null
        ||[...request.headers.keys()].some(key=>!['authorization','content-type','accept'].includes(key)))return statusFailure(501);
      const id=statusPath[1]!;
      try{
        const data=await client.request<unknown>(`/messages/${id}`,{signal:request.signal});
        const result=recordedStatus(data,id);
        return result?Response.json(result):statusFailure(502);
      }catch(error){request.signal.throwIfAborted();return statusFailure(error instanceof ChertAPIError&&error.status>=400&&error.status<=599?error.status:502);}
    }
    if(url.href!=='https://a.loopmessage.com/api/v1/message/send/'||request.method!=='POST'
      ||[...request.headers.keys()].some(key=>!['authorization','content-type','accept'].includes(key)))
      return failure(501,'Unsupported LoopMessage request. No message was sent.');
    let body:unknown;
    try{body=await request.json();}catch{return failure(400,'Invalid JSON. No message was sent.');}
    if(!record(body)||Object.keys(body).sort().join()!=='channel,contact,text'||body.channel!=='imessage'
      ||typeof body.contact!=='string'||!/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(body.contact)
      ||typeof body.text!=='string'||!body.text.trim()||body.text.length>=10000||body.text.includes('\0')
      ||new TextEncoder().encode(body.text).byteLength>16384
      ||new TextDecoder().decode(new TextEncoder().encode(body.text))!==body.text)
      return failure(501,'Only canonical phone and plaintext with explicit iMessage channel are supported. No message was sent.');
    const contact=body.contact,text=body.text;
    try{
      const response=await client.requestWithResponse<unknown>('/text-operations/v1',{
        method:'POST',body:{phone:contact,body:text},signal:request.signal});
      const data=response.data;
      if(response.status!==202||!record(data)||Object.keys(data).sort().join()!=='chat_id,message_id,status,success'
        ||data.success!==true||data.status!=='queued'||!publicID(data.message_id)||!chatID(data.chat_id))
        return failure(502,'Send outcome unconfirmed; reconcile before retrying.');
      return Response.json({message_id:data.message_id,contact,text},{status:200});
    }catch(error){
      request.signal.throwIfAborted();
      const response=failure(error instanceof ChertAPIError&&error.status>=400&&error.status<=599?error.status:502,
        'Send request did not complete; reconcile before retrying.');
      if(error instanceof ChertAPIError&&error.status===502&&error.code==='4103'&&record(error.data)
        &&record(error.data.error)&&error.data.error.retryable===false&&publicID(error.data.message_id)&&chatID(error.data.chat_id)){
        response.headers.set('x-chert-message-id',error.data.message_id);
        response.headers.set('x-chert-chat-id',error.data.chat_id);
      }
      return response;
    }
  };
}
export default createLoopMessageFetch;
