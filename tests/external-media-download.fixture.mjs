// Only DNS and HTTPS transport are substituted; application policy is real.
import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
const secret='PRIVATE-DOWNLOAD-TOKEN',url=`https://cdn.example/image.png?token=${secret}`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
let scenario={},requests=[],lookups=[],destroyed=0,chunksRead=0,cases=0,label='module-load',deadline,controller;
const originalTimeout=AbortSignal.timeout;
AbortSignal.timeout=ms=>{assert.equal(ms,15000);deadline=ms;controller=new AbortController();return controller.signal;};
globalThis.__chertExternalDNS=async(host,options)=>{lookups.push({host,options});if(scenario.dnsError)throw Error(secret);if(scenario.dnsPending)return new Promise(()=>{});return scenario.addresses??[{address:'8.8.8.8',family:4}];};
globalThis.__chertExternalHTTPS=(target,options,callback)=>{
 const req=new EventEmitter();requests.push({target,options});req.destroy=()=>{destroyed++;queueMicrotask(()=>req.emit('error',Error(secret)));return req;};
 req.setTimeout=()=>req;req.end=()=>{queueMicrotask(()=>{
  if(scenario.requestError){req.emit('error',Error(secret));return;}if(scenario.stall)return;
  const response=new EventEmitter();response.statusCode=scenario.status??200;response.headers={...(scenario.headers??{'content-type':'image/png','content-length':String(png.length)})};response.destroy=()=>{destroyed++;};response.resume=()=>response;
  response[Symbol.asyncIterator]=async function*(){for(const chunk of scenario.chunks??[png]){chunksRead++;yield chunk;}if(scenario.streamError)throw Error(secret);};
  callback(response);
 });return req;};
 options.signal?.addEventListener('abort',()=>req.destroy(),{once:true});return req;
};

function reset(next={}){scenario=next;requests=[];lookups=[];destroyed=0;chunksRead=0;deadline=undefined;controller=undefined;}
const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-deadline')),350);promise.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
try{
 // Bun runtime/bundler bypasses plugins for built-ins. Bundle the unchanged
 // production module, then substitute exactly its two transport import specifiers.
 const built=await Bun.build({entrypoints:[resolve(import.meta.dir,'../../imessage-server/lib/messaging/external-media.ts')],target:'bun',write:false});assert.ok(built.success);
 let code=await built.outputs[0].text();
 for(const[name,exportName,globalName]of[['dns/promises','lookup','__chertExternalDNS'],['https','request','__chertExternalHTTPS']]){
  const pattern=new RegExp('from ["\'](?:node:)?'+name+'["\']','g');assert.equal([...code.matchAll(pattern)].length,1);
  const boundary='data:text/javascript;base64,'+Buffer.from('export const '+exportName+'=globalThis.'+globalName+';').toString('base64');
  code=code.replace(pattern,'from '+JSON.stringify(boundary));
 }
 assert.ok(!/from ["'](?:node:)?(dns\/promises|https)["']/.test(code));
 const {downloadExternalMedia}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 async function refused(name,next={},input=url,network=0){label=name;reset(next);let failed=false;try{await bounded(downloadExternalMedia(input));}catch(error){failed=true;assert.ok(error instanceof Error);assert.equal(error.message,'External media unavailable');assert.ok(!String(error).includes(secret));assert.ok(!String(error).includes('cdn.example'));}assert.ok(failed);assert.equal(requests.length,network);cases++;}
 label='valid-pinned-transport';reset();const result=await bounded(downloadExternalMedia(url));label='valid-bytes';assert.deepEqual(result.bytes,png);assert.equal(result.contentType,'image/png');assert.ok(typeof result.filename==='string'&&result.filename.length>0&&!result.filename.includes(secret));assert.equal(requests.length,1);label='valid-dns';assert.deepEqual(lookups,[{host:'cdn.example',options:{all:true,verbatim:true}}]);label='valid-request-options';const sent=requests[0];assert.equal(new URL(sent.target).hostname,'cdn.example');assert.equal(sent.options.method,'GET');assert.equal(sent.options.agent,false);assert.equal(sent.options.autoSelectFamily,false);assert.equal(sent.options.rejectUnauthorized,true);assert.deepEqual(Object.fromEntries(Object.entries(sent.options.headers).map(([k,v])=>[k.toLowerCase(),v])),{accept:'*/*','accept-encoding':'identity'});assert.ok(sent.options.servername===undefined||sent.options.servername==='cdn.example');assert.ok(!('hostname'in sent.options)||sent.options.hostname==='cdn.example');label='valid-pinned-lookup';let pinned;sent.options.lookup('cdn.example',{family:4},(error,address,family)=>{assert.equal(error,null);pinned={address,family};});assert.deepEqual(pinned,{address:'8.8.8.8',family:4});for(const[host,options]of[['foreign.example',{}],['cdn.example',{all:true}]]){let failed=false;sent.options.lookup(host,options,error=>{failed=error instanceof Error;assert.ok(!String(error).includes(secret));});assert.ok(failed);}cases++;
 for(const [name,input]of[['no-filename','https://cdn.example/'],['no-extension','https://cdn.example/file'],['decoded-separator','https://cdn.example/a%2Fb.png'],['bad-percent','https://cdn.example/a%ZZ.png'],['http','http://cdn.example/a'],['credentials','https://user:pass@cdn.example/a'],['fragment','https://cdn.example/a#x'],['port','https://cdn.example:444/a']])await refused(name,{},input);
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:8.8.8.8','2002:0808:0808::1','2001:db8::1','3ffe::1']){
  const family=address.includes(':')?6:4;await refused('resolved-address-'+cases,{addresses:[{address,family}]});
 }
 for(const literal of ['127.0.0.1','10.0.0.1','2130706433','[::1]','[::ffff:127.0.0.1]'])await refused('literal-address-'+cases,{},'https://'+literal+'/a.png');
 await refused('mixed-addresses',{addresses:[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]});
 await refused('private-local-host',{},'https://internal.local/image.png');await refused('empty-dns',{addresses:[]});await refused('dns-error',{dnsError:true});
 for(const status of [201,204,301,302,307,308,404,500])await refused('http-status-'+status,{status,headers:{'content-type':'image/png',location:'https://untrusted.invalid/private'}},url,1);
 for(const headers of [{'content-type':'text/html'},{'content-type':'image/png','content-length':'0'},{'content-type':'image/png','content-length':'-1'},{'content-type':'image/png','content-length':'1.5'},{'content-type':'image/png','content-length':['10']},{'content-type':'application/x-unrecognized'},{'content-type':'image/png','content-encoding':'gzip'},{'content-type':'image/png','content-length':String(100*1024*1024+1)}])await refused('invalid-header-'+cases,{headers},url,1);
 label='canonical-mime';reset({headers:{'content-type':'IMAGE/PNG; charset=binary','content-encoding':'identity','content-length':String(png.length)}});assert.equal((await bounded(downloadExternalMedia(url))).contentType,'image/png');cases++;
 await refused('empty-response',{headers:{'content-type':'image/png'},chunks:[]},url,1);
 await refused('truncated-length',{headers:{'content-type':'image/png','content-length':String(png.length+1)}},url,1);
 await refused('request-error',{requestError:true},url,1);await refused('stream-error',{streamError:true},url,1);
 const chunk=Buffer.alloc(50*1024*1024+1);await refused('oversize-stream',{headers:{'content-type':'image/png'},chunks:[chunk,chunk,chunk]},url,1);assert.ok(chunksRead<=2);
 label='many-tiny-chunks-bounded-allocation';reset({headers:{'content-type':'image/png'},chunks:Array(4097).fill(Buffer.from([0x5a]))});
 const originalAlloc=Buffer.allocUnsafe,originalConcat=Buffer.concat,allocations=[];
 Buffer.allocUnsafe=function(size,...rest){allocations.push(size);return originalAlloc.call(Buffer,size,...rest);};Buffer.concat=()=>{throw Error('Unbounded chunk concatenation is forbidden');};
 try{const tiny=await bounded(downloadExternalMedia(url));assert.equal(tiny.bytes.length,4097);assert.deepEqual(tiny.bytes,Buffer.alloc(4097,0x5a));assert.equal(chunksRead,4097);assert.ok(allocations.length<=2&&allocations.reduce((a,b)=>a+b,0)<=128*1024);cases++;}finally{Buffer.allocUnsafe=originalAlloc;Buffer.concat=originalConcat;}
 label='total-request-timeout';reset({stall:true});const pending=downloadExternalMedia(url);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(deadline,15000);controller.abort();let failed=false;try{await bounded(pending);}catch(error){failed=true;assert.ok(!String(error).includes(secret));assert.ok(!String(error).includes('fixture-deadline'));}assert.ok(failed);assert.ok(destroyed>0);assert.equal(requests.length,1);cases++;
 label='total-dns-timeout';reset({dnsPending:true});const dnsPending=downloadExternalMedia(url);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(deadline,15000);controller.abort();failed=false;try{await bounded(dnsPending);}catch(error){failed=true;assert.ok(!String(error).includes('fixture-deadline'));}assert.ok(failed);assert.equal(requests.length,0);cases++;
 console.log(JSON.stringify({passed:true,cases,realNetworkRequests:0,pinnedTransport:true,totalDeadlineMs:deadline}));
}catch(error){console.error(JSON.stringify({passed:false,case:label,errorClass:error?.constructor?.name,deadline,dns:lookups.length,https:requests.length,destroyed,privateDetailsOmitted:true}));process.exitCode=1;}finally{AbortSignal.timeout=originalTimeout;}
