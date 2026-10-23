import json,os,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent;cli=root.parents[1]
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
results=[]
for version,node in nodes.items():
 env={**os.environ,'PATH':node+':'+nodes['22']+':'+os.environ['PATH']}
 if version=='24':env.update(CHERT_TALKING_HEAD_ROOT='/Users/garygao/demo-agent-0',CHERT_TALKING_HEAD_PYTHON='/Users/garygao/demo-agent-0/.local/receiver-venv/bin/python',CHERT_QUALIFICATION_TARBALL=str(cli/'.local/byor-qualification/artifacts/chert-local-transport-proof-0.0.0.tgz'))
 # Node22's new installed integration already passed separately; do not repeat its 62s dwell.
 for check,cmd in [('typecheck',['npm','run','typecheck']),('lint',['npm','run','lint']),('full',['npm','test']),('transport',['npm','run','proof:transport'])]:
  start=time.monotonic()
  with (root/f'cli-{check}-node{version}.txt').open('w') as out:
   r=subprocess.run(cmd,cwd=cli,env=env,stdout=out,stderr=subprocess.STDOUT)
  results.append(dict(node=version,check=check,exit_code=r.returncode,seconds=round(time.monotonic()-start,2)))
  (root/'cli-matrix.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results[-1]),flush=True)
