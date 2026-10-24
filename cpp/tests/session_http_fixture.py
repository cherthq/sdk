"""Public proposed unified contract, two approved loopback service origins."""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

mode, requests, errors = "", [], []
scopes = ["imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send",
          "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        requests.append((self.server.channel, self.path))
        try:
            discovery = self.path == "/api/v1/sdk/capabilities"
            if discovery:
                assert self.server.channel == "im"
                assert self.headers.get("Authorization") is None
                assert self.headers.get("X-Chert-Contract") is None
                assert self.headers.get("X-Chert-Tenant") is None
                assert self.headers.get("X-Chert-Project-Id") is None
                data = dict(contract="chert-unified", contract_version=1,
                            auth=dict(scheme="Bearer", token_prefix="chu_", audience="chert.unified-api:v1",
                                      login_url=ft + "/api/v1/cli/logins"),
                            services=dict(imessage=dict(base_url=im + "/api/v1"), facetime=dict(base_url=ft + "/api/v1")),
                            scopes=scopes[:])
                if mode == "discovery-foreign": data["services"]["facetime"]["base_url"] = "https://example.com/api/v1"
                if mode == "discovery-login": data["auth"]["login_url"] = "https://example.com/api/v1/cli/logins"
                if mode == "discovery-version": data["contract_version"] = True
                if mode == "discovery-contract": data["contract"] = "other"
                if mode == "discovery-scope": data["scopes"].pop()
                if mode == "positive-extra": data["scopes"].append("future:scope")
                if mode == "discovery-duplicate": data["scopes"].append(scopes[0])
                if mode == "discovery-duplicate-extra": data["scopes"].extend(["future:scope"] * 2)
                malformed = {"discovery-null": None, "discovery-number": 1, "discovery-bool": True,
                             "discovery-object": {}, "discovery-array": []}
                if mode in malformed: data["scopes"].append(malformed[mode])
                if mode == "discovery-auth": data["auth"]["audience"] = "other"
                payload = json.dumps(dict(data=data)).encode()
                if mode == "discovery-large": payload = b" " * 65537
                if mode == "discovery-json": payload = b"not json"
                status = 404 if mode == "discovery-404" else 302 if mode == "discovery-redirect" else 200
            else:
                assert self.headers.get("Authorization") == "Bearer chu_" + "a" * 43
                assert self.headers.get("X-Chert-Contract") == "chert-unified-v1"
                assert self.headers.get("X-Chert-Tenant") is None
                assert self.headers.get("Last-Event-ID") is None
                if self.server.channel == "ft":
                    assert self.headers.get("X-Chert-Project-Id") == "11111111-1111-4111-8111-111111111111"
                    assert self.path == "/api/v1/probe"
                    payload = b'{"data":{"ok":true},"request_id":"probe"}'
                else:
                    assert self.headers.get("X-Chert-Project-Id") is None
                    assert self.path in ("/api/v1/events", "/api/v1/events?", "/api/v1/events/stream", "/api/v1/text-operations/v1")
                    payload = b'data: {}\r\n\r\n' if self.path.endswith("/stream") else b'{"count":0}'
                status = 200
                if self.path == "/api/v1/text-operations/v1":
                    assert self.command == "POST"
                    assert self.headers.get("Content-Type") == "application/json"
                    body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    assert body == dict(phone="+15550000002", body="Unified plaintext", idempotency_key="session-send-key")
                    status = 202
                    payload = json.dumps(dict(success=True, message_id="a" * 32, chat_id="chat-1", status="queued")).encode()
                else:
                    assert self.command == "GET"
                if mode.endswith("empty"): payload = b""
            if not discovery and mode == "positive-interim":
                self.wfile.write(b"HTTP/1.1 103 Early Hints\r\nX-Chert-Contract:\r\nX-Chert-Contract: ignored\r\n\r\n")
            self.send_response(status)
            if not discovery and mode.startswith("positive"): self.send_header("X-Chert-Contract", "chert-unified-v1")
            if not discovery and mode.endswith("wrong"): self.send_header("X-Chert-Contract", "CHERT-UNIFIED-V1")
            if not discovery and "-duplicate-" in mode:
                values = ("", "chert-unified-v1") if "-empty-first" in mode else ("chert-unified-v1", "")
                for value in values: self.send_header("X-Chert-Contract", value)
            if status == 302: self.send_header("Location", ft + "/must-not-follow")
            self.send_header("Content-Type", "text/event-stream" if self.path.endswith("/stream") else "application/json")
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            errors.append(repr(exc))

    do_POST = do_GET


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as ims, ThreadingHTTPServer(("127.0.0.1", 0), Handler) as fts:
    ims.channel, fts.channel = "im", "ft"
    im, ft = f"http://127.0.0.1:{ims.server_port}", f"http://127.0.0.1:{fts.server_port}"
    for server in (ims, fts): threading.Thread(target=server.serve_forever, daemon=True).start()
    for mode in ("positive", "positive-extra", "positive-interim", "invalid-token", "invalid-project", "invalid-origin",
                 "discovery-404", "discovery-redirect", "discovery-foreign", "discovery-login",
                 "discovery-version", "discovery-contract", "discovery-scope", "discovery-auth",
                 "discovery-large", "discovery-json", "im-missing", "im-wrong", "ft-missing", "ft-wrong",
                 "sse-missing", "sse-wrong", "im-empty", "ft-empty", "sse-empty", "send-missing", "send-wrong",
                 "discovery-duplicate", "discovery-duplicate-extra", "discovery-null", "discovery-number",
                 "discovery-bool", "discovery-object", "discovery-array") + tuple(
                     f"{channel}-duplicate-{order}{suffix}"
                     for channel in ("im", "ft", "sse")
                     for order in ("empty-first", "valid-first")
                     for suffix in ("", "-empty")):
        requests.clear()
        result = subprocess.run([sys.argv[1], im, ft, mode], timeout=20)
        assert result.returncode == 0 and not errors, (mode, errors)
        expected = 0 if mode.startswith("invalid-") else 1 if mode.startswith("discovery-") else 5 if mode.startswith("positive") else 2
        assert len(requests) == expected, (mode, requests)
    for server in (ims, fts): server.shutdown()
