import copy
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trychert import Chert, ChertAPIError, UnsupportedUnifiedBackend, UNIFIED_CONTRACT, UNIFIED_SCOPES

TOKEN = "chu_" + "a" * 43
PROJECT = "12345678-1234-1234-1234-123456789abc"
RECEIPT = {"success": True, "message_id": "a" * 32, "chat_id": "synthetic-chat", "status": "queued"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.server.posts.append((self.path, dict(self.headers), body))
        sending = self.path == "/api/v1/text-operations/v1"
        self.send_response(self.server.send_status if sending else 200)
        for echo in self.server.echo:
            self.send_header("X-Chert-Contract", echo)
        payload = json.dumps(RECEIPT if sending else {"data": {"revoked": True}}).encode()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.server.calls.append((self.path, dict(self.headers)))
        discovery = self.path == "/api/v1/sdk/capabilities"
        self.send_response(self.server.discovery_status if discovery else self.server.status)
        self.send_header("Location", self.server.origin + "/sink")
        if not discovery:
            for echo in self.server.echo:
                self.send_header("X-Chert-Contract", echo)
        stream = self.path.startswith("/api/v1/events/stream")
        self.send_header("Content-Type", "text/event-stream" if stream else "application/json")
        payload = self.server.descriptor if discovery else (b'data: {}\n\n' if stream else b'{"data":{},"events":[]}')
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


class SessionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servers = []
        for _ in range(2):
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            server.origin = f"http://127.0.0.1:{server.server_port}"
            server.thread = threading.Thread(target=server.serve_forever, daemon=True)
            server.thread.start()
            cls.servers.append(server)
        cls.messaging, cls.facetime = cls.servers

    @classmethod
    def tearDownClass(cls):
        for server in cls.servers:
            server.shutdown()
            server.server_close()
            server.thread.join()

    def setUp(self):
        self.descriptor = {"data": {"contract": "chert-unified", "contract_version": 1,
            "auth": {"scheme": "Bearer", "token_prefix": "chu_", "audience": "chert.unified-api:v1",
                     "login_url": self.facetime.origin + "/api/v1/cli/logins"},
            "services": {"imessage": {"base_url": self.messaging.origin + "/api/v1"},
                         "facetime": {"base_url": self.facetime.origin + "/api/v1"}},
            "scopes": list(UNIFIED_SCOPES)}}
        for server in self.servers:
            server.calls = []
            server.posts = []
            server.send_status = 202
            server.discovery_status = 200
            server.status = 200
            server.echo = [UNIFIED_CONTRACT]
            server.descriptor = json.dumps(self.descriptor).encode()

    def connect(self, token=TOKEN, project=PROJECT):
        return Chert.connect(token, project, imessage_base_url=self.messaging.origin,
                             facetime_base_url=self.facetime.origin)

    def test_discovery_before_token_and_both_channels_guarded(self):
        with patch.dict(os.environ, {"http_proxy": "http://127.0.0.1:1", "NO_PROXY": ""}):
            client = self.connect()
        self.assertEqual(len(self.messaging.calls), 1)
        self.assertEqual(self.facetime.calls, [])
        path, headers = self.messaging.calls[0]
        self.assertEqual(path, "/api/v1/sdk/capabilities")
        self.assertNotIn("Authorization", headers)
        self.assertNotIn("X-Chert-Tenant", headers)
        self.assertEqual(client.imessage.list_events()["events"], [])
        self.assertEqual(client.facetime.whoami(), {})
        self.assertEqual(list(client.imessage.stream_events()), [{"event": "message", "data": {}}])
        for _, headers in self.messaging.calls[1:] + self.facetime.calls:
            self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
            self.assertEqual(headers["X-Chert-Contract"], UNIFIED_CONTRACT)
            self.assertNotIn("X-Chert-Tenant", headers)
        self.assertEqual({key.lower(): value for key, value in self.facetime.calls[0][1].items()}
                         ["x-chert-project-id"], PROJECT)

    def test_invalid_credentials_never_make_any_request(self):
        for token, project in (("legacy-key", PROJECT), (TOKEN + "a", PROJECT),
                               (TOKEN + "\n", PROJECT), (TOKEN, "project"), (None, PROJECT)):
            with self.assertRaises(ValueError):
                self.connect(token, project)
        for server in self.servers:
            self.assertEqual(server.calls, [])

    def test_unified_send_text_preserves_route_receipt_and_contract_guard(self):
        client = self.connect()
        for key in (None, "synthetic-operation"):
            self.assertEqual(client.imessage.send_text("+15550000002", "Synthetic text", idempotency_key=key), RECEIPT)
            path, headers, body = self.messaging.posts[-1]
            self.assertEqual(path, "/api/v1/text-operations/v1")
            expected = {"phone": "+15550000002", "body": "Synthetic text"}
            if key is not None:
                expected["idempotency_key"] = key
            self.assertEqual(json.loads(body), expected)
            self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
            self.assertEqual(headers["X-Chert-Contract"], UNIFIED_CONTRACT)
            self.assertNotIn("X-Chert-Tenant", headers)
        self.messaging.echo = []
        with self.assertRaises(UnsupportedUnifiedBackend):
            client.imessage.send_text("+15550000002", "Synthetic text")
        self.messaging.echo = [UNIFIED_CONTRACT]
        self.messaging.send_status = 200
        with self.assertRaises(ChertAPIError) as caught:
            client.imessage.send_text("+15550000002", "Synthetic text")
        self.assertEqual(caught.exception.code, "unconfirmed_text_outcome")
        self.assertEqual(len(self.messaging.posts), 4, "one attempt per explicit send")
        self.assertEqual(client.facetime.logout(), {"revoked": True})
        path, headers, body = self.facetime.posts[0]
        self.assertEqual(path, "/api/v1/cli/logout")
        self.assertEqual(body, b"")
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(headers["X-Chert-Contract"], UNIFIED_CONTRACT)

    def test_invalid_origins_fail_before_discovery(self):
        for origin in ("", "http://foreign.example", "https://user:pass@example.test",
                       "https://example.test/path", "https://example.test?x=1"):
            with self.assertRaises(ValueError):
                Chert.connect(TOKEN, PROJECT, imessage_base_url=self.messaging.origin,
                              facetime_base_url=origin)
        self.assertEqual(self.messaging.calls, [])

    def test_foreign_or_incompatible_descriptors_never_transmit_token(self):
        mutations = [
            ("contract", "other"), ("contract_version", True), ("contract_version", 2),
            ("auth.scheme", "Basic"), ("auth.token_prefix", "old_"), ("auth.audience", "other"),
            ("auth.login_url", "https://foreign.example/api/v1/cli/logins"),
            ("services.imessage.base_url", "https://foreign.example/api/v1"),
            ("services.facetime.base_url", "https://foreign.example/api/v1"),
            ("scopes", " ".join(UNIFIED_SCOPES)),
        ]
        mutations.extend(("scopes", [scope for scope in UNIFIED_SCOPES if scope != missing])
                         for missing in UNIFIED_SCOPES)
        mutations.extend(("scopes", list(UNIFIED_SCOPES) + [invalid])
                         for invalid in (None, True, 1, 1.5, [], {}))
        mutations.extend(("scopes", list(UNIFIED_SCOPES) + extra) for extra in
                         ([UNIFIED_SCOPES[0]], ["future:scope", "future:scope"]))
        for key, value in mutations:
            descriptor = copy.deepcopy(self.descriptor)
            target = descriptor["data"]
            fields = key.split(".")
            for field in fields[:-1]:
                target = target[field]
            target[fields[-1]] = value
            self.messaging.descriptor = json.dumps(descriptor).encode()
            with self.subTest(key=key), self.assertRaises(UnsupportedUnifiedBackend) as caught:
                self.connect()
            self.assertNotIn(TOKEN, str(caught.exception))
            self.assertIsNone(caught.exception.__context__)
        self.assertEqual(self.facetime.calls, [])
        for _, headers in self.messaging.calls:
            self.assertNotIn("Authorization", headers)

    def test_unique_unknown_scopes_are_forward_compatible(self):
        self.descriptor["data"]["scopes"].extend(["future:scope", "another:scope"])
        self.messaging.descriptor = json.dumps(self.descriptor).encode()
        client = self.connect()
        self.assertEqual(client.imessage.list_events()["events"], [])
        self.assertNotIn("Authorization", self.messaging.calls[0][1])
        self.assertEqual(self.messaging.calls[1][1]["Authorization"], "Bearer " + TOKEN)

    def test_old_backend_redirect_malformed_and_oversize_fail_closed(self):
        for status, body in ((404, b'{}'), (307, b'{}'), (200, b'not JSON'),
                             (200, b'[]'), (200, b'{"data":null}'), (200, b' ' * 65_537)):
            self.messaging.discovery_status, self.messaging.descriptor = status, body
            with self.assertRaises(UnsupportedUnifiedBackend):
                self.connect()
        self.assertEqual(len(self.messaging.calls), 6)
        self.assertEqual(self.facetime.calls, [])
        for path, headers in self.messaging.calls:
            self.assertEqual(path, "/api/v1/sdk/capabilities")
            self.assertNotIn("Authorization", headers)

    def test_missing_wrong_duplicate_echo_prevents_parse_or_yield(self):
        client = self.connect()
        for echo in ([], ["wrong"], [UNIFIED_CONTRACT, UNIFIED_CONTRACT]):
            for server in self.servers:
                server.echo = echo
            for operation in (client.imessage.list_events, client.facetime.whoami,
                              lambda: list(client.imessage.stream_events())):
                with self.subTest(echo=echo), patch("chert.json.loads", side_effect=AssertionError("parsed before echo")):
                    with self.assertRaises(UnsupportedUnifiedBackend) as caught:
                        operation()
                self.assertIsNone(caught.exception.__context__)
        self.assertEqual(len(self.messaging.calls), 7)
        self.assertEqual(len(self.facetime.calls), 3)

    def test_unified_redirect_does_not_follow_or_retry(self):
        client = self.connect()
        self.messaging.status = 307
        self.messaging.echo = []
        with self.assertRaises(UnsupportedUnifiedBackend):
            client.imessage.list_events()
        self.assertEqual(len(self.messaging.calls), 2)
        self.assertEqual(self.messaging.calls[-1][0], "/api/v1/events")


if __name__ == "__main__":
    unittest.main()
