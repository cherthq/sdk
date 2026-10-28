import json
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trychert import (ChertControlPlane, ChertControlPlaneError, MediaCapabilities, MediaFrameError,
                      MediaSessionGrant, VideoCompositionCapability, VideoPlane, composition_input_target,
                      copy_video_frame, parse_media_capabilities, parse_video_composition)

SECRET = 'facetime-media-key'
GRANT_TOKEN = 'session-bearer-secret'
PRIVATE = 'private-server-content'
SESSION_ID = '0b7f3c9e-2d4a-4c1b-9e8f-1a2b3c4d5e6f'


def grant(**overrides):
    value = {'session_id': SESSION_ID, 'direction': 'publish', 'endpoint': 'https://media.example.test/opaque/abc',
             'token': GRANT_TOKEN, 'connect_by': '2026-10-25T12:00:00Z', 'expires_at': '2026-10-25T12:30:00.5+00:00',
             'ice_servers': [{'urls': 'stun:stun.example.test'},
                             {'urls': ['turn:turn.example.test'], 'username': 'u', 'credential': 'turn-secret',
                              'credentialType': 'password'}],
             'codecs': ['h264', 'vp8'],
             'limits': {'max_width': 1920, 'max_height': 1080, 'max_fps': 30, 'max_frame_bytes': 8388608}}
    value.update(overrides)
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.calls.append((self.command, self.path, self.headers, json.loads(raw) if raw else None))
        data = json.dumps(self.server.payload).encode()
        self.send_response(self.server.status)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_PUT = do_GET = do_DELETE = do_POST


class MediaSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.client = ChertControlPlane(f'http://127.0.0.1:{cls.server.server_port}', token=SECRET, project_id='project-1')

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.server.calls = []
        self.server.status = 201
        self.server.payload = {'data': grant()}

    def test_request_body_headers_and_grant(self):
        result = self.client.create_media_session('call/1', direction='publish')
        method, path, headers, body = self.server.calls[0]
        self.assertEqual((method, path), ('POST', '/api/v1/calls/call%2F1/media-sessions'))
        self.assertEqual(body, {'direction': 'publish'})
        self.assertEqual(headers['Authorization'], 'Bearer ' + SECRET)
        self.assertEqual(headers['x-chert-project-id'], 'project-1')
        self.assertIsInstance(result, MediaSessionGrant)
        self.assertEqual(result.token, GRANT_TOKEN)
        self.assertEqual(result.codecs, ('h264', 'vp8'))
        self.assertEqual(result.limits.max_frame_bytes, 8388608)
        self.assertEqual(result.ice_servers[1].urls, ('turn:turn.example.test',))
        for text in (repr(result), str(result)):
            self.assertNotIn(GRANT_TOKEN, text)
            self.assertNotIn('turn-secret', text)

        self.client.create_media_session('call-1', direction='publish', codecs=['vp8', 'h264'])
        self.assertEqual(self.server.calls[1][3], {'direction': 'publish', 'codecs': ['vp8', 'h264']})

    def test_local_validation_sends_nothing(self):
        for kwargs in ({'direction': 'both'}, {'direction': 'publish', 'codecs': []},
                       {'direction': 'publish', 'codecs': ['h264', 'h264']},
                       {'direction': 'publish', 'codecs': ['av1']}, {'direction': 'publish', 'codecs': 'h264'}):
            with self.assertRaises(ValueError):
                self.client.create_media_session('call-1', **kwargs)
        for call_id in ('', '.', '..', None):
            with self.assertRaises(ValueError):
                self.client.create_media_session(call_id, direction='publish')
        self.assertEqual(self.server.calls, [])

    def test_grant_validation_failures(self):
        invalid = [None, [], grant(direction='subscribe'), grant(session_id='not-a-uuid'),
                   grant(endpoint='http://media.example.test/x'), grant(endpoint='https://user:pw@media.example.test/'),
                   grant(endpoint='https://media.example.test/#frag'), grant(endpoint='not a url'),
                   grant(token=''), grant(token='a\r\nb'), grant(token=None),
                   grant(connect_by='yesterday'), grant(expires_at='2026-13-01T00:00:00Z'),
                   grant(ice_servers={}), grant(ice_servers=[{'urls': 3}]), grant(ice_servers=[['stun:x']]),
                   grant(codecs=[]), grant(codecs=['av1']), grant(codecs=['h264', 'h264']),
                   grant(connect_by='2026-10-25 12:00:00Z'),
                   grant(connect_by='2026-10-25T12:30:00.001Z', expires_at='2026-10-25T12:30:00Z'),
                   grant(connect_by='2026-10-25T12:00:00-01:00', expires_at='2026-10-25T12:30:00Z'),
                   grant(ice_servers=[{'urls': []}]), grant(ice_servers=[{'urls': 'stun:x', 'username': None}]),
                   grant(ice_servers=[{'urls': 'stun:x', 'credential': 7}]),
                   grant(ice_servers=[{'urls': 'stun:x', 'credentialType': None}]),
                   grant(ice_servers=[{'urls': 'stun:x', 'credentialType': 'oauth'}]),
                   grant(limits={'max_width': 1921, 'max_height': 1080, 'max_fps': 30, 'max_frame_bytes': 1}),
                   grant(limits={'max_width': 1920, 'max_height': 1080, 'max_fps': 31, 'max_frame_bytes': 1}),
                   grant(limits={'max_width': 1920, 'max_height': 1080, 'max_fps': 30, 'max_frame_bytes': 8388609}),
                   grant(limits={'max_width': 0, 'max_height': 1080, 'max_fps': 30, 'max_frame_bytes': 1}),
                   grant(limits=None)]
        for payload in invalid:
            self.server.payload = {'data': payload}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_media_session('call-1', direction='publish')
            self.assertEqual((caught.exception.status, caught.exception.code), (201, 'invalid_response'))
            self.assertNotIn(GRANT_TOKEN, str(caught.exception))
        for endpoint in ('http://localhost:8889/x', 'http://127.0.0.1/x', 'http://[::1]:1/x'):
            self.server.payload = {'data': grant(endpoint=endpoint)}
            self.assertEqual(self.client.create_media_session('call-1', direction='publish').endpoint, endpoint)

    def test_timestamp_ordering_uses_instants_with_millisecond_precision(self):
        for connect_by, expires_at in (('2026-10-25T12:30:00Z', '2026-10-25T12:30:00Z'),
                                       ('2026-10-25T13:00:00+01:00', '2026-10-25T12:00:00Z'),
                                       ('2026-10-25T12:30:00.0009Z', '2026-10-25T12:30:00.0001Z')):
            self.server.payload = {'data': grant(connect_by=connect_by, expires_at=expires_at)}
            self.assertEqual(self.client.create_media_session('call-1', direction='publish').connect_by, connect_by)

    def test_returned_codecs_must_be_within_requested(self):
        self.server.payload = {'data': grant(codecs=['h264', 'vp8'])}
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.client.create_media_session('call-1', direction='publish', codecs=['vp8'])
        self.assertEqual((caught.exception.status, caught.exception.code), (201, 'invalid_response'))
        self.server.payload = {'data': grant(codecs=['h264'])}
        result = self.client.create_media_session('call-1', direction='publish', codecs=['vp8', 'h264'])
        self.assertEqual(result.codecs, ('h264',))

    def test_subscribe_limits_are_capped_at_720p(self):
        limits = {'max_width': 1280, 'max_height': 720, 'max_fps': 30, 'max_frame_bytes': 8388608}
        self.server.payload = {'data': grant(direction='subscribe', limits=limits)}
        self.assertEqual(self.client.create_media_session('call-1', direction='subscribe').limits.max_width, 1280)
        for over in ({'max_width': 1281}, {'max_height': 721}):
            self.server.payload = {'data': grant(direction='subscribe', limits={**limits, **over})}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_media_session('call-1', direction='subscribe')
            self.assertEqual(caught.exception.code, 'invalid_response')

    def test_error_codes_surface_without_server_text(self):
        cases = [(401, 'unauthorized'), (401, 'media_session_expired'), (404, 'call_not_found'),
                 (409, 'media_capability_unsupported'), (409, 'media_session_conflict'), (409, 'call_not_active'),
                 (410, 'call_ended'), (503, 'media_transport_unavailable'), (409, 'something_else')]
        for status, code in cases:
            self.server.status = status
            self.server.payload = {'error': {'code': code, 'message': PRIVATE}}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_media_session('call-1', direction='publish')
            expected = 'request_failed' if code == 'something_else' else code
            self.assertEqual((caught.exception.status, caught.exception.code), (status, expected))
            self.assertNotIn(PRIVATE, str(caught.exception) + repr(caught.exception))
        self.assertEqual(len(self.server.calls), len(cases))

    def test_screen_content_is_validated_echoed_and_capped(self):
        screen_limits = {'max_width': 1920, 'max_height': 1080, 'max_fps': 15, 'max_frame_bytes': 8388608}
        screen = grant(content='screen', limits=screen_limits)
        caller = grant(direction='subscribe', content='caller_screen',
                       limits={'max_width': 1280, 'max_height': 720, 'max_fps': 30, 'max_frame_bytes': 8388608})
        self.server.payload = {'data': screen}
        result = self.client.create_media_session('call-1', direction='publish', content='screen')
        self.assertEqual((result.content, result.limits.max_fps), ('screen', 15))
        self.server.payload = {'data': caller}
        result = self.client.create_media_session('call-1', direction='subscribe', content='caller_screen')
        self.assertEqual(result.content, 'caller_screen')
        self.assertEqual([call[3] for call in self.server.calls],
                         [{'direction': 'publish', 'content': 'screen'},
                          {'direction': 'subscribe', 'content': 'caller_screen'}])

        # Wrong combinations fail locally with no request.
        for direction, content in (('publish', 'caller_screen'), ('subscribe', 'screen'),
                                   ('subscribe', 'camera'), ('publish', 'window')):
            with self.assertRaises(ValueError):
                self.client.create_media_session('call-1', direction=direction, content=content)
        self.assertEqual(len(self.server.calls), 2)

        no_echo = dict(screen)
        del no_echo['content']
        for kwargs, payload in (({'direction': 'publish', 'content': 'screen'}, {**screen, 'limits': {**screen_limits, 'max_fps': 30}}),
                                ({'direction': 'publish', 'content': 'screen'}, no_echo),
                                ({'direction': 'publish', 'content': 'screen'}, {**screen, 'content': 'camera'}),
                                ({'direction': 'publish'}, screen), ({'direction': 'subscribe'}, caller)):
            self.server.payload = {'data': payload}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_media_session('call-1', **kwargs)
            self.assertEqual((caught.exception.status, caught.exception.code), (201, 'invalid_response'))
        # The backend echoes the resolved camera content on default requests in both directions.
        self.server.payload = {'data': grant(content='camera')}
        self.assertEqual(self.client.create_media_session('call-1', direction='publish').content, 'camera')
        self.server.payload = {'data': {**caller, 'content': 'camera'}}
        self.assertEqual(self.client.create_media_session('call-1', direction='subscribe').content, 'camera')
        self.server.payload = {'data': grant()}
        self.assertIsNone(self.client.create_media_session('call-1', direction='publish').content)

        self.server.status = 409
        self.server.payload = {'error': {'code': 'caller_screen_not_shared', 'message': PRIVATE}}
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.client.create_media_session('call-1', direction='subscribe', content='caller_screen')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'caller_screen_not_shared'))
        self.assertNotIn(PRIVATE, str(caught.exception))
        for status, code in ((409, 'media_content_unsupported'), (409, 'caller_screen_unsupported'), (422, 'media_limit_exceeded')):
            self.server.status = status
            self.server.payload = {'error': {'code': code, 'message': PRIVATE}}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_media_session('call-1', direction='publish', content='screen')
            self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
            self.assertNotIn(PRIVATE, str(caught.exception))


def living_session(fps, call='call'):
    return {'session_id': 'ls', 'call_id': call, 'deployment_id': 'dep', 'status': 'starting',
            'viewport': {'width': 1920, 'height': 270}, 'fps': fps, 'ready_at': None, 'last_heartbeat_at': None,
            'error_code': None}


CAMERA_GRANT = grant(content='camera', codecs=['h264'],
                     limits={'max_width': 1920, 'max_height': 1080, 'max_fps': 24, 'max_frame_bytes': 8388608})
CAPTIONS = {'id': 'captions', 'z': 1, 'living_session': living_session(12),
            'region': {'x': 0, 'y': 0.75, 'width': 1, 'height': 0.25}, 'background': 'transparent', 'opacity': 0.8,
            'input': ['pointer']}
CAMERA_BASE = {'id': 'base', 'z': 0, 'source': {'kind': 'camera'}, 'publish': CAMERA_GRANT}
LAYERED = {'composition_id': 'cmp', 'call_id': 'call', 'revision': 3, 'status': 'starting',
           'output': {'width': 1920, 'height': 1080, 'fps': 24}, 'error_code': None, 'layers': [CAMERA_BASE, CAPTIONS]}
PAGE_ONLY = {**LAYERED, 'output': {'width': 1280, 'height': 720, 'fps': 30},
             'layers': [{'id': 'page', 'z': 1, 'living_session': living_session(30),
                         'region': {'x': 0, 'y': 0, 'width': 1, 'height': 1}, 'background': 'opaque', 'opacity': 1,
                         'input': []}]}


class CallVideoTests(unittest.TestCase):
    setUpClass = MediaSessionTests.__dict__['setUpClass']
    tearDownClass = MediaSessionTests.__dict__['tearDownClass']

    def setUp(self):
        self.server.calls = []
        self.server.status = 200
        self.server.payload = {'data': LAYERED}

    def wire(self):
        return [(method, path, body, headers.get('Idempotency-Key')) for method, path, headers, body in self.server.calls]

    def test_page_shortcut_layered_get_and_clear(self):
        self.server.payload = {'data': PAGE_ONLY}
        self.assertEqual(self.client.set_call_video('call', {'page': {'deployment_id': 'dep-1'}},
                                                    idempotency_key='video-key-1'), PAGE_ONLY)
        self.server.payload = {'data': LAYERED}
        result = self.client.set_call_video('call', {'revision': 2, 'layers': [
            {'id': 'base', 'source': {'kind': 'camera'}},
            {'id': 'captions', 'z': 1, 'page': {'deployment_id': 'dep'}, 'region': {'x': 0, 'y': 0.75, 'width': 1, 'height': 0.25},
             'background': 'transparent', 'opacity': 0.8, 'input': ['pointer'], 'initial_state': {'lang': 'en'}}]},
            idempotency_key='video-key-2')
        publish = result['layers'][0]['publish']
        self.assertIsInstance(publish, MediaSessionGrant)
        self.assertEqual((publish.token, publish.content, publish.limits.max_fps), (GRANT_TOKEN, 'camera', 24))
        self.assertNotIn(GRANT_TOKEN, repr(result))
        self.assertEqual(result['layers'][1], CAPTIONS)
        self.client.get_call_video('call')
        self.client.clear_call_video('call')
        self.assertEqual(self.wire(), [
            ('PUT', '/api/v1/calls/call/video', {'layers': [{'id': 'page', 'z': 1, 'page': {'deployment_id': 'dep-1'},
             'region': {'x': 0, 'y': 0, 'width': 1, 'height': 1}, 'background': 'opaque', 'opacity': 1}]}, 'video-key-1'),
            ('PUT', '/api/v1/calls/call/video', {'revision': 2, 'layers': [{'id': 'base', 'z': 0, 'source': {'kind': 'camera'}},
             {'id': 'captions', 'z': 1, 'page': {'deployment_id': 'dep'}, 'region': {'x': 0, 'y': 0.75, 'width': 1, 'height': 0.25},
              'background': 'transparent', 'opacity': 0.8, 'input': ['pointer'], 'initial_state': {'lang': 'en'}}]}, 'video-key-2'),
            ('GET', '/api/v1/calls/call/video', None, None),
            ('DELETE', '/api/v1/calls/call/video', None, None)])
        # Exact key order and defaults, as the reference SDK serializes them.
        self.assertEqual(self.server.calls[0][2]['Content-Type'], 'application/json')
        self.assertEqual(list(self.server.calls[1][3]), ['revision', 'layers'])
        self.assertEqual(list(self.server.calls[1][3]['layers'][1]),
                         ['id', 'z', 'page', 'region', 'background', 'opacity', 'input', 'initial_state'])
        # Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
        self.assertEqual(composition_input_target(result, 0.5, 0.9)['id'], 'captions')
        self.assertIsNone(composition_input_target(result, 0.5, 0.74))
        self.assertIsNone(composition_input_target(PAGE_ONLY, 0.5, 0.5))  # declares no input
        self.assertIsNone(composition_input_target(result, 1.5, 0.9))

    def test_invalid_compositions_are_rejected_locally(self):
        page = {'id': 'p', 'z': 1, 'page': {'deployment_id': 'dep'}}
        base = {'id': 'base', 'source': {'kind': 'camera'}}
        for value in (
                {'layers': []}, {'layers': [base, page, {**page, 'id': 'q', 'z': 2}]},  # 0 and 3 layers
                {'layers': [base, {**base, 'id': 'b2'}]}, {'layers': [base, {**page, 'id': 'base'}]},  # two bases; duplicate id
                {'layers': [base, {**page, 'z': 0}]}, {'layers': [base, {**page, 'z': 1.5}]},
                {'layers': [base, {**page, 'region': {'x': 0.5, 'y': 0, 'width': 0.6, 'height': 1}}]},  # leaves the frame
                {'layers': [base, {**page, 'region': {'x': 0, 'y': 0, 'width': 0, 'height': 1}}]},
                {'layers': [base, {**page, 'opacity': 1.2}]}, {'layers': [base, {**page, 'background': 'blurred'}]},
                {'layers': [{**page, 'background': 'transparent'}]}, {'layers': [{**page, 'opacity': 0.5}]},  # nothing below
                {'layers': [{**page, 'region': {'x': 0, 'y': 0, 'width': 0.5, 'height': 1}}]},
                {'layers': [base, {**page, 'input': ['pointer', 'pointer']}]}, {'layers': [{'id': 'base', 'source': {'kind': 'screen'}}]},
                {'page': {'deployment_id': ''}}, {'page': {'deployment_id': 'dep'}, 'revision': -1},
                {'layers': [{**page, 'id': 'Upper'}]}, {'layers': [base, {**page, 'initial_state': float('nan')}]},
                {'layers': [base, {**base, 'id': 'b0', 'z': 1}]}, None, {},
                # URL pages are never sent: native SDKs need a ready deployment ID.
                {'page': 'https://agent.example/p'}, {'page': {'url': 'https://agent.example/p'}},
                {'layers': [base, {**page, 'page': 'https://agent.example/p'}]}):
            with self.assertRaises(ValueError):
                self.client.set_call_video('call', value, idempotency_key='video-key-1')
        for key in ('short', 'has space-key', 'x' * 201, None):
            with self.assertRaises(ValueError):
                self.client.set_call_video('call', {'page': {'deployment_id': 'dep'}}, idempotency_key=key)
        for call_id in ('', '.', '..', None):
            with self.assertRaises(ValueError):
                self.client.set_call_video(call_id, {'page': {'deployment_id': 'dep'}}, idempotency_key='video-key-1')
        with self.assertRaises(ValueError) as caught:
            self.client.set_call_video('call', {'page': 'https://agent.example/p'}, idempotency_key='video-key-1')
        self.assertIn('TypeScript SDK', str(caught.exception))
        self.assertEqual(self.server.calls, [])
        # A region touching the frame edge is inside it.
        self.client.set_call_video('call', {'layers': [base, {**page, 'region': {'x': 0.75, 'y': 0.75, 'width': 0.25, 'height': 0.25}}]},
                                   idempotency_key='video-key-1')
        self.assertEqual(len(self.server.calls), 1)

    def test_responses_outside_the_contract_are_invalid_response(self):
        def with_layers(layers, **extra):
            return {**LAYERED, **extra, 'layers': layers}
        for bad in (
                with_layers([CAMERA_BASE, {**CAPTIONS, 'living_session': living_session(30)}]),  # page fps above output
                with_layers([CAMERA_BASE, CAPTIONS], output={'width': 1920, 'height': 1080, 'fps': 30}),  # above grant
                with_layers([{'id': 'base', 'z': 0, 'source': {'kind': 'managed'}, 'publish': CAMERA_GRANT}, CAPTIONS]),
                with_layers([{**CAMERA_BASE, 'publish': {**CAMERA_GRANT, 'content': 'screen'}}, CAPTIONS]),
                with_layers([CAMERA_BASE, CAPTIONS, {**CAPTIONS, 'id': 'more', 'z': 2}]),
                with_layers([CAMERA_BASE, {**CAPTIONS, 'living_session': living_session(12, 'other')}]),
                with_layers([CAMERA_BASE, {**CAPTIONS, 'region': {'x': 0.5, 'y': 0, 'width': 0.6, 'height': 1}}]),
                with_layers([CAMERA_BASE, {**CAPTIONS, 'z': 0}]),
                {**LAYERED, 'status': 'paused'}, {**LAYERED, 'output': {'width': 1921, 'height': 1080, 'fps': 24}},
                with_layers([CAMERA_BASE, {**CAPTIONS, 'living_session': {**living_session(12), 'status': 'paused'}}]),
                with_layers([CAMERA_BASE, {**CAPTIONS, 'living_session': {**living_session(12), 'viewport': {'width': 15, 'height': 270}}}]),
                with_layers([CAMERA_BASE, {**CAPTIONS, 'living_session': {**living_session(12), 'session_id': ''}}]),
                {k: v for k, v in LAYERED.items() if k != 'error_code'}, None, []):
            self.server.payload = {'data': bad}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.get_call_video('call')
            self.assertEqual((caught.exception.status, caught.exception.code), (200, 'invalid_response'))
            self.assertNotIn(GRANT_TOKEN, str(caught.exception))
        self.server.payload = {'data': with_layers([{'id': 'base', 'z': 0, 'source': {'kind': 'managed'}}, CAPTIONS])}
        self.assertEqual(self.client.get_call_video('call')['layers'][0]['source'], {'kind': 'managed'})

    def test_error_codes_survive_sanitization_without_server_text(self):
        cases = [(409, 'video_composition_unsupported'), (422, 'composition_invalid'), (409, 'composition_revision_conflict'),
                 (409, 'composition_base_unavailable'), (409, 'media_session_conflict'), (409, 'composition_secret')]
        for status, code in cases:
            self.server.status = status
            self.server.payload = {'error': {'code': code, 'message': PRIVATE}}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.set_call_video('call', {'page': {'deployment_id': 'dep'}}, idempotency_key='video-key-1')
            expected = 'request_failed' if code == 'composition_secret' else code
            self.assertEqual((caught.exception.status, caught.exception.code), (status, expected))
            self.assertNotIn(PRIVATE, str(caught.exception) + repr(caught.exception))

    def test_video_composition_capability(self):
        cap = {'version': 1, 'supported': True, 'max_layers': 4, 'bases': ['camera', 'hologram', 'managed', 'camera'],
               'page_alpha': True, 'regions': True, 'max_width': 3840, 'max_height': 1080, 'max_fps': 60}
        self.assertEqual(parse_video_composition(cap), VideoCompositionCapability(
            1, True, 2, ('camera', 'managed'), True, True, 1920, 1080, 30))
        self.assertFalse(parse_video_composition({**cap, 'page_alpha': 'yes'}).page_alpha)
        for bad in (None, 'v1', {**cap, 'version': 2}, {**cap, 'version': True}, {**cap, 'supported': False},
                    {**cap, 'max_layers': 0}, {**cap, 'bases': 'camera'}, {**cap, 'max_fps': 1.5}):
            self.assertIsNone(parse_video_composition(bad))


def caps(**overrides):
    value = {'version': 1,
             'custom_video': {'supported': True, 'transports': ['whip', 'whip', 'livekit'], 'codecs': ['vp8', 'h264', 'vp8'],
                              'max_width': 1920, 'max_height': 1080, 'max_fps': 30},
             'inbound_caller_video': {'supported': True, 'transports': ['whep'], 'max_width': 1280,
                                      'max_height': 720, 'max_fps': 30}}
    value.update(overrides)
    return value


class CapabilityTests(unittest.TestCase):
    def test_absent_malformed_and_unknown_version_are_unsupported(self):
        for value in (None, {}, 'v1', [], {'version': 2, 'custom_video': caps()['custom_video']},
                      {'version': True, 'custom_video': caps()['custom_video']}, {'video': True, 'supports_video': True}):
            self.assertEqual(parse_media_capabilities(value), MediaCapabilities())

    def test_valid_sections_are_deduped_in_order(self):
        parsed = parse_media_capabilities(caps())
        self.assertEqual(parsed.custom_video.transports, ('whip', 'livekit'))
        self.assertEqual(parsed.custom_video.codecs, ('vp8', 'h264'))
        self.assertEqual(parsed.inbound_caller_video.max_width, 1280)
        self.assertEqual(parse_media_capabilities(caps(version=1.0)).custom_video.max_fps, 30)

    def test_contents_default_to_camera_and_ignore_unknown_entries(self):
        parsed = parse_media_capabilities(caps())
        self.assertEqual((parsed.custom_video.contents, parsed.inbound_caller_video.contents), (('camera',), ('camera',)))
        cv, iv = caps()['custom_video'], caps()['inbound_caller_video']
        parsed = parse_media_capabilities(caps(custom_video={**cv, 'contents': ['screen', 'window', 'camera', 'screen']},
                                               inbound_caller_video={**iv, 'contents': ['screen']}))
        self.assertEqual(parsed.custom_video.contents, ('screen', 'camera'))
        self.assertEqual(parsed.inbound_caller_video.contents, ('screen',))
        for contents in ([], ['window'], 'screen', None, [7]):
            parsed = parse_media_capabilities(caps(custom_video={**cv, 'contents': contents}))
            self.assertEqual(parsed.custom_video.contents, ('camera',))

    def test_invalid_sections_disable_only_themselves(self):
        cv, iv = caps()['custom_video'], caps()['inbound_caller_video']
        bad_custom = [{**cv, 'max_width': 1921}, {**cv, 'max_height': 1081}, {**cv, 'max_fps': 31},
                      {**cv, 'max_fps': 0}, {**cv, 'max_fps': 29.5}, {**cv, 'max_width': True},
                      {**cv, 'transports': ['whep']}, {**cv, 'transports': []}, {**cv, 'codecs': []},
                      {**cv, 'codecs': ['av1']}, {**cv, 'supported': False}, {**cv, 'supported': 1}, None]
        for section in bad_custom:
            parsed = parse_media_capabilities(caps(custom_video=section))
            self.assertIsNone(parsed.custom_video)
            self.assertIsNotNone(parsed.inbound_caller_video)
        for section in ({**iv, 'max_width': 1281}, {**iv, 'max_height': 721}, {**iv, 'transports': ['whip']},
                        {**iv, 'max_fps': 31}):
            parsed = parse_media_capabilities(caps(inbound_caller_video=section))
            self.assertIsNone(parsed.inbound_caller_video)
            self.assertIsNotNone(parsed.custom_video)


def i420(width, height, stride=None, ts=1):
    stride = stride or width
    return dict(format='i420', width=width, height=height, timestamp_us=ts,
                planes=[VideoPlane(bytearray(stride * height), stride),
                        VideoPlane(bytes(stride // 2 * height // 2), stride // 2),
                        VideoPlane(memoryview(bytes(stride // 2 * height // 2)), stride // 2)])


class FrameTests(unittest.TestCase):
    def assert_code(self, code, **kwargs):
        with self.assertRaises(MediaFrameError) as caught:
            copy_video_frame(**kwargs)
        self.assertEqual(caught.exception.code, code)
        self.assertIsInstance(caught.exception, ValueError)
        return caught.exception

    def test_copies_only_required_bytes_and_applies_defaults(self):
        source = i420(64, 32, stride=80)
        frame = copy_video_frame(**source)
        source['planes'][0].data[0] = 9
        self.assertEqual(frame.planes[0].data[0], 0)
        self.assertIsInstance(frame.planes[0].data, bytes)
        self.assertEqual(len(frame.planes[0].data), 80 * 31 + 64)
        self.assertEqual(len(frame.planes[1].data), 40 * 15 + 32)
        self.assertEqual((frame.color_space, frame.rotation, frame.duration_us), ('bt709-limited', 0, None))
        rgb = copy_video_frame(format='bgra', width=16, height=16, timestamp_us=0, rotation=90,
                               planes=[VideoPlane(bytes(1024), 64)])
        self.assertEqual((rgb.color_space, rgb.rotation), ('srgb-full', 90))
        nv12 = copy_video_frame(format='nv12', width=16, height=16, timestamp_us=0, color_space='bt601-limited',
                                planes=[VideoPlane(bytes(256), 16), VideoPlane(bytes(128), 16)])
        self.assertEqual(nv12.color_space, 'bt601-limited')

    def test_bounds(self):
        self.assert_code('invalid_frame', **i420(64, 32, stride=62))
        self.assert_code('invalid_frame', **i420(64, 32, stride=64 + 258))
        self.assert_code('invalid_frame', **{**i420(64, 32), 'width': 63})
        self.assert_code('invalid_frame', **{**i420(64, 32), 'height': 14})
        self.assert_code('invalid_frame', **i420(1922, 1080))
        self.assert_code('invalid_frame', **{**i420(64, 32), 'format': 'yuy2'})
        self.assert_code('invalid_frame', **{**i420(64, 32), 'timestamp_us': -1})
        self.assert_code('invalid_frame', **{**i420(64, 32), 'rotation': 45})
        self.assert_code('invalid_frame', **{**i420(64, 32), 'color_space': 'p3'})
        self.assert_code('invalid_frame', **{**i420(64, 32), 'duration_us': 0})
        error = self.assert_code('invalid_frame', format='nv12', width=16, height=16, timestamp_us=0,
                                 planes=[VideoPlane(bytes(256), 16)])
        self.assertIn('2 plane', str(error))
        short = i420(64, 32)
        short['planes'][1] = VideoPlane(bytes(10), 32)
        self.assertIn('Plane 1', str(self.assert_code('invalid_frame', **short)))
        self.assert_code('frame_too_large', format='rgba', width=1920, height=1080, timestamp_us=0,
                         planes=[VideoPlane(bytes(7936 * 1080), 7936)])
        self.assertEqual(len(copy_video_frame(format='rgba', width=1920, height=1080, timestamp_us=0,
                                              planes=[VideoPlane(bytes(7680 * 1080), 7680)]).planes[0].data), 8294400)


if __name__ == '__main__':
    unittest.main()
