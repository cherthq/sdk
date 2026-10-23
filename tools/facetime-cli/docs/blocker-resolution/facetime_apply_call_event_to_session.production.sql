CREATE OR REPLACE FUNCTION public.facetime_apply_call_event_to_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.facetime_sessions%rowtype;
  v_failure_reason text;
begin
  if new.event_type='agent_connected' then
    update public.facetime_calls set media_status=jsonb_build_object('audio','ready','video',case when media->>'video'='true' then coalesce(media_status->>'video','pending') else 'disabled' end)
      where id=new.call_id and project_id=new.project_id and outbound_request_fingerprint is not null and status='active';
  end if;
  if new.event_type in ('ended','failed','rejected') then
    update public.facetime_calls set media_status=jsonb_build_object('audio','disconnected','video',case when media->>'video'='true' then 'disconnected' else 'disabled' end)
      where id=new.call_id and project_id=new.project_id and outbound_request_fingerprint is not null;
  end if;
  if new.event_type in ('remote_video_ready','remote_video_unavailable') then
    update public.facetime_calls set media_status=jsonb_set(media_status,'{video}',
      to_jsonb(case when new.event_type='remote_video_ready' then 'rendered'::text else 'unavailable'::text end))
      where id=new.call_id and project_id=new.project_id and outbound_request_fingerprint is not null
        and media->>'video'='true' and status='active';
  end if;
  if new.event_type = 'bridge_ready' then
    update public.facetime_sessions
    set state = 'active', active_at = new.occurred_at
    where call_id = new.call_id and project_id = new.project_id and state = 'dispatched';
  elsif new.event_type = 'ended' then
    update public.facetime_sessions set
      state = 'ended',
      ended_at = new.occurred_at,
      terminal_reason = new.terminal_reason,
      terminal_reason_detail = new.terminal_reason_detail
    where call_id = new.call_id and project_id = new.project_id and (state = 'active' or (state in ('created','dispatched') and exists(
        select 1 from public.facetime_calls c where c.id=new.call_id and c.direction='outbound')))
    returning * into v_session;
    if found then perform public.facetime_enqueue_session_stop(v_session); end if;
  elsif new.event_type in ('failed', 'rejected') then
    v_failure_reason := case
      when new.terminal_reason_detail = 'bridge_failed' then 'bridge_failed'
      else coalesce(new.terminal_reason, 'bridge_failed')
    end;
    update public.facetime_sessions set
      state = 'failed',
      failed_at = new.occurred_at,
      terminal_reason = v_failure_reason,
      terminal_reason_detail = new.terminal_reason_detail
    where call_id = new.call_id and project_id = new.project_id
      and state in ('created', 'dispatched', 'active')
    returning * into v_session;
    if found then perform public.facetime_enqueue_session_stop(v_session); end if;
  elsif new.event_type = 'cleanup_complete' then
    update public.facetime_sessions
    set state = 'cleaned', cleaned_at = new.occurred_at
    where call_id = new.call_id and project_id = new.project_id
      and state in ('ended', 'expired', 'failed');
  end if;
  return new;
end;
$function$
