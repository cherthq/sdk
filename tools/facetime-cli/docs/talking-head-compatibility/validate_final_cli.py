import json, os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent;cli=root.parents[1];app=cli.parent/'demo-agent-0'
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
base={k:v for k,v in os.environ.items() if k in ('PATH','HOME','TMPDIR','LANG')};results=[]
for version,node in nodes.items():
 env={**base,'PATH':node+':'+nodes['22']+':'+base['PATH'],
 'CHERT_TALKING_HEAD_ROOT':str(app),'CHERT_TALKING_HEAD_PYTHON':str(app/'.local/receiver-venv/bin/python'),
 'CHERT_QUALIFICATION_TARBALL':str(cli/'.local/talking-head-compatibility/artifacts/chert-local-transport-proof-0.0.0.tgz')}
 for name,command in [('typecheck',['npm','run','typecheck']),('lint',['npm','run','lint']),('build',['npm','run','build']),
 ('full',['node','--test','--test-concurrency=1',*[str(p.relative_to(cli)) for category in ['transport','adapter','cli'] for p in sorted((cli/f'dist/tests/{category}').glob('*.test.js'))]])]:
  with (root/f'final-cli-{name}-node{version}.txt').open('w') as out:
   code=subprocess.run(command,cwd=cli,env=env,stdout=out,stderr=subprocess.STDOUT).returncode
  results.append(dict(node=version,check=name,exit_code=code));print(results[-1],flush=True)
  (root/'final-cli-matrix.json').write_text(json.dumps(results,indent=2)+'\n')
  if code:break
