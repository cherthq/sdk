// Controlled exported-native-evidence reingest, not original live webhook transport.
// Import performs no device actions. The explicit live flag is mandatory.
import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeSync,
  fsyncSync,
  renameSync,
  lstatSync,
  realpathSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, basename, relative } from "node:path";
import { spawn } from "node:child_process";
import { reactionFingerprint } from "./m4d-live-reaction-acceptance.mjs";
const root = resolve(import.meta.dirname, "../..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const hex = /^[a-f0-9]{64}(?![\s\S])/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i;
const phone = /^\+[1-9][0-9]{1,14}(?![\s\S])/;
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) =>
  assert.deepEqual(Object.keys(value).sort(), expected.split(",").sort());
function privateParent(path) {
  const s = lstatSync(dirname(path));
  assert.ok(
    s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700
  );
}
function file(path, nonsecret = false) {
  assert.ok(typeof path === "string" && path.startsWith("/"));
  privateParent(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    assert.ok(
      s.isFile() &&
        s.uid === process.getuid() &&
        s.nlink === 1 &&
        s.size <= 1048576 &&
        (nonsecret ? (s.mode & 0o022) === 0 : (s.mode & 0o777) === 0o600)
    );
    const raw = readFileSync(fd);
    return {
      path: realpathSync(path),
      sha256: sha(raw),
      value: JSON.parse(raw),
    };
  } finally {
    closeSync(fd);
  }
}
function persist(path, value, create = false) {
  privateParent(path);
  const temporary = create ? path : path + ".next";
  const fd = openSync(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    const raw = Buffer.from(JSON.stringify(value));
    let n = 0;
    while (n < raw.length) n += writeSync(fd, raw, n, raw.length - n);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!create) renameSync(temporary, path);
  const parent = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
const entries = [
  "sdk/scripts/m4d-live-sendblue-reaction-acceptance.mjs",
  "sdk/scripts/m4d-live-sendblue-reaction-acceptance.d.mts",
  "sdk/tests/sendblue-reaction-postgrest.fixture.mjs",
  "sdk/tests/sendblue-reaction-postgrest.test.ts",
  "sdk/tests/sendblue-reaction-postgrest.sql",
  "sdk/tests/linq-reaction-postgrest.sql",
  "scripts/test-webhook-postgrest.sh",
  "sdk/bun.lock",
  "sdk/package.json",
  "sdk/packages/sendblue-adapter/package.json",
  "sdk/packages/sdk/package.json",
  "sdk/packages/sdk/src/index.ts",
  "sdk/packages/sdk/dist/index.js",
  "sdk/tests/next-route-platform.mjs",
  "imessage-server/app/api/imessage/inbound/route.ts",
  "imessage-server/app/api/v1/messages/[id]/route.ts",
  "imessage-server/app/api/v1/phone-numbers/route.ts",
  "imessage-server/app/api/v1/chats/[id]/messages/[messageId]/reactions/route.ts",
  "sdk/packages/sendblue-adapter/reactions.ts",
  "imessage-server/docs/migrations/23_convo-native-guid-dedup.sql",
  "imessage-server/docs/migrations/25_messaging-reaction-operations.sql",
  "imessage-server/docs/migrations/26_messaging-received-contexts.sql",
];
// Follow literal local imports of actual executed handlers; package versions are lock-bound.
function closure() {
  const found = new Set();
  function visit(path) {
    path = relative(root, resolve(root, path));
    assert.ok(!path.startsWith(".."));
    if (found.has(path)) return;
    found.add(path);
    const text = readFileSync(resolve(root, path), "utf8");
    if (!/\.(?:ts|mjs|js)$/.test(path)) return;
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g
    )) {
      const spec = match[1];
      let base;
      if (spec.startsWith("@/"))
        base = resolve(root, "imessage-server", spec.slice(2));
      else if (spec.startsWith(".")) base = resolve(root, dirname(path), spec);
      else continue;
      const candidate = [
        base,
        base.replace(/\.js$/, ".ts"),
        base + ".ts",
        base + ".mjs",
        base + ".js",
        base + "/index.ts",
      ].find((v) => {
        try {
          return lstatSync(v).isFile();
        } catch {
          return false;
        }
      });
      assert.ok(
        candidate,
        "Unresolved local source dependency: " + path + " " + spec
      );
      visit(candidate);
    }
  }
  for (const path of entries) visit(path);
  return [...found]
    .sort()
    .map((path) => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
}
// Exact R2 build recipe: mac-server src .m/.h plus the reviewed explicit extras.
// native/worker paths are repository-relative; all other manifest paths are mac-server-relative.
function verifyNativeInputs(manifest) {
  const macRoot = resolve(root, "imessage-server/mac-server");
  const paths = [
    "Makefile",
    "entitlements.plist",
    "native/worker/MessagesEntry.h",
    "native/worker/MessagesEntry.mm",
    "native/worker/Probe.h",
    "native/worker/Probe.mm",
    "native/worker/main.mm",
    "tools/received-event-export/ReceivedEventExport.m",
  ];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), "Native source symlink refused");
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile() && /\.(m|h)$/.test(entry.name))
        paths.push(relative(macRoot, path));
    }
  }
  scan(resolve(macRoot, "src"));
  assert.ok(record(manifest.native_inputs));
  assert.deepEqual(
    Object.keys(manifest.native_inputs).sort(),
    paths.sort(),
    "Native source set changed"
  );
  const actual = Object.fromEntries(
    paths.map((path) => {
      const local = resolve(path.startsWith("native/") ? root : macRoot, path);
      assert.ok(
        lstatSync(local).isFile() && !lstatSync(local).isSymbolicLink()
      );
      return [path, sha(readFileSync(local))];
    })
  );
  assert.deepEqual(
    manifest.native_inputs,
    actual,
    "Native source hashes changed"
  );
  // Matches Python json.dumps(inputs, sort_keys=True, separators=(',',':')).
  assert.equal(
    manifest.native_inputs_sha256,
    sha(JSON.stringify(actual)),
    "Native source aggregate changed"
  );
}
/** Root-collected receipt wraps the actual exporter document, without synthesizing proof. */
export function prepareSendblueReactionPlan(
  manifestPath,
  installationPath,
  receivedExportPath,
  run = randomUUID()
) {
  assert.match(
    run,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/
  );
  const manifest = file(manifestPath, true),
    installed = file(installationPath),
    received = file(receivedExportPath),
    m = manifest.value,
    b = installed.value,
    x = received.value;
  keys(
    b,
    "kind,version,entry,revision,host,installed,service_entry,serving_port,manager,wire_enabled,candidate_manifest_sha256,service_sha256,helper_sha256,exporter_sha256,server_pid,messages_pid,recipient_messages_pid,recipient_helper_sha256,sender_sha256,recipient_sha256,account_login_sha256,approved_chat_guid_sha256,environment_sha256,recipient_environment_sha256"
  );
  keys(
    x,
    "kind,version,host,installation_sha256,candidate_manifest_sha256,exporter_sha256,native_export,native_target_guid,marker,receiver_sha256,peer_sha256,account_login_sha256,approved_chat_guid_sha256,server_pid,messages_pid,recipient_messages_pid,exit_code,source_mutations,sends"
  );
  keys(x.native_export, "path,sha256");
  assert.equal(m.kind, "local-native-candidate-not-installed");
  assert.equal(m.inputs_unchanged_after_build, true);
  assert.equal(m.revision, "R2");
  assert.equal(m.received_context_wire_default, false);
  verifyNativeInputs(m);
  assert.equal(m.serving_entry, "unified-messages-v1");
  assert.equal(b.kind, "installed-reviewed-native-receiving-context-v1");
  assert.equal(b.version, 1);
  assert.equal(b.installed, true);
  assert.equal(b.service_entry, "unified-messages-v1");
  assert.equal(b.manager, "launchd");
  assert.equal(b.entry, "FT-INSTALL-099");
  assert.equal(b.revision, "R2");
  assert.equal(b.host, "chert-m4d");
  assert.equal(b.candidate_manifest_sha256, manifest.sha256);
  assert.equal(b.wire_enabled, false);
  assert.equal(b.recipient_helper_sha256, b.helper_sha256);
  assert.equal(b.serving_port, 4010);
  for (const [key, artifact] of [
    ["service_sha256", "chert-worker"],
    ["helper_sha256", "chert-imsg-bridge.dylib"],
  ]) {
    assert.match(b[key], hex);
    assert.equal(b[key], m.artifacts?.[artifact]?.sha256);
  }
  for (const key of [
    "sender_sha256",
    "recipient_sha256",
    "account_login_sha256",
    "approved_chat_guid_sha256",
    "environment_sha256",
    "recipient_environment_sha256",
    "exporter_sha256",
  ])
    assert.match(b[key], hex);
  for (const key of ["server_pid", "messages_pid", "recipient_messages_pid"])
    assert.ok(Number.isSafeInteger(b[key]) && b[key] > 0);
  assert.equal(x.kind, "reviewed-native-received-event-export-v1");
  assert.equal(x.version, 1);
  assert.equal(x.host, "chert-m4d");
  assert.equal(x.source_mutations, 0);
  assert.equal(x.sends, 0);
  assert.equal(x.exit_code, 0);
  assert.equal(x.installation_sha256, installed.sha256);
  assert.equal(x.candidate_manifest_sha256, manifest.sha256);
  assert.equal(x.exporter_sha256, b.exporter_sha256);
  assert.equal(
    x.exporter_sha256,
    m.artifacts?.["received-event-export"]?.sha256
  );
  for (const key of [
    "server_pid",
    "messages_pid",
    "recipient_messages_pid",
    "account_login_sha256",
    "approved_chat_guid_sha256",
  ])
    assert.equal(x[key], b[key]);
  assert.equal(x.receiver_sha256, b.sender_sha256);
  assert.equal(x.peer_sha256, b.recipient_sha256);
  const native = file(x.native_export.path);
  assert.equal(native.sha256, x.native_export.sha256);
  const e = native.value;
  keys(e, "kind,schema_version,source_mutations,sends,event");
  assert.equal(e.kind, "readonly-native-received-event-export");
  assert.equal(e.schema_version, 1);
  assert.equal(e.source_mutations, 0);
  assert.equal(e.sends, 0);
  const event = e.event,
    v = event?.message?.native_received_evidence,
    msg = event?.message;
  assert.equal(event.type, "message_received");
  assert.ok(Number.isSafeInteger(event.ts) && event.ts > 0);
  assert.ok(record(msg) && record(v));
  keys(
    v,
    "version,primary_guid,receiver,service,is_from_me,is_group,associated_message_type,associated_message_guid,balloon_bundle_id"
  );
  assert.match(v.primary_guid, uuid);
  assert.match(v.receiver, phone);
  assert.equal(v.version, 1);
  assert.equal(v.service, "iMessage");
  assert.equal(v.is_from_me, false);
  assert.equal(v.is_group, false);
  assert.equal(v.associated_message_type, 0);
  assert.equal(v.associated_message_guid, null);
  assert.equal(v.balloon_bundle_id, null);
  assert.equal(event.event_id, "recv:" + v.primary_guid);
  assert.equal(msg.guid, v.primary_guid);
  assert.equal(msg.role, "inbound");
  assert.equal(msg.status, "received");
  assert.equal(msg.service, "imessage");
  assert.equal(msg.is_group, false);
  assert.ok(
    msg.balloon_bundle_id === undefined || msg.balloon_bundle_id === null
  );
  assert.ok(
    msg.associated_message_type === undefined ||
      msg.associated_message_type === 0
  );
  assert.ok(
    msg.associated_message_guid === undefined ||
      msg.associated_message_guid === null
  );
  assert.match(msg.recipient, phone);
  assert.notEqual(msg.recipient, v.receiver);
  assert.equal(sha(v.receiver), b.sender_sha256);
  assert.equal(sha(msg.recipient), b.recipient_sha256);
  assert.ok(Array.isArray(msg.parts) && msg.parts.length === 1);
  const part = msg.parts[0];
  assert.equal(part.type, "text");
  assert.equal(typeof part.value, "string");
  assert.ok(
    part.value.length &&
      Buffer.byteLength(part.value) <= 16384 &&
      !part.value.includes("\0") &&
      Buffer.from(part.value).toString() === part.value
  );
  assert.ok(part.text === undefined || part.text === part.value);
  assert.equal(x.marker, part.value);
  assert.match(
    x.marker,
    /^CHERT-M4D-RECEIVED-TARGET-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i
  );
  assert.equal(x.native_target_guid, v.primary_guid);
  return {
    version: 1,
    plan: "one-reviewed-sendblue-received-like-v1",
    host: "chert-m4d",
    provider: "sendblue-http-reaction",
    run,
    reaction: "like",
    remove: false,
    part_index: 0,
    target_guid: v.primary_guid,
    marker: part.value,
    event,
    bindings: b,
    service: { filename: "chert-worker", entry: "unified-messages-v1" },
    receipt_path: resolve(
      dirname(installed.path),
      run + ".sendblue-received-like.receipt.json"
    ),
    files: {
      manifest: { path: manifest.path, sha256: manifest.sha256 },
      installation: { path: installed.path, sha256: installed.sha256 },
      received: { path: received.path, sha256: received.sha256 },
      native_export: { path: native.path, sha256: native.sha256 },
    },
    reviewed_files: closure(),
    attempted: false,
  };
}
function load(path) {
  const p = file(path).value;
  assert.deepEqual(
    p,
    prepareSendblueReactionPlan(
      p.files.manifest.path,
      p.files.installation.path,
      p.files.received.path,
      p.run
    ),
    "Plan changed"
  );
  return p;
}
function identity(value, p) {
  assert.equal(value.ready, true);
  for (const key of [
    "service_sha256",
    "helper_sha256",
    "server_pid",
    "messages_pid",
  ])
    assert.equal(value[key], p.bindings[key]);
  for (const key of ["sender", "recipient"]) {
    assert.match(value[key], phone);
    assert.equal(sha(value[key]), p.bindings[key + "_sha256"]);
  }
  assert.equal(value.peer_messages_pid, p.bindings.recipient_messages_pid);
  assert.equal(value.targetText, p.marker);
}
function ack(v, b) {
  return (
    record(v) &&
    Object.keys(v).sort().join() ===
      "fingerprint,from,origin,partIndex,preparedGuid,reaction,remove,state,targetGuid,to" &&
    Object.entries(b).every(([k, x]) => v[k] === x) &&
    v.state === "acknowledged" &&
    v.fingerprint === reactionFingerprint(b) &&
    uuid.test(v.preparedGuid) &&
    v.preparedGuid.toLowerCase() !== b.targetGuid.toLowerCase()
  );
}
/** Optional executor is exclusively a test seam; production defaults to fixed M4D SSH. */
export async function startReviewedSendblueReactionBroker(
  planPath,
  journalPath,
  flag,
  verifyReservation,
  executor = remote
) {
  assert.equal(flag, "--live-one-sendblue-received-like");
  const plan = load(planPath);
  assert.equal(
    resolve(realpathSync(dirname(journalPath)), basename(journalPath)),
    plan.receipt_path
  );
  assert.equal(existsSync(journalPath), false);
  assert.equal(existsSync(journalPath + ".spent"), false);
  assert.equal(typeof verifyReservation, "function");
  const initial = await executor({ action: "identity", plan });
  identity(initial, plan);
  assert.ok(
    Number.isSafeInteger(initial.peer_messages_pid) &&
      initial.peer_messages_pid > 0
  );
  assert.ok(
    Array.isArray(initial.process_starts) &&
      initial.process_starts.length === 3 &&
      initial.process_starts.every((v) => typeof v === "string" && v.length > 0)
  );
  const checked = async (payload) => {
    const result = await executor({
      ...payload,
      plan,
      processStarts: initial.process_starts,
    });
    return result;
  };
  const same = (value) => {
    identity(value, plan);
    assert.equal(value.peer_messages_pid, initial.peer_messages_pid);
    assert.deepEqual(value.process_starts, initial.process_starts);
  };
  let receipt = {
    run: plan.run,
    plan_sha256: sha(JSON.stringify(plan)),
    attempted: false,
    passed: false,
    peer_messages_pid: initial.peer_messages_pid,
  };
  persist(journalPath, receipt, true);
  const save = (value) => {
    receipt = { ...receipt, ...value };
    persist(journalPath, receipt);
  };
  const apiKey = randomBytes(32).toString("hex"),
    signingSecret = randomBytes(32).toString("hex");
  let spent = false;
  const failure = () =>
    Response.json(
      { error: "Reaction outcome unavailable; never resend" },
      { status: 502 }
    );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      try {
        const url = new URL(request.url);
        assert.equal(request.method, "POST");
        assert.equal(url.pathname, "/api/v1/reaction-operations/v1");
        assert.equal(url.search, "");
        assert.equal(request.headers.get("authorization"), "Bearer " + apiKey);
        const reader = request.body?.getReader();
        assert.ok(reader);
        let size = 0;
        const chunks = [];
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 4096) {
              await reader.cancel();
              throw Error("Body limit");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks)
        );
        const sig = /^v1,([0-9]+),([a-f0-9]{64})(?![\s\S])/.exec(
          request.headers.get("x-chert-signature") ?? ""
        );
        assert.ok(sig && Math.abs(Date.now() / 1000 - Number(sig[1])) <= 300);
        assert.ok(
          timingSafeEqual(
            createHmac("sha256", signingSecret)
              .update(sig[1] + "." + raw)
              .digest(),
            Buffer.from(sig[2], "hex")
          )
        );
        request.signal.throwIfAborted();
        const body = JSON.parse(raw);
        keys(body, "origin,from,to,targetGuid,partIndex,reaction,remove");
        assert.match(body.origin, /^reaction_[a-f0-9]{32}(?![\s\S])/);
        assert.equal(body.from, initial.sender);
        assert.equal(body.to, initial.recipient);
        assert.equal(body.targetGuid, plan.target_guid);
        assert.equal(body.partIndex, 0);
        assert.equal(body.reaction, "like");
        assert.equal(body.remove, false);
        assert.equal(spent, false);
        const claim = {
          operationId: body.origin.slice(9),
          body,
          fingerprint: reactionFingerprint(body),
          body_sha256: sha(raw),
          plan_sha256: sha(JSON.stringify(plan)),
        };
        assert.equal(await verifyReservation(claim), true);
        same(await checked({ action: "preflight", claim }));
        assert.equal(await verifyReservation(claim), true);
        request.signal.throwIfAborted();
        assert.equal(spent, false);
        persist(journalPath + ".spent", { run: plan.run, ...claim }, true);
        spent = true;
        save({ attempted: true, claim, outcome: "spent-before-native-POST" });
        let result;
        try {
          result = await checked({ action: "send", claim, body, raw });
        } catch {
          save({ outcome: "unknown-no-resend" });
          return failure();
        }
        if (result?.status !== 202 || !ack(result.body, body)) {
          save({ outcome: "unknown-no-resend" });
          return failure();
        }
        save({
          native_guid: result.body.preparedGuid,
          native_http_status: 202,
          native_ack: result.body,
          outcome: "native-dispatch-acknowledged",
        });
        return Response.json(result.body, { status: 202 });
      } catch {
        return failure();
      }
    },
  });
  return {
    plan,
    nativeOrigin: server.url.origin,
    apiKey,
    signingSecret,
    sender: initial.sender,
    recipient: initial.recipient,
    targetGuid: plan.target_guid,
    targetText: plan.marker,
    event: structuredClone(plan.event),
    recordSDKAcceptance(value) {
      assert.ok(spent && receipt.native_guid);
      assert.deepEqual(value, {
        status: "OK",
        message: "Reaction request sent",
        message_handle: plan.target_guid,
        reaction: "like",
      });
      save({ sdk_http_status: 200, sdk_acceptance: value });
    },
    async observe(guid) {
      assert.equal(guid, receipt.native_guid);
      assert.ok(receipt.sdk_acceptance);
      const result = await checked({ action: "observe", guid });
      same(await checked({ action: "identity" }));
      assert.deepEqual(result, {
        complete: true,
        guid,
        associated_message_type: 2001,
        associated_message_guid: "p:0/" + plan.target_guid,
        sender_exact: true,
        recipient_exact: true,
      });
      save({
        passed: true,
        evidence: result,
        observed_at: new Date().toISOString(),
        outcome: "exact-guid-received-target-like-both-accounts",
      });
      return {
        passed: true,
        receiptPath: journalPath,
        receiptSha256: sha(readFileSync(journalPath)),
      };
    },
    close: () => server.stop(true),
  };
}
export const REMOTE_SENDBLUE_REACTION_PROGRAM = String.raw`
import os,sys,json,base64,hashlib,hmac,time,subprocess,sqlite3,urllib.request,urllib.error,urllib.parse,ctypes,shlex,re
p=json.loads(base64.b64decode('PAYLOAD'));plan=p['plan'];B=plan['bindings'];action=p['action']
def check(value):
 if not value:raise RuntimeError('controlled reaction predicate refused')
def sha(value):return hashlib.sha256(value).hexdigest()
def cfg(path):
 result={}
 for line in open(path):
  if line.strip() and not line.lstrip().startswith('#') and '=' in line:
   k,v=line.strip().split('=',1);result[k.strip()]=v.strip().strip('"').strip("'")
 return result
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect)
a=cfg('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env');b=cfg('/Users/meganavery/imessage-server/mac-server/.env');sender=a.get('PHONE_NUMBER');recipient=b.get('PHONE_NUMBER')
def request(path,raw=None):
 ts=str(int(time.time()));secret=a.get('LINE_SIGNING_SECRET') or a['API_KEY'];headers={'Authorization':'Bearer '+a['API_KEY']}
 if path.startswith('/api/v1/'):
  headers.update({'Content-Type':'application/json','x-chert-signature':'v1,'+ts+','+hmac.new(secret.encode(),ts.encode()+b'.'+(raw or b''),hashlib.sha256).hexdigest()})
 req=urllib.request.Request('http://127.0.0.1:4010'+path,data=raw,headers=headers,method='POST' if raw is not None else 'GET')
 try:r=opener.open(req,timeout=12 if raw is not None else 5)
 except urllib.error.HTTPError as e:r=e
 with r:
  body=r.read(16385);check(len(body)<=16384);return {'status':r.status,'body':json.loads(body)}
def process(pid,uid,name):
 check(type(pid)is int and pid>0)
 lib=ctypes.CDLL('/usr/lib/libproc.dylib');buf=ctypes.create_string_buffer(4096);check(lib.proc_pidpath(pid,buf,len(buf))>0);path=buf.value.decode()
 check(int(subprocess.check_output(['/bin/ps','-p',str(pid),'-o','uid='],timeout=5))==uid)
 check(path==name);started=subprocess.check_output(['/bin/ps','-p',str(pid),'-o','lstart='],timeout=5).decode().strip();check(bool(started));return started

def target_and_absence(require_absent):
 observed=[]
 for home,outgoing,peer in [('/Users/chert',0,recipient),('/Users/meganavery',1,sender)]:
  db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
  try:
   rows=db.execute('SELECT m.guid,m.is_from_me,m.service,m.text,m.destination_caller_id,h.id,c.guid,c.chat_identifier,c.account_login,m.error,m.associated_message_type,m.associated_message_guid,m.balloon_bundle_id,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID),(SELECT count(*) FROM message_attachment_join WHERE message_id=m.ROWID),m.attributedBody FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid COLLATE BINARY=? LIMIT 2',(plan['target_guid'],)).fetchall();check(len(rows)==1);r=rows[0]
   check(r[0]==plan['target_guid'] and r[1]==outgoing and r[2]=='iMessage' and r[7]==peer and r[9]==0 and r[10]==0 and r[11] in (None,'') and r[12] in (None,'') and r[13]==1 and r[14]==0)
   if not outgoing:check(r[4]==sender and r[5]==recipient and sha(r[6].encode())==B['approved_chat_guid_sha256'] and sha(r[8].encode())==B['account_login_sha256'])
   else:check(r[4]==recipient)
   observed.append(r)
   if require_absent:check(db.execute('SELECT count(*) FROM message WHERE associated_message_type=2001 AND associated_message_guid COLLATE BINARY=?',('p:0/'+plan['target_guid'],)).fetchone()[0]==0)
  finally:db.close()
 incoming,outgoing=observed
 check(incoming[3]==plan['marker'])
 # Proven exact-pair fallback only: no decoder, normalization, or conflicting scalar.
 if outgoing[3]!=plan['marker']:
  a,b=outgoing[15],incoming[15]
  check(outgoing[3] is None and isinstance(a,bytes) and isinstance(b,bytes) and 0<len(a)<=1048576 and len(a)==len(b) and a==b)
def identity():
 check(sha(sender.encode())==B['sender_sha256'] and sha(recipient.encode())==B['recipient_sha256'] and a.get('PORT','4010')=='4010')
 check(sha(open('/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/.env','rb').read())==B['environment_sha256']);check(sha(open('/Users/meganavery/imessage-server/mac-server/.env','rb').read())==B['recipient_environment_sha256'])
 path='/Users/chert/bridge-upgrades/approved-1.9.0/mac-server/build/chert-worker'
 server_start=process(B['server_pid'],501,path);check(sha(open(path,'rb').read())==B['service_sha256'])
 argv=shlex.split(subprocess.check_output(['/bin/ps','-p',str(B['server_pid']),'-o','command='],timeout=5).decode().strip());check(argv==[path,'messages','serve','--config-dir','/Users/chert/bridge-upgrades/approved-1.9.0/mac-server'])
 check(set(subprocess.check_output(['/usr/sbin/lsof','-nP','-t','-iTCP:4010','-sTCP:LISTEN'],timeout=5).decode().split())=={str(B['server_pid'])})
 starts=[]
 for home,uid,pid in [('/Users/chert',501,B['messages_pid']),('/Users/meganavery',503,B['recipient_messages_pid'])]:
  starts.append(process(pid,uid,'/System/Applications/Messages.app/Contents/MacOS/Messages'))
  marker=json.load(open(home+'/Library/Containers/com.apple.MobileSMS/Data/.chert-bridge-ready'));check(marker['pid']==pid and marker['bridge_version']==1)
  paths=subprocess.check_output(['/usr/sbin/lsof','-a','-p',str(pid),'-Fn'],timeout=5).decode().splitlines();loaded={v[1:] for v in paths if v.startswith('n') and v.endswith('/chert-imsg-bridge.dylib')};check(len(loaded)==1 and sha(open(next(iter(loaded)),'rb').read())==B['helper_sha256'])
 if 'processStarts' in p:check([server_start]+starts==p['processStarts'])
 status=request('/status');check(status['status']==200 and status['body'].get('sender')=='bridge' and status['body'].get('phoneNumber')==sender)
 target_and_absence(False)
 return {'ready':True,'sender':sender,'recipient':recipient,'targetText':plan['marker'],'server_pid':B['server_pid'],'messages_pid':B['messages_pid'],'peer_messages_pid':B['recipient_messages_pid'],'service_sha256':B['service_sha256'],'helper_sha256':B['helper_sha256'],'process_starts':[server_start]+starts}
def exact_pair(guid):
 for home,outgoing,peer in [('/Users/chert',1,recipient),('/Users/meganavery',0,sender)]:
  db=sqlite3.connect('file:'+home+'/Library/Messages/chat.db?mode=ro',uri=True,timeout=2);db.execute('PRAGMA query_only=ON')
  try:
   rows=db.execute('SELECT m.guid,m.is_from_me,m.service,m.associated_message_type,m.associated_message_guid,m.destination_caller_id,h.id,c.chat_identifier,(SELECT count(*) FROM chat_handle_join WHERE chat_id=c.ROWID),m.error,c.account_login FROM message m LEFT JOIN handle h ON h.ROWID=m.handle_id JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE m.guid COLLATE BINARY=? LIMIT 2',(guid,)).fetchall()
   if len(rows)!=1:return False
   r=rows[0]
   if not(r[0]==guid and r[1]==outgoing and r[2]=='iMessage' and r[3]==2001 and r[4]=='p:0/'+plan['target_guid'] and r[7]==peer and r[8]==1 and r[9]==0 and (r[5]==sender and sha(r[10].encode())==B['account_login_sha256'] if outgoing else r[6]==sender)):return False
  finally:db.close()
 return True
def claim():
 c=p['claim'];body=c['body'];check(set(body)=={'origin','from','to','targetGuid','partIndex','reaction','remove'});check(re.fullmatch(r'reaction_[a-f0-9]{32}',body['origin']) and c['operationId']==body['origin'][9:]);check(body['from']==sender and body['to']==recipient and body['targetGuid']==plan['target_guid'] and type(body['partIndex'])is int and body['partIndex']==0 and body['reaction']=='like' and body['remove']is False)
 expected=json.dumps(['chert-reaction-once-v1',sender,recipient,plan['target_guid'],0,'like',False],separators=(',',':'),ensure_ascii=False).replace('/',chr(92)+'/');check(c['fingerprint']==sha(expected.encode()) and c['plan_sha256']==sha(json.dumps(plan,separators=(',',':'),ensure_ascii=False).encode()));return body
try:
 before=identity()
 if action=='identity':out=before
 elif action=='preflight':
  target_and_absence(True);body=claim();r=request('/api/v1/reaction-operations/v1/'+body['origin']+'?from='+urllib.parse.quote(sender,safe=''));check(r['status']==404 and r['body']=={'origin':body['origin'],'found':False});out=before
 elif action=='send':
  target_and_absence(True);body=claim();check(p['body']==body);raw=p['raw'].encode();check(json.loads(raw)==body and sha(raw)==p['claim']['body_sha256']);out=request('/api/v1/reaction-operations/v1',raw);check(identity()==before)
 elif action=='observe':
  guid=p['guid'];check(re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',guid));end=time.monotonic()+40;found=False
  while time.monotonic()<end:
   if exact_pair(guid):found=True;break
   time.sleep(.5)
  check(identity()==before);out={'complete':found,'guid':guid,'associated_message_type':2001,'associated_message_guid':'p:0/'+plan['target_guid'],'sender_exact':found,'recipient_exact':found}
 else:raise RuntimeError('unsupported action')
except Exception:out={'ready':False,'complete':False,'outcome':'unknown-no-resend'}
print(json.dumps(out))
`;
async function remote(payload) {
  return new Promise((yes, no) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "chert-m4d",
        "sudo",
        "-n",
        "python3",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let out = "",
      size = 0;
    const timer = setTimeout(
      () => child.kill(),
      payload.action === "observe" ? 65000 : 30000
    );
    const fail = () =>
      no(Error("Controlled reaction outcome unavailable; never resend"));
    child.stdout.on("data", (value) => {
      size += value.length;
      if (size > 65536) child.kill();
      else out += value;
    });
    child.stderr.on("data", (value) => {
      size += value.length;
      if (size > 65536) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timer);
      fail();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0);
        yes(JSON.parse(out));
      } catch {
        fail();
      }
    });
    child.stdin.end(
      REMOTE_SENDBLUE_REACTION_PROGRAM.replace(
        "PAYLOAD",
        Buffer.from(JSON.stringify(payload)).toString("base64")
      )
    );
  });
}
