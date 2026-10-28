"""Call video composition (draft, unreleased): the call's video as a stack of layers, composed server-side and
published through the call's single publish slot. A base layer (z 0) carries camera frames over a publish grant,
or a backend-managed source; page layers (z >= 1) are living sessions of ready deployments.

The native SDK only validates and sends compositions. It cannot deploy URL pages or drive page state, events or
input: deploy pages with the TypeScript SDK and pass the ready ``deployment_id``.
"""
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from .media import _parse_media_session_grant

#: SDK v1 bound. The capability's ``max_layers`` is the backend's real limit.
COMPOSITION_MAX_LAYERS = 2

CompositionBaseKind = Literal['camera', 'managed']
CompositionBackground = Literal['opaque', 'transparent']
CompositionStatus = Literal['starting', 'live', 'stopping', 'stopped', 'failed']
LivingInputKind = Literal['pointer', 'keyboard', 'text']
LivingSessionStatus = Literal['starting', 'ready', 'live', 'stopping', 'stopped', 'failed']


class CompositionBase(TypedDict):
    kind: CompositionBaseKind


class CompositionRegion(TypedDict):
    """Normalized to the output frame: 0..1, width/height > 0, and x+width, y+height <= 1."""
    x: float
    y: float
    width: float
    height: float


class CompositionPage(TypedDict):
    """A ready deployment. URL pages are not accepted natively; deploy them with the TypeScript SDK."""
    deployment_id: str


class BaseLayerInput(TypedDict):
    id: str
    source: CompositionBase


class PageLayerInput(TypedDict, total=False):
    id: str
    z: int
    page: CompositionPage
    region: CompositionRegion
    background: CompositionBackground
    opacity: float
    input: list[LivingInputKind]
    initial_state: Any


class LivingViewport(TypedDict):
    width: int
    height: int


class LivingSession(TypedDict, total=False):
    session_id: str
    call_id: str
    deployment_id: str
    status: LivingSessionStatus
    viewport: LivingViewport
    fps: int
    ready_at: str | None
    last_heartbeat_at: str | None
    error_code: str | None


class CompositionOutput(TypedDict):
    width: int
    height: int
    fps: int


class CallVideoComposition(TypedDict, total=False):
    """Layers are dicts. A camera base's ``publish`` is a validated ``MediaSessionGrant``."""
    composition_id: str
    call_id: str
    revision: int
    status: CompositionStatus
    output: CompositionOutput
    layers: list[dict[str, Any]]
    error_code: str | None


@dataclass(frozen=True)
class VideoCompositionCapability:
    """Explicit, versioned ``video_composition`` capability. Never inferred from custom_video or living_services."""
    version: Literal[1]
    supported: Literal[True]
    max_layers: int
    bases: tuple[CompositionBaseKind, ...]
    page_alpha: bool
    regions: bool
    max_width: int
    max_height: int
    max_fps: int


_KINDS = ('pointer', 'keyboard', 'text')
_ID = re.compile(r'[a-z][a-z0-9_-]{0,31}')
_EPS = 1e-9
_MAX_SAFE = 2 ** 53 - 1


def _num(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _integer(value: Any) -> bool:
    """JavaScript ``Number.isInteger``."""
    return _num(value) and float(value).is_integer()


def _same(value: Any, number: int) -> bool:
    """JavaScript ``value === number``."""
    return _num(value) and value == number


def _wire(value: Any) -> Any:
    """Integral floats serialize like JavaScript numbers (1.0 -> 1)."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _pos_int(value: Any) -> bool:
    return _integer(value) and value > 0


def _unit(value: Any) -> bool:
    return _num(value) and 0 <= value <= 1


def _region_ok(r: Any) -> bool:
    return (isinstance(r, dict) and all(_unit(r.get(k)) for k in ('x', 'y', 'width', 'height'))
            and r['width'] > 0 and r['height'] > 0
            and r['x'] + r['width'] <= 1 + _EPS and r['y'] + r['height'] <= 1 + _EPS)


def _inputs_ok(value: Any) -> bool:
    return (isinstance(value, list) and all(isinstance(k, str) and k in _KINDS for k in value)
            and len(set(value)) == len(value))


def _js_truthy(value: Any) -> bool:
    return not (value is None or value is False or value == '' or (_num(value) and value == 0))


def _plain_json(value: Any, maximum: int, label: str) -> None:
    nodes = 0

    def walk(x: Any, depth: int) -> bool:
        nonlocal nodes
        nodes += 1
        if depth > 64 or nodes > maximum:
            return False
        if x is None or isinstance(x, (str, bool)) or _num(x):
            return True
        if isinstance(x, list):
            return all(walk(y, depth + 1) for y in x)
        return (isinstance(x, dict) and all(isinstance(k, str) for k in x)
                and all(walk(y, depth + 1) for y in x.values()))

    try:
        ok = walk(value, 0)
    except RecursionError:
        ok = False
    if not ok:
        raise ValueError(f'{label} must be plain JSON.')
    if len(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode('utf-8')) > maximum:
        raise ValueError(f'{label} exceeds {maximum} bytes.')


def parse_video_composition(value: Any) -> VideoCompositionCapability | None:
    """Parse ``video_composition``. Absent, malformed, unknown-version or unsupported input returns ``None``."""
    if (not isinstance(value, dict) or not _same(value.get('version'), 1) or value.get('supported') is not True
            or not isinstance(value.get('bases'), list)):
        return None
    if not all(_pos_int(value.get(k)) for k in ('max_layers', 'max_width', 'max_height', 'max_fps')):
        return None
    # Unknown bases are ignored and larger limits clamp to SDK v1 bounds, so newer services stay usable.
    bases = tuple(dict.fromkeys(b for b in value['bases'] if isinstance(b, str) and b in ('camera', 'managed')))
    return VideoCompositionCapability(1, True, int(min(value['max_layers'], COMPOSITION_MAX_LAYERS)),
                                      bases,  # type: ignore[arg-type]
                                      value.get('page_alpha') is True, value.get('regions') is True,
                                      int(min(value['max_width'], 1920)), int(min(value['max_height'], 1080)),
                                      int(min(value['max_fps'], 30)))


def _page_ref(page: Any) -> dict[str, str]:
    if isinstance(page, dict) and 'deployment_id' in page:
        deployment = page['deployment_id']
        if not isinstance(deployment, str) or not deployment or len(deployment) > 128:
            raise ValueError('deployment_id is required.')
        return {'deployment_id': deployment}
    raise ValueError('Native SDKs need a ready {"deployment_id": ...} page; URL pages are not accepted. '
                     'Deploy the page with the TypeScript SDK first.')


def _composition_body(value: Any) -> dict[str, Any]:
    """Validate locally and return the PUT body. The page shortcut is one opaque full-frame page layer."""
    if not isinstance(value, dict):
        raise ValueError('set_call_video needs {"page": ...} or {"layers": [...]}.')
    if 'page' in value and 'layers' not in value:
        shortcut: dict[str, Any] = {'id': 'page', 'z': 1, 'page': value['page']}
        if _js_truthy(value.get('input')):
            shortcut['input'] = value['input']
        if 'initial_state' in value:
            shortcut['initial_state'] = value['initial_state']
        layers: Any = [shortcut]
    else:
        layers = value.get('layers')
    if not isinstance(layers, list) or not 1 <= len(layers) <= COMPOSITION_MAX_LAYERS:
        raise ValueError(f'A composition has 1-{COMPOSITION_MAX_LAYERS} layers.')
    if 'revision' in value and not (_integer(value['revision']) and 0 <= value['revision'] <= _MAX_SAFE):
        raise ValueError('revision must be a non-negative integer.')
    ids: set[str] = set()
    zs: set[float] = set()
    bases = 0
    out: list[dict[str, Any]] = []
    for layer in layers:
        if (not isinstance(layer, dict) or not isinstance(layer.get('id'), str) or not _ID.fullmatch(layer['id'])
                or layer['id'] in ids):
            raise ValueError('Layer ids are unique, 1-32 chars: lowercase letter, then [a-z0-9_-].')
        ids.add(layer['id'])
        if 'source' in layer:
            bases += 1
            if bases > 1 or ('z' in layer and not _same(layer['z'], 0)):
                raise ValueError('At most one base layer, always at z 0.')
            source = layer['source']
            if not isinstance(source, dict) or source.get('kind') not in ('camera', 'managed'):
                raise ValueError('A base source is camera or managed.')
            out.append({'id': layer['id'], 'z': 0, 'source': {'kind': source['kind']}})
            continue
        z = layer.get('z')
        if not _integer(z) or not 1 <= z <= 64 or z in zs:
            raise ValueError('Page layer z values are unique integers 1..64.')
        zs.add(z)
        region = layer.get('region')
        region = {'x': 0, 'y': 0, 'width': 1, 'height': 1} if region is None else region
        if not _region_ok(region):
            raise ValueError('region is normalized 0..1 and must stay inside the frame.')
        background = layer.get('background')
        background = 'opaque' if background is None else background
        if background not in ('opaque', 'transparent'):
            raise ValueError('background is opaque or transparent.')
        opacity = layer.get('opacity')
        opacity = 1 if opacity is None else opacity
        if not _unit(opacity):
            raise ValueError('opacity must be 0..1.')
        if 'input' in layer and not _inputs_ok(layer['input']):
            raise ValueError('input must be a unique subset of pointer, keyboard, text.')
        if 'initial_state' in layer:
            _plain_json(layer['initial_state'], 64 * 1024, 'initial_state')
        body: dict[str, Any] = {'id': layer['id'], 'z': _wire(z), 'page': _page_ref(layer.get('page')),
                                'region': {k: _wire(region[k]) for k in ('x', 'y', 'width', 'height')},
                                'background': background, 'opacity': _wire(opacity)}
        if _js_truthy(layer.get('input')):
            body['input'] = list(layer['input'])
        if 'initial_state' in layer:
            body['initial_state'] = layer['initial_state']
        out.append(body)
    if not bases:
        # Nothing below the bottom page: it must fill the frame without showing through.
        bottom = min(out, key=lambda layer: layer['z'])
        r = bottom['region']
        if (not (r['x'] == 0 and r['y'] == 0 and r['width'] == 1 and r['height'] == 1)
                or bottom['background'] != 'opaque' or bottom['opacity'] != 1):
            raise ValueError('Without a base, the bottom page layer must be opaque, full frame and opacity 1.')
    result: dict[str, Any] = {}
    if 'revision' in value:
        result['revision'] = _wire(value['revision'])
    result['layers'] = out
    return result


def _even(value: Any, maximum: int) -> bool:
    return _integer(value) and 16 <= value <= maximum and value % 2 == 0


def _fps(value: Any) -> bool:
    return _integer(value) and 1 <= value <= 30


def _living_session_ok(s: Any) -> bool:
    """Checks the effective viewport/fps, like the reference SDK's living-session validation."""
    v = s.get('viewport') if isinstance(s, dict) else None
    return (isinstance(s, dict) and isinstance(s.get('session_id'), str) and bool(s['session_id'])
            and s.get('status') in ('starting', 'ready', 'live', 'stopping', 'stopped', 'failed')
            and isinstance(v, dict) and _even(v.get('width'), 1920) and _even(v.get('height'), 1080)
            and _fps(s.get('fps')))


def _validate_composition(c: Any) -> CallVideoComposition | None:
    """The composition with any camera grant parsed, or ``None`` on any response outside the contract."""
    if (not isinstance(c, dict) or not isinstance(c.get('composition_id'), str) or not c['composition_id']
            or not isinstance(c.get('call_id'), str) or not c['call_id']):
        return None
    if not (_integer(c.get('revision')) and 0 <= c['revision'] <= _MAX_SAFE) or c.get('status') not in (
            'starting', 'live', 'stopping', 'stopped', 'failed'):
        return None
    if 'error_code' not in c or not (c['error_code'] is None or isinstance(c['error_code'], str)):
        return None
    o = c.get('output')
    if not isinstance(o, dict) or not _even(o.get('width'), 1920) or not _even(o.get('height'), 1080) or not _fps(o.get('fps')):
        return None
    if not isinstance(c.get('layers'), list) or len(c['layers']) > COMPOSITION_MAX_LAYERS:
        return None
    ids: set[str] = set()
    zs: set[float] = set()
    base = False
    layers: list[dict[str, Any]] = []
    for layer in c['layers']:
        if not isinstance(layer, dict) or not isinstance(layer.get('id'), str) or layer['id'] in ids:
            return None
        z = layer.get('z')
        if _num(z) and z in zs:
            return None
        ids.add(layer['id'])
        if _num(z):
            zs.add(z)
        if 'source' in layer:
            source = layer['source']
            kind = source.get('kind') if isinstance(source, dict) else None
            if base or not _same(z, 0) or kind not in ('camera', 'managed'):
                return None
            base = True
            if 'publish' in layer:
                grant = _parse_media_session_grant(layer['publish'], 'publish', None, 'camera') if kind == 'camera' else None
                if grant is None or o['fps'] > grant.limits.max_fps:
                    return None
                layer = {**layer, 'publish': grant}
            layers.append(layer)
            continue
        if (not _integer(z) or z < 1 or not _region_ok(layer.get('region'))
                or layer.get('background') not in ('opaque', 'transparent') or not _unit(layer.get('opacity'))
                or not _inputs_ok(layer.get('input'))):
            return None
        session = layer.get('living_session')
        if not _living_session_ok(session) or session.get('call_id') != c['call_id'] or session['fps'] > o['fps']:
            return None
        layers.append(layer)
    return {**c, 'layers': layers}  # type: ignore[return-value]


def composition_input_target(composition: CallVideoComposition, x: float, y: float) -> dict[str, Any] | None:
    """The topmost page layer accepting pointer input under an output-frame point (x, y normalized 0..1), or ``None``.
    The backend maps output-frame coordinates into the page and rejects points outside the region."""
    if not _unit(x) or not _unit(y):
        return None
    pages = [layer for layer in composition['layers'] if 'source' not in layer and 'pointer' in layer['input']]
    pages.sort(key=lambda layer: layer['z'], reverse=True)
    for layer in pages:
        r = layer['region']
        if r['x'] <= x <= r['x'] + r['width'] and r['y'] <= y <= r['y'] + r['height']:
            return layer
    return None


__all__ = ['COMPOSITION_MAX_LAYERS', 'CompositionBaseKind', 'CompositionBackground', 'CompositionStatus',
           'LivingInputKind', 'LivingSessionStatus', 'CompositionBase', 'CompositionRegion', 'CompositionPage',
           'BaseLayerInput', 'PageLayerInput', 'LivingViewport', 'LivingSession', 'CompositionOutput',
           'CallVideoComposition', 'VideoCompositionCapability', 'parse_video_composition',
           'composition_input_target']
