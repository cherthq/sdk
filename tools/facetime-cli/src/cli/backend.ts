import { existsSync, closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { scopeSchema, sameScope } from '../protocol/v1.js';
import { boundedText, hostedOrigin } from '../transport/http.js';
import { hostedSchema, saveConfig, modeOf, isByor, type Config } from './config.js';
import { CLIError } from './errors.js';
const uuid=z.string().uuid();
export async function backendCommand(command:string,values:Record<string,string>,config:Config,env:NodeJS.ProcessEnv):Promise<Record<string,unknown>> {
  const origin=hostedOrigin(values.backend ?? (config.transport.mode==='hosted-v1' ? config.transport.control_origin : ''));
  const token=env.CHERT_USER_ACCESS_TOKEN;
  if(!token || /[\r\n]/.test(token)) throw new CLIError('user_session_required',3,'Sign in to Chert and inject the Supabase user access token as CHERT_USER_ACCESS_TOKEN. Connector administration requires owner/admin membership.');
  const project=values.project ?? (config.transport.mode==='hosted-v1' ? config.transport.scope.project_id : undefined);
  if(command!=='projects' && !uuid.safeParse(project).success) throw new CLIError('project_selection_required',2,'List projects, then supply the exact --project UUID.');
  async function request(path:string,input?:unknown) {
    const response=await fetch(new URL(path,origin),{method:input ? 'POST' : 'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(project ? {'x-chert-project-id':project} : {})},...(input ? {body:JSON.stringify(input)} : {})});
    if(!response.ok) { await response.body?.cancel(); throw new CLIError('backend_request_rejected',6,'Verify user membership, exact line/cardinality and expected activation state. No automatic retry or activation occurs.'); }
    return (JSON.parse(await boundedText(response)) as {data:unknown}).data;
  }
  if(command==='projects') return {code:'projects',projects:await request('/api/v1/projects')};
  if(command==='lines') return {code:'lines',project_id:project,lines:await request('/api/v1/lines?limit=100')};
  if(command==='bindings') return {code:'bindings',project_id:project,bindings:await request('/api/v1/connectors')};
  if(command==='enroll') {
    const line=uuid.safeParse(values.line);
    if(!line.success || !values['output-config'] || !values['credentials-file'] || !values['relay-origin']) throw new CLIError('enrollment_inputs_required',2,'Confirm --line UUID, --relay-origin HTTPS_ORIGIN, --output-config NEW_PATH and --credentials-file NEW_PATH. Existing config is preserved.');
    const output=resolve(values['output-config']),file=resolve(values['credentials-file']);
    if(existsSync(output) || existsSync(file) || output===file) throw new CLIError('enrollment_output_exists',4,'Choose separate new config and protected credential paths.');
    const relay=hostedOrigin(values['relay-origin']).origin;
    const result=z.object({scope:scopeSchema,state:z.literal('standby'),credentials:z.strictObject({connection:z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/),recovery:z.string().regex(/^ftc_[A-Za-z0-9_-]{43}$/)})}).parse(await request('/api/v1/connectors',{action:'enroll',line_id:line.data,name:isByor(config) ? config.handler.id : config.agent.deployment,environment:values.environment ?? 'production',...(config.schema_version === 2 ? {session_mode:modeOf(config)} : {})}));
    if(result.scope.project_id!==project || result.scope.line_id!==line.data || (isByor(config) ? result.scope.session_mode!=='byor' : result.scope.session_mode==='byor')) throw new CLIError('binding_mismatch',6,'The returned binding does not match the confirmed project and line.');
    const transport=hostedSchema.parse({mode:'hosted-v1',control_origin:origin.origin,relay_origin:relay,reconcile_origin:relay,scope:result.scope,credential_env:'CHERT_CONNECTOR_TOKEN',recovery_env:'CHERT_RECOVERY_TOKEN',credentials_file:file});
    const fd=openSync(file,'wx',0o600);
    try {writeFileSync(fd,JSON.stringify(result.credentials)+'\n');fsyncSync(fd);} finally {closeSync(fd);}
    saveConfig(output,{...config,transport});
    return {code:'enrolled',scope:result.scope,activation:'standby',config:output,action:'Start the connector, verify health/connectivity, then explicitly activate using the observed line generation and previous binding.'};
  }
  const binding=values.binding ?? (config.transport.mode==='hosted-v1' ? config.transport.scope.binding_id : undefined);
  if(!uuid.safeParse(binding).success) throw new CLIError('binding_required',2,'Supply the exact --binding UUID or enrolled config.');
  let input:Record<string,unknown>={action:command,binding_id:binding};
  if(command==='activate') {
    const expected=values['expected-binding']; const generation=Number(values['assignment-generation']);
    if((expected!=='none' && !uuid.safeParse(expected).success) || !Number.isSafeInteger(generation) || generation<1) throw new CLIError('activation_confirmation_required',2,'Supply --expected-binding none|UUID and --assignment-generation INTEGER from a fresh line/binding inspection.');
    input={...input,expected_binding_id:expected==='none' ? null : expected,assignment_generation:generation};
  }
  return {code:`connector_${command}`,binding:await request('/api/v1/connectors',input)};
}
export async function inspectHosted(config:Config,env:NodeJS.ProcessEnv):Promise<unknown> {
  if(config.transport.mode!=='hosted-v1') return {status:'unverified'};
  try {
    const response=await fetch(new URL('/inspect',hostedOrigin(config.transport.relay_origin)),{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{authorization:`Bearer ${env[config.transport.credential_env]}`,'content-type':'application/json'},body:'{}'});
    if(!response.ok) {await response.body?.cancel();return {status:response.status===401 || response.status===403 ? 'unauthorized' : 'unavailable'};}
    const data=z.object({scope:scopeSchema,state:z.enum(['standby','active','draining','revoked']),connected:z.boolean(),recovery_only:z.boolean()}).strict().parse(JSON.parse(await boundedText(response)));
    if(!sameScope(data.scope,config.transport.scope,false)) return {status:'binding_mismatch'};
    return {status:'authorized',...data};
  } catch {return {status:'unavailable'};}
}
