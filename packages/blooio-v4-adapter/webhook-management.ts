import {ChertClient,ChertAPIError} from '@chert/sdk';
const profile='blooio-v4/2026-10-01';
const events:Record<string,string>={message_received:'message.received',message_queued:'message.queued',message_sent:'message.sent',message_delivered:'message.delivered',read_receipt:'message.read',message_failed:'message.failed'};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const error=(code:string,message:string,status=501)=>Response.json({error:{code,message}},{status});
function https(value:unknown):value is string{
 if(typeof value!=='string'||!value.length||value.length>4096||/[\x00-\x20\x7f]/.test(value))return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}
}
function subscription(value:unknown,id:string){
 if(!object(value)||!object(value.subscription))return null;
 const s=value.subscription;
 if(s.id!==id||s.version!==profile||!https(s.url)||typeof s.is_active!=='boolean'||!Array.isArray(s.events)||!s.events.length||new Set(s.events).size!==s.events.length||s.events.some(e=>typeof e!=='string'||!Object.hasOwn(events,e)))return null;
 return {id,url:s.url,events:s.events as string[],active:s.is_active};
}
function projected(s:NonNullable<ReturnType<typeof subscription>>){return{data:{id:s.id,url:s.url,event_types:s.events.map(e=>events[e]!),status:s.active?'active':'disabled',api_version:'2026-10-01'}};}
/** Existing qualified Chert subscriptions only; no all-event registration claim. */
export async function manageWebhook(request:Request,client:ChertClient):Promise<Response|null>{
 const url=new URL(request.url);
 if(!/^\/v4\/webhooks(?:\/|$)/.test(url.pathname))return null;
 if(url.origin!=='https://api.blooio.com'||url.hash||url.search||[...request.headers.keys()].some(k=>!['authorization','accept','content-type','x-chert-tenant'].includes(k)))return error('unsupported_feature','Unsupported webhook request');
 request.signal.throwIfAborted();
 let body:Record<string,unknown>|undefined;
 if(request.method==='PATCH'||request.method==='POST'){
  try{const raw=await request.text();if(new TextEncoder().encode(raw).length>8192)return error('unsupported_feature','Webhook request is too large');const parsed:unknown=JSON.parse(raw);if(!object(parsed))return error('unsupported_feature','Expected webhook object');body=parsed;}catch{return error('unsupported_feature','Expected webhook object');}
  if(Object.hasOwn(body,'event_types'))return Array.isArray(body.event_types)&&body.event_types.length===1&&body.event_types[0]==='*'?error('unsupported_feature','All-event webhook subscriptions are unsupported'):error('event_types_retired','Webhook event filters are retired',422);
 }
 const match=/^\/v4\/webhooks\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?![\s\S])/i.exec(url.pathname);
 if(!match||!['GET','PATCH','DELETE'].includes(request.method))return error('unsupported_feature','Webhook registration, listing, rotation and replay are unsupported');
 if(request.method!=='PATCH'&&request.body!==null)return error('unsupported_feature','Webhook reads and deletion require no body');
 const id=match[1]!.toLowerCase();
 const updates:Record<string,unknown>={};
 if(request.method==='PATCH'){
  if(!body||!Object.keys(body).length||Object.keys(body).some(k=>!['url','status','api_version'].includes(k))
    ||(Object.hasOwn(body,'url')&&!https(body.url))||(Object.hasOwn(body,'status')&&(typeof body.status!=='string'||!['active','disabled'].includes(body.status)))
    ||(Object.hasOwn(body,'api_version')&&body.api_version!=='2026-10-01'))return error('unsupported_feature','Unsupported webhook update');
  if(Object.hasOwn(body,'url'))updates.url=body.url;
  if(Object.hasOwn(body,'status'))updates.is_active=body.status==='active';
  // api_version only confirms the already-qualified profile; never reset filters/version.
 }
 let dispatched=false;
 try{
  const current=await client.requestWithResponse<unknown>(`/webhook-subscriptions/${id}`,{signal:request.signal});
  const existing=current.status===200?subscription(current.data,id):null;
  if(!existing)return error('incompatible_webhook','Qualified webhook metadata unavailable',502);
  if(request.method==='GET')return Response.json(projected(existing));
  dispatched=true;
  const result=await client.requestWithResponse<unknown>(`/webhook-subscriptions/${id}`,{method:request.method,...(request.method==='PATCH'?{body:updates}:{}),signal:request.signal});
  if(request.method==='DELETE'){
   if(result.status!==200||!object(result.data)||result.data.id!==id||result.data.deleted!==true)return error('outcome_unknown','Webhook deletion outcome unconfirmed; reconcile before retrying',502);
   return Response.json({data:{id,deleted:true}});
  }
  const changed=result.status===200?subscription(result.data,id):null;
  if(!changed||changed.url!==(updates.url??existing.url)||changed.active!==(updates.is_active??existing.active)||JSON.stringify(changed.events)!==JSON.stringify(existing.events))return error('outcome_unknown','Webhook update outcome unconfirmed; reconcile before retrying',502);
  return Response.json(projected(changed));
 }catch(failure){
  request.signal.throwIfAborted();
  const response=error(dispatched?'outcome_unknown':'webhook_unavailable',dispatched?'Webhook mutation outcome unconfirmed; reconcile before retrying':'Webhook metadata unavailable',failure instanceof ChertAPIError&&failure.status>=400&&failure.status<=599?failure.status:502);
  if(failure instanceof ChertAPIError&&failure.requestId)response.headers.set('x-request-id',failure.requestId);
  return response;
 }
}
