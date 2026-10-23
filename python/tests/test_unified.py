import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trychert import (Chert, ChertClient, ChertControlPlane, ChertControlPlaneError,
                     FaceTimeConfig, IMessageConfig)

SECRET = 'facetime-private-key'
MESSAGE_SECRET = 'imessage-private-key'
PRIVATE = 'private-server-content'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle_request(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.calls.append((self.command, self.path, dict(self.headers), json.loads(raw) if raw else None))
        if self.server.delay:
            time.sleep(self.server.delay)
        self.send_response(self.server.status)
        if self.server.status == 307:
            self.send_header('Location', self.server.redirect)
        data = self.server.raw if self.server.raw is not None else json.dumps(self.server.payload).encode()
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    do_GET = do_POST = do_DELETE = handle_request


class UnifiedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servers = []
        for _ in range(2):
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.thread = threading.Thread(target=server.serve_forever, daemon=True)
            server.thread.start()
            cls.servers.append(server)
        cls.server, cls.messaging = cls.servers
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.message_base = f'http://127.0.0.1:{cls.messaging.server_port}'

    @classmethod
    def tearDownClass(cls):
        for server in cls.servers:
            server.shutdown()
            server.server_close()
            server.thread.join()

    def setUp(self):
        for server in self.servers:
            server.calls = []
            server.payload = {'data': {'ok': True}}
            server.status, server.raw, server.delay = 200, None, 0
            server.redirect = self.message_base + '/sink'
        self.client = ChertControlPlane(self.base, token=SECRET, project_id='project-only')

    def test_every_control_plane_route_body_and_auth_scope(self):
        cases = [
            (lambda: self.client.begin_login('laptop'), 'POST', 'cli/logins', {'device_name': 'laptop'}, 'public'),
            (lambda: self.client.poll_login('device-code'), 'POST', 'cli/logins/token', {'device_code': 'device-code'}, 'public'),
            (lambda: self.client.inspect_login('CODE'), 'POST', 'cli/logins/inspect', {'user_code': 'CODE'}, 'user'),
            (lambda: self.client.approve_login('CODE', 'selected'), 'POST', 'cli/logins/approve', {'user_code': 'CODE', 'project_id': 'selected'}, 'user'),
            (self.client.whoami, 'GET', 'cli/whoami', None, 'project'),
            (self.client.logout, 'POST', 'cli/logout', None, 'user'),
            (self.client.list_credentials, 'GET', 'cli/credentials', None, 'project'),
            (lambda: self.client.revoke_credential('id/with ?#'), 'DELETE', 'cli/credentials/id%2Fwith%20%3F%23', None, 'project'),
            (lambda: self.client.list_lines(limit=100, offset=0), 'GET', 'lines?limit=100&offset=0', None, 'project'),
            (self.client.list_workers, 'GET', 'workers', None, 'project'),
            (self.client.list_connectors, 'GET', 'connectors', None, 'project'),
            (lambda: self.client.enroll_connector({'line_id': 'line', 'name': 'connector', 'environment': 'development', 'session_mode': 'byor'}), 'POST', 'connectors', {'action': 'enroll', 'line_id': 'line', 'name': 'connector', 'environment': 'development', 'session_mode': 'byor'}, 'project'),
            (lambda: self.client.activate_connector('binding', None, 2), 'POST', 'connectors', {'action': 'activate', 'binding_id': 'binding', 'expected_binding_id': None, 'assignment_generation': 2}, 'project'),
            (lambda: self.client.drain_connector('binding'), 'POST', 'connectors', {'action': 'drain', 'binding_id': 'binding'}, 'project'),
            (lambda: self.client.revoke_connector('binding'), 'POST', 'connectors', {'action': 'revoke', 'binding_id': 'binding'}, 'project'),
            (self.client.billing_catalog, 'GET', 'billing/catalog', None, 'public'),
            (self.client.current_checkout, 'GET', 'billing/checkout', None, 'project'),
            (lambda: self.client.create_checkout(plan_id='shared', catalog_version='2026-10-22', idempotency_key='stable-key'), 'POST', 'billing/checkout', {'plan_id': 'shared', 'catalog_version': '2026-10-22'}, 'project'),
        ]
        for call, method, path, body, auth in cases:
            with self.subTest(path=path, body=body):
                before = len(self.server.calls)
                self.assertEqual(call(), {'ok': True})
                self.assertEqual(len(self.server.calls), before + 1)
                observed_method, observed_path, headers, observed_body = self.server.calls[-1]
                headers = {k.lower(): v for k, v in headers.items()}
                self.assertEqual((observed_method, observed_path, observed_body), (method, '/api/v1/' + path, body))
                self.assertEqual(headers.get('authorization'), None if auth == 'public' else 'Bearer ' + SECRET)
                self.assertEqual(headers.get('x-chert-project-id'), 'project-only' if auth == 'project' else None)
                self.assertNotIn('x-chert-tenant', headers)
                self.assertEqual(headers.get('idempotency-key'), 'stable-key' if path == 'billing/checkout' and method == 'POST' else None)

    def test_wrapper_keeps_credentials_and_project_independent(self):
        im = IMessageConfig(self.message_base, MESSAGE_SECRET, 'tenant-only')
        ft = FaceTimeConfig(self.base, SECRET, 'project-only')
        sdk = Chert(imessage=im, facetime=ft)
        self.assertIsInstance(sdk.imessage, ChertClient)
        sdk.imessage.request('/whoami')
        sdk.facetime.whoami()
        im_headers = {k.lower(): v for k, v in self.messaging.calls[-1][2].items()}
        ft_headers = {k.lower(): v for k, v in self.server.calls[-1][2].items()}
        self.assertEqual(im_headers['authorization'], 'Bearer ' + MESSAGE_SECRET)
        self.assertEqual(im_headers['x-chert-tenant'], 'tenant-only')
        self.assertNotIn('x-chert-project-id', im_headers)
        self.assertEqual(ft_headers['authorization'], 'Bearer ' + SECRET)
        self.assertNotIn('x-chert-tenant', ft_headers)
        self.assertIsNone(Chert(imessage=im).facetime)
        self.assertIsNone(Chert(facetime=ft).imessage)
        self.assertNotIn(SECRET, repr(ft))
        self.assertNotIn(MESSAGE_SECRET, repr(im))
        from chert import ChertClient as Legacy
        self.assertIs(ChertClient, Legacy)

    def test_missing_credentials_never_borrow_from_other_channel(self):
        sdk = Chert(imessage=IMessageConfig(self.message_base, MESSAGE_SECRET), facetime=FaceTimeConfig(self.base))
        with self.assertRaises(ChertControlPlaneError) as caught:
            sdk.facetime.whoami()
        self.assertEqual(caught.exception.code, 'unauthorized')
        with self.assertRaises(ChertControlPlaneError) as caught:
            ChertControlPlane(self.base, token=SECRET).whoami()
        self.assertEqual(caught.exception.code, 'project_required')
        self.assertEqual(self.server.calls, [])
        ChertControlPlane(self.base).billing_catalog()
        ChertControlPlane(self.base, token=SECRET).logout()

    def test_errors_are_sanitized_and_envelopes_bounded(self):
        for status, raw, code in [
            (403, json.dumps({'error': {'code': 'forbidden', 'message': PRIVATE}}).encode(), 'forbidden'),
            (500, json.dumps({'error': {'code': SECRET, 'message': PRIVATE}}).encode(), 'request_failed'),
            (200, PRIVATE.encode(), 'invalid_response'),
            (200, b'{}', 'invalid_response'),
            (200, b'[]', 'invalid_response'),
            (200, b'{"data":NaN}', 'invalid_response'),
            (200, b'x' * 1_048_577, 'invalid_response'),
            (204, b'', 'invalid_response'),
        ]:
            with self.subTest(status=status, code=code):
                self.server.status, self.server.raw = status, raw
                before = len(self.server.calls)
                with self.assertRaises(ChertControlPlaneError) as caught:
                    self.client.whoami()
                error = caught.exception
                self.assertEqual((error.status, error.code), (status, code))
                for rendered in (str(error), repr(error), str(error.args)):
                    self.assertNotIn(SECRET, rendered)
                    self.assertNotIn(PRIVATE, rendered)
                self.assertIsNone(error.__context__)
                self.assertIsNone(error.__cause__)
                self.assertFalse(hasattr(error, 'data'))
                self.assertEqual(len(self.server.calls), before + 1)

    def test_null_data_and_login_tokens_are_returned_explicitly(self):
        self.server.payload = {'data': None}
        self.assertIsNone(self.client.current_checkout())
        self.server.payload = {'data': {'status': 'approved', 'access_token': SECRET}}
        self.assertEqual(self.client.poll_login('code')['access_token'], SECRET)

    def test_redirect_timeout_and_ambient_proxy_never_leak_or_retry(self):
        self.server.status = 307
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.client.whoami()
        self.assertEqual(caught.exception.code, 'network_error')
        self.assertEqual(len(self.server.calls), 1)
        self.assertEqual(self.messaging.calls, [])
        self.server.status, self.server.delay = 200, .1
        with self.assertRaises(ChertControlPlaneError) as caught:
            ChertControlPlane(self.base, token=SECRET, project_id='p', timeout=.01).whoami()
        self.assertEqual(caught.exception.code, 'network_error')
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual(len(self.server.calls), 2)
        self.server.delay = 0
        with patch.dict(os.environ, {'HTTP_PROXY': 'http://127.0.0.1:1', 'http_proxy': 'http://127.0.0.1:1', 'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '', 'NETRC': '/nonexistent'}):
            self.assertEqual(self.client.whoami(), {'ok': True})

    def test_invalid_input_rejected_before_network(self):
        for base in ('https://user:secret@example.test', 'https://example.test/path', 'https://example.test?', 'https://example.test#', 'https://example.test:99999', 'http://example.test', 'https://example.test\n', None):
            with self.subTest(base=base), self.assertRaises(ValueError):
                ChertControlPlane(base)
        for value in ('bad\nheader', 'bad\rheader', '\0', 'é'):
            with self.assertRaises(ValueError):
                ChertControlPlane(self.base, token=value)
            with self.assertRaises(ValueError):
                ChertControlPlane(self.base, project_id=value)
        for value in (True, -1, 0, 101, 1.5):
            with self.assertRaises(ValueError):
                self.client.list_lines(limit=value)
        for value in (True, -1, 1.5):
            with self.assertRaises(ValueError):
                self.client.list_workers(offset=value)
        for value in ('short', ' ' * 8, 'k' * 201, 'long-key\n'):
            with self.assertRaises(ValueError):
                self.client.create_checkout(plan_id='shared', catalog_version='2026-10-22', idempotency_key=value)
        self.assertEqual(self.server.calls, [])


if __name__ == '__main__':
    unittest.main()
