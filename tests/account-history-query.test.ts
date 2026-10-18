import {describe,expect,test} from 'bun:test'
import {AccountHistoryQueryError,parseAccountHistoryQuery,pageAccountHistory} from '../../imessage-server/lib/messaging/account-history-query'

const query=(value='')=>parseAccountHistoryQuery(new URLSearchParams(value))
const row=(id:string,patch:Record<string,unknown>={})=>({id,chat_id:'chat-a',from:'+15550000001',to:'+15550000002',line_number:'+15550000001',direction:'outbound',service:'imessage',is_group:false,status:'queued',created_at:'2026-10-18T00:00:00Z',updated_at:null,sent_at:null,...patch}) as Parameters<typeof pageAccountHistory>[0][number]
const error=(run:()=>unknown,status:400|422)=>{try{run();throw new Error('expected refusal')}catch(e){expect(e).toBeInstanceOf(AccountHistoryQueryError);expect((e as AccountHistoryQueryError).status).toBe(status)}}
describe('account recorded history query',()=>{
 test('explicit Chert defaults and bounded query parsing',()=>{
  expect(query()).toEqual({limit:50,offset:0,order_by:'created_at',order_direction:'desc'})
  expect(query('limit=200&offset=10000&is_group=false')).toMatchObject({limit:200,offset:10000,is_group:false})
  for(const value of ['limit=0','limit=201','offset=10001','offset=-1','limit=01','limit=1&limit=2','wat=1','order_by=date_sent','order_direction=DESC','direction=both','service=sms','is_group=0','status=unknown','number=15550000001','created_at_gte=2026-02-30T00%3A00%3A00Z','created_at_gte=2026-10-19T00%3A00%3A00Z&created_at_lte=2026-10-18T00%3A00%3A00Z',`cursor=${'a'.repeat(8200)}`])error(()=>query(value),400)
 })
 test('filters complete inventory before sorting offset and limit without mutation',()=>{
  const records=[row('excluded',{from:'+15550000009',created_at:'2026-10-19T00:00:00Z'}),row('old',{created_at:'2026-10-17T00:00:00Z'}),row('new')]
  const before=structuredClone(records)
  const result=pageAccountHistory(records,query('from_number=%2B15550000001&limit=1&offset=1'))
  expect(result.messages.map(r=>r.id)).toEqual(['old'])
  expect(result.pagination).toEqual({has_more:false,limit:1,offset:1,total:2})
  expect(records).toEqual(before)
 })
 test('sender recipient any-endpoint and owned-line are distinct for inbound',()=>{
  const records=[row('out'),row('in',{from:'+15550000002',to:'+15550000001',direction:'inbound'})]
  const ids=(q:string)=>pageAccountHistory(records,query(q)).messages.map(r=>r.id)
  expect(ids('from_number=%2B15550000002')).toEqual(['in'])
  expect(ids('to_number=%2B15550000002')).toEqual(['out'])
  expect(ids('number=%2B15550000002')).toEqual(['out','in'])
  expect(ids('line_number=%2B15550000001&direction=inbound')).toEqual(['in'])
 })
 test('clock bounds inclusive with timezone equivalence and deterministic chat/id ties',()=>{
  const records=[row('b'),row('a'),row('a',{chat_id:'chat-b'}),row('outside',{created_at:'2026-10-18T00:00:01Z'})]
  const bounds='created_at_gte=2026-10-18T01%3A00%3A00%2B01%3A00&created_at_lte=2026-10-18T00%3A00%3A00Z'
  expect(pageAccountHistory(records,query(bounds+'&order_direction=asc')).messages.map(r=>[r.chat_id,r.id])).toEqual([['chat-a','a'],['chat-a','b'],['chat-b','a']])
  expect(pageAccountHistory(records,query(bounds)).messages.map(r=>[r.chat_id,r.id])).toEqual([['chat-b','a'],['chat-a','b'],['chat-a','a']])
 })
 test('unknown required facts reject inventory rather than silently returning partial matches',()=>{
  for(const [q,patch] of [['from_number=%2B15550000001',{from:null}],['to_number=%2B15550000002',{to:null}],['number=%2B15550000001',{to:null}],['line_number=%2B15550000001',{line_number:null}],['direction=inbound',{direction:'unknown'}],['service=imessage',{service:'unknown'}],['is_group=false',{is_group:null}],['status=queued',{status:'unknown'}],['sent_at_gte=2026-10-18T00%3A00%3A00Z',{sent_at:null}],['order_by=updated_at',{updated_at:null}]] as const){
   error(()=>pageAccountHistory([row('valid'),row('unknown',patch)],query(q)),422)
  }
  expect(pageAccountHistory([row('unknown',{from:null,to:null})],query()).messages).toHaveLength(1)
 })
 test('read satisfies delivered filter; unknown unused clocks stay unknown',()=>{
  const result=pageAccountHistory([row('read',{status:'read'}),row('queued')],query('status=delivered'))
  expect(result.messages.map(r=>r.id)).toEqual(['read'])
  expect(result.messages[0].sent_at).toBeNull()
 })
 test('fractional bounds are compared without truncating submillisecond query precision',()=>{
  const records=[row('millisecond',{created_at:'2026-10-18T00:00:00.123Z'})]
  expect(pageAccountHistory(records,query('created_at_gte=2026-10-18T00%3A00%3A00.123001Z')).messages).toHaveLength(0)
  expect(pageAccountHistory(records,query('created_at_gte=2026-10-18T01%3A00%3A00.123000%2B01%3A00')).messages).toHaveLength(1)
  error(()=>query('created_at_gte=2026-10-18T00%3A00%3A00.123002Z&created_at_lte=2026-10-18T00%3A00%3A00.123001Z'),400)
 })
})
