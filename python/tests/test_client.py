import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chert import ChertClient, ChertAPIError

SECRET = "synthetic-key:literal+/"
PRIVATE = "private-response-content-and-token"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        record = {"path": self.path, "method": self.command, "body": body.decode(),
                  "authorization": self.headers.get("Authorization"), "tenant": self.headers.get("X-Chert-Tenant")}
        self.server.calls.append(record)
        status, headers = 200, {"Content-Type": "application/json"}
        path = self.path.split("?", 1)[0]
        if path.endswith("/redirect"):
            status, payload = 307, b""
            headers["Location"] = "/api/v1/sink"
        elif path.endswith("/empty"):
            status, payload = 204, b""
        elif path.endswith("/slow"):
            time.sleep(0.15)
            payload = b"{}"
        elif path.endswith("/nested-error"):
            status = 503
            headers["X-Trace-ID"] = "trace-observed"
            payload = json.dumps({"success": False, "error": {"code": 4103, "message": PRIVATE}}).encode()
        elif path.endswith("/flat-error"):
            status = 502
            headers["X-Request-ID"] = "request-observed"
            payload = json.dumps({"error": PRIVATE, "code": 4104}).encode()
        elif path.endswith("/logical-error"):
            payload = json.dumps({"success": False, "error": {"code": "failure", "message": PRIVATE}}).encode()
        elif path.endswith("/html"):
            payload = PRIVATE.encode()
        elif path.endswith("/malformed"):
            payload = b'{"secret":"' + PRIVATE.encode()
        elif path.endswith("/deep"):
            depth = sys.getrecursionlimit() + 100
            payload = b"[" * depth + json.dumps(PRIVATE).encode() + b"]" * depth
        elif path.endswith("/overflow"):
            payload = b'{"value":1e400}'
        elif path.endswith("/huge-code"):
            status = 502
            payload = json.dumps({"code": 10 ** 400, "error": PRIVATE}).encode()
        elif path.endswith("/nan"):
            payload = b'{"value": NaN}'
        elif path.endswith("/large"):
            payload = b'"' + b"x" * 1024 + b'"'
        else:
            payload = json.dumps(record).encode()
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.calls = []
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.client = ChertClient(self.base, SECRET, "tenant-fixture")
        self.before = len(self.server.calls)

    def assert_safe_error(self, failure):
        self.assertIsInstance(failure, ChertAPIError)
        for value in (str(failure), repr(failure), str(failure.args)):
            self.assertNotIn(PRIVATE, value)
            self.assertNotIn(SECRET, value)
        self.assertIsNone(failure.__context__)
        self.assertIsNone(failure.__cause__)

    def test_get_post_null_and_204_match_core_semantics(self):
        result = self.client.request("/echo?address=person%40example.test")
        self.assertEqual(result["path"], "/api/v1/echo?address=person%40example.test")
        self.assertEqual(result["method"], "GET")
        self.assertEqual(result["body"], "")
        self.assertEqual(result["authorization"], "Bearer " + SECRET)
        self.assertEqual(result["tenant"], "tenant-fixture")
        result = self.client.request("/echo", body={"message": "hello", "nested": [1, None]})
        self.assertEqual(result["method"], "POST")
        self.assertEqual(json.loads(result["body"]), {"message": "hello", "nested": [1, None]})
        self.assertEqual(self.client.request("/echo", body=None)["body"], "null")
        self.assertIsNone(self.client.request("/empty"))
        self.assertEqual(len(self.server.calls), self.before + 4)

    def test_explicit_base_prefix_is_preserved(self):
        result = ChertClient(self.base + "/deployment/", SECRET).request("/echo")
        self.assertEqual(result["path"], "/deployment/echo")
        self.assertIsNone(result["tenant"])

    def test_nested_flat_and_logical_errors_are_structured_but_sanitized(self):
        for path, status, code, request_id in [
            ("/nested-error", 503, "4103", "trace-observed"),
            ("/flat-error", 502, "4104", "request-observed"),
            ("/logical-error", 502, "failure", None),
        ]:
            with self.subTest(path=path), self.assertRaises(ChertAPIError) as caught:
                self.client.request(path)
            failure = caught.exception
            self.assertEqual((failure.status, failure.code, failure.request_id), (status, code, request_id))
            self.assertIn(PRIVATE, json.dumps(failure.data))
            self.assert_safe_error(failure)
        self.assertEqual(len(self.server.calls), self.before + 3)

    def test_non_json_malformed_and_nonfinite_responses_are_sanitized(self):
        for path in ("/html", "/malformed", "/nan"):
            with self.subTest(path=path), self.assertRaises(ChertAPIError) as caught:
                self.client.request(path)
            self.assertEqual((caught.exception.status, caught.exception.code), (502, "invalid_response"))
            self.assertIsNone(caught.exception.data)
            self.assert_safe_error(caught.exception)

    def test_numeric_overflow_is_rejected_and_large_integer_error_codes_are_preserved(self):
        with self.assertRaises(ChertAPIError) as caught:
            self.client.request("/overflow")
        self.assertEqual(caught.exception.code, "invalid_response")
        self.assert_safe_error(caught.exception)
        with self.assertRaises(ChertAPIError) as caught:
            self.client.request("/huge-code")
        self.assertEqual(caught.exception.code, str(10 ** 400))
        self.assert_safe_error(caught.exception)

    def test_deep_json_response_and_body_fail_safely_without_context_or_extra_effects(self):
        # Python 3.14's JSON implementation accepts this depth; older runtimes
        # can raise RecursionError. Inject that parser fault after real HTTP.
        with patch("chert.json.loads", side_effect=RecursionError(PRIVATE)):
            with self.assertRaises(ChertAPIError) as caught:
                self.client.request("/deep")
        self.assertEqual((caught.exception.status, caught.exception.code), (502, "invalid_response"))
        self.assertIsNone(caught.exception.data)
        self.assert_safe_error(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 1)
        body = PRIVATE
        for _ in range(sys.getrecursionlimit() + 100):
            body = [body]
        with patch("chert.json.dumps", side_effect=RecursionError(PRIVATE)):
            with self.assertRaises(ValueError) as caught:
                self.client.request("/echo", body=body)
        self.assertNotIn(PRIVATE, str(caught.exception))
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)
        self.assertEqual(len(self.server.calls), self.before + 1, "invalid nested body must not dispatch")

    def test_response_read_is_bounded(self):
        client = ChertClient(self.base, SECRET, max_response_bytes=64)
        with self.assertRaises(ChertAPIError) as caught:
            client.request("/large")
        self.assertEqual(caught.exception.code, "response_too_large")
        self.assert_safe_error(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 1)

    def test_307_never_forwards_credentials_or_requests_to_sink(self):
        with self.assertRaises(ChertAPIError) as caught:
            self.client.request("/redirect", body={"private": PRIVATE})
        self.assertEqual(caught.exception.code, "redirect_blocked")
        self.assert_safe_error(caught.exception)
        calls = self.server.calls[self.before:]
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["path"].endswith("/redirect"))

    def test_timeout_is_one_attempt_without_private_exception_context(self):
        with self.assertRaises(ChertAPIError) as caught:
            ChertClient(self.base, SECRET, timeout=0.02).request("/slow")
        self.assertEqual((caught.exception.status, caught.exception.code), (0, "timeout"))
        self.assert_safe_error(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 1)

    def test_urlerror_is_sanitized_without_retry(self):
        with patch.object(self.client._opener, "open", side_effect=__import__("urllib.error").error.URLError(PRIVATE)) as opener:
            with self.assertRaises(ChertAPIError) as caught:
                self.client.request("/echo")
        self.assertEqual(caught.exception.code, "transport_error")
        self.assert_safe_error(caught.exception)
        self.assertEqual(opener.call_count, 1)

    def test_ambient_proxy_and_netrc_are_unused(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, "fixture.netrc").write_text("machine 127.0.0.1 login private password private\n")
            with patch.dict(os.environ, {"NETRC": str(Path(temp, "fixture.netrc")), "http_proxy": "http://127.0.0.1:1", "HTTP_PROXY": "http://127.0.0.1:1", "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""}):
                result = ChertClient(self.base, SECRET).request("/echo")
        self.assertEqual(result["authorization"], "Bearer " + SECRET)
        self.assertEqual(len(self.server.calls), self.before + 1)

    def test_unsafe_paths_are_rejected_before_effects(self):
        for path in ("https://other.test/echo", "//other.test/echo", "/../echo", "/%2e%2e/echo", "/a%2fb", "/a%5cb", "/%252e%252e/echo", "/a?x=%0a", "/a#fragment", "/a\\b", "/a\nb", "/%", "/a%3fb", "/a%85b", "/" + "a" * 16384):
            with self.subTest(path=path), self.assertRaises((ValueError, UnicodeError)):
                self.client.request(path)
        self.assertEqual(len(self.server.calls), self.before)

    def test_invalid_config_methods_and_json_are_rejected_before_effects(self):
        for base in ("http://public.test", "https://user:pass@test", "https://test?q=1", "https://test#fragment", "https://test/%2e%2e/a", "https://test/a%2fb", "https://test:99999", "https://test\n", "ftp://test", "https://test/" + "a" * 16384):
            with self.subTest(base=base), self.assertRaises(ValueError):
                ChertClient(base, SECRET)
        for timeout in (0, -1, math.inf, math.nan, True):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                ChertClient(self.base, SECRET, timeout=timeout)
        for limit in (0, -1, True, 1.5):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                ChertClient(self.base, SECRET, max_response_bytes=limit)
        for key in ("", "key\r\nInjected: value", "key\x00", "key\x85"):
            with self.assertRaises(ValueError):
                ChertClient(self.base, key)
        for body in (math.nan, {"value": math.inf}, object(), "\ud800" + PRIVATE):
            with self.assertRaises(ValueError) as caught:
                self.client.request("/echo", body=body)
            self.assertNotIn(PRIVATE, str(caught.exception))
            self.assertIsNone(caught.exception.__context__)
        for method in ("CONNECT", "TRACE", "GET\nPOST"):
            with self.assertRaises(ValueError):
                self.client.request("/echo", method=method)
        with self.assertRaises(ValueError):
            self.client.request("/echo", method="GET", body=None)
        self.assertEqual(len(self.server.calls), self.before)


class PackagingTest(unittest.TestCase):
    def test_installed_build_backend_produces_importable_dependency_free_wheel(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            code = "import setuptools.build_meta as b; print(b.build_wheel(%r))" % temp
            result = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            wheel, = Path(temp).glob("*.whl")
            with zipfile.ZipFile(wheel) as archive:
                metadata = archive.read("chert_sdk-0.1.1.dist-info/METADATA").decode()
                self.assertIn("Name: chert-sdk\n", metadata)
                self.assertNotIn("Requires-Dist:", metadata)
                self.assertIn("Requires-Python: >=3.10", metadata)
                self.assertIn("License-Expression: MIT", metadata)
                self.assertIn("chert/py.typed", archive.namelist())
                self.assertIn("trychert/py.typed", archive.namelist())
            imported = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); from chert import ChertClient, QueuedTextReceipt, ReactionReceipt; assert callable(ChertClient.send_text); assert callable(ChertClient.send_reaction); assert ReactionReceipt.__dataclass_params__.frozen; assert QueuedTextReceipt.__required_keys__ == frozenset(['success', 'message_id', 'chat_id', 'status']); print(ChertClient.__name__)" % str(wheel)], capture_output=True, text=True, timeout=10)
            self.assertEqual(imported.returncode, 0, imported.stderr)
            self.assertEqual(imported.stdout.strip(), "ChertClient")


if __name__ == "__main__":
    unittest.main()
