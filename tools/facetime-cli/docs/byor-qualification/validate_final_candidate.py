import json,os,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent
cli=root.parents[1]
cp=cli/'.local/byor-qualification/candidate/control-plane'
pg=(root.parent/'deployment-preparation/postgres-runtime-path.txt').read_text().strip()
nodes={'22':'/Users/garygao/.nvm/versions/node/v22.23.2/bin','24':'/Users/garygao/.npm/_npx/3e062c1ecdbab29f/node_modules/node/bin'}
results=[]
for version,node in nodes.items():
 env={**os.environ,'PATH':node+':'+nodes['22']+':'+os.environ['PATH'],
      'NEXT_PUBLIC_SUPABASE_URL':'http://127.0.0.1:54321','NEXT_PUBLIC_SUPABASE_ANON_KEY':'synthetic-anon-key',
      'SUPABASE_SERVICE_ROLE_KEY':'synthetic-service-key','CHERT_TEST_POSTGRES_BIN':pg,
      'CHERT_TEST_CATALOG_BASELINE':str(root.parent/'deployment-preparation/production-public-baseline.sql'),
      'CHERT_TEST_CLI_ROOT':str(cli),'NEXT_TELEMETRY_DISABLED':'1'}
 for name,cmd,cwd in [
  ('typecheck',['npm','run','typecheck'],cp),('lint',['npm','run','lint'],cp),('build',['npm','run','build'],cp),
  ('backend',['npm','test','--','tests/connectors.test.ts','tests/connector-service.test.ts','tests/connector-incoming.test.ts','tests/connector-production-compatibility.test.ts','tests/session-cleanup-ordering.test.ts','tests/optional-signing.test.ts','tests/automatic-readiness.test.ts'],cp),
  ('relay',['npm','test'],cp.parent/'connector-relay')]:
  started=time.monotonic()
  with (root/f'final-{name}-node{version}.txt').open('w') as out:
   result=subprocess.run(cmd,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT)
  record=dict(node=version,check=name,exit_code=result.returncode,seconds=round(time.monotonic()-started,2))
  results.append(record);print(json.dumps(record),flush=True)
  (root/'final-candidate-matrix.json').write_text(json.dumps(results,indent=2)+'\n')
