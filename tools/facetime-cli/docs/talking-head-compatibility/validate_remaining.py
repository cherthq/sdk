import json, os, subprocess, time
from pathlib import Path
root=Path(__file__).resolve().parent;cli=root.parents[1];app=cli.parent/'demo-agent-0'
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
base={k:v for k,v in os.environ.items() if k in ('PATH','HOME','TMPDIR','LANG')};results=[]
for version,node in nodes.items():
 env={**base,'PATH':node+':'+nodes['22']+':'+base['PATH']}
 for name,command,cwd in [('demo-check',['npm','run','check'],app),('relay',['npm','test'],cli.parent/'chert-facetime/connector-relay')]:
  start=time.monotonic()
  with (root/f'{name}-node{version}.txt').open('w') as out:
   code=subprocess.run(command,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT).returncode
  results.append(dict(node=version,check=name,exit_code=code,seconds=round(time.monotonic()-start,2)));print(results[-1],flush=True)
(root/'remaining-matrix.json').write_text(json.dumps(results,indent=2)+'\n')
