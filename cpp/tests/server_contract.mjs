// Optional source contract gate. Real routes/auth/schema/HTTP/crypto/BYOR parser;
// only credential database and call storage are substituted. No live network.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHmac} from 'node:crypto';
import {plugin} from 'bun';
import {mock} from 'bun:test';

const [source, executable] = process.argv.slice(2);
assert.ok(source && executable, 'Pass control-plane source directory and compiled fixture');
const lib = resolve(source, 'src/lib/facetime');
await plugin({name:'facetime-sdk-contract', setup(build) {
  build.onResolve({filter:/^@\//}, ({path}) => ({path:resolve(source, 'src', path.slice(2) + '.ts')}));
}});
mock.module(resolve(source, 'node_modules/server-only/index.js'), () => ({}));
mock.module(resolve(lib, 'env.ts'), () => ({getServerEnv:() => ({FACETIME_CREDENTIAL_PEPPER:'fixture-pepper'})}));
mock.module(resolve(lib, 'supabase.ts'), () => ({userClient:() => {throw Error('No user-session network allowed');}}));
mock.module(resolve(lib, 'cli-login.ts'), () => ({cliOperationAllowed:() => false}));
const {ControlPlaneError} = await import(resolve(lib, 'errors.ts'));
const project = '11111111-1111-4111-8111-111111111111';
const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const calls = [];
let reads = 0, writes = 0, auth = 0, http = 0;
const snapshot = {id, project_id:project, direction:'outbound', mode:'managed', status:'queued',
  media:{audio:true,video:false}, line_id:null, worker_id:null, assistant_id:project, terminal_reason:null};
const data = {
  listCalls:async (limit,offset) => {reads++; assert.equal(limit,3); assert.equal(offset,8); return {items:[snapshot],total:9,limit,offset};},
  getCall:async call => {reads++; assert.equal(call,id); return snapshot;},
  createCall:async (input,key) => {writes++; assert.equal(key,'contract-key'); assert.equal(input.destination,'+15550000002');
    assert.equal(input.mode,'managed'); assert.equal(input.assistant_id,project); assert.equal(input.authorized_test_call,false);
    calls.push(input); return snapshot;},
  enqueueCallAction:async (call,action,key) => {writes++; assert.equal(call,id); assert.equal(action,'end'); assert.equal(key,'end:contract-end'); return snapshot;},
  getExistingByorCall:async () => null,
  createByorCall:async () => {throw Error('Invalid BYOR credential must never allocate');},
};
const hash = token => createHmac('sha256','fixture-pepper').update(token).digest('hex');
const forbidden = () => {throw Error('Unexpected authentication lane');};
mock.module(resolve(lib, 'data-access.ts'), () => ({
  authenticateProjectAPIKey:async (p, hashed, scope) => {
    auth++; assert.equal(p,project);
    if (hashed === hash('ftk_wrong')) throw new ControlPlaneError('unauthorized','denied',401);
    if (hashed === hash('ftk_readonly')) {assert.equal(scope,'facetime:write'); throw new ControlPlaneError('forbidden','denied',403);}
    assert.equal(hashed, hash('ftk_fixture'));
    return {projectId:p, scopes:new Set(['facetime:read','facetime:write'])};
  },
  projectData:p => {assert.equal(p,project); return data;},
  authenticateProjectCLICredential:forbidden, authenticateProjectMembership:forbidden,
  authenticateWorkerCredential:forbidden, workerData:forbidden,
}));
// Block accidental external calls even if a future route changes.
globalThis.fetch = () => {throw Error('No outbound fetch allowed');};
process.env.FACETIME_OUTBOUND_AUDIO_ENABLED = '1';
process.env.FACETIME_REVOKED_DEMO_TOKENS_JSON = '[]';
const routes = await import(resolve(source, 'app/api/v1/calls/route.ts'));
const detail = await import(resolve(source, 'app/api/v1/calls/[callId]/route.ts'));
const end = await import(resolve(source, 'app/api/v1/calls/[callId]/end/route.ts'));
const server = Bun.serve({hostname:'127.0.0.1',port:0, async fetch(request) {
  http++;
  assert.equal(request.headers.get('x-chert-tenant'), null);
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/calls') return routes[request.method](request);
  if (path === `/api/v1/calls/${id}`) return detail.GET(request,{params:Promise.resolve({callId:id})});
  if (path === `/api/v1/calls/${id}/end`) return end.POST(request,{params:Promise.resolve({callId:id})});
  throw Error('Unexpected route');
}});
try {
  const child = Bun.spawn([executable, server.url.origin], {stdout:'inherit',stderr:'inherit'});
  const timer = setTimeout(() => child.kill(),20000);
  try { assert.equal(await child.exited,0); } finally {clearTimeout(timer);}
  assert.deepEqual({http,auth,reads,writes,calls:calls.length},{http:7,auth:7,reads:2,writes:2,calls:1});
  console.log('7 real-route HTTP requests; database substituted; no devices, live credentials or external fetch');
} finally {await server.stop(true);}
