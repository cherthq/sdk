import { test, expect } from "bun:test";
import { projectStrictMediaRecord } from "../../imessage-server/lib/messaging/account-media-history";
import { attachmentCaptionSHA256 } from "../../imessage-server/lib/sending/attachment-operation-context";
const id = "a".repeat(32),
  attachmentId = "b".repeat(48),
  tenantId = "11000000-0000-4000-8000-000000000001";
const owner = { tenantId, leadId: "lead-owned", convoId: "convo-owned" };
const guid = "A0000000-0000-4000-8000-000000000001",
  line = "61000000-0000-4000-8000-000000000001";
function row(caption?: string): Record<string, any> {
  const expires = 1767229200;
  return {
    id,
    tenant_id: tenantId,
    lead_id: owner.leadId,
    convo_id: owner.convoId,
    phone: "+15550000002",
    phone_line_id: line,
    status: "processing",
    created_at: "2026-01-01T00:00:00.123456+00:00",
    request_payload: {
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
    response_payload: {
      status: "queued",
      mac_media_origin: (caption === undefined ? "media_" : "caption_") + id,
      mac_media_protocol:
        caption === undefined
          ? "attachment-operations/v1"
          : "attachment-operations/v2",
      mac_media_from: "+15550000001",
      mac_media_dispatch_state: "reserved",
      ...(caption === undefined
        ? {}
        : { mac_media_caption_sha256: attachmentCaptionSHA256(caption) }),
      attachments: [
        {
          attachment_id: attachmentId,
          filename: "image.png",
          content_type: "image/png",
          size_bytes: 70,
          download_url: `https://owned.example/api/v1/attachments/${attachmentId}/download?tenant=${tenantId}&expires=${expires}&signature=${"c".repeat(
            64
          )}`,
          download_url_expires_at: new Date(expires * 1000).toISOString(),
        },
      ],
    },
  };
}
test("v1 reservation and v2 exact caption project frozen application intent without ACK lifecycle", () => {
  for (const caption of [undefined, "  caption / Café 🌅\r\n  "]) {
    const source = row(caption),
      before = JSON.stringify(source),
      record = projectStrictMediaRecord(source, owner)!;
    expect(record).toMatchObject({
      id,
      chat_id: owner.leadId,
      status: "queued",
      service: "unknown",
      from: "+15550000001",
      to: "+15550000002",
      phone_line_id: line,
      line_number: "+15550000001",
      is_group: false,
      sent_at: null,
      native_guid: null,
      endpoint_source: "strict_media_intent",
    });
    expect(record.parts).toEqual(source.request_payload.message.parts);
    expect(record.created_at).toBe(source.created_at);
    expect(JSON.stringify(source)).toBe(before);
    source.response_payload.mac_media_dispatch_state = "acknowledged";
    source.response_payload.native_attachment_guids = [guid];
    expect(projectStrictMediaRecord(source, owner)).toMatchObject({
      status: "queued",
      native_guid: guid,
      delivered_at: null,
      read_at: null,
    });
  }
});
test("strong cached lifecycle is unknown without raw persisted owned proof; no fabricated occurrence clock", () => {
  for (const status of ["sent", "delivered", "read", "failed"]) {
    const source = row();
    Object.assign(source.response_payload, {
      status,
      service: "imessage",
      delivered: true,
      read: true,
      delivered_at: "2026-01-01T00:01:00Z",
      read_at: "2026-01-01T00:02:00Z",
    });
    expect(projectStrictMediaRecord(source, owner)).toMatchObject({
      status: "unknown",
      service: "unknown",
      delivered_at: null,
      read_at: null,
      sent_at: null,
    });
  }
  const source = row();
  source.response_payload.read = true;
  expect(projectStrictMediaRecord(source, owner)?.status).toBe("unknown");
});
test("ownership, canonical framing, caption hash and native identity contradictions refuse whole record", () => {
  const changes: Array<(r: Record<string, any>) => void> = [
    (r) => (r.tenant_id = "foreign"),
    (r) => (r.lead_id = "foreign"),
    (r) => (r.convo_id = "foreign"),
    (r) => (r.phone += "\n"),
    (r) => (r.phone_line_id += "\n"),
    (r) => (r.created_at = "2026-02-30T00:00:00Z"),
    (r) => (r.updated_at = "2026-01-01T00:00:00Z\n"),
    (r) => (r.response_payload.mac_media_origin = "media_" + id),
    (r) => (r.response_payload.mac_media_caption_sha256 = "d".repeat(64)),
    (r) => (r.request_payload.message.parts[0].value += "x"),
    (r) => (r.response_payload.mac_message_guids = [guid]),
    (r) => (r.response_payload.native_attachment_guids = [guid]),
    (r) => (r.response_payload.native_caption_outbox_ids = []),
    (r) => (r.response_payload.fallback_owner = "native"),
    (r) => r.request_payload.message.parts.reverse(),
  ];
  for (const change of changes) {
    const source = row("exact\r\n");
    change(source);
    expect(projectStrictMediaRecord(source, owner)).toBeNull();
  }
  for (const values of [[guid, guid.toLowerCase()], ["not-guid"], []]) {
    const source = row();
    source.response_payload.mac_media_dispatch_state = "acknowledged";
    source.response_payload.native_attachment_guids = values;
    expect(projectStrictMediaRecord(source, owner)).toBeNull();
  }
});
test("metadata is bounded and explicitly allowlisted, capabilities are not refreshed by projection", () => {
  const source = row();
  source.response_payload.attachments[0].native_guid = "PRIVATE";
  const result = projectStrictMediaRecord(source, owner)!;
  expect(Object.keys(result.attachments![0]).sort()).toEqual([
    "attachment_id",
    "content_type",
    "download_url",
    "download_url_expires_at",
    "filename",
    "size_bytes",
  ]);
  expect(result.attachments![0].download_url).toBe(
    source.response_payload.attachments[0].download_url
  );
  const changes: Array<(a: any) => void> = [
    (a) => (a.size_bytes = 0),
    (a) => (a.filename = "../private"),
    (a) => (a.content_type = "application/unknown"),
    (a) => (a.attachment_id = "e".repeat(48)),
    (a) => (a.download_url += "&tenant=foreign"),
    (a) => (a.download_url = a.download_url.replace(tenantId, "foreign")),
    (a) => (a.download_url_expires_at = "2026-02-30T00:00:00Z"),
    (a) =>
      (a.download_url = a.download_url.replace(
        "https://owned.example",
        "http://remote.example"
      )),
  ];
  for (const change of changes) {
    const r = row();
    change(r.response_payload.attachments[0]);
    expect(projectStrictMediaRecord(r, owner)).toBeNull();
  }
});

test("persisted bound native proof promotes history; lost ACK never becomes fabricated dispatch ACK", async () => {
  const { createMediaEvidence } = await import(
    "../../imessage-server/lib/messaging/media-evidence"
  );
  const source = row("  exact / caption\r\n  "),
    p = source.response_payload;
  const raw = {
    evidence_source: "chat_db_exact_guid",
    guid,
    recipient: source.phone,
    sender: p.mac_media_from,
    service: "imessage",
    has_attachments: true,
    is_sent: true,
    is_delivered: true,
    is_read: true,
    delivered_at: 1700000000000,
    read_at: 1700000001000,
  };
  p.mac_media_dispatch_state = "unconfirmed";
  p.mac_media_evidence = createMediaEvidence(
    {
      tenantId,
      leadId: owner.leadId,
      messageId: id,
      lineId: line,
      peer: source.phone,
      requestPayload: source.request_payload,
    },
    p,
    raw
  );
  Object.assign(p, {
    status: "read",
    service: "imessage",
    error: null,
    retryable: false,
    delivered: true,
    read: true,
    delivered_at: "2023-11-14T22:13:20.000Z",
    read_at: "2023-11-14T22:13:21.000Z",
  });
  const before = JSON.stringify(source);
  expect(projectStrictMediaRecord(source, owner)).toMatchObject({
    status: "read",
    service: "imessage",
    native_guid: guid,
    sent_at: null,
    delivered_at: p.delivered_at,
    read_at: p.read_at,
  });
  expect(JSON.stringify(source)).toBe(before);
  for (const patch of [
    { phone: "+15550000003" },
    { phone_line_id: "61000000-0000-4000-8000-000000000002" },
  ]) {
    expect(
      projectStrictMediaRecord({ ...source, ...patch }, owner)
    ).toMatchObject({
      status: "unknown",
      service: "unknown",
      delivered_at: null,
      read_at: null,
    });
  }
  p.mac_media_evidence = {
    ...p.mac_media_evidence,
    caption_sha256: "d".repeat(64),
  };
  expect(projectStrictMediaRecord(source, owner)).toMatchObject({
    status: "unknown",
    service: "unknown",
    delivered_at: null,
    read_at: null,
  });
});

test("frozen compatibility identity remains private and malformed markers cannot qualify history", () => {
  const source = row();
  source.response_payload.mac_idempotency_request = {
    version: 1, profile: "blooio-v4", route: "/v4/chats/lead-owned/messages", body_sha256: "d".repeat(64),
  };
  const record = projectStrictMediaRecord(source, owner);
  expect(record?.status).toBe("queued");
  expect(JSON.stringify(record)).not.toContain("mac_idempotency_request");
  expect(JSON.stringify(record)).not.toContain("body_sha256");
  for (const value of [null, {}, { ...source.response_payload.mac_idempotency_request, body_sha256: "bad" },
    { ...source.response_payload.mac_idempotency_request, route: "/v4/chats/%2F/messages" }]) {
    source.response_payload.mac_idempotency_request = value;
    expect(projectStrictMediaRecord(source, owner)).toBeNull();
  }
});
