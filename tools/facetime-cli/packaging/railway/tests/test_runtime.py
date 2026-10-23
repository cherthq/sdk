import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'runtime.py')
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)

class RuntimeTests(unittest.TestCase):
    def test_environment_is_partitioned(self):
        env = dict(LIVEKIT_API_SECRET='provider', CHERT_CONNECTION_TOKEN='transport',
                   CHERT_RECOVERY_TOKEN='recovery', NODE_OPTIONS='injection', PYTHONPATH='injection',
                   CHERT_WEBHOOK_ROUTES_JSON='provider-hook', CHERT_NAMESPACE='test')
        node = runtime.child_env('node', env)
        owner = runtime.child_env('owner', env)
        self.assertNotIn('LIVEKIT_API_SECRET', node)
        self.assertNotIn('CHERT_WEBHOOK_ROUTES_JSON', node)
        self.assertNotIn('CHERT_CONNECTION_TOKEN', owner)
        self.assertNotIn('CHERT_RECOVERY_TOKEN', owner)
        self.assertNotIn('NODE_OPTIONS', node)
        self.assertNotEqual(owner['PYTHONPATH'], 'injection')
        self.assertEqual(node['CHERT_CONNECTION_TOKEN'], 'transport')
        self.assertEqual(owner['LIVEKIT_API_SECRET'], 'provider')

    def test_mount_must_be_exact_and_persistent(self):
        runtime.verify_mount('1 0 8:1 / /state rw - ext4 /dev/test rw\n')
        for text in ('', '1 0 8:1 / / rw - ext4 /dev/test rw\n',
                     '1 0 0:1 / /state rw - tmpfs tmpfs rw\n',
                     '1 0 8:1 / /state ro - ext4 /dev/test ro\n'):
            with self.assertRaises(runtime.Refusal):
                runtime.verify_mount(text)

    def test_permissions_reject_symlink_and_public_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'file'
            p.write_text('retain')
            p.chmod(0o644)
            with self.assertRaises(runtime.Refusal): runtime.private(p)
            p.chmod(0o600)
            runtime.private(p)
            link = Path(d) / 'link'
            link.symlink_to(p)
            with self.assertRaises(runtime.Refusal): runtime.private(link)
            self.assertEqual(p.read_text(), 'retain')

    def test_node_crash_lock_and_fatal_exit_never_restart(self):
        self.assertFalse(runtime.may_restart('node', -9, True, 1))
        for code in (2, 3, 4, 5):
            self.assertFalse(runtime.may_restart('node', code, False, 1))
        self.assertTrue(runtime.may_restart('node', 0, False, 1))
        self.assertTrue(runtime.may_restart('owner', -9, False, 1))
        self.assertFalse(runtime.may_restart('owner', 1, False, 3))

if __name__ == '__main__': unittest.main()

class ShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_hung_child_killed_after_budget(self):
        import asyncio
        import sys
        process = await asyncio.create_subprocess_exec(sys.executable, '-c',
            'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print("ready",flush=True); time.sleep(30)',
            stdout=asyncio.subprocess.PIPE, start_new_session=True)
        await process.stdout.readline()
        supervisor = runtime.Supervisor()
        supervisor.children['owner'] = process
        await asyncio.wait_for(supervisor.halt('owner', .02), 1)
        self.assertEqual(process.returncode, -9)
