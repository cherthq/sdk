import {test,expect} from 'bun:test';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
const pg=process.env.CHERT_TEST_JOURNAL_PG_BIN,rest=process.env.CHERT_TEST_JOURNAL_POSTGREST,nativeClient=process.env.CHERT_TEST_NATIVE_WEBHOOK_CLIENT?realpathSync(process.env.CHERT_TEST_NATIVE_WEBHOOK_CLIENT):undefined;
const schema=`CREATE ROLE authenticator LOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon NOLOGIN; GRANT service_role,anon TO authenticator; GRANT USAGE ON SCHEMA public TO service_role;
CREATE TABLE messaging_tenants(id uuid PRIMARY KEY,tenant_slug text,signing_secret text,crm_project_id uuid,phone_line_id uuid,is_active boolean,requires_tenant_header boolean DEFAULT false,email text,webhook_url text,webhook_secret text,outbound_consecutive_failures int DEFAULT 0,auto_create_leads boolean DEFAULT false,label text,email_verified_at timestamptz,credit_balance numeric,leadgen_credit_balance numeric);
CREATE TABLE phone_lines(id uuid PRIMARY KEY,project_id uuid,phone_number text,signing_secret text,webhook_subscription_id text);
CREATE TABLE leads(id uuid PRIMARY KEY,project_id uuid,messaging_tenant_id uuid,number text,convo_id uuid,details jsonb);
CREATE TABLE messaging_send_events(id text PRIMARY KEY,tenant_id uuid,lead_id uuid,convo_id uuid,phone text,phone_line_id uuid,status text,error text,message_guid text,created_at timestamptz,request_payload jsonb,response_payload jsonb,idempotency_key text);
CREATE TABLE messaging_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,type text,event_id text,lead_id uuid,convo_id uuid,payload jsonb,delivery_url text,delivery_status text,delivered_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),delivery_attempts jsonb NOT NULL DEFAULT '[]',UNIQUE(tenant_id,event_id));
CREATE TABLE tenant_webhook_subscriptions(id uuid PRIMARY KEY,tenant_id uuid,url text,secret text,events text[],version text,is_active boolean,consecutive_failures int DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,updated_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE webhook_event_dedup(event_id text PRIMARY KEY,received_at timestamptz);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon;`;
async function run(bundle?:string,native=false){
 expect(pg).toBeTruthy();expect(rest).toBeTruthy();
 const dir=mkdtempSync(join(tmpdir(),'chert-lifecycle-pg-'));mkdirSync(join(dir,'socket'),{mode:0o700});
 const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LC_ALL:'C'};let attempted=false,server:ReturnType<typeof spawn>|undefined;
 const command=(name:string,args:string[],input?:string)=>{const r=spawnSync(join(pg!,name),args,{env,encoding:'utf8',timeout:20000,input,maxBuffer:1024*1024});if(r.status!==0)throw new Error('Disposable PostgreSQL setup failed');return r.stdout;};
 try{
 command('initdb',['-D',join(dir,'cluster'),'-U','chert_test','--auth=trust','--no-locale','--encoding=UTF8']);attempted=true;
 command('pg_ctl',['-D',join(dir,'cluster'),'-l',join(dir,'postgres.log'),'-w','-t','15','-o',`-h '' -k '${join(dir,'socket')}' -p 55440 -c max_connections=20 -c shared_buffers=16MB`,'start']);
 command('psql',['-X','-h',join(dir,'socket'),'-p','55440','-U','chert_test','-d','postgres','-v','ON_ERROR_STOP=1'],schema);
 const secret=randomBytes(48).toString('hex'),p=[{alg:'HS256',typ:'JWT'},{role:'service_role',exp:Math.floor(Date.now()/1000)+180}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');const jwt=p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
 const probe=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response()});const port=probe.port;await probe.stop(true);
 const config=join(dir,'postgrest.conf');writeFileSync(config,`db-uri = "postgresql://authenticator@/postgres?host=${join(dir,'socket')}&port=55440"\ndb-schemas = "public"\ndb-anon-role = "anon"\nserver-host = "127.0.0.1"\nserver-port = ${port}\n`,{mode:0o600});
 server=spawn(rest!,[config],{env:{...env,PGRST_JWT_SECRET:secret},stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/`,{redirect:'error'});if(r.status<500){ready=true;break}}catch{}await Bun.sleep(50)}expect(ready).toBe(true);
 const child=Bun.spawn([process.execPath,'--no-env-file','--no-install',resolve(import.meta.dir,'device-lifecycle-postgrest.fixture.mjs'),...(bundle?['--device-event',bundle]:['--offline']),...(native?['--native-webhook-client',nativeClient!]:[])],{env:{...env,NODE_PATH:resolve(import.meta.dir,'../../control-plane/node_modules'),CHERT_TEST_POSTGREST_URL:`http://127.0.0.1:${port}`,CHERT_TEST_SERVICE_JWT:jwt},stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),native?50000:25000);try{const[out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({code,err}).toEqual({code:0,err:''});const result=JSON.parse(out);expect(result).toMatchObject({passed:true,actualIngest:true,realPostgREST:true,actualSignedCallback:true,nativeEffects:0,nativeWebhookWorker:native,localRelay:!native,source:bundle?'device-export':'synthetic'});return result;}finally{clearTimeout(timer)}
 }finally{if(server){const exited=new Promise(resolve=>server!.once('exit',resolve));if(server.exitCode===null){server.kill();await exited}}if(attempted)command('pg_ctl',['-D',join(dir,'cluster'),'-m','immediate','-w','-t','10','stop']);rmSync(dir,{recursive:true,force:true});}
}
test.skipIf(!pg&&!rest)('actual signed lifecycle ingest persists PostgreSQL wire before loopback callback',async()=>{expect(await run()).toMatchObject({callbacks:4,events:2,sourceRetries:2});},45000);
const bundle=process.env.CHERT_TEST_DEVICE_LIFECYCLE_BUNDLE;
test.skipIf(!bundle)('explicit read-only device export uses actual local authenticated relay and durable callback',async()=>{expect(bundle?.startsWith('/')).toBe(true);await run(bundle);},45000);

test.skipIf(!nativeClient)('isolated actual native webhook worker retries signed ingest and preserves delivered state across restart',async()=>{expect(nativeClient?.startsWith('/')).toBe(true);expect(await run(bundle,true)).toMatchObject({callbacks:4,events:2,nativeAttempts:3,nativeRestartDuplicates:0,nativeDelivered:2,nativeWebhookWorker:true,localRelay:false});},65000);
