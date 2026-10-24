"""Public messaging wire models, bounded SSE decoding and webhook verification."""
import hashlib
import hmac
import json
import math
import re
import time
from typing import Any, Generator, Literal, TypedDict


class MessagingEvent(TypedDict):
    id: str
    type: str
    event_id: str
    lead_id: str | None
    convo_id: str | None
    payload: dict[str, Any]
    created_at: str


class _AttemptOptional(TypedDict, total=False):
    error: str


class DeliveryAttempt(_AttemptOptional):
    at: str
    status: int | None
    duration_ms: float


class EventDelivery(TypedDict):
    status: str
    url: str | None
    attempts: list[DeliveryAttempt]
    delivered_at: str | None


class _EventOptional(TypedDict, total=False):
    updated_at: str


class RecordedMessagingEvent(MessagingEvent, _EventOptional):
    delivery: EventDelivery


class MessagingEventPage(TypedDict):
    events: list[RecordedMessagingEvent]
    next_cursor: str | None
    count: int


class _SubscriptionOptional(TypedDict, total=False):
    consecutive_failures: int
    last_success_at: str | None
    last_failure_at: str | None
    updated_at: str


class WebhookSubscription(_SubscriptionOptional):
    id: str
    url: str
    events: list[str]
    version: str
    is_active: bool
    created_at: str


class CreatedWebhookSubscription(WebhookSubscription):
    secret: str


class WebhookSubscriptions(TypedDict):
    subscriptions: list[WebhookSubscription]


class WebhookSubscriptionResponse(TypedDict):
    subscription: WebhookSubscription


class CreatedWebhookSubscriptionResponse(TypedDict):
    subscription: CreatedWebhookSubscription


class DeletedWebhookSubscription(TypedDict):
    deleted: Literal[True]
    id: str


class _CreateOptional(TypedDict, total=False):
    events: list[str]
    version: str


class CreateWebhookSubscription(_CreateOptional):
    url: str


class UpdateWebhookSubscription(TypedDict, total=False):
    url: str
    events: list[str]
    version: str
    is_active: bool


class MessagingStreamFrame(TypedDict):
    event: str
    data: Any


def verify_webhook(raw_body: bytes | str, signature: str, secret: str) -> bool:
    """Authenticate exact bytes before parsing JSON. No replay store is implied."""
    if not isinstance(signature, str) or not isinstance(secret, str) or not secret:
        return False
    match = re.fullmatch(r"v1,([0-9]{1,16}),([a-fA-F0-9]{64})", signature)
    if match is None or abs(time.time() - int(match[1])) > 300:
        return False
    try:
        body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
        if not isinstance(body, bytes):
            return False
        digest = hmac.new(secret.encode("utf-8"), match[1].encode("ascii") + b"." + body, hashlib.sha256).digest()
        return hmac.compare_digest(digest, bytes.fromhex(match[2]))
    except UnicodeError:
        return False


def _finite(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON")
    return number


def _read_event_stream(response: Any) -> Generator[MessagingStreamFrame, None, None]:
    # Work in bytes so fragments of UTF-8 and byte limits are exact. Decode each
    # complete line strictly; CR, LF, and CRLF all delimit lines.
    line = bytearray()
    data: list[str] = []
    event = ""
    size = 0
    after_cr = False

    def consume_line() -> MessagingStreamFrame | None:
        nonlocal data, event, size
        current = line.decode("utf-8")
        line.clear()
        if not current:
            frame = ({"event": event or "message", "data": json.loads(
                "\n".join(data), parse_constant=_finite, parse_float=_finite)} if data else None)
            data = []
            event = ""
            size = 0
            return frame
        if not current.startswith(":"):
            field, _, value = current.partition(":")
            if value.startswith(" "):
                value = value[1:]
            if field == "data":
                data.append(value)
            elif field == "event":
                event = value
        return None

    while True:
        chunk = response.read1(4096)
        if not chunk:
            if after_cr:
                frame = consume_line()
                if frame is not None:
                    yield frame
            line.decode("utf-8")  # Reject truncated UTF-8, but never dispatch an incomplete frame.
            return
        for byte in chunk:
            # Defer CR until we can charge an optional LF to the same frame,
            # before consume_line resets its budget at a blank line.
            if after_cr:
                after_cr = False
                if byte == 10:
                    size += 1
                    if size > 1024 * 1024:
                        raise ValueError("Event frame exceeds 1 MiB")
                frame = consume_line()
                if frame is not None:
                    yield frame
                if byte == 10:
                    continue
            size += 1
            if size > 1024 * 1024:
                raise ValueError("Event frame exceeds 1 MiB")
            if byte == 13:
                after_cr = True
            elif byte == 10:
                frame = consume_line()
                if frame is not None:
                    yield frame
            else:
                line.append(byte)
