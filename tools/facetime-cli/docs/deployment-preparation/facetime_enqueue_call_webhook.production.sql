CREATE OR REPLACE FUNCTION public.facetime_enqueue_call_webhook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_endpoint public.facetime_integration_revisions%rowtype;
  v_secret public.facetime_webhook_secret_versions%rowtype;
  v_call public.facetime_calls%rowtype;
  v_type text;
  v_event_id uuid := gen_random_uuid();
  v_created_at timestamptz := new.created_at;
  v_data jsonb;
  v_body jsonb;
begin
  v_type := case new.event_type
    when 'active' then case when exists(select 1 from public.facetime_calls where id=new.call_id and outbound_request_fingerprint is not null) then null else 'call.started' end
    when 'bridge_ready' then case when exists(select 1 from public.facetime_calls where id=new.call_id and outbound_request_fingerprint is not null) then 'call.started' else null end
    when 'ended' then 'call.ended'
    when 'failed' then 'call.failed'
    when 'rejected' then 'call.failed'
    else null
  end;
  if v_type is null then return new; end if;
  if exists(select 1 from public.facetime_webhook_events where project_id=new.project_id and call_id=new.call_id and logical_transition=v_type) then
    return new;
  end if;

  select * into v_call from public.facetime_calls where id=new.call_id and project_id=new.project_id;
  if not found or v_call.binding_disposition='none' then return new; end if;
  if v_call.binding_disposition='legacy_unresolved' then
    perform public.facetime_record_blocked_delivery(new.project_id,new.call_id,v_type,'legacy_unresolved');
    return new;
  end if;
  select * into v_endpoint from public.facetime_integration_revisions
    where id=v_call.integration_revision_id and project_id=new.project_id;
  select * into v_secret from public.facetime_webhook_secret_versions
    where id=v_endpoint.secret_version_id and project_id=new.project_id;
  if v_secret.revoked_at is not null then
    perform public.facetime_record_blocked_delivery(new.project_id,new.call_id,v_type,'signing_version_revoked');
    return new;
  end if;

  v_data := jsonb_build_object(
    'call_id', v_call.id,
    'line_id', v_call.line_id,
    'media', v_call.media
  );
  if v_type = 'call.started' then
    v_data := v_data || jsonb_build_object('started_at', v_call.answered_at);
  elsif v_type = 'call.ended' then
    v_data := v_data || jsonb_build_object(
      'ended_at', v_call.ended_at,
      'duration_seconds', case when v_call.ended_at is not null and v_call.active_at is not null
        then floor(extract(epoch from (v_call.ended_at - v_call.active_at)))::integer else null end,
      'reason', coalesce(new.terminal_reason, v_call.terminal_reason, 'unknown')
    );
  else
    v_data := v_data || jsonb_build_object(
      'ended_at', v_call.ended_at,
      'reason', coalesce(new.terminal_reason, v_call.terminal_reason, 'unknown')
    );
  end if;
  v_body := jsonb_build_object(
    'event_id', v_event_id,
    'type', v_type,
    'created_at', v_created_at,
    'data', v_data
  );

  insert into public.facetime_webhook_events (
    event_id, project_id, call_id, source_call_event_id, endpoint_id,
    endpoint_url, secret_version_id, secret_version, event_type,
    logical_transition, payload, raw_body, created_at, next_attempt_at
  ) values (
    v_event_id, new.project_id, new.call_id, new.id, v_endpoint.integration_id,
    v_endpoint.endpoint_url, v_secret.id, v_secret.version, v_type, v_type, v_body,
    v_body::text, v_created_at, v_created_at
  ) on conflict (project_id, call_id, logical_transition)
    where logical_transition is not null do nothing;
  return new;
end;
$function$
;
