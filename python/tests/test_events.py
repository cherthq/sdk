import hashlib
import hmac
import json
from pathlib import Path
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trychert import ChertClient, ChertAPIError, verify_webhook


EVENT = {"id": "row-1", "type": "message.received", "event_id": "evt-1", "lead_id": None,
         "convo_id": None, "payload": {"text": "synthetic"}, "created_at": "2026-01-01T00:00:00Z",
         "delivery": {"status": "pending", "url": None, "attempts": [], "delivered_at": None}}
SUB = {"id": "sub-1", "url": "https://example.test/hook", "events": ["message.received"],
       "version": "v1", "is_active": True, "created_at": "2026-01-01T00:00:00Z"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.server.calls.append((self.command, self.path, dict(self.headers), body))
        path = urlsplit(self.path).path
        if path.endswith("/events/stream"):
            self.send_response(self.server.status)
            self.send_header("Content-Type", self.server.content_type)
            if self.server.status == 307:
                self.send_header("Location", "/sink")
            self.end_headers()
            try:
                for chunk in self.server.chunks:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                if self.server.wait_close:
                    self.connection.settimeout(2)
                    if self.connection.recv(1) == b"":
                        self.server.closed.set()
            except (BrokenPipeError, ConnectionResetError):
                self.server.closed.set()
            except socket.timeout:
                pass
            return
        if path.endswith("/events"):
            result = {"events": [EVENT], "next_cursor": "opaque+/=:token", "count": 1}
        elif "/events/" in path:
            result = EVENT
        elif self.command == "DELETE":
            result = {"deleted": True, "id": "sub-1"}
        elif self.command == "POST":
            result = {"subscription": {**SUB, "secret": "synthetic-secret"}}
        elif path.endswith("/webhook-subscriptions"):
            result = {"subscriptions": [SUB]}
        else:
            result = {"subscription": SUB}
        payload = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_POST = do_GET
    do_PATCH = do_GET
    do_DELETE = do_GET


class EventsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.server.calls = []
        self.server.chunks = [b'data: {}\n\n']
        self.server.status = 200
        self.server.content_type = "text/event-stream; charset=utf-8"
        self.server.wait_close = False
        self.server.closed = threading.Event()
        self.client = ChertClient(self.base, "synthetic-key", "synthetic-tenant")

    def test_event_routes_query_auth_and_raw_response(self):
        query = {"type": "message.received", "status": "pending", "lead_id": "lead+1",
                 "since": "2026-01-01T00:00:00Z", "cursor": "opaque+/=:token", "limit": 200}
        page = self.client.list_events(**query)
        self.assertEqual(page, {"events": [EVENT], "next_cursor": "opaque+/=:token", "count": 1})
        self.assertEqual(parse_qs(urlsplit(self.server.calls[0][1]).query),
                         {key: [str(value)] for key, value in query.items()})
        self.assertEqual(self.client.get_event("row-1"), EVENT)
        self.assertEqual(self.server.calls[1][1], "/api/v1/events/row-1")
        for method, path, headers, body in self.server.calls:
            self.assertEqual(method, "GET")
            self.assertEqual(headers["Authorization"], "Bearer synthetic-key")
            self.assertEqual(headers["X-Chert-Tenant"], "synthetic-tenant")
            self.assertEqual(body, b"")

    def test_subscription_crud(self):
        self.assertEqual(self.client.list_webhook_subscriptions(), {"subscriptions": [SUB]})
        self.assertEqual(self.client.get_webhook_subscription("sub-1"), {"subscription": SUB})
        create = {"url": SUB["url"], "events": SUB["events"], "version": "v1"}
        self.assertEqual(self.client.create_webhook_subscription(create)["subscription"]["secret"], "synthetic-secret")
        update = {**create, "is_active": False}
        self.assertEqual(self.client.update_webhook_subscription("sub-1", update), {"subscription": SUB})
        self.assertEqual(self.client.delete_webhook_subscription("sub-1"), {"deleted": True, "id": "sub-1"})
        self.assertEqual([call[0] for call in self.server.calls], ["GET", "GET", "POST", "PATCH", "DELETE"])
        self.assertEqual(json.loads(self.server.calls[2][3]), create)
        self.assertEqual(json.loads(self.server.calls[3][3]), update)

    def test_input_validation_and_existing_response_bound(self):
        for value in (0, 201, True, 1.5):
            with self.assertRaises(ValueError):
                self.client.list_events(limit=value)
        for value in ("", "..", "a/b", "a?x", "%2f"):
            with self.assertRaises(ValueError):
                self.client.get_event(value)
        with self.assertRaises(ValueError):
            list(self.client.stream_events(since="x" * 16384))
        self.assertEqual(self.server.calls, [])
        with self.assertRaises(ChertAPIError) as caught:
            ChertClient(self.base, "key", max_response_bytes=10).list_events()
        self.assertEqual(caught.exception.code, "response_too_large")

    def test_stream_fragmentation_named_frames_and_single_connection(self):
        raw = (': heartbeat\r\ndata: {"text":\r\ndata: "☃"}\r\n\r\n'
               'event: error\ndata: {"code":"lag"}\n\n'
               'event: close\rdata: {"reconnect_with_since":"opaque+/="}\r\r'
               'data: {"ignored":true}\n\n').encode()
        self.server.chunks = [bytes([byte]) for byte in raw]
        frames = list(self.client.stream_events(since="opaque+/=:token"))
        self.assertEqual(frames, [{"event": "message", "data": {"text": "☃"}},
                                 {"event": "error", "data": {"code": "lag"}},
                                 {"event": "close", "data": {"reconnect_with_since": "opaque+/="}}])
        self.assertEqual(len(self.server.calls), 1)
        _, path, headers, _ = self.server.calls[0]
        self.assertEqual(parse_qs(urlsplit(path).query), {"since": ["opaque+/=:token"]})
        self.assertEqual(headers["Accept"], "text/event-stream")
        self.assertEqual(headers["Authorization"], "Bearer synthetic-key")
        self.assertEqual(headers["X-Chert-Tenant"], "synthetic-tenant")
        self.assertNotIn("Last-Event-Id", headers)

    def test_stream_invalid_frames_are_sanitized_and_bounded(self):
        for raw in (b'data: not-json\n\n', b'data: "\xff"\n\n', b'data: "\xe2',
                    b'data: NaN\n\n', b'data: 1e400\n\n', b':' + b'x' * (1024 * 1024)):
            with self.subTest(raw=raw[:30]):
                self.server.chunks = [raw]
                with self.assertRaises(ChertAPIError) as caught:
                    list(self.client.stream_events())
                self.assertEqual(caught.exception.code, "invalid_event_stream")
                self.assertIsNone(caught.exception.__context__)
                self.assertIsNone(caught.exception.data)
        self.assertEqual(len(self.server.calls), 6)

    def test_stream_eof_incomplete_frame_and_comments_are_not_events(self):
        self.server.chunks = [b': heartbeat\n\ndata: {"not-dispatched":true}']
        self.assertEqual(list(self.client.stream_events()), [])
        self.assertEqual(len(self.server.calls), 1)

    def test_exact_frame_limits_and_consecutive_crlf(self):
        limit = 1024 * 1024
        for newline in (b'\n', b'\r\n', b'\r'):
            for extra in (0, 1):
                with self.subTest(newline=newline, extra=extra):
                    padding = limit - len(b'data: ""') - 2 * len(newline) + extra
                    frame = b'data: "' + b'x' * padding + b'"' + newline * 2
                    self.assertEqual(len(frame), limit + extra)
                    self.server.chunks = [b'data: {}\r\n\r\n', frame, frame]
                    if extra:
                        with self.assertRaises(ChertAPIError) as caught:
                            list(self.client.stream_events())
                        self.assertEqual(caught.exception.code, "invalid_event_stream")
                    else:
                        frames = list(self.client.stream_events())
                        self.assertEqual(len(frames), 3)
                        self.assertEqual([len(item['data']) for item in frames[1:]], [padding, padding])

    def test_split_crlf_boundaries_and_comment_budget(self):
        from chert.events import _read_event_stream
        # Deterministic read boundaries: TCP is allowed to coalesce server writes.
        class FragmentedResponse:
            def __init__(self, chunks):
                self.chunks = iter(chunks)

            def read1(self, size):
                return next(self.chunks, b'')

        limit = 1024 * 1024
        for extra in (0, 1):
            chunks = [b'data: {}\r', b'\n\r', b'\n',
                      b'data: "' + b'x' * (limit - 12 + extra) + b'"\r', b'\n\r', b'\n']
            if extra:
                with self.assertRaises(ValueError):
                    list(_read_event_stream(FragmentedResponse(chunks)))
            else:
                frames = list(_read_event_stream(FragmentedResponse(chunks * 2)))
                self.assertEqual(len(frames), 4)
                self.assertEqual(len(frames[1]['data']), limit - 12)
            comment = b':' + b'x' * (limit - 5 + extra)
            response = FragmentedResponse([comment + b'\r', b'\n\r', b'\n'])
            if extra:
                with self.assertRaises(ValueError):
                    list(_read_event_stream(response))
            else:
                self.assertEqual(list(_read_event_stream(response)), [])
        self.assertEqual(list(_read_event_stream(FragmentedResponse([b'data: {}\r\r']))),
                         [{"event": "message", "data": {}}])

    def test_close_iterator_closes_live_connection(self):
        self.server.wait_close = True
        stream = self.client.stream_events()
        self.assertEqual(next(stream), {"event": "message", "data": {}})
        stream.close()
        self.assertTrue(self.server.closed.wait(3), "server must observe socket close")
        self.assertEqual(len(self.server.calls), 1)

    def test_stream_redirect_http_error_and_content_type(self):
        for status, content_type, code in ((307, "text/event-stream", "redirect_blocked"),
                                          (401, "text/event-stream", "stream_unavailable"),
                                          (200, "application/json", "stream_unavailable")):
            self.server.status, self.server.content_type = status, content_type
            with self.assertRaises(ChertAPIError) as caught:
                list(self.client.stream_events())
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(len(self.server.calls), 3)

    def test_webhook_signature_exact_bytes_tamper_and_time_window(self):
        body = b'{"synthetic": "\xe2\x98\x83"}'
        def signature(timestamp, raw=body, secret="fixture-secret"):
            digest = hmac.new(secret.encode(), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
            return f"v1,{timestamp},{digest}"
        with patch("chert.events.time.time", return_value=1800000000):
            for offset in (-300, 0, 300):
                self.assertTrue(verify_webhook(body, signature(1800000000 + offset), "fixture-secret"))
            for offset in (-301, 301):
                self.assertFalse(verify_webhook(body, signature(1800000000 + offset), "fixture-secret"))
            valid = signature(1800000000)
            self.assertTrue(verify_webhook(body.decode(), valid, "fixture-secret"))
            self.assertFalse(verify_webhook(body + b" ", valid, "fixture-secret"))
            self.assertFalse(verify_webhook(body, valid, "wrong-secret"))
            self.assertFalse(verify_webhook(body, valid, ""))
            for invalid in (valid + "\n", valid.replace("v1", "v2"), "v1,1,00", valid[:-1] + "z"):
                self.assertFalse(verify_webhook(body, invalid, "fixture-secret"))
            # Authentication is independent of JSON validity; parsing is the caller's next step.
            self.assertTrue(verify_webhook(b"not JSON", signature(1800000000, b"not JSON"), "fixture-secret"))


if __name__ == "__main__":
    unittest.main()
