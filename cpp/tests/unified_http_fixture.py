"""Two loopback HTTP origins with synthetic public API responses and credentials."""
import collections
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

PROJECT = "11111111-1111-4111-8111-111111111111"
CALL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
LINE = "22222222-2222-4222-8222-222222222222"
counts = collections.Counter()
errors = []
creates = []


def call():
    return dict(id=CALL, project_id=PROJECT, direction="outbound", mode="customer_managed",
                status="future_status", media=dict(audio=True, video=False), line_id=LINE,
                worker_id=None, assistant_id=None, terminal_reason=None,
                future_extension={"nested": ["preserved"]})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self):
        counts[(self.server.channel, self.command, self.path)] += 1
        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            body = json.loads(raw) if raw else None
            assert self.headers.get("Expect") is None
            assert self.headers.get("Accept") == "application/json"
            if raw:
                assert self.headers.get("Content-Type") == "application/json"
            if self.server.channel == "imessage":
                assert self.path in ("/api/v1/send", "/custom/api/v1/send") and self.command == "POST"
                assert self.headers.get("Authorization") == "Bearer im-secret"
                assert self.headers.get("X-Chert-Tenant") == "im-tenant"
                assert self.headers.get("X-Chert-Project-Id") is None
                assert body == {"phone": "+15550000002", "body": "separate transport", "idempotency_key": "text-key"}
                self.reply(200, {"status": "sent", "message_id": "550e8400-e29b-41d4-a716-446655440000", "chat_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                                 "lead_id": "6f1c2a5e-9b0d-4c3e-8a7f-1d2e3f4a5b6c", "lead_created": False, "convo_id": "convo-0001", "phone_line_id": "line-0001"})
                return
            assert self.headers.get("Authorization") == "Bearer ft-secret"
            assert self.headers.get("X-Chert-Project-Id") == PROJECT
            assert self.headers.get("X-Chert-Tenant") is None
            parsed = urlsplit(self.path)
            case = "normal"
            path = parsed.path.removeprefix("/deployment/api/v1")
            if parsed.path.startswith(("/api/v1/", "/custom/api/v1/")):
                path = parsed.path.removeprefix("/custom").removeprefix("/api/v1")
            if parsed.path.startswith("/case/"):
                _, _, case, tail = parsed.path.split("/", 3)
                path = "/" + tail
            data, status = call(), 200
            if path in ("/calls", "/lines", "/workers") and self.command == "GET":
                query = parse_qs(parsed.query)
                limit, offset = int(query["limit"][0]), int(query["offset"][0])
                item = call() if path == "/calls" else dict(id=LINE, display_name="Line", status="offline",
                                                           supports_audio=True, supports_video=True)
                data = dict(items=[item], total=19, limit=limit, offset=offset)
            elif path == "/calls" and self.command == "POST":
                assert self.headers.get("Idempotency-Key") is not None
                assert body["direction"] == "outbound" and body["authorized_test_call"] is False
                assert body["line_id"] == LINE and body["media"]["audio"] is True
                if case == "normal":
                    creates.append((self.headers["Idempotency-Key"], body))
                data.update(mode=body["mode"], media=body["media"], assistant_id=body.get("assistant_id"))
                status = 201
            elif path.endswith(("/answer", "/reject", "/end")):
                assert self.command == "POST" and self.headers["Idempotency-Key"] == "action-key"
                assert body == ({"reason": "reason"} if case == "normal" else {})
                status = 202
            elif path == f"/calls/{CALL}/events":
                data = dict(call_id=CALL, events=[dict(id="event-1", type="queued", at="2026-10-23T00:00:00Z", sequence=None, source="api"),
                                                dict(id="event-2", type="future_event", at="2026-10-23T00:00:01Z", sequence=42, source="service")])
            elif path == f"/calls/{CALL}/transcript":
                data = dict(call_id=CALL, schema_version=1, created_at="2026-10-23T00:00:00Z",
                            turns=[dict(occurred_at="2026-10-23T00:00:01Z", speaker="caller", text="hello"),
                                   dict(occurred_at="2026-10-23T00:00:02Z", speaker="agent", text="héllo")])
            elif path == f"/lines/{LINE}":
                assert self.command == "PATCH"
                assert body == dict(display_name="New line", default_assistant_id=None, integration_id=PROJECT,
                                    inbound_policy="customer_decides", video_framing="fill",
                                    connecting_screen_dismissal="video", connecting_screen_appearance="black")
                data = dict(id=LINE, display_name="New line", status="offline", supports_audio=True, supports_video=True)
            elif path == "/raw":
                data = None if raw == b"null" else {"method": self.command}
            else:
                assert path == f"/calls/{CALL}" and self.command == "GET", path
            if case == "wrong-id": data["id"] = PROJECT
            if case == "wrong-project": data["project_id"] = LINE
            if case == "missing-field": del data["status"]
            if case == "bad-bool": data["media"]["audio"] = 1
            if case == "null-data": data = None
            if case == "wrong-status": status = 203
            if case == "bad-page": data["limit"] = 0
            if case == "float-page": data["total"] = 1.5
            if case == "huge-page": data["offset"] = 2**64 - 1
            if case == "negative-page": data["total"] = -1
            if case == "object-items": data["items"] = {}
            if case == "bad-event": data["events"][0]["sequence"] = "42"
            if case == "bad-transcript": data["schema_version"] = True
            envelope = {"data": data, "request_id": "body-request-id"}
            if case == "missing-envelope": envelope = data
            if case == "missing-request-id": del envelope["request_id"]
            if case == "error-envelope": envelope["error"] = {"code": "private"}
            if case.startswith("error-") and case[6:].isdigit():
                status = int(case.split("-")[1])
                envelope = {"error": {"code": "server_code", "message": "private-secret"}, "request_id": "body-request-id"}
            if case == "empty": self.reply(204, b""); return
            if case == "html": self.reply(200, b"private-secret"); return
            if case == "redirect": self.reply(307, {}, {"Location": "/redirect-sink"}); return
            if case == "drop": self.connection.close(); return
            if case == "large": self.reply(200, b'"' + b"x" * (8 * 1024 * 1024 + 1) + b'"'); return
            if case == "slow": time.sleep(0.2)
            self.reply(status, envelope)
        except Exception as error:
            errors.append(repr(error))
            self.reply(500, {"error": {"code": "fixture_failure"}})

    def reply(self, status, data, headers=None):
        payload = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Request-Id", "header-request-id")
        for name, value in (headers or {}).items(): self.send_header(name, value)
        self.end_headers()
        try: self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError): pass

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = respond


servers = [ThreadingHTTPServer(("127.0.0.1", 0), Handler) for _ in range(2)]
threads = []
for server, channel in zip(servers, ("imessage", "facetime")):
    server.channel = channel
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    threads.append(thread)
try:
    result = subprocess.run([sys.argv[1], *[f"http://127.0.0.1:{s.server_port}" for s in servers]],
                            env=dict(os.environ, http_proxy="http://127.0.0.1:1", NO_PROXY=""), timeout=30)
    assert not errors, errors
    assert result.returncode == 0, result.returncode
    assert len(creates) == 9
    audio = {"direction": "outbound", "mode": "customer_managed", "line_id": LINE, "destination": "+15550000002",
             "destination_type": "phone", "media": {"audio": True, "video": False}, "authorized_test_call": False,
             "livekit_url": "wss://room.example.test", "participant_token": "private-room-token", "remote_participant_identity": "agent-identity"}
    assert creates[0] == ("call-key", audio)
    assert creates[1] == ("k" * 200, {**audio, "media": {"audio": True, "video": True}})
    managed = {k: v for k, v in audio.items() if k not in ("livekit_url", "participant_token", "remote_participant_identity")}
    direct = {**managed, "media_transport": "direct", "media_url": "wss://media.example.test/direct/room", "media_token": "private-media-token"}
    assert creates[2] == ("direct-key", direct)
    assert creates[3] == ("direct-loopback-key", {**direct, "media_url": "ws://127.0.0.1:8787/media", "remote_participant_identity": "agent-identity"})
    assert creates[4] == ("direct-upper-key", {**direct, "media_url": "WSS://media.example.test/direct/room"})
    assert creates[5] == ("direct-localhost-key", {**direct, "media_url": "ws://LOCALHOST:8787/media"})
    managed.update(mode="managed", assistant_id=PROJECT, media={"audio": True, "video": True})
    assert creates[6] == ("managed-key", managed)
    group = {k: v for k, v in managed.items() if k not in ("destination", "destination_type")}
    group["recipients"] = [{"type": "email", "value": "a@example.test"}, {"type": "phone_number", "value": "+15550000002"}]
    assert creates[7] == ("group-key", group)
    assert creates[8] == ("link-key", {**managed, "destination": "https://facetime.apple.com/join#a", "destination_type": "facetime_link"})
    expected = {("imessage", "POST", "/api/v1/send"): 5,
                ("imessage", "POST", "/custom/api/v1/send"): 1,
                ("facetime", "GET", "/api/v1/lines?limit=1&offset=9"): 4,
                ("facetime", "GET", "/custom/api/v1/lines?limit=1&offset=9"): 1}
    normal = [("GET", "/calls?limit=2&offset=7"), ("GET", f"/calls/{CALL}"), ("GET", "/lines?limit=1&offset=9"),
              ("GET", "/workers?limit=100&offset=3"), ("GET", f"/calls/{CALL}/events"), ("GET", f"/calls/{CALL}/transcript"),
              ("PATCH", f"/lines/{LINE}"), *[("POST", f"/calls/{CALL}/{a}") for a in ("answer", "reject", "end")],
              *[(m, "/raw") for m in ("GET", "POST", "PUT", "PATCH", "DELETE")]]
    expected.update({("facetime", m, "/deployment/api/v1" + p): 1 for m, p in normal})
    expected[("facetime", "POST", "/deployment/api/v1/calls")] = 9
    cases = [(n, "GET", f"/calls/{CALL}") for n in ("wrong-id", "wrong-project", "missing-field", "bad-bool", "null-data", "wrong-status")]
    cases += [(n, "GET", "/calls?limit=50&offset=0") for n in ("bad-page", "float-page", "huge-page", "negative-page", "object-items")]
    cases += [("bad-event", "GET", f"/calls/{CALL}/events"), ("bad-transcript", "GET", f"/calls/{CALL}/transcript"),
              ("wrong-id", "PATCH", f"/lines/{LINE}"), ("wrong-status", "POST", "/calls"), ("wrong-status", "POST", f"/calls/{CALL}/end")]
    cases += [(n, "GET", "/raw") for n in ("missing-envelope", "missing-request-id", "error-envelope", "empty", "html")]
    cases += [(f"error-{s}", "POST", "/raw") for s in (401, 403, 404, 409, 422, 429, 503)]
    cases += [(n, "POST", "/raw") for n in ("redirect", "drop", "large", "slow")]
    expected.update({("facetime", m, f"/case/{n}{p}"): 1 for n, m, p in cases})
    assert counts == expected, (counts - collections.Counter(expected), collections.Counter(expected) - counts)
    print(f"Verified {sum(counts.values())} exact requests across two origins; no credential crossover, retries or invalid-input dispatch")
finally:
    for server in servers: server.shutdown(); server.server_close()
    for thread in threads: thread.join(timeout=2)
