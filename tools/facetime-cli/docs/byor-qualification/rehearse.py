"""Build/rehearse one guarded payload in a disposable PG17.6 Unix-socket cluster."""
import os, subprocess, tempfile, json, shutil
from pathlib import Path
root=Path(__file__).resolve().parent
historical=root.parent/'deployment-preparation'
candidate=root.parents[1]/'.local/byor-qualification/candidate'
bin=Path((historical/'postgres-runtime-path.txt').read_text().strip())
tmp=Path(tempfile.mkdtemp(prefix='chert-byor-release-pg-'))
env={'PATH':os.environ['PATH'],'LC_ALL':'C','HOME':str(tmp)}
def run(command,*args,input=None,check=True):
 result=subprocess.run([str(bin/command),*map(str,args)],input=input,text=True,capture_output=True,env=env)
 if check and result.returncode: raise RuntimeError(result.stderr)
 return result
def sql(q,check=True):return run('psql','-X','-h',tmp,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=q,check=check)
columns="select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'nullable',case when a.attnotnull then 'NO' else 'YES' end,'default',pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r'"
history="select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations"
def literal(obj): return "'"+json.dumps(obj,separators=(',',':')).replace("'","''")+"'::jsonb"
observed=json.loads((root/'fresh-schema-columns-history.json').read_text())
shared="select proname,md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname in ('facetime_pin_call_integration','facetime_pinned_incoming_context','facetime_guard_incoming_accept','facetime_enqueue_call_webhook','facetime_apply_call_event_to_session') order by proname;"
started=False
try:
 run('initdb','-D',tmp/'data','-A','trust','--no-locale','-U','postgres')
 run('pg_ctl','-D',tmp/'data','-l',tmp/'log','-o',"-h '' -k "+str(tmp),'-w','start');started=True
 sql((historical/'production-public-baseline.sql').read_text())
 assert json.loads(sql(columns).stdout)==observed['columns'], 'recorded_catalog_columns_changed'
 # Local ledger fixture only; never alters or replays real migration history.
 sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text,name text);'+''.join(
  "insert into supabase_migrations.schema_migrations values('"+x['version']+"','"+x['name'].replace("'","''")+"');" for x in observed['history']))
 base=(root.parent/'blocker-resolution/migration.payload.sql').read_text()
 extension=(candidate/'control-plane/supabase/migrations/20260930033750_connector_byor_mode.sql').read_text()
 runtime="select md5(pg_get_functiondef('public.facetime_connector_runtime(text,text,jsonb)'::regprocedure))"
 # The expected post-base preimage is derived from preserved candidate, not prod.
 text=sql('begin;'+base+'\n'+runtime+';\nrollback;').stdout
 expected=next(line for line in text.splitlines() if len(line)==32 and all(c in '0123456789abcdef' for c in line))
 startguard="""-- Single transaction via approved migration transport. NOT a db-push/history replay.
-- Fresh column/history guards plus original shared function guards; no row repair.
do $catalog$ begin
if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'missing_migration_history'; end if;
"""+f"if ({history}) is distinct from {literal(observed['history'])} then raise exception 'migration_history_drift'; end if;\n"+f"if ({columns}) is distinct from {literal(observed['columns'])} then raise exception 'production_column_drift'; end if;\nend $catalog$;\n"
 extensionguard="""do $mode_guard$ begin
if exists(select 1 from information_schema.columns where table_schema='public' and table_name='facetime_connector_bindings' and column_name='session_mode')
 or to_regprocedure('public.facetime_connector_runtime_pre_byor(text,text,jsonb)') is not null then raise exception 'byor_extension_already_present'; end if;
"""+f"if ({runtime}) <> '{expected}' then raise exception 'connector_runtime_drift'; end if;\nend $mode_guard$;\n"
 payload=startguard+base+'\n'+extensionguard+extension
 (root/'migration.payload.sql').write_text(payload)
 before=sql(shared).stdout
 failed=sql('begin;'+payload+'\nselect 1/0;commit;',False)
 assert failed.returncode and 'division by zero' in failed.stderr
 assert sql(shared).stdout==before
 assert sql("select to_regclass('public.facetime_connector_bindings') is null and to_regprocedure('public.facetime_connector_runtime_pre_byor(text,text,jsonb)') is null").stdout.strip()=='t'
 # Every guard independently rejects with no committed connector objects.
 drift=[]
 for function in ['facetime_pin_call_integration','facetime_pinned_incoming_context','facetime_guard_incoming_accept','facetime_enqueue_call_webhook','facetime_apply_call_event_to_session']:
  definition=next(f['definition'] for f in json.loads((historical/'production-schema-catalog.json').read_text())['functions'] if f['name']==function)
  sql(definition.replace('begin','begin\n -- qualification drift',1)+';')
  rejected=sql('begin;'+payload+'commit;',False)
  assert ('deployed_function_drift: '+function) in rejected.stderr
  sql(definition+';');drift.append(function)
 for setup,restore,reason in [
  ('alter table facetime_projects add column qualification_drift boolean;','alter table facetime_projects drop column qualification_drift;','production_column_drift'),
  ("insert into supabase_migrations.schema_migrations values('synthetic','drift');","delete from supabase_migrations.schema_migrations where version='synthetic';",'migration_history_drift')]:
  sql(setup);rejected=sql('begin;'+payload+'commit;',False);assert reason in rejected.stderr;sql(restore);drift.append(reason)
 # Extension drift aborts the same transaction, including base objects.
 changed=payload.replace(extensionguard,"create or replace function public.facetime_connector_runtime(p_hash text,p_action text,p_input jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;\n"+extensionguard)
 rejected=sql('begin;'+changed+'commit;',False);assert 'connector_runtime_drift' in rejected.stderr, rejected.stderr
 assert sql("select to_regclass('public.facetime_connector_bindings') is null").stdout.strip()=='t'
 sql('begin;'+base+'commit;'); shared_after_base=sql(shared).stdout
 sql('begin;'+extensionguard+extension+'commit;')
 assert sql(shared).stdout==shared_after_base
 assert sql("select md5(pg_get_functiondef('public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure))").stdout.strip()!=expected # rename changes definition only
 # Compare bodies independently of renamed function name.
 installed_body=sql("select md5(prosrc) from pg_proc where oid='public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure").stdout.strip()
 assert sql("select has_function_privilege('service_role','public.facetime_connector_runtime_pre_byor(text,text,jsonb)','execute')").stdout.strip()=='f'
 for role in ['anon','authenticated']:
  assert sql(f"select has_function_privilege('{role}','public.facetime_connector_runtime(text,text,jsonb)','execute') or has_function_privilege('{role}','public.facetime_connector_manage(uuid,uuid,text,jsonb)','execute')").stdout.strip()=='f'
  for table in ['facetime_connector_bindings','facetime_connector_deliveries']:
   assert sql(f"select has_table_privilege('{role}','public.{table}','select,insert,update,delete')").stdout.strip()=='f'
 assert sql("select has_function_privilege('service_role','public.facetime_connector_runtime(text,text,jsonb)','execute')").stdout.strip()=='t'
 assert sql("select bool_and(relrowsecurity) from pg_class where oid in ('facetime_connector_bindings'::regclass,'facetime_connector_deliveries'::regclass)").stdout.strip()=='t'
 assert sql('select count(*) from facetime_connector_bindings;').stdout.strip()=='0'
 # Full reset and actual COMBINED successful transaction, not only split rehearsal.
 sql('drop schema public cascade;create schema public;drop schema auth cascade;drop schema extensions cascade;drop schema supabase_migrations cascade;')
 # Baseline contains role creation; retain roles and strip only those fixture lines.
 baseline=(historical/'production-public-baseline.sql').read_text()
 baseline='\n'.join(line for line in baseline.splitlines() if not line.startswith('create role '))
 sql(baseline)
 sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text,name text);'+''.join(
  "insert into supabase_migrations.schema_migrations values('"+x['version']+"','"+x['name'].replace("'","''")+"');" for x in observed['history']))
 sql('begin;'+payload+'commit;')
 assert sql(shared).stdout==shared_after_base
 assert sql("select md5(prosrc) from pg_proc where oid='public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure").stdout.strip()==installed_body
 assert sql('select count(*) from facetime_connector_bindings;select count(*) from facetime_connector_deliveries;').stdout.strip()=='0\n0'
 rejected=sql('begin;'+payload+'commit;',False);assert rejected.returncode
 result=dict(postgres=run('postgres','--version').stdout.strip(),recorded_full_catalog=True,fresh_columns_match=True,fresh_ledger_records=40,
  combined_atomic_apply=True,forced_late_failure_rolls_back_everything=True,drift_rejections=drift+['connector_runtime_drift'],
  shared_functions_unchanged_by_extension=True,automatic_readiness_runtime_preserved=True,permissions_and_rls_pass=True,
  repeat_rejected=True,bindings=0,deliveries=0,production_changes=False)
 (root/'atomic-rehearsal.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
finally:
 if started:run('pg_ctl','-D',tmp/'data','-m','immediate','-w','stop')
 shutil.rmtree(tmp)
