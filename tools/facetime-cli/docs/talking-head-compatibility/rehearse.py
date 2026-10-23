"""Rehearse additive media change against preserved newer candidate, never prod."""
import json, os, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent
historical=root.parent/'deployment-preparation'
pg=Path((historical/'postgres-runtime-path.txt').read_text().strip())
extension=(root.parents[2]/'chert-facetime/control-plane/supabase/migrations/20260930043204_connector_byor_video.sql').read_text()
with tempfile.TemporaryDirectory(prefix='th-media-pg-') as directory:
 directory=Path(directory);env={'PATH':os.environ['PATH'],'LC_ALL':'C','HOME':str(directory)}
 def run(name,*args,input=None,check=True):
  r=subprocess.run([str(pg/name),*map(str,args)],input=input,text=True,capture_output=True,env=env)
  if check and r.returncode:raise RuntimeError(r.stderr)
  return r
 def sql(text,check=True):return run('psql','-X','-h',directory,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=text,check=check)
 run('initdb','-D',directory/'data','-A','trust','--no-locale','-U','postgres')
 run('pg_ctl','-D',directory/'data','-l',directory/'log','-o',"-h '' -k "+str(directory),'-w','start')
 try:
  sql((historical/'production-public-baseline.sql').read_text())
  history=json.loads((root.parent/'byor-qualification/fresh-schema-columns-history.json').read_text())['history']
  sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text,name text);'+''.join(
   "insert into supabase_migrations.schema_migrations values('"+x['version']+"','"+x['name'].replace("'","''")+"');" for x in history))
  sql('begin;'+(root.parent/'byor-qualification/migration.payload.sql').read_text()+'commit;')
  query="select pg_get_functiondef('public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure)"
  original=sql(query).stdout
  shared="select proname,md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname in ('facetime_pin_call_integration','facetime_pinned_incoming_context','facetime_guard_incoming_accept','facetime_enqueue_call_webhook','facetime_apply_call_event_to_session') order by proname"
  before=sql(shared).stdout
  failed=sql('begin;'+extension+'select 1/0;commit;',False)
  assert failed.returncode and 'division by zero' in failed.stderr
  assert sql(query).stdout==original
  sql('begin;'+extension+'commit;')
  current=sql(query).stdout
  old='if c.media<>\'{"audio":true,"video":false}\'::jsonb then raise exception \'connector_media_unsupported\' using errcode=\'55000\'; end if;'
  new='''if c.media not in ('{"audio":true,"video":false}'::jsonb,'{"audio":true,"video":true}'::jsonb)
      or (b.session_mode<>'byor' and c.media<>'{"audio":true,"video":false}'::jsonb)
     then raise exception 'connector_media_unsupported' using errcode='55000'; end if;'''
  assert original.replace(old,new)==current
  assert sql(shared).stdout==before
  assert sql("select has_function_privilege('service_role','facetime_connector_runtime_pre_byor(text,text,jsonb)','execute')").stdout.strip()=='f'
  assert sql("select has_function_privilege('anon','facetime_connector_runtime(text,text,jsonb)','execute')").stdout.strip()=='f'
  repeat=sql('begin;'+extension+'commit;',False)
  assert repeat.returncode and 'connector_media_preimage_mismatch' in repeat.stderr
  result=dict(postgres=sql('show server_version').stdout.strip(),apply=True,rollback=True,repeat_rejected=True,
   five_shared_functions_unchanged=True,delegate_only_media_guard_changed=True,permissions_preserved=True,
   source='preserved byor-qualification candidate + recorded schema catalog; no fresh production access')
  (root/'candidate-rehearsal.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 finally:run('pg_ctl','-D',directory/'data','-m','immediate','-w','stop')
