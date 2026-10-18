import {test,expect} from 'bun:test';
import SendblueAPI, {APIError, APIUserAbortError} from './index';
const id='a'.repeat(48),input={from_number:'+15550000001',number:'+15550000002',media_url:'https://cdn.example.test/Photo.png'};
function media(){const expiry=Math.floor(Date.now()/1000)+3600;return {attachment_id:id,filename:'Photo.png',content_type:'image/png',size_bytes:70,
 download_url:`https://chert.test/api/v1/attachments/${id}/download?tenant=11000000-0000-4000-8000-000000000001&expires=${expiry}&signature=${'b'.repeat(64)}`,download_url_expires_at:new Date(expiry*1000).toISOString()};}
test('official Sendblue media send imports server-side then invokes one strict media request',async()=>{
 const calls:Request[]=[];const attachment=media();
 const sdk=new SendblueAPI({apiKey:'vendor-key',apiSecret:'vendor-secret',chert:{baseURL:'https://chert.test',apiKey:'chert-key',fetch:async(url,init)=>{
  const request=new Request(url,init);calls.push(request);
  return calls.length===1?Response.json({attachment_id:id,uploaded:true}):Response.json({message:{id:'c'.repeat(32),status:'queued',direction:'outbound',attachments:[attachment],parts:[{type:'media',attachment_id:id}]}});
 }}});
 const result=await sdk.messages.send(input);
 expect(calls.map(c=>c.url)).toEqual(['https://chert.test/api/v1/attachments/import','https://chert.test/api/v1/chats']);
 expect(await calls[0]!.json()).toEqual({url:input.media_url});
 expect(await calls[1]!.json()).toEqual({from:input.from_number,to:[input.number],message:{parts:[{type:'media',attachment_id:id}]}});
 expect(calls.every(c=>c.headers.get('authorization')==='Bearer chert-key'&&!JSON.stringify([...c.headers]).includes('vendor-'))).toBe(true);
 expect(result).toEqual({message_handle:'c'.repeat(32),status:'QUEUED',is_outbound:true,from_number:input.from_number,number:input.number,media_url:attachment.download_url});
});
test('invalid import identities and errors prevent native send and never retry',async()=>{
 for(const result of [{attachment_id:id,uploaded:false},{attachment_id:id+'\n',uploaded:true},{attachment_id:'native-guid',uploaded:true}]){
  let calls=0;const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(result)}}});
  await expect((async()=>await sdk.messages.send(input))()).rejects.toMatchObject({status:502});expect(calls).toBe(1);
 }
 let calls=0;const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json({error:{code:3001,message:'unavailable'}},{status:502})}}});
 await expect((async()=>await sdk.messages.send(input))()).rejects.toMatchObject({status:502});expect(calls).toBe(1);
});
test('caption and media preserve exact Unicode and whitespace in one queued message',async()=>{
 const caption='\uFEFF  👩🏽‍💻 café\r\n\\n終  ',parts=[{type:'text',value:caption},{type:'media',attachment_id:id}];let calls=0;
 const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(url,init)=>{
  calls++;if(calls===1)return Response.json({attachment_id:id,uploaded:true});
  expect(await new Request(url,init).json()).toEqual({from:input.from_number,to:[input.number],message:{parts}});
  return Response.json({message:{id:'c'.repeat(32),status:'queued',parts,attachments:[media()]}});
 }}});
 expect(await sdk.messages.send({...input,content:caption})).toMatchObject({status:'QUEUED',content:caption,media_url:media().download_url});expect(calls).toBe(2);
});
test('invalid captions refuse before import or native send',async()=>{
 let calls=0;const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json({})}}});
 for(const content of ['\ud800','nul\0caption','x'.repeat(16385),'💬'.repeat(4097),null])
  await expect((async()=>await sdk.messages.send({...input,content} as typeof input&{content:string}))()).rejects.toMatchObject({status:400});
 expect(calls).toBe(0);
});
test('cancellation after import never starts a media send',async()=>{
 let calls=0;const controller=new AbortController();
 const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;controller.abort();return Response.json({attachment_id:id,uploaded:true})}}});
 await expect((async()=>await sdk.messages.send(input,{signal:controller.signal}))()).rejects.toBeInstanceOf(APIUserAbortError);
 expect(calls).toBe(1);
});
test('uncertain send preserves public reconciliation identity without retrying import or send',async()=>{
 let calls=0;const messageId='d'.repeat(32),chatId='owned-chat';
 const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{
  calls++;return calls===1?Response.json({attachment_id:id,uploaded:true}):Response.json({error:{code:4103,message:'Unconfirmed',retryable:false},message_id:messageId,chat_id:chatId},{status:502});
 }}});
 try{await sdk.messages.send(input);throw Error('expected uncertainty')}catch(error){expect(error).toBeInstanceOf(APIError);expect((error as APIError).status).toBe(502);expect((error as APIError).error).toMatchObject({error:{code:'4103',data:{message_id:messageId,chat_id:chatId}}});}
 expect(calls).toBe(2);
});
test('invalid post-dispatch media receipt preserves its public ID and refuses retries',async()=>{
 let calls=0;const messageId='e'.repeat(32);
 const sdk=new SendblueAPI({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{
  calls++;return calls===1?Response.json({attachment_id:id,uploaded:true}):Response.json({message:{id:messageId,chat_id:'owned-chat',status:'queued',attachments:[{...media(),download_url:'https://foreign.invalid/private'}]}});
 }}});
 try{await sdk.messages.send(input);throw Error('expected uncertainty')}catch(error){expect(error).toBeInstanceOf(APIError);expect((error as APIError).error).toMatchObject({error:{code:'4103',retryable:false,data:{message_id:messageId,chat_id:'owned-chat'}}});}
 expect(calls).toBe(2);
});
