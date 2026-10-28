"""Custom media v1 and call video composition (draft): wire contract, response validation and error codes on loopback."""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROJECT = "11111111-1111-4111-8111-111111111111"
CALL = "22222222-2222-4222-8222-222222222222"
GRANT = dict(session_id="0f8fad5b-d9cb-469f-a165-70867728950e", direction="publish",
             endpoint="https://signal.example/whip/s1", token="grant-secret-token",
             connect_by="2026-10-25T10:00:00Z", expires_at="2026-10-25T12:00:00.5+02:00",
             ice_servers=[dict(urls="stun:stun.example:3478"),
                          dict(urls=["turn:turn.example:3478"], username="u", credential="c", credentialType="password")],
             codecs=["h264", "vp8"], limits=dict(max_width=1920, max_height=1080, max_fps=30, max_frame_bytes=8388608))
LIMITS = GRANT["limits"]
# (direction, status, envelope) for every rejected grant.
BAD = [("subscribe", 201, dict(data={**GRANT, "direction": "subscribe"})),  # publish-sized subscribe grant
       ("subscribe", 201, dict(data=GRANT)),
       ("publish", 200, dict(data=GRANT)),
       ("publish", 201, dict(data=None)),
       ("publish", 201, dict(data=GRANT, request_id=None)),
       ("publish", 201, "not json")] + [("publish", 201, dict(data={**GRANT, **patch})) for patch in (
    dict(endpoint="http://signal.example/x"), dict(endpoint="https://u:p@signal.example/x"),
    dict(endpoint="https://signal.example/x#f"), dict(endpoint="/relative"), dict(endpoint=7),
    dict(token="a\r\nb"), dict(token=""), dict(token=None), dict(connect_by="soon"), dict(expires_at=None),
    dict(expires_at="2026-02-30T10:00:00Z"), dict(codecs=["av1"]), dict(codecs=[]),
    dict(ice_servers=[dict(urls=7)]), dict(ice_servers=[dict(urls=[1])]), dict(ice_servers=[None]), dict(ice_servers={}),
    dict(limits={**LIMITS, "max_frame_bytes": 9000000}), dict(limits={**LIMITS, "max_fps": 31}),
    dict(limits={**LIMITS, "max_width": 1920.5}), dict(limits={**LIMITS, "max_width": 0}), dict(limits=None),
    dict(session_id="x"), dict(direction="subscribe"),
    # Tightened reference rules: unique codecs, ordered instants, strict ICE servers.
    dict(codecs=["h264", "h264"]), dict(connect_by="2026-10-25T10:00:00.002Z", expires_at="2026-10-25T10:00:00.001Z"),
    dict(connect_by="2026-10-25T10:00:00+00:00", expires_at="2026-10-25T11:00:00+02:00"),
    dict(ice_servers=[dict(urls=[])]), dict(ice_servers=[dict(urls="stun:a", username=None)]),
    dict(ice_servers=[dict(urls="stun:a", username=7)]), dict(ice_servers=[dict(urls="stun:a", credential=None)]),
    dict(ice_servers=[dict(urls="stun:a", credential={})]), dict(ice_servers=[dict(urls="stun:a", credentialType="oauth")]),
    dict(ice_servers=[dict(urls="stun:a", credentialType=None)]))]
# (requested codecs or None, grant patch): accepted grants. Requested subset, ordered or equal
# instants across offsets (lowercase t/z), complete ICE servers.
ACCEPT = [(["vp8", "h264"], dict(codecs=["h264"])),
          (None, dict(connect_by="2026-10-25T10:00:00+02:00", expires_at="2026-10-25T09:00:00Z")),
          (None, dict(connect_by="2026-10-25t08:00:00z", expires_at="2026-10-25T10:00:00.000999999+02:00")),
          (None, dict(ice_servers=[dict(urls="", username="u", credential="c", credentialType="password")]))]
ERRORS = [(401, "unauthorized"), (401, "media_session_expired"), (404, "call_not_found"),
          (409, "media_capability_unsupported"), (409, "media_session_conflict"), (409, "call_not_active"),
          (410, "call_ended"), (503, "media_transport_unavailable"), (418, "internal_detail")]
SCREEN = {**GRANT, "content": "screen", "limits": {**LIMITS, "max_fps": 15}}
CALLER_SCREEN = {**GRANT, "direction": "subscribe", "content": "caller_screen",
                 "limits": {**LIMITS, "max_width": 1280, "max_height": 720}}
SCREEN_NO_ECHO = {k: v for k, v in SCREEN.items() if k != "content"}
# (request body, grant) pairs that violate the content contract: screen above 15 fps, missing or
# different echo, and a non-camera echo on a default request.
SCREEN_BAD = [(dict(direction="publish", content="screen"), {**SCREEN, "limits": LIMITS}),
              (dict(direction="publish", content="screen"), SCREEN_NO_ECHO),
              (dict(direction="publish", content="screen"), {**SCREEN, "content": "camera"}),
              (dict(direction="publish"), SCREEN),
              (dict(direction="subscribe"), CALLER_SCREEN)]
# Named content cases: (expected body, status, envelope).
SCREEN_CASES = {
    "screen": (dict(direction="publish", content="screen"), 201, dict(data=SCREEN)),
    "caller-screen": (dict(direction="subscribe", content="caller_screen"), 201, dict(data=CALLER_SCREEN)),
    # The backend echoes the resolved camera content on default requests in both directions.
    "camera-echo-publish": (dict(direction="publish"), 201, dict(data={**GRANT, "content": "camera"})),
    "camera-echo-subscribe": (dict(direction="subscribe"), 201, dict(data={**CALLER_SCREEN, "content": "camera"})),
    "not-shared": (dict(direction="subscribe", content="caller_screen"), 409,
                   dict(error=dict(code="caller_screen_not_shared", message="internal host 10.0.0.5"), request_id="r")),
    **{code: (dict(direction="publish", content="screen"), status,
              dict(error=dict(code=code, message="internal host 10.0.0.5"), request_id="r"))
       for status, code in ((409, "media_content_unsupported"), (409, "caller_screen_unsupported"), (422, "media_limit_exceeded"))},
}
CAMERA_GRANT = {**GRANT, "session_id": "3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77", "content": "camera", "token": "session-bearer",
                "codecs": ["h264"], "limits": {**LIMITS, "max_fps": 24}}


def living(fps, call="call"):
    return dict(session_id="ls", call_id=call, deployment_id="dep", status="starting", viewport=dict(width=1920, height=270),
                fps=fps, ready_at=None, last_heartbeat_at=None, error_code=None)


CAPTIONS = dict(id="captions", z=1, living_session=living(12), region=dict(x=0, y=0.75, width=1, height=0.25),
                background="transparent", opacity=0.8, input=["pointer"])
BASE = dict(id="base", z=0, source=dict(kind="camera"), publish=CAMERA_GRANT)
LAYERED = dict(composition_id="cmp", call_id="call", revision=3, status="starting", output=dict(width=1920, height=1080, fps=24),
               error_code=None, layers=[BASE, CAPTIONS])
PAGE_ONLY = {**LAYERED, "output": dict(width=1280, height=720, fps=30),
             "layers": [dict(id="page", z=1, living_session=living(30), region=dict(x=0, y=0, width=1, height=1),
                             background="opaque", opacity=1, input=[])]}
FULL = dict(x=0, y=0, width=1, height=1)
# (name, method, expected body or None, expected key or None, reply data) for accepted call-video requests.
VIDEO = {
    "video-page": ("PUT", dict(layers=[dict(id="page", z=1, page=dict(deployment_id="dep-url"), region=FULL,
                                            background="opaque", opacity=1)]), "video-key-1", PAGE_ONLY),
    "video-layered": ("PUT", dict(revision=2, layers=[dict(id="base", z=0, source=dict(kind="camera")),
                                                      dict(id="captions", z=1, page=dict(deployment_id="dep"),
                                                           region=dict(x=0, y=0.75, width=1, height=0.25), background="transparent",
                                                           opacity=0.8, input=["pointer"], initial_state=dict(lang="en"))]),
                      "video-key-2", LAYERED),
    "video-get": ("GET", None, None, LAYERED),
    "video-clear": ("DELETE", None, None, LAYERED),
    # A region touching the frame edge is inside it.
    "video-edge": ("PUT", dict(layers=[dict(id="base", z=0, source=dict(kind="camera")),
                                       dict(id="p", z=1, page=dict(deployment_id="dep"), region=dict(x=0.75, y=0.75, width=0.25, height=0.25),
                                            background="opaque", opacity=1)]), "video-key-1", LAYERED),
    "video-managed": ("GET", None, None, {**LAYERED, "layers": [dict(id="base", z=0, source=dict(kind="managed")), CAPTIONS]}),
}
VIDEO_BAD = [{**LAYERED, "layers": layers, **extra} for layers, extra in (
    ([BASE, {**CAPTIONS, "living_session": living(30)}], {}),               # page fps above output fps
    ([BASE, CAPTIONS], dict(output=dict(width=1920, height=1080, fps=30))),  # output fps above the base grant
    ([{**BASE, "source": dict(kind="managed")}, CAPTIONS], {}),             # grant on a managed base
    ([{**BASE, "publish": {**CAMERA_GRANT, "content": "screen"}}, CAPTIONS], {}),
    ([BASE, CAPTIONS, {**CAPTIONS, "id": "more", "z": 2}], {}),
    ([BASE, {**CAPTIONS, "living_session": living(12, "other")}], {}),
    ([BASE, {**CAPTIONS, "region": dict(x=0.5, y=0, width=0.6, height=1)}], {}),
    ([BASE, {**CAPTIONS, "z": 0}], {}),
    ([BASE, {**CAPTIONS, "input": ["pointer", "pointer"]}], {}),
    ([BASE, CAPTIONS], dict(status="paused")),
    ([BASE, CAPTIONS], dict(output=dict(width=1921, height=1080, fps=24))))] + [
    {k: v for k, v in LAYERED.items() if k != "error_code"}, None]
VIDEO_ERRORS = [(409, "video_composition_unsupported"), (422, "composition_invalid"), (409, "composition_revision_conflict"),
                (409, "composition_base_unavailable"), (409, "media_session_conflict"), (409, "composition_secret")]
requests, errors = [], []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, envelope):
        if isinstance(envelope, dict) and "request_id" not in envelope:
            envelope["request_id"] = "trace"
        if isinstance(envelope, dict) and envelope["request_id"] is None:
            del envelope["request_id"]
        payload = envelope.encode() if isinstance(envelope, str) else json.dumps(envelope).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def video(self, method):
        try:
            _, case, name, *rest = self.path.split("/")
            assert case == "case" and "/".join(rest) == f"calls/{CALL}/video", self.path
            assert self.headers.get("Authorization") == "Bearer ft-secret"
            assert self.headers.get("X-Chert-Project-Id") == PROJECT
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            requests.append((name, body))
            key = self.headers.get("Idempotency-Key")
            status, envelope = 200, None
            if name in VIDEO:
                expected_method, expected_body, expected_key, data = VIDEO[name]
                assert (method, body, key) == (expected_method, expected_body, expected_key), (name, method, body, key)
                envelope = dict(data=data)
            elif name.startswith("video-bad-"):
                assert (method, body, key) == ("GET", None, None), name
                envelope = dict(data=VIDEO_BAD[int(name[10:])])
            elif name.startswith("video-error-"):
                assert (method, key) == ("PUT", "video-key-1") and body["layers"][0]["page"] == dict(deployment_id="dep"), body
                status, code = VIDEO_ERRORS[int(name[12:])]
                envelope = dict(error=dict(code=code, message="internal host 192.0.2.5"), request_id="r")
            else:
                raise AssertionError(name)
            if name == "video-page":  # Integral numbers go out as JSON integers, as in the TypeScript SDK.
                assert b'"opacity":1' in raw and b"1.0" not in raw, raw
            self.reply(status, envelope)
        except Exception as exc:
            errors.append(repr(exc))
            self.send_response(500)
            self.end_headers()

    def do_PUT(self):
        self.video("PUT")

    def do_GET(self):
        self.video("GET")

    def do_DELETE(self):
        self.video("DELETE")

    def do_POST(self):
        try:
            _, case, name, *rest = self.path.split("/")
            assert case == "case" and "/".join(rest) == f"calls/{CALL}/media-sessions", self.path
            assert self.headers.get("Authorization") == "Bearer ft-secret"
            assert self.headers.get("X-Chert-Project-Id") == PROJECT
            assert self.headers.get("Content-Type") == "application/json"
            assert self.headers.get("Idempotency-Key") is None
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((name, body))
            status, envelope = 201, dict(data=GRANT)
            if name == "publish":
                assert body == dict(direction="publish"), body
            elif name == "codecs":
                assert body == dict(direction="publish", codecs=["vp8", "h264"]), body
            elif name == "subscribe":
                assert body == dict(direction="subscribe"), body
                envelope = dict(data={**GRANT, "direction": "subscribe", "endpoint": "http://[::1]:8443/whep",
                                      "limits": {**LIMITS, "max_width": 1280, "max_height": 720.0}})
            elif name == "outside":  # A returned codec outside the requested list.
                assert body == dict(direction="publish", codecs=["vp8"]), body
            elif name.startswith("accept-"):
                requested, patch = ACCEPT[int(name[7:])]
                assert body == (dict(direction="publish", codecs=requested) if requested else dict(direction="publish")), body
                envelope = dict(data={**GRANT, **patch})
            elif name.startswith("bad-"):
                direction, status, envelope = BAD[int(name[4:])]
                assert body == dict(direction=direction), body
            elif name in SCREEN_CASES:
                expected, status, envelope = SCREEN_CASES[name]
                assert body == expected, body
            elif name.startswith("screen-bad-"):
                expected, data = SCREEN_BAD[int(name[11:])]
                assert body == expected, body
                envelope = dict(data=data)
            elif name.startswith("error-"):
                status, code = ERRORS[int(name[6:])]
                envelope = dict(error=dict(code=code, message="internal host 192.0.2.5"), request_id="r")
            else:
                raise AssertionError(name)
            self.reply(status, envelope)
        except Exception as exc:
            errors.append(repr(exc))
            self.send_response(500)
            self.end_headers()


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    result = subprocess.run([sys.argv[1], origin, str(len(BAD)), str(len(ERRORS)), str(len(ACCEPT)), str(len(SCREEN_BAD)),
                             str(len(VIDEO_BAD)), str(len(VIDEO_ERRORS))],
                            timeout=60)
    server.shutdown()
assert not errors, errors
assert result.returncode == 0, result.returncode
# Local validation never reaches the network: exactly one request per remote case.
assert len(requests) == (4 + len(BAD) + len(ERRORS) + len(ACCEPT) + len(SCREEN_CASES) + len(SCREEN_BAD)
                         + len(VIDEO) + len(VIDEO_BAD) + len(VIDEO_ERRORS)), requests
