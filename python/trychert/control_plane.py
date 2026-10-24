"""Synchronous stdlib transport for the verified FaceTime control-plane routes."""
import http.client
import json
import math
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .models import (BillingStatus, CheckoutSession, BillingCancellation, CouponValidation, ConnectorEnrollment, ConnectorReceipt,
                     CallAction, CallDetail, CallEvents, CallPage, CreateCall,
                     Credentials, DeviceLoginStart, Identity, Json, LinePage, LoginApproval,
                     LoginInspection, LoginResult, Revoked, WorkerPage)

DEFAULT_FACETIME_URL = 'https://facetime.trychert.com'
_UNSET = object()
_SAFE_CODES = frozenset("unauthorized forbidden cli_scope_denied billing_owner_required billing_unavailable project_required invalid_request cli_login_expired cli_login_not_found cli_login_forbidden slow_down cli_login_rate_limited cli_login_busy not_found conflict".split())


class ChertControlPlaneError(Exception):
    """Sanitized status/code only: no server bodies, URLs or credential context."""

    def __init__(self, status: int, code: str):
        self.status = status
        self.code = code
        super().__init__(f"Chert control-plane request failed ({status}, {code}).")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _header(value: str) -> str:
    if not isinstance(value, str) or not value or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise ValueError("Invalid header value")
    return value


def _nonfinite(value: str):
    raise ValueError("Non-finite JSON")


class ChertControlPlane:
    def __init__(self, base_url: str = DEFAULT_FACETIME_URL, *, token: str | None = None,
                 project_id: str | None = None, timeout: float = 15.0):
        valid = False
        try:
            url = urlsplit(base_url)
            valid = (isinstance(base_url, str) and not any(ord(c) <= 32 or ord(c) > 126 for c in base_url)
                     and not any(c in base_url for c in "\\?#") and bool(url.hostname)
                     and url.username is None and url.password is None and '%' not in url.netloc
                     and url.path in ('', '/') and (url.scheme == 'https' or
                     (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))))
            _ = url.port
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise ValueError("Use an HTTPS origin or loopback HTTP origin without credentials or path")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Timeout must be finite and positive")
        self._origin = base_url.rstrip('/')
        self._token = _header(token) if token is not None else None
        self._project = _header(project_id) if project_id is not None else None
        self._timeout = timeout
        self._opener = build_opener(ProxyHandler({}), _NoRedirect())

    def _request(self, path: str, method: str = 'GET', body: Any = _UNSET,
                 auth: Literal['public', 'user', 'project'] = 'project',
                 idempotency_key: str | None = None) -> Any:
        headers = {'Accept': 'application/json', 'Cache-Control': 'no-store'}
        if auth != 'public':
            if not self._token:
                raise ChertControlPlaneError(401, 'unauthorized')
            headers['Authorization'] = 'Bearer ' + self._token
        if auth == 'project':
            if not self._project:
                raise ChertControlPlaneError(400, 'project_required')
            headers['x-chert-project-id'] = self._project
        if idempotency_key is not None:
            headers['Idempotency-Key'] = _header(idempotency_key)
        raw = None
        invalid = False
        if body is not _UNSET:
            headers['Content-Type'] = 'application/json'
            try:
                raw = json.dumps(body, allow_nan=False, ensure_ascii=False).encode('utf-8')
            except (ValueError, TypeError, UnicodeError, RecursionError):
                invalid = True
        if invalid:
            raise ValueError('Input must be finite JSON')
        failure = None
        status = 0
        try:
            try:
                response = self._opener.open(Request(self._origin + '/api/v1/' + path,
                    data=raw, headers=headers, method=method), timeout=self._timeout)
            except HTTPError as error:
                response = error
            with response:
                status = response.code
                if 300 <= status < 400:
                    failure = ChertControlPlaneError(0, 'network_error')
                else:
                    payload = response.read(1_048_577)
                    if len(payload) > 1_048_576:
                        failure = ChertControlPlaneError(status, 'invalid_response')
        except (URLError, OSError, http.client.HTTPException, ValueError):
            failure = ChertControlPlaneError(0, 'network_error')
        if failure is not None:
            raise failure from None
        envelope = None
        try:
            envelope = json.loads(payload.decode('utf-8'), parse_constant=_nonfinite)
        except (ValueError, UnicodeError, RecursionError):
            pass
        if not isinstance(envelope, dict):
            raise ChertControlPlaneError(status, 'invalid_response')
        if not 200 <= status < 300:
            error = envelope.get('error')
            code = error.get('code') if isinstance(error, dict) else None
            raise ChertControlPlaneError(status, code if isinstance(code, str) and code in _SAFE_CODES else 'request_failed')
        if 'data' not in envelope:
            raise ChertControlPlaneError(status, 'invalid_response')
        return envelope['data']

    def begin_login(self, device_name: str) -> DeviceLoginStart:
        return self._request('cli/logins', 'POST', {'device_name': device_name}, 'public')

    def poll_login(self, device_code: str) -> LoginResult:
        return self._request('cli/logins/token', 'POST', {'device_code': device_code}, 'public')

    def inspect_login(self, user_code: str) -> LoginInspection:
        return self._request('cli/logins/inspect', 'POST', {'user_code': user_code}, 'user')

    def approve_login(self, user_code: str, project_id: str) -> LoginApproval:
        return self._request('cli/logins/approve', 'POST', {'user_code': user_code, 'project_id': project_id}, 'user')

    def whoami(self) -> Identity:
        return self._request('cli/whoami')

    def logout(self) -> Revoked:
        return self._request('cli/logout', 'POST', auth='user')

    def list_credentials(self) -> Credentials:
        return self._request('cli/credentials')

    def revoke_credential(self, credential_id: str) -> Revoked:
        if not isinstance(credential_id, str) or not credential_id or credential_id in ('.', '..'):
            raise ValueError('Invalid credential identity')
        return self._request('cli/credentials/' + quote(credential_id, safe=''), 'DELETE')

    def _page(self, path: str, limit: int | None, offset: int | None) -> Any:
        params = {}
        for key, value in (('limit', limit), ('offset', offset)):
            if value is not None:
                if type(value) is not int or value < 0 or (key == 'limit' and not 1 <= value <= 100):
                    raise ValueError('Invalid pagination')
                params[key] = value
        return self._request(path + ('?' + urlencode(params) if params else ''))

    def list_lines(self, *, limit: int | None = None, offset: int | None = None) -> LinePage:
        return self._page('lines', limit, offset)

    def list_workers(self, *, limit: int | None = None, offset: int | None = None) -> WorkerPage:
        return self._page('workers', limit, offset)

    def list_calls(self, *, limit: int | None = None, offset: int | None = None) -> CallPage:
        return self._page('calls', limit, offset)

    @staticmethod
    def _call_id(call_id: str) -> str:
        if not isinstance(call_id, str) or not call_id or call_id in ('.', '..'):
            raise ValueError('Invalid call identity')
        return quote(call_id, safe='')

    def get_call(self, call_id: str) -> CallDetail:
        return self._request('calls/' + self._call_id(call_id))

    def get_call_events(self, call_id: str) -> CallEvents:
        """Finite JSON timeline, not SSE or a media stream."""
        return self._request('calls/' + self._call_id(call_id) + '/events')

    def _call_mutation(self, path: str, body: Any, idempotency_key: str) -> CallDetail:
        if (not isinstance(idempotency_key, str) or not 8 <= len(idempotency_key) <= 200
                or any(ord(char) < 33 or ord(char) > 126 for char in idempotency_key)):
            raise ValueError('Use a stable 8–200 character printable non-space ASCII idempotency key')
        return self._request(path, 'POST', body, idempotency_key=idempotency_key)

    def create_call(self, body: CreateCall, *, idempotency_key: str) -> CallDetail:
        """One explicit attempt; acceptance does not prove connection or media success."""
        return self._call_mutation('calls', body, idempotency_key)

    def answer_call(self, call_id: str, body: CallAction | None = None, *, idempotency_key: str) -> CallDetail:
        return self._call_mutation('calls/' + self._call_id(call_id) + '/answer',
                                   {} if body is None else body, idempotency_key)

    def reject_call(self, call_id: str, body: CallAction | None = None, *, idempotency_key: str) -> CallDetail:
        return self._call_mutation('calls/' + self._call_id(call_id) + '/reject',
                                   {} if body is None else body, idempotency_key)

    def end_call(self, call_id: str, body: CallAction | None = None, *, idempotency_key: str) -> CallDetail:
        return self._call_mutation('calls/' + self._call_id(call_id) + '/end',
                                   {} if body is None else body, idempotency_key)

    def list_connectors(self) -> Json:
        return self._request('connectors')

    def enroll_connector(self, enrollment: ConnectorEnrollment) -> ConnectorReceipt:
        return self._request('connectors', 'POST', {**enrollment, 'action': 'enroll'})

    def activate_connector(self, binding_id: str, expected_binding_id: str | None,
                           assignment_generation: int) -> Json:
        return self._request('connectors', 'POST', {'action': 'activate', 'binding_id': binding_id,
            'expected_binding_id': expected_binding_id, 'assignment_generation': assignment_generation})

    def drain_connector(self, binding_id: str) -> Json:
        return self._request('connectors', 'POST', {'action': 'drain', 'binding_id': binding_id})

    def revoke_connector(self, binding_id: str) -> Json:
        return self._request('connectors', 'POST', {'action': 'revoke', 'binding_id': binding_id})

    def billing_status(self) -> BillingStatus:
        """Read billing status using a user bearer token and selected project."""
        return self._request('billing')

    def _billing_action(self, body: dict[str, Any], idempotency_key: str) -> Any:
        if not isinstance(idempotency_key, str) or not 8 <= len(idempotency_key.strip()) <= 200:
            raise ValueError('Use a stable 8–200 character idempotency key')
        return self._request('billing', 'POST', body,
                             idempotency_key=_header(idempotency_key))

    def create_checkout(self, *, plan: Literal['shared', 'dedicated'],
                        idempotency_key: str, coupon_code: str | None = None) -> CheckoutSession:
        if plan not in ('shared', 'dedicated'):
            raise ValueError('Use a shared or dedicated plan')
        body = {'action': 'checkout', 'plan': plan}
        if coupon_code is not None:
            body['coupon_code'] = self._coupon_code(coupon_code)
        return self._billing_action(body, idempotency_key)

    @staticmethod
    def _coupon_code(value: str) -> str:
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= 64:
            raise ValueError('Use a nonblank coupon code of at most 64 characters')
        return value

    def cancel_subscription(self, *, idempotency_key: str) -> BillingCancellation:
        """Request period-end cancellation; this is not confirmation of cancellation."""
        return self._billing_action({'action': 'cancel'}, idempotency_key)

    def validate_coupon(self, coupon_code: str, *, idempotency_key: str) -> CouponValidation:
        return self._billing_action({'action': 'validate_coupon',
                                     'coupon_code': self._coupon_code(coupon_code)}, idempotency_key)
