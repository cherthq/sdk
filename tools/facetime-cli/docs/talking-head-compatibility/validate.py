import os, json, subprocess, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parent
cli=root.parents[1]; cp=cli.parent/'chert-facetime/control-plane'; app=cli.parent/'demo-agent-0'
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
python=str(app/'.local/receiver-venv/bin/python')
base={k:v for k,v in os.environ.items() if k in ('HOME','PATH','TMPDIR','LANG')}
results=[]
def matrix(version):
 env={**base,'PATH':nodes[version]+':'+nodes['22']+':'+base['PATH'],'NEXT_TELEMETRY_DISABLED':'1',
 'CHERT_TALKING_HEAD_ROOT':str(app),'CHERT_TALKING_HEAD_PYTHON':python,
 'CHERT_QUALIFICATION_TARBALL':str(cli/'.local/talking-head-compatibility/artifacts/chert-local-transport-proof-0.0.0.tgz'),
 'CHERT_TEST_POSTGRES_BIN':'/opt/homebrew/opt/postgresql@15/bin','CHERT_TEST_CLI_ROOT':str(cli),
 'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:54321','NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon-key',
 'SUPABASE_SERVICE_ROLE_KEY':'synthetic-service-key'}
 tasks=[('cli-typecheck',['npm','run','typecheck'],cli),('cli-lint',['npm','run','lint'],cli),('cli-build',['npm','run','build'],cli),
 ('cli-full',['node','--test','--test-concurrency=1','dist/tests/transport/*.test.js','dist/tests/adapter/*.test.js','dist/tests/cli/*.test.js'],cli),
 ('cli-proof',['npm','run','proof:transport'],cli),
 ('backend-typecheck',['npm','run','typecheck'],cp),('backend-lint',['npm','run','lint'],cp),
 ('backend-tests',['npm','test'],cp),('backend-build',['npm','run','build'],cp),
 ('demo-node',['npm','test'],app),('relay',['npm','test'],cp.parent/'connector-relay')]
 for name,cmd,cwd in tasks:
  # Expand node test globs explicitly (no shell, supported on both runtimes).
  command=[]
  for arg in cmd:
   command.extend(sorted(str(p.relative_to(cwd)) for p in cwd.glob(arg)) if '*' in arg else [arg])
  start=time.monotonic()
  with (root/f'{name}-node{version}.txt').open('w') as out:
   code=subprocess.run(command,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT).returncode
  record=dict(node=version,check=name,exit_code=code,seconds=round(time.monotonic()-start,2))
  results.append(record);(root/'matrix.json').write_text(json.dumps(results,indent=2)+'\n');print(record,flush=True)
  if code: return
# Run runtime versions sequentially: shared tsc/Next output directories.
for version in nodes: matrix(version)
env={**base,'PYTHONPATH':str(app/'receiver/src')+':'+str(app/'connector')}
for name,cmd in [('python-full',[python,'-m','pytest','receiver/tests','connector/tests','-q']),('python-lint',[python,'-m','ruff','check','receiver/src','receiver/tests','connector'])]:
 with (root/f'{name}.txt').open('w') as out: code=subprocess.run(cmd,cwd=app,env=env,stdout=out,stderr=subprocess.STDOUT).returncode
 results.append(dict(check=name,exit_code=code));print(results[-1],flush=True)
(root/'matrix.json').write_text(json.dumps(results,indent=2)+'\n')
