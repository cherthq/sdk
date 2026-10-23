"""Compare old checkout SQL replay with live catalogs. Replay is not production proof."""
import os,subprocess,tempfile,json,shutil
from pathlib import Path
root=Path(__file__).resolve().parent;bin=Path('/opt/homebrew/opt/postgresql@15/bin');tmp=Path(tempfile.mkdtemp(prefix='chert-compare-pg-'))
env={'PATH':os.environ['PATH'],'LC_ALL':'C','HOME':str(tmp)}
def run(cmd,*args,input=None):
 r=subprocess.run([str(bin/cmd),*map(str,args)],input=input,text=True,capture_output=True,env=env)
 if r.returncode: raise RuntimeError(r.stderr)
 return r
def sql(q):return run('psql','-X','-h',tmp,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At',input=q).stdout
started=False
try:
 run('initdb','-D',tmp/'data','-A','trust','--no-locale','-U','postgres');run('pg_ctl','-D',tmp/'data','-l',tmp/'log','-o',"-h '' -k "+str(tmp),'-w','start');started=True
 sql('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema extensions; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;')
 for p in sorted(Path('/Users/garygao/chert-facetime/control-plane/supabase/migrations').glob('*.sql')):
  if p.name=='20260929222047_connector_backend.sql':continue
  sql(p.read_text())
 local=json.loads(sql("select json_agg(json_build_object('table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public';"))
 prod=json.loads((root/'production-schema-catalog.json').read_text())['columns'];key=lambda x:(x['table'],x['column']);l={key(x):x for x in local};p={key(x):x for x in prod}
 delta={'production_only_columns':[p[x] for x in p.keys()-l.keys()],'local_only_columns':[l[x] for x in l.keys()-p.keys()],'different_columns':[{'production':p[x],'local':l[x]} for x in p.keys()&l.keys() if p[x]!=l[x]]}
 for k in delta:delta[k].sort(key=lambda x:json.dumps(x,sort_keys=True))
 (root/'column-discrepancies.json').write_text(json.dumps(delta,indent=2)+'\n');print({k:len(v) for k,v in delta.items()})
finally:
 if started:run('pg_ctl','-D',tmp/'data','-m','immediate','-w','stop')
 shutil.rmtree(tmp)
