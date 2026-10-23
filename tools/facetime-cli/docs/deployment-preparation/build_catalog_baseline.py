"""Reconstruct public schema from read-only catalogs; no customer rows or ledger replay.
Auth is a deliberately minimal local stub, not a Supabase/Auth/PostgREST clone.
"""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
s=json.loads((root/'production-structure-catalog.json').read_text())[0]
f=json.loads((root/'production-schema-catalog.json').read_text())['functions']
def ident(v): return '"'+v.replace('"','""')+'"'
def literal(v): return "'"+v.replace("'","''")+"'"
lines=['-- Catalog-derived public schema. Synthetic auth fixture. LOCAL ONLY.',
 'set check_function_bodies=off;', 'create role anon; create role authenticated; create role service_role bypassrls;',
 'create schema auth; create schema extensions; create table auth.users(id uuid primary key, email text);',
 'create function auth.uid() returns uuid language sql as $$ select null::uuid $$;',
 "create function auth.role() returns text language sql as $$ select current_user::text $$;",
 "create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;"]
for e in s['enums']: lines.append('create type public.'+ident(e['name'])+' as enum ('+','.join(map(literal,e['labels']))+');')
for t in s['tables']:
 cols=[]
 for c in t['columns']:
  value=ident(c['name'])+' '+c['type']
  if c['identity']:value+=' generated '+('always' if c['identity']=='a' else 'by default')+' as identity'
  if c['notnull']:value+=' not null'
  cols.append(value)
 lines.append('create table public.'+ident(t['name'])+' ('+','.join(cols)+');')
for fn in f:lines.append(fn['definition']+';')
for t in s['tables']:
 for c in t['columns']:
  if c['default'] and not c['identity']:lines.append('alter table public.'+ident(t['name'])+' alter column '+ident(c['name'])+' set default '+c['default']+';')
for c in sorted((c for c in s['constraints'] if c['type']!='t'),key=lambda c:c['type']=='f'):
 lines.append('alter table public.'+ident(c['table'])+' add constraint '+ident(c['name'])+' '+c['definition']+';')
for idx in s['indexes']:lines.append(idx['definition']+';')
for t in s['triggers']:
 lines.append(t['definition']+';')
 if t['enabled']!='O':lines.append('alter table public.'+ident(t['table'])+' '+{'D':'disable','A':'enable always','R':'enable replica'}[t['enabled']]+' trigger '+ident(t['name'])+';')
for p in s['policies']:
 q='create policy '+ident(p['policyname'])+' on public.'+ident(p['tablename'])+' as '+p['permissive']+' for '+p['cmd']+' to '+','.join('public' if r=='public' else ident(r) for r in p['roles'])
 if p['qual']:q+=' using ('+p['qual']+')'
 if p['with_check']:q+=' with check ('+p['with_check']+')'
 lines.append(q+';')
priv={'a':'insert','r':'select','w':'update','d':'delete','D':'truncate','x':'references','t':'trigger','m':'maintain','X':'execute','U':'usage'}
def acl(kind,target,acls):
 if acls is None:return
 lines.append('revoke all on '+kind+' '+target+' from public,anon,authenticated,service_role;')
 for a in acls:
  role,tail=a.split('=',1);perm=tail.split('/')[0]
  for ch in perm:
   if ch=='*':continue
   lines.append('grant '+priv[ch]+' on '+kind+' '+target+' to '+(ident(role) if role else 'public')+(' with grant option' if ch+'*' in perm else '')+';')
for t in s['tables']:
 if t['rls']:lines.append('alter table public.'+ident(t['name'])+' enable row level security;')
 if t['force_rls']:lines.append('alter table public.'+ident(t['name'])+' force row level security;')
 acl('table','public.'+ident(t['name']),t['acl'])
for fn in s['function_acl']:acl('function','public.'+ident(fn['name'])+'('+fn['args']+')',fn['acl'])
lines.append('grant usage on schema public to anon,authenticated,service_role;')
(root/'production-public-baseline.sql').write_text('\n'.join(lines)+'\n')
print('Generated public schema:',len(s['tables']),'tables',len(f),'functions; no data, minimal auth stub')
