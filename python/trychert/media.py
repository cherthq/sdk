"""Custom media v1 (video-only): explicit capabilities, session grants and raw frame validation.

This module has no media engine. Pass a grant's ``endpoint`` and ``token`` to a standard WHIP
(RFC 9725) client to publish, or a WHEP (draft-ietf-wish-whep-05, experimental) client to subscribe.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit

VideoCodec = Literal['h264', 'vp8']
MediaDirection = Literal['publish', 'subscribe']
PixelFormat = Literal['i420', 'nv12', 'rgba', 'bgra']
Rotation = Literal[0, 90, 180, 270]
ColorSpace = Literal['bt709-limited', 'bt601-limited', 'srgb-full']

MAX_FRAME_BYTES = 8 * 1024 * 1024
_MIN_DIMENSION, _MAX_WIDTH, _MAX_HEIGHT = 16, 1920, 1080


@dataclass(frozen=True)
class CustomVideoCapability:
    supported: Literal[True]
    transports: tuple[Literal['whip', 'livekit'], ...]
    codecs: tuple[VideoCodec, ...]
    max_width: int
    max_height: int
    max_fps: int


@dataclass(frozen=True)
class InboundCallerVideoCapability:
    supported: Literal[True]
    transports: tuple[Literal['whep', 'livekit'], ...]
    max_width: int
    max_height: int
    max_fps: int


@dataclass(frozen=True)
class MediaCapabilities:
    """``None`` sections are unsupported. Never infer support from generic video flags."""
    version: Literal[1] = 1
    custom_video: CustomVideoCapability | None = None
    inbound_caller_video: InboundCallerVideoCapability | None = None


def _wire_int(value: Any, maximum: int) -> int | None:
    """JSON integer (integral floats included, booleans excluded) in 1..maximum."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    return int(value) if 0 < value <= maximum else None


def _wire_list(value: Any, allowed: tuple[str, ...]) -> tuple[str, ...] | None:
    if not isinstance(value, list) or not all(isinstance(item, str) and item in allowed for item in value):
        return None
    return tuple(dict.fromkeys(value))


def _is_one(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value == 1


def parse_media_capabilities(value: Any) -> MediaCapabilities:
    """Parse a ``media_capabilities`` object. Absent, malformed or unknown-version input is unsupported;
    a malformed section disables only that section. Bounds are capped at SDK v1 limits."""
    if not isinstance(value, dict) or not _is_one(value.get('version')):
        return MediaCapabilities()
    custom = inbound = None
    cv = value.get('custom_video')
    if isinstance(cv, dict) and cv.get('supported') is True:
        transports = _wire_list(cv.get('transports'), ('whip', 'livekit'))
        codecs = _wire_list(cv.get('codecs'), ('h264', 'vp8'))
        width, height, fps = (_wire_int(cv.get('max_width'), 1920), _wire_int(cv.get('max_height'), 1080),
                              _wire_int(cv.get('max_fps'), 30))
        if transports and codecs and width and height and fps:
            custom = CustomVideoCapability(True, transports, codecs, width, height, fps)  # type: ignore[arg-type]
    iv = value.get('inbound_caller_video')
    if isinstance(iv, dict) and iv.get('supported') is True:
        transports = _wire_list(iv.get('transports'), ('whep', 'livekit'))
        width, height, fps = (_wire_int(iv.get('max_width'), 1280), _wire_int(iv.get('max_height'), 720),
                              _wire_int(iv.get('max_fps'), 30))
        if transports and width and height and fps:
            inbound = InboundCallerVideoCapability(True, transports, width, height, fps)  # type: ignore[arg-type]
    return MediaCapabilities(1, custom, inbound)


@dataclass(frozen=True)
class IceServer:
    urls: str | tuple[str, ...]
    username: str | None = None
    credential: str | None = field(default=None, repr=False)
    credential_type: Literal['password'] | None = None


@dataclass(frozen=True)
class MediaSessionLimits:
    max_width: int
    max_height: int
    max_fps: int
    max_frame_bytes: int


@dataclass(frozen=True)
class MediaSessionGrant:
    """One session. ``endpoint`` is opaque; ``token`` is a session-bound bearer that is never shown in repr."""
    session_id: str
    direction: MediaDirection
    endpoint: str
    token: str = field(repr=False)
    connect_by: str
    expires_at: str
    ice_servers: tuple[IceServer, ...]
    codecs: tuple[VideoCodec, ...]
    limits: MediaSessionLimits


_UUID = re.compile(r'[0-9a-f-]{36}', re.IGNORECASE)
_RFC3339 = re.compile(r'(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})', re.ASCII)


def _rfc3339_ms(value: Any) -> int | None:
    """Epoch milliseconds (fraction truncated, like ``Date.parse``) for a strict RFC 3339 timestamp, else ``None``."""
    match = _RFC3339.fullmatch(value) if isinstance(value, str) else None
    if not match:
        return None
    year, month, day, hour, minute, second = (int(part) for part in match.groups()[:6])
    fraction, zone = match.group(7) or '', match.group(8)
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    if not 1 <= month <= 12:
        return None
    days_in_month = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[month - 1]
    if not 1 <= day <= days_in_month or hour > 23 or minute > 59 or second > 59:
        return None
    offset = 0
    if zone not in ('Z', 'z'):
        hours, minutes = int(zone[1:3]), int(zone[4:6])
        if hours > 23 or minutes > 59:
            return None
        offset = (hours * 60 + minutes) * (1 if zone[0] == '+' else -1)
    # Days from 1970-01-01 in the proleptic Gregorian calendar.
    y = year - (month <= 2)
    era, yoe = divmod(y, 400)
    doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    days = era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468
    return ((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + int(fraction[:3].ljust(3, '0'))


def _endpoint(value: Any) -> bool:
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        return False
    try:
        url = urlsplit(value)
        _ = url.port
    except ValueError:
        return False
    local = url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1')
    return (bool(url.hostname) and (url.scheme == 'https' or local)
            and not url.username and not url.password and not url.fragment)


def _ice_server(value: Any) -> IceServer | None:
    if not isinstance(value, dict):
        return None
    urls = value.get('urls')
    if isinstance(urls, list) and urls and all(isinstance(u, str) for u in urls):
        urls = tuple(urls)
    elif not isinstance(urls, str):
        return None
    # Optional fields may be absent but never null or another type.
    if any(key in value and not isinstance(value[key], str) for key in ('username', 'credential')) or (
            'credentialType' in value and value['credentialType'] != 'password'):
        return None
    username, credential, kind = value.get('username'), value.get('credential'), value.get('credentialType')
    return IceServer(urls, username, credential, kind)


def _parse_media_session_grant(value: Any, direction: MediaDirection,
                               requested: tuple[str, ...] | list[str] | None = None) -> MediaSessionGrant | None:
    """Validated grant, or ``None`` when any field violates the v1 contract or the requested codecs."""
    if not isinstance(value, dict) or value.get('direction') != direction:
        return None
    width_cap, height_cap = (1920, 1080) if direction == 'publish' else (1280, 720)
    session_id, token = value.get('session_id'), value.get('token')
    ice, codecs, limits = value.get('ice_servers'), value.get('codecs'), value.get('limits')
    connect_by, expires_at = _rfc3339_ms(value.get('connect_by')), _rfc3339_ms(value.get('expires_at'))
    if (not isinstance(session_id, str) or not _UUID.fullmatch(session_id) or not _endpoint(value.get('endpoint'))
            or not isinstance(token, str) or not token or '\r' in token or '\n' in token
            or connect_by is None or expires_at is None or connect_by > expires_at
            or not isinstance(ice, list) or not isinstance(codecs, list) or not codecs
            or not all(isinstance(c, str) and c in ('h264', 'vp8') and (requested is None or c in requested)
                       for c in codecs)
            or len(set(codecs)) != len(codecs) or not isinstance(limits, dict)):
        return None
    servers = tuple(_ice_server(server) for server in ice)
    bounds = (_wire_int(limits.get('max_width'), width_cap), _wire_int(limits.get('max_height'), height_cap),
              _wire_int(limits.get('max_fps'), 30), _wire_int(limits.get('max_frame_bytes'), MAX_FRAME_BYTES))
    if None in servers or None in bounds:
        return None
    return MediaSessionGrant(session_id, direction, value['endpoint'], token, value['connect_by'],
                             value['expires_at'], servers, tuple(codecs),  # type: ignore[arg-type]
                             MediaSessionLimits(*bounds))  # type: ignore[arg-type]


class MediaFrameError(ValueError):
    """``code`` is ``invalid_frame`` or ``frame_too_large``."""

    def __init__(self, code: Literal['invalid_frame', 'frame_too_large'], message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class VideoPlane:
    data: bytes | bytearray | memoryview = field(repr=False)
    stride: int


@dataclass(frozen=True)
class VideoFrame:
    """Validated raw frame owning copies of only the required plane bytes (strides preserved)."""
    format: PixelFormat
    width: int
    height: int
    planes: tuple[VideoPlane, ...]
    timestamp_us: int
    duration_us: int | None
    rotation: Rotation
    color_space: ColorSpace


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def copy_video_frame(*, format: PixelFormat, width: int, height: int, planes: list[VideoPlane] | tuple[VideoPlane, ...],
                     timestamp_us: int, duration_us: int | None = None, rotation: Rotation | None = None,
                     color_space: ColorSpace | None = None) -> VideoFrame:
    """Validate a raw frame and copy ``stride * (rows - 1) + row_bytes`` bytes per plane,
    so callers may reuse their buffers after this returns. ``timestamp_us`` is monotonic microseconds."""
    if format not in ('i420', 'nv12', 'rgba', 'bgra'):
        raise MediaFrameError('invalid_frame', 'Unsupported pixel format.')
    if (not _is_int(width) or not _is_int(height) or width % 2 or height % 2 or width < _MIN_DIMENSION
            or height < _MIN_DIMENSION or width > _MAX_WIDTH or height > _MAX_HEIGHT):
        raise MediaFrameError('invalid_frame', f'Dimensions must be even integers between {_MIN_DIMENSION} and '
                                               f'{_MAX_WIDTH}x{_MAX_HEIGHT}.')
    if not _is_int(timestamp_us) or timestamp_us < 0:
        raise MediaFrameError('invalid_frame', 'timestamp_us must be a non-negative integer.')
    if duration_us is not None and not (_is_int(duration_us) and duration_us > 0):
        raise MediaFrameError('invalid_frame', 'duration_us must be a positive integer.')
    if rotation is not None and not (_is_int(rotation) and rotation in (0, 90, 180, 270)):
        raise MediaFrameError('invalid_frame', 'Unsupported rotation.')
    if color_space is not None and color_space not in ('bt709-limited', 'bt601-limited', 'srgb-full'):
        raise MediaFrameError('invalid_frame', 'Unsupported color space.')
    cw, ch = width // 2, height // 2
    layout = {'rgba': [(width * 4, height)], 'bgra': [(width * 4, height)],
              'i420': [(width, height), (cw, ch), (cw, ch)], 'nv12': [(width, height), (width, ch)]}[format]
    if not isinstance(planes, (list, tuple)) or len(planes) != len(layout):
        raise MediaFrameError('invalid_frame', f'{format} requires {len(layout)} plane(s).')
    total = 0
    copied = []
    for index, (plane, (row_bytes, rows)) in enumerate(zip(planes, layout)):
        view = None
        if isinstance(plane, VideoPlane) and isinstance(plane.data, (bytes, bytearray, memoryview)):
            try:
                view = memoryview(plane.data).cast('B')
            except (TypeError, ValueError):
                view = None
        if view is None or not _is_int(plane.stride) or not row_bytes <= plane.stride <= row_bytes + 256:
            raise MediaFrameError('invalid_frame', f'Plane {index} stride must be between {row_bytes} and '
                                                   f'{row_bytes + 256} bytes.')
        needed = plane.stride * (rows - 1) + row_bytes
        if len(view) < needed:
            raise MediaFrameError('invalid_frame', f'Plane {index} needs at least {needed} bytes.')
        total += needed
        if total > MAX_FRAME_BYTES:
            raise MediaFrameError('frame_too_large', 'Frame exceeds 8 MiB.')
        copied.append(VideoPlane(bytes(view[:needed]), plane.stride))
    yuv = format in ('i420', 'nv12')
    return VideoFrame(format, width, height, tuple(copied), timestamp_us, duration_us,
                      0 if rotation is None else rotation,
                      color_space or ('bt709-limited' if yuv else 'srgb-full'))


__all__ = ['VideoCodec', 'MediaDirection', 'PixelFormat', 'Rotation', 'ColorSpace', 'MAX_FRAME_BYTES',
           'CustomVideoCapability', 'InboundCallerVideoCapability', 'MediaCapabilities', 'parse_media_capabilities',
           'IceServer', 'MediaSessionLimits', 'MediaSessionGrant',
           'MediaFrameError', 'VideoPlane', 'VideoFrame', 'copy_video_frame']
