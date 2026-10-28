"""Synchronous, stdlib-only Chert transport with explicit credentials."""
from __future__ import annotations

from dataclasses import dataclass

import http.client
import json
import math
import re
import sys
from typing import Any, Generator, Literal, TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from ._fetch import FetchOpener
from .events import (MessagingEvent, RecordedMessagingEvent, MessagingEventPage,
                     MessagingStreamFrame, WebhookSubscription, CreateWebhookSubscription,
                     UpdateWebhookSubscription, WebhookSubscriptions, WebhookSubscriptionResponse,
                     CreatedWebhookSubscriptionResponse, DeletedWebhookSubscription,
                     verify_webhook, _read_event_stream)

__all__ = ["ChertClient", "ChertAPIError", "QueuedTextReceipt", "ReactionReceipt",
           "MessagingEvent", "RecordedMessagingEvent", "MessagingEventPage", "MessagingStreamFrame",
           "WebhookSubscription", "CreateWebhookSubscription", "UpdateWebhookSubscription",
           "WebhookSubscriptions", "WebhookSubscriptionResponse", "CreatedWebhookSubscriptionResponse",
           "DeletedWebhookSubscription", "verify_webhook"]
_UNSET = object()
DEFAULT_IMESSAGE_URL = "https://console.trychert.com"
DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_URL_LENGTH = 16_384
_CONTROL = re.compile(r"[\x00-\x20\x7f-\x9f]")
_BAD_ESCAPE = re.compile(r"%(?![0-9a-fA-F]{2})")
# Exact ECMAScript String.trim set used by the strict cloud route, not str.strip.
_ECMASCRIPT_WHITESPACE = frozenset("\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff") | frozenset(
    chr(code) for code in range(0x2000, 0x200b)
)



class QueuedTextReceipt(TypedDict):
    """Validated cloud reservation identity; never native send/delivery proof."""
    success: Literal[True]
    message_id: str
    chat_id: str
    status: Literal["queued"]


@dataclass(frozen=True)
class ReactionReceipt:
    """Durable dispatch acknowledgement, not applied/current reaction state."""
    operation_id: str
    chat_id: str
    message_id: str
    status: Literal["acknowledged"]


class ChertAPIError(Exception):
    """Machine-readable failure; raw response data is explicit and never formatted."""

    def __init__(self, status: int, code: str, request_id: str | None = None, data: Any = None):
        self.status = status
        self.code = code
        self.request_id = request_id
        self.data = data
        super().__init__(f"Chert request failed ({status}); reconcile uncertain sends before retrying")

    def __repr__(self) -> str:
        return f"ChertAPIError(status={self.status})"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _path(value: str, *, encode_segments: bool = False) -> str:
    if not value.startswith("/") or value.startswith("//") or "\\" in value or _CONTROL.search(value):
        raise ValueError("Expected an unambiguous Chert-relative path")
    result = []
    for segment in value.split("/")[1:]:
        if _BAD_ESCAPE.search(segment):
            raise ValueError("Invalid URL escape")
        decoded = unquote(segment, errors="strict")
        if decoded in (".", "..") or any(c in decoded for c in "/\\%?#") or _CONTROL.search(decoded):
            raise ValueError("Ambiguous or escaping path segment")
        result.append(quote(decoded, safe="-._~" if encode_segments else "-._~:@!$&'()*+,;="))
    return "/" + "/".join(result)


def _header(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 or 127 <= ord(c) <= 159 or ord(c) > 255 for c in value):
        raise ValueError(f"Invalid {label}")
    return value


def _constant_error(value: str):
    raise ValueError("Non-finite JSON number")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


class ChertClient:
    """One-attempt JSON requests; no provider fallback, redirects or environment auth."""

    def __init__(self, base_url: str = DEFAULT_IMESSAGE_URL, api_key: str = "", tenant: str | None = None,
                 *, timeout: float = 15.0, max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES):
        if not isinstance(base_url, str) or len(base_url) > MAX_URL_LENGTH or _CONTROL.search(base_url) or "\\" in base_url or "?" in base_url or "#" in base_url:
            raise ValueError("Invalid Chert base URL")
        invalid_url = False
        try:
            base = urlsplit(base_url)
            host = base.hostname
            # Validate malformed/out-of-range ports before any network action.
            _ = base.port
        except ValueError:
            invalid_url = True
        if invalid_url:
            raise ValueError("Invalid Chert base URL")
        if (not host or base.username is not None or base.password is not None or "%" in base.netloc
                or any(ord(c) > 127 for c in base.netloc)
                or (base.scheme != "https" and not (base.scheme == "http" and host in ("localhost", "127.0.0.1", "::1")))):
            raise ValueError("Use HTTPS or loopback HTTP without user information")
        base_path = _path(base.path or "/")
        if base_path == "/":
            base_path = "/api/v1"
        self._base = urlunsplit((base.scheme, base.netloc, base_path.rstrip("/"), "", ""))
        self._key = _header(api_key, "API key")
        self._tenant = _header(tenant, "tenant") if tenant is not None else None
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be finite and positive")
        if isinstance(max_response_bytes, bool) or not isinstance(max_response_bytes, int) or max_response_bytes <= 0:
            raise ValueError("max_response_bytes must be a positive integer")
        self._timeout = timeout
        self._limit = max_response_bytes
        # No ambient proxy, netrc/password handler or redirect forwarding.
        self._opener = (FetchOpener() if sys.platform == "emscripten"
                        else build_opener(ProxyHandler({}), _NoRedirect()))

    def send_text(self, phone: str, text: str, *, idempotency_key: str | None = None) -> QueuedTextReceipt:
        """One strict plaintext attempt; a queued receipt is not delivery proof."""
        if not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{1,14}", phone):
            raise ValueError("Invalid canonical phone")
        valid_text = False
        if isinstance(text, str) and any(char not in _ECMASCRIPT_WHITESPACE for char in text) and "\0" not in text:
            try:
                valid_text = len(text.encode("utf-8", errors="strict")) <= 16384
            except UnicodeError:
                pass
        if not valid_text:
            raise ValueError("Invalid strict plaintext")
        valid_key = idempotency_key is None
        if isinstance(idempotency_key, str) and idempotency_key and "\0" not in idempotency_key:
            try:
                valid_key = len(idempotency_key.encode("utf-8", errors="strict")) <= 200
            except UnicodeError:
                pass
        if not valid_key:
            raise ValueError("Invalid idempotency key")
        payload = {"phone": phone, "body": text}
        if idempotency_key is not None:
            payload["idempotency_key"] = idempotency_key
        status, request_id, result = self._request_with_response("/text-operations/v1", method="POST", body=payload)
        if (status != 202 or not isinstance(result, dict)
                or set(result) != {"success", "message_id", "chat_id", "status"}
                or result["success"] is not True or result["status"] != "queued"
                or not isinstance(result["message_id"], str)
                or not re.fullmatch(r"[a-f0-9]{32}", result["message_id"])
                or not isinstance(result["chat_id"], str)
                or not re.fullmatch(r"[A-Za-z0-9:_-]{1,160}", result["chat_id"])):
            raise ChertAPIError(502, "unconfirmed_text_outcome", request_id, result)
        return cast(QueuedTextReceipt, result)

    def send_reaction(self, chat_id: str, message_id: str, reaction: str, *,
                      remove: bool = False, idempotency_key: str | None = None) -> ReactionReceipt:
        """One explicit standard reaction attempt on part zero; never retries."""
        if not isinstance(chat_id, str) or not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", chat_id):
            raise ValueError("Invalid chat identity")
        chat_id = chat_id.lower()  # UUID only; message IDs remain byte/case exact.
        valid_id = (isinstance(message_id, str) and message_id not in (".", "..")
                    and re.fullmatch(r"[A-Za-z0-9:_.-]{1,160}", message_id) is not None)
        if not valid_id:
            raise ValueError("Invalid message identity")
        if not isinstance(reaction, str) or reaction not in ("love", "like", "dislike", "laugh", "emphasize", "question"):
            raise ValueError("Unsupported standard reaction")
        if type(remove) is not bool:
            raise ValueError("remove must be boolean")
        if idempotency_key is not None and (not isinstance(idempotency_key, str)
                or not 1 <= len(idempotency_key) <= 200 or idempotency_key[0] == " " or idempotency_key[-1] == " "
                or any(ord(char) < 32 or ord(char) > 126 for char in idempotency_key)):
            raise ValueError("Invalid reaction idempotency key")
        path = f"/chats/{chat_id}/messages/{quote(message_id, safe='')}/reactions"
        status, request_id, result = self._request_with_response(path, method="POST",
            body={"reaction": reaction, "remove": remove, "part_index": 0}, idempotency_key=idempotency_key,
            encode_path_segments=True)
        if (status != 202 or not isinstance(result, dict)
                or set(result) != {"operation_id", "chat_id", "message_id", "status"}
                or not isinstance(result["operation_id"], str)
                or not re.fullmatch(r"[a-f0-9]{32}", result["operation_id"])
                or result["chat_id"] != chat_id or result["message_id"] != message_id
                or result["status"] != "acknowledged"):
            raise ChertAPIError(502, "unconfirmed_reaction_outcome", request_id, result)
        return ReactionReceipt(result["operation_id"], chat_id, message_id, "acknowledged")

    def request(self, path: str, *, method: str | None = None, body: Any = _UNSET) -> Any:
        return self._request_with_response(path, method=method, body=body)[2]

    def list_events(self, *, type: str | None = None, status: str | None = None,
                    lead_id: str | None = None, since: str | None = None,
                    cursor: str | None = None, limit: int | None = None) -> MessagingEventPage:
        params: dict[str, Any] = {}
        for key, value in (("type", type), ("status", status), ("lead_id", lead_id),
                           ("since", since), ("cursor", cursor)):
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError("Event filters must be strings")
                params[key] = value
        if limit is not None:
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
                raise ValueError("Event limit must be 1–200")
            params["limit"] = limit
        return self.request("/events" + ("?" + urlencode(params) if params else ""))

    @staticmethod
    def _resource_id(value: str) -> str:
        if not isinstance(value, str) or not value or value in (".", ".."):
            raise ValueError("Invalid resource identity")
        return quote(value, safe="")

    def get_event(self, row_id: str) -> RecordedMessagingEvent:
        return self.request("/events/" + self._resource_id(row_id))

    def list_webhook_subscriptions(self) -> WebhookSubscriptions:
        return self.request("/webhook-subscriptions")

    def get_webhook_subscription(self, subscription_id: str) -> WebhookSubscriptionResponse:
        return self.request("/webhook-subscriptions/" + self._resource_id(subscription_id))

    def create_webhook_subscription(self, body: CreateWebhookSubscription) -> CreatedWebhookSubscriptionResponse:
        return self.request("/webhook-subscriptions", method="POST", body=body)

    def update_webhook_subscription(self, subscription_id: str,
                                    body: UpdateWebhookSubscription) -> WebhookSubscriptionResponse:
        return self.request("/webhook-subscriptions/" + self._resource_id(subscription_id), method="PATCH", body=body)

    def delete_webhook_subscription(self, subscription_id: str) -> DeletedWebhookSubscription:
        return self.request("/webhook-subscriptions/" + self._resource_id(subscription_id), method="DELETE")

    def stream_events(self, *, since: str | None = None) -> Generator[MessagingStreamFrame, None, None]:
        """One SSE connection. Close the iterator explicitly on early exit."""
        if since is not None and (not isinstance(since, str) or _CONTROL.search(since)):
            raise ValueError("Invalid event continuation")
        url = self._base + "/events/stream" + ("?" + urlencode({"since": since}) if since is not None else "")
        if len(url) > MAX_URL_LENGTH:
            raise ValueError("Chert URL exceeds length limit")
        headers = {"Authorization": "Bearer " + self._key, "Accept": "text/event-stream"}
        if self._tenant is not None:
            headers["X-Chert-Tenant"] = self._tenant
        failure = None
        request_id = None
        try:
            try:
                response = self._opener.open(Request(url, headers=headers, method="GET"), timeout=self._timeout)
            except HTTPError as response_error:
                response = response_error
            with response:
                status = response.code
                request_id = response.headers.get("x-trace-id") or response.headers.get("x-request-id")
                if 300 <= status < 400:
                    raise ChertAPIError(502, "redirect_blocked", request_id)
                if not 200 <= status < 300 or response.headers.get_content_type() != "text/event-stream":
                    raise ChertAPIError(status if status >= 400 else 502, "stream_unavailable", request_id)
                for frame in _read_event_stream(response):
                    if frame["event"] == "close":
                        response.close()
                        yield frame
                        return
                    yield frame
        except (ValueError, UnicodeError, RecursionError):
            failure = ChertAPIError(502, "invalid_event_stream", request_id)
        except (URLError, TimeoutError, OSError, http.client.HTTPException) as error:
            timed_out = isinstance(error, TimeoutError) or (isinstance(error, URLError) and isinstance(error.reason, TimeoutError))
            failure = ChertAPIError(0, "timeout" if timed_out else "transport_error", request_id)
        if failure is not None:
            raise failure from None

    def _request_with_response(self, path: str, *, method: str | None = None,
                               body: Any = _UNSET, idempotency_key: str | None = None,
                               encode_path_segments: bool = False) -> tuple[int, str | None, Any]:
        if not isinstance(path, str) or len(path) > MAX_URL_LENGTH or "#" in path or "\\" in path or _CONTROL.search(path):
            raise ValueError("Invalid Chert-relative API path")
        parts = urlsplit(path)
        if parts.scheme or parts.netloc:
            raise ValueError("Expected a Chert-relative API path")
        target = _path(parts.path, encode_segments=encode_path_segments)
        if _BAD_ESCAPE.search(parts.query) or _CONTROL.search(unquote(parts.query, errors="strict")):
            raise ValueError("Invalid query string")
        url = self._base + target + ("?" + quote(parts.query, safe="!$&'()*+,-./:;=?@_%~") if parts.query else "")
        if len(url) > MAX_URL_LENGTH:
            raise ValueError("Chert URL exceeds length limit")
        verb = method if method is not None else ("GET" if body is _UNSET else "POST")
        if not isinstance(verb, str) or not re.fullmatch(r"[A-Za-z]+", verb) or verb.upper() in ("CONNECT", "TRACE", "TRACK"):
            raise ValueError("Invalid request method")
        verb = verb.upper()
        if body is not _UNSET and verb in ("GET", "HEAD"):
            raise ValueError("GET and HEAD do not accept a body")
        invalid_body = False
        try:
            raw = None if body is _UNSET else json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError, UnicodeError, RecursionError):
            invalid_body = True
        if invalid_body:
            raise ValueError("body must be valid finite JSON")
        headers = {"Authorization": "Bearer " + self._key, "Accept": "application/json"}
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        if self._tenant is not None:
            headers["X-Chert-Tenant"] = self._tenant
        if raw is not None:
            headers["Content-Type"] = "application/json"
        failure = None
        try:
            try:
                response = self._opener.open(Request(url, data=raw, headers=headers, method=verb), timeout=self._timeout)
            except HTTPError as response_error:
                response = response_error
            with response:
                status = response.code
                request_id = response.headers.get("x-trace-id") or response.headers.get("x-request-id")
                if 300 <= status < 400:
                    raise ChertAPIError(502, "redirect_blocked", request_id)
                if status == 204:
                    return status, request_id, None
                payload = response.read(self._limit + 1)
                if len(payload) > self._limit:
                    raise ChertAPIError(status if status >= 400 else 502, "response_too_large", request_id)
        except (URLError, TimeoutError, OSError, http.client.HTTPException) as error:
            # Raise outside the handler so no private exception context survives.
            timed_out = isinstance(error, TimeoutError) or (isinstance(error, URLError) and isinstance(error.reason, TimeoutError))
            failure = ChertAPIError(0, "timeout" if timed_out else "transport_error")
        if failure is not None:
            raise failure from None
        invalid_json = False
        try:
            result = json.loads(payload.decode("utf-8"), parse_constant=_constant_error, parse_float=_finite_float)
        except (ValueError, UnicodeError, RecursionError):
            invalid_json = True
        if invalid_json:
            raise ChertAPIError(status if status >= 400 else 502, "invalid_response", request_id) from None
        if status >= 400 or (isinstance(result, dict) and result.get("success") is False):
            error = result.get("error") if isinstance(result, dict) else None
            if not isinstance(error, dict):
                error = result if isinstance(result, dict) else {}
            code = error.get("code")
            if type(code) is int:
                code = str(code)
            elif type(code) is float:
                code = str(int(code)) if code.is_integer() else str(code)
            elif not isinstance(code, str):
                code = "request_failed"
            raise ChertAPIError(status if status >= 400 else 502, code, request_id, result)
        return status, request_id, result
