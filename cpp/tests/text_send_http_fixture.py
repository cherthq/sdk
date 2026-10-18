"""Real loopback HTTP only; synthetic authentication and no native/cloud actions."""
import collections
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

counts = collections.Counter()
requests = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        requests.append(self.path)
        self.send_error(400)

    def do_POST(self):
        requests.append(self.path)
        assert self.path == '/api/v1/text-operations/v1', self.path
        assert self.headers['Authorization'] == 'Bearer fixture-secret'
        assert self.headers['X-Chert-Tenant'] == 'fixture-tenant'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body['phone'] == '+15550000002'
        mode = body['body']; counts[mode] += 1
        assert set(body) == ({'phone','body','idempotency_key'} if 'idempotency_key' in body else {'phone','body'})
        if mode == '  exact / text  ':
            assert body['idempotency_key'] == ' key/\n'
        if len(mode) == 16384:
            assert body['idempotency_key'] == 'k' * 200
        if mode == 'without-key':
            assert 'idempotency_key' not in body
        if mode == 'slow':
            time.sleep(.15)
        if mode == 'drop':
            self.connection.close(); return
        receipt = {'success':True,'message_id':'a'*32,'chat_id':'chat-a','status':'queued'}
        patches = {'numeric-success':{'success':1},'native-uuid':{'message_id':'550e8400-e29b-41d4-a716-446655440000'},
                   'uppercase-id':{'message_id':'A'*32},'unsafe-chat':{'chat_id':'../private'},'empty-chat':{'chat_id':''},
                   'sent-status':{'status':'sent'},'extra-field':{'native_guid':'private-response'}}
        receipt.update(patches.get(mode, {}))
        if mode == 'null-receipt':
            receipt = None
        if mode == 'missing-field':
            receipt.pop('chat_id')
        status = int(mode[6:]) if mode.startswith('status') else 202
        if mode == 'api-error':
            status = 502; receipt = {'error':{'code':4103,'message':'private-response','retryable':False},'message_id':'b'*32}
        if mode == 'redirect':
            status = 307
        data = b'private-response' if mode == 'nonjson' else json.dumps(receipt).encode()
        if status == 204:
            data = b''
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('X-Trace-ID','trace-text')
        self.send_header('Content-Length',str(len(data)))
        if mode == 'redirect':
            self.send_header('Location','/sink')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    subprocess.run([sys.argv[1],f'http://127.0.0.1:{server.server_port}'],check=True,timeout=15,
                   env=dict(os.environ,http_proxy='http://127.0.0.1:1',ALL_PROXY='http://127.0.0.1:1',NO_PROXY=''))
    expected = ['  exact / text  ','without-key','x'*16384,'🌙'*4096,'status200','status201','status204','status206',
                'numeric-success','native-uuid','uppercase-id','unsafe-chat','empty-chat','sent-status','extra-field',
                'api-error','redirect','nonjson','drop','slow','null-receipt','missing-field']
    assert counts == {mode:1 for mode in expected}, counts
    assert requests == ['/api/v1/text-operations/v1'] * len(expected), requests
    print('22 HTTP attempts exactly once; invalid input zero HTTP; no redirect sink')
finally:
    server.shutdown();server.server_close();thread.join(timeout=2)
