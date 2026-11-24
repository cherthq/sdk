"""Public read contracts; run with -I against a clean installed wheel as well as source."""
from copy import deepcopy
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from trychert import ChertClient, ChertAPIError, ChertControlPlane, ChertControlPlaneError

PROJECTS = [{'role': 'viewer', 'facetime_projects': {'id': 'project', 'slug': 'example', 'name': 'Example',
    'website_domain': 'example.com', 'logo_data': None, 'created_at': '2026-11-01', 'updated_at': '2026-11-02'}}]
INTEGRATIONS = {'items': [{'id': 'integration', 'project_id': 'project', 'name': 'Incoming',
    'endpoint_url': 'https://example.com/incoming', 'enabled': False, 'signing_enabled': True, 'payload_version': 1,
    'active_revision_id': None, 'livekit_allowed_hosts': None, 'created_at': '2026-11-01', 'updated_at': '2026-11-02'}]}
TRANSCRIPT = {'call_id': 'call', 'schema_version': 1, 'created_at': '2026-11-01', 'turns': [
    {'occurred_at': '2026-11-01T00:00:00Z', 'speaker': 'caller', 'text': 'Question'},
    {'occurred_at': '2026-11-01T00:00:03Z', 'speaker': 'agent', 'text': 'Answer'}]}
MESSAGE = {'id': 'message', 'chat_id': 'chat', 'created_at': '2026-11-01', 'status': 'queued',
    'direction': 'outbound', 'service': 'unknown', 'parts': [{'type': 'text', 'value': 'Recorded text'}],
    'read_at': None, 'delivered_at': None, 'reply_to': None, 'reactions': {'from_them': 'like'}}
HISTORY = {'messages': [MESSAGE], 'has_more': True}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.server.calls.append((self.command, self.path, self.headers))
        self.send_response(self.server.status)
        if self.server.status == 307:
            self.send_header('Location', '/sink')
        self.end_headers()
        self.wfile.write(json.dumps(self.server.payload).encode())


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.calls = []
        self.server.status = 200
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.face = ChertControlPlane(self.base, token='face-key', project_id='project')
        self.messages = ChertClient(self.base, 'message-key', tenant='tenant')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_distinct_bodies_and_auth_scopes(self):
        self.server.payload = {'data': PROJECTS}
        self.assertEqual(ChertControlPlane(self.base, token='user-key').list_projects(), PROJECTS)
        self.assertIsNone(self.server.calls[-1][2]['X-Chert-Project-Id'])
        self.assertEqual(self.server.calls[-1][2]['Authorization'], 'Bearer user-key')
        self.face.list_projects()
        self.assertIsNone(self.server.calls[-1][2]['X-Chert-Project-Id'])
        self.server.payload = {'data': INTEGRATIONS}
        self.assertEqual(self.face.list_integrations(), INTEGRATIONS)
        self.assertEqual(self.server.calls[-1][2]['X-Chert-Project-Id'], 'project')
        self.server.payload = {'data': TRANSCRIPT}
        self.assertEqual(self.face.get_call_transcript('call'), TRANSCRIPT)
        self.server.payload = HISTORY
        self.assertEqual(self.messages.list_chat_messages('chat:+15550000002'), HISTORY)
        self.assertEqual(self.server.calls[-1][2]['Authorization'], 'Bearer message-key')
        self.assertEqual(self.server.calls[-1][2]['X-Chert-Tenant'], 'tenant')
        self.assertIsNone(self.server.calls[-1][2]['X-Chert-Project-Id'])
        self.assertEqual([call[1] for call in self.server.calls], ['/api/v1/projects', '/api/v1/projects',
            '/api/v1/integrations', '/api/v1/calls/call/transcript', '/api/v1/chats/chat:+15550000002/messages'])
        self.assertTrue(all(call[0] == 'GET' for call in self.server.calls))

    def test_empty_results_and_null_vs_empty_host_override(self):
        for payload, read in (([], self.face.list_projects), ({'items': []}, self.face.list_integrations),
                              ({**TRANSCRIPT, 'turns': []}, lambda: self.face.get_call_transcript('call'))):
            self.server.payload = {'data': payload}
            self.assertEqual(read(), payload)
        for hosts in (None, [], ['room.example']):
            payload = deepcopy(INTEGRATIONS)
            payload['items'][0]['livekit_allowed_hosts'] = hosts
            self.server.payload = {'data': payload}
            self.assertEqual(self.face.list_integrations(), payload)
        self.server.payload = {'messages': [], 'has_more': False}
        self.assertEqual(self.messages.list_chat_messages('chat'), self.server.payload)

    def test_no_invented_pagination_or_invalid_ids_and_no_missing_auth_requests(self):
        with self.assertRaises(TypeError):
            self.messages.list_chat_messages('chat', limit=10)
        for value in ('', '.', '..'):
            with self.assertRaises(ValueError):
                self.messages.list_chat_messages(value)
            with self.assertRaises(ValueError):
                self.face.get_call_transcript(value)
        with self.assertRaises(ChertControlPlaneError):
            ChertControlPlane(self.base, token='face-key').list_integrations()
        with self.assertRaises(ChertControlPlaneError):
            ChertControlPlane(self.base).list_projects()
        self.assertEqual(self.server.calls, [])

    def test_invalid_responses_and_missing_transcript_are_not_empty_success(self):
        bad_project = deepcopy(PROJECTS)
        bad_project[0]['role'] = 'operator'
        bad_integration = deepcopy(INTEGRATIONS)
        bad_integration['items'][0]['payload_version'] = True
        for payload, read in ((bad_project, self.face.list_projects),
                (bad_integration, self.face.list_integrations),
                ({**TRANSCRIPT, 'call_id': 'different'}, lambda: self.face.get_call_transcript('call')),
                ({**TRANSCRIPT, 'schema_version': True}, lambda: self.face.get_call_transcript('call')),
                ({**TRANSCRIPT, 'turns': [{'occurred_at': 'date', 'speaker': 'system', 'text': 'private'}]},
                 lambda: self.face.get_call_transcript('call'))):
            self.server.payload = {'data': payload}
            with self.assertRaises(ChertControlPlaneError) as caught:
                read()
            self.assertEqual(caught.exception.code, 'invalid_response')
        self.server.status = 404
        self.server.payload = {'error': {'code': 'transcript_not_found', 'message': 'private-text'}}
        with self.assertRaises(ChertControlPlaneError) as caught:
            self.face.get_call_transcript('call')
        self.assertEqual(caught.exception.code, 'transcript_not_found')
        self.assertNotIn('private-text', str(caught.exception))
        self.server.status = 200
        for payload in ({'messages': [], 'has_more': 1}, {'messages': [{**MESSAGE, 'status': 'received'}], 'has_more': False},
                        {'messages': [{**MESSAGE, 'service': None}], 'has_more': False},
                        {'messages': [{**MESSAGE, 'parts': [{'type': 'text', 'value': 3}]}], 'has_more': False}):
            self.server.payload = payload
            with self.assertRaises(ChertAPIError) as caught:
                self.messages.list_chat_messages('chat')
            self.assertEqual(caught.exception.code, 'invalid_response')

    def test_redirects_never_forward_credentials_or_repeat_requests(self):
        self.server.status, self.server.payload = 307, {}
        for read in (self.face.list_projects, self.face.list_integrations,
                     lambda: self.face.get_call_transcript('call'), lambda: self.messages.list_chat_messages('chat')):
            before = len(self.server.calls)
            with self.assertRaises((ChertControlPlaneError, ChertAPIError)):
                read()
            self.assertEqual(len(self.server.calls), before + 1)


if __name__ == '__main__':
    unittest.main()
