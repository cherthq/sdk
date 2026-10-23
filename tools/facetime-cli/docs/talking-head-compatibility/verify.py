import os, json, hashlib, subprocess, tarfile
from pathlib import Path
root=Path(__file__).resolve().parent;cli=root.parents[1]
base=json.loads((root/'baseline.json').read_text());current={}
exclude={'.git','node_modules','.venv','venv','__pycache__','.build','.next','dist','.pytest_cache','.ruff_cache'}
for repo in [cli,cli.parent/'chert-facetime',cli.parent/'demo-agent-0']:
 for directory,dirs,names in os.walk(repo):
  dirs[:]=[d for d in dirs if d not in exclude]
  for name in names:
   p=Path(directory)/name
   if p.is_file() and not p.is_symlink():current[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
changed=[{'path':p,'status':'modified' if p in base else 'new','sha256':sha} for p,sha in current.items() if base.get(p)!=sha]
missing=[p for p in base if p not in current]
assert not missing,missing
protected=[p for p in base if p.startswith(str(cli/'.local')+'/') or any('/docs/'+part+'/' in p for part in ['byor-qualification','byor-implementation','hook-qualification','blocker-resolution','deployment-preparation']) or p.endswith('PLAN.md') or ('/docs/ADAPTER_' in p)]
assert all(current[p]==base[p] for p in protected)
whitespace=[]
for entry in changed:
 p=Path(entry['path'])
 if p.name in ('preservation.json','changed-files.json'):continue
 try:text=p.read_text()
 except (UnicodeError,ValueError):continue
 # Only this task's new output logs are normalized; never prior evidence.
 if str(p).startswith(str(root)) and p.suffix=='.txt':
  cleaned='\n'.join(line.rstrip() for line in text.splitlines())+'\n'
  if cleaned!=text:p.write_text(cleaned);entry['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();text=cleaned
 if text and (not text.endswith('\n') or any(line.rstrip()!=line for line in text.splitlines())):whitespace.append(str(p))
# tsbuildinfo is compiler-owned JSON without a terminal newline.
whitespace=[p for p in whitespace if not p.endswith('tsconfig.tsbuildinfo')]
assert not whitespace,whitespace
for repo in [cli,cli.parent/'chert-facetime',cli.parent/'demo-agent-0']:
 subprocess.run(['git','diff','--check'],cwd=repo,check=True)
artifact=json.loads((root/'artifacts.json').read_text())
assert hashlib.sha256(Path(artifact['path']).read_bytes()).hexdigest()==artifact['sha256']
with tarfile.open(artifact['path']) as archive:
 members=[m for m in archive if m.isfile()]
 for member in members:
  assert archive.extractfile(member).read()==(cli/member.name.removeprefix('package/')).read_bytes(),member.name
changed=[r for r in changed if not r['path'].endswith(('/preservation.json','/changed-files.json'))]
(root/'changed-files.json').write_text(json.dumps(changed,indent=2)+'\n')
result=dict(baseline_files=len(base),historical_protected_files=len(protected),historical_unchanged=True,missing_files=missing,
 changed_files=len(changed),whitespace='pass (compiler tsbuildinfo excluded)',tracked_diff_checks='pass in all three repositories',tarball_members_match=len(members))
(root/'preservation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
