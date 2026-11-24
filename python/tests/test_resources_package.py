"""Exercise public resource reads from an installed wheel, without source path injection."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ResourcePackageTests(unittest.TestCase):
    def test_clean_wheel_consumer(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            def run(args, cwd=temp):
                result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            run([sys.executable, '-c', f'import setuptools.build_meta as b; b.build_wheel({temp!r})'], root)
            wheel, = Path(temp).glob('*.whl')
            consumer = Path(temp, 'consumer')
            run([sys.executable, '-m', 'venv', str(consumer)])
            interpreter = str(consumer / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))
            run([interpreter, '-m', 'pip', 'install', '--no-index', '--no-deps', str(wheel)])
            run([interpreter, '-I', str(root / 'tests/test_resources.py')])


if __name__ == '__main__':
    unittest.main()
