/** Thin client for the inspected Chert FaceTime control-plane routes. No retries or provisioning fiction. */
import type { Assistant, Call, CallAction, CallDetail, CallEvent, CreateAssistant, CreateCall, LineUpdate, MediaReadiness, UpdateAssistant, VideoCapabilities } from './video';
export * from './video';
export { parseLivingServices, verifyLivingServiceWebhook, livingSignatureVersion, type LivingServicesCapability, type LivingInputKind, type LivingViewport, type LivingJson, type LivingServiceManifest, type LivingDeploymentStatus, type LivingDeployment, type AttachLivingService, type LivingSessionStatus, type LivingSession, type LivingInputEvent, type LivingServiceMessageWebhook } from './living';
export { COMPOSITION_MAX_LAYERS, parseVideoComposition, compositionInputTarget, type VideoCompositionCapability, type CompositionBaseKind, type CompositionBase, type CompositionRegion, type CompositionPage, type CompositionBackground, type BaseLayerInput, type PageLayerInput, type VideoLayerInput, type SetCallVideo, type PageRef, type CompositionStatus, type BaseLayer, type PageLayer, type VideoLayer, type CallVideoComposition } from './composition';
import { compositionBody, validateComposition, type CallVideoComposition, type PageRef, type SetCallVideo } from './composition';
import { validateAttach, validateEvent, validateInput, validateLivingSession, validateManifest, validateState, type AttachLivingService, type LivingDeployment, type LivingInputEvent, type LivingJson, type LivingServiceManifest, type LivingSession } from './living';
export type MediaSessionCodec = 'h264' | 'vp8';
export type MediaDirection = 'publish' | 'subscribe';
/**
 * What a session carries. Publish: `camera` (default) or `screen` (an agent's screen, capped at 15 fps).
 * Subscribe: omit for the caller's video, or `caller_screen` for the caller's shared screen (only while sharing).
 * A call has one publish slot: camera, screen and living surfaces are mutually exclusive (`media_session_conflict`).
 */
export type MediaSessionContent = 'camera' | 'screen' | 'caller_screen';
export interface CreateMediaSession { direction: MediaDirection; codecs?: MediaSessionCodec[]; content?: MediaSessionContent }
export interface MediaSessionGrant {
  session_id: string; direction: MediaDirection;
  /** The resolved content: `camera` when the request omitted it. Older backends may omit it. */
  content?: MediaSessionContent;
  /** Opaque absolute HTTPS signaling URL (WHIP for publish, experimental WHEP for subscribe). */
  endpoint: string;
  /** Session-bound bearer; never log it. */
  token: string;
  connect_by: string; expires_at: string;
  ice_servers: { urls: string | string[]; username?: string; credential?: string; credentialType?: 'password' }[];
  codecs: MediaSessionCodec[];
  limits: { max_width: number; max_height: number; max_fps: number; max_frame_bytes: number };
}
const invalidGrant = () => new ChertApiError(201, 'invalid_response');
const checkComposition = (c: CallVideoComposition) => { try { return validateComposition(c, g => validateGrant(g, 'publish', undefined, 'camera')); } catch { throw new ChertApiError(200, 'invalid_response'); } };
/** Accepts only the documented outcomes; a URL must be an HTTPS Stripe-hosted page without credentials. */
function checkBillingResult(r:BillingResult):BillingResult{
  const bad=()=>new ChertApiError(200,'invalid_response');
  if(r?.status==='active'){if(!r.entitlement||typeof r.entitlement!=='object'||!['shared','dedicated'].includes(r.entitlement.plan))throw bad();return {status:'active',entitlement:r.entitlement};}
  if(r?.status==='pending')return {status:'pending'};
  if(r?.status!=='requires_payment_method'&&r?.status!=='requires_action')throw bad();
  let url:URL;try{url=new URL(r.url);}catch{throw bad();}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='stripe.com'||url.hostname.endsWith('.stripe.com')))throw bad();
  return {status:r.status,url:url.href};
}
const checkSession = (session: LivingSession) => { try { return validateLivingSession(session); } catch { throw new ChertApiError(200, 'invalid_response'); } };
const rfc3339 = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(v) && !Number.isNaN(Date.parse(v));
const iceServer = (s: unknown): boolean => {
  if (!s || typeof s !== 'object') return false;
  const { urls, username, credential, credentialType } = s as Record<string, unknown>;
  return (typeof urls === 'string' || (Array.isArray(urls) && urls.length > 0 && urls.every(u => typeof u === 'string')))
    && (username === undefined || typeof username === 'string') && (credential === undefined || typeof credential === 'string')
    && (credentialType === undefined || credentialType === 'password');
};
function validateGrant(grant: MediaSessionGrant, direction: MediaDirection, requested?: readonly MediaSessionCodec[], content?: MediaSessionContent): MediaSessionGrant {
  const g = grant as unknown as Record<string, unknown>, limits = g?.limits as Record<string, unknown> | undefined;
  let endpoint: URL;
  try { endpoint = new URL(String(g?.endpoint)); } catch { throw invalidGrant(); }
  const local = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  const cap = direction === 'publish' ? [1920, 1080] : [1280, 720];
  const int = (v: unknown, max: number) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
  // A requested content must be echoed exactly; a default request accepts no echo or the resolved 'camera'.
  const contentOk = content ? g?.content === content : g?.content === undefined || g?.content === 'camera';
  const maxFps = (content ?? g?.content) === 'screen' ? 15 : 30;
  if (!contentOk || g?.direction !== direction || typeof g.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(g.session_id)
    || (endpoint.protocol !== 'https:' && !local) || endpoint.username || endpoint.password || endpoint.hash
    || typeof g.token !== 'string' || !g.token || /[\r\n]/.test(g.token)
    || !rfc3339(g.connect_by) || !rfc3339(g.expires_at) || Date.parse(g.connect_by) > Date.parse(g.expires_at)
    || !Array.isArray(g.ice_servers) || !g.ice_servers.every(iceServer)
    || !Array.isArray(g.codecs) || !g.codecs.length || new Set(g.codecs).size !== g.codecs.length
    || !g.codecs.every(c => (c === 'h264' || c === 'vp8') && (!requested || requested.includes(c)))
    || !limits || !int(limits.max_width, cap[0]!) || !int(limits.max_height, cap[1]!) || !int(limits.max_fps, maxFps) || !int(limits.max_frame_bytes, 8_388_608))
    throw invalidGrant();
  return grant;
}
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export interface ClientOptions { baseUrl?:string; token?:string; projectId?:string; fetch?:typeof globalThis.fetch }
export interface PageOptions { limit?:number; offset?:number }
export interface Page<T> {items:T[];total:number;limit:number;offset:number}
export interface DeviceLoginStart {device_code:string;user_code:string;verification_url:string;verification_url_complete:string;expires_in:number;interval:number}
export type LoginResult = {status:'pending'} | {status:'approved';access_token:string;email:string|null;project:{id:string;name:string|null};device_name:string;expires_in:number};
export interface Identity {email:string|null;project:{id:string;name:string|null};role:string;device_name?:string;expires_at?:string}
export interface Line extends LineUpdate {id:string;line_key:string;display_name:string;status:string;worker_id:string|null;masked_identity?:string|null;supports_audio?:boolean;supports_video?:boolean;/** Parse with parseMediaCapabilities; never infer from supports_video. */media_capabilities?:unknown;living_services?:unknown;/** Parse with parseVideoComposition. */video_composition?:unknown;[key:string]:unknown}
export interface Worker {id:string;worker_key:string;display_name:string;status:string;enabled:boolean;capabilities?:VideoCapabilities;readiness?:MediaReadiness;/** Present only on line/call-scoped projections. */media_capabilities?:unknown;living_services?:unknown;[key:string]:unknown}
export interface Credential {id:string;device_name:string;token_prefix:string;user_id:string;email:string|null;created_at:string;last_used_at:string|null;expires_at:string}
export interface ConnectorEnrollment {line_id:string;name:string;environment:'production'|'development';session_mode?:'byor'|'create-room'}
export interface ConnectorReceipt {credentials:{connection:string;recovery:string};[key:string]:unknown}
export type BillingPlan = 'shared' | 'dedicated';
export interface BillingEntitlement {plan:BillingPlan;status:string;valid_until:string;fulfillment_status:string;[key:string]:unknown}
/** Summary of the saved default card; never card numbers. */
export interface BillingPaymentMethod {brand:string;last4:string;[key:string]:unknown}
export interface BillingStatus {entitlement:BillingEntitlement|null;needs_reconciliation:boolean;sales_enabled:boolean;shared_available:boolean;dedicated_available:boolean;/** Backends that predate terminal billing omit it. */payment_method?:BillingPaymentMethod|null}
/**
 * Outcome of a terminal purchase or plan change. `active` needs nothing more. `requires_payment_method` and
 * `requires_action` carry a short-lived Stripe-hosted URL (card entry or authentication): open it, then refresh
 * `billingStatus()`. `pending` means the payment provider accepted the operation but the entitlement is not committed
 * yet: retry with the same idempotency key until `active`. Card entry is never collected by the SDK.
 */
export type BillingResult = {status:'active';entitlement:BillingEntitlement} | {status:'pending'} | {status:'requires_payment_method'|'requires_action';url:string};
export interface Checkout {url:string}
export interface CheckoutInput {plan:BillingPlan;coupon_code?:string}
export interface BillingCancellation {status:'cancellation_requested';message:string}
export interface CouponValidation {code:string;percent_off:number;mode:'live'|'test';currency:string;monthly_total?:number;due_now?:number;access_hours?:number;plans?:BillingPlan[]}
/** Server text, bodies, URLs and credentials are deliberately not included in errors. */
export class ChertApiError extends Error {constructor(public readonly status:number,public readonly code:string){super(`Chert request failed (${status}, ${code}).`);this.name='ChertApiError';}}
const safeCodes = new Set(['billing_plan_change_unavailable','living_capability_unsupported','living_surface_conflict','living_state_conflict','living_deployment_not_ready','living_input_not_allowed','living_session_not_found','media_capability_unsupported','media_session_conflict','call_not_active','call_ended','call_not_found','media_session_expired','media_transport_unavailable','unauthorized','forbidden','cli_scope_denied','billing_owner_required','billing_unavailable','billing_binding_mismatch','billing_checkout_exists','billing_coupon_unavailable','billing_dedicated_no_inventory','billing_dedicated_unqualified','billing_idempotency_conflict','billing_invalid','billing_no_subscription','billing_paid_period_required','billing_price_mismatch','billing_provider_mismatch','billing_provider_unavailable','billing_reservation_expired','billing_reservation_not_found','billing_reservation_pending','billing_sales_disabled','billing_subscription_conflict','billing_subscription_exists','billing_payment_failed','billing_plan_unchanged','billing_unconfigured','shared_no_capacity','project_required','invalid_request','cli_login_expired','cli_login_not_found','cli_login_forbidden','slow_down','cli_login_rate_limited','cli_login_busy','not_found','conflict','caller_screen_not_shared','media_content_unsupported','caller_screen_unsupported','media_limit_exceeded','video_composition_unsupported','composition_invalid','composition_revision_conflict','composition_base_unavailable']);
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
    try{response=await this.fetcher(`${this.origin}/api/v1/${path}`,{method,headers,body:input===undefined?undefined:JSON.stringify(input),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});}catch(error){
      if(error&&typeof error==='object'&&'code' in error&&error.code==='unsupported_unified_backend')throw new ChertApiError(426,'unsupported_unified_backend');
      throw new ChertApiError(0,'network_error');
    }
    let envelope:unknown;
    try{
      const reader=response.body?.getReader();if(!reader)throw new Error();
      const chunks:Uint8Array[]=[];let length=0;
      while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>1_048_576){await reader.cancel();throw new Error();}chunks.push(part.value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      envelope=JSON.parse(new TextDecoder().decode(bytes));
    }catch{
      // A non-JSON 404 means the backend does not serve this route (for example a draft surface it has not deployed).
      throw new ChertApiError(response.status,response.status===404?'endpoint_unavailable':'invalid_response');
    }
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
  updateLine(id:string,input:LineUpdate){return this.request<Line>(`lines/${this.resourceId(id)}`,'PATCH',input);}
  listCalls(options:PageOptions={}){return this.request<Page<Call>>(this.page('calls',options));}
  getCall(id:string){return this.request<CallDetail>(`calls/${this.resourceId(id)}`);}
  /**
   * Mints one WHIP (publish) or experimental WHEP (subscribe) session for an active call. v1 is video-only.
   * Treat `endpoint` as opaque; pass the result to publishWhip/receiveWhep from `@trychert/sdk/media`.
   */
  async createMediaSession(callId:string,input:CreateMediaSession):Promise<MediaSessionGrant>{
    if(!input||(input.direction!=='publish'&&input.direction!=='subscribe'))throw new TypeError('direction must be publish or subscribe.');
    if(input.codecs!==undefined&&(!Array.isArray(input.codecs)||!input.codecs.length||input.codecs.some(c=>c!=='h264'&&c!=='vp8')||new Set(input.codecs).size!==input.codecs.length))throw new TypeError('codecs must be a non-empty ordered subset of h264, vp8.');
    const content=input.content;
    if(content!==undefined&&!(input.direction==='publish'?content==='camera'||content==='screen':content==='caller_screen'))throw new TypeError('content must be camera or screen for publish, or caller_screen for subscribe.');
    const grant=await this.request<MediaSessionGrant>(`calls/${this.resourceId(callId)}/media-sessions`,'POST',{direction:input.direction,...(input.codecs?{codecs:input.codecs}:{}),...(content?{content}:{})});
    return validateGrant(grant,input.direction,input.codecs,content);
  }
  /** Registers a living service and its first immutable deployment revision. Draft backend contract. */
  createLivingService(manifest:LivingServiceManifest,idempotencyKey:string){return this.request<LivingDeployment>('living-services','POST',validateManifest(manifest),'project',this.idempotency(idempotencyKey));}
  /** Deploys a new immutable revision of an existing living service. Reuse the key when retrying. */
  deployLivingService(serviceId:string,manifest:LivingServiceManifest,idempotencyKey:string){return this.request<LivingDeployment>(`living-services/${this.resourceId(serviceId)}/deployments`,'POST',validateManifest(manifest),'project',this.idempotency(idempotencyKey));}
  getLivingDeployment(serviceId:string,deploymentId:string){return this.request<LivingDeployment>(`living-services/${this.resourceId(serviceId)}/deployments/${this.resourceId(deploymentId)}`);}
  /** Renders a ready deployment as the call's video. Voice continues on the existing call path. */
  attachLivingService(callId:string,input:AttachLivingService,idempotencyKey:string){
    const body=validateAttach(input);
    return this.request<LivingSession>(`calls/${this.resourceId(callId)}/living-sessions`,'POST',body,'project',this.idempotency(idempotencyKey)).then(checkSession);
  }
  getLivingSession(callId:string,sessionId:string){return this.request<LivingSession>(this.livingPath(callId,sessionId)).then(checkSession);}
  /** Replaces page state. Revisions must strictly increase; a stale revision rejects with living_state_conflict. */
  setLivingState(callId:string,sessionId:string,revision:number,state:LivingJson){validateState(revision,state);return this.request<{revision:number}>(`${this.livingPath(callId,sessionId)}/state`,'PUT',{revision,state});}
  sendLivingEvent(callId:string,sessionId:string,type:string,data:LivingJson=null){validateEvent(type,data);return this.request<{accepted:true}>(`${this.livingPath(callId,sessionId)}/events`,'POST',{type,data});}
  /** Optional input relay; only kinds declared in the manifest are accepted. Pointer coordinates are normalized 0..1. */
  sendLivingInput(callId:string,sessionId:string,input:LivingInputEvent){return this.request<{accepted:true}>(`${this.livingPath(callId,sessionId)}/input`,'POST',validateInput(input));}
  detachLivingService(callId:string,sessionId:string){return this.request<LivingSession>(this.livingPath(callId,sessionId),'DELETE');}
  /**
   * Sets the call's video (draft): `{ page }` makes a page the whole video; `{ layers }` composes a camera or managed
   * base with a page layer above it. Replaces the current composition, which holds the call's single publish slot.
   */
  async setCallVideo(callId:string,input:SetCallVideo,idempotencyKey:string,options:{signal?:AbortSignal;readyTimeoutMs?:number}={}):Promise<CallVideoComposition>{
    const body=compositionBody(input);const key=this.idempotency(idempotencyKey);
    const {signal,readyTimeoutMs=60_000}=options;
    if(!Number.isFinite(readyTimeoutMs)||readyTimeoutMs<=0)throw new TypeError('readyTimeoutMs must be a positive number.');
    const layers=body.layers as {id:string;page?:PageRef}[];
    // Derived per-layer keys must stay unique and within the 200-character limit.
    if(layers.some(l=>l.page&&'manifest' in l.page)&&idempotencyKey.length>160)throw new TypeError('Use an idempotency key of at most 160 characters with URL pages.');
    const aborted=()=>{if(signal?.aborted)throw new ChertApiError(0,'aborted');};
    // URL pages are deployed first (create, wait ready); the call-video resource only receives immutable deployment IDs.
    for(const layer of layers){
      if(!layer.page||!('manifest' in layer.page))continue;
      aborted();
      const deployment=await this.createLivingService(layer.page.manifest,`${idempotencyKey}:page:${layer.id}`);
      layer.page={deployment_id:(await this.readyDeployment(deployment,Date.now()+readyTimeoutMs,signal)).deployment_id};
    }
    aborted();
    return checkComposition(await this.request<CallVideoComposition>(`calls/${this.resourceId(callId)}/video`,'PUT',body,'project',key));
  }
  private async readyDeployment(deployment:LivingDeployment,deadline:number,signal?:AbortSignal){
    const valid=(d:LivingDeployment)=>{if(!d||typeof d.service_id!=='string'||!d.service_id||typeof d.deployment_id!=='string'||!d.deployment_id||!['pending','ready','failed'].includes(d.status))throw new ChertApiError(200,'invalid_response');return d;};
    deployment=valid(deployment);
    while(deployment.status!=='ready'){
      if(deployment.status==='failed'||Date.now()>=deadline)throw new ChertApiError(409,'living_deployment_not_ready');
      await new Promise<void>((resolve,reject)=>{
        if(signal?.aborted)return reject(new ChertApiError(0,'aborted'));
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},500);
        const stop=()=>{clearTimeout(timer);reject(new ChertApiError(0,'aborted'));};
        signal?.addEventListener('abort',stop,{once:true});
      });
      deployment=valid(await this.getLivingDeployment(deployment.service_id,deployment.deployment_id));
    }
    return deployment;
  }
  getCallVideo(callId:string){return this.request<CallVideoComposition>(`calls/${this.resourceId(callId)}/video`).then(checkComposition);}
  /** Stops the composition and frees the publish slot. */
  clearCallVideo(callId:string){return this.request<CallVideoComposition>(`calls/${this.resourceId(callId)}/video`,'DELETE').then(checkComposition);}
  private livingPath(callId:string,sessionId:string){return `calls/${this.resourceId(callId)}/living-sessions/${this.resourceId(sessionId)}`;}
  getCallEvents(id:string){return this.request<{call_id:string;events:CallEvent[]}>(`calls/${this.resourceId(id)}/events`);}
  /** Acceptance is not connection/media success. Reconcile uncertain outcomes; never retry automatically. */
  createCall(input:CreateCall,idempotencyKey:string){return this.request<CallDetail>('calls','POST',input,'project',this.idempotency(idempotencyKey));}
  answerCall(id:string,idempotencyKey:string,input:CallAction={}){return this.request<CallDetail>(`calls/${this.resourceId(id)}/answer`,'POST',input,'project',this.idempotency(idempotencyKey));}
  rejectCall(id:string,idempotencyKey:string,input:CallAction={}){return this.request<CallDetail>(`calls/${this.resourceId(id)}/reject`,'POST',input,'project',this.idempotency(idempotencyKey));}
  endCall(id:string,idempotencyKey:string,input:CallAction={}){return this.request<CallDetail>(`calls/${this.resourceId(id)}/end`,'POST',input,'project',this.idempotency(idempotencyKey));}
  listAssistants(options:PageOptions={}){return this.request<Page<Assistant>>(this.page('assistants',options));}
  getAssistant(id:string){return this.request<Assistant>(`assistants/${this.resourceId(id)}`);}
  createAssistant(input:CreateAssistant){return this.request<Assistant>('assistants','POST',input);}
  updateAssistant(id:string,input:UpdateAssistant){return this.request<Assistant>(`assistants/${this.resourceId(id)}`,'PATCH',input);}
  publishAssistant(id:string){return this.request<{assistant:Assistant;published_version_id:string}>(`assistants/${this.resourceId(id)}/publish`,'POST');}
  private resourceId(id:string){if(typeof id!=='string'||!id||id==='.'||id==='..')throw new TypeError('A resource ID is required.');return encodeURIComponent(id);}
  private idempotency(key:string){if(typeof key!=='string'||!/^[\x21-\x7e]{8,200}$/.test(key))throw new TypeError('Use a stable 8–200 character idempotency key.');return {'Idempotency-Key':key};}
  listConnectors(){return this.request<Json>('connectors');}
  enrollConnector(input:ConnectorEnrollment){return this.request<ConnectorReceipt>('connectors','POST',{action:'enroll',...input});}
  activateConnector(input:{binding_id:string;expected_binding_id:string|null;assignment_generation:number}){return this.request<Json>('connectors','POST',{action:'activate',...input});}
  drainConnector(binding_id:string){return this.request<Json>('connectors','POST',{action:'drain',binding_id});}
  revokeConnector(binding_id:string){return this.request<Json>('connectors','POST',{action:'revoke',binding_id});}
  /** Billing requires a signed-in user token and project membership, not a CLI/project key. */
  billingStatus(){return this.request<BillingStatus>('billing');}
  createCheckout(input:CheckoutInput,idempotencyKey:string){
    if(!input||!['shared','dedicated'].includes(input.plan))throw new TypeError('Choose a shared or dedicated billing plan.');
    return this.request<Checkout>('billing','POST',{action:'checkout',plan:input.plan,...(input.coupon_code===undefined?{}:{coupon_code:input.coupon_code})},'project',this.billingIdempotency(idempotencyKey));
  }
  /**
   * Buys a plan with the saved default card (draft backend contract). Card entry or 3DS returns a Stripe-hosted URL.
   * Refused while the project already has a live subscription; the entitlement is granted by the payment webhook.
   */
  purchase(input:{plan:BillingPlan},idempotencyKey:string){return this.billingResult('purchase',input,idempotencyKey);}
  /**
   * Unavailable: the backend fails closed with `billing_plan_change_unavailable` until a plan-change policy
   * (timing, proration, refunds, payment failure, fulfilment) exists. Kept so callers can detect that code.
   */
  changePlan(input:{plan:BillingPlan},idempotencyKey:string){return this.billingResult('change_plan',input,idempotencyKey);}
  /** Returns a Stripe-hosted page for adding or replacing the saved card (draft backend contract). */
  async paymentMethodSetup(idempotencyKey:string):Promise<{status:'requires_payment_method';url:string}>{
    const result=await this.request<BillingResult>('billing','POST',{action:'payment_method'},'project',this.billingIdempotency(idempotencyKey));
    if(result?.status!=='requires_payment_method')throw new ChertApiError(200,'invalid_response');
    return checkBillingResult(result) as {status:'requires_payment_method';url:string};
  }
  private async billingResult(action:'purchase'|'change_plan',input:{plan:BillingPlan},idempotencyKey:string):Promise<BillingResult>{
    if(!input||!['shared','dedicated'].includes(input.plan))throw new TypeError('Choose a shared or dedicated billing plan.');
    const key=this.billingIdempotency(idempotencyKey);
    return checkBillingResult(await this.request<BillingResult>('billing','POST',{action,plan:input.plan},'project',key));
  }
  cancelSubscription(idempotencyKey:string){return this.request<BillingCancellation>('billing','POST',{action:'cancel'},'project',this.billingIdempotency(idempotencyKey));}
  validateCoupon(coupon_code:string,idempotencyKey:string){return this.request<CouponValidation>('billing','POST',{action:'validate_coupon',coupon_code},'project',this.billingIdempotency(idempotencyKey));}
  private billingIdempotency(key:string){
    if(typeof key!=='string'||key.trim().length<8||key.trim().length>200||/[\r\n]/.test(key))throw new TypeError('Use a stable 8–200 character idempotency key.');
    return {'Idempotency-Key':key.trim()};
  }
}
