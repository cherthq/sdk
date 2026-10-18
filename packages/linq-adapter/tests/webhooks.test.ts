import {test,expect} from 'bun:test';
import {createHmac} from 'node:crypto';
import Adapter from '../src/index';
const bytes=Buffer.from('0123456789abcdef0123456789abcdef'),secret='whsec_'+bytes.toString('base64');
const raw='{"event_id":"fixture-event","event_type":"message.received","data":{"text":" exact / Café 🌅\\r\\n "}}';
function signed(body=raw,seconds=Math.floor(Date.now()/1000)){
 const id='fixture-event',timestamp=String(seconds);
 return {'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+createHmac('sha256',bytes).update(`${id}.${timestamp}.${body}`).digest('base64')};
}
function client(){let requests=0;const adapter=new Adapter({webhookSecret:secret,chert:{baseURL:'https://chert.test',apiKey:'not-forwarded',fetch:async()=>{requests++;throw new Error('Unexpected HTTP');}}});return{adapter,count:()=>requests};}
test('inherited pinned verifier authenticates exact raw bytes without HTTP, and replay deduplication belongs to the consumer',()=>{
 const {adapter,count}=client(),headers=signed();
 expect(adapter.webhooks.unwrap(raw,{headers})).toEqual(JSON.parse(raw));
 // A valid repeat remains valid: verification does not implement event-id storage.
 expect(adapter.webhooks.unwrap(raw,{headers})).toEqual(JSON.parse(raw));
 expect(count()).toBe(0);
});
test('inherited verifier rejects body, event-id, timestamp, signature and secret tampering without HTTP',()=>{
 const {adapter,count}=client(),headers=signed();
 for(const [body,h,key] of [
  [raw+' ',headers,undefined],
  [raw, {...headers,'webhook-id':'other'},undefined],
  [raw, {...headers,'webhook-timestamp':String(Number(headers['webhook-timestamp'])+1)},undefined],
  [raw, {...headers,'webhook-signature':'v1,AAAA'},undefined],
  [raw,headers,'whsec_'+Buffer.alloc(32,42).toString('base64')],
  [raw,signed(raw,Math.floor(Date.now()/1000)-600),undefined],
  [raw,signed(raw,Math.floor(Date.now()/1000)+600),undefined],
 ] as const)expect(()=>adapter.webhooks.unwrap(body,{headers:h,...(key?{key}:{})})).toThrow();
 for(const field of Object.keys(headers)){
  const missing:Record<string,string>={...headers};delete missing[field];
  expect(()=>adapter.webhooks.unwrap(raw,{headers:missing})).toThrow();
 }
 expect(()=>adapter.webhooks.unwrap(raw,{headers:{}})).toThrow();expect(count()).toBe(0);
});
test('omitting headers is upstream parse-only behavior, not signature or schema verification',()=>{
 const {adapter,count}=client();
 expect(adapter.webhooks.unwrap(raw,{} as never)).toEqual(JSON.parse(raw));
 expect(()=>adapter.webhooks.unwrap('not JSON',{} as never)).toThrow();
 expect(count()).toBe(0);
});
