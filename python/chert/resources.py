"""Recorded chat history. No cursor, pagination, delivery probes or implicit sends."""
import math
from typing import Literal, TypedDict

MessageService = Literal['imessage', 'sms', 'rcs', 'unknown']


class TextPart(TypedDict):
    type: Literal['text']
    value: str


class _MediaOptional(TypedDict, total=False):
    attachment_id: str
    url: str
    mime_type: str
    name: str
    filename: str
    size_bytes: int | float


class MediaPart(_MediaOptional):
    type: Literal['media']


class _RichLinkOptional(TypedDict, total=False):
    title: str
    summary: str
    image_url: str
    icon_url: str


class RichLinkPart(_RichLinkOptional):
    type: Literal['rich_link']
    url: str


MessagePart = TextPart | MediaPart | RichLinkPart


class ReplyTo(TypedDict):
    message_id: str


class Reactions(TypedDict, total=False):
    from_us: str
    from_them: str


class _MessageOptional(TypedDict, total=False):
    delivered_at: str | None
    read_at: str | None
    reply_to: ReplyTo | None
    reactions: Reactions | None


class ChatMessage(_MessageOptional):
    id: str
    chat_id: str
    parts: list[MessagePart]
    status: Literal['queued', 'sent', 'delivered', 'failed', 'read']
    direction: Literal['inbound', 'outbound']
    created_at: str
    service: MessageService


class ChatHistory(TypedDict):
    messages: list[ChatMessage]
    has_more: bool


def _part(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get('type') == 'text':
        return isinstance(value.get('value'), str)
    if value.get('type') == 'media':
        size = value.get('size_bytes')
        return (all(key not in value or isinstance(value[key], str)
                    for key in ('attachment_id', 'url', 'mime_type', 'name', 'filename'))
                and ('size_bytes' not in value or type(size) is int or type(size) is float and math.isfinite(size)))
    return (value.get('type') == 'rich_link' and isinstance(value.get('url'), str)
            and all(key not in value or isinstance(value[key], str)
                    for key in ('title', 'summary', 'image_url', 'icon_url')))


def _chat_history(value: object) -> bool:
    if not isinstance(value, dict) or type(value.get('has_more')) is not bool or not isinstance(value.get('messages'), list):
        return False
    for message in value['messages']:
        if (not isinstance(message, dict) or not all(isinstance(message.get(key), str) for key in ('id', 'chat_id', 'created_at'))
                or message.get('status') not in ('queued', 'sent', 'delivered', 'failed', 'read')
                or message.get('direction') not in ('inbound', 'outbound')
                or message.get('service') not in ('imessage', 'sms', 'rcs', 'unknown')
                or not isinstance(message.get('parts'), list) or not all(_part(part) for part in message['parts'])
                or any(key in message and message[key] is not None and not isinstance(message[key], str)
                       for key in ('delivered_at', 'read_at'))):
            return False
        reply, reactions = message.get('reply_to'), message.get('reactions')
        if reply is not None and (not isinstance(reply, dict) or not isinstance(reply.get('message_id'), str)):
            return False
        if reactions is not None and (not isinstance(reactions, dict) or any(
                key in reactions and not isinstance(reactions[key], str) for key in ('from_us', 'from_them'))):
            return False
    return True
