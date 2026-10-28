import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from unittest.mock import patch
from urllib.response import addinfourl

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

    def test_public_call_routes_bodies_and_distinct_event_shapes(self):
        from trychert.models import CreateCall, CallDetail, CallEvents
        body: CreateCall = {'direction': 'outbound', 'mode': 'customer_managed',
            'line_id': '11111111-1111-4111-8111-111111111111', 'destination': '+15550000002',
            'media': {'audio': True, 'video': True}, 'livekit_url': 'wss://room.example.test',
            'participant_token': 'synthetic-room-token', 'remote_participant_identity': 'agent'}
        detail: CallDetail = {'id': 'call', 'project_id': 'project-only', 'direction': 'outbound',
            'mode': 'customer_managed', 'media': body['media'], 'status': 'queued', 'media_status': {},
            'line_id': body['line_id'], 'worker_id': None, 'assistant_id': None, 'terminal_reason': None,
            'started_at': None, 'ended_at': None, 'duration_seconds': None,
            'facetime_call_events': [{'id': 'event', 'event_type': 'allocated', 'sequence': 1,
                'source': 'control', 'created_at': '2026-01-01T00:00:00Z', 'payload': {'synthetic': True}}]}
        timeline: CallEvents = {'call_id': 'call', 'events': [{'id': 'event', 'type': 'allocated',
            'sequence': None, 'source': 'control', 'at': '2026-01-01T00:00:00Z'}]}
        self.server.payload, self.server.status = {'data': detail}, 202
        self.assertEqual(self.client.create_call(body, idempotency_key='create-key'), detail)
        for method, action, payload in ((self.client.answer_call, 'answer', None),
                                       (self.client.reject_call, 'reject', {'reason': 'Unavailable'}),
                                       (self.client.end_call, 'end', None)):
            self.assertEqual(method('call', payload, idempotency_key=action + '-call-key'), detail)
        self.server.status = 200
        self.assertEqual(self.client.get_call('call'), detail)
        self.server.payload = {'data': timeline}
        self.assertEqual(self.client.get_call_events('call'), timeline)
        page = {'items': [detail], 'total': 1, 'limit': 7, 'offset': 2}
        self.server.payload = {'data': page}
        self.assertEqual(self.client.list_calls(limit=7, offset=2), page)
        self.assertEqual([(method, path) for method, path, _, _ in self.server.calls], [
            ('POST', '/api/v1/calls'), ('POST', '/api/v1/calls/call/answer'),
            ('POST', '/api/v1/calls/call/reject'), ('POST', '/api/v1/calls/call/end'),
            ('GET', '/api/v1/calls/call'), ('GET', '/api/v1/calls/call/events'),
            ('GET', '/api/v1/calls?limit=7&offset=2')])
        self.assertEqual([call[3] for call in self.server.calls[:4]], [body, {}, {'reason': 'Unavailable'}, {}])
        for index, (_, _, headers, _) in enumerate(self.server.calls):
            headers = {key.lower(): value for key, value in headers.items()}
            self.assertEqual(headers['authorization'], 'Bearer ' + SECRET)
            self.assertEqual(headers['x-chert-project-id'], 'project-only')
            if index < 4:
                self.assertEqual(headers['idempotency-key'], ['create-key', 'answer-call-key', 'reject-call-key', 'end-call-key'][index])
            else:
                self.assertNotIn('idempotency-key', headers)

    def test_calls_validate_before_network_and_never_retry(self):
        body = {'direction': 'outbound', 'mode': 'managed', 'assistant_id': 'synthetic-assistant',
                'destination': '+15550000002', 'media': {'audio': True, 'video': False}}
        for key in ('', 'short', 'x' * 201, 'contains space', 'newline\nkey', 'unicode-☃'):
            with self.assertRaises(ValueError):
                self.client.create_call(body, idempotency_key=key)
        for call_id in ('', '.', '..', None):
            with self.assertRaises(ValueError):
                self.client.get_call(call_id)
        for limit in (True, 0, 101, 1.5):
            with self.assertRaises(ValueError):
                self.client.list_calls(limit=limit)
        for client in (ChertControlPlane(self.base), ChertControlPlane(self.base, token=SECRET)):
            with self.assertRaises(ChertControlPlaneError):
                client.create_call(body, idempotency_key='stable-key')
        self.assertEqual(self.server.calls, [])
        for status in (301, 302, 303, 307, 308, 429, 503):
            self.server.status = status
            with self.assertRaises(ChertControlPlaneError):
                self.client.create_call(body, idempotency_key='stable-key')
        self.assertEqual(len(self.server.calls), 7)
        self.assertEqual(self.messaging.calls, [])
        self.server.status, self.server.raw = 200, b'invalid JSON'
        with self.assertRaises(ChertControlPlaneError):
            self.client.get_call_events('call')
        self.server.raw = b'x' * 1_048_577
        with self.assertRaises(ChertControlPlaneError):
            self.client.get_call_events('call')
        self.assertEqual(len(self.server.calls), 9)

    def test_facetime_default_and_explicit_https_override(self):
        requests = []

        def respond(request):
            requests.append(request)
            response = addinfourl(BytesIO(b'{"data":{"ok":true}}'), {}, request.full_url, 200)
            response.msg = 'OK'
            return response

        # Capture at the HTTP boundary: never send fixture credentials to production.
        with patch('urllib.request.HTTPSHandler.https_open', side_effect=respond):
            self.assertEqual(ChertControlPlane(token=SECRET, project_id='project-only').billing_status(), {'ok': True})
            sdk = Chert(facetime=FaceTimeConfig(token=SECRET, project_id='project-only'))
            self.assertEqual(sdk.facetime.whoami(), {'ok': True})
            self.assertEqual(ChertControlPlane('https://selfhost.example/', token=SECRET, project_id='project-only').billing_status(), {'ok': True})
        self.assertEqual([request.full_url for request in requests], [
            'https://facetime.trychert.com/api/v1/billing',
            'https://facetime.trychert.com/api/v1/cli/whoami',
            'https://selfhost.example/api/v1/billing',
        ])
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer ' + SECRET)
        self.assertEqual(requests[1].get_header('Authorization'), 'Bearer ' + SECRET)
        self.assertEqual(requests[1].get_header('X-chert-project-id'), 'project-only')
        self.assertEqual(requests[2].get_header('Authorization'), 'Bearer ' + SECRET)

    def test_imessage_default_override_prefix_and_auth_isolation(self):
        requests = []

        def respond(request):
            requests.append(request)
            response = addinfourl(BytesIO(b'{"ok":true}'), {}, request.full_url, 200)
            response.msg = 'OK'
            return response

        with patch('urllib.request.HTTPSHandler.https_open', side_effect=respond):
            sdk = Chert(imessage=IMessageConfig(api_key=MESSAGE_SECRET, tenant='tenant-only'),
                        facetime=FaceTimeConfig(token=SECRET, project_id='project-only'))
            self.assertEqual(sdk.imessage.request('/whoami'), {'ok': True})
            for base in ('https://selfhost.example', 'https://selfhost.example/',
                         'https://selfhost.example/api/v1', 'https://selfhost.example/custom/'):
                self.assertEqual(ChertClient(base, MESSAGE_SECRET).request('/whoami'), {'ok': True})
            self.assertEqual(ChertClient(api_key=MESSAGE_SECRET).request('/whoami'), {'ok': True})
        self.assertEqual([request.full_url for request in requests], [
            'https://console.trychert.com/api/v1/whoami',
            'https://selfhost.example/api/v1/whoami',
            'https://selfhost.example/api/v1/whoami',
            'https://selfhost.example/api/v1/whoami',
            'https://selfhost.example/custom/whoami',
            'https://console.trychert.com/api/v1/whoami',
        ])
        for request in requests:
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + MESSAGE_SECRET)
            self.assertIsNone(request.get_header('X-chert-project-id'))
        self.assertEqual(requests[0].get_header('X-chert-tenant'), 'tenant-only')
        for invalid in ('', None, 'http://example.test', 'https://user:pass@example.test',
                        'https://example.test?query', 'https://example.test#fragment',
                        'https://example.test/a/../b'):
            with self.subTest(base=invalid), self.assertRaises(ValueError):
                Chert(imessage=IMessageConfig(base_url=invalid, api_key=MESSAGE_SECRET))
        with self.assertRaises(ValueError):
            Chert(imessage=IMessageConfig())

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
            (self.client.billing_status, 'GET', 'billing', None, 'project'),
            (lambda: self.client.create_checkout(plan='shared', idempotency_key='stable-key'), 'POST', 'billing', {'action': 'checkout', 'plan': 'shared'}, 'project'),
            (lambda: self.client.create_checkout(plan='dedicated', coupon_code='EXAMPLE', idempotency_key='stable-key'), 'POST', 'billing', {'action': 'checkout', 'plan': 'dedicated', 'coupon_code': 'EXAMPLE'}, 'project'),
            (lambda: self.client.cancel_subscription(idempotency_key='stable-key'), 'POST', 'billing', {'action': 'cancel'}, 'project'),
            (lambda: self.client.validate_coupon('EXAMPLE', idempotency_key='stable-key'), 'POST', 'billing', {'action': 'validate_coupon', 'coupon_code': 'EXAMPLE'}, 'project'),
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
                self.assertEqual(headers.get('idempotency-key'), 'stable-key' if path == 'billing' and method == 'POST' else None)

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
        ChertControlPlane(self.base).begin_login('laptop')
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
        self.assertIsNone(self.client.billing_status())
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

    def test_billing_responses_are_not_checkout_records(self):
        from trychert.models import BillingStatus, CheckoutSession, BillingCancellation, CouponValidation
        cases = [
            (self.client.billing_status, BillingStatus, {
                'entitlement': None, 'needs_reconciliation': False, 'sales_enabled': None,
                'shared_available': False, 'dedicated_available': False}),
            (lambda: self.client.create_checkout(plan='shared', idempotency_key='stable-key'),
             CheckoutSession, {'url': 'https://checkout.example/session'}),
            (lambda: self.client.cancel_subscription(idempotency_key='stable-key'),
             BillingCancellation, {'status': 'cancellation_requested', 'message': 'Refresh to confirm.'}),
            (lambda: self.client.validate_coupon('EXAMPLE', idempotency_key='stable-key'),
             CouponValidation, {'code': 'EXAMPLE', 'percent_off': 100, 'mode': 'test',
                                'monthly_total': 0, 'currency': 'usd'}),
        ]
        for call, model, data in cases:
            with self.subTest(model=model):
                self.server.payload = {'data': data}
                self.assertEqual(call(), data)
                self.assertEqual(model.__required_keys__ | model.__optional_keys__, data.keys())
        status = dict(cases[0][2], entitlement={'plan': 'shared', 'status': 'active'}, sales_enabled=True)
        self.server.payload = {'data': status}
        self.assertEqual(self.client.billing_status(), status)

    def test_coupon_alternate_shape_is_preserved_without_monthly_total(self):
        from trychert.models import CouponValidation
        data = {'code': 'EXAMPLE', 'percent_off': 25, 'mode': 'test', 'currency': 'usd',
                'due_now': 12, 'access_hours': 7, 'plans': ['shared']}
        self.server.payload = {'data': data}
        result = self.client.validate_coupon('EXAMPLE', idempotency_key='stable-key')
        self.assertEqual(result, data)
        self.assertNotIn('monthly_total', result)
        self.assertEqual(CouponValidation.__optional_keys__, {'monthly_total'})
        self.assertEqual(CouponValidation.__required_keys__, {'code', 'percent_off', 'mode', 'currency'})
        self.assertEqual(len(self.server.calls), 1)

    def test_billing_requires_own_auth_project_and_valid_keys(self):
        def calls(client, key):
            return [lambda: client.create_checkout(plan='shared', idempotency_key=key),
                    lambda: client.cancel_subscription(idempotency_key=key),
                    lambda: client.validate_coupon('EXAMPLE', idempotency_key=key)]
        for kwargs, code in [({}, 'unauthorized'), ({'token': SECRET}, 'project_required')]:
            client = ChertControlPlane(self.base, **kwargs)
            for call in [client.billing_status, *calls(client, 'stable-key')]:
                with self.assertRaises(ChertControlPlaneError) as caught:
                    call()
                self.assertEqual(caught.exception.code, code)
        for key in (None, True, '', 'short', ' ' * 8, 'k' * 201, 'long-key\n', 'long-keyé'):
            for call in calls(self.client, key):
                with self.assertRaises(ValueError):
                    call()
        for coupon in ('', ' ', 'x' * 65, 123):
            with self.assertRaises(ValueError):
                self.client.validate_coupon(coupon, idempotency_key='stable-key')
            with self.assertRaises(ValueError):
                self.client.create_checkout(plan='shared', coupon_code=coupon, idempotency_key='stable-key')
        with self.assertRaises(ValueError):
            self.client.create_checkout(plan='other', idempotency_key='stable-key')
        # Unpublished preview names fail locally; they never alias incompatible data.
        self.assertFalse(hasattr(self.client, 'billing_catalog'))
        self.assertFalse(hasattr(self.client, 'current_checkout'))
        with self.assertRaises(TypeError):
            self.client.create_checkout(plan_id='shared', catalog_version='old', idempotency_key='stable-key')
        self.assertEqual(self.server.calls, [])

    def test_billing_mutations_never_follow_redirects_or_retry(self):
        for status in (307, 503):
            self.server.status = status
            self.server.payload = {'error': {'code': 'forbidden', 'message': PRIVATE}}
            for call in (lambda: self.client.create_checkout(plan='dedicated', idempotency_key='stable-key'),
                         lambda: self.client.cancel_subscription(idempotency_key='stable-key'),
                         lambda: self.client.validate_coupon('EXAMPLE', idempotency_key='stable-key')):
                before = len(self.server.calls)
                with self.assertRaises(ChertControlPlaneError) as caught:
                    call()
                self.assertNotIn(PRIVATE, str(caught.exception))
                self.assertEqual(len(self.server.calls), before + 1)
        self.assertEqual(self.messaging.calls, [])

    def test_terminal_billing_actions_and_stripe_hosted_urls(self):
        entitlement = {'plan': 'shared', 'status': 'active', 'valid_until': '2026-12-01T00:00:00Z', 'fulfillment_status': 'none'}
        self.server.status = 200
        self.server.payload = {'data': {'status': 'active', 'entitlement': entitlement}}
        self.assertEqual(self.client.purchase(plan='shared', idempotency_key='buy-key-01'), {'status': 'active', 'entitlement': entitlement})
        self.server.payload = {'data': {'status': 'requires_action', 'url': 'https://hooks.stripe.com/3d_secure_2/x'}}
        self.assertEqual(self.client.change_plan(plan='dedicated', idempotency_key='switch-key-1')['status'], 'requires_action')
        self.server.payload = {'data': {'status': 'pending'}}
        self.assertEqual(self.client.purchase(plan='shared', idempotency_key='buy-key-01'), {'status': 'pending'})
        self.server.payload = {'data': {'status': 'requires_payment_method', 'url': 'https://checkout.stripe.com/c/pay/cs_x'}}
        self.assertEqual(self.client.payment_method_setup(idempotency_key='card-key-01')['url'], 'https://checkout.stripe.com/c/pay/cs_x')
        bodies = [call[3] for call in self.server.calls[-4:]]
        self.assertEqual(bodies, [{'action': 'purchase', 'plan': 'shared'}, {'action': 'change_plan', 'plan': 'dedicated'}, {'action': 'purchase', 'plan': 'shared'}, {'action': 'payment_method'}])
        for bad in ({'status': 'requires_action', 'url': 'http://hooks.stripe.com/x'}, {'status': 'requires_action', 'url': 'https://stripe.com.evil.example/x'},
                    {'status': 'requires_action', 'url': 'https://u:p@checkout.stripe.com/x'},
                    {'status': 'requires_action', 'url': 'https://evil.com\\.stripe.com/x'}, {'status': 'requires_action', 'url': 'https://evil.com\t.stripe.com/'},
                    {'status': 'requires_action', 'url': 'https://evil.com%2f.stripe.com/'}, {'status': 'requires_action', 'url': 'https://checkout.stripe.com:8443/x'}, {'status': 'requires_payment_method'},
                    {'status': 'active'}, {'status': 'active', 'entitlement': {'plan': 'gold'}}, {'status': 'processing'}, None):
            self.server.payload = {'data': bad}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.purchase(plan='shared', idempotency_key='buy-key-02')
            self.assertEqual(caught.exception.code, 'invalid_response')
        before = len(self.server.calls)
        with self.assertRaises(ValueError):
            self.client.purchase(plan='gold', idempotency_key='buy-key-03')
        self.assertEqual(len(self.server.calls), before)

    def test_billing_refusals_surface_by_code(self):
        for status, code in ((409, 'billing_sales_disabled'), (409, 'billing_subscription_exists'), (409, 'billing_dedicated_no_inventory'),
                             (409, 'shared_no_capacity'), (503, 'billing_unconfigured'), (409, 'billing_secret_reason')):
            self.server.status = status
            self.server.payload = {'error': {'code': code, 'message': PRIVATE}}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.create_checkout(plan='dedicated', idempotency_key='stable-key')
            expected = 'request_failed' if code == 'billing_secret_reason' else code
            self.assertEqual((caught.exception.status, caught.exception.code), (status, expected))
            self.assertNotIn(PRIVATE, str(caught.exception))
        for status in (409, 400):
            self.server.status = status
            self.server.payload = {'error': {'code': 'billing_plan_change_unavailable', 'message': PRIVATE}}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.change_plan(plan='dedicated', idempotency_key='switch-key-2')
            self.assertEqual((caught.exception.status, caught.exception.code), (status, 'billing_plan_change_unavailable'))
            self.assertNotIn(PRIVATE, str(caught.exception))

    def test_invalid_input_rejected_before_network(self):
        for base in ('', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?', 'https://example.test#', 'https://example.test:99999', 'http://example.test', 'https://example.test\n', None):
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
                self.client.create_checkout(plan='shared', idempotency_key=value)
        self.assertEqual(self.server.calls, [])


if __name__ == '__main__':
    unittest.main()
