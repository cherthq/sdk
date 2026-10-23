"""Build the undeployed connector SQL against the captured production functions.
Does not connect to any database. Fails if an expected source anchor changes.
"""
import re
from pathlib import Path
root=Path(__file__).resolve().parent
source=Path('/Users/garygao/chert-facetime/control-plane/supabase/migrations/20260929222047_connector_backend.sql')
s=source.read_text()
def once(s,a,b):
 assert s.count(a)==1,(a,s.count(a))
 return s.replace(a,b)
s=once(s,'if found then new.integration_revision_id:=r.id;', 'if found or not r.signing_enabled then new.integration_revision_id:=r.id;')
s=once(s,"'webhook_secret_ciphertext',s.ciphertext", "'webhook_signing_enabled',r.signing_enabled,'webhook_secret_ciphertext',s.ciphertext")
for name in ['facetime_enqueue_call_webhook','facetime_guard_incoming_accept']:
 prod=(root/(name+'.production.sql')).read_text().strip()
 if name=='facetime_enqueue_call_webhook':
  prod=once(prod,"if not found or v_call.binding_disposition='none'", "if not found or v_call.connector_owner is not null or v_call.binding_disposition='none'")
 else:
  prod=once(prod,' if c.incoming_webhook_decision is not null then return; end if;'," if c.connector_owner is not null then raise exception 'connector_decision_authority_required' using errcode='42501'; end if;\n if c.incoming_webhook_decision is not null then return; end if;")
 pattern=r'create or replace function public\.'+name+r'\([\s\S]*?end;\s*\$\$;'
 s,n=re.subn(pattern,lambda m:prod,s,count=1,flags=re.I);assert n==1,name
# Connector's separate decision path must also retain deployed automatic readiness.
s=once(s,'recovery boolean; frames jsonb;', 'w public.facetime_workers%rowtype; recovery boolean; frames jsonb;')
s=once(s,"  if p_input->>'action'='accept' then\n", """  if p_input->>'action'='accept' then
   select * into w from public.facetime_workers where id=c.worker_id;
   if w.automatic_readiness_enabled then
    select * into w from public.facetime_workers where id=c.worker_id for update;
    if not w.enabled or w.status<>'accepting' or not public.facetime_worker_automatic_ready(w,clock_timestamp(),false) then
     raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
   end if;
""")
s=once(s,"   if clock_timestamp()>=c.incoming_decision_deadline_at then raise exception 'connector_deadline' using errcode='55000'; end if;", """   if clock_timestamp()>=c.incoming_decision_deadline_at then raise exception 'connector_deadline' using errcode='55000'; end if;
   if w.automatic_readiness_enabled and not public.facetime_worker_automatic_ready(w,clock_timestamp(),false) then
    raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;""")
s='-- Release candidate: requires the captured 2026-09-30 production baseline.\n'+s
(root/'connector_backend.compatible.sql').write_text(s)
candidate=root.parent.parent/'.local/deployment-preparation/candidate/control-plane/supabase/migrations'/source.name
candidate.write_text(s)
print('Compatible migration prepared; original working tree migration unchanged')
