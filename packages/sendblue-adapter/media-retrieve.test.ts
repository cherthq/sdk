import {test,expect} from 'bun:test';
import Sendblue from './index';
const id='a'.repeat(48),tenant='11000000-0000-4000-8000-000000000001';
function metadata(){const expires=Math.floor(Date.now()/1000)+3600;return {attachment_id:id,filename:'photo.png',content_type:'image/png',size_bytes:4,download_url:`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&signature=${'b'.repeat(64)}&expires=${expires}`,download_url_expires_at:new Date(expires*1000).toISOString()};}
function row(){return{id:'public-media',direction:'outbound',status:'queued',phone:'+15550000002',request:{message:{parts:[{type:'media',attachment_id:id}]}},response:{attachments:[metadata()]}};}
test('official retrieve exposes one observed media capability, getStatus stays narrow',async()=>{const value=row();let calls=0;const sdk=new Sendblue({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(value);}}});const result=await sdk.messages.retrieve(value.id);expect(result.data).toEqual({message_handle:value.id,status:'QUEUED',number:value.phone,is_outbound:true,media_url:value.response.attachments[0]!.download_url});const status=await sdk.messages.getStatus({handle:value.id});expect(status).not.toHaveProperty('media_url');expect(calls).toBe(2);});
test('caption retrieval requires the server validated exact caption and canonical part order',async()=>{
 const caption=' exact\r\n💬 ',base=row();
 for(const text of [caption,'edited',undefined]){
  let calls=0;const value={...base,text,request:{message:{parts:[{type:'text',value:caption},{type:'media',attachment_id:id}]}}};
  const sdk=new Sendblue({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async()=>{calls++;return Response.json(value)}}});
  if(text===caption)expect((await sdk.messages.retrieve(value.id)).data).toMatchObject({content:caption,media_url:base.response.attachments[0]!.download_url});
  else await expect((async()=>await sdk.messages.retrieve(value.id))()).rejects.toMatchObject({status:502});
  expect(calls).toBe(1);
 }
});
test('malformed, foreign, expired and compound media fail once without URL fetching',async()=>{for(const change of [
 (v:ReturnType<typeof row>)=>v.response.attachments.push(metadata()),(v:ReturnType<typeof row>)=>Object.assign(v.request.message,{parts:[...v.request.message.parts,{type:'text',value:'caption'}]}),
 (v:ReturnType<typeof row>)=>v.response.attachments[0].attachment_id='c'.repeat(48),(v:ReturnType<typeof row>)=>v.response.attachments[0].download_url=v.response.attachments[0].download_url.replace('chert.test','foreign.test'),
 (v:ReturnType<typeof row>)=>v.response.attachments[0].download_url_expires_at='2020-01-01T00:00:00.000Z',(v:ReturnType<typeof row>)=>v.response.attachments[0].size_bytes=0,
 (v:ReturnType<typeof row>)=>v.direction='inbound',(v:ReturnType<typeof row>)=>Object.assign(v,{parts:[{type:'text',value:'conflict'}]}),(v:ReturnType<typeof row>)=>Object.assign(v.response,{attachments:undefined}),
]){const value=row();change(value);let calls=0;const sdk=new Sendblue({chert:{baseURL:'https://chert.test',apiKey:'key',fetch:async(url)=>{calls++;expect(String(url)).toBe('https://chert.test/api/v1/messages/public-media');return Response.json(value);}}});await expect((async()=>await sdk.messages.retrieve(value.id))()).rejects.toMatchObject({status:502});expect(calls).toBe(1);}});
