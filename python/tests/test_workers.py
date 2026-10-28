import asyncio
import hashlib
import hmac
import json
import sys
import time
import types
import unittest
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chert._fetch import FetchOpener
from trychert import (
    UNIFIED_CONTRACT,
    UNIFIED_SCOPES,
    Chert,
    ChertAPIError,
    ChertClient,
    ChertControlPlane,
    ChertControlPlaneError,
    FaceTimeConfig,
    IMessageConfig,
    UnsupportedUnifiedBackend,
    verify_webhook,
)

KEY = "synthetic-worker-key"
TOKEN = "chu_" + "a" * 43
PROJECT = "12345678-1234-1234-1234-123456789abc"


class JsError(Exception):
    pass


class Chunk:
    def __init__(self, data):
        self._data = data

    def to_bytes(self):
        return bytes(self._data)


class Reader:
    def __init__(self, chunks, owner):
        self._chunks = list(chunks)
        self._owner = owner

    async def read(self):
        if self._chunks:
            item = self._chunks.pop(0)
            if isinstance(item, Exception):
                raise item
            if item is None:
                await asyncio.sleep(10)
            return types.SimpleNamespace(done=False, value=Chunk(item))
        return types.SimpleNamespace(done=True, value=None)

    async def cancel(self):
        self._owner.cancelled += 1


class Body:
    def __init__(self, chunks, owner):
        self._reader = Reader(chunks, owner)

    def getReader(self):
        return self._reader


class Headers:
    def __init__(self, pairs):
        self._pairs = pairs

    def entries(self):
        return iter([list(pair) for pair in self._pairs])


class AbortController:
    instances: ClassVar[list] = []

    def __init__(self):
        self.aborted = False
        self.signal = object()

    @classmethod
    def new(cls):
        controller = cls()
        cls.instances.append(controller)
        return controller

    def abort(self):
        self.aborted = True


class FakeJs(types.ModuleType):
    def __init__(self):
        super().__init__("js")
        self.AbortController = AbortController
        self.Object = types.SimpleNamespace(fromEntries=dict)
        self.calls = []
        self.routes = {}
        self.cancelled = 0

    def respond(self, path, status=200, payload=None, *, headers=(), chunks=None, fail=None, hang=False):
        if chunks is None:
            chunks = [b""] if payload is None else [json.dumps(payload).encode()]
        self.routes[path] = (status, list(headers), chunks, fail, hang)

    async def _fetch(self, url, init):
        self.calls.append((url, init))
        path = "/" + url.split("/", 3)[3].split("?", 1)[0]
        status, headers, chunks, fail, hang = self.routes[path]
        if fail is not None:
            raise fail
        if hang:
            await asyncio.sleep(10)
        if not any(name.lower() == "content-type" for name, _ in headers):
            headers = headers + [("content-type", "application/json")]
        body = None if status == 204 else Body(chunks, self)
        return types.SimpleNamespace(status=status, headers=Headers(headers), body=body)

    def fetch(self, url, init):
        return self._fetch(url, init)


def run_sync(awaitable):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(awaitable)
    finally:
        loop.close()


def to_js(value, dict_converter=None):
    converted = {key: to_js(item, dict_converter) for key, item in value.items()} if isinstance(value, dict) else value
    return dict_converter(converted) if dict_converter is not None and isinstance(value, dict) else converted


class WorkersTransportTest(unittest.TestCase):
    def setUp(self):
        AbortController.instances = []
        self.js = FakeJs()
        ffi = types.ModuleType("pyodide.ffi")
        ffi.run_sync = run_sync
        ffi.to_js = to_js
        ffi.JsException = JsError
        pyodide = types.ModuleType("pyodide")
        pyodide.ffi = ffi
        self.modules = patch.dict(sys.modules, {"js": self.js, "pyodide": pyodide, "pyodide.ffi": ffi})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def pyodide(self):
        return patch("sys.platform", "emscripten")

    def headers(self, index=-1):
        return {name.lower(): value for name, value in self.js.calls[index][1]["headers"].items()}

    def test_cpython_default_is_unchanged(self):
        client = ChertClient(api_key=KEY)
        plane = ChertControlPlane(token=KEY)
        self.assertNotIsInstance(client._opener, FetchOpener)
        self.assertNotIsInstance(plane._opener, FetchOpener)
        self.assertEqual(self.js.calls, [])

    def test_pyodide_selects_fetch_for_every_client(self):
        with self.pyodide():
            sdk = Chert(imessage=IMessageConfig(api_key=KEY), facetime=FaceTimeConfig(token=KEY, project_id="p"))
        self.assertIsInstance(sdk.imessage._opener, FetchOpener)
        self.assertIsInstance(sdk.facetime._opener, FetchOpener)

    def test_get_pins_credentials_and_disables_redirects(self):
        with self.pyodide():
            client = ChertClient("https://messaging.example", KEY, "tenant-a")
        self.js.respond("/api/v1/whoami", payload={"ok": True})
        self.assertEqual(client.request("/whoami"), {"ok": True})
        url, init = self.js.calls[0]
        self.assertEqual(url, "https://messaging.example/api/v1/whoami")
        self.assertEqual(init["method"], "GET")
        self.assertEqual(init["redirect"], "manual")
        self.assertNotIn("body", init)
        self.assertIs(init["signal"], AbortController.instances[0].signal)
        self.assertEqual(self.headers(), {"authorization": "Bearer " + KEY, "accept": "application/json",
                                          "x-chert-tenant": "tenant-a"})

    def test_send_text_posts_exact_json_bytes(self):
        with self.pyodide():
            client = ChertClient(api_key=KEY)
        receipt = {"success": True, "message_id": "a" * 32, "chat_id": "chat", "status": "queued"}
        self.js.respond("/api/v1/text-operations/v1", 202, receipt)
        self.assertEqual(client.send_text("+15550000002", "hi ✓", idempotency_key="k"), receipt)
        init = self.js.calls[0][1]
        self.assertEqual(init["method"], "POST")
        self.assertEqual(json.loads(init["body"]), {"phone": "+15550000002", "body": "hi ✓", "idempotency_key": "k"})
        self.assertEqual(self.headers()["content-type"], "application/json")
        self.assertEqual(len(self.js.calls), 1)

    def test_status_mapping_matches_cpython_contract(self):
        with self.pyodide():
            client = ChertClient(api_key=KEY)
        self.js.respond("/api/v1/empty", 204)
        self.assertIsNone(client.request("/empty"))
        self.js.respond("/api/v1/moved", 307, headers=[("location", "https://elsewhere.example/")])
        with self.assertRaises(ChertAPIError) as moved:
            client.request("/moved", method="POST", body={})
        self.assertEqual((moved.exception.status, moved.exception.code), (502, "redirect_blocked"))
        self.js.respond("/api/v1/broken", 503, {"success": False, "error": {"code": "busy"}},
                        headers=[("x-trace-id", "trace")])
        with self.assertRaises(ChertAPIError) as broken:
            client.request("/broken")
        self.assertEqual((broken.exception.status, broken.exception.code, broken.exception.request_id),
                         (503, "busy", "trace"))
        self.assertEqual(len(self.js.calls), 3)

    def test_chunked_body_is_bounded(self):
        with self.pyodide():
            client = ChertClient(api_key=KEY, max_response_bytes=8)
        self.js.respond("/api/v1/split", chunks=[b'{"a":', b'1}'])
        self.assertEqual(client.request("/split"), {"a": 1})
        self.js.respond("/api/v1/large", chunks=[b'{"a":"', b"x" * 64, b'"}'])
        with self.assertRaises(ChertAPIError) as large:
            client.request("/large")
        self.assertEqual(large.exception.code, "response_too_large")

    def test_timeout_aborts_once_and_js_failures_are_sanitized(self):
        with self.pyodide():
            client = ChertClient(api_key=KEY, timeout=0.05)
        self.js.respond("/api/v1/slow", hang=True)
        with self.assertRaises(ChertAPIError) as slow:
            client.request("/slow")
        self.assertEqual((slow.exception.status, slow.exception.code), (0, "timeout"))
        self.assertTrue(AbortController.instances[0].aborted)
        self.assertIsNone(slow.exception.__cause__)
        self.js.respond("/api/v1/stall", chunks=[b"{", None])
        with self.assertRaises(ChertAPIError) as stall:
            client.request("/stall")
        self.assertEqual(stall.exception.code, "timeout")
        self.js.respond("/api/v1/down", fail=JsError("TypeError: " + KEY))
        with self.assertRaises(ChertAPIError) as down:
            client.request("/down")
        self.assertEqual((down.exception.status, down.exception.code), (0, "transport_error"))
        self.assertNotIn(KEY, repr(down.exception) + str(down.exception))
        self.assertIsNone(down.exception.__context__)
        self.assertEqual(len(self.js.calls), 3)

    def test_event_stream_reads_incrementally_and_cancels_on_close(self):
        with self.pyodide():
            client = ChertClient(api_key=KEY)
        self.js.respond("/api/v1/events/stream", headers=[("content-type", "text/event-stream")],
                        chunks=[b"data: {\"n\"", b":1}\n\nevent: close\r\ndata: {}\r\n\r\n", b"data: {}\n\n"])
        frames = list(client.stream_events(since="cursor"))
        self.assertEqual(frames, [{"event": "message", "data": {"n": 1}}, {"event": "close", "data": {}}])
        self.assertEqual(self.headers()["accept"], "text/event-stream")
        self.assertTrue(self.js.calls[0][0].endswith("/events/stream?since=cursor"))
        self.assertEqual(self.js.cancelled, 1)

    def test_control_plane_unwraps_data_and_fails_closed(self):
        with self.pyodide():
            plane = ChertControlPlane(token=KEY, project_id="project-a")
        self.js.respond("/api/v1/cli/whoami", payload={"data": {"user": "u"}})
        self.assertEqual(plane.whoami(), {"user": "u"})
        self.assertEqual(self.js.calls[0][0], "https://facetime.trychert.com/api/v1/cli/whoami")
        self.assertEqual(self.headers()["x-chert-project-id"], "project-a")
        self.js.respond("/api/v1/cli/credentials", 302, headers=[("location", "https://elsewhere.example/")])
        with self.assertRaises(ChertControlPlaneError) as moved:
            plane.list_credentials()
        self.assertEqual((moved.exception.status, moved.exception.code), (0, "network_error"))
        self.js.respond("/api/v1/calls", fail=JsError("network"))
        with self.assertRaises(ChertControlPlaneError) as down:
            plane.create_call({"destination": "+15550000002"}, idempotency_key="stable-key")
        self.assertEqual(down.exception.code, "network_error")

    def test_unified_session_enforces_contract_echo_over_fetch(self):
        messaging, facetime = "https://messaging.example", "https://calls.example"
        self.js.respond("/api/v1/sdk/capabilities", payload={"data": {
            "contract": "chert-unified", "contract_version": 1,
            "auth": {"scheme": "Bearer", "token_prefix": "chu_", "audience": "chert.unified-api:v1",
                     "login_url": facetime + "/api/v1/cli/logins"},
            "services": {"imessage": {"base_url": messaging + "/api/v1"},
                         "facetime": {"base_url": facetime + "/api/v1"}},
            "scopes": list(UNIFIED_SCOPES)}})
        with self.pyodide():
            sdk = Chert.connect(TOKEN, PROJECT, imessage_base_url=messaging, facetime_base_url=facetime)
        self.assertNotIn("authorization", self.headers(0))
        self.js.respond("/api/v1/cli/whoami", payload={"data": {"ok": True}},
                        headers=[("x-chert-contract", UNIFIED_CONTRACT)])
        self.assertEqual(sdk.facetime.whoami(), {"ok": True})
        self.assertEqual(self.headers()["x-chert-contract"], UNIFIED_CONTRACT)
        self.js.respond("/api/v1/whoami", payload={"ok": True})
        with self.assertRaises(UnsupportedUnifiedBackend):
            sdk.imessage.request("/whoami")

    def test_webhook_verification_needs_no_transport(self):
        timestamp = str(int(time.time()))
        body = b'{"id":"evt"}'
        digest = hmac.new(b"whsec", timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        with self.pyodide():
            self.assertTrue(verify_webhook(body, f"v1,{timestamp},{digest}", "whsec"))
            self.assertFalse(verify_webhook(body + b" ", f"v1,{timestamp},{digest}", "whsec"))
        self.assertEqual(self.js.calls, [])


if __name__ == "__main__":
    unittest.main()
