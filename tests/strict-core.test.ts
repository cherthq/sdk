import {test,expect} from 'bun:test';
import {ChertClient,ChertAPIError} from '../packages/imessage/src/index';
const body={phone:'+15550000002',body:' exact / text ',idempotency_key:'key'};
const lead='3f2c1d4e-5b6a-4c7d-8e9f-0a1b2c3d4e5f';
// CRM POST /api/v1/send flat envelope: no `success`, extra lead/line fields.
const wire={status:'queued',message_id:'550e8400-e29b-41d4-a716-446655440000',chat_id:lead,lead_id:lead,lead_created:false,convo_id:'c-1',phone_line_id:'line-1'} as const;
const receipt={success:true,message_id:wire.message_id,chat_id:lead,status:'queued'} as const;
test('typed strict send uses exact request once and preserves queued receipt',async()=>{
 let calls=0;const signal=new AbortController().signal;
 const client=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async(input,init)=>{calls++;expect(String(input)).toBe('https://chert.test/api/v1/send');expect(init?.method).toBe('POST');expect(init?.signal).toBe(signal);expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual(body);return Response.json(wire,{status:202});}});
 expect(await client.sendText(body,{signal})).toEqual(receipt);expect(calls).toBe(1);
 for(const status of ['sent','duplicate'] as const){
  const sent=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>Response.json({...wire,status,service:'iMessage'},{status:200})});
  expect(await sent.sendText(body)).toEqual({...receipt,status});
 }
});
test('invalid bodies and options reject before HTTP',async()=>{
 let calls=0;const client=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(receipt,{status:202});}});
 for(const invalid of [null,[],{...body,phone:body.phone+'\n'},{...body,body:''},{...body,body:'bad\0body'},{...body,body:'\ud800'},{...body,body:'x'.repeat(16385)},{...body,idempotency_key:''},{...body,idempotency_key:null},{...body,idempotency_key:'x'.repeat(201)},{...body,extra:true}])await expect(client.sendText(invalid as never)).rejects.toThrow(TypeError);
 for(const options of [null,[],{retry:true},{signal:'bad'}])await expect(client.sendText(body,options as never)).rejects.toThrow(TypeError);
 expect(calls).toBe(0);
});
test('incompatible 2xx is explicit sanitized unknown, never native UUID or invented receipt',async()=>{
 for(const [status,data]of [[200,wire],[201,{...wire,status:'sent'}],[204,null],[202,{...wire,status:'sent'}],[200,{...wire,status:'failed',extra:'private-secret'}],[202,{...wire,message_id:null}],[202,{...wire,message_id:'bad id/private-secret'}],[200,{...wire,status:'sent',chat_id:undefined}]] as const){let calls=0;const client=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return status===204?new Response(null,{status}):Response.json(data,{status});}});try{await client.sendText(body);throw Error('expected failure')}catch(error){expect(error).toBeInstanceOf(ChertAPIError);const failure=error as ChertAPIError;expect(failure.status).toBe(502);expect(failure.code).toBe('unconfirmed_text_outcome');expect(failure.message).not.toContain('private-secret');}expect(calls).toBe(1);}
});
test('non2xx retains actual owned reconciliation data without retry and pre-abort has no effects',async()=>{
 let calls=0;const data={message_id:'a'.repeat(32),chat_id:'chat-a',error:{code:4103,retryable:false,message:'private-secret'}};const client=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(data,{status:502});}});
 try{await client.sendText(body)}catch(error){expect(error).toBeInstanceOf(ChertAPIError);expect((error as ChertAPIError).data).toEqual(data);expect((error as ChertAPIError).code).toBe('4103');expect(String(error)).not.toContain('private-secret');}expect(calls).toBe(1);
 const abort=new AbortController();abort.abort();await expect(client.sendText(body,{signal:abort.signal})).rejects.toThrow();expect(calls).toBe(1);
});
test('strict 2xx parse and failure envelopes retain trace while generic semantics stay unchanged',async()=>{
 for(const malformed of [true,false]){
  const client=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>malformed?new Response('private nonJSON',{status:202,headers:{'x-request-id':'actual-trace'}}):Response.json({success:false,error:{code:4006,message:'private'}},{status:202,headers:{'x-request-id':'actual-trace'}})});
  try{await client.sendText(body);throw Error('expected failure')}catch(error){expect(error).toBeInstanceOf(ChertAPIError);expect((error as ChertAPIError).code).toBe('unconfirmed_text_outcome');expect((error as ChertAPIError).requestId).toBe('actual-trace');expect(String(error)).not.toContain('private');}
 }
 const invalid=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>Response.json({...wire,status:'sent'},{status:202,headers:{'x-trace-id':'receipt-trace'}})});
 await expect(invalid.sendText(body)).rejects.toMatchObject({code:'unconfirmed_text_outcome',requestId:'receipt-trace'});
 const rejected=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>Response.json({success:false,error:{code:4103},message_id:'a'.repeat(32),chat_id:'chat-a'},{status:502,headers:{'x-request-id':'error-trace'}})});
 await expect(rejected.sendText(body)).rejects.toMatchObject({code:'4103',status:502,requestId:'error-trace'});
 const generic=new ChertClient({baseURL:'https://chert.test',apiKey:'key',fetch:async()=>Response.json({value:true},{headers:{'x-request-id':'hidden'}})});
 expect(await generic.requestWithResponse('/read')).toEqual({status:200,data:{value:true}});
});
