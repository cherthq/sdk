import {test,expect} from 'bun:test';
import {ChertClient,ChertAPIError} from '../src/index';
const chat='11aa0000-0000-4000-8000-000000000001',message='Exact:MESSAGE_id.1';
const ack={operation_id:'a'.repeat(32),chat_id:chat,message_id:message,status:'acknowledged' as const};
function fixture(reply?:(request:Request)=>Response|Promise<Response>){
 const requests:Request[]=[];
 const client=new ChertClient({baseURL:'https://chert.test/pinned',apiKey:'fixture-private-key',tenant:'fixture',fetch:async(input,init)=>{
  const request=new Request(input,init);requests.push(request);expect(init?.redirect).toBe('error');
  return reply?reply(request):Response.json(ack,{status:202});
 }});
 return{client,requests};
}
test('six standard add/remove payloads bind auth, key, UUID and encoded case-preserved ID',async()=>{
 for(const reaction of ['love','like','dislike','laugh','emphasize','question'] as const)for(const remove of [false,true]){
  const f=fixture(),signal=new AbortController().signal;
  const result=await f.client.sendReaction(chat.toUpperCase(),message,{reaction,remove},{idempotencyKey:'exact internal key',signal});
  expect(result).toEqual(ack);expect(Object.isFrozen(result)).toBe(true);expect(f.requests).toHaveLength(1);
  const request=f.requests[0]!;
  expect(request.url).toBe(`https://chert.test/pinned/chats/${chat}/messages/Exact%3AMESSAGE_id.1/reactions`);
  expect(await request.json()).toEqual({reaction,remove,part_index:0});
  expect(request.headers.get('authorization')).toBe('Bearer fixture-private-key');expect(request.headers.get('x-chert-tenant')).toBe('fixture');
  expect(request.headers.get('idempotency-key')).toBe('exact internal key');expect(request.signal.aborted).toBe(false);
 }
 const f=fixture();await f.client.sendReaction(chat,message,{reaction:'love'});
 expect(await f.requests[0]!.json()).toEqual({reaction:'love',remove:false,part_index:0});expect(f.requests[0]!.headers.has('idempotency-key')).toBe(false);
});
test('invalid tuple, custom reaction, unknown options and header keys refuse before HTTP',async()=>{
 const f=fixture();
 for(const id of ['', '.', '..','bad/id','bad%2Fid','bad?query','bad#hash','bad\\id','bad\n','x'.repeat(161),'é'])
  await expect(f.client.sendReaction(chat,id,{reaction:'love'})).rejects.toThrow(TypeError);
 for(const id of ['bad',chat+'\n'])await expect(f.client.sendReaction(id,message,{reaction:'love'})).rejects.toThrow(TypeError);
 for(const body of [{reaction:'custom'},{reaction:'Love'},{reaction:'love',remove:1},{reaction:'love',part_index:1}])
  await expect(f.client.sendReaction(chat,message,body as never)).rejects.toThrow(TypeError);
 for(const idempotencyKey of ['', ' leading','trailing ','bad\n','bad\x7f','é','x'.repeat(201)])
  await expect(f.client.sendReaction(chat,message,{reaction:'like'},{idempotencyKey})).rejects.toThrow(TypeError);
 await expect(f.client.sendReaction(chat,message,{reaction:'love'},{headers:{Authorization:'other'}} as never)).rejects.toThrow(TypeError);
 expect(f.requests).toHaveLength(0);
});
test('boundary header key is preserved without normalization',async()=>{
 const f=fixture();await f.client.sendReaction(chat,message,{reaction:'like'},{idempotencyKey:'x'.repeat(200)});
 expect(f.requests[0]!.headers.get('idempotency-key')).toBe('x'.repeat(200));
});
test('wrong successful status, malformed receipt and nonJSON stay unconfirmed with one attempt',async()=>{
 for(const status of [200,201,204,206]){
  const f=fixture(()=>status===204?new Response(null,{status}):Response.json(ack,{status}));
  await expect(f.client.sendReaction(chat,message,{reaction:'love'})).rejects.toMatchObject({status:502,code:'unconfirmed_reaction_outcome'});expect(f.requests).toHaveLength(1);
 }
 for(const data of [{...ack,operation_id:'A'.repeat(32)},{...ack,operation_id:chat},{...ack,chat_id:'foreign'},{...ack,message_id:message.toLowerCase()},
  {...ack,status:'applied'},{...ack,native_guid:'private-guid'},{success:false},null,[],{...ack,operation_id:undefined}]){
  const f=fixture(()=>Response.json(data,{status:202,headers:{'x-trace-id':'fixture-trace'}}));
  try{await f.client.sendReaction(chat,message,{reaction:'love'});throw Error('expected rejection')}catch(error){
   expect(error).toBeInstanceOf(ChertAPIError);expect(error).toMatchObject({status:502,code:'unconfirmed_reaction_outcome',requestId:'fixture-trace'});
   expect((error as Error).message).not.toContain('private-guid');expect((error as Error).message).not.toContain(message);
  }expect(f.requests).toHaveLength(1);
 }
 const f=fixture(()=>new Response('private-response',{status:202}));
 await expect(f.client.sendReaction(chat,message,{reaction:'love'})).rejects.toMatchObject({status:502,code:'unconfirmed_reaction_outcome'});expect(f.requests).toHaveLength(1);
});
test('server API errors retain explicit reconciliation data without retries or private message formatting',async()=>{
 for(const status of [401,404,409,502]){
  const data={error:{code:4103,message:'private-response'},operation_id:'b'.repeat(32)};
  const f=fixture(()=>Response.json(data,{status}));
  try{await f.client.sendReaction(chat,message,{reaction:'love'});throw Error('expected rejection')}catch(error){
   expect(error).toBeInstanceOf(ChertAPIError);expect(error).toMatchObject({status,code:'4103',data});expect((error as Error).message).not.toContain('private-response');
  }expect(f.requests).toHaveLength(1);
 }
});
test('transport failure is sanitized unknown and preaborted signal performs no HTTP',async()=>{
 const f=fixture(()=>{throw Error('private transport URL/key')});
 await expect(f.client.sendReaction(chat,message,{reaction:'love'})).rejects.toMatchObject({status:502,code:'unconfirmed_reaction_outcome',message:'Reaction outcome unconfirmed; reconcile before retrying'});
 expect(f.requests).toHaveLength(1);
 const aborted=new AbortController();aborted.abort();const g=fixture();
 await expect(g.client.sendReaction(chat,message,{reaction:'love'},{signal:aborted.signal})).rejects.toThrow();expect(g.requests).toHaveLength(0);
});
test('actual loopback fetch refuses redirect without forwarding a second POST',async()=>{
 let first=0,sink=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){if(new URL(request.url).pathname==='/sink'){sink++;return Response.json(ack,{status:202})}first++;return new Response(null,{status:307,headers:{location:'/sink'}})}});
 try{
  const client=new ChertClient({baseURL:server.url.origin,apiKey:'fixture-key'});
  await expect(client.sendReaction(chat,message,{reaction:'love'})).rejects.toMatchObject({status:502,code:'unconfirmed_reaction_outcome'});
  expect(first).toBe(1);expect(sink).toBe(0);
 }finally{server.stop(true)}
});
