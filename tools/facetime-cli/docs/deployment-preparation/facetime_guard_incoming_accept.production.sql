CREATE OR REPLACE FUNCTION public.facetime_guard_incoming_accept(p_project_id uuid, p_call_id uuid, p_source_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c public.facetime_calls%rowtype; r public.facetime_integration_revisions%rowtype; w public.facetime_workers%rowtype;
begin
 select * into c from public.facetime_calls where id=p_call_id and project_id=p_project_id for update;
 if not found or not exists(select 1 from public.facetime_call_events where project_id=p_project_id and call_id=p_call_id
  and source='worker' and source_event_id=p_source_event_id and event_type='incoming_registered') then
  raise exception 'call_not_found' using errcode='P0002'; end if;
 if c.incoming_webhook_decision is not null then return; end if;
 if c.mode <> 'customer_managed' or c.resolved_inbound_policy <> 'customer_decides' or c.binding_disposition <> 'pinned'
   or c.status <> 'incoming' or clock_timestamp() >= c.incoming_decision_deadline_at then
  raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
 select * into w from public.facetime_workers where id=c.worker_id;
 if w.automatic_readiness_enabled then
  select * into w from public.facetime_workers where id=c.worker_id for update;
 end if;
 if w.automatic_readiness_enabled and (not w.enabled or w.status <> 'accepting'
   or not public.facetime_worker_automatic_ready(w,clock_timestamp(),false)) then
  raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
 select * into r from public.facetime_integration_revisions where id=c.integration_revision_id and project_id=p_project_id;
 perform 1 from public.facetime_webhook_endpoints where id=r.integration_id and project_id=p_project_id for update;
 if clock_timestamp() >= c.incoming_decision_deadline_at then
  raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
 -- Re-evaluate after the endpoint lock: elapsed lock time cannot extend readiness.
 if w.automatic_readiness_enabled and not public.facetime_worker_automatic_ready(w,clock_timestamp(),false) then
  raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
 if r.signing_enabled and not exists(select 1 from public.facetime_webhook_secret_versions where id=r.secret_version_id and project_id=p_project_id and revoked_at is null) then
  raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
end; $function$
;
