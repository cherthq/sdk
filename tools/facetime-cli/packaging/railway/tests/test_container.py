"""Local Docker only. Runtime image uses no test injection; qualification target does."""
import json
import os
from pathlib import Path
import subprocess
import time
import unittest
import uuid

DOCKER = os.environ.get('DOCKER', '/Applications/Docker.app/Contents/Resources/bin/docker')
IMAGE = os.environ.get('QUALIFICATION_IMAGE', 'chert-railway-qualification:20260930-r1')
RUNTIME = os.environ.get('RUNTIME_IMAGE', 'chert-railway:20260930-r1')
ENV = ['-e','PILOT_VOLUME_ID=local-qualification','-e','LIVEKIT_URL=wss://isolated.invalid',
       '-e','LIVEKIT_API_KEY=synthetic-key','-e','LIVEKIT_API_SECRET=synthetic-provider',
       '-e','CHERT_NAMESPACE=packaging','-e','CHERT_CONNECTION_TOKEN=synthetic-connection',
       '-e','CHERT_RECOVERY_TOKEN=synthetic-recovery']
BASE = '/state/chert-pilot'


def docker(*args, check=True):
    result = subprocess.run([DOCKER,*args], text=True, capture_output=True, timeout=85)
    if check and result.returncode:
        raise AssertionError(result.stderr + result.stdout)
    return result


def eventually(fn, timeout=18):
    deadline = time.monotonic()+timeout
    last = None
    while time.monotonic()<deadline:
        try:
            value = fn()
            if value: return value
        except (AssertionError, ValueError, KeyError) as error:
            last = error
        time.sleep(.15)
    raise AssertionError(f'condition timeout: {last}')


class Containers(unittest.TestCase):
    def setUp(self):
        self.name = 'chert-package-test-'+uuid.uuid4().hex[:10]
        self.volume = self.name+'-state'
        self.bootstrap = self.name+'-bootstrap'
        self.names = []
        docker('volume','create',self.volume)
        docker('volume','create',self.bootstrap)
        self.mounts = ['-v',self.volume+':/state','-v',self.bootstrap+':/bootstrap']
        self.once('provision',user='0',image=RUNTIME)
        self.once('seed',user='0')
        self.once('initialize')

    def tearDown(self):
        for name in self.names: docker('rm','-f',name,check=False)
        docker('volume','rm',self.volume,check=False)
        docker('volume','rm',self.bootstrap,check=False)

    def once(self, action, user='10001:10001', image=IMAGE, check=True):
        return docker('run','--rm','--network','none','--user',user,*self.mounts,*ENV,image,action,check=check)

    def start(self):
        name = self.name+'-'+str(len(self.names))
        self.names.append(name)
        docker('run','-d','--name',name,'--network','none',*self.mounts,*ENV,IMAGE,'run')
        self.container = name
        eventually(lambda: self.health()['healthy'])
        return name

    def execute(self, source, check=True):
        return docker('exec',self.container,'python','-c',source,check=check)

    def health(self):
        output = self.execute("import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/healthz').read().decode())")
        return json.loads(output.stdout)

    def rpc(self, method, args=None, admin=False):
        path = BASE+'/ipc/'+('admin.sock' if admin else 'owner.sock')
        request = json.dumps({'method':method,'args':args or {}})
        source = f"import socket,json; s=socket.socket(socket.AF_UNIX); s.settimeout(4); s.connect({path!r}); s.sendall(({request!r}+'\\n').encode()); print(s.makefile().readline())"
        return json.loads(self.execute(source).stdout)

    def provider(self):
        return json.loads(self.execute(f"print(open('{BASE}/application/provider.json').read())").stdout)

    def pid(self, role):
        fragment = '/qualification/owner.py' if role=='owner' else '/runtime/node.mjs'
        source = f"from pathlib import Path; print(next(int(p.parent.name) for p in Path('/proc').glob('[0-9]*/cmdline') if any(arg.endswith({fragment.encode()!r}) for arg in p.read_bytes().split(b'\\0')[1:])))"
        return int(self.execute(source).stdout)

    def kill(self, pid, sig):
        self.execute(f'import os; os.kill({pid},{sig})')

    def claim(self):
        now = int(time.time()*1000)
        request = {'operation_id':'operation', 'project_id':'test','line_id':'line','call_id':'call','request_id':'request',
                   'deadline_at':now+5000,'prepare_deadline_at':now+4000,'maximum_session_expires_at':now+650000,
                   'media':{'audio':True,'video':True}}
        result = self.rpc('prepare',{'call':request})
        self.assertEqual(result['result']['action'],'accept')
        return request

    def test_standby_permissions_credentials_and_zero_allocations(self):
        self.start()
        for _ in range(4): self.assertEqual(self.health()['mode'],'standby')
        self.assertEqual(self.provider()['creates'],0)
        self.assertEqual(self.provider()['dispatches'],0)
        for role in ('node','owner'):
            pid=self.pid(role)
            data=json.loads(self.execute(f"import json,os; print(json.dumps(dict(uid=os.stat('/proc/{pid}').st_uid, env=open('/proc/{pid}/environ','rb').read().decode().split('\\0'))))").stdout)
            self.assertEqual(data['uid'],10001)
            env='\n'.join(data['env'])
            self.assertNotIn('synthetic-provider' if role=='node' else 'synthetic-connection',env)
        self.execute(f"import os,stat; from pathlib import Path; paths=[Path('{BASE}/application'),Path('{BASE}/connector'),Path('{BASE}/ipc')]; assert all(p.stat().st_mode & 0o077 == 0 for p in paths); assert all(p.stat().st_mode & 0o077 == 0 for p in Path('{BASE}').rglob('*') if p.is_file())")
        self.assertNotIn('synthetic-',json.dumps(self.health()))
        self.assertNotEqual(self.once('initialize',check=False).returncode,0)

    def test_continuous_owner_refill_restart_disable_and_authority(self):
        self.start()
        command = "import subprocess; subprocess.run(['python','/opt/chert-pilot/railway-20260930-r1/runtime/runtime.py',%r],check=True)"
        self.execute(command % 'continuous-on')
        time.sleep(2.5)
        self.assertEqual(self.provider()['creates'], 0)
        self.execute(f"from pathlib import Path; Path('{BASE}/application/authority-active').touch(mode=0o600)")
        eventually(lambda: self.provider()['creates'] == 1)
        eventually(lambda: self.rpc('health')['result'] == 'available')
        docker('stop','-t','65',self.container)
        docker('start',self.container)
        eventually(lambda: self.health()['healthy'])
        eventually(lambda: self.rpc('health')['result'] == 'available')
        self.assertEqual(self.provider()['creates'], 1)
        request = self.claim()
        self.rpc('lifecycle', {'call':request,'event':{'event_id':'end','transition':'ended'},'context':{}})
        eventually(lambda: self.provider()['creates'] == 2, timeout=25)
        self.assertEqual(self.provider()['deletes'], 1)
        self.assertEqual(len(self.provider()['rooms']), 1)
        self.execute(command % 'continuous-off')
        slots = self.rpc('status', admin=True)['result']['slots']
        current = next(s['slot_id'] for s in slots if s['state'] == 'ready')
        self.rpc('cancel_slot', {'slot_id':current}, True)
        eventually(lambda: not self.provider()['rooms'])
        time.sleep(3)
        self.assertEqual(self.provider()['creates'], 2)

    def test_writer_exclusion_restart_and_container_replacement(self):
        original=self.start()
        self.rpc('stage',{'slot_id':'persist'},True)
        request=self.claim()
        self.assertNotEqual(self.once('run',check=False).returncode,0)
        self.assertEqual(self.rpc('recover',{'call':request,'context':{}})['result']['cleanup'],'pending')
        docker('stop','-t','65',original)
        docker('start',original)
        eventually(lambda:self.health()['healthy'])
        self.assertEqual(self.provider()['creates'],1)
        docker('stop','-t','65',original)
        self.start()
        self.assertEqual(self.provider()['creates'],1)
        self.assertEqual(self.rpc('recover',{'call':request,'context':{}})['result']['cleanup'],'pending')
        self.rpc('lifecycle',{'call':request,'event':{'event_id':'end','transition':'ended'},'context':{}})
        eventually(lambda:not self.provider()['rooms'])
        self.assertEqual(self.provider()['deletes'],1)

    def test_node_restart_sigkill_and_independent_expiry(self):
        self.start()
        first=self.pid('node')
        self.kill(first,15)
        eventually(lambda:self.pid('node') != first and self.health()['healthy'])
        second=self.pid('node')
        owner=self.pid('owner')
        self.kill(second,9)
        self.execute(f"from pathlib import Path; assert Path('{BASE}/connector/journal.json.lock').is_file()")
        # Owner restart selects a test-only short lease; real construction unchanged.
        self.execute(f"from pathlib import Path; Path('{BASE}/application/short-ttl').touch(mode=0o600)")
        self.kill(owner,9)
        eventually(lambda:self.pid('owner') != owner and self.rpc('health')['ok'])
        self.rpc('stage',{'slot_id':'expires'},True)
        self.claim()
        eventually(lambda:not self.provider()['rooms'])
        self.assertEqual(self.provider()['creates'],1)
        self.assertEqual(self.provider()['deletes'],1)
        time.sleep(5.2)
        self.assertNotEqual(self.execute(f"from pathlib import Path; assert any(b'/runtime/node.mjs' in p.read_bytes() for p in Path('/proc').glob('[0-9]*/cmdline') if p.parent.name != str(__import__('os').getpid()))",check=False).returncode,0)
        self.assertEqual(self.rpc('health')['ok'],True)
        lock=self.execute(f"print(open('{BASE}/connector/journal.json.lock').read())").stdout
        docker('stop','-t','65',self.container)
        docker('start',self.container)
        eventually(lambda:self.rpc('health')['ok'])
        self.assertEqual(self.execute(f"print(open('{BASE}/connector/journal.json.lock').read())").stdout,lock)
        self.execute("from pathlib import Path; assert not any(arg.endswith(b'/runtime/node.mjs') for p in Path('/proc').glob('[0-9]*/cmdline') for arg in p.read_bytes().split(bytes([0]))[1:])")

    def test_python_crash_reopens_claim_and_preserves_interrupted_staging(self):
        self.start()
        self.rpc('stage',{'slot_id':'claim'},True)
        request=self.claim()
        first=self.pid('owner')
        self.kill(first,9)
        eventually(lambda:self.pid('owner') != first and self.health()['healthy'])
        self.assertEqual(self.rpc('recover',{'call':request,'context':{}})['result']['cleanup'],'pending')
        self.rpc('lifecycle',{'call':request,'event':{'event_id':'end','transition':'ended'},'context':{}})
        eventually(lambda:not self.provider()['rooms'])
        self.execute(f"from pathlib import Path; Path('{BASE}/application/control.json').write_text('{{\"hold\":true}}')")
        # Detached RPC starts actual durable staging, then kill after the provider create.
        self.execute(f"import socket,json; s=socket.socket(socket.AF_UNIX); s.connect('{BASE}/ipc/admin.sock'); s.sendall(b'{{\"method\":\"stage\",\"args\":{{\"slot_id\":\"uncertain\"}}}}\\n'); s.close()")
        eventually(lambda:self.provider()['creates']==2)
        first=self.pid('owner')
        self.kill(first,9)
        eventually(lambda:self.pid('owner') != first and self.rpc('health')['ok'])
        state=self.rpc('status',admin=True)['result']['slots']
        self.assertEqual(next(s for s in state if s['slot_id']=='uncertain')['state'],'uncertain')
        self.assertEqual(self.provider()['creates'],2)
        self.assertEqual(self.provider()['deletes'],1)

    def test_production_image_standby_and_bad_node_config_leave_owner_alive(self):
        name=self.name+'-production'
        self.names.append(name)
        self.container=name
        docker('run','-d','--name',name,'--network','none','--read-only','--tmpfs','/tmp',*self.mounts,*ENV,RUNTIME,'run')
        eventually(lambda:self.rpc('health')['ok'])
        # Standalone loopback relay in this test only, not present in runtime image.
        source=(Path(__file__).parent/'relay.mjs').read_text()
        docker('exec','-d',name,'node','--input-type=module','-e',source)
        eventually(lambda:self.health()['healthy'])
        self.assertEqual(self.health()['mode'],'standby')
        self.assertEqual(self.provider()['creates'],0)
        self.execute("from pathlib import Path; assert not Path('/qualification').exists(); assert not Path('/opt/chert-pilot/railway-20260930-r1/application/connector/tests').exists()")
        self.assertNotEqual(self.execute("from pathlib import Path; Path('/opt/chert-pilot/railway-20260930-r1/handler/handler.js').write_text('wrong')",check=False).returncode,0)
        docker('stop','-t','65',name)
        docker('run','--rm','--network','none',*self.mounts,'--entrypoint','python',RUNTIME,'-c',f"import json; from pathlib import Path; p=Path('{BASE}/connector/config.json'); c=json.loads(p.read_text()); c['handler']['module']='/invalid/module.js'; p.write_text(json.dumps(c))")
        docker('start',name)
        eventually(lambda:self.rpc('health')['ok'])
        eventually(lambda:self.execute("import urllib.request,urllib.error,json\ntry: urllib.request.urlopen('http://127.0.0.1:8080/healthz')\nexcept urllib.error.HTTPError as e: assert json.load(e)['processes']['node']=='config_review_required'").returncode==0)
        self.assertEqual(self.provider()['creates'],0)

    def test_child_restart_refuses_missing_journal_without_stopping_owner(self):
        self.start()
        self.kill(self.pid('node'),15)
        eventually(lambda:self.execute(f"from pathlib import Path; assert not Path('{BASE}/connector/journal.json.lock').exists()").returncode==0)
        self.execute(f"from pathlib import Path; p=Path('{BASE}/connector/journal.json'); p.rename(p.with_suffix('.preserved'))")
        time.sleep(5.5)
        self.execute(f"from pathlib import Path; assert not Path('{BASE}/connector/journal.json').exists()")
        self.assertEqual(self.rpc('health')['ok'],True)
        self.assertEqual(self.provider()['creates'],0)

    def test_missing_mount_journal_and_foreign_marker_refuse(self):
        result=docker('run','--rm','--network','none',*ENV,RUNTIME,'run',check=False)
        self.assertNotEqual(result.returncode,0)
        self.start()
        docker('stop','-t','65',self.container)
        docker('run','--rm','--network','none',*self.mounts,'--entrypoint','python',RUNTIME,'-c',f"from pathlib import Path; p=Path('{BASE}/application/resources.json'); p.rename(p.with_suffix('.preserved'))")
        self.assertNotEqual(self.once('run',check=False).returncode,0)
        docker('run','--rm','--network','none',*self.mounts,'--entrypoint','python',RUNTIME,'-c',f"from pathlib import Path; p=Path('{BASE}/application/resources.preserved'); p.rename(p.with_suffix('.json')); Path('{BASE}/volume-id').write_text('foreign')")
        self.assertNotEqual(self.once('run',check=False).returncode,0)

    def test_shutdown_preserves_uncertainty_and_bounds_restart_storm(self):
        self.start()
        for attempt in range(3):
            pid=self.pid('owner')
            self.kill(pid,9)
            if attempt<2:
                eventually(lambda:self.pid('owner') != pid and self.rpc('health')['ok'])
        time.sleep(5.2)
        self.assertNotEqual(self.execute("from pathlib import Path; assert any(p.read_bytes().split(b'\\0')[1:2]==[b'/qualification/owner.py'] for p in Path('/proc').glob('[0-9]*/cmdline'))",check=False).returncode,0)
        started=time.monotonic()
        docker('stop','-t','65',self.container)
        self.assertLess(time.monotonic()-started,65)
        self.assertEqual(docker('inspect','-f','{{.State.ExitCode}}',self.container).stdout.strip(),'0')

if __name__=='__main__': unittest.main(verbosity=2)
