"""Public contract tests, also runnable unchanged against an installed wheel outside the checkout."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from trychert import ChertControlPlane, ChertControlPlaneError

CALL = '11111111-1111-4111-8111-111111111111'
OP = '22222222-2222-4222-8222-222222222222'
BODY = {'recipient': {'type': 'phone_number', 'value': '+12125550102'}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle_request(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.calls.append((self.command, self.path, self.headers, json.loads(raw) if raw else None))
        self.send_response(self.server.status)
        if self.server.status == 307:
            self.send_header('Location', '/sink')
        self.end_headers()
        self.wfile.write(json.dumps(self.server.payload).encode())

    do_GET = do_POST = handle_request


class ParticipantTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.calls = []
        self.server.status = 202
        self.server.payload = {'data': {'id': OP, 'call_id': CALL, 'status': 'queued'}}
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client = ChertControlPlane(f'http://127.0.0.1:{self.server.server_port}', token='fixture', project_id='project')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_submission_and_all_read_states(self):
        self.assertEqual(self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person'), self.server.payload['data'])
        method, path, headers, body = self.server.calls[0]
        self.assertEqual((method, path, body), ('POST', f'/api/v1/calls/{CALL}/participants', BODY))
        self.assertEqual(headers['Authorization'], 'Bearer fixture')
        self.assertEqual(headers['X-Chert-Project-Id'], 'project')
        self.assertEqual(headers['Idempotency-Key'], 'stable-add-person')
        self.server.status = 200
        for state in ('queued', 'dispatching', 'submitted', 'already_present', 'failed', 'unknown'):
            self.server.payload['data']['status'] = state
            self.assertEqual(self.client.get_call_participant(CALL, OP)['status'], state)
            method, path, headers, body = self.server.calls[-1]
            self.assertEqual((method, path, body), ('GET', f'/api/v1/calls/{CALL}/participants/{OP}', None))
            self.assertIsNone(headers['Idempotency-Key'])
        for state in ('submitted', 'already_present'):
            self.server.payload['data']['status'] = state
            self.assertEqual(self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person')['status'], state)

    def test_invalid_input_has_no_effect_and_bad_receipts_fail(self):
        for body in ({**BODY, 'worker_id': 'private'}, {'recipient': {'type': 'email', 'value': 'a@example.com'}},
                     {'recipient': {'type': 'phone_number', 'value': '+12125550102\n'}},
                     {'recipient': {**BODY['recipient'], 'extra': True}}):
            with self.assertRaises(ValueError):
                self.client.add_call_participant(CALL, body, idempotency_key='stable-add-person')
        with self.assertRaises(ValueError):
            self.client.add_call_participant(CALL, BODY, idempotency_key='short')
        self.assertEqual(self.server.calls, [])
        for data in ({'id': OP, 'call_id': 'other', 'status': 'queued'},
                     {'id': OP, 'call_id': CALL, 'status': 'joined'}, None):
            self.server.payload = {'data': data}
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person')
            self.assertEqual(caught.exception.code, 'invalid_response')
        self.server.payload = {'data': {'id': 'other', 'call_id': CALL, 'status': 'submitted'}}
        with self.assertRaises(ChertControlPlaneError):
            self.client.get_call_participant(CALL, OP)

    def test_errors_keep_only_safe_operation_id_and_never_retry(self):
        for status, code in ((409, 'participant_failed'), (502, 'participant_outcome_unknown')):
            self.server.status = status
            self.server.payload = {'error': {'code': code, 'message': 'private-text',
                                            'details': {'operation_id': OP, 'secret': 'private-text'}}}
            before = len(self.server.calls)
            with self.assertRaises(ChertControlPlaneError) as caught:
                self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person')
            self.assertEqual((caught.exception.code, caught.exception.operation_id), (code, OP))
            self.assertNotIn('private-text', str(caught.exception.__dict__))
            self.assertEqual(len(self.server.calls), before + 1)
        self.server.payload['error']['details']['operation_id'] = 'private-text'
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person')
        self.assertIsNone(caught.exception.operation_id)
        self.server.status = 307
        before = len(self.server.calls)
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.client.add_call_participant(CALL, BODY, idempotency_key='stable-add-person')
        self.assertEqual(caught.exception.code, 'network_error')
        self.assertEqual(len(self.server.calls), before + 1)


if __name__ == '__main__':
    unittest.main()
