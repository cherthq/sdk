import json
from pathlib import Path
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chert import ChertClient, ChertAPIError

KEY = 'synthetic-secret-not-formatted'
PRIVATE = 'private-reconciliation-only'
RECEIPT = {'success': True, 'message_id': 'a' * 32, 'chat_id': 'chat-a', 'status': 'queued'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.calls.append({'path': self.path, 'body': json.loads(raw),
                                  'auth': self.headers.get('Authorization'),
                                  'tenant': self.headers.get('X-Chert-Tenant')})
        status, payload, delay = self.server.status, self.server.payload, self.server.delay
        if delay:
            time.sleep(delay)
        self.send_response(status)
        self.send_header('X-Trace-ID', 'observed-trace')
        if status == 307:
            self.send_header('Location', '/api/v1/sink')
        data = (self.server.raw if self.server.raw is not None else json.dumps(payload).encode()) if status != 204 else b''
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class SendTextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.calls = []
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def setUp(self):
        self.server.status, self.server.payload, self.server.delay = 202, dict(RECEIPT), 0
        self.server.raw = None
        self.before = len(self.server.calls)
        self.client = ChertClient(self.base, KEY, 'fixture-tenant')

    def safe(self, error):
        self.assertIsInstance(error, ChertAPIError)
        for rendered in (str(error), repr(error), str(error.args)):
            self.assertNotIn(KEY, rendered)
            self.assertNotIn(PRIVATE, rendered)
            self.assertNotIn('chat-a', rendered)
        self.assertIsNone(error.__context__)
        self.assertIsNone(error.__cause__)

    def test_exact_queued_202_and_payload_auth_preserved_once(self):
        text, key = '  exact / text 🌙\n', '  key/🌙\n'
        result = self.client.send_text('+15550000002', text, idempotency_key=key)
        self.assertEqual(result, RECEIPT)
        self.assertEqual(len(self.server.calls), self.before + 1)
        self.assertEqual(self.server.calls[-1], {'path': '/api/v1/text-operations/v1',
            'body': {'phone': '+15550000002', 'body': text, 'idempotency_key': key},
            'auth': 'Bearer ' + KEY, 'tenant': 'fixture-tenant'})
        self.assertEqual(set(result), {'success', 'message_id', 'chat_id', 'status'})

    def test_optional_key_omitted_and_explicit_base_prefix_retained(self):
        client = ChertClient(self.base + '/deployment', KEY)
        self.assertEqual(client.send_text('+15550000002', 'hello'), RECEIPT)
        self.assertEqual(self.server.calls[-1]['path'], '/deployment/text-operations/v1')
        self.assertEqual(self.server.calls[-1]['body'], {'phone': '+15550000002', 'body': 'hello'})
        self.assertIsNone(self.server.calls[-1]['tenant'])

    def test_input_bounds_types_nul_and_surrogates_refuse_before_http(self):
        for phone in ['15550000002', '+05550000002', '+15550000002\n', True, None]:
            with self.subTest(phone=phone), self.assertRaises(ValueError):
                self.client.send_text(phone, 'hello')
        for text in ['', ' \n', 'x\0y', '\ud800', '🌙' * 4097, True, None]:
            with self.subTest(text=repr(text)), self.assertRaises(ValueError):
                self.client.send_text('+15550000002', text)
        for key in ['', 'x\0y', '\ud800', '🌙' * 51, True, 1]:
            with self.subTest(key=repr(key)), self.assertRaises(ValueError):
                self.client.send_text('+15550000002', 'hello', idempotency_key=key)
        self.assertEqual(len(self.server.calls), self.before)

    def test_invalid_private_unicode_has_no_exception_context(self):
        for key, text in [(None, '\ud800' + PRIVATE), ('\ud800' + PRIVATE, 'hello')]:
            with self.assertRaises(ValueError) as caught:
                self.client.send_text('+15550000002', text, idempotency_key=key)
            self.assertNotIn(PRIVATE, str(caught.exception))
            self.assertIsNone(caught.exception.__context__)
            self.assertIsNone(caught.exception.__cause__)
        self.assertEqual(len(self.server.calls), self.before)

    def test_exact_ecmascript_blank_set_refuses_without_http(self):
        whitespace = [chr(code) for code in [*range(0x0009, 0x000e), 0x0020, 0x00a0, 0x1680,
                      *range(0x2000, 0x200b), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]]
        for text in [*whitespace, ''.join(whitespace)]:
            with self.subTest(text=repr(text)), self.assertRaises(ValueError):
                self.client.send_text('+15550000002', text)
        self.assertEqual(len(self.server.calls), self.before)

    def test_non_ecmascript_whitespace_and_boundary_payload_are_lossless(self):
        for text in ['\u0085', '\u001c', '\ufeffx\u3000', '\u0009x\u000a\u000d']:
            self.assertEqual(self.client.send_text('+15550000002', text), RECEIPT)
            self.assertEqual(self.server.calls[-1]['body'], {'phone': '+15550000002', 'body': text})
        self.assertEqual(len(self.server.calls), self.before + 4)

    def test_wrong_success_status_and_204_are_unknown_without_retry(self):
        for status in [200, 201, 204, 206]:
            self.server.status = status
            before = len(self.server.calls)
            with self.subTest(status=status), self.assertRaises(ChertAPIError) as caught:
                self.client.send_text('+15550000002', 'hello')
            self.assertEqual((caught.exception.status, caught.exception.code, caught.exception.request_id),
                             (502, 'unconfirmed_text_outcome', 'observed-trace'))
            self.safe(caught.exception)
            self.assertEqual(len(self.server.calls), before + 1)

    def test_malformed_or_uuid_receipts_never_become_queued(self):
        for patch in [{'success': 1}, {'message_id': '550e8400-e29b-41d4-a716-446655440000'},
                      {'message_id': 'A' * 32}, {'chat_id': '../private'}, {'chat_id': ''},
                      {'status': 'sent'}, {'native_guid': PRIVATE}]:
            self.server.payload = {**RECEIPT, **patch}
            with self.subTest(patch=patch), self.assertRaises(ChertAPIError) as caught:
                self.client.send_text('+15550000002', 'hello')
            self.assertEqual(caught.exception.code, 'unconfirmed_text_outcome')
            self.assertEqual(caught.exception.data, self.server.payload)
            self.safe(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 7)

    def test_valid_utf8_boundaries_are_preserved(self):
        text, key = '🌙' * 4096, 'x' * 200
        self.assertEqual(self.client.send_text('+15550000002', text, idempotency_key=key), RECEIPT)
        self.assertEqual(self.server.calls[-1]['body']['body'], text)
        self.assertEqual(self.server.calls[-1]['body']['idempotency_key'], key)
        self.assertEqual(len(self.server.calls), self.before + 1)

    def test_invalid_json_and_response_bound_stay_sanitized_one_attempt(self):
        self.server.raw = PRIVATE.encode()
        with self.assertRaises(ChertAPIError) as caught:
            self.client.send_text('+15550000002', 'hello')
        self.assertEqual(caught.exception.code, 'invalid_response'); self.safe(caught.exception)
        self.server.raw = None
        with self.assertRaises(ChertAPIError) as caught:
            ChertClient(self.base, KEY, max_response_bytes=32).send_text('+15550000002', 'hello')
        self.assertEqual(caught.exception.code, 'response_too_large'); self.safe(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 2)

    def test_non2xx_error_keeps_raw_reconciliation_metadata_explicit(self):
        self.server.status = 502
        self.server.payload = {'error': {'code': 4103, 'message': PRIVATE, 'retryable': False},
                               'message_id': 'b' * 32, 'chat_id': 'chat-a'}
        with self.assertRaises(ChertAPIError) as caught:
            self.client.send_text('+15550000002', 'hello')
        self.assertEqual(caught.exception.code, '4103')
        self.assertEqual(caught.exception.data['message_id'], 'b' * 32)
        self.safe(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 1)

    def test_redirect_and_timeout_never_retry_or_follow(self):
        self.server.status = 307
        with self.assertRaises(ChertAPIError) as caught:
            self.client.send_text('+15550000002', 'hello')
        self.assertEqual(caught.exception.code, 'redirect_blocked'); self.safe(caught.exception)
        self.server.status, self.server.delay = 202, .15
        with self.assertRaises(ChertAPIError) as caught:
            ChertClient(self.base, KEY, timeout=.02).send_text('+15550000002', 'hello')
        self.assertEqual(caught.exception.code, 'timeout'); self.safe(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 2)
        self.assertTrue(all(call['path'] == '/api/v1/text-operations/v1' for call in self.server.calls[self.before:]))

    def test_no_new_async_cancellation_or_extra_transport_is_introduced(self):
        with self.assertRaises(TypeError):
            self.client.send_text('+15550000002', 'hello', signal=object())
        self.assertEqual(len(self.server.calls), self.before)


if __name__ == '__main__':
    unittest.main()
