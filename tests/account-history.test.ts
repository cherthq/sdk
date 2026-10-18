import {test, expect} from 'bun:test'
const moduleURL = new URL('../../imessage-server/lib/messaging/account-history.ts', import.meta.url).href
const fingerprintURL = new URL('../../imessage-server/lib/sending/text-operation-fingerprint.ts', import.meta.url).href
const tenant='tenant-owned', foreign='tenant-foreign', clock='2026-01-01T00:00:00.123456+00:00'
const from='+15550000001',to='+15550000002'
type Row=Record<string,any>
function database(tables:Record<string,Row[]>, hook?:(table:string,read:number,columns:string)=>any){
 const queries:Array<{table:string;columns:string;filters:Array<[string,string,unknown]>;range:number[]}>=[]
 const counts:Record<string,number>={}
 class Query{
  columns='';filters:Array<[string,string,unknown]>=[];bounds=[0,199]
  constructor(public table:string){}
  select(columns:string){this.columns=columns;return this}
  eq(key:string,value:unknown){this.filters.push(['eq',key,value]);return this}
  in(key:string,value:unknown){this.filters.push(['in',key,value]);return this}
  filter(key:string,op:string,value:unknown){this.filters.push([op,key,value]);return this}
  order(){return this}
  range(a:number,b:number){this.bounds=[a,b];return this}
  async then(resolve:(value:any)=>any,reject?:(error:any)=>any){try{
   queries.push({table:this.table,columns:this.columns,filters:[...this.filters],range:[...this.bounds]})
   const override=hook?.(this.table,counts[this.table]=(counts[this.table]??0)+1,this.columns)
   if(override)return resolve(override)
   let rows=[...(tables[this.table]??[])]
   for(const[op,key,value]of this.filters){if(op==='eq')rows=rows.filter(r=>r[key]===value);else if(op==='in')rows=rows.filter(r=>(value as unknown[]).includes(r[key]));else if(op==='cs'){const wanted=JSON.parse(value as string);rows=rows.filter(r=>Object.entries(wanted).every(([k,v])=>r[key]?.[k]===v))}}
   rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)))
   return resolve({data:rows.slice(this.bounds[0],this.bounds[1]+1),error:null})
  }catch(e){if(reject)return reject(e);throw e}}
 }
 return{db:{from:(table:string)=>new Query(table)},queries}
}
const lead=(id='lead-a',convo_id:string|null='convo-a')=>({id,convo_id,messaging_tenant_id:tenant,number:'+15559999999',details:{phone_line_id:'current-mutable-line'}})
const raw=(id='legacy-a',extra:Row={})=>({id,role:'user',content:'actual recorded prose',timestamp:clock,...extra})
async function strict(id='a'.repeat(32),lead_id='lead-a',convo_id:string|null='convo-a',extra:Row={}):Promise<Row>{
 const{textOperationFingerprint}=await import(fingerprintURL)
 const text='  frozen / text\r\n  '
 return{id,tenant_id:tenant,lead_id,convo_id,phone:to,phone_line_id:'frozen-line',status:'processing',created_at:clock,
  request_payload:{message:{parts:[{type:'text',value:text}]}},response_payload:{status:'queued',mac_text_origin:'text_'+id,mac_text_protocol:'text-operations/v1',mac_text_from:from,mac_text_to:to,mac_text_fingerprint:textOperationFingerprint(from,to,text),mac_text_dispatch_state:'reserved'},...extra}
}
async function load(d:ReturnType<typeof database>){const{loadAccountHistory}=await import(moduleURL);return loadAccountHistory({supabase:d.db,tenantId:tenant})}
test('account records preserve only frozen endpoints and real clocks; unknown legacy endpoints remain null',async()=>{
 const row=await strict(),d=database({leads:[lead(),{...lead('foreign'),messaging_tenant_id:foreign}],convo:[{id:'convo-a',lead_id:'lead-a',messages:[raw()]}],messaging_send_events:[row,{...row,id:'b'.repeat(32),tenant_id:foreign}]})
 const records=await load(d);expect(records).toHaveLength(2)
 const legacy=records.find((v:any)=>v.id==='legacy-a'),intent=records.find((v:any)=>v.id===row.id)
 expect(legacy).toMatchObject({from:null,to:null,phone_line_id:null,line_number:null,is_group:null,sent_at:null,endpoint_source:'unknown'})
 expect(intent).toMatchObject({from,to,phone_line_id:'frozen-line',line_number:from,is_group:false,sent_at:null,status:'queued',service:'unknown',endpoint_source:'strict_text_intent',created_at:clock})
 expect(intent.parts).toEqual([{type:'text',value:row.request_payload.message.parts[0].value}])
 expect(d.queries.every(q=>q.filters.every(([,key])=>key!=='number'&&key!=='phone_line_id'))).toBe(true)
})
test('more than 1000 leads, conversations and strict sends use bounded batches instead of per-lead queries',async()=>{
 const leads=Array.from({length:1001},(_,i)=>lead('lead-'+String(i).padStart(4,'0'),'convo-'+String(i).padStart(4,'0')))
 const convos=leads.map((l,i)=>({id:l.convo_id,lead_id:l.id,messages:[raw('legacy-'+i)]}))
 const base=await strict();const sends=leads.map((l,i)=>({...base,id:i.toString(16).padStart(32,'0'),lead_id:l.id,convo_id:l.convo_id,response_payload:{...base.response_payload,mac_text_origin:'text_'+i.toString(16).padStart(32,'0')}}))
 const d=database({leads,convo:convos,messaging_send_events:sends});expect(await load(d)).toHaveLength(2002)
 expect(d.queries.filter(q=>q.table==='convo')).toHaveLength(6)
 expect(d.queries.filter(q=>q.table==='messaging_send_events')).toHaveLength(6)
 expect(d.queries.filter(q=>q.table==='leads')).toHaveLength(12)
 expect(d.queries.every(q=>q.range[1]-q.range[0]===199)).toBe(true)
})
test('invalid or incomplete source rows, caps and database errors fail whole inventory',async()=>{
 const cases=[database({leads:[lead()],convo:[{id:'convo-a',lead_id:'wrong',messages:[raw()]}]}),database({leads:[lead()],convo:[{id:'convo-a',lead_id:'lead-a',messages:[{}]}]}),database({leads:[lead()],convo:[{id:'convo-a',lead_id:'lead-a',messages:Array.from({length:10001},()=>raw())}]}),database({leads:[lead()]},table=>table==='convo'?{data:null,error:{message:'private database fault'}}:undefined)]
 for(const d of cases)await expect(load(d)).rejects.toThrow('Account recorded history is unavailable')
 const row=await strict();row.request_payload.message.parts[0].value='edited'
 await expect(load(database({leads:[lead()],convo:[{id:'convo-a',lead_id:'lead-a',messages:[]}],messaging_send_events:[row]}))).rejects.toThrow()
})
test('exact duplicate identity/text/clock merges; conflicts and cross-chat native GUIDs refuse',async()=>{
 const row=await strict(),content=row.request_payload.message.parts[0].value
 const original=raw(row.id,{role:'assistant',content})
 const make=(messages:Row[])=>database({leads:[lead()],convo:[{id:'convo-a',lead_id:'lead-a',messages}],messaging_send_events:[row]})
 expect(await load(make([original]))).toHaveLength(1)
 for(const changed of [{...original,content:'conflict'},{...original,role:'user'},{...original,timestamp:'2026-01-01T00:00:00.123457Z'}])await expect(load(make([changed]))).rejects.toThrow()
 await expect(load(make([original,original]))).rejects.toThrow()
 const guid='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
 await expect(load(database({leads:[lead(),lead('lead-b','convo-b')],convo:[{id:'convo-a',lead_id:'lead-a',messages:[raw('a',{guid})]},{id:'convo-b',lead_id:'lead-b',messages:[raw('b',{guid:guid.toLowerCase()})]}]}))).rejects.toThrow()
})
test('ownership and conversation movement during inventory refuse, while current phone edits cannot relabel history',async()=>{
 for(const change of [(r:Row)=>r.convo_id='new-convo',(r:Row)=>r.messaging_tenant_id=foreign]){
  const l=lead(),d=database({leads:[l],convo:[{id:'convo-a',lead_id:'lead-a',messages:[raw()]}]},(table,n)=>{if(table==='leads'&&n===2)change(l)})
  await expect(load(d)).rejects.toThrow()
 }
 const l=lead('lead-a',null),row=await strict('a'.repeat(32),'lead-a',null),d=database({leads:[l],messaging_send_events:[row]},(table,n)=>{if(table==='leads'&&n===2)l.number='+15558888888'})
 expect((await load(d))[0]).toMatchObject({from,to,phone_line_id:'frozen-line'})
})
test('only exact missing updated_at column permits bounded schema fallback; cached read never invents sent_at',async()=>{
 const row=await strict();row.response_payload={...row.response_payload,status:'read',error:null,service:'imessage',delivered:true,read:true,retryable:false,delivered_at:'2023-11-14T22:13:20.000Z',read_at:'2023-11-14T22:13:21.000Z'}
 const tables={leads:[lead('lead-a',null)],messaging_send_events:[{...row,convo_id:null}]}
 const d=database(tables,(table,_n,cols)=>table==='messaging_send_events'&&cols.includes('updated_at')?{data:null,error:{code:'42703',message:'column messaging_send_events.updated_at does not exist'}}:undefined)
 expect((await load(d))[0]).toMatchObject({status:'read',read_at:'2023-11-14T22:13:21.000Z',sent_at:null})
 expect(d.queries.filter(q=>q.table==='messaging_send_events')).toHaveLength(2)
 const bad=database(tables,(table)=>table==='messaging_send_events'?{data:null,error:{code:'42703',message:'column unrelated does not exist'}}:undefined)
 await expect(load(bad)).rejects.toThrow();expect(bad.queries.filter(q=>q.table==='messaging_send_events')).toHaveLength(1)
})
test('duplicate known service conflicts and exact native GUID case mismatches fail closed',async()=>{
 const row=await strict(),guid='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';row.response_payload={...row.response_payload,mac_text_dispatch_state:'acknowledged',mac_message_guids:[guid],status:'sent',service:'imessage',error:null,retryable:false,delivered:false,read:false}
 const content=row.request_payload.message.parts[0].value
 const fixture=(extra:Row)=>database({leads:[lead()],convo:[{id:'convo-a',lead_id:'lead-a',messages:[raw(row.id,{role:'assistant',content,...extra})]}],messaging_send_events:[row]})
 await expect(load(fixture({service:'sms',guid}))).rejects.toThrow()
 await expect(load(fixture({service:'imessage',guid:guid.toLowerCase()}))).rejects.toThrow()
 expect(await load(fixture({service:'imessage',guid}))).toHaveLength(1)
})
test('all owned send rows are inventoried: unrepresented media or legacy refuses, foreign rows do not',async()=>{
 const base=await strict('a'.repeat(32),'lead-a',null)
 for(const response_payload of [{status:'queued',mac_media_protocol:'attachment-operations/v1'}, {status:'sent'}, null]){
  const unhandled={...base,id:'b'.repeat(32),response_payload}
  const owned=database({leads:[lead('lead-a',null)],messaging_send_events:[base,unhandled]})
  await expect(load(owned)).rejects.toThrow('Account recorded history is unavailable')
  expect(owned.queries.filter(q=>q.table==='messaging_send_events').every(q=>q.filters.every(([op])=>op!=='cs'))).toBe(true)
  const foreignOnly=database({leads:[lead('lead-a',null)],messaging_send_events:[base,{...unhandled,tenant_id:foreign}]})
  expect(await load(foreignOnly)).toHaveLength(1)
 }
})
