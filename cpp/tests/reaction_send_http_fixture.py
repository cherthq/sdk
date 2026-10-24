"""Synthetic loopback HTTP only; no device, cloud credentials or reactions."""
import collections
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

counts = collections.Counter()
requests = []
chat = 'a1000000-0000-4000-8000-000000000001'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        requests.append(self.path)
        self.send_error(400)

    def do_POST(self):
        requests.append(self.path)
        parts = self.path.split('/')
        assert len(parts) == 8 and parts[:4] == ['', 'api', 'v1', 'chats'] and parts[4] == chat
        assert parts[5] == 'messages' and parts[7] == 'reactions'
        mode = unquote(parts[6])
        assert '?' not in self.path and '#' not in self.path
        assert self.headers['Authorization'] == 'Bearer fixture-secret'
        assert self.headers['X-Chert-Tenant'] == 'fixture-tenant'
        assert 'cookie' not in self.headers and 'proxy-authorization' not in self.headers
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert set(body) == {'reaction', 'remove', 'part_index'}
        assert type(body['remove']) is bool and type(body['part_index']) is int and body['part_index'] == 0
        expected_reaction = mode[len('standard-'):] if mode.startswith('standard-') else 'like' if mode == 'message-b' else 'love'
        assert body['reaction'] == expected_reaction and body['remove'] == (mode == 'message-b')
        if mode == 'message-b':
            assert self.headers['Idempotency-Key'] == 'unique reaction key'
        elif mode == 'Message:exact_id.v1':
            assert parts[6] == 'Message%3Aexact_id.v1'
            assert self.headers['Idempotency-Key'] == 'k' * 200
        else:
            assert 'Idempotency-Key' not in self.headers
        counts[mode] += 1
        if mode == 'slow':
            time.sleep(.15)
        if mode == 'drop':
            self.connection.close()
            return
        receipt = {'operation_id': 'a' * 32, 'chat_id': chat, 'message_id': mode, 'status': 'acknowledged'}
        patches = {'extra': {'unexpected_field': 'private-response'},
                   'uuid-operation': {'operation_id': '550e8400-e29b-41d4-a716-446655440000'},
                   'uppercase-operation': {'operation_id': 'A' * 32}, 'wrong-chat': {'chat_id': 'foreign-chat'},
                   'wrong-case-chat': {'chat_id': chat.upper()},
                   'wrong-message': {'message_id': 'different-message'}, 'wrong-case-message': {'message_id': 'WRONG-CASE-MESSAGE'}, 'applied': {'status': 'applied'},
                   'wrongtype': {'operation_id': 1}, 'empty-operation': {'operation_id': ''}}
        receipt.update(patches.get(mode, {}))
        if mode == 'null':
            receipt = None
        if mode == 'missing':
            receipt.pop('message_id')
        status = int(mode[4:]) if mode.startswith('http') else 202
        if mode == 'api-error':
            status = 502
            receipt = {'error': {'code': 4103, 'message': 'private-response', 'retryable': False}, 'operation_id': 'b' * 32}
        if mode == 'redirect':
            status = 307
        data = b'private-response' if mode == 'nonjson' else json.dumps(receipt).encode()
        if status == 204:
            data = b''
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Trace-ID', 'trace-reaction')
        self.send_header('Content-Length', str(len(data)))
        if mode == 'redirect':
            self.send_header('Location', '/sink')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    subprocess.run([sys.argv[1], f'http://127.0.0.1:{server.server_port}'], check=True, timeout=15,
                   env=dict(os.environ, http_proxy='http://127.0.0.1:1', ALL_PROXY='http://127.0.0.1:1', NO_PROXY=''))
    expected = ['message-a', 'message-b', 'Message:exact_id.v1',
                *['standard-' + kind for kind in ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']],
                'http200', 'http201', 'http204', 'http206', 'extra', 'uuid-operation', 'uppercase-operation',
                'wrong-chat', 'wrong-case-chat', 'wrong-message', 'wrong-case-message', 'applied', 'missing', 'null', 'wrongtype', 'empty-operation',
                'api-error', 'redirect', 'nonjson', 'drop', 'slow']
    assert counts == {mode: 1 for mode in expected}, counts
    assert len(requests) == len(expected), requests
    print(f'{len(expected)} exact POST attempts; invalid inputs zero HTTP; no redirect sink or retries')
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
