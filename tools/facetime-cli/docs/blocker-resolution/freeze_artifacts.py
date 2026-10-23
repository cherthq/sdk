"""Freeze the reviewed candidate delta and deterministic source archives locally."""
import difflib
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CANDIDATE = ROOT / '.local/blocker-resolution/candidate'
REPO = pathlib.Path('/Users/garygao/chert-facetime')
manifest = json.loads((HERE / 'candidate-files.json').read_text())
base = manifest['base']
base_files = subprocess.check_output(
    ['git', '-C', str(REPO), 'ls-tree', '-r', '--name-only', base]
).decode().splitlines()
patch = []
for entry in manifest['files']:
    name = entry['path']
    data = (CANDIDATE / name).read_bytes()
    entry['sha256'] = hashlib.sha256(data).hexdigest()
    old = subprocess.check_output(['git', '-C', str(REPO), 'show', f'{base}:{name}']) if name in base_files else b''
    patch.extend(difflib.unified_diff(
        old.decode().splitlines(keepends=True), data.decode().splitlines(keepends=True),
        fromfile=f'a/{name}' if name in base_files else '/dev/null', tofile=f'b/{name}',
    ))
(HERE / 'candidate.patch').write_text(''.join(patch))
(HERE / 'candidate-files.json').write_text(json.dumps(manifest, indent=2) + '\n')

with tempfile.TemporaryDirectory(prefix='chert-release-patch-') as directory:
    archive = subprocess.check_output(['git', '-C', str(REPO), 'archive', base])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(directory, filter='data')
    subprocess.run(['git', 'apply', '--check', str(HERE / 'candidate.patch')], cwd=directory, check=True)
    subprocess.run(['git', 'apply', str(HERE / 'candidate.patch')], cwd=directory, check=True)
    for entry in manifest['files']:
        assert (pathlib.Path(directory) / entry['path']).read_bytes() == (CANDIDATE / entry['path']).read_bytes()

artifacts = json.loads((HERE / 'artifacts.json').read_text())
allowed = set(base_files) | {entry['path'] for entry in manifest['files']}
for item in artifacts['artifacts']:
    output = pathlib.Path(item['file'])
    if output.name in ('control-plane-source.tar.gz', 'connector-relay-source.tar.gz'):
        component = 'control-plane' if output.name.startswith('control-plane') else 'connector-relay'
        with output.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode='w') as tar:
                for name in sorted(allowed):
                    if not name.startswith(component + '/'):
                        continue
                    path = CANDIDATE / name
                    if not path.is_file():
                        raise RuntimeError(f'Missing source: {name}')
                    info = tar.gettarinfo(str(path), arcname=name)
                    info.uid = info.gid = info.mtime = 0
                    info.uname = info.gname = ''
                    with path.open('rb') as source:
                        tar.addfile(info, source)
    item['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    item['bytes'] = output.stat().st_size
for item in artifacts.get('configuration', []):
    item['sha256'] = hashlib.sha256(pathlib.Path(item['file']).read_bytes()).hexdigest()
(HERE / 'artifacts.json').write_text(json.dumps(artifacts, indent=2) + '\n')
print(json.dumps({'patch_applies_to_base': True, 'candidate_files_verified': len(manifest['files']), 'artifacts': artifacts['artifacts']}, indent=2))
