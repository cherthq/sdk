import dataclasses
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chert import ChertClient, ChertAPIError, ReactionReceipt

CHAT = '11aa0000-0000-4000-8000-000000000001'
MESSAGE = 'recorded:owned-alias'
KEY = 'fixture-private-api-key'
PRIVATE = 'private-body-never-formatted'
ACK = {'operation_id': 'a' * 32, 'chat_id': CHAT, 'message_id': MESSAGE, 'status': 'acknowledged'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.calls.append({'path': self.path, 'body': json.loads(raw),
            'auth': self.headers.get('Authorization'), 'tenant': self.headers.get('X-Chert-Tenant'),
            'idempotency_key': self.headers.get('Idempotency-Key')})
        status, payload = self.server.status, self.server.payload
        if self.server.delay:
            time.sleep(self.server.delay)
        self.send_response(status)
        self.send_header('X-Trace-ID', 'fixture-trace')
        if status == 307:
            self.send_header('Location', '/sink')
        data = (self.server.raw if self.server.raw is not None else json.dumps(payload).encode()) if status != 204 else b''
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class SendReactionTests(unittest.TestCase):
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
        self.server.status, self.server.payload, self.server.raw, self.server.delay = 202, dict(ACK), None, 0
        self.before = len(self.server.calls)
        self.client = ChertClient(self.base, KEY, 'fixture-tenant')

    def safe(self, error):
        for rendered in (str(error), repr(error), str(error.args)):
            for private in (KEY, PRIVATE, MESSAGE, CHAT):
                self.assertNotIn(private, rendered)
        self.assertIsNone(error.__context__); self.assertIsNone(error.__cause__)

    def test_six_kinds_add_remove_exact_payload_and_frozen_receipt(self):
        for reaction in ('love', 'like', 'dislike', 'laugh', 'emphasize', 'question'):
            for remove in (False, True):
                receipt = self.client.send_reaction(CHAT, MESSAGE, reaction, remove=remove, idempotency_key='stable internal key')
                self.assertEqual(dataclasses.asdict(receipt), ACK)
                self.assertIsInstance(receipt, ReactionReceipt)
                with self.assertRaises(dataclasses.FrozenInstanceError):
                    receipt.status = 'applied'
                self.assertEqual(self.server.calls[-1], {
                    'path': '/api/v1/chats/' + CHAT + '/messages/' + 'recorded%3Aowned-alias' + '/reactions',
                    'body': {'reaction': reaction, 'remove': remove, 'part_index': 0},
                    'auth': 'Bearer ' + KEY, 'tenant': 'fixture-tenant', 'idempotency_key': 'stable internal key'})
        self.assertEqual(len(self.server.calls), self.before + 12)

    def test_optional_key_and_prefix_preserved(self):
        self.assertEqual(ChertClient(self.base + '/custom', KEY).send_reaction(CHAT, MESSAGE, 'love'), ReactionReceipt(**ACK))
        self.assertIsNone(self.server.calls[-1]['idempotency_key'])
        self.assertIsNone(self.server.calls[-1]['tenant'])
        self.assertTrue(self.server.calls[-1]['path'].startswith('/custom/chats/'))

    def test_uuid_only_canonicalization_and_key_boundary(self):
        result = self.client.send_reaction(CHAT.upper(), MESSAGE, 'love', idempotency_key='k' * 200)
        self.assertEqual(result.chat_id, CHAT)
        self.assertEqual(self.server.calls[-1]['idempotency_key'], 'k' * 200)
        self.server.payload = {**ACK, 'message_id': MESSAGE.upper()}
        result = self.client.send_reaction(CHAT, MESSAGE.upper(), 'love')
        self.assertEqual(result.message_id, MESSAGE.upper())
        self.assertIn('RECORDED%3AOWNED-ALIAS', self.server.calls[-1]['path'])

    def test_invalid_inputs_never_issue_http(self):
        for chat in ('bad', CHAT + '\n', None, True):
            with self.assertRaises(ValueError): self.client.send_reaction(chat, MESSAGE, 'love')
        for message in ('', '.', '..', '../x', 'x/y', 'x\\y', 'x?y', 'x#y', 'x%2Fy', 'x\ny', 'x' * 161, '\ud800', None):
            with self.subTest(message=repr(message)), self.assertRaises(ValueError): self.client.send_reaction(CHAT, message, 'love')
        for reaction in ('custom', 'Love', '', None, ['love']):
            with self.assertRaises(ValueError): self.client.send_reaction(CHAT, MESSAGE, reaction)
        for remove in (0, 1, None, 'false'):
            with self.assertRaises(ValueError): self.client.send_reaction(CHAT, MESSAGE, 'love', remove=remove)
        for key in ('', 'x\0y', 'x\ny', '\ud800', 'x' * 201, ' leading', 'trailing ', 'é', '\x7f', True):
            with self.assertRaises(ValueError): self.client.send_reaction(CHAT, MESSAGE, 'love', idempotency_key=key)
        self.assertEqual(len(self.server.calls), self.before)

    def test_receipt_status_identity_or_extra_fields_are_unknown_once(self):
        for patch in ({'operation_id': 'A' * 32}, {'operation_id': '11111111-2222-4333-8444-555555555555'},
                      {'chat_id': 'foreign'}, {'message_id': 'other'}, {'status': 'applied'}, {'native_guid': PRIVATE}):
            self.server.payload = {**ACK, **patch}
            before = len(self.server.calls)
            with self.assertRaises(ChertAPIError) as caught: self.client.send_reaction(CHAT, MESSAGE, 'love')
            self.assertEqual((caught.exception.status, caught.exception.code), (502, 'unconfirmed_reaction_outcome'))
            self.assertEqual(caught.exception.data, self.server.payload); self.safe(caught.exception)
            self.assertEqual(len(self.server.calls), before + 1)
        for status in (200, 201, 204, 206):
            self.server.status, self.server.payload = status, ACK
            with self.assertRaises(ChertAPIError) as caught: self.client.send_reaction(CHAT, MESSAGE, 'love')
            self.assertEqual(caught.exception.code, 'unconfirmed_reaction_outcome'); self.safe(caught.exception)

    def test_server_error_preserves_only_explicit_raw_metadata(self):
        self.server.status = 502
        self.server.payload = {'error': {'code': 4103, 'message': PRIVATE}, 'operation_id': 'b' * 32}
        with self.assertRaises(ChertAPIError) as caught: self.client.send_reaction(CHAT, MESSAGE, 'love')
        self.assertEqual(caught.exception.code, '4103'); self.assertEqual(caught.exception.data, self.server.payload)
        self.safe(caught.exception); self.assertEqual(len(self.server.calls), self.before + 1)

    def test_malformed_response_limit_redirect_and_timeout_stay_one_attempt(self):
        self.server.raw = PRIVATE.encode()
        with self.assertRaises(ChertAPIError) as caught: self.client.send_reaction(CHAT, MESSAGE, 'love')
        self.assertEqual(caught.exception.code, 'invalid_response'); self.safe(caught.exception)
        self.server.raw = None
        with self.assertRaises(ChertAPIError) as caught: ChertClient(self.base, KEY, max_response_bytes=8).send_reaction(CHAT, MESSAGE, 'love')
        self.assertEqual(caught.exception.code, 'response_too_large'); self.safe(caught.exception)
        self.server.status = 307
        with self.assertRaises(ChertAPIError) as caught: self.client.send_reaction(CHAT, MESSAGE, 'love')
        self.assertEqual(caught.exception.code, 'redirect_blocked'); self.safe(caught.exception)
        self.server.status, self.server.delay = 202, .1
        with self.assertRaises(ChertAPIError) as caught: ChertClient(self.base, KEY, timeout=.01).send_reaction(CHAT, MESSAGE, 'love')
        self.assertEqual(caught.exception.code, 'timeout'); self.safe(caught.exception)
        self.assertEqual(len(self.server.calls), self.before + 4)
        self.assertTrue(all('/reactions' in c['path'] for c in self.server.calls[self.before:]))


if __name__ == '__main__': unittest.main()
