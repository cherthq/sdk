"""Container PID 1; optional durable refill delegates effects to the Python owner."""
import asyncio
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import time
import uuid
import urllib.request

RELEASE = Path('/opt/chert-pilot/railway-20260930-r1')
BASE = Path('/state/chert-pilot')
APP = BASE / 'application'
NODE = BASE / 'connector'
IPC = BASE / 'ipc'
UID = 10001
RESTART_DELAY = 5
NODE_STOP = 10
OWNER_STOP = 50


class Refusal(Exception):
    pass


def verify_mount(text=None):
    text = Path('/proc/self/mountinfo').read_text() if text is None else text
    matches = [line.split() for line in text.splitlines() if len(line.split()) > 6 and line.split()[4] == '/state']
    if len(matches) != 1:
        raise Refusal('persistent_mount_missing')
    fields = matches[0]
    if fields[fields.index('-')+1] not in ('ext4', 'xfs', 'btrfs') or 'rw' not in fields[5].split(','):
        raise Refusal('persistent_mount_invalid')


def private(path, directory=False):
    s = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077 or (not directory and s.st_nlink != 1):
        raise Refusal('unsafe_state')


def child_env(role, source=None):
    source = os.environ if source is None else source
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
           'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1'}
    if role == 'node':
        names = ('CHERT_CONNECTION_TOKEN', 'CHERT_RECOVERY_TOKEN')
        env['TALKING_HEAD_CALLBACK_SOCKET'] = str(IPC / 'owner.sock')
    else:
        names = ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'CHERT_NAMESPACE')
        env.update(PYTHONPATH=str(RELEASE / 'application/receiver/src'),
                   CHERT_WEBHOOK_ROUTES_JSON='{"/unused":{}}', CHERT_SIGNING_ENABLED='false',
                   CHERT_AGENT_RUN_MODE='continuous', CHERT_TOKEN_TTL_SECONDS='900',
                   CHERT_RESOURCE_TTL_SECONDS='600', CHERT_DECISION_BUDGET_MS='4000',
                   CHERT_JOURNAL_PATH=str(APP / 'resources.json'),
                   TALKING_HEAD_OPERATION_JOURNAL=str(APP / 'operations.json'),
                   TALKING_HEAD_CALLBACK_SOCKET=str(IPC / 'owner.sock'),
                   TALKING_HEAD_ADMIN_SOCKET=str(IPC / 'admin.sock'))
    env.update({k: source[k] for k in names if k in source})
    return env


def may_restart(role, code, locked, attempts):
    return attempts < 3 and (role != 'node' or (not locked and code not in (2, 3, 4, 5)))


def volume_id():
    value = os.environ.get('PILOT_VOLUME_ID', '')
    if not re.fullmatch('[a-zA-Z0-9_-]{1,100}', value):
        raise Refusal('volume_identity_required')
    return value


def durable_write(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def provision():
    verify_mount()
    if os.getuid() != 0 or BASE.exists() or BASE.is_symlink():
        raise Refusal('fresh_volume_provisioning_required')
    # Only this fresh subtree is changed. Never recursively chown a shared volume.
    identity = volume_id()
    BASE.mkdir(mode=0o700)
    for path in (BASE, APP, NODE, IPC):
        if path != BASE:
            path.mkdir(mode=0o700)
        os.chown(path, UID, UID)
    durable_write(BASE / 'volume-id', identity)
    fd = os.open('/state', os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chown(BASE / 'volume-id', UID, UID)


def preflight(initializing=False):
    verify_mount()
    if os.getuid() != UID:
        raise Refusal('nonroot_user_required')
    for path in (BASE, APP, NODE, IPC):
        private(path, True)
    private(BASE / 'volume-id')
    if (BASE / 'volume-id').read_text() != volume_id():
        raise Refusal('volume_identity_mismatch')
    journals = (APP / 'resources.json', APP / 'operations.json', NODE / 'journal.json')
    if initializing:
        if any(p.exists() or p.is_symlink() for p in (*journals, NODE / 'config.json', BASE / 'initialized')):
            raise Refusal('initialization_requires_fresh_state')
    else:
        for path in (*journals, NODE / 'config.json', BASE / 'initialized'):
            private(path)
        if (BASE / 'initialized').read_text() != 'railway-state-v1':
            raise Refusal('initialization_incomplete')


def lease():
    fd = os.open(BASE / 'supervisor.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    private(BASE / 'supervisor.lock')
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        os.close(fd)
        raise Refusal('supervisor_writer_exists') from None
    return fd


async def rpc(path, method=None, args=None, timeout=1):
    async with asyncio.timeout(timeout):
        reader, writer = await asyncio.open_unix_connection(str(path), limit=32768)
        try:
            writer.write((json.dumps({'method': method, 'args': args or {}})+'\n').encode())
            await writer.drain()
            value = json.loads(await reader.readline())
            if value.get('ok') is not True:
                raise Refusal('ipc_unavailable')
            return value.get('result')
        finally:
            writer.close()
            await writer.wait_closed()


def command(role):
    if role == 'owner':
        return ['/usr/local/bin/python', str(RELEASE / 'application/connector/server.py')]
    return ['/usr/local/bin/node', str(RELEASE / 'runtime/node.mjs'), 'byor', '--config', str(NODE / 'config.json'), '--json']


async def checked(args, env):
    process = await asyncio.create_subprocess_exec(*args, env=env, stdout=asyncio.subprocess.DEVNULL,
                                                  stderr=asyncio.subprocess.DEVNULL)
    try:
        async with asyncio.timeout(20):
            if await process.wait() != 0:
                raise Refusal('initialization_or_config_invalid')
    except TimeoutError:
        process.kill()
        await process.wait()
        raise Refusal('initialization_timeout') from None


async def initialize():
    await checked(['/usr/local/bin/node', str(RELEASE / 'runtime/state.mjs'), 'initialize'], child_env('node'))
    await checked(command('owner') + ['--initialize-state'], child_env('owner'))
    durable_write(BASE / 'initialized', 'railway-state-v1')


def replace_private(path, value):
    """Atomic private policy/intent write; never rewrites application journals."""
    if path.exists():
        private(path)
    temp = path.parent / (path.name + '.' + uuid.uuid4().hex + '.tmp')
    durable_write(temp, json.dumps(value))
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def continuous_policy(enabled):
    config = json.loads((NODE / 'config.json').read_text())
    replace_private(BASE / 'continuous-policy.json',
                    {'enabled': enabled, 'binding_id': config['transport']['scope']['binding_id']})


async def active_authority():
    """Fresh authenticated read; no WebSocket or generation fencing side effect."""
    config = json.loads((NODE / 'config.json').read_text())['transport']
    if config['mode'] != 'hosted-v1' or not config['relay_origin'].startswith('https://'):
        return False
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    def inspect():
        request = urllib.request.Request(config['relay_origin'].rstrip('/') + '/inspect', data=b'{}',
            headers={'Authorization': 'Bearer ' + os.environ[config['credential_env']],
                     'Content-Type': 'application/json'})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=2) as response:
            data = json.loads(response.read(32769))
        return (data.get('state') == 'active' and data.get('connected') is True and
                data.get('recovery_only') is False and all(
                    data.get('scope', {}).get(k) == v for k, v in config['scope'].items()
                    if k != 'connection_generation'))
    try:
        return await asyncio.to_thread(inspect)
    except Exception:
        return False


class ContinuousController:
    """At most one outstanding staging intent; ambiguity blocks, never retries."""
    def __init__(self, owner_rpc, authority, healthy):
        self.rpc, self.authority, self.healthy = owner_rpc, authority, healthy
        self.path = BASE / 'continuous-state.json'
        self.state = {'pending_slot': None, 'not_before': 0}
        if self.path.exists():
            private(self.path)
            self.state = json.loads(self.path.read_text())
        self.status = 'disabled'

    def save(self):
        replace_private(self.path, self.state)

    async def step(self):
        policy_path = BASE / 'continuous-policy.json'
        if not policy_path.exists():
            self.status = 'disabled'
            return
        private(policy_path)
        policy = json.loads(policy_path.read_text())
        config = json.loads((NODE / 'config.json').read_text())
        if policy.get('binding_id') != config['transport']['scope']['binding_id']:
            raise Refusal('continuous_binding_mismatch')
        if policy.get('enabled') is not True:
            self.status = 'disabled'
            return
        self.status = 'waiting_for_runtime'
        if not await self.healthy():
            return
        status = await self.rpc('status')
        slots = status['slots']
        pending = self.state['pending_slot']
        if pending:
            found = next((s for s in slots if s['slot_id'] == pending), None)
            if found is None:
                self.status = 'pending_slot_unobserved'
                return
            self.status = found['state']
            if found['state'] != 'clean':
                return
            self.state = {'pending_slot': None, 'not_before': time.time() + 10}
            self.save()
        self.status = 'waiting_for_cleanup'
        if any(s['state'] != 'clean' for s in slots):
            return
        # Owner resource cleanup and Chert lifecycle/decision settlement are
        # separate predicates. Require both before allocating a replacement.
        journal = json.loads((NODE / 'journal.json').read_text())
        if any(not (e.get('authoritative_terminal') and e.get('settled') and
                    e.get('cleanup') == 'clean' and all(v['acknowledged'] for v in e['events']))
               for e in journal['entries'].values()):
            return
        self.status = 'cooldown'
        if time.time() < self.state['not_before']:
            return
        self.status = 'waiting_for_active_authority'
        if not await self.authority():
            return
        # Recheck the operator switch after network waits. Shutdown/disable may
        # leave a just-started intent, which stays owned and expires normally.
        if json.loads(policy_path.read_text()) != policy:
            return
        slot = 'continuous-' + uuid.uuid4().hex
        self.state = {'pending_slot': slot, 'not_before': time.time() + 10}
        self.save()  # Before sending: even an absent slot after a crash is debt.
        self.status = 'preparing'
        try:
            result = await self.rpc('stage', {'slot_id': slot})
            self.status = result['state']
        except Exception:
            self.status = 'staging_result_unknown'


class Supervisor:
    def __init__(self):
        self.stop = asyncio.Event()
        self.children = {}
        self.states = {'owner': 'starting', 'node': 'starting'}
        self.connected = False
        self.tasks = []
        self.continuous = None
        self.continuous_error = False

    async def refill(self):
        async def owner_rpc(method, args=None):
            if method == 'status':
                # Terminal history is retained indefinitely. Read the owner's
                # atomic snapshot instead of overflowing the bounded IPC reply
                # with an ever-growing public status list. Never write it.
                path = APP / 'operations.json'
                private(path)
                decisions = json.loads(path.read_text())['decisions']
                pending = self.continuous.state['pending_slot']
                return {'slots': [{'slot_id': s['slot_id'], 'state': s['state']}
                    for s in decisions.values() if s['kind'] == 'slot' and
                    (s['state'] != 'clean' or s['slot_id'] == pending)]}
            return await rpc(IPC / 'admin.sock', method, args, 50 if method == 'stage' else 2)
        async def healthy():
            return (await self.health())['healthy'] and not self.stop.is_set()
        try:
            self.continuous = ContinuousController(owner_rpc, active_authority, healthy)
        except Exception:
            self.continuous_error = True
            return
        while not self.stop.is_set():
            try:
                await self.continuous.step()
            except Exception:
                self.continuous.status = 'operator_review_required'
            try:
                await asyncio.wait_for(self.stop.wait(), 2)
            except TimeoutError:
                pass

    async def output(self, process):
        # Never forward child logs or arbitrary JSON fields (SDKs can log secrets).
        try:
            while line := await process.stdout.readline():
                try:
                    value = json.loads(line)
                    if value.get('code') == 'runtime_observation' and value.get('phase') == 'connected':
                        self.connected = True
                except (ValueError, AttributeError):
                    pass
        except (ValueError, OSError):
            # Oversized/malformed output cannot deadlock a child on a full pipe.
            process.kill()

    async def supervise(self, role):
        attempts = 0
        while not self.stop.is_set():
            try:
                preflight()
            except (Refusal, OSError):
                self.states[role] = 'state_review_required'
                return
            if role == 'node':
                try:
                    await checked(['/usr/local/bin/node', str(RELEASE / 'runtime/state.mjs'), 'validate'], child_env('node'))
                except Refusal:
                    self.states[role] = 'config_review_required'
                    return
                if self.stop.is_set():
                    return
            if role == 'node' and (NODE / 'journal.json.lock').exists():
                self.states[role] = 'crash_lock_review_required'
                return
            if role == 'node':
                self.connected = False
                # We hold the exclusive container lease; previous child is reaped.
                path = IPC / 'node.sock'
                if path.exists():
                    if not stat.S_ISSOCK(path.lstat().st_mode) or path.lstat().st_uid != UID:
                        self.states[role] = 'foreign_ipc_path'
                        return
                    path.unlink()
            attempts += 1
            try:
                process = await asyncio.create_subprocess_exec(*command(role), env=child_env(role),
                    stdout=asyncio.subprocess.PIPE if role == 'node' else asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
                self.children[role] = process
                self.states[role] = 'running'
                output = asyncio.create_task(self.output(process)) if role == 'node' else None
                code = await process.wait()
                if output:
                    await output
            except OSError:
                code = 1
            if role == 'node':
                self.connected = False
            self.states[role] = 'stopped' if self.stop.is_set() else 'restart_backoff'
            if self.stop.is_set():
                return
            if not may_restart(role, code, (NODE / 'journal.json.lock').exists(), attempts):
                self.states[role] = 'crash_lock_review_required' if role == 'node' and (NODE / 'journal.json.lock').exists() else 'restart_budget_exhausted_or_fatal'
                return
            try:
                await asyncio.wait_for(self.stop.wait(), RESTART_DELAY)
            except TimeoutError:
                pass

    async def health(self):
        alive = {role: role in self.children and self.children[role].returncode is None for role in ('node', 'owner')}
        ipc_ok = False
        ready = False
        try:
            if all(alive.values()):
                app, _ = await asyncio.gather(rpc(IPC / 'owner.sock', 'health'), rpc(IPC / 'node.sock'))
                ipc_ok = app in ('available', 'unavailable')
                ready = app == 'available'
        except Exception:
            pass
        healthy = all(alive.values()) and ipc_ok and self.connected and not self.stop.is_set()
        return {'healthy': healthy, 'mode': 'ready_slot_observed' if healthy and ready else 'standby' if healthy else 'degraded',
                'session_readiness': 'available' if ready else 'unavailable',
                'acceptance_authority': 'per_call_validation_required',
                'processes': dict(self.states), 'ipc': ipc_ok, 'connector_connected': self.connected,
                'continuous': self.continuous.status if self.continuous else
                              'operator_review_required' if self.continuous_error else 'disabled'}

    async def http(self, reader, writer):
        try:
            async with asyncio.timeout(3):
                line = await reader.readline()
                if line not in (b'GET /healthz HTTP/1.1\r\n', b'GET /healthz HTTP/1.0\r\n'):
                    status, value = 404, {'error': 'not_found'}
                else:
                    value = await self.health()
                    status = 200 if value['healthy'] else 503
                body = json.dumps(value).encode()
                writer.write(f'HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {len(body)}\r\n\r\n'.encode()+body)
                await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass

    async def halt(self, role, budget):
        process = self.children.get(role)
        if process is None or process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            await asyncio.wait_for(asyncio.shield(process.wait()), budget)
        except TimeoutError:
            os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
        except ProcessLookupError:
            pass

    async def run(self):
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, self.stop.set)
        server = await asyncio.start_server(self.http, '0.0.0.0', int(os.environ.get('PORT', '8080')), limit=4096)
        self.tasks = [asyncio.create_task(self.supervise(role)) for role in ('owner', 'node')]
        refill = asyncio.create_task(self.refill())
        try:
            await self.stop.wait()
        finally:
            self.stop.set()
            server.close()
            await server.wait_closed()
            # Closing the RPC does not cancel the owner's durable stage task.
            # Owner shutdown/reopen retains any interrupted operation as debt.
            refill.cancel()
            await asyncio.gather(refill, return_exceptions=True)
            # Keep Python cleanup alive while Node drains. Maximum 60 seconds total.
            await self.halt('node', NODE_STOP)
            await self.halt('owner', OWNER_STOP)
            await asyncio.gather(*self.tasks)


async def main():
    os.umask(0o077)
    action = sys.argv[1] if len(sys.argv) == 2 else 'invalid'
    if action == 'provision':
        provision()
        return
    if action in ('continuous-on', 'continuous-off'):
        preflight()
        continuous_policy(action == 'continuous-on')
        return
    if action not in ('initialize', 'run'):
        raise Refusal('invalid_command')
    preflight(action == 'initialize')
    fd = lease()
    try:
        preflight(action == 'initialize')
        if action == 'initialize':
            await initialize()
        else:
            await Supervisor().run()
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # Whitelist our static codes, never stringify foreign exceptions.
        code = str(error) if isinstance(error, Refusal) else 'state_or_runtime_unavailable'
        print(json.dumps({'code': code, 'action': 'preserve_state_and_review'}), flush=True)
        sys.exit(4)
