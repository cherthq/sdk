"""Synthetic public event contracts; no external service or credentials."""
import json
import subprocess
import sys
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

errors, counts = [], Counter()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self):
        counts[(self.command, self.path)] += 1
        try:
            assert self.headers.get("Authorization") == "Bearer secret"
            assert self.headers.get("X-Chert-Tenant") == "tenant"
            assert self.headers.get("Last-Event-ID") is None
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            path = parsed.path
            if path == "/api/v1/events/stream":
                assert self.headers.get("Accept") == "text/event-stream"
                kind = query["since"][0]
                assert kind != "pre-cancel"
                if kind in ("redirect", "denied"):
                    self.send_response(302 if kind == "redirect" else 403)
                    self.send_header("Location", "/must-not-follow")
                    self.end_headers()
                    self.wfile.write(b'{"error":{"code":"denied"}}')
                    return
                self.send_response(200)
                content_type = "text/event-stream"
                if kind.startswith("mixed-case"):
                    content_type = "Text/Event-Stream; charset=utf-8"
                elif kind.startswith("wrong-type"):
                    content_type = "application/json"
                self.send_header("Content-Type", content_type)
                self.end_headers()
                if kind in ("mixed-case-empty", "wrong-type-empty"):
                    return
                if kind.startswith("boundary-") or kind == "consecutive":
                    event, delta = (kind.removeprefix("boundary-").split(":")
                                    if kind != "consecutive" else ("message", "0"))
                    suffix = (b"\r\n" + (b"event: close\r\n" if event == "close" else b"")
                              + b"data: {}\r\n\r\n")
                    frame = b":" + b"x" * (1024 * 1024 + int(delta) - 1 - len(suffix)) + suffix
                    assert len(frame) == 1024 * 1024 + int(delta)
                    for _ in range(2 if kind == "consecutive" else 1):
                        # Force the final CR and LF through separate writes.
                        self.wfile.write(frame[:-1])
                        self.wfile.flush()
                        self.wfile.write(frame[-1:])
                        self.wfile.flush()
                    return
                if kind == "bare-cr-eof":
                    self.wfile.write(b"event: close\rdata: {}\r\r")
                    return
                if kind == "comments-large":
                    self.wfile.write(b": \r\n" * 300000 + b'data: {}\r\n\r\n')
                    return
                if kind == "idle":
                    time.sleep(2)
                    return
                if kind == "large":
                    self.wfile.write(b":" + b"x" * (1024 * 1024))
                    return
                if kind in ("invalid", "utf8"):
                    self.wfile.write(b"data: nope\n\n" if kind == "invalid" else b"data: \xff\n\n")
                    return
                payload = (': heartbeat\r\n\r\ndata: {"text":\r\ndata: "héllo"}\r\n\r\n'
                           'event: error\ndata: {"code":"preview"}\n\n'
                           'event: close\rdata: {"since":"opaque"}\r\r'
                           'data: {"unterminated":true}').encode()
                for byte in payload:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                return
            assert self.headers.get("Accept") == "application/json"
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            body = json.loads(raw) if raw else None
            if path == "/api/v1/events":
                assert query == dict(type=["message.received"], status=["delivered"], lead_id=["lead"],
                                     since=["opaque +/é"], cursor=["a&b"], limit=["200"])
                data = dict(events=[], count=0, next_cursor=None)
            elif path == "/api/v1/events/row-1":
                data = dict(id="row-1")
            elif path == "/api/v1/webhook-subscriptions":
                if self.command == "POST":
                    assert body == dict(url="https://example.com/hook")
                    data = dict(subscription=dict(secret="once"))
                else:
                    data = dict(subscriptions=[])
            elif path == "/api/v1/webhook-subscriptions/sub-1":
                if self.command == "PATCH":
                    assert body == dict(is_active=False, events=[])
                data = dict(deleted=True, id="sub-1") if self.command == "DELETE" else dict(subscription={})
            else:
                raise AssertionError("Unexpected route")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            errors.append(repr(exc))
            self.send_error(500)

    do_GET = do_POST = do_PATCH = do_DELETE = respond


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    result = subprocess.run([sys.argv[1], f"http://127.0.0.1:{server.server_port}"], timeout=20)
    server.shutdown()
assert result.returncode == 0 and not errors, errors
assert len(counts) == 29 and all(count == 1 for count in counts.values()), counts
