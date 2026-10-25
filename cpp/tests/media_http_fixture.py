"""Custom media v1: session minting wire contract, grant validation and error codes on loopback."""
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
          (410, "call_ended"), (503, "media_transport_unavailable")]
requests, errors = [], []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

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
            elif name.startswith("error-"):
                status, code = ERRORS[int(name[6:])]
                envelope = dict(error=dict(code=code, message="internal host 10.0.0.5"), request_id="r")
            else:
                raise AssertionError(name)
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
        except Exception as exc:
            errors.append(repr(exc))
            self.send_response(500)
            self.end_headers()


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    result = subprocess.run([sys.argv[1], origin, str(len(BAD)), str(len(ERRORS)), str(len(ACCEPT))], timeout=60)
    server.shutdown()
assert not errors, errors
assert result.returncode == 0, result.returncode
# Local validation never reaches the network: exactly one request per remote case.
assert len(requests) == 4 + len(BAD) + len(ERRORS) + len(ACCEPT), requests
