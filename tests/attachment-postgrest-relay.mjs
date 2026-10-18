// Test-only raw TCP relay into a task-owned internal Docker network.
// No HTTP application responses are substituted; parent owns all containers.
import net from 'node:net';
import {spawn} from 'node:child_process';
import {access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const container=process.env.CHERT_TEST_PG_CONTAINER??'';
const docker=process.env.CHERT_TEST_DOCKER_CLI??'';
const config=process.env.CHERT_TEST_DOCKER_CONFIG??'';
const jwt=process.env.CHERT_TEST_SERVICE_JWT??'';
if(!/^[a-f0-9]{64}$/.test(container)||!isAbsolute(docker)||!isAbsolute(config)||/[\x00-\x1f\x7f]/.test(docker+config)
 ||!jwt||jwt.split('.').length!==3||/[\r\n]/.test(jwt))throw Error('Invalid isolated relay configuration');
await access(docker,constants.X_OK);
const configInfo=await stat(config);
if(!configInfo.isDirectory()||(configInfo.mode&0o077)!==0||(process.getuid&&configInfo.uid!==process.getuid()))throw Error('Relay requires an owner-only Docker configuration directory');
const sockets=new Set(),jobs=new Set(),servers=new Set();let fixture;
const dockerEnv={PATH:'/usr/bin:/bin',DOCKER_HOST:'unix:///var/run/docker.sock',DOCKER_CONFIG:config};
async function createRelay(upstream) {
 // Fixed task-internal destinations only; never accept an environment/argument host.
 const commands={
  rest:'exec 3<>/dev/tcp/fixture-rest/3000; cat <&3 & exec cat >&3',
  storage:'exec 3<>/dev/tcp/fixture-storage/5000; cat <&3 & exec cat >&3',
 };
 if(!Object.hasOwn(commands,upstream))throw Error('Invalid isolated relay destination');
 const server=net.createServer(socket=>{
  if(sockets.size>=32){socket.destroy();return;}
  sockets.add(socket);socket.setTimeout(10_000,()=>socket.destroy());
  const job=spawn(docker,['exec','-i',container,'/bin/bash','-c',commands[upstream]],{env:dockerEnv,stdio:['pipe','pipe','ignore']});
  jobs.add(job);
  const stop=()=>{socket.destroy();if(job.exitCode===null&&!job.killed)job.kill('SIGKILL');};
  socket.on('error',stop);socket.on('close',()=>{sockets.delete(socket);stop();});
  job.on('error',stop);job.on('close',()=>{jobs.delete(job);socket.destroy();});
  job.stdin.on('error',stop);job.stdout.on('error',stop);
  socket.pipe(job.stdin);job.stdout.pipe(socket);
 });
 servers.add(server);server.on('error',()=>{process.exitCode=1;});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return `http://127.0.0.1:${server.address().port}`;
}
async function cleanup(){
 if(fixture&&fixture.exitCode===null)fixture.kill('SIGKILL');
 for(const socket of sockets)socket.destroy();
 for(const job of jobs)if(job.exitCode===null&&!job.killed)job.kill('SIGKILL');
 await Promise.all([...servers].map(server=>new Promise(resolve=>server.close(resolve))));
}
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{void cleanup().finally(()=>process.exit(code));});
try{
 const origin=await createRelay('rest');
 const storageOrigin=process.env.CHERT_TEST_REAL_STORAGE==='1'?await createRelay('storage'):null;
 const deadline=Date.now()+20_000;
 // Official Storage v1.83.5 src/app.ts registers /status as an empty HTTP 200.
 for(const [target,isRest] of [[origin,true],...(storageOrigin?[[storageOrigin,false]]:[])]) {
  let ready=false;
  while(Date.now()<deadline){
   try{
    const response=await fetch(`${target}${isRest?'/messaging_tenants?select=id&limit=1':'/status'}`,{headers:{apikey:jwt,authorization:`Bearer ${jwt}`},redirect:'error',proxy:'',signal:AbortSignal.timeout(Math.max(1,Math.min(1000,deadline-Date.now())))});
    const body=await response.text();
    if(response.status===200&&(!isRest||Array.isArray(JSON.parse(body)))){ready=true;break;}
   }catch{/* Waiting for exact isolated services; never log credentials. */}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw Error('Isolated service readiness deadline exceeded');
 }
 const childEnv={...process.env};
 delete childEnv.CHERT_TEST_STORAGE_URL;
 fixture=spawn(process.execPath,['--no-env-file','--no-install',fileURLToPath(new URL('./attachment-postgrest.fixture.mjs',import.meta.url))],{
  env:{...childEnv,HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:'',NO_PROXY:'*',no_proxy:'*',CHERT_TEST_POSTGREST_URL:origin,...(storageOrigin?{CHERT_TEST_STORAGE_URL:storageOrigin}:{})},stdio:['ignore','inherit','inherit'],
 });
 const watchdog=setTimeout(()=>fixture.kill('SIGKILL'),30_000);
 try{process.exitCode=await new Promise(resolve=>{fixture.once('error',()=>resolve(1));fixture.once('close',code=>resolve(code??1));});}
 finally{clearTimeout(watchdog);}
}catch{
 console.error('Isolated attachment/PostgREST relay failed');process.exitCode=1;
}finally{await cleanup();}
