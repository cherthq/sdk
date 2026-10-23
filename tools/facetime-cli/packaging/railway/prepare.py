"""Create a NEW frozen build context, never mutate the reviewed release."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]).resolve()
manifest = json.loads((ROOT / 'docs/deployment-release/artifacts.json').read_text())
for item in manifest['artifacts'] + manifest['configuration']:
    if hashlib.sha256(Path(item['file']).read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('reviewed input hash mismatch')
OUT.mkdir(parents=True, exist_ok=False)
app = OUT / 'application'
app.mkdir()
archive = ROOT / '.local/deployment-release/artifacts/talking-head-bridge-source.tar.gz'
with tarfile.open(archive) as source:
    selected = [m for m in source.getmembers() if m.isfile() and (
        m.name.startswith('receiver/src/') or m.name.startswith('connector/') or
        m.name in ('receiver/requirements.lock', 'receiver/requirements-dev.lock'))]
    source.extractall(app, members=selected, filter='data')
for item in json.loads((ROOT / 'docs/deployment-release/application-files.json').read_text())['files']:
    path = app / item['path']
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('application input mismatch')
shutil.copyfile(ROOT / '.local/deployment-release/artifacts/chert-local-transport-proof-0.0.0.tgz', OUT / 'cli.tgz')
shutil.copytree(ROOT / 'packaging/railway', OUT / 'runtime', ignore=shutil.ignore_patterns('__pycache__'))
for name in ('Dockerfile', 'package.json', 'package-lock.json'):
    shutil.copyfile(ROOT / 'packaging/railway' / name, OUT / name)
files = {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.rglob('*')) if p.is_file()}
(OUT / 'inputs.json').write_text(json.dumps({'release': 'railway-20260930-r1', 'reviewed_release': manifest, 'files': files}, indent=2)+'\n')
print(OUT)
