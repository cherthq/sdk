import { test, expect } from "bun:test";
import {
  createMediaEvidence,
  parseMediaEvidence,
  type MediaEvidenceContext,
} from "../../imessage-server/lib/messaging/media-evidence";
import { attachmentCaptionSHA256 } from "../../imessage-server/lib/sending/attachment-operation-context";
const id = "a".repeat(32),
  attachmentId = "b".repeat(48),
  guid = "A0000000-0000-4000-8000-000000000001";
function setup(caption?: string) {
  const context: MediaEvidenceContext = {
    tenantId: "tenant-owned",
    leadId: "lead-owned",
    messageId: id,
    lineId: "line-owned",
    peer: "+15550000002",
    requestPayload: {
      message: {
        parts:
          caption === undefined
            ? [{ type: "media", attachment_id: attachmentId }]
            : [
                { type: "text", value: caption },
                { type: "media", attachment_id: attachmentId },
              ],
      },
    },
  };
  const payload: Record<string, any> = {
    status: "queued",
    mac_media_protocol:
      caption === undefined
        ? "attachment-operations/v1"
        : "attachment-operations/v2",
    mac_media_origin: (caption === undefined ? "media_" : "caption_") + id,
    mac_media_from: "+15550000001",
    mac_media_dispatch_state: "unconfirmed",
    attachments: [{ attachment_id: attachmentId }],
    ...(caption === undefined
      ? {}
      : { mac_media_caption_sha256: attachmentCaptionSHA256(caption) }),
  };
  const raw: Record<string, any> = {
    evidence_source: "chat_db_exact_guid",
    guid,
    recipient: context.peer,
    sender: payload.mac_media_from,
    service: "imessage",
    has_attachments: true,
    is_sent: true,
    is_delivered: true,
    is_read: true,
    delivered_at: 1700000000000,
    read_at: 1700000001000,
  };
  return { context, payload, raw };
}
function cached() {
  const s = setup();
  s.payload.mac_media_evidence = createMediaEvidence(
    s.context,
    s.payload,
    s.raw
  );
  Object.assign(s.payload, {
    status: "read",
    service: "imessage",
    error: null,
    retryable: false,
    delivered: true,
    read: true,
    delivered_at: new Date(s.raw.delivered_at).toISOString(),
    read_at: new Date(s.raw.read_at).toISOString(),
  });
  return s;
}
test("bound proof promotes actual flags/times, preserves lost ACK and snapshot immutability", () => {
  const { context, payload, raw } = cached(),
    before = JSON.stringify(payload),
    proof = parseMediaEvidence(context, payload)!;
  expect(proof).toMatchObject({
    status: "read",
    nativeGuid: guid,
    service: "imessage",
    read: true,
    delivered: true,
    delivered_at: "2023-11-14T22:13:20.000Z",
    read_at: "2023-11-14T22:13:21.000Z",
  });
  expect(proof).not.toHaveProperty("sent_at");
  expect(payload.mac_media_dispatch_state).toBe("unconfirmed");
  expect(payload).not.toHaveProperty("native_attachment_guids");
  expect(JSON.stringify(payload)).toBe(before);
  raw.recipient = "+15550000003";
  expect(proof.envelope.evidence.recipient).toBe(context.peer);
  expect(Object.isFrozen(proof.envelope)).toBe(true);
  expect(Object.isFrozen(proof.envelope.evidence)).toBe(true);
});
test("each owned context/envelope identity is mandatory and byte-bound", () => {
  for (const key of [
    "tenantId",
    "leadId",
    "messageId",
    "lineId",
    "peer",
  ] as const) {
    const s = cached();
    expect(
      parseMediaEvidence(
        { ...s.context, [key]: key === "peer" ? "+15550000003" : "foreign" },
        s.payload
      )
    ).toBeNull();
  }
  for (const key of [
    "tenant_id",
    "lead_id",
    "message_id",
    "phone_line_id",
    "protocol",
    "origin",
    "attachment_id",
    "caption_sha256",
    "version",
  ]) {
    const s = cached();
    s.payload.mac_media_evidence = {
      ...s.payload.mac_media_evidence,
      [key]: "foreign",
    };
    expect(parseMediaEvidence(s.context, s.payload)).toBeNull();
  }
  for (const patch of [{ extra: true }, { version: 2 }]) {
    const s = cached();
    s.payload.mac_media_evidence = {
      ...s.payload.mac_media_evidence,
      ...patch,
    };
    expect(parseMediaEvidence(s.context, s.payload)).toBeNull();
  }
  const s = cached();
  delete s.payload.mac_media_evidence;
  expect(parseMediaEvidence(s.context, s.payload)).toBeNull();
});
test("raw native proof refuses contradictions, foreign identities and clocks; ACK is not sent", () => {
  const patches = [
    { sender: "+15550000003" },
    { recipient: "+15550000003" },
    { guid: "bad" },
    { service: "sms" },
    { has_attachments: false },
    { evidence_source: "acknowledged" },
    { is_sent: false },
    { is_delivered: false },
    { is_read: 1 },
    { delivered_at: 0 },
    { read_at: 1699999999999 },
    { read_at: Date.now() + 60000 },
    { status: "sent" },
  ];
  for (const patch of patches) {
    const s = setup();
    expect(
      createMediaEvidence(s.context, s.payload, { ...s.raw, ...patch })
    ).toBeNull();
  }
  const s = setup();
  s.payload.mac_media_dispatch_state = "acknowledged";
  s.payload.native_attachment_guids = [guid.toLowerCase()];
  expect(createMediaEvidence(s.context, s.payload, s.raw)).toBeNull();
  s.payload.native_attachment_guids = [guid, guid.toLowerCase()];
  expect(createMediaEvidence(s.context, s.payload, s.raw)).toBeNull();
  s.payload.native_attachment_guids = [guid];
  expect(createMediaEvidence(s.context, s.payload, s.raw)).not.toBeNull();
  s.payload.mac_media_dispatch_state = "reserved";
  expect(createMediaEvidence(s.context, s.payload, s.raw)).toBeNull();
});
test("caption remains exact lossless request-bound; scalar contradictions never promote", () => {
  const s = setup("  caption / Café 🌅\r\n  ");
  expect(createMediaEvidence(s.context, s.payload, s.raw)).not.toBeNull();
  (s.context.requestPayload!.message as any).parts[0].value += "x";
  expect(createMediaEvidence(s.context, s.payload, s.raw)).toBeNull();
  for (const patch of [
    { status: "sent" },
    { service: "unknown" },
    { error: "failed" },
    { error_code: 4103 },
    { success: false },
    { ok: false },
    { sent: false },
    { is_sent: false },
    { is_delivered: false },
    { is_read: false },
    { delivered: false },
    { read: 1 },
    { delivered_at: "2023-11-14T22:13:21.000Z" },
    { read_at: undefined },
    { retryable: true },
  ]) {
    const s = cached();
    Object.assign(s.payload, patch);
    expect(parseMediaEvidence(s.context, s.payload)).toBeNull();
  }
  const unknown = setup();
  unknown.payload.mac_text_protocol = "text-operations/v1";
  expect(
    createMediaEvidence(unknown.context, unknown.payload, unknown.raw)
  ).toBeNull();
});
test("sent and delivered ranks use actual proof without manufacturing later receipts", () => {
  for (const delivered of [false, true]) {
    const s = setup();
    s.raw.is_read = false;
    delete s.raw.read_at;
    s.raw.is_delivered = delivered;
    if (!delivered) delete s.raw.delivered_at;
    s.payload.mac_media_evidence = createMediaEvidence(
      s.context,
      s.payload,
      s.raw
    );
    Object.assign(s.payload, {
      status: delivered ? "delivered" : "sent",
      service: "imessage",
      error: null,
      retryable: false,
      delivered,
      read: false,
      ...(delivered
        ? { delivered_at: new Date(s.raw.delivered_at).toISOString() }
        : {}),
    });
    const result = parseMediaEvidence(s.context, s.payload)!;
    expect(result.status).toBe(delivered ? "delivered" : "sent");
    expect(result).not.toHaveProperty("read_at");
    expect(result).not.toHaveProperty("sent_at");
  }
});
