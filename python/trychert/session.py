"""Opt-in proposed unified-v1 discovery and pinned transport guard."""
import http.client
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request

from .control_plane import ChertControlPlane, _nonfinite

UNIFIED_CONTRACT = "chert-unified-v1"
UNIFIED_SCOPES = (
    "imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send",
    "facetime:calls:read", "facetime:calls:create", "facetime:calls:control",
)


class UnsupportedUnifiedBackend(Exception):
    code = "unsupported_unified_backend"

    def __init__(self):
        super().__init__("The configured services do not support the required unified contract.")


def _origin(value: str) -> str:
    ChertControlPlane(value)  # Existing strict HTTPS/loopback origin validation, no I/O.
    parsed = urlsplit(value)
    host = parsed.hostname
    if ":" in host:
        host = "[" + host + "]"
    port = parsed.port
    authority = host if port is None or port == (443 if parsed.scheme == "https" else 80) else f"{host}:{port}"
    return urlunsplit((parsed.scheme, authority, "", "", ""))


def discover(access_token: str, project_id: str, imessage_url: str, facetime_url: str) -> tuple[str, str]:
    if (not isinstance(access_token, str) or not re.fullmatch(r"chu_[A-Za-z0-9_-]{43}", access_token)
            or not isinstance(project_id, str)
            or not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", project_id)):
        raise ValueError("A unified session token and project UUID are required")
    imessage, facetime = _origin(imessage_url), _origin(facetime_url)
    client = ChertControlPlane(imessage)
    envelope = None
    try:
        try:
            response = client._opener.open(Request(imessage + "/api/v1/sdk/capabilities",
                headers={"Accept": "application/json", "Cache-Control": "no-store"}), timeout=15.0)
        except HTTPError as error:
            response = error
        with response:
            if 200 <= response.code < 300:
                raw = response.read(65_537)
                if len(raw) <= 65_536:
                    envelope = json.loads(raw.decode("utf-8"), parse_constant=_nonfinite)
    except (URLError, OSError, http.client.HTTPException, ValueError, RecursionError):
        pass
    data = envelope.get("data") if isinstance(envelope, dict) else None
    valid = False
    if isinstance(data, dict):
        auth, services, scopes = data.get("auth"), data.get("services"), data.get("scopes")
        if isinstance(auth, dict) and isinstance(services, dict) and isinstance(scopes, list):
            messaging, calls = services.get("imessage"), services.get("facetime")
            valid = (data.get("contract") == "chert-unified"
                and type(data.get("contract_version")) is int and data["contract_version"] == 1
                and auth.get("scheme") == "Bearer" and auth.get("token_prefix") == "chu_"
                and auth.get("audience") == "chert.unified-api:v1"
                and auth.get("login_url") == facetime + "/api/v1/cli/logins"
                and isinstance(messaging, dict) and messaging.get("base_url") == imessage + "/api/v1"
                and isinstance(calls, dict) and calls.get("base_url") == facetime + "/api/v1"
                and all(isinstance(scope, str) for scope in scopes)
                and len(set(scopes)) == len(scopes)
                and all(scope in scopes for scope in UNIFIED_SCOPES))
    if not valid:
        raise UnsupportedUnifiedBackend()
    return imessage, facetime


class _ContractOpener:
    """Wrap the existing no-proxy/no-redirect opener; never use descriptor URLs."""

    def __init__(self, opener, origin: str):
        self._opener = opener
        self._prefix = origin + "/api/v1/"

    def open(self, request, *, timeout):
        if not request.full_url.startswith(self._prefix):
            raise UnsupportedUnifiedBackend()
        request.add_header("X-Chert-Contract", UNIFIED_CONTRACT)
        try:
            response = self._opener.open(request, timeout=timeout)
        except HTTPError as error:
            response = error
        if response.headers.get_all("X-Chert-Contract") != [UNIFIED_CONTRACT]:
            response.close()
            raise UnsupportedUnifiedBackend()
        return response
