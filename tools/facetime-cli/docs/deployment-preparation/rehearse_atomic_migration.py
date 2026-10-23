"""LOCAL ONLY. Creates a disposable Unix-socket cluster; never reads database URLs."""
import os,subprocess,tempfile,json,shutil
from pathlib import Path
root=Path(__file__).resolve().parent
bin=Path((root/'postgres-runtime-path.txt').read_text().strip())
tmp=Path(tempfile.mkdtemp(prefix='chert-release-pg-'))
env={'PATH':os.environ['PATH'],'LC_ALL':'C','HOME':str(tmp)}
def run(cmd,*args,input=None,check=True):
 r=subprocess.run([str(bin/cmd),*map(str,args)],input=input,text=True,capture_output=True,env=env)
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
def sql(q,check=True):return run('psql','-X','-h',tmp,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=q,check=check)
started=False
try:
 run('initdb','-D',tmp/'data','-A','trust','--no-locale','-U','postgres')
 run('pg_ctl','-D',tmp/'data','-l',tmp/'log','-o',"-h '' -k "+str(tmp),'-w','start');started=True
 baseline=(root/'production-public-baseline.sql').read_text();sql(baseline)
 # Schema-only catalog is captured before applying anything, for explicit comparison.
 query="select table_name,column_name from information_schema.columns where table_schema='public' order by 1,ordinal_position;"
 (root/'restored-baseline-columns.txt').write_text(sql(query).stdout)
 payload=(root/'migration.payload.sql').read_text()
 # Force a late failure to prove new objects and replaced functions roll back together.
 before=sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';").stdout
 rejected=sql('begin;\n'+payload+"\nselect 1/0;\ncommit;",False)
 assert rejected.returncode!=0 and 'division by zero' in rejected.stderr
 assert sql("select to_regclass('public.facetime_connector_bindings') is null;").stdout.strip()=='t'
 after=sql("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';").stdout
 assert before==after
 # Drift rejection precedes creation.
 sql("comment on function facetime_pin_call_integration() is 'local fixture';")
 original=next(f['definition'] for f in json.loads((root/'production-schema-catalog.json').read_text())['functions'] if f['name']=='facetime_pin_call_integration')
 sql(original.replace('begin','begin\n -- synthetic drift',1)+';')
 rejected=sql('begin;\n'+payload+'\ncommit;',False);assert 'deployed_function_drift' in rejected.stderr
 sql(original+';')
 sql('begin;\n'+payload+'\ncommit;')
 assert sql('select count(*) from facetime_connector_bindings;').stdout.strip()=='0'
 assert sql('select count(*) from facetime_connector_deliveries;').stdout.strip()=='0'
 rejected=sql('begin;\n'+payload+'\ncommit;',False);assert 'connector_already_present' in rejected.stderr
 result={'postgres':run('postgres','--version').stdout.strip(),'baseline':'production catalog public schema; synthetic auth stub; no rows','late_failure_atomic_rollback':True,'shared_function_rollback':True,'function_drift_rejected':True,'migration_applied_once':True,'repeat_rejected':True,'bindings_created':0,'deliveries_created':0,'production_access':False}
 (root/'atomic-rehearsal.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
finally:
 if started:run('pg_ctl','-D',tmp/'data','-m','immediate','-w','stop')
 shutil.rmtree(tmp)
