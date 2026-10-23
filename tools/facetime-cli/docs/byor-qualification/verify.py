from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parent;cli=root.parents[1]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads((root/'baseline.json').read_text())
allowed={str(cli/'tests/fixtures/cli-harness.ts'),str(cli/'docs/BACKEND_PILOT_RUNBOOK.md'),str(cli/'docs/DEPLOYMENT_READINESS.md')}
changed=[p for p,h in baseline.items() if not Path(p).exists() or sha(Path(p))!=h]
assert set(changed)==allowed,changed
for name in ['BACKEND_PILOT_RUNBOOK.md','DEPLOYMENT_READINESS.md']:
 assert (cli/'docs'/name).read_bytes().endswith((root/('previous-'+name)).read_bytes())
for item in json.loads((root/'artifacts.json').read_text())['artifacts']+json.loads((root/'artifacts.json').read_text())['configuration']:
 assert sha(Path(item['file']))==item['sha256'],item['file']
manifest=json.loads((root/'candidate-files.json').read_text());candidate=cli/'.local/byor-qualification/candidate'
for item in manifest['files']:assert sha(candidate/item['path'])==item['sha256']
# Catch any unallowlisted changed source file that archive reconstruction would omit.
basefiles=subprocess.check_output(['git','-C','/Users/garygao/chert-facetime','ls-tree','-r','--name-only',manifest['base']]).decode().splitlines()
allow={x['path'] for x in manifest['files']}
for name in basefiles:
 if not name.startswith(('control-plane/','connector-relay/')) or name in allow:continue
 original=subprocess.check_output(['git','-C','/Users/garygao/chert-facetime','show',manifest['base']+':'+name])
 assert (candidate/name).read_bytes()==original,name
preservation=dict(baseline_files=len(baseline),changed_existing_files=changed,unrelated_files_unchanged=True,
 historical_candidates_artifacts_and_debts_unchanged=True,original_python_source_unchanged=True,
 original_chert_working_tree_unchanged=True,prior_document_bytes_preserved=True,
 manifest_hashes_verified=True,unallowlisted_backend_source_unchanged=True)
(root/'preservation.json').write_text(json.dumps(preservation,indent=2)+'\n')
paths=set(Path(p) for p in changed)
paths.add(cli/'tests/cli/talking-head-package.test.ts')
paths.update(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
paths.update(candidate/f['path'] for f in manifest['files'])
paths.update(Path(x['file']) for x in json.loads((root/'artifacts.json').read_text())['artifacts'])
paths.update(Path('/Users/garygao/demo-agent-0')/x['path'] for x in json.loads((root/'application-files.json').read_text())['files'])
(root/'changed-files.json').write_text(json.dumps([dict(path=str(p),sha256=sha(p) if p.name not in ('changed-files.json','preservation.json') else None) for p in sorted(paths)],indent=2)+'\n')
print(json.dumps(preservation,indent=2))
