import {expect,test} from 'bun:test';
import {ChertClient} from '@chert/sdk';
import {accountHistoryQuery,mapAccountHistory,listAccountHistory} from '../account-history';
const row=()=>({id:'public_1',chat_id:'chat-a',status:'queued',direction:'outbound',parts:[{type:'text',value:'actual text'}],from:'+15550000001',to:'+15550000002',line_number:'+15550000001',phone_line_id:'11000000-0000-4000-8000-000000000001',is_group:false,endpoint_source:'strict_text_intent',created_at:'2026-10-18T00:00:00Z',updated_at:null,sent_at:null,service:'unknown'});
const page=(messages:unknown[]=[row()])=>({messages,pagination:{has_more:false,limit:50,offset:0,total:messages.length}});
test('translates documented filters without inventing provider defaults',()=>{
 expect(accountHistoryQuery(new URLSearchParams()).size).toBe(0);
 const q=accountHistoryQuery(new URLSearchParams({sendblue_number:'+15550000001',is_outbound:'false',order_by:'sentAt',status:'DELIVERED',service:'iMessage',message_type:'message',offset:'10000',limit:'200'}));
 expect(Object.fromEntries(q)).toEqual({line_number:'+15550000001',direction:'inbound',order_by:'sent_at',status:'delivered',service:'imessage',is_group:'false',offset:'10000',limit:'200'});
});
test('unsupported and ambiguous queries cause zero authenticated requests',async()=>{
 let calls=0;const chert=new ChertClient({baseURL:'https://chert.test',apiKey:'fixture',fetch:async()=>{calls++;throw Error('no');}});
 for(const q of ['worker_id=x','account_email=x','group_id=x','message_type=group','service=SMS','status=SUCCESS','limit=0','offset=10001','offset=01','number=%2B15550000001%0A','limit=1&limit=2','created_at_gte=2026-10-19T00:00:00Z&created_at_lte=2026-10-18T00:00:00Z'])
  await expect(listAccountHistory(chert,new URLSearchParams(q))).rejects.toMatchObject({status:501});
 expect(calls).toBe(0);
});
test('maps only observed public data; unknown clocks and endpoints stay absent',()=>{
 const value=mapAccountHistory(page(),new URLSearchParams());
 expect(value).toEqual({data:[{message_handle:'public_1',from_number:'+15550000001',to_number:'+15550000002',sendblue_number:'+15550000001',number:'+15550000002',is_outbound:true,message_type:'message',status:'QUEUED',content:'actual text'}],pagination:{hasMore:false,limit:50,offset:0,total:1}});
 const unknown={...row(),from:null,to:null,line_number:null,phone_line_id:null,direction:'unknown',is_group:null,status:'unknown',parts:[],endpoint_source:'unknown'};
 expect(mapAccountHistory(page([unknown]),new URLSearchParams()).data).toEqual([{message_handle:'public_1'}]);
});
test('malformed/duplicate records and inconsistent pagination fail the whole response',()=>{
 for(const value of [page([row(),row()]),page([{...row(),to:'foreign'}]),page([{...row(),sent_at:'not-a-time'}]),page([{...row(),id:'../escape'}]),{...page(),pagination:{has_more:true,limit:50,offset:0,total:1}}, {...page(),pagination:{has_more:false,limit:50,offset:0,total:2}}])
  expect(()=>mapAccountHistory(value,new URLSearchParams())).toThrow();
 expect(()=>mapAccountHistory(page(),new URLSearchParams({limit:'1'}))).toThrow();
});
test('one list request is one GET with abort forwarded and backend errors preserved',async()=>{
 const requests:Request[]=[];const chert=new ChertClient({baseURL:'https://chert.test',apiKey:'fixture',fetch:async(u,i)=>{requests.push(new Request(u,i));return Response.json(page());}});
 await listAccountHistory(chert,new URLSearchParams({number:'+15550000002'}));
 expect(requests).toHaveLength(1);expect(requests[0]!.method).toBe('GET');expect(requests[0]!.url).toBe('https://chert.test/api/v1/messages?number=%2B15550000002');
 const controller=new AbortController();controller.abort();await expect(listAccountHistory(chert,new URLSearchParams(),controller.signal)).rejects.toThrow();expect(requests).toHaveLength(1);
 let calls=0;const failed=new ChertClient({baseURL:'https://chert.test',apiKey:'fixture',fetch:async()=>{calls++;return Response.json({error:{code:'history_unavailable',message:'unavailable'}},{status:501});}});
 await expect(listAccountHistory(failed,new URLSearchParams())).rejects.toMatchObject({status:501,code:'history_unavailable'});expect(calls).toBe(1);
});

test('plaintext multipart is complete and rich parts never become partial content',()=>{
 expect(mapAccountHistory(page([{...row(),parts:[{type:'text',value:' first '},{type:'text',value:'second\r\n'}]}]),new URLSearchParams()).data![0]!.content).toBe(' first \n\nsecond\r\n');
 expect(mapAccountHistory(page([{...row(),parts:[{type:'text',value:'caption'},{type:'media',attachment_id:'owned'}]}]),new URLSearchParams()).data![0]).not.toHaveProperty('content');
 expect(()=>mapAccountHistory(page([{...row(),parts:[{type:'text',value:42}]}]),new URLSearchParams())).toThrow();
});

test('calendar, prototype keys and frozen outbound provenance fail closed',async()=>{
 for(const q of ['order_by=toString','order_by=__proto__','created_at_gte%0A=2026-10-18T00:00:00Z','created_at_gte=2026-02-30T00:00:00Z','sent_at_gte=2026-10-18T24:00:00Z'])expect(()=>accountHistoryQuery(new URLSearchParams(q))).toThrow();
 expect(accountHistoryQuery(new URLSearchParams({created_at_gte:'2024-02-29T23:59:59.123456+01:00'})).get('created_at_gte')).toBe('2024-02-29T23:59:59.123456+01:00');
 for(const patch of [{direction:'inbound'},{is_group:true},{line_number:'+15550000003'},{phone_line_id:'made-up'},{status:'pending'},{service:'garbage'},{endpoint_source:'unknown'}])expect(()=>mapAccountHistory(page([{...row(),...patch}]),new URLSearchParams())).toThrow();
});

test('fractional reversed ranges reject before HTTP without losing submillisecond precision',async()=>{
 let calls=0;
 const chert=new ChertClient({baseURL:'https://chert.test',apiKey:'fixture',fetch:async()=>{calls++;return Response.json(page());}});
 await expect(listAccountHistory(chert,new URLSearchParams({created_at_gte:'2026-10-18T00:00:00.123002Z',created_at_lte:'2026-10-18T00:00:00.123001Z'}))).rejects.toMatchObject({status:501});
 expect(calls).toBe(0);
 expect(()=>accountHistoryQuery(new URLSearchParams({created_at_gte:'2026-10-18T01:00:00.123001+01:00',created_at_lte:'2026-10-18T00:00:00.1230010Z'}))).not.toThrow();
 expect(()=>accountHistoryQuery(new URLSearchParams({created_at_gte:'2026-10-18T00:00:00.123001Z',created_at_lte:'2026-10-18T00:00:01.000001Z'}))).not.toThrow();
});

const attachmentID='a'.repeat(48);
function mediaRow(){
 const expires=Math.floor(Date.now()/1000)+1800;
 const download_url=`https://chert.test/api/v1/attachments/${attachmentID}/download?tenant=11000000-0000-4000-8000-000000000001&signature=${'b'.repeat(64)}&expires=${expires}`;
 return {...row(),id:'public_media',endpoint_source:'strict_media_intent',parts:[{type:'media',attachment_id:attachmentID}],attachments:[{attachment_id:attachmentID,filename:'actual.png',content_type:'image/png',size_bytes:70,download_url,download_url_expires_at:new Date(expires*1000).toISOString()}]};
}
test('strict one-media history maps actual capability and exact optional caption without URL fetch',async()=>{
 for(const caption of [undefined,'  exact / Café 🦀\r\ncaption  ']){
  const r=mediaRow();if(caption!==undefined)r.parts=[{type:'text',value:caption} as never,...r.parts];
  let calls=0;const chert=new ChertClient({baseURL:'https://chert.test',apiKey:'fixture',fetch:async(u,i)=>{calls++;expect(new URL(String(u)).pathname).toBe('/api/v1/messages');expect(i?.method).toBe('GET');return Response.json(page([r]));}});
  const result=await listAccountHistory(chert,new URLSearchParams(),undefined,'https://chert.test');
  expect(result.data![0]!.media_url).toBe(r.attachments[0]!.download_url);
  if(caption===undefined)expect(result.data![0]).not.toHaveProperty('content');else expect(result.data![0]!.content).toBe(caption);
  expect(result.data![0]).not.toHaveProperty('date_sent');expect(calls).toBe(1);
 }
});
test('media history refuses compound, conflicting, foreign and expired capabilities as whole pages',()=>{
 expect(mapAccountHistory(page([row(),mediaRow()]),new URLSearchParams(),'https://chert.test').data).toHaveLength(2);
 const mutations=[(r:any)=>r.parts.push({...r.parts[0]}),(r:any)=>r.parts.reverse().push({type:'text',value:'after'}),(r:any)=>r.attachments.push({...r.attachments[0]}),(r:any)=>r.attachments[0].attachment_id='c'.repeat(48),(r:any)=>r.attachments[0].download_url=r.attachments[0].download_url.replace('chert.test','foreign.test'),(r:any)=>r.attachments[0].size_bytes=0,(r:any)=>r.attachments[0].extra='private',(r:any)=>r.attachments[0].download_url_expires_at='2000-01-01T00:00:00Z',(r:any)=>r.direction='inbound',(r:any)=>r.parts=[{type:'text',value:'\ud800'},{type:'media',attachment_id:attachmentID}]];
 for(const change of mutations){const r=mediaRow();change(r);expect(()=>mapAccountHistory(page([row(),r]),new URLSearchParams(),'https://chert.test')).toThrow();}
 expect(()=>mapAccountHistory(page([mediaRow()]),new URLSearchParams())).toThrow();
});
