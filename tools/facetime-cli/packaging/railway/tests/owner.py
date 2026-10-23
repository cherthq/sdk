"""Provider substitutes only; real server.main constructs Config/adapter/owner."""
import asyncio
from dataclasses import replace
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch
ROOT = Path('/opt/chert-pilot/railway-20260930-r1/application')
sys.path[:0] = [str(ROOT/'connector'), str(ROOT/'connector/tests')]
from substitutes import Provider
import server

connect = socket.socket.connect
def deny_network(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        raise RuntimeError('provider_network_forbidden')
    return connect(self,address)
socket.socket.connect = deny_network
original = server.Config.from_env
# Short lease is a test-only clock convenience, not production configuration.
def config():
    result = original()
    return replace(result,resource_ttl_seconds=.5) if Path('/state/chert-pilot/application/short-ttl').exists() else result
server.Config.from_env = config
os.umask(0o077)
provider = Provider('/state/chert-pilot/application')
with patch('chert_reference_agent.livekit_adapter.api.LiveKitAPI', return_value=provider):
    asyncio.run(server.main())
