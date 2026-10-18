import {test,expect,mock} from 'bun:test';
import {createBlooioV4Fetch} from '../index';
const id='a'.repeat(48),chat='11000000-0000-4000-8000-000000000001',message='b'.repeat(32),tenant='21000000-0000-4000-8000-000000000001';
const expires=Math.floor(Date.now()/1000)+3600;
const attachment={attachment_id:id,filename:'image.png',content_type:'image/png',size_bytes:70,download_url:`https://chert.test/api/v1/attachments/${id}/download?tenant=${tenant}&expires=${expires}&signature=${'f'.repeat(64)}`,download_url_expires_at:new Date(expires*1000).toISOString()};
const media={type:'media',attachment_id:id};
function fixture(raw:unknown){const fetch=mock(async()=>Response.json(raw));return{fetch,transport:createBlooioV4Fetch({chert:{baseURL:'https://chert.test',apiKey:'private',fetch}})}}
const get=(transport:ReturnType<typeof fixture>['transport'],suffix='')=>transport(`https://api.blooio.com/v4/chats/${chat}/messages${suffix}`);
test('recorded single media and exact caption project provider attachment fields without private metadata',async()=>{
 for(const caption of [undefined,'  Café / 🌅\r\n  ']){
  const parts=caption===undefined?[media]:[{type:'text',value:caption},media];
  const {transport,fetch}=fixture({id:message,lead_id:chat,status:'queued',direction:'outbound',...(caption===undefined?{}:{text:caption}),request:{message:{parts}},response:{attachments:[{...attachment,native_guid:'private'}]}});
  const r=await get(transport,`/${message}`);expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{id:message,chat_id:chat,status:'queued',direction:'outbound',...(caption===undefined?{}:{text:caption}),attachments:[{url:attachment.download_url,media_type:'image/png',size:70,...(caption===undefined?{}:{caption})}]}});expect(fetch).toHaveBeenCalledTimes(1);
 }
});
test('mixed recorded list retains ordering/cursor and rejects any malformed constituent',async()=>{
 const rows=[{id:'text',chat_id:chat,parts:[{type:'text',value:'observed'}],status:'received'},{id:message,chat_id:chat,parts:[media],attachments:[attachment],status:'queued'}];
 const {transport,fetch}=fixture({messages:rows,has_more:true,next_cursor:'opaque'});const r=await get(transport);expect(r.status).toBe(200);const body=await r.json();expect(body.data.map((x:{id:string})=>x.id)).toEqual(['text',message]);expect(body.data[1].attachments[0].url).toBe(attachment.download_url);expect(body.next_cursor).toBe('opaque');expect(fetch).toHaveBeenCalledTimes(1);
 for(const patch of [{attachments:[]},{attachments:[{...attachment,size_bytes:0}]},{attachments:[{...attachment,download_url:attachment.download_url.replace('chert.test','foreign.test')}]},{parts:[media,{type:'text',value:'wrong order'}]},{chat_id:'foreign'}]){
  const bad=fixture({messages:[rows[0],{...rows[1],...patch}],has_more:false,next_cursor:null});expect((await get(bad.transport)).status).toBe(502);expect(bad.fetch).toHaveBeenCalledTimes(1);
 }
});
test('get refuses missing/expired/mismatched metadata or caption, status-only remains read-only',async()=>{
 const raw={id:message,lead_id:chat,status:'sent',request:{message:{parts:[{type:'text',value:'caption'},media]}},text:'caption',response:{attachments:[attachment]}};
 for(const patch of [{response:{}},{text:'edited'},{response:{attachments:[{...attachment,attachment_id:'c'.repeat(48)}]}},{response:{attachments:[{...attachment,download_url:attachment.download_url.replace(`expires=${expires}`,'expires=1'),download_url_expires_at:'1970-01-01T00:00:01.000Z'}]}}]){
  const f=fixture({...raw,...patch});expect((await get(f.transport,`/${message}`)).status).toBe(502);expect(f.fetch).toHaveBeenCalledTimes(1);
 }
 const f=fixture({...raw,response:{attachments:[]}});expect(await (await get(f.transport,`/${message}/status`)).json()).toEqual({data:{id:message,status:'sent'}});expect(f.fetch).toHaveBeenCalledTimes(1);
});
