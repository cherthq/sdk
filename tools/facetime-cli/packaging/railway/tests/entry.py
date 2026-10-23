"""TEST IMAGE ONLY: exact supervisor + production server, provider transport patched."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
sys.path.insert(0, '/opt/chert-pilot/railway-20260930-r1/runtime')
import runtime

original = runtime.command
def command(role):
    return ['python', '/qualification/owner.py'] if role == 'owner' else original(role)
runtime.command = command

async def active_authority():
    # Qualification-only authority substitute; the container has no network.
    return (runtime.APP / 'authority-active').exists()
runtime.active_authority = active_authority

async def main():
    if sys.argv[1] == 'seed':
        config = {'schema_version': 2, 'mode': 'byor',
                  'handler': {'id': 'talking-head-ready-v1', 'module': str(runtime.RELEASE / 'handler/handler.js')},
                  'state_dir': str(runtime.NODE),
                  'transport': {'mode': 'loopback-v1', 'relay_origin': 'http://127.0.0.1:9091',
                  'reconcile_origin': 'http://127.0.0.1:9091',
                  'scope': {'project_id':'test', 'line_id':'line', 'binding_id':'binding', 'binding_epoch':1,
                            'instance_id':'instance', 'connection_generation':0, 'session_mode':'byor'},
                  'credential_env':'CHERT_CONNECTION_TOKEN', 'recovery_env':'CHERT_RECOVERY_TOKEN'}}
        p = Path('/bootstrap/config.json')
        p.write_text(json.dumps(config))
        p.chmod(0o600)
        os.chown(p,10001,10001)
        return
    relay = None
    if sys.argv[1] == 'run':
        relay = subprocess.Popen(['node','/qualification/relay.mjs'], env={'PATH':'/usr/local/bin:/usr/bin:/bin'},
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        await runtime.main()
    finally:
        if relay:
            relay.terminate()
            relay.wait(timeout=3)

try:
    asyncio.run(main())
except Exception:
    print('{"code":"qualification_refusal"}', flush=True)
    sys.exit(4)
