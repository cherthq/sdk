import json,os,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent
cli=root.parents[1]
cp=cli/'.local/deployment-release/candidate/control-plane'
pg=(root.parent/'deployment-preparation/postgres-runtime-path.txt').read_text().strip()
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
results=[]
for version,node in nodes.items():
 env={**{k:v for k,v in os.environ.items() if k in ('PATH','HOME','TMPDIR','LANG')},'PATH':node+':'+nodes['22']+':'+os.environ['PATH'],
      'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:54321','NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon-key',
      'SUPABASE_SERVICE_ROLE_KEY':'synthetic-service-key','CHERT_TEST_POSTGRES_BIN':pg,
      'CHERT_TEST_CATALOG_BASELINE':str(root.parent/'deployment-preparation/production-public-baseline.sql'),
      'CHERT_TEST_CLI_ROOT':str(cli),'NEXT_TELEMETRY_DISABLED':'1','CHERT_TALKING_HEAD_ROOT':str(cli/'.local/deployment-release/application'),'CHERT_TALKING_HEAD_PYTHON':'/Users/garygao/demo-agent-0/.local/receiver-venv/bin/python','CHERT_QUALIFICATION_TARBALL':str(cli/'.local/deployment-release/artifacts/chert-local-transport-proof-0.0.0.tgz')}
 for name,cmd,cwd in [
  ('typecheck',['npm','run','typecheck'],cp),('lint',['npm','run','lint'],cp),('build',['npm','run','build'],cp),
  ('backend',['npm','test','--','tests/connectors.test.ts','tests/connector-service.test.ts','tests/connector-incoming.test.ts','tests/connector-production-compatibility.test.ts','tests/session-cleanup-ordering.test.ts','tests/optional-signing.test.ts','tests/automatic-readiness.test.ts'],cp),
  ('relay',['npm','test'],cp.parent/'connector-relay'),
  ('installed-application',['node','--test','--test-name-pattern=installed package claims actual production-policy','dist/tests/cli/talking-head-package.test.js'],cli)]:
  started=time.monotonic()
  with (root/f'{name}-node{version}.txt').open('w') as out:
   result=subprocess.run(cmd,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT)
  record=dict(node=version,check=name,exit_code=result.returncode,seconds=round(time.monotonic()-started,2))
  results.append(record);print(json.dumps(record),flush=True)
  (root/'candidate-matrix.json').write_text(json.dumps(results,indent=2)+'\n')
