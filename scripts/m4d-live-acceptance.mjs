// Development acceptance only. Credentials are read and used on M4D, never copied here.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HOST = 'chert-m4d';
const remoteProgram = String.raw`
import base64,json,os,re,sqlite3,time,urllib.request,urllib.error
payload=json.loads(base64.b64decode("PAYLOAD"))
def env(path):
    result={}
    for line in open(path):
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1); result[k.strip()]=v.strip().strip('"').strip("'")
    return result
sender=env('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env')
recipient=env('/Users/meganavery/imessage-server/mac-server/.env')
assert sender.get('PORT','4010')=='4010','unexpected approved sender port'
key=sender.get('API_KEY'); assert key,'missing approved sender key'
from_phone=sender.get('PHONE_NUMBER',''); to_phone=recipient.get('PHONE_NUMBER','')
assert re.fullmatch(r'\+[1-9]\d{1,14}',from_phone) and re.fullmatch(r'\+[1-9]\d{1,14}',to_phone),'account phones not canonical E.164'
assert from_phone!=to_phone,'sender and recipient must differ'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
def request(path,body=None):
    req=urllib.request.Request('http://127.0.0.1:4010'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with opener.open(req,timeout=20) as response: return response.status,json.load(response)
    except urllib.error.HTTPError as error: return error.code,json.load(error)
action=payload['action']
if action=='preflight':
    _,health=request('/health'); _,status=request('/status'); _,who=request('/api/v1/whoami')
    assert health.get('status')=='healthy','sender health is not healthy'
    assert status.get('sender')=='bridge','sender is not in the approved bridge mode'
    assert status.get('phoneNumber')==from_phone,'running sender and approved config disagree'
    print(json.dumps({'from':from_phone,'to':to_phone,'version':who.get('version'),'mode':status.get('sender')}))
elif action=='send':
    assert payload['from']==from_phone and payload['to']==to_phone,'account configuration changed'
    marker=payload['marker']; assert re.fullmatch(r'CHERT-M4D-[0-9a-f-]+-(sendblue|linq|blooio|blooio-v4)',marker),'invalid acceptance marker'
    code,result=request('/api/v1/send',{'phone':to_phone,'body':marker,'idempotency_key':marker,'native_sms_disabled':True})
    allowed=['message_id','guid','status','queued','success','delivered','delivery','service','error_code']
    print(json.dumps({'http_status':code,'native':{k:result[k] for k in allowed if k in result}}))
elif action=='observe':
    markers=payload['markers']; assert 1<=len(markers)<=3 and len(set(markers))==len(markers),'expected bounded unique markers'
    db=sqlite3.connect('file:/Users/meganavery/Library/Messages/chat.db?mode=ro',uri=True,timeout=2)
    db.execute('PRAGMA query_only=ON'); deadline=time.monotonic()+45; found={}
    while time.monotonic()<deadline:
        for marker in markers:
            if marker in found: continue
            rows=db.execute('SELECT m.ROWID,m.guid,m.is_from_me,m.service,h.id FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id WHERE m.is_from_me=0 AND (m.text=? OR instr(m.attributedBody,?)>0 OR instr(m.attributedBody,?)>0) ORDER BY m.ROWID DESC LIMIT 5',(marker,marker.encode(),marker.encode('utf-16le'))).fetchall()
            for row in rows:
                if row[3]=='iMessage' and re.sub(r'\D','',row[4] or '')==re.sub(r'\D','',from_phone):
                    found[marker]={'rowid':row[0],'guid':row[1],'is_from_me':row[2],'service':row[3],'sender_suffix':from_phone[-4:]}; break
        if len(found)==len(markers): break
        time.sleep(1)
    print(json.dumps({'observed':found,'complete':len(found)==len(markers)}))
else: raise RuntimeError('unsupported action')
`;

function remote(payload, timeout = 30000) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'sudo', '-n', 'python3', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 65536) child.kill(); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 65536) child.kill(); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`M4D ${payload.action} failed; no automatic resend (${code ?? 'timeout'})`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('M4D returned invalid evidence; no automatic resend')); }
    });
    child.stdin.end(remoteProgram.replace('PAYLOAD', encoded));
  });
}

export function parseLiveConfig(value) {
  assert.ok(['three-reviewed-imessage-only-sends', 'one-reviewed-v4-imessage-only-send'].includes(value?.approval), 'explicit reviewed send plan is required');
  assert.match(value.from, /^\+[1-9]\d{1,14}$/); assert.match(value.to, /^\+[1-9]\d{1,14}$/);
  assert.notEqual(value.from, value.to, 'sender and recipient must differ');
  assert.match(value.run, /^[0-9a-f-]+$/);
  return value;
}
export function adapterPlan(config) {
  parseLiveConfig(config);
  return config.approval === 'one-reviewed-v4-imessage-only-send' ? ['blooio-v4'] : ['sendblue', 'linq', 'blooio'];
}
const sent = new Set();
const evidence = [];
export async function dispatchM4D(args, config) {
  parseLiveConfig(config);
  const prefix = `CHERT-M4D-${config.run}-`;
  const adapter = args.message.startsWith(prefix) ? args.message.slice(prefix.length) : '';
  const plan = adapterPlan(config);
  assert.ok(plan.includes(adapter), 'only a reviewed synthetic adapter marker can be sent');
  assert.ok(!sent.has(adapter) && sent.size < plan.length, 'a send cannot be repeated');
  sent.add(adapter); // Spend the attempt before SSH; uncertainty never authorizes another send.
  const result = await remote({ action: 'send', from: config.from, to: config.to, marker: args.message });
  const native = result.native;
  evidence.push({ adapter, marker: args.message, ...result });
  const queued = native.status === 'queued' || native.status === 'pending' || native.queued === true;
  const accepted = result.http_status >= 200 && result.http_status < 300 && typeof native.message_id === 'string' && native.message_id.length > 0 && (queued || native.status === 'sent');
  if (!accepted) return { ok: false, status: 502, body: { error: 'Native outcome not confirmed; do not resend', errorEnvelope: { code: 4103, message: 'Native outcome not confirmed; do not resend', retryable: false } } };
  return { ok: true, status: result.http_status, body: { success: true, phoneLineId: args.phoneLineId }, nativeSend: {
    mac_native_outbox_ids: [native.message_id], pending: queued,
    nativeService: typeof native.service === 'string' ? native.service : 'unknown',
    nativeDelivered: native.delivered === true || native.delivery?.isDelivered === true,
  } };
}
export async function runLiveAdapters({ Sendblue, Linq, Blooio, createBlooioV4Fetch, chert }, config) {
  const results = [];
  const plan = adapterPlan(config);
  for (const adapter of plan) {
    const marker = `CHERT-M4D-${config.run}-${adapter}`;
    try {
      let response;
      if (adapter === 'sendblue') response = await new Sendblue({ chert }).messages.send({ from_number: config.from, number: config.to, content: marker });
      else if (adapter === 'linq') response = await new Linq({ chert }).chats.messages.send('chat-a', { message: { parts: [{ type: 'text', value: marker }] } });
      else if (adapter === 'blooio') response = await new Blooio({ chert }).messages.send({ to: config.to, text: marker });
      else {
        const result = await createBlooioV4Fetch({ chert })('https://api.blooio.com/v4/messages', {
          method: 'POST', body: JSON.stringify({ from: config.from, to: config.to, text: marker }),
        });
        if (result.status !== 201) throw Object.assign(new Error('v4 outcome unconfirmed'), { status: result.status });
        response = { http_status: result.status, ...await result.json() };
      }
      results.push({ adapter, response });
    } catch (error) {
      results.push({ adapter, outcome: 'unconfirmed', status: typeof error.status === 'number' ? error.status : null });
      break; // Reconcile the attempted send rather than proceeding after uncertainty.
    }
  }
  const attemptedMarkers = [...sent].map(name => `CHERT-M4D-${config.run}-${name}`);
  let receipt = { complete: false, observed: {} };
  if (attemptedMarkers.length) {
    try { receipt = await remote({ action: 'observe', markers: attemptedMarkers }, 55000); }
    catch { receipt = { complete: false, observed: {}, error: 'Recipient evidence unavailable; reconcile before any rerun' }; }
  }
  return { scope: 'actual adapters, local real cloud-route code, M4D native transport and recipient database', production_auth_database: 'mocked', sender: { version: config.version, mode: config.mode, from_suffix: config.from.slice(-4), to_suffix: config.to.slice(-4) }, run: config.run, attempts: sent.size, results, native: evidence, recipient: receipt, passed: sent.size === plan.length && results.length === plan.length && results.every(result => !result.outcome) && receipt.complete === true };
}

if (import.meta.main) {
  if (process.argv.length !== 3 || !['--live', '--live-v4'].includes(process.argv[2])) throw new Error('Explicit --live (three sends) or --live-v4 (one v4 send) is required');
  const metadata = await remote({ action: 'preflight' });
  const config = parseLiveConfig({ approval: process.argv[2] === '--live-v4' ? 'one-reviewed-v4-imessage-only-send' : 'three-reviewed-imessage-only-sends', from: metadata.from, to: metadata.to, version: metadata.version, mode: metadata.mode, run: randomUUID() });
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('../tests/route-http.fixture.mjs', import.meta.url)), '--live-reviewed-fixture'], {
    env: { ...process.env, CHERT_M4D_LIVE_CONFIG: JSON.stringify(config), NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) }, stdout: 'inherit', stderr: 'inherit',
  });
  process.exitCode = await child.exited;
}
