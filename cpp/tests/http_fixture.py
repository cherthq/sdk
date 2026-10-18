"""Local synthetic HTTP boundary; no Chert device or cloud mutation."""
import collections
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

counts = collections.Counter()
expect_headers = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def do_HEAD(self):
        self.respond()

    def respond(self):
        counts[self.path] += 1
        length = int(self.headers.get("Content-Length", "0"))
        path = self.path.rsplit("/", 1)[-1]
        if path == "expect":
            expect_headers.append(self.headers.get("Expect"))
        if path == "expect" and counts[self.path] == 1:
            # Reject before the body, as a server which disallows Expect does.
            body = b'{"error":{"code":"expectation_failed"}}'
            self.send_response(417)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            self.connection.settimeout(2)
            try:
                self.rfile.read(length)
            except (TimeoutError, ConnectionResetError):
                pass
            return
        raw = self.rfile.read(length).decode()
        status = 200
        headers = {}
        if path == "slow":
            time.sleep(0.2)
        if path == "drop":
            self.connection.close()
            return
        if path == "head":
            body = b""
        elif path == "expect":
            status = 417 if counts[self.path] == 1 else 200
            body = b'{"error":{"code":"expectation_failed"}}'
        elif path == "redirect":
            status, headers = 307, {"Location": "/sink"}
            body = b'{"redirect":true}'
        elif path == "error":
            status, headers = 502, {"X-Trace-Id": "trace-fixture", "X-Request-Id": "secondary"}
            body = b'{"error":{"code":4103,"message":"private-message"}}'
        elif path == "logical":
            body = b'{"success":false,"error":{"code":"denied","message":"private-message"}}'
        elif path == "empty":
            status, body = 204, b""
        elif path == "null":
            body = b"null"
        elif path == "nonjson":
            body = b"private-message"
        elif path == "badjson":
            body = b'{"broken":'
        elif path == "large":
            body = b'"' + b"a" * (8 * 1024 * 1024 + 1) + b'"'
        else:
            body = json.dumps({"method": self.command, "body": json.loads(raw) if raw else None,
                               "raw": raw, "authorization": self.headers.get("Authorization"),
                               "tenant": self.headers.get("X-Chert-Tenant")}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    # Ambient proxy credentials must never select the SDK's destination.
    environment = dict(os.environ, http_proxy="http://127.0.0.1:1", HTTPS_PROXY="http://127.0.0.1:1", NO_PROXY="")
    subprocess.run([sys.argv[1], f"http://127.0.0.1:{server.server_port}"], env=environment, check=True, timeout=20)
    assert expect_headers == [None], expect_headers
    assert counts == {"/deployment/api/v1/echo?limit=1": 1, "/deployment/api/v1/echo": 2,
                      **{f"/deployment/api/v1/{path}": 1 for path in (
                          "empty", "null", "head", "expect", "error", "logical", "nonjson", "badjson", "redirect", "large", "drop")},
                      "/api/v1/slow": 1}, counts
    print("No redirect-sink, traversal, authentication override or repeated POST requests")
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
