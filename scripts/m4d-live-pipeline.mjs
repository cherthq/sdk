// Opt-in development acceptance. Importing this module never performs SSH or sends.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, openSync, writeSync, ftruncateSync, readFileSync, fstatSync, constants, closeSync, fsyncSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const approval = 'one-reviewed-blooio-production-pipeline-send';
const providers = ['blooio', 'linq', 'sendblue', 'blooio-v4', 'python', 'rust', 'cpp'];
export function providerForPlan(config) {
  const provider = providers.find(name => config?.approval === `one-reviewed-${name}-production-pipeline-send`);
  assert.ok(provider, 'explicit one-provider send plan required');
  assert.ok(config.provider === undefined || config.provider === provider, 'provider does not match approval');
  return provider;
}
export function planFromArgs(args) {
  assert.equal(args.length, 1, 'exactly one explicit one-send CLI guard required');
  const provider = providers.find(name => args[0] === `--one-reviewed-${name}-pipeline-send`);
  assert.ok(provider, 'explicit one-send CLI guard required');
  return { provider, approval: `one-reviewed-${provider}-production-pipeline-send` };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateConfig(config) {
  const provider = providerForPlan(config);
  assert.match(config.run, uuid);
  assert.match(config.from, /^\+[1-9]\d{1,14}$/); assert.match(config.to, /^\+[1-9]\d{1,14}$/);
  assert.notEqual(config.from, config.to);
  assert.equal(config.marker, `CHERT-M4D-PIPELINE-${config.run}-${provider}`);
  assert.equal(config.mode, 'bridge');
  return config;
}
export function createReceipt(path, config, claim = false) {
  validateConfig(config);
  const fd = openSync(path, claim ? constants.O_RDWR | constants.O_NOFOLLOW : 'wx', 0o600);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), 'private regular receipt required');
    const receipt = claim ? JSON.parse(readFileSync(fd, 'utf8')) : {
      scope: 'real SDK/local HTTP/Chert route/sendFollowUp/mini-server; substituted auth/database/SSH network broker',
      run: config.run, marker: config.marker, provider: providerForPlan(config), from_suffix: config.from.slice(-4), to_suffix: config.to.slice(-4),
      native_sms_disabled: 'explicit test-network guard only', attempted: false, passed: false,
    };
    assert.equal(receipt.run, config.run); assert.equal(receipt.marker, config.marker);
    assert.equal(receipt.provider ?? 'blooio', providerForPlan(config), 'receipt provider mismatch');
    assert.equal(receipt.attempted, false, 'spent receipt cannot be replayed');
    function save(update) {
      Object.assign(receipt, update);
      const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
      writeSync(fd, bytes, 0, bytes.length, 0); ftruncateSync(fd, bytes.length); fsyncSync(fd);
    }
    save({});
    return { path, receipt, save, close: () => closeSync(fd) };
  } catch (error) { closeSync(fd); throw error; }
}
export function nativeEvidence(result) {
  const native = result?.body;
  const evidence = { http_status: Number.isInteger(result?.status) ? result.status : null };
  if (!native || typeof native !== 'object' || Array.isArray(native)) return evidence;
  if (typeof native.message_id === 'string' && /^msg_[A-Za-z0-9]+$/.test(native.message_id)) evidence.message_id = native.message_id;
  if (typeof native.guid === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(native.guid)) evidence.guid = native.guid;
  if (['sent', 'pending', 'queued', 'failed'].includes(native.status)) evidence.status = native.status;
  if (['native', 'none'].includes(native.fallback_owner)) evidence.fallback_owner = native.fallback_owner;
  for (const key of ['success', 'queued', 'delivered']) if (typeof native[key] === 'boolean') evidence[key] = native[key];
  if (typeof native.service === 'string' && ['imessage', 'sms', 'rcs'].includes(native.service.toLowerCase())) evidence.service = native.service.toLowerCase();
  if (Number.isInteger(native.error_code)) evidence.error_code = native.error_code;
  if (native.delivery && typeof native.delivery === 'object') {
    evidence.delivery = {};
    for (const key of ['isSent', 'isDelivered']) if (typeof native.delivery[key] === 'boolean') evidence.delivery[key] = native.delivery[key];
    if (Number.isInteger(native.delivery.error)) evidence.delivery.error = native.delivery.error;
  }
  return evidence;
}
export function observationEvidence(value) {
  const result = { complete: value?.complete === true };
  if (/^[A-Za-z0-9_-]{1,160}$/.test(value?.guid ?? '')) result.guid = value.guid;
  if (/^msg_[A-Za-z0-9]+$/.test(value?.exact_outbox_id ?? '')) result.exact_outbox_id = value.exact_outbox_id;
  if (value?.service === 'iMessage') result.service = 'iMessage';
  if (value?.is_from_me === false) result.is_from_me = false;
  if (['missing-explicit-state-db', 'exact-outbox-guid-unavailable', 'exact-guid-observation-unavailable', 'observation-unavailable-no-resend', 'no-valid-native-id'].includes(value?.reason)) result.reason = value.reason;
  return result;
}
export function assertLocalFixtureRequest(input, init, origin, routePath) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.ok(origin, 'local fixture server is not assigned');
  assert.equal(url.origin, origin, 'only the exact local fixture origin is permitted');
  assert.equal(url.pathname, routePath, 'only the reviewed fixture route is permitted');
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.equal(url.username, ''); assert.equal(url.password, '');
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  assert.equal(method.toUpperCase(), 'POST', 'only the reviewed fixture POST is permitted');
}
export function createBroker(config, journal, execute) {
  validateConfig(config);
  let spent = journal.receipt.attempted === true;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://device.invalid'); assert.equal(url.pathname, '/send'); assert.equal(url.search, '');
    assert.equal(request.method, 'POST'); assert.equal(request.headers.get('authorization'), 'Bearer fixture-device-key');
    const body = await request.json();
    assert.deepEqual(Object.keys(body).sort(), ['idempotency_key', 'message', 'to']);
    assert.equal(body.to, config.to); assert.equal(body.message, config.marker);
    assert.match(body.idempotency_key, /^followup:chat-a:[0-9a-f]{16}:bubble-0$/);
    assert.equal(spent, false, 'attempt already spent; reconcile, never resend');
    spent = true;
    const attempt = openSync(`${journal.path}.attempt`, 'wx', 0o600);
    try { fsyncSync(attempt); } finally { closeSync(attempt); }
    journal.save({ attempted: true, native_idempotency_key: body.idempotency_key, outcome: 'attempt-spent-before-SSH' });
    try {
      // Preserve the actual pipeline payload/key; this safety flag is added only at the explicit test network boundary.
      const result = await execute({ action: 'send', provider: providerForPlan(config), from: config.from, to: config.to, marker: config.marker,
        body: { ...body, native_sms_disabled: true } });
      journal.save({ native: nativeEvidence(result), outcome: 'native-response-recorded' });
      return Response.json(result.body, { status: result.status });
    } catch {
      journal.save({ outcome: 'unknown-no-resend' });
      throw new Error('Native attempt outcome unknown; reconcile without resend');
    }
  };
}

const program = String.raw`
import base64,json,os,re,sqlite3,time,urllib.request,urllib.error
p=json.loads(base64.b64decode('PAYLOAD'))
def env(path):
    result={}
    for line in open(path):
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1);result[k.strip()]=v.strip().strip('"').strip("'")
    return result
cfg=env('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env')
recipient=env('/Users/meganavery/imessage-server/mac-server/.env')
assert cfg.get('PORT','4010')=='4010','unexpected approved port'
key=cfg.get('API_KEY');assert key,'missing sender key'
from_phone=cfg.get('PHONE_NUMBER','');to_phone=recipient.get('PHONE_NUMBER','')
assert re.fullmatch(r'\+[1-9]\d{1,14}',from_phone) and re.fullmatch(r'\+[1-9]\d{1,14}',to_phone) and from_phone!=to_phone,'invalid approved accounts'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
def request(path,body=None):
    req=urllib.request.Request('http://127.0.0.1:4010'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='GET' if body is None else 'POST')
    try:
        with opener.open(req,timeout=20) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
def preflight():
    hc,h=request('/health');sc,s=request('/status');wc,w=request('/api/v1/whoami')
    assert hc==200 and h.get('status')=='healthy' and sc==200 and s.get('sender')=='bridge' and wc==200,'sender not healthy bridge'
    assert s.get('phoneNumber')==from_phone,'sender account mismatch'
    return {'from':from_phone,'to':to_phone,'mode':'bridge','version':w.get('version')}
action=p['action']
if action=='preflight':print(json.dumps(preflight()))
elif action=='send':
    preflight()
    assert p['from']==from_phone and p['to']==to_phone,'account changed'
    provider=p['provider'];assert provider in ['blooio','linq','sendblue','blooio-v4','python','rust','cpp'],'invalid provider'
    assert re.fullmatch(r'CHERT-M4D-PIPELINE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-'+re.escape(provider),p['marker']),'invalid provider-bound marker'
    b=p['body'];assert set(b)=={'to','message','idempotency_key','native_sms_disabled'},'unexpected fields'
    assert b['to']==to_phone and b['message']==p['marker'] and b['native_sms_disabled'] is True,'unsafe payload'
    assert re.fullmatch(r'followup:chat-a:[0-9a-f]{16}:bubble-0',b['idempotency_key']),'invalid generated key'
    status,body=request('/send',b)
    print(json.dumps({'status':status,'body':body}))
elif action=='observe':
    assert p['from']==from_phone and p['to']==to_phone,'account changed'
    mid=p['message_id'];assert re.fullmatch(r'msg_[A-Za-z0-9]+',mid),'invalid exact outbox ID'
    path=cfg.get('STATE_DB_PATH','')
    if not path or not os.path.isabs(path):
        print(json.dumps({'complete':False,'reason':'missing-explicit-state-db'}))
    else:
        try:
            from urllib.parse import quote
            db=sqlite3.connect('file:'+quote(path,safe='/')+'?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
            deadline=time.monotonic()+40;guid=None
            while time.monotonic()<deadline:
                row=db.execute('SELECT guid,idempotency_key,recipient FROM outbox WHERE id=?',(mid,)).fetchone()
                if row:
                    assert row[1]==p['idempotency_key'] and row[2]==to_phone,'outbox identity mismatch'
                    if row[0]:guid=row[0];break
                time.sleep(1)
            db.close()
            if not guid:print(json.dumps({'complete':False,'reason':'exact-outbox-guid-unavailable'}))
            else:
                if p.get('guid'):assert p['guid']==guid,'native response GUID mismatch'
                recipient_db=sqlite3.connect('file:/Users/meganavery/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);recipient_db.execute('PRAGMA query_only=ON')
                deadline=time.monotonic()+40;found=False
                while time.monotonic()<deadline:
                    rows=recipient_db.execute('SELECT m.guid,m.is_from_me,m.service,h.id,m.text,m.attributedBody FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id WHERE m.guid=? LIMIT 2',(guid,)).fetchall()
                    if len(rows)==1:
                        r=rows[0];blob=bytes(r[5] or b'');marker=p['marker']
                        found=r[0]==guid and r[1]==0 and r[2]=='iMessage' and re.sub(r'\D','',r[3] or '')==re.sub(r'\D','',from_phone) and (r[4]==marker or marker.encode() in blob or marker.encode('utf-16le') in blob)
                        if found:break
                    time.sleep(1)
                recipient_db.close()
                print(json.dumps({'complete':bool(found),'guid':guid,'service':'iMessage' if found else None,'exact_outbox_id':mid,'is_from_me':False if found else None}))
        except Exception:print(json.dumps({'complete':False,'reason':'exact-guid-observation-unavailable'}))
else:raise RuntimeError('unsupported action')
`;
export function remote(payload, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'chert-m4d', 'sudo', '-n', 'python3', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let size = 0;
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => { output += chunk; size += chunk.length; if (size > 65536) child.kill(); });
    child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) child.kill(); }); // Never log remote secrets/errors.
    child.on('error', () => { clearTimeout(timer); reject(new Error('SSH unavailable; no retry')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Remote evidence unavailable; no retry'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid remote evidence; no retry')); }
    });
    child.stdin.end(program.replace('PAYLOAD', Buffer.from(JSON.stringify(payload)).toString('base64')));
  });
}
if (import.meta.main) {
  const plan = planFromArgs(process.argv.slice(2));
  const metadata = await remote({ action: 'preflight' });
  const run = randomUUID();
  const config = validateConfig({ ...metadata, ...plan, run, marker: `CHERT-M4D-PIPELINE-${run}-${plan.provider}` });
  const directory = mkdtempSync(join(tmpdir(), 'chert-live-pipeline-'));
  const receipt = join(directory, 'receipt.json');
  createReceipt(receipt, config).close();
  console.log(JSON.stringify({ receipt, provider: plan.provider, scope: 'one reviewed provider real-pipeline send; never rerun on uncertainty' }));
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('../tests/m4d-live-pipeline.fixture.mjs', import.meta.url)), '--reviewed-m4d-pipeline-child'], {
    env: { ...process.env, CHERT_PIPELINE_CONFIG: JSON.stringify(config), CHERT_PIPELINE_RECEIPT: receipt,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) }, stdout: 'inherit', stderr: 'inherit',
  });
  process.exitCode = await child.exited;
}
