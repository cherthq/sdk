"""Read historical schema artifacts; rehearse only in a new Unix-socket database."""
import os, subprocess, tempfile, json, shutil
from pathlib import Path
root=Path(__file__).resolve().parent
historical=root.parent/'deployment-preparation'
bin=Path((historical/'postgres-runtime-path.txt').read_text().strip())
tmp=Path(tempfile.mkdtemp(prefix='chert-byor-pg-'))
env={'PATH':os.environ['PATH'],'LC_ALL':'C','HOME':str(tmp)}
def run(command,*args,input=None,check=True):
 result=subprocess.run([str(bin/command),*map(str,args)],input=input,text=True,capture_output=True,env=env)
 if check and result.returncode: raise RuntimeError(result.stderr)
 return result
def sql(q,check=True):return run('psql','-X','-h',tmp,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=q,check=check)
started=False
try:
 run('initdb','-D',tmp/'data','-A','trust','--no-locale','-U','postgres')
 run('pg_ctl','-D',tmp/'data','-l',tmp/'log','-o',"-h '' -k "+str(tmp),'-w','start');started=True
 sql((historical/'production-public-baseline.sql').read_text())
 sql('begin;\n'+(root.parent/'blocker-resolution/migration.payload.sql').read_text()+'\ncommit;')
 shared="select proname,md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname in ('facetime_pin_call_integration','facetime_pinned_incoming_context','facetime_guard_incoming_accept','facetime_enqueue_call_webhook','facetime_apply_call_event_to_session') order by proname;"
 before=sql(shared).stdout
 runtime=sql("select md5(prosrc) from pg_proc where oid='public.facetime_connector_runtime(text,text,jsonb)'::regprocedure").stdout
 addition=(Path('/Users/garygao/chert-facetime/control-plane/supabase/migrations/20260930033750_connector_byor_mode.sql')).read_text()
 rejected=sql('begin;\n'+addition+'\nselect 1/0;\ncommit;',False)
 assert rejected.returncode!=0 and 'division by zero' in rejected.stderr
 assert sql("select count(*) from information_schema.columns where table_name='facetime_connector_bindings' and column_name='session_mode'").stdout.strip()=='0'
 assert sql("select to_regprocedure('public.facetime_connector_runtime_pre_byor(text,text,jsonb)') is null").stdout.strip()=='t'
 sql('begin;\n'+addition+'\ncommit;')
 assert sql(shared).stdout==before
 assert sql("select md5(prosrc) from pg_proc where oid='public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure").stdout==runtime
 assert sql("select has_function_privilege('service_role','public.facetime_connector_runtime_pre_byor(text,text,jsonb)','execute')").stdout.strip()=='f'
 for role in ['anon','authenticated']:
  assert sql(f"select has_function_privilege('{role}','public.facetime_connector_runtime(text,text,jsonb)','execute')").stdout.strip()=='f'
 assert sql("select has_function_privilege('service_role','public.facetime_connector_runtime(text,text,jsonb)','execute')").stdout.strip()=='t'
 assert sql('select count(*) from facetime_connector_bindings;').stdout.strip()=='0'
 result={'postgres':run('postgres','--version').stdout.strip(),'baseline':'recorded production catalog + preserved blocker-resolution payload','byor_extension_applied':True,'forced_late_failure_rolls_back_column_functions_and_rename':True,'five_shared_function_bodies_unchanged':True,'automatic_readiness_runtime_body_preserved':True,'delegated_runtime_not_callable_by_service_role':True,'public_and_authenticated_execute_denied':True,'no_enrollment_or_routing':True,'production_access':False,'candidate_artifacts_modified':False}
 (root/'candidate-rehearsal.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
finally:
 if started:run('pg_ctl','-D',tmp/'data','-m','immediate','-w','stop')
 shutil.rmtree(tmp)
