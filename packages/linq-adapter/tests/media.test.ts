import{test,expect}from'bun:test';import Linq from '../src/index';
const id='a'.repeat(48),chat='chat-id',messageID='10000000-0000-4000-8000-000000000001',tenant='20000000-0000-4000-8000-000000000002';
function fixture(){const expiry=Math.floor(Date.now()/1000)+3600;return{message:{id:messageID,chat_id:chat,created_at:new Date().toISOString(),status:'queued',parts:[{type:'media',attachment_id:id}],attachments:[{attachment_id:id,filename:'image.png',content_type:'image/png',size_bytes:4,download_url:`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&signature=${'b'.repeat(64)}&expires=${expiry}`,download_url_expires_at:new Date(expiry*1000).toISOString()}]}};}
function setup(value:unknown=fixture()){const calls:Request[]=[];const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(i,o)=>{calls.push(new Request(i,o));return Response.json(value);}}});return{client,calls};}
test('official Linq send maps one frozen uploaded media part without metadata reads or invented observations',async()=>{const wire=fixture(),{client,calls}=setup(wire);const result=await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}});expect(result).toEqual({chat_id:chat,message:{id:messageID,created_at:wire.message.created_at,delivery_status:'queued',is_read:false,sent_at:null,parts:[{type:'media',id,filename:'image.png',mime_type:'image/png',size_bytes:4,url:wire.message.attachments[0]!.download_url,reactions:null}]}});expect(calls.length).toBe(1);expect(calls[0]!.method).toBe('POST');expect(await calls[0]!.json()).toEqual({message:{parts:[{type:'media',attachment_id:id}]}});});
test('unsupported media framing rejects before any Chert effect',async()=>{
 for(const parts of [[{type:'media',url:'https://unfetched.invalid/image'}],[{type:'media',attachment_id:id,caption:'unsupported'}],[{type:'media',attachment_id:id+'\n'}],[{type:'media',attachment_id:id},{type:'text',value:'caption'}],[{type:'media',attachment_id:'vendor-id'}]]){const {client,calls}=setup();await expect((async()=>await client.post(`/v3/chats/${chat}/messages`,{body:{message:{parts}}}))()).rejects.toThrow();expect(calls.length).toBe(0);}
});
test('missing or conflicting frozen post-send media metadata is unknown and never retried',async()=>{
 const base=fixture();const changes=[{attachments:undefined},{attachments:[]},{status:'sent'},{chat_id:'foreign'},{id:'not-public-uuid'},{id:'a'.repeat(31)},{id:'a'.repeat(33)},{id:messageID+'\n'},{created_at:'invalid'},{delivered:true},{is_read:true},{is_sent:true},{direction:'inbound'},{ok:false},{sent_at:'2026-10-17T00:00:00Z'},{parts:[{type:'media',attachment_id:'foreign'}]},
 ...[{attachment_id:'foreign'},{filename:''},{filename:'../file'},{content_type:'not-mime'},{size_bytes:0},{size_bytes:100*1024*1024+1},{download_url:'https://foreign.invalid/file'},{download_url:base.message.attachments[0]!.download_url+'&extra=1'},{download_url_expires_at:'invalid'},{download_url_expires_at:new Date(Date.now()+7200000).toISOString()},{download_url:base.message.attachments[0]!.download_url.replace(/expires=\d+/,'expires=1')}].map(a=>({attachments:[{...base.message.attachments[0],...a}]}))];
 for(const change of changes){const {client,calls}=setup({message:{...base.message,...change}});await expect((async()=>await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}}))()).rejects.toMatchObject({status:502});expect(calls.length).toBe(1);expect(calls[0]!.method).toBe('POST');}
});
test('media network uncertainty is sanitized with one attempt and no metadata fetch',async()=>{
 let calls=0;const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;throw Error('private-device-secret');}}});
 try{await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}});throw Error('expected failure');}catch(error){expect((error as {status:number}).status).toBe(502);expect(String(error)).not.toContain('private-device-secret');}expect(calls).toBe(1);
});
test('media request cancellation propagates without a second request',async()=>{
 const abort=new AbortController();let calls=0;const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;abort.abort();return Response.json(fixture());}}});
 await expect((async()=>await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}},{signal:abort.signal}))()).rejects.toThrow();expect(calls).toBe(1);
});

test('media inherited query and binary overrides refuse before POST',async()=>{
 for(const override of [{query:{}},{__binaryResponse:true}]){const{client,calls}=setup();await expect((async()=>await client.post(`/v3/chats/${chat}/messages`,{body:{message:{parts:[{type:'media',attachment_id:id}]}},...override}))()).rejects.toThrow();expect(calls.length).toBe(0);}
});

test('actual compact public send IDs are preserved without rewriting',async()=>{const wire=fixture();wire.message.id=messageID.replace(/-/g,'');const{client}=setup(wire);const result=await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}});expect(result.message.id).toBe(wire.message.id);});

test('official APIError exposes only Chert diagnostic reconciliation headers for an owned media uncertainty',async()=>{
 let calls=0;const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json({success:false,error:{status:502,code:4103,message:'private-native-secret',retryable:false},message_id:messageID,chat_id:chat,private:'must-not-forward'},{status:502});}}});
 const error=await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}}).catch(error=>error);
 expect(error.headers.get('x-chert-message-id')).toBe(messageID);expect(error.headers.get('x-chert-chat-id')).toBe(chat);expect(calls).toBe(1);
 expect(Object.keys(error.error).sort()).toEqual(['code','message','request_id']);expect(JSON.stringify(error.error)).not.toContain(messageID);expect(JSON.stringify(error.error)).not.toContain('must-not-forward');expect(String(error)).not.toContain('private-native-secret');
});

test('reconciliation diagnostic headers are both omitted for untrusted identity or uncertain classification',async()=>{
 const base={success:false,error:{status:502,code:4103,retryable:false},message_id:messageID,chat_id:chat};
 for(const data of [{...base,_status:503},{...base,chat_id:'foreign'},{...base,message_id:'msg_native'},{...base,message_id:messageID+'\n'},{...base,message_id:'https://private.invalid'},{...base,message_id:null},{...base,error:{...base.error,retryable:true}},{...base,error:{...base.error,code:5004}}]){
  let calls=0;const client=new Linq({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(data,{status:'_status' in data?Number(data._status):502});}}});const error=await client.chats.messages.send(chat,{message:{parts:[{type:'media',attachment_id:id}]}}).catch(error=>error);expect(error.headers.get('x-chert-message-id')).toBeNull();expect(error.headers.get('x-chert-chat-id')).toBeNull();expect(calls).toBe(1);
 }
});
