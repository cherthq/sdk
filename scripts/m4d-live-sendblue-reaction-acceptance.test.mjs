import { test, expect } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import {
  prepareSendblueReactionPlan,
  startReviewedSendblueReactionBroker,
  REMOTE_SENDBLUE_REACTION_PROGRAM,
} from "./m4d-live-sendblue-reaction-acceptance.mjs";
import { reactionFingerprint } from "./m4d-live-reaction-acceptance.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex"),
  target = "a1111111-2222-4333-8444-555555555555",
  guid = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
  run = "11000000-0000-4000-8000-000000000001";
const sender = "+15550000001",
  recipient = "+15550000002",
  marker = "CHERT-M4D-RECEIVED-TARGET-" + run;
function currentNativeInputs() {
  const root = resolve(import.meta.dirname, "../.."),
    mac = resolve(root, "imessage-server/mac-server");
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
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (entry.isFile() && /\.(m|h)$/.test(entry.name))
        paths.push(relative(mac, p));
    }
  }
  scan(resolve(mac, "src"));
  return Object.fromEntries(
    paths
      .sort()
      .map((path) => [
        path,
        sha(
          readFileSync(resolve(path.startsWith("native/") ? root : mac, path))
        ),
      ])
  );
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "chert-sendblue-reaction-offline-"));
  chmodSync(dir, 0o700);
  const put = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    return path;
  };
  const manifest = {
    kind: "local-native-candidate-not-installed",
    revision: "R2",
    received_context_wire_default: false,
    native_inputs: currentNativeInputs(),
    native_inputs_sha256: sha(JSON.stringify(currentNativeInputs())),
    inputs_unchanged_after_build: true,
    serving_entry: "unified-messages-v1",
    artifacts: {
      "chert-worker": { sha256: "a".repeat(64) },
      "chert-imsg-bridge.dylib": { sha256: "b".repeat(64) },
      "received-event-export": { sha256: "c".repeat(64) },
    },
  };
  const manifestPath = put("manifest.json", manifest),
    bindings = {
      kind: "installed-reviewed-native-receiving-context-v1",
      version: 1,
      entry: "FT-INSTALL-099",
      revision: "R2",
      host: "chert-m4d",
      installed: true,
      service_entry: "unified-messages-v1",
      serving_port: 4010,
      manager: "launchd",
      wire_enabled: false,
      candidate_manifest_sha256: sha(readFileSync(manifestPath)),
      service_sha256: "a".repeat(64),
      helper_sha256: "b".repeat(64),
      recipient_helper_sha256: "b".repeat(64),
      exporter_sha256: "c".repeat(64),
      server_pid: 1,
      messages_pid: 2,
      recipient_messages_pid: 3,
      sender_sha256: sha(sender),
      recipient_sha256: sha(recipient),
      account_login_sha256: "d".repeat(64),
      approved_chat_guid_sha256: "e".repeat(64),
      environment_sha256: "f".repeat(64),
      recipient_environment_sha256: "0".repeat(64),
    };
  const installation = put("installation.json", bindings),
    event = {
      type: "message_received",
      event_id: "recv:" + target,
      ts: 1,
      message: {
        guid: target,
        role: "inbound",
        status: "received",
        recipient,
        service: "imessage",
        is_group: false,
        parts: [{ type: "text", text: marker, value: marker }],
        native_received_evidence: {
          version: 1,
          primary_guid: target,
          receiver: sender,
          service: "iMessage",
          is_from_me: false,
          is_group: false,
          associated_message_type: 0,
          associated_message_guid: null,
          balloon_bundle_id: null,
        },
      },
    };
  const rawPath = put("native.json", {
    kind: "readonly-native-received-event-export",
    schema_version: 1,
    source_mutations: 0,
    sends: 0,
    event,
  });
  const provenance = {
    kind: "reviewed-native-received-event-export-v1",
    version: 1,
    host: "chert-m4d",
    installation_sha256: sha(readFileSync(installation)),
    candidate_manifest_sha256: bindings.candidate_manifest_sha256,
    exporter_sha256: bindings.exporter_sha256,
    native_export: { path: rawPath, sha256: sha(readFileSync(rawPath)) },
    native_target_guid: target,
    marker,
    receiver_sha256: sha(sender),
    peer_sha256: sha(recipient),
    account_login_sha256: bindings.account_login_sha256,
    approved_chat_guid_sha256: bindings.approved_chat_guid_sha256,
    server_pid: 1,
    messages_pid: 2,
    recipient_messages_pid: 3,
    exit_code: 0,
    source_mutations: 0,
    sends: 0,
  };
  const exportPath = put("provenance.json", provenance),
    plan = prepareSendblueReactionPlan(
      manifestPath,
      installation,
      exportPath,
      run
    ),
    planPath = put("plan.json", plan);
  const identity = {
    ready: true,
    sender,
    recipient,
    targetText: marker,
    server_pid: 1,
    messages_pid: 2,
    peer_messages_pid: 3,
    service_sha256: bindings.service_sha256,
    helper_sha256: bindings.helper_sha256,
    process_starts: ["one", "two", "three"],
  };
  return {
    dir,
    put,
    manifestPath,
    installation,
    exportPath,
    provenance,
    rawPath,
    event,
    plan,
    planPath,
    identity,
  };
}
async function broker(f, { verify = async () => true, mode = "ok" } = {}) {
  let posts = 0,
    preflights = 0;
  const result = await startReviewedSendblueReactionBroker(
    f.planPath,
    f.plan.receipt_path,
    "--live-one-sendblue-received-like",
    verify,
    async (p) => {
      if (p.action === "send") {
        posts++;
        if (mode === "throw") throw Error("private");
        return {
          status: 202,
          body: {
            ...p.body,
            fingerprint: reactionFingerprint(p.body),
            preparedGuid: mode === "same" ? target : guid,
            state: "acknowledged",
          },
        };
      }
      if (p.action === "preflight") {
        preflights++;
        if (mode === "refuse") return { ready: false };
      }
      if (p.action === "observe")
        return {
          complete: true,
          guid: p.guid,
          associated_message_type: 2001,
          associated_message_guid: "p:0/" + target,
          sender_exact: true,
          recipient_exact: true,
        };
      return f.identity;
    }
  );
  return { result, posts: () => posts, preflights: () => preflights };
}
async function post(b, patch = {}, headers = {}) {
  const raw = JSON.stringify({
      origin: "reaction_" + "a".repeat(32),
      from: sender,
      to: recipient,
      targetGuid: target,
      partIndex: 0,
      reaction: "like",
      remove: false,
      ...patch,
    }),
    ts = Math.floor(Date.now() / 1000);
  return fetch(b.nativeOrigin + "/api/v1/reaction-operations/v1", {
    method: "POST",
    body: raw,
    headers: {
      authorization: "Bearer " + b.apiKey,
      "x-chert-signature": `v1,${ts},${createHmac("sha256", b.signingSecret)
        .update(ts + "." + raw)
        .digest("hex")}`,
      ...headers,
    },
  });
}
test("strict plan binds actual separate export, installed pair and executed dependency closure", () => {
  const f = setup();
  expect(
    f.plan.reviewed_files.some(
      (v) =>
        v.path === "imessage-server/lib/messaging/received-context-ledger.ts"
    )
  ).toBe(true);
  expect(
    f.plan.reviewed_files.some(
      (v) => v.path === "imessage-server/lib/imessage-stream/dispatch.ts"
    )
  ).toBe(true);
  for (const mutate of [
    (v) => (v.revision = "R1"),
    (v) => (v.installed = false),
    (v) => (v.wire_enabled = true),
    (v) => (v.recipient_helper_sha256 = "f".repeat(64)),
  ]) {
    const original = JSON.parse(readFileSync(f.installation));
    const bad = structuredClone(original);
    mutate(bad);
    f.put("installation.json", bad);
    expect(() =>
      prepareSendblueReactionPlan(
        f.manifestPath,
        f.installation,
        f.exportPath,
        run
      )
    ).toThrow();
    f.put("installation.json", original);
  }
});
test("forged or mutated native proof fails before executor", async () => {
  const f = setup();
  for (const modify of [
    (v) => (v.sends = 1),
    (v) => (v.event.message.native_received_evidence.receiver = recipient),
    (v) => (v.event.message.guid = guid),
    (v) => (v.event.message.parts[0].value += "changed"),
  ]) {
    const raw = JSON.parse(readFileSync(f.rawPath));
    modify(raw);
    f.put("native.json", raw);
    let calls = 0;
    await expect(
      startReviewedSendblueReactionBroker(
        f.planPath,
        f.plan.receipt_path,
        "--live-one-sendblue-received-like",
        async () => true,
        async () => {
          calls++;
        }
      )
    ).rejects.toThrow();
    expect(calls).toBe(0);
    f.put("native.json", {
      kind: "readonly-native-received-event-export",
      schema_version: 1,
      source_mutations: 0,
      sends: 0,
      event: f.event,
    });
  }
});
test("one exact ACK is durable before HTTP return and exact SDK receipt before observation", async () => {
  const f = setup(),
    b = await broker(f);
  try {
    expect((await post(b.result)).status).toBe(202);
    expect(JSON.parse(readFileSync(f.plan.receipt_path)).native_guid).toBe(
      guid
    );
    await expect(b.result.observe(guid)).rejects.toThrow();
    b.result.recordSDKAcceptance({
      status: "OK",
      message: "Reaction request sent",
      message_handle: target,
      reaction: "like",
    });
    expect((await b.result.observe(guid)).passed).toBe(true);
    expect((await post(b.result)).status).toBe(502);
    expect(b.posts()).toBe(1);
    expect(existsSync(f.plan.receipt_path + ".spent")).toBe(true);
  } finally {
    b.result.close();
  }
});
test("wrong flag, body, authentication or unconfirmed reservation performs zero native effects", async () => {
  const f = setup();
  let calls = 0;
  await expect(
    startReviewedSendblueReactionBroker(
      f.planPath,
      f.plan.receipt_path,
      "wrong",
      async () => true,
      async () => {
        calls++;
      }
    )
  ).rejects.toThrow();
  expect(calls).toBe(0);
  const b = await broker(f, { verify: async () => false });
  try {
    for (const patch of [
      { targetGuid: guid },
      { remove: true },
      { reaction: "love" },
      {},
    ])
      expect((await post(b.result, patch)).status).toBe(502);
    expect((await post(b.result, {}, { authorization: "wrong" })).status).toBe(
      502
    );
    expect(b.posts()).toBe(0);
    expect(existsSync(f.plan.receipt_path + ".spent")).toBe(false);
  } finally {
    b.result.close();
  }
});
test("concurrent requests cannot each spend an effect; unknown ACK is never retried", async () => {
  for (const mode of ["throw", "same"]) {
    const f = setup(),
      b = await broker(f, { mode });
    try {
      const results = await Promise.all([post(b.result), post(b.result)]);
      expect(results.map((v) => v.status)).toEqual([502, 502]);
      expect(b.posts()).toBe(1);
      expect((await post(b.result)).status).toBe(502);
      expect(b.posts()).toBe(1);
      await expect(
        startReviewedSendblueReactionBroker(
          f.planPath,
          f.plan.receipt_path,
          "--live-one-sendblue-received-like",
          async () => true,
          async () => {
            throw Error("must not execute");
          }
        )
      ).rejects.toThrow();
    } finally {
      b.result.close();
    }
  }
});
test("remote source is syntactically valid, exact inbound target and both artifacts remain mandatory", () => {
  const result = Bun.spawnSync(
    ["python3", "-c", "import ast,sys; ast.parse(sys.stdin.read())"],
    { stdin: Buffer.from(REMOTE_SENDBLUE_REACTION_PROGRAM) }
  );
  expect(result.exitCode).toBe(0);
  expect(REMOTE_SENDBLUE_REACTION_PROGRAM).toContain(
    "('/Users/chert',0,recipient)"
  );
  expect(REMOTE_SENDBLUE_REACTION_PROGRAM).toContain(
    "B['recipient_messages_pid']"
  );
  expect(REMOTE_SENDBLUE_REACTION_PROGRAM).not.toContain("ensureReady");
  expect(REMOTE_SENDBLUE_REACTION_PROGRAM).not.toContain("killall");
});
test("source closure or bound export identity changes refuse before any execution", async () => {
  for (const patch of [
    (p) => (p.reviewed_files[0].sha256 = "0".repeat(64)),
    (p) => (p.target_guid = guid),
    (p) => (p.marker += "changed"),
  ]) {
    const f = setup(),
      p = structuredClone(f.plan);
    patch(p);
    f.put("plan.json", p);
    let calls = 0;
    await expect(
      startReviewedSendblueReactionBroker(
        f.planPath,
        f.plan.receipt_path,
        "--live-one-sendblue-received-like",
        async () => true,
        async () => {
          calls++;
        }
      )
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
test("fresh native preflight refusal and changed process start refuse before spending", async () => {
  for (const mode of ["refuse", "changed-start"]) {
    const f = setup();
    let calls = 0;
    const b = await startReviewedSendblueReactionBroker(
      f.planPath,
      f.plan.receipt_path,
      "--live-one-sendblue-received-like",
      async () => true,
      async (p) => {
        if (p.action === "send") {
          calls++;
          throw Error("must not send");
        }
        return p.action === "preflight"
          ? mode === "refuse"
            ? { ready: false }
            : { ...f.identity, process_starts: ["changed", "two", "three"] }
          : f.identity;
      }
    );
    try {
      expect((await post(b)).status).toBe(502);
      expect(calls).toBe(0);
      expect(existsSync(f.plan.receipt_path + ".spent")).toBe(false);
    } finally {
      b.close();
    }
  }
});
test("second reservation check can refuse after remote preflight without spending", async () => {
  const f = setup();
  let checks = 0;
  const b = await broker(f, { verify: async () => ++checks === 1 });
  try {
    expect((await post(b.result)).status).toBe(502);
    expect(checks).toBe(2);
    expect(b.preflights()).toBe(1);
    expect(b.posts()).toBe(0);
    expect(existsSync(f.plan.receipt_path + ".spent")).toBe(false);
  } finally {
    b.result.close();
  }
});
test("actual remote target predicate refuses preexisting LIKE, wrong directions and NULL/modified marker", () => {
  const python = String.raw`import ast,json,sys,hashlib
source=json.load(sys.stdin);fn=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='target_and_absence')
count=0;bad=None
class DB:
 def __init__(self,path):self.inbound='/Users/chert/' in path
 def execute(self,sql,args=None):return self
 def fetchall(self):
  outgoing=0 if self.inbound else 1;peer='peer' if self.inbound else 'receiver'
  r=['GUID',outgoing,'iMessage','marker','receiver' if self.inbound else 'peer','peer','chat',peer,'account',0,0,None,None,1,0,b'exact-body']
  if bad=='text':r[3]=None
  if bad in ['null-equal','null-different','null-empty'] and not self.inbound:r[3]=None
  if bad=='null-different' and not self.inbound:r[15]=b'different'
  if bad=='null-empty':r[15]=b''
  if bad=='conflicting' and not self.inbound:r[3]='different'
  if bad=='incoming-null' and self.inbound:r[3]=None
  if bad=='direction':r[1]=1-outgoing
  if bad=='service':r[2]='SMS'
  return [r]
 def fetchone(self):return(count,)
 def close(self):pass
class SQL:
 @staticmethod
 def connect(path,**kwargs):return DB(path)
sha=lambda x:hashlib.sha256(x).hexdigest()
ns={'plan':{'target_guid':'GUID','marker':'marker'},'sender':'receiver','recipient':'peer','sqlite3':SQL,'sha':sha,'B':{'approved_chat_guid_sha256':sha(b'chat'),'account_login_sha256':sha(b'account')},'check':lambda x:None if x else (_ for _ in ()).throw(ValueError('refused'))}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<target-predicate>','exec'),ns)
ns['target_and_absence'](True)
count=1
ns['target_and_absence'](False)
try:ns['target_and_absence'](True);raise AssertionError('existing LIKE accepted')
except ValueError:pass
count=0
bad='null-equal'
ns['target_and_absence'](False)
for bad in ['text','direction','service','null-different','null-empty','conflicting','incoming-null']:
 try:ns['target_and_absence'](False);raise AssertionError('bad target accepted')
 except ValueError:pass
`;
  const result = Bun.spawnSync(["python3", "-c", python], {
    stdin: Buffer.from(JSON.stringify(REMOTE_SENDBLUE_REACTION_PROGRAM)),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.length).toBe(0);
});
test("R2 native manifest rejects stale revision, wire activation, missing/extra paths and forged hashes before executor", async () => {
  for (const mutate of [
    (m) => (m.revision = "R1"),
    (m) => (m.received_context_wire_default = true),
    (m) => delete m.native_inputs,
    (m) => delete m.native_inputs["src/main.m"],
    (m) => (m.native_inputs["src/not-a-built-source.m"] = "0".repeat(64)),
    (m) => (m.native_inputs["src/main.m"] = "0".repeat(64)),
    (m) => (m.native_inputs_sha256 = "0".repeat(64)),
  ]) {
    const f = setup(),
      m = JSON.parse(readFileSync(f.manifestPath)),
      originalAggregate = m.native_inputs_sha256;
    mutate(m);
    if (m.native_inputs && m.native_inputs_sha256 === originalAggregate)
      m.native_inputs_sha256 = sha(
        JSON.stringify(
          Object.fromEntries(
            Object.keys(m.native_inputs)
              .sort()
              .map((key) => [key, m.native_inputs[key]])
          )
        )
      );
    f.put("manifest.json", m);
    // Rebind outer receipt hashes so rejection exercises native inputs, not merely stale file hashes.
    const b = JSON.parse(readFileSync(f.installation));
    b.candidate_manifest_sha256 = sha(readFileSync(f.manifestPath));
    f.put("installation.json", b);
    const x = JSON.parse(readFileSync(f.exportPath));
    x.candidate_manifest_sha256 = b.candidate_manifest_sha256;
    x.installation_sha256 = sha(readFileSync(f.installation));
    f.put("provenance.json", x);
    expect(() =>
      prepareSendblueReactionPlan(
        f.manifestPath,
        f.installation,
        f.exportPath,
        run
      )
    ).toThrow();
    let calls = 0;
    await expect(
      startReviewedSendblueReactionBroker(
        f.planPath,
        f.plan.receipt_path,
        "--live-one-sendblue-received-like",
        async () => true,
        async () => {
          calls++;
        }
      )
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
