import {expect,test} from 'bun:test'
import type {AccountHistoryRecord} from '../../imessage-server/lib/messaging/account-history-types'
const renewalURL=new URL('../../imessage-server/lib/messaging/account-history-media-capabilities.ts',import.meta.url).href
const {renewAccountMediaCapabilities}=await import(renewalURL)
import {verifyOneHourAttachmentDownload} from '../../imessage-server/lib/messaging/attachment-download'
const tenant={id:'11000000-0000-4000-8000-000000000001',signing_secret:'synthetic-test-only'}
const access={tenant,origin:'http://127.0.0.1:32123'}
const id=(n:number)=>n.toString(16).padStart(48,'0')
const metadata=(n:number)=>({attachment_id:id(n),tenant_id:tenant.id,filename:'fixture.png',content_type:'image/png',size_bytes:70,uploaded_at:'2026-10-18T00:00:00Z',blob_url:`messaging-attachments/${tenant.id}/${id(n)}/fixture.png`})
const record=(n:number)=>({id:String(n),endpoint_source:'strict_media_intent',attachments:[{attachment_id:id(n),filename:'fixture.png',content_type:'image/png',size_bytes:70,download_url:'http://expired.invalid/old',download_url_expires_at:'2000-01-01T00:00:00Z'}]}) as unknown as AccountHistoryRecord
function database(rows:Record<string,unknown>[],transform=(v:Record<string,unknown>[])=>v){
 const calls:{ids:string[];tenant:string}[]=[]
 const db={from(table:string){expect(table).toBe('messaging_attachments');let ids:string[]=[],owner='';return {select(){return this},eq(k:string,v:string){expect(k).toBe('tenant_id');owner=v;return this},in(k:string,v:string[]){expect(k).toBe('attachment_id');ids=v;return this},order(k:string){expect(k).toBe('attachment_id');return this},range(a:number,b:number){expect([a,b]).toEqual([0,199]);calls.push({ids,tenant:owner});return Promise.resolve({data:transform(rows.filter(r=>ids.includes(r.attachment_id as string))),error:null})}}}}
 return {db,calls}
}
test('more than 200 records batch unique IDs; renew only returned values with valid current HMAC and no fetch',async()=>{
 const records=Array.from({length:402},(_,n)=>record(n%201)),before=structuredClone(records)
 const {db,calls}=database(Array.from({length:201},(_,n)=>metadata(n)))
 const original=globalThis.fetch;globalThis.fetch=Object.assign(async()=>{throw Error('URL fetch forbidden')},{preconnect:original.preconnect})
 try{
  const result=await renewAccountMediaCapabilities(db,records,access,201)
  expect(result.sourceRows).toBe(201);expect(calls.map(c=>c.ids.length)).toEqual([200,1]);expect(calls.every(c=>c.tenant===tenant.id)).toBe(true)
  expect(result.records).toHaveLength(402);expect(records).toEqual(before)
  const url=new URL(result.records[0]!.attachments![0]!.download_url)
  expect(url.origin).toBe(access.origin);expect(url.pathname).toBe(`/api/v1/attachments/${id(0)}/download`)
  expect(verifyOneHourAttachmentDownload(tenant,id(0),url.searchParams.get('expires')!,url.searchParams.get('signature')!)).toBe(true)
  expect(result.records[0]).not.toBe(records[0])
 }finally{globalThis.fetch=original}
})
test('no media is passthrough; missing access and insufficient work refuse before DB',async()=>{
 const {db,calls}=database([metadata(0)])
 const empty=[] as Parameters<typeof renewAccountMediaCapabilities>[1]
 expect(await renewAccountMediaCapabilities(db,empty,undefined,0)).toEqual({records:empty,sourceRows:0})
 await expect(renewAccountMediaCapabilities(db,[record(0)],undefined,1)).rejects.toThrow('unavailable')
 await expect(renewAccountMediaCapabilities(db,[record(0)],access,0)).rejects.toThrow('unavailable')
 expect(calls).toHaveLength(0)
})
test('owned metadata must exactly match canonical blob and immutable frozen tuple',async()=>{
 for(const patch of [{tenant_id:'11000000-0000-4000-8000-000000000002'},{blob_url:'messaging-attachments/foreign/key'},{filename:'../fixture.png'},{content_type:'text/html'},{size_bytes:71},{uploaded_at:null},{uploaded_at:'2026-02-30T00:00:00Z'},{live_photo:true}]){
  const {db}=database([{...metadata(0),...patch}])
  await expect(renewAccountMediaCapabilities(db,[record(0)],access,1)).rejects.toThrow('unavailable')
 }
})
test('missing and duplicate owned rows fail closed without changing input',async()=>{
 for(const rows of [[],[metadata(0),metadata(0)]]){
  const records=[record(0),record(1)],before=structuredClone(records),{db}=database(rows)
  await expect(renewAccountMediaCapabilities(db,records,access,2)).rejects.toThrow('unavailable')
  expect(records).toEqual(before)
 }
})
