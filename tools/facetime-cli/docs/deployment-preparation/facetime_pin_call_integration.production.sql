CREATE OR REPLACE FUNCTION public.facetime_pin_call_integration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare l public.facetime_lines%rowtype; e public.facetime_webhook_endpoints%rowtype;
 r public.facetime_integration_revisions%rowtype; policy text;
begin
 if tg_op='UPDATE' then
  if (new.id,new.project_id,new.line_id,new.worker_id) is distinct from (old.id,old.project_id,old.line_id,old.worker_id) then
   raise exception 'call_binding_immutable' using errcode='55000'; end if;
  if (new.integration_revision_id,new.integration_assignment_generation,new.resolved_inbound_policy,new.resolved_livekit_allowed_hosts,new.binding_disposition,
      new.incoming_request_id,new.incoming_request_created_at,new.incoming_decision_deadline_at,new.incoming_request_data)
   is distinct from (old.integration_revision_id,old.integration_assignment_generation,old.resolved_inbound_policy,old.resolved_livekit_allowed_hosts,old.binding_disposition,
      old.incoming_request_id,old.incoming_request_created_at,old.incoming_decision_deadline_at,old.incoming_request_data) then
    raise exception 'call_binding_immutable' using errcode='55000';
  end if;
  return new;
 end if;
 select * into l from public.facetime_lines where id=new.line_id and project_id=new.project_id for update;
 if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
 new.resolved_inbound_policy := l.inbound_policy;
 if new.assistant_version_id is not null then
  select config->>'inbound_policy' into policy from public.realtime_assistant_versions
   where id=new.assistant_version_id and project_id=new.project_id;
  if policy is not null then new.resolved_inbound_policy := policy::public.facetime_inbound_policy; end if;
 end if;
 if new.direction='inbound' and new.mode='managed' and new.resolved_inbound_policy='customer_decides' then
  raise exception 'ambiguous_decision_authority' using errcode='55000';
 end if;
 new.integration_assignment_generation := l.assignment_generation;
 new.binding_disposition := 'none'; new.integration_revision_id := null;
 select livekit_allowed_hosts into new.resolved_livekit_allowed_hosts from public.facetime_project_settings where project_id=new.project_id;
 new.resolved_livekit_allowed_hosts := coalesce(new.resolved_livekit_allowed_hosts,'{}'::text[]);
 if l.integration_id is not null then
  select * into e from public.facetime_webhook_endpoints where id=l.integration_id and project_id=new.project_id for update;
  select * into r from public.facetime_integration_revisions where id=e.active_revision_id and project_id=new.project_id;
  if e.enabled and r.id is not null then
   perform 1 from public.facetime_webhook_secret_versions where id=r.secret_version_id and revoked_at is null and retired_at is null;
   if found or not r.signing_enabled then new.integration_revision_id:=r.id; new.binding_disposition:='pinned'; new.resolved_livekit_allowed_hosts:=r.livekit_allowed_hosts; end if;
  end if;
 end if;
 if new.direction='inbound' and new.mode='customer_managed' and new.resolved_inbound_policy='customer_decides'
  and new.binding_disposition <> 'pinned' then
  raise exception 'integration_unavailable' using errcode='55000';
 end if;
 if new.direction='inbound' then
  new.incoming_request_id := gen_random_uuid();
  new.incoming_request_created_at := clock_timestamp();
  new.incoming_decision_deadline_at := coalesce(new.incoming_decision_deadline_at,new.incoming_request_created_at + interval '5 seconds');
  new.incoming_request_data := jsonb_build_object('call_id',new.id,'line_id',new.line_id,'media',new.media,
    'from_handle_hash',new.incoming_request_data->'from_handle_hash','occurred_at',coalesce(new.incoming_request_data->'occurred_at',to_jsonb(new.detected_at)));
 end if;
 return new;
end; $function$
;
