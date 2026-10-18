"""Dedicated offline loopback contract helper; no device/cloud origins."""
import dataclasses
import json
import re
import sys
from urllib.parse import urlsplit
from chert import ChertClient, ChertAPIError


def main():
    if len(sys.argv) != 3 or sys.argv[1] != '--typed-reaction-fixture':
        return 2
    origin = sys.argv[2]
    if not re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', origin):
        return 2
    if not 0 < urlsplit(origin).port <= 65535:
        return 2
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        return 2
    value = json.loads(raw)
    required = {'api_key', 'chat_id', 'message_id', 'reaction', 'remove'}
    if not isinstance(value, dict) or set(value) not in (required, required | {'idempotency_key'}):
        return 2
    if not all(isinstance(value[k], str) for k in ('api_key', 'chat_id', 'message_id', 'reaction')) or type(value['remove']) is not bool:
        return 2
    if 'idempotency_key' in value and not isinstance(value['idempotency_key'], str):
        return 2
    try:
        result = ChertClient(origin, value['api_key'], timeout=5).send_reaction(
            value['chat_id'], value['message_id'], value['reaction'], remove=value['remove'],
            idempotency_key=value.get('idempotency_key'))
        print(json.dumps(dataclasses.asdict(result)))
    except ChertAPIError as error:
        result = {'ok': False, 'status': error.status, 'code': '4103' if error.code == '4103' else 'request_failed'}
        if isinstance(error.data, dict) and isinstance(error.data.get('operation_id'), str) and re.fullmatch('[a-f0-9]{32}', error.data['operation_id']):
            result['operation_id'] = error.data['operation_id']
        print(json.dumps(result))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        sys.exit(2)
