import {test,expect} from 'bun:test';
import {createHmac} from 'node:crypto';
// Runtime import keeps the imported backend's separate dependency root intact.
const {sendReactionOperation}=await import(new URL('../../imessage-server/lib/sending/reaction-operation.ts',import.meta.url).href);

test('reaction operation signs one exact owned tuple and validates dispatch identity only',async()=>{
 let requests=0,dbReads=0,mode='ack';const prepared='AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
 const line={id:'line',project_id:'project',phone_number:'+15550000001',status:'active',server_url:'',api_key:'bearer-key',signing_secret:'different-signing'};
 const native=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request):Promise<Response>{requests++;expect(request.method).toBe('POST');expect(new URL(request.url).pathname).toBe('/api/v1/reaction-operations/v1');expect(request.headers.get('authorization')).toBe('Bearer bearer-key');const raw=await request.text(),body=JSON.parse(raw);expect(Object.keys(body).sort()).toEqual(['from','origin','partIndex','reaction','remove','targetGuid','to']);const sig=/^v1,(\d+),([a-f0-9]{64})$/.exec(request.headers.get('x-chert-signature')!);expect(sig).not.toBeNull();expect(sig![2]).toBe(createHmac('sha256',line.signing_secret).update(sig![1]+'.'+raw).digest('hex'));
  if(mode==='redirect')return Response.redirect(native.url.origin+'/sink',307);
  if(mode==='error')return new Response('PRIVATE-NATIVE-ERROR',{status:500});
  if(mode==='oversize')return Response.json({padding:'x'.repeat(17000)},{status:202});
  const ack:Record<string,unknown>={...body,fingerprint:'d90675478a4499822ff51a77a00eafd2d3ef4e46b17debd5655a5654e2f4d621',preparedGuid:prepared,state:'acknowledged'};
  if(mode==='same-guid')ack.preparedGuid=body.targetGuid.toUpperCase();if(mode==='wrong-target')ack.targetGuid=prepared;if(mode==='wrong-fp')ack.fingerprint='0'.repeat(64);if(mode==='applied')ack.state='applied';if(mode==='extra')ack.applied=true;if(mode==='wrong-remove')ack.remove=true;
  return Response.json(ack,{status:mode==='wrong-status'?200:202});
 }});line.server_url=native.url.origin;
 let onLookup=()=>{};const db={from(table:string){dbReads++;expect(table).toBe('phone_lines');return{select(){return this},eq(){return this},async maybeSingle(){onLookup();return{data:line,error:null}}}}};
 const args={supabase:db,projectId:'project',lineId:'line',operationId:'0123456789abcdef0123456789abcdef',from:line.phone_number,to:'+15550000002',targetGuid:'11111111-2222-4333-8444-555555555555',partIndex:0,reaction:'love' as const,remove:false};
 try{
  const ack=await sendReactionOperation(args);expect(ack).toEqual({ok:true,status:202,operationId:args.operationId,preparedGuid:prepared,fingerprint:'d90675478a4499822ff51a77a00eafd2d3ef4e46b17debd5655a5654e2f4d621',state:'acknowledged'});expect(requests).toBe(1);expect('applied' in ack).toBe(false);
  for(const value of ['same-guid','wrong-target','wrong-fp','applied','extra','wrong-remove','wrong-status','oversize','error','redirect']){mode=value;const before=requests;const result=await sendReactionOperation(args);expect(result).toMatchObject({ok:false,status:502,code:4103,retryable:false,operationId:args.operationId});expect(requests).toBe(before+1);expect(JSON.stringify(result)).not.toContain('PRIVATE-NATIVE-ERROR');}
  for(const change of [{partIndex:true},{partIndex:-1},{partIndex:2147483648},{remove:0},{targetGuid:args.targetGuid+'\n'},{from:args.from+'\n'},{reaction:'emoji'},{operationId:'bad'}]){const before=[requests,dbReads];expect((await sendReactionOperation({...args,...change})).ok).toBe(false);expect([requests,dbReads]).toEqual(before);}
  mode='ack';const originalContext={projectId:args.projectId,lineId:args.lineId,supabase:args.supabase};onLookup=()=>{Object.assign(args,{projectId:'mutated',lineId:'mutated',supabase:{from(){throw Error('must not use replaced handle')}}});};const beforeMutation=requests;expect((await sendReactionOperation(args)).ok).toBe(true);expect(requests).toBe(beforeMutation+1);Object.assign(args,originalContext);onLookup=()=>{};
  for(const change of [{status:'inactive'},{phone_number:'+15550000009'},{server_url:'http://device.invalid'},{project_id:'foreign'}]){const original={...line},before=requests;Object.assign(line,change);expect((await sendReactionOperation(args)).ok).toBe(false);expect(requests).toBe(before);Object.assign(line,original);}
 }finally{native.stop(true)}
});
