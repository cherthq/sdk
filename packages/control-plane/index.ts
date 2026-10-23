/** Thin client for the inspected Chert FaceTime control-plane routes. No retries or provisioning fiction. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface ClientOptions { baseUrl?:string; token?:string; projectId?:string; fetch?:typeof globalThis.fetch }
export interface PageOptions { limit?:number; offset?:number }
export interface Page<T> {items:T[];total:number;limit:number;offset:number}
export interface DeviceLoginStart {device_code:string;user_code:string;verification_url:string;verification_url_complete:string;expires_in:number;interval:number}
export type LoginResult = {status:'pending'} | {status:'approved';access_token:string;email:string|null;project:{id:string;name:string|null};device_name:string;expires_in:number};
export interface Identity {email:string|null;project:{id:string;name:string|null};role:string;device_name?:string;expires_at?:string}
export interface Line {id:string;line_key:string;display_name:string;status:string;worker_id:string|null;masked_identity?:string|null;supports_audio?:boolean;supports_video?:boolean;[key:string]:unknown}
export interface Worker {id:string;worker_key:string;display_name:string;status:string;enabled:boolean;[key:string]:unknown}
export interface Credential {id:string;device_name:string;token_prefix:string;user_id:string;email:string|null;created_at:string;last_used_at:string|null;expires_at:string}
export interface ConnectorEnrollment {line_id:string;name:string;environment:'production'|'development';session_mode?:'byor'|'create-room'}
export interface ConnectorReceipt {credentials:{connection:string;recovery:string};[key:string]:unknown}
export interface BillingCatalog {version:string;test_mode:boolean;enabled:boolean;plans:{id:string;name:string;currency:string;amount:number;interval:string;available:boolean;reason:string|null;minutes_per_day:number|null}[]}
export interface Checkout {id:string;project_id:string;plan_id:string;created_at:string;state:'creating'|'open'|'complete'|'expired';stripe_session_id:string|null;checkout_url:string|null;expires_at:string|null;stripe_subscription_id:string|null}
/** Server text, bodies, URLs and credentials are deliberately not included in errors. */
export class ChertApiError extends Error {constructor(public readonly status:number,public readonly code:string){super(`Chert request failed (${status}, ${code}).`);this.name='ChertApiError';}}
const safeCodes = new Set(['unauthorized','forbidden','cli_scope_denied','billing_owner_required','billing_unavailable','project_required','invalid_request','cli_login_expired','cli_login_not_found','cli_login_forbidden','slow_down','cli_login_rate_limited','cli_login_busy','not_found','conflict']);
export class ChertControlPlane {
  private readonly origin:string; private readonly token?:string;private readonly projectId?:string;private readonly fetcher:typeof globalThis.fetch;
  constructor(options:ClientOptions={}){
    const rawURL=options.baseUrl === undefined ? 'https://facetime.trychert.com' : options.baseUrl;
    let url:URL;try{
      if(typeof rawURL!=='string'||/[\x00-\x20\x7f\\?#]/.test(rawURL)||!/^https?:\/\//i.test(rawURL)||rawURL.split('/').slice(3).join('/')!=='')throw new TypeError();
      url=new URL(rawURL);
    }catch{throw new TypeError('A valid control-plane base URL is required.');}
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new TypeError('Use an HTTPS origin or local HTTP origin without credentials, query, fragment or path.');
    if(options.token&&/[\r\n]/.test(options.token))throw new TypeError('Invalid credential.');
    this.origin=url.origin;this.token=options.token;this.projectId=options.projectId;this.fetcher=options.fetch??globalThis.fetch;
  }
  private async request<T>(path:string,method='GET',input?:unknown,auth:'public'|'user'|'project'='project',extra?:Record<string,string>):Promise<T>{
    const headers:Record<string,string>={Accept:'application/json',...extra};
    if(auth!=='public'){if(!this.token)throw new ChertApiError(401,'unauthorized');headers.Authorization=`Bearer ${this.token}`;}
    if(auth==='project'){if(!this.projectId)throw new ChertApiError(400,'project_required');headers['x-chert-project-id']=this.projectId;}
    if(input!==undefined)headers['Content-Type']='application/json';
    let response:Response;
    try{response=await this.fetcher(`${this.origin}/api/v1/${path}`,{method,headers,body:input===undefined?undefined:JSON.stringify(input),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});}catch{throw new ChertApiError(0,'network_error');}
    let envelope:unknown;
    try{
      const reader=response.body?.getReader();if(!reader)throw new Error();
      const chunks:Uint8Array[]=[];let length=0;
      while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>1_048_576){await reader.cancel();throw new Error();}chunks.push(part.value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      envelope=JSON.parse(new TextDecoder().decode(bytes));
    }catch{throw new ChertApiError(response.status,'invalid_response');}
    if(!envelope||typeof envelope!=='object')throw new ChertApiError(response.status,'invalid_response');
    if(!response.ok){const error=(envelope as {error?:unknown}).error;const code=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;throw new ChertApiError(response.status,typeof code==='string'&&safeCodes.has(code)?code:'request_failed');}
    if(!Object.hasOwn(envelope,'data'))throw new ChertApiError(response.status,'invalid_response');
    return (envelope as {data:T}).data;
  }
  beginLogin(input:{device_name:string}){return this.request<DeviceLoginStart>('cli/logins','POST',input,'public');}
  pollLogin(input:{device_code:string}){return this.request<LoginResult>('cli/logins/token','POST',input,'public');}
  inspectLogin(input:{user_code:string}){return this.request<{device_name:string;created_at:string;expires_in:number}>('cli/logins/inspect','POST',input,'user');}
  approveLogin(input:{user_code:string;project_id:string}){return this.request<{device_name:string;project_id:string}>('cli/logins/approve','POST',input,'user');}
  whoami(){return this.request<Identity>('cli/whoami');}
  logout(){return this.request<{revoked:boolean}>('cli/logout','POST',undefined,'user');}
  listCredentials(){return this.request<{credentials:Credential[]}>('cli/credentials');}
  revokeCredential(id:string){return this.request<{revoked:boolean}>(`cli/credentials/${encodeURIComponent(id)}`,'DELETE');}
  private page(path:string,options:PageOptions){const params=new URLSearchParams();for(const key of ['limit','offset'] as const){const value=options[key];if(value!==undefined){if(!Number.isInteger(value)||value<0||(key==='limit'&&(value<1||value>100)))throw new TypeError('Invalid pagination.');params.set(key,String(value));}}return `${path}${params.size?'?'+params:''}`;}
  listLines(options:PageOptions={}){return this.request<Page<Line>>(this.page('lines',options));}
  listWorkers(options:PageOptions={}){return this.request<Page<Worker>>(this.page('workers',options));}
  listConnectors(){return this.request<Json>('connectors');}
  enrollConnector(input:ConnectorEnrollment){return this.request<ConnectorReceipt>('connectors','POST',{action:'enroll',...input});}
  activateConnector(input:{binding_id:string;expected_binding_id:string|null;assignment_generation:number}){return this.request<Json>('connectors','POST',{action:'activate',...input});}
  drainConnector(binding_id:string){return this.request<Json>('connectors','POST',{action:'drain',binding_id});}
  revokeConnector(binding_id:string){return this.request<Json>('connectors','POST',{action:'revoke',binding_id});}
  billingCatalog(){return this.request<BillingCatalog>('billing/catalog','GET',undefined,'public');}
  currentCheckout(){return this.request<Checkout|null>('billing/checkout');}
  createCheckout(input:{plan_id:'shared';catalog_version:'2026-10-22'},idempotencyKey:string){if(idempotencyKey.trim().length<8||idempotencyKey.length>200||/[\r\n]/.test(idempotencyKey))throw new TypeError('Use a stable 8–200 character idempotency key.');return this.request<Checkout>('billing/checkout','POST',input,'project',{'Idempotency-Key':idempotencyKey});}
}
