-- Catalog-derived public schema. Synthetic auth fixture. LOCAL ONLY.
set check_function_bodies=off;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function auth.role() returns text language sql as $$ select current_user::text $$;
create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
create type public."facetime_assistant_status" as enum ('draft','active','paused','archived');
create type public."facetime_worker_status" as enum ('development','accepting','draining','offline');
create type public."facetime_line_status" as enum ('available','busy','draining','offline');
create type public."facetime_inbound_policy" as enum ('auto_answer','customer_decides','agent_decides','auto_reject');
create type public."facetime_call_direction" as enum ('inbound','outbound');
create type public."facetime_call_mode" as enum ('managed','customer_managed');
create type public."facetime_call_status" as enum ('queued','incoming','allocating','agent_preparing','answering','dialing','connecting','active','ending','ended','failed','rejected');
create type public."facetime_event_source" as enum ('control_plane','worker','provider','customer');
create type public."facetime_command_type" as enum ('place_call','answer_call','reject_call','end_call','drain_worker','resume_worker','run_diagnostics','start_bridge','stop_bridge');
create type public."facetime_command_status" as enum ('queued','leased','completed','failed','expired');
create type public."facetime_session_kind" as enum ('customer_room','chert_room');
create type public."facetime_session_state" as enum ('created','dispatched','active','ended','expired','failed','cleaned');
create type public."facetime_webhook_event_state" as enum ('pending','delivering','delivered','dead_letter');
create table public."realtime_assistants" ("id" uuid not null,"project_id" uuid not null,"name" text not null,"description" text,"status" facetime_assistant_status not null,"draft_config" jsonb not null,"draft_revision" integer not null,"active_version_id" uuid,"created_by" uuid,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"archived_at" timestamp with time zone);
create table public."realtime_assistant_versions" ("id" uuid not null,"assistant_id" uuid not null,"project_id" uuid not null,"version" integer not null,"schema_version" integer not null,"config" jsonb not null,"published_by" uuid,"published_at" timestamp with time zone not null,"content_hash" text not null);
create table public."facetime_development_windows" ("id" uuid not null,"project_id" uuid not null,"worker_id" uuid not null,"line_id" uuid not null,"purpose" text not null,"expires_at" timestamp with time zone not null,"consumed_at" timestamp with time zone,"created_by" uuid,"created_at" timestamp with time zone not null);
create table public."facetime_worker_credentials" ("id" uuid not null,"worker_id" uuid not null,"credential_prefix" text not null,"credential_hash" text not null,"created_at" timestamp with time zone not null,"expires_at" timestamp with time zone,"last_used_at" timestamp with time zone,"revoked_at" timestamp with time zone,"rotated_from_id" uuid);
create table public."facetime_worker_enrollment_tokens" ("id" uuid not null,"worker_id" uuid not null,"token_prefix" text not null,"token_hash" text not null,"expires_at" timestamp with time zone not null,"created_at" timestamp with time zone not null,"consumed_at" timestamp with time zone,"revoked_at" timestamp with time zone);
create table public."facetime_worker_commands" ("id" uuid not null,"worker_id" uuid not null,"call_id" uuid,"line_id" uuid,"command_type" facetime_command_type not null,"payload" jsonb not null,"status" facetime_command_status not null,"idempotency_key" text not null,"lease_owner" text,"lease_token_hash" text,"lease_expires_at" timestamp with time zone,"attempt_count" integer not null,"maximum_attempts" integer not null,"available_at" timestamp with time zone not null,"expires_at" timestamp with time zone not null,"result" jsonb,"error_code" text,"created_at" timestamp with time zone not null,"completed_at" timestamp with time zone);
create table public."facetime_api_keys" ("id" uuid not null,"project_id" uuid not null,"name" text not null,"key_prefix" text not null,"key_hash" text not null,"scopes" text[] not null,"created_by" uuid,"created_at" timestamp with time zone not null,"last_used_at" timestamp with time zone,"revoked_at" timestamp with time zone,"expires_at" timestamp with time zone);
create table public."facetime_projects" ("id" uuid not null,"slug" text not null,"name" text not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"crm_project_id" uuid,"name_snapshot" text,"status" text not null,"website_domain" text not null,"logo_data" text);
create table public."facetime_call_transcripts" ("call_id" uuid not null,"project_id" uuid not null,"worker_id" uuid not null,"schema_version" integer not null,"turns" jsonb not null,"content_hash" text not null,"source_event_id" text not null,"created_at" timestamp with time zone not null);
create table public."facetime_call_events" ("id" uuid not null,"call_id" uuid not null,"project_id" uuid not null,"event_type" text not null,"sequence" bigint generated always as identity not null,"payload" jsonb not null,"source" facetime_event_source not null,"source_event_id" text not null,"created_at" timestamp with time zone not null,"occurred_at" timestamp with time zone,"worker_sequence" integer,"terminal_reason" text,"terminal_reason_detail" text);
create table public."facetime_calls" ("id" uuid not null,"project_id" uuid not null,"direction" facetime_call_direction not null,"mode" facetime_call_mode not null,"media" jsonb not null,"assistant_id" uuid,"assistant_version_id" uuid,"worker_id" uuid,"line_id" uuid not null,"identity_ciphertext" text,"identity_type" text,"identity_key_version" integer,"identity_retention_until" timestamp with time zone,"masked_identity" text,"status" facetime_call_status not null,"media_status" jsonb not null,"terminal_reason" text,"idempotency_key" text,"requested_at" timestamp with time zone not null,"detected_at" timestamp with time zone,"answered_at" timestamp with time zone,"active_at" timestamp with time zone,"ended_at" timestamp with time zone,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"terminal_reason_detail" text,"incoming_webhook_source_event_id" text,"incoming_webhook_decision" jsonb,"integration_revision_id" uuid,"integration_assignment_generation" bigint,"resolved_inbound_policy" facetime_inbound_policy,"resolved_livekit_allowed_hosts" text[],"binding_disposition" text not null,"incoming_request_id" uuid,"incoming_request_created_at" timestamp with time zone,"incoming_decision_deadline_at" timestamp with time zone,"incoming_request_data" jsonb,"video_framing" text not null,"outbound_request_fingerprint" text);
create table public."facetime_sessions" ("id" uuid not null,"project_id" uuid not null,"call_id" uuid not null,"line_id" uuid not null,"worker_id" uuid not null,"kind" facetime_session_kind not null,"state" facetime_session_state not null,"room_reference" text not null,"expected_participant_identity" text not null,"expires_at" timestamp with time zone not null,"terminal_reason" text,"terminal_reason_detail" text,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"dispatched_at" timestamp with time zone,"active_at" timestamp with time zone,"ended_at" timestamp with time zone,"expired_at" timestamp with time zone,"failed_at" timestamp with time zone,"cleaned_at" timestamp with time zone);
create table public."facetime_webhook_delivery_attempts" ("id" uuid not null,"project_id" uuid not null,"webhook_event_id" uuid not null,"attempt_number" integer not null,"secret_version" integer,"status" text not null,"status_code" integer,"latency_ms" integer not null,"error" text,"attempted_at" timestamp with time zone not null,"started_at" timestamp with time zone not null,"completed_at" timestamp with time zone not null,"next_attempt_at" timestamp with time zone);
create table public."facetime_session_credential_seals" ("id" uuid not null,"project_id" uuid not null,"session_id" uuid not null,"worker_id" uuid not null,"livekit_url_ciphertext" text,"participant_token_ciphertext" text,"token_fingerprint" text not null,"encryption_key_version" integer not null,"token_expires_at" timestamp with time zone not null,"lease_expires_at" timestamp with time zone not null,"state" text not null,"consumed_at" timestamp with time zone,"deleted_at" timestamp with time zone,"created_at" timestamp with time zone not null);
create table public."facetime_webhook_events" ("event_id" uuid not null,"project_id" uuid not null,"call_id" uuid not null,"source_call_event_id" uuid not null,"endpoint_id" uuid not null,"endpoint_url" text not null,"secret_version_id" uuid,"secret_version" integer,"event_type" text not null,"payload" jsonb not null,"raw_body" text not null,"created_at" timestamp with time zone not null,"state" facetime_webhook_event_state not null,"attempt_count" integer not null,"next_attempt_at" timestamp with time zone not null,"lease_owner" text,"lease_expires_at" timestamp with time zone,"delivered_at" timestamp with time zone,"dead_letter_at" timestamp with time zone,"last_error" text,"logical_transition" text);
create table public."facetime_webhook_endpoints" ("id" uuid not null,"project_id" uuid not null,"endpoint_url" text not null,"enabled" boolean not null,"payload_version" integer not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"name" text not null,"livekit_allowed_hosts" text[],"legacy_default" boolean not null,"active_revision_id" uuid,"signing_enabled" boolean not null);
create table public."facetime_platform_admins" ("user_id" uuid not null,"granted_at" timestamp with time zone not null);
create table public."facetime_integration_revisions" ("id" uuid not null,"project_id" uuid not null,"integration_id" uuid not null,"generation" bigint not null,"endpoint_url" text not null,"payload_version" integer not null,"livekit_allowed_hosts" text[] not null,"secret_version_id" uuid,"secret_version" integer,"created_at" timestamp with time zone not null,"signing_enabled" boolean not null);
create table public."facetime_webhook_secret_versions" ("id" uuid not null,"project_id" uuid not null,"endpoint_id" uuid not null,"version" integer not null,"ciphertext" text not null,"encryption_key_version" integer not null,"created_at" timestamp with time zone not null,"revoked_at" timestamp with time zone,"retired_at" timestamp with time zone);
create table public."facetime_project_settings" ("project_id" uuid not null,"livekit_allowed_hosts" text[] not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null);
create table public."facetime_lines" ("id" uuid not null,"project_id" uuid,"worker_id" uuid not null,"line_key" text not null,"display_name" text not null,"masked_identity" text not null,"identity_ciphertext" text,"status" facetime_line_status not null,"current_call_id" uuid,"default_assistant_id" uuid,"inbound_policy" facetime_inbound_policy not null,"supports_audio" boolean not null,"supports_video" boolean not null,"created_at" timestamp with time zone not null,"updated_at" timestamp with time zone not null,"integration_id" uuid,"assignment_generation" bigint not null,"video_framing" text not null);
create table public."facetime_project_memberships" ("project_id" uuid not null,"user_id" uuid not null,"role" text not null,"created_at" timestamp with time zone not null);
create table public."facetime_configuration_audit" ("id" uuid not null,"project_id" uuid not null,"resource_type" text not null,"resource_id" uuid not null,"operation" text not null,"previous_configuration" jsonb,"next_configuration" jsonb,"database_actor" text not null,"created_at" timestamp with time zone not null);
create table public."facetime_admin_audit" ("id" uuid not null,"actor_id" uuid not null,"project_id" uuid not null,"action" text not null,"created_at" timestamp with time zone not null);
create table public."facetime_workers" ("id" uuid not null,"worker_key" text not null,"display_name" text not null,"status" facetime_worker_status not null,"enabled" boolean not null,"last_heartbeat_at" timestamp with time zone,"software_version" text,"capabilities" jsonb not null,"readiness" jsonb not null,"current_call_id" uuid,"enrolled_at" timestamp with time zone,"updated_at" timestamp with time zone not null,"last_heartbeat_attempt_at" timestamp with time zone,"last_heartbeat_rejection_reason" jsonb,"automatic_readiness_enabled" boolean not null);
create table public."facetime_media_observations" ("id" uuid not null,"project_id" uuid not null,"worker_id" uuid not null,"call_id" uuid not null,"line_id" uuid not null,"observer_id" uuid not null,"capability" text not null,"kind" text not null,"outcome" text not null,"reason" text not null,"observed_at" timestamp with time zone not null,"received_at" timestamp with time zone not null,"build" text,"device_binding" text,"config_binding" text,"runtime_id" uuid,"recovery_qualified" boolean not null);
create table public."facetime_worker_onboarding_requests" ("project_id" uuid not null,"request_id" uuid not null,"actor_id" uuid not null,"input" jsonb not null,"worker_id" uuid not null,"token_id" uuid,"created_at" timestamp with time zone not null);
create table public."facetime_worker_onboarding" ("worker_id" uuid not null,"line_id" uuid not null,"project_id" uuid not null,"created_by" uuid not null,"activated_at" timestamp with time zone,"created_at" timestamp with time zone not null);
create table public."facetime_membership_audit" ("id" uuid not null,"actor_id" uuid not null,"project_id" uuid not null,"target_user_id" uuid not null,"old_role" text,"new_role" text,"created_at" timestamp with time zone not null);
create table public."facetime_audit_requests" ("id" uuid not null,"worker_id" uuid not null,"project_id" uuid not null,"actor_id" uuid not null,"run_id" uuid not null,"created_at" timestamp with time zone not null);
create table public."facetime_audit_runners" ("worker_id" uuid not null,"project_id" uuid not null,"credential_hash" text not null,"host" text not null,"approved_release" text not null,"enabled" boolean not null,"registered_at" timestamp with time zone not null,"last_seen_at" timestamp with time zone,"next_due_at" timestamp with time zone not null,"last_scheduled_at" timestamp with time zone,"last_claimed_slot" timestamp with time zone,"incident" text,"incident_at" timestamp with time zone,"reminder_sent" boolean not null);
create table public."facetime_audit_runs" ("id" uuid not null,"worker_id" uuid not null,"project_id" uuid not null,"actor_id" uuid,"approved_release" text not null,"trigger" text not null,"state" text not null,"created_at" timestamp with time zone not null,"scheduled_at" timestamp with time zone,"expires_at" timestamp with time zone not null,"started_at" timestamp with time zone,"lease_until" timestamp with time zone,"claim_token" uuid,"completed_at" timestamp with time zone,"received_at" timestamp with time zone,"result" jsonb,"verdict" text);
create table public."facetime_audit_notifications" ("id" uuid not null,"worker_id" uuid not null,"project_id" uuid not null,"run_id" uuid,"device_label" text not null,"kind" text not null,"fingerprint" text not null,"created_at" timestamp with time zone not null,"attempts" integer not null,"next_attempt_at" timestamp with time zone not null,"state" text not null,"provider_id" text,"accepted_at" timestamp with time zone);
CREATE OR REPLACE FUNCTION public.facetime_guard_onboarded_worker()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare o public.facetime_worker_onboarding%rowtype;
begin
 select * into o from public.facetime_worker_onboarding where worker_id=old.id;
 if found and (not new.automatic_readiness_enabled or new.status='development' or new.worker_key<>old.worker_key
   or (o.activated_at is null and new.enabled)) then
  raise exception 'onboarding_worker_guard' using errcode='55000';
 end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_guard_onboarded_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if exists(select 1 from public.facetime_worker_onboarding o where
   (o.worker_id=new.worker_id and (o.line_id<>new.id or o.project_id is distinct from new.project_id))
   or (o.line_id=new.id and (o.worker_id<>new.worker_id or o.project_id is distinct from new.project_id))) then
  raise exception 'onboarding_line_guard' using errcode='55000';
 end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_onboard_worker(p_project_id uuid, p_actor_id uuid, p_request_id uuid, p_input jsonb, p_token_hash text, p_token_prefix text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 r public.facetime_worker_onboarding_requests%rowtype;
 o public.facetime_worker_onboarding%rowtype;
 w public.facetime_workers%rowtype;
 l public.facetime_lines%rowtype;
 t public.facetime_worker_enrollment_tokens%rowtype;
 action text := p_input->>'onboarding';
 replay boolean := false;
begin
 -- Recheck owner membership inside the mutation transaction, including replay.
 perform 1 from public.facetime_project_memberships where project_id=p_project_id
  and user_id=p_actor_id and role='owner' for share;
 if not found then raise exception 'owner_required' using errcode='42501'; end if;
 if p_request_id is null or p_input->>'request_id' is distinct from p_request_id::text
   or action is null or action not in ('disabled','recover','activate')
   or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
   or p_token_prefix is null or length(p_token_prefix)<>16 then
  raise exception 'invalid_onboarding_request' using errcode='22023'; end if;
 -- One exact operation per scoped UUID. Fresh keys additionally have global
 -- unique constraints; any collision aborts the entire transaction.
 perform pg_advisory_xact_lock(hashtextextended('onboarding:'||p_project_id||':'||p_request_id,0));
 select * into r from public.facetime_worker_onboarding_requests
  where project_id=p_project_id and request_id=p_request_id;
 replay := found;
 if replay and (r.actor_id<>p_actor_id or r.input<>p_input) then
  raise exception 'onboarding_request_conflict' using errcode='23505'; end if;
 if action='disabled' and not replay then
  insert into public.facetime_workers(worker_key,display_name,status,enabled,automatic_readiness_enabled,capabilities)
   values(p_input->>'worker_key',p_input->>'display_name','offline',false,true,'{"audio":true,"video":false}') returning * into w;
  if position('*' in coalesce(p_input->>'masked_identity',''))=0 then
   raise exception 'masked_identity_required' using errcode='22023'; end if;
  insert into public.facetime_lines(project_id,worker_id,line_key,display_name,masked_identity,status,inbound_policy,supports_audio,supports_video,default_assistant_id)
   values(p_project_id,w.id,p_input->>'line_key',p_input->>'line_display_name',p_input->>'masked_identity','offline','customer_decides',true,false,null) returning * into l;
  -- The legacy assignment trigger may inherit a default. Clear it in this same
  -- transaction, so no committed observer sees an inherited integration.
  if l.integration_id is not null then
   update public.facetime_lines set integration_id=null where id=l.id returning * into l;
  end if;
  insert into public.facetime_worker_onboarding(worker_id,line_id,project_id,created_by)
   values(w.id,l.id,p_project_id,p_actor_id) returning * into o;
 else
  select * into o from public.facetime_worker_onboarding where project_id=p_project_id
   and worker_id=case when replay then r.worker_id else (p_input->>'worker_id')::uuid end;
  if not found or (action<>'disabled' and o.line_id is distinct from (p_input->>'line_id')::uuid) then
   raise exception 'onboarding_not_found' using errcode='P0002'; end if;
  -- Match allocation's line -> worker lock order. Exchange only locks worker.
  select * into l from public.facetime_lines where id=o.line_id for update;
  select * into w from public.facetime_workers where id=o.worker_id for update;
  select * into o from public.facetime_worker_onboarding where worker_id=w.id for update;
  if l.project_id is distinct from p_project_id or l.worker_id<>w.id
    or (select count(*) from public.facetime_lines where worker_id=w.id)<>1 then
   raise exception 'onboarding_binding_changed' using errcode='55000'; end if;
 end if;
 if not replay and action='activate' then
  if o.activated_at is not null or w.enabled or w.status<>'offline' or not w.automatic_readiness_enabled
   or w.current_call_id is not null or l.current_call_id is not null
   or w.enrolled_at is null
   or not exists(select 1 from public.facetime_worker_credentials where worker_id=w.id and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()))
   or not public.facetime_worker_automatic_ready(w,clock_timestamp(),l.supports_video)
   or exists(select 1 from public.facetime_worker_commands where worker_id=w.id and status in ('queued','leased')) then
   raise exception 'onboarding_activation_unavailable' using errcode='55000'; end if;
  update public.facetime_worker_onboarding set activated_at=clock_timestamp() where worker_id=w.id returning * into o;
  update public.facetime_workers set enabled=true where id=w.id returning * into w;
  update public.facetime_lines set status='available' where id=l.id returning * into l;
 elsif not replay then
  if o.activated_at is not null or w.enabled or w.status<>'offline' or w.current_call_id is not null or l.current_call_id is not null then
   raise exception 'onboarding_recovery_unavailable' using errcode='55000'; end if;
  if action='recover' then
   -- Disabled/offline only. This is an explicit reset of enrollment, never of
   -- registration or assignment. All old tokens/credentials become unusable.
   update public.facetime_worker_enrollment_tokens set revoked_at=clock_timestamp() where worker_id=w.id and revoked_at is null;
   update public.facetime_worker_credentials set revoked_at=clock_timestamp() where worker_id=w.id and revoked_at is null;
   update public.facetime_workers set enrolled_at=null,last_heartbeat_at=null,readiness='{}' where id=w.id returning * into w;
  end if;
  insert into public.facetime_worker_enrollment_tokens(worker_id,token_prefix,token_hash,expires_at)
   values(w.id,p_token_prefix,p_token_hash,clock_timestamp()+interval '10 minutes') returning * into t;
 end if;
 if not replay then
  insert into public.facetime_worker_onboarding_requests(project_id,request_id,actor_id,input,worker_id,token_id)
   values(p_project_id,p_request_id,p_actor_id,p_input,w.id,t.id) returning * into r;
 end if;
 if r.token_id is not null then
  select * into t from public.facetime_worker_enrollment_tokens where id=r.token_id;
  if t.token_hash<>p_token_hash or t.revoked_at is not null or (t.consumed_at is null and t.expires_at<=clock_timestamp()) then
   raise exception 'onboarding_token_unavailable' using errcode='55000'; end if;
 end if;
 return jsonb_build_object('worker',jsonb_build_object('id',w.id,'worker_key',w.worker_key,'status',w.status,'enabled',w.enabled,'automatic_readiness_enabled',w.automatic_readiness_enabled),
  'line',jsonb_build_object('id',l.id,'line_key',l.line_key,'worker_id',w.id,'project_id',l.project_id,'status',l.status,'inbound_policy',l.inbound_policy,'supports_audio',l.supports_audio,'supports_video',l.supports_video,'default_assistant_id',l.default_assistant_id,'integration_id',l.integration_id),
  'request_id',p_request_id,'activated_at',o.activated_at,'enrollment_expires_at',t.expires_at,
  'enrolled',w.enrolled_at is not null,'deliver_token',t.id is not null and t.consumed_at is null and o.activated_at is null);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_enqueue_session_stop(p_session facetime_sessions)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  insert into public.facetime_worker_commands (
    worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
  ) values (
    p_session.worker_id,
    p_session.call_id,
    p_session.line_id,
    'stop_bridge',
    jsonb_build_object(
      'schema_version', 1,
      'session_id', p_session.id,
      'call_id', p_session.call_id,
      'line_id', p_session.line_id,
      'worker_id', p_session.worker_id
    ),
    'stop_bridge:' || p_session.id::text,
    now() + interval '2 minutes'
  ) on conflict (worker_id, idempotency_key) do nothing;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_annotate_development_audio_test()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_audio_requested boolean := false;
begin
  if new.command_type = 'answer_call'
     and coalesce((new.payload->>'authorized_test_call')::boolean, false) then
    select coalesce((media->>'audio')::boolean, false)
      into v_audio_requested
    from public.facetime_calls
    where id = new.call_id
      and worker_id = new.worker_id
      and line_id = new.line_id;

    new.payload := jsonb_set(
      new.payload,
      '{development_audio_test}',
      to_jsonb(coalesce(v_audio_requested, false)),
      true
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_ingest_worker_event(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_event_type text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_call public.facetime_calls%rowtype;
  v_event_id uuid;
  v_terminal boolean;
  v_next_status public.facetime_call_status;
  v_reason text;
  v_reason_detail text;
  v_occurred_at timestamptz := coalesce((p_payload->>'__b1_occurred_at')::timestamptz, now());
begin
  select * into v_call from public.facetime_calls where id = p_call_id and worker_id = p_worker_id for update;
  if not found then raise exception 'call_not_found' using errcode = 'P0002'; end if;
  insert into public.facetime_call_events (call_id, project_id, event_type, payload, source, source_event_id)
  values (p_call_id, v_call.project_id, p_event_type, coalesce(p_payload, '{}'::jsonb), 'worker', p_source_event_id)
  on conflict (source, source_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then return jsonb_build_object('accepted', true, 'deduplicated', true); end if;

  v_terminal := v_call.status in ('ended', 'failed', 'rejected');
  if not v_terminal then
    v_next_status := case p_event_type
      when 'incoming_registered' then 'incoming'
      when 'agent_preparing' then 'agent_preparing'
      when 'answering' then 'answering'
      when 'dialing' then 'dialing'
      when 'connecting' then 'connecting'
      when 'active' then 'active'
      when 'ending' then 'ending'
      when 'call_ended' then 'ended'
      when 'call_failed' then 'failed'
      when 'call_rejected' then 'rejected'
      else null end;
    if v_next_status is not null and (
      v_next_status in ('ended', 'failed', 'rejected')
      or (case v_next_status
        when 'queued' then 0 when 'incoming' then 1 when 'allocating' then 1
        when 'agent_preparing' then 2 when 'answering' then 3 when 'dialing' then 3
        when 'connecting' then 4 when 'active' then 5 when 'ending' then 6 else 7 end)
      >= (case v_call.status
        when 'queued' then 0 when 'incoming' then 1 when 'allocating' then 1
        when 'agent_preparing' then 2 when 'answering' then 3 when 'dialing' then 3
        when 'connecting' then 4 when 'active' then 5 when 'ending' then 6 else 7 end)
    ) then
      v_reason := case when v_next_status in ('ended', 'failed', 'rejected') then left(coalesce(p_payload->>'reason', p_event_type), 240) else null end;
      v_reason_detail := case when v_next_status in ('ended', 'failed', 'rejected') then left(p_payload->>'__b1_terminal_reason_detail', 240) else null end;
      update public.facetime_calls set
        status = v_next_status,
        detected_at = case when v_next_status = 'incoming' then coalesce(detected_at, v_occurred_at) else detected_at end,
        answered_at = case when v_next_status in ('answering', 'connecting', 'active') then coalesce(answered_at, v_occurred_at) else answered_at end,
        active_at = case when v_next_status = 'active' then coalesce(active_at, v_occurred_at) else active_at end,
        ended_at = case when v_next_status in ('ended', 'failed', 'rejected') then v_occurred_at else ended_at end,
        terminal_reason = coalesce(v_reason, terminal_reason),
        terminal_reason_detail = coalesce(v_reason_detail, terminal_reason_detail)
      where id = p_call_id;
      if v_next_status in ('ended', 'failed', 'rejected') then
        update public.facetime_workers set current_call_id = null where id = p_worker_id and current_call_id = p_call_id;
        update public.facetime_lines set current_call_id = null, status = 'available' where id = v_call.line_id and current_call_id = p_call_id;
      end if;
    end if;
  end if;
  return jsonb_build_object('accepted', true, 'deduplicated', false, 'event_id', v_event_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if current_setting('chert.facetime_test_cleanup', true) = '1' then return old; end if;
  raise exception 'append-only row cannot be changed' using errcode = '55000';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_protect_terminal_call()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if current_setting('chert.facetime_test_cleanup', true) = '1' then return new; end if;
  if old.status in ('ended', 'failed', 'rejected') and (
    new.status is distinct from old.status or
    new.terminal_reason is distinct from old.terminal_reason or
    new.ended_at is distinct from old.ended_at
  ) then
    raise exception 'terminal call result is immutable' using errcode = '55000';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_validate_project_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_table_name = 'realtime_assistant_versions' then
    if not exists (
      select 1 from public.realtime_assistants a
      where a.id = new.assistant_id and a.project_id = new.project_id
    ) then raise exception 'assistant project mismatch' using errcode = '23514'; end if;
  elsif tg_table_name = 'facetime_call_events' then
    if not exists (
      select 1 from public.facetime_calls c
      where c.id = new.call_id and c.project_id = new.project_id
    ) then raise exception 'call project mismatch' using errcode = '23514'; end if;
  elsif tg_table_name = 'facetime_lines' then
    if new.default_assistant_id is not null and (
      new.project_id is null or not exists (
        select 1 from public.realtime_assistants a where a.id = new.default_assistant_id and a.project_id = new.project_id
      )
    ) then raise exception 'line assistant project mismatch' using errcode = '23514'; end if;
  elsif tg_table_name = 'facetime_calls' then
    if not exists (select 1 from public.facetime_lines l where l.id = new.line_id and l.project_id = new.project_id)
      or (new.assistant_id is not null and not exists (
        select 1 from public.realtime_assistant_versions v
        where v.id = new.assistant_version_id and v.assistant_id = new.assistant_id and v.project_id = new.project_id
      ))
    then raise exception 'call project binding mismatch' using errcode = '23514'; end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_is_project_member(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1 from public.facetime_project_memberships m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_publish_assistant(p_assistant_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_assistant public.realtime_assistants%rowtype;
  v_version integer;
  v_version_id uuid;
begin
  select * into v_assistant from public.realtime_assistants where id = p_assistant_id for update;
  if not found then raise exception 'assistant_not_found' using errcode = 'P0002'; end if;
  if v_assistant.status in ('archived', 'paused') then raise exception 'assistant_not_publishable' using errcode = '55000'; end if;
  if v_assistant.draft_config = '{}'::jsonb then raise exception 'assistant_config_empty' using errcode = '23514'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.realtime_assistant_versions where assistant_id = p_assistant_id;
  insert into public.realtime_assistant_versions (assistant_id, project_id, version, config, published_by, content_hash)
  values (p_assistant_id, v_assistant.project_id, v_version, v_assistant.draft_config, p_actor, encode(digest(v_assistant.draft_config::text, 'sha256'), 'hex'))
  returning id into v_version_id;
  update public.realtime_assistants set active_version_id = v_version_id, status = 'active' where id = p_assistant_id;
  return v_version_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_bootstrap_first_project(p_slug text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('facetime:first-project-bootstrap:' || v_user_id::text));
  if exists (select 1 from public.facetime_project_memberships where user_id = v_user_id) then
    raise exception 'bootstrap_already_completed' using errcode = '55000';
  end if;
  insert into public.facetime_projects(slug, name) values (p_slug, btrim(p_name)) returning id into v_project_id;
  insert into public.facetime_project_memberships(project_id, user_id, role) values (v_project_id, v_user_id, 'owner');
  return v_project_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_cleanup_test_project(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_slug text;
  v_worker_ids uuid[];
begin
  select slug into v_slug from public.facetime_projects where id = p_project_id for update;
  if v_slug is null or v_slug not like 'fttest-%' then raise exception 'test_project_required' using errcode = '42501'; end if;
  if exists (select 1 from public.facetime_calls where project_id = p_project_id and status not in ('ended','failed','rejected')) then
    raise exception 'active_test_calls' using errcode = '55000';
  end if;
  perform set_config('chert.facetime_test_cleanup', '1', true);
  select array_agg(distinct worker_id) into v_worker_ids from public.facetime_lines where project_id = p_project_id;
  delete from public.facetime_worker_commands where call_id in (select id from public.facetime_calls where project_id = p_project_id);
  delete from public.facetime_call_events where project_id = p_project_id;
  update public.facetime_workers set current_call_id = null where current_call_id in (select id from public.facetime_calls where project_id = p_project_id);
  update public.facetime_lines set current_call_id = null where project_id = p_project_id;
  delete from public.facetime_calls where project_id = p_project_id;
  delete from public.facetime_development_windows where project_id = p_project_id;
  if v_worker_ids is not null then
    delete from public.facetime_worker_commands where worker_id = any(v_worker_ids);
  end if;
  delete from public.facetime_lines where project_id = p_project_id;
  update public.realtime_assistants set active_version_id = null where project_id = p_project_id;
  delete from public.realtime_assistant_versions where project_id = p_project_id;
  delete from public.realtime_assistants where project_id = p_project_id;
  delete from public.facetime_api_keys where project_id = p_project_id;
  delete from public.facetime_project_memberships where project_id = p_project_id;
  delete from public.facetime_projects where id = p_project_id;
  if v_worker_ids is not null then
    delete from public.facetime_worker_enrollment_tokens where worker_id = any(v_worker_ids);
    delete from public.facetime_worker_credentials where worker_id = any(v_worker_ids);
    delete from public.facetime_workers w where w.id = any(v_worker_ids) and not exists (select 1 from public.facetime_lines l where l.worker_id = w.id);
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_prepare_call_event_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.event_type := coalesce(nullif(new.payload->>'__b1_public_event_type', ''), new.event_type);
  new.occurred_at := coalesce((new.payload->>'__b1_occurred_at')::timestamptz, new.created_at, now());
  new.worker_sequence := (new.payload->>'__b1_worker_sequence')::integer;
  new.terminal_reason := nullif(new.payload->>'__b1_terminal_reason', '');
  new.terminal_reason_detail := nullif(new.payload->>'__b1_terminal_reason_detail', '');
  new.payload := new.payload
    - '__b1_public_event_type'
    - '__b1_occurred_at'
    - '__b1_worker_sequence'
    - '__b1_terminal_reason'
    - '__b1_terminal_reason_detail';
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_validate_session_linkage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_call public.facetime_calls%rowtype;
begin
  select * into v_call from public.facetime_calls where id = new.call_id;
  if not found
    or v_call.project_id <> new.project_id
    or v_call.line_id <> new.line_id
    or v_call.worker_id is distinct from new.worker_id then
    raise exception 'invalid_session_linkage' using errcode = '23514';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_complete_worker_command(p_worker_id uuid, p_command_id uuid, p_lease_token_hash text, p_succeeded boolean, p_result jsonb DEFAULT '{}'::jsonb, p_error_code text DEFAULT NULL::text)
 RETURNS facetime_worker_commands
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_command public.facetime_worker_commands%rowtype;
  v_project_id uuid;
begin
  select * into v_command from public.facetime_worker_commands where id = p_command_id for update;
  if not found or v_command.worker_id <> p_worker_id then raise exception 'command_not_found' using errcode = 'P0002'; end if;
  if v_command.status <> 'leased' or v_command.lease_token_hash <> p_lease_token_hash or v_command.lease_expires_at <= now() then
    raise exception 'stale_command_lease' using errcode = '55000';
  end if;
  update public.facetime_worker_commands
  set status = case when p_succeeded then 'completed'::public.facetime_command_status else 'failed'::public.facetime_command_status end,
      result = coalesce(p_result, '{}'::jsonb), error_code = case when p_succeeded then null else p_error_code end,
      completed_at = now(), lease_owner = null, lease_token_hash = null, lease_expires_at = null
  where id = p_command_id returning * into v_command;

  if not p_succeeded and v_command.command_type = 'start_bridge' then
    select project_id into v_project_id from public.facetime_calls
    where id = v_command.call_id and worker_id = p_worker_id;
    if v_project_id is null then raise exception 'call_not_found' using errcode = 'P0002'; end if;
    perform public.facetime_reconcile_failed_start_bridge(
      v_project_id,
      p_worker_id,
      v_command.call_id,
      (v_command.payload->>'session_id')::uuid,
      v_command.id,
      coalesce(nullif(p_result->>'safe_error', ''), p_error_code, 'start_bridge_command_failed')
    );
  end if;
  return v_command;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_outbound_call(p_project_id uuid, p_mode facetime_call_mode, p_media jsonb, p_assistant_id uuid, p_requested_line_id uuid, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_authorized_test_call boolean, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_existing uuid;
  v_line public.facetime_lines%rowtype;
  v_worker public.facetime_workers%rowtype;
  v_version_id uuid;
  v_call_id uuid;
  v_window_id uuid;
  v_line_id uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing from public.facetime_calls where project_id = p_project_id and idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;

  if p_mode = 'managed' then
    select active_version_id into v_version_id
    from public.realtime_assistants
    where id = p_assistant_id and project_id = p_project_id and status = 'active'
    for share;
    if v_version_id is null then raise exception 'published_assistant_required' using errcode = '55000'; end if;
  elsif p_assistant_id is not null then
    raise exception 'customer_managed_assistant_forbidden' using errcode = '23514';
  end if;

  if p_authorized_test_call then
    select l.id, d.id into v_line_id, v_window_id
    from public.facetime_lines l
    join public.facetime_workers w on w.id = l.worker_id
    join public.facetime_development_windows d on d.worker_id = w.id and d.line_id = l.id
    where l.project_id = p_project_id and (p_requested_line_id is null or l.id = p_requested_line_id)
      and l.current_call_id is null and w.current_call_id is null and w.status = 'development' and w.enabled
      and d.project_id = p_project_id and d.purpose = 'outbound' and d.consumed_at is null and d.expires_at > now()
      and (not coalesce((p_media->>'audio')::boolean, false) or l.supports_audio)
      and (not coalesce((p_media->>'video')::boolean, false) or l.supports_video)
    order by d.created_at desc for update of l, w, d skip locked limit 1;
    if found then
      select * into v_line from public.facetime_lines where id = v_line_id;
      update public.facetime_development_windows set consumed_at = now() where id = v_window_id;
    end if;
  else
    select l.* into v_line
    from public.facetime_lines l join public.facetime_workers w on w.id = l.worker_id
    where l.project_id = p_project_id and (p_requested_line_id is null or l.id = p_requested_line_id)
      and l.status = 'available' and l.current_call_id is null
      and w.status = 'accepting' and w.enabled and w.current_call_id is null
      and (case when w.automatic_readiness_enabled
        then public.facetime_worker_automatic_ready(w,clock_timestamp(),coalesce((p_media->>'video')::boolean,false))
        else w.last_heartbeat_at > now()-interval '30 seconds'
          and coalesce((w.readiness->>'production_media_ready')::boolean,false) end)
      and (not coalesce((p_media->>'audio')::boolean, false) or l.supports_audio)
      and (not coalesce((p_media->>'video')::boolean, false) or l.supports_video)
    order by w.last_heartbeat_at desc, l.created_at for update of l, w skip locked limit 1;
  end if;
  if not found then raise exception 'line_unavailable' using errcode = '55000'; end if;
  select * into v_worker from public.facetime_workers where id = v_line.worker_id for update;

  insert into public.facetime_calls (
    project_id, direction, mode, media, assistant_id, assistant_version_id,
    worker_id, line_id, masked_identity, identity_ciphertext, identity_type,
    identity_key_version, identity_retention_until, status, idempotency_key
  ) values (
    p_project_id, 'outbound', p_mode, p_media, p_assistant_id, v_version_id,
    v_worker.id, v_line.id, p_masked_destination, p_identity_ciphertext, p_identity_type,
    p_identity_key_version, p_identity_retention_until, 'allocating', p_idempotency_key
  ) returning id into v_call_id;

  update public.facetime_workers set current_call_id = v_call_id where id = v_worker.id;
  update public.facetime_lines set current_call_id = v_call_id, status = 'busy' where id = v_line.id;
  insert into public.facetime_worker_commands (
    worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
  ) values (
    v_worker.id, v_call_id, v_line.id, 'place_call',
    jsonb_build_object('schema_version', 1, 'call_id', v_call_id, 'line_id', v_line.id, 'mode', p_mode, 'media', p_media, 'assistant_version_id', v_version_id, 'authorized_test_call', p_authorized_test_call),
    'place_call:' || v_call_id::text, now() + interval '5 minutes'
  );
  insert into public.facetime_call_events (call_id, project_id, event_type, source, source_event_id)
  values (v_call_id, p_project_id, 'call_allocated', 'control_plane', 'call_allocated:' || v_call_id::text);
  return v_call_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_arm_development_window(p_project_id uuid, p_worker_id uuid, p_line_id uuid, p_purpose text, p_created_by uuid, p_duration_seconds integer)
 RETURNS facetime_development_windows
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_worker public.facetime_workers%rowtype;
  v_line public.facetime_lines%rowtype;
  v_window public.facetime_development_windows%rowtype;
begin
  if p_purpose not in ('inbound', 'outbound') then
    raise exception 'invalid_development_window_purpose'
      using errcode = '22023';
  end if;

  if p_duration_seconds < 30 or p_duration_seconds > 300 then
    raise exception 'invalid_development_window_duration'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.facetime_project_memberships
    where project_id = p_project_id
      and user_id = p_created_by
      and role in ('owner', 'admin')
  ) then
    raise exception 'development_window_forbidden'
      using errcode = '42501';
  end if;

  select *
  into v_worker
  from public.facetime_workers
  where id = p_worker_id
  for update;

  select *
  into v_line
  from public.facetime_lines
  where id = p_line_id
  for update;

  if v_worker.id is null
     or v_line.id is null
     or v_line.project_id <> p_project_id
     or v_line.worker_id <> p_worker_id then
    raise exception 'development_binding_invalid'
      using errcode = 'P0002';
  end if;

  if not v_worker.enabled
     or v_worker.status <> 'development'
     or v_worker.current_call_id is not null
     or v_line.current_call_id is not null
     or v_line.status = 'busy' then
    raise exception 'development_worker_not_idle'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.facetime_calls
    where (worker_id = p_worker_id or line_id = p_line_id)
      and status not in ('ended', 'failed', 'rejected')
  ) then
    raise exception 'development_call_active'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.facetime_worker_commands
    where worker_id = p_worker_id
      and status in ('queued', 'leased')
  ) then
    raise exception 'development_command_active'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.facetime_calls
    where (worker_id = p_worker_id or line_id = p_line_id)
      and ended_at > now() - interval '5 seconds'
  ) or exists (
    select 1
    from public.facetime_worker_commands
    where worker_id = p_worker_id
      and coalesce(completed_at, created_at) > now() - interval '5 seconds'
  ) then
    raise exception 'development_cleanup_not_stable'
      using errcode = '55000';
  end if;

  delete from public.facetime_development_windows
  where project_id = p_project_id
    and worker_id = p_worker_id
    and consumed_at is null;

  insert into public.facetime_development_windows (
    project_id,
    worker_id,
    line_id,
    purpose,
    expires_at,
    created_by
  )
  values (
    p_project_id,
    p_worker_id,
    p_line_id,
    p_purpose,
    now() + make_interval(secs => p_duration_seconds),
    p_created_by
  )
  returning * into v_window;

  return v_window;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_prevent_crm_project_remap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.crm_project_id is not null and new.crm_project_id is distinct from old.crm_project_id then
    raise exception 'crm_project_id_is_immutable' using errcode = '55000';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_enroll_worker(p_worker_id uuid, p_enrollment_token_hash text, p_credential_prefix text, p_credential_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_enrollment_id uuid; v_credential_id uuid; v_guarded boolean;
begin
 select exists(select 1 from public.facetime_worker_onboarding where worker_id=p_worker_id) into v_guarded;
 if v_guarded then
  perform 1 from public.facetime_workers w join public.facetime_worker_onboarding o on o.worker_id=w.id
   where w.id=p_worker_id and not w.enabled and o.activated_at is null for update of w;
  if not found then raise exception 'enrollment_failed' using errcode='28000'; end if;
 end if;
 select id into v_enrollment_id from public.facetime_worker_enrollment_tokens
  where worker_id=p_worker_id and token_hash=p_enrollment_token_hash and consumed_at is null
   and revoked_at is null and expires_at>case when v_guarded then clock_timestamp() else now() end for update;
 if v_enrollment_id is null then raise exception 'enrollment_failed' using errcode='28000'; end if;
 update public.facetime_worker_credentials set revoked_at=now() where worker_id=p_worker_id and revoked_at is null;
 insert into public.facetime_worker_credentials(worker_id,credential_prefix,credential_hash)
  values(p_worker_id,p_credential_prefix,p_credential_hash) returning id into v_credential_id;
 update public.facetime_worker_enrollment_tokens set consumed_at=now() where id=v_enrollment_id;
 update public.facetime_workers set enrolled_at=coalesce(enrolled_at,now()) where id=p_worker_id;
 return v_credential_id;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_link_crm_project(p_facetime_project_id uuid, p_crm_project_id uuid, p_name_snapshot text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  update public.facetime_projects
  set crm_project_id = p_crm_project_id,
      name_snapshot = nullif(btrim(p_name_snapshot), '')
  where id = p_facetime_project_id and crm_project_id is null
  returning id into v_id;
  if v_id is null then raise exception 'facetime_project_missing_or_already_mapped' using errcode = '55000'; end if;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_ingest_call_transcript(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_schema_version integer, p_turns jsonb, p_content_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_call public.facetime_calls%rowtype;
  v_existing public.facetime_call_transcripts%rowtype;
begin
  select * into v_call
  from public.facetime_calls
  where id = p_call_id and worker_id = p_worker_id;
  if not found then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.facetime_call_transcripts
  where call_id = p_call_id;
  if found then
    if v_existing.content_hash = p_content_hash then
      return jsonb_build_object('accepted', true, 'deduplicated', true, 'call_id', p_call_id);
    end if;
    raise exception 'transcript_conflict' using errcode = '23505';
  end if;

  insert into public.facetime_call_transcripts (
    call_id, project_id, worker_id, schema_version, turns, content_hash, source_event_id
  ) values (
    p_call_id, v_call.project_id, p_worker_id, p_schema_version, p_turns, p_content_hash, p_source_event_id
  );

  return jsonb_build_object('accepted', true, 'deduplicated', false, 'call_id', p_call_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_session(p_project_id uuid, p_call_id uuid, p_kind facetime_session_kind, p_room_reference text, p_expected_participant_identity text, p_expires_at timestamp with time zone)
 RETURNS facetime_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_call public.facetime_calls%rowtype;
  v_session public.facetime_sessions%rowtype;
begin
  select * into v_call
  from public.facetime_calls
  where id = p_call_id and project_id = p_project_id
  for update;
  if not found or v_call.worker_id is null then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;

  insert into public.facetime_sessions (
    project_id, call_id, line_id, worker_id, kind, room_reference,
    expected_participant_identity, expires_at
  ) values (
    p_project_id, p_call_id, v_call.line_id, v_call.worker_id, p_kind,
    p_room_reference, p_expected_participant_identity, p_expires_at
  ) returning * into v_session;

  insert into public.facetime_worker_commands (
    worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
  ) values (
    v_session.worker_id,
    v_session.call_id,
    v_session.line_id,
    'start_bridge',
    jsonb_build_object(
      'schema_version', 1,
      'session_id', v_session.id,
      'call_id', v_session.call_id,
      'line_id', v_session.line_id,
      'worker_id', v_session.worker_id,
      'room_reference', v_session.room_reference,
      'expected_participant_identity', v_session.expected_participant_identity
    ),
    'start_bridge:' || v_session.id::text,
    now() + interval '2 minutes'
  );

  return v_session;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_transition_session(p_project_id uuid, p_session_id uuid, p_state facetime_session_state, p_at timestamp with time zone, p_terminal_reason text DEFAULT NULL::text, p_terminal_reason_detail text DEFAULT NULL::text)
 RETURNS facetime_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.facetime_sessions%rowtype;
begin
  select * into v_session
  from public.facetime_sessions
  where id = p_session_id and project_id = p_project_id
  for update;
  if not found then raise exception 'session_not_found' using errcode = 'P0002'; end if;

  if not (
    (v_session.state = 'created' and p_state in ('dispatched', 'failed'))
    or (v_session.state = 'dispatched' and p_state in ('active', 'failed'))
    or (v_session.state = 'active' and p_state in ('ended', 'expired', 'failed'))
    or (v_session.state in ('ended', 'expired', 'failed') and p_state = 'cleaned')
  ) then
    raise exception 'invalid_session_transition' using errcode = '55000';
  end if;

  update public.facetime_sessions set
    state = p_state,
    dispatched_at = case when p_state = 'dispatched' then p_at else dispatched_at end,
    active_at = case when p_state = 'active' then p_at else active_at end,
    ended_at = case when p_state = 'ended' then p_at else ended_at end,
    expired_at = case when p_state = 'expired' then p_at else expired_at end,
    failed_at = case when p_state = 'failed' then p_at else failed_at end,
    cleaned_at = case when p_state = 'cleaned' then p_at else cleaned_at end,
    terminal_reason = case
      when p_state = 'failed' then coalesce(p_terminal_reason, 'bridge_failed')
      when p_state in ('ended', 'expired') then p_terminal_reason
      else terminal_reason
    end,
    terminal_reason_detail = case
      when p_state in ('ended', 'expired', 'failed') then p_terminal_reason_detail
      else terminal_reason_detail
    end
  where id = p_session_id
  returning * into v_session;

  if p_state in ('ended', 'expired', 'failed') then
    perform public.facetime_enqueue_session_stop(v_session);
  end if;
  return v_session;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_expire_session(p_project_id uuid, p_session_id uuid, p_at timestamp with time zone)
 RETURNS facetime_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.facetime_sessions%rowtype;
begin
  select * into v_session
  from public.facetime_sessions
  where id = p_session_id and project_id = p_project_id
  for update;
  if not found then raise exception 'session_not_found' using errcode = 'P0002'; end if;
  if v_session.state = 'expired' then return v_session; end if;
  if v_session.state <> 'active' or v_session.expires_at > p_at then
    raise exception 'invalid_session_transition' using errcode = '55000';
  end if;
  update public.facetime_sessions
  set state = 'expired', expired_at = p_at, terminal_reason = 'session_expired'
  where id = p_session_id returning * into v_session;
  perform public.facetime_enqueue_session_stop(v_session);
  return v_session;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_sweep_expired_sessions(p_project_id uuid, p_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.facetime_sessions%rowtype;
  v_count integer := 0;
begin
  for v_session in
    select * from public.facetime_sessions
    where project_id = p_project_id and state = 'active' and expires_at <= p_at
    order by expires_at, id
    for update skip locked
  loop
    update public.facetime_sessions
    set state = 'expired', expired_at = p_at, terminal_reason = 'session_expired'
    where id = v_session.id returning * into v_session;
    perform public.facetime_enqueue_session_stop(v_session);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_claim_worker_command(p_worker_id uuid, p_lease_owner text, p_lease_token_hash text, p_lease_seconds integer DEFAULT 30)
 RETURNS SETOF facetime_worker_commands
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_command_id uuid;
  v_command public.facetime_worker_commands%rowtype;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 120 then raise exception 'invalid_lease_duration' using errcode = '22023'; end if;
  -- Preserve the deployed inbound expiration/exhaustion reconciliation.
  perform public.facetime_reconcile_expired_worker_commands(p_worker_id);
  update public.facetime_worker_commands
  set status = 'expired', error_code = 'command_expired',
      completed_at = coalesce(completed_at, now()),
      lease_owner = null, lease_token_hash = null, lease_expires_at = null
  where worker_id = p_worker_id and command_type <> 'start_bridge'
    and status in ('queued', 'leased') and expires_at <= now();

  with uncertain as (
    select c.id,c.line_id from public.facetime_calls c
    join public.facetime_worker_commands q on q.call_id=c.id and q.worker_id=c.worker_id
    where c.worker_id=p_worker_id and q.command_type='place_call'
      and q.payload->>'outbound_audio_protocol'='1'
      and (q.status in ('expired','failed') or (q.status='leased' and q.lease_expires_at<=now() and q.attempt_count>=q.maximum_attempts))
      and c.status not in ('ended','failed','rejected')
  ) insert into public.facetime_worker_commands(worker_id,call_id,line_id,command_type,payload,idempotency_key,expires_at)
    select p_worker_id,id,line_id,'end_call',jsonb_build_object('schema_version',1),
      'outbound_recovery:'||id::text,now()+interval '24 hours' from uncertain
    on conflict do nothing;
  update public.facetime_workers w set status='offline'
    where w.id=p_worker_id and exists(select 1 from public.facetime_worker_commands q
      where q.worker_id=w.id and q.call_id=w.current_call_id and q.idempotency_key='outbound_recovery:'||w.current_call_id::text);

  select id into v_command_id
  from public.facetime_worker_commands
  where worker_id = p_worker_id
    and expires_at > now()
    and attempt_count < maximum_attempts
    and available_at <= now()
    and (status = 'queued' or (status = 'leased' and lease_expires_at <= now()))
  order by available_at, created_at, id
  for update skip locked
  limit 1;

  if v_command_id is null then return; end if;
  update public.facetime_worker_commands
  set status = 'leased', lease_owner = p_lease_owner, lease_token_hash = p_lease_token_hash,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempt_count = attempt_count + 1
  where id = v_command_id
  returning * into v_command;

  if v_command.command_type::text = 'start_bridge' or
    (v_command.command_type='place_call' and v_command.payload->>'outbound_audio_protocol'='1') then
    update public.facetime_sessions
    set state = 'dispatched', dispatched_at = now()
    where id = (v_command.payload->>'session_id')::uuid
      and worker_id = p_worker_id and state = 'created';
  end if;
  return next v_command;
end;
$function$
;
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
CREATE OR REPLACE FUNCTION public.facetime_lease_webhook_events(p_now timestamp with time zone, p_lease_owner text, p_lease_seconds integer DEFAULT 30)
 RETURNS SETOF facetime_webhook_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_id uuid;
begin
  for v_id in
    select event_id from public.facetime_webhook_events
    where state in ('pending', 'delivering')
      and next_attempt_at <= p_now
      and (state = 'pending' or lease_expires_at <= p_now)
    order by next_attempt_at, created_at, event_id
    for update skip locked
  loop
    return query
      update public.facetime_webhook_events
      set state = 'delivering', lease_owner = p_lease_owner,
          lease_expires_at = p_now + make_interval(secs => p_lease_seconds)
      where event_id = v_id
      returning *;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_stamp_webhook_ingestion_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.payload ? '__b3_received_at' then
    new.created_at := (new.payload->>'__b3_received_at')::timestamptz;
    new.payload := new.payload - '__b3_received_at';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_register_inbound_call_b3(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result jsonb; project uuid;
begin
 result := public.facetime_register_inbound_call(p_worker_id,p_call_id,p_line_id,p_source_event_id,p_masked_identity,p_media,p_payload);
 select project_id into project from public.facetime_calls where id=p_call_id and worker_id=p_worker_id and line_id=p_line_id;
 if not found then raise exception 'call_not_found' using errcode='P0002'; end if;
 return result || public.facetime_pinned_incoming_context(project,p_worker_id,p_call_id,p_source_event_id);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_tombstone_session_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.state in ('ended', 'expired', 'failed', 'cleaned') then
    update public.facetime_session_credential_seals
    set state = 'tombstoned',
      deleted_at = coalesce(deleted_at, now()),
      livekit_url_ciphertext = null,
      participant_token_ciphertext = null
    where session_id = new.id and state = 'sealed';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_redeem_session_credentials(p_project_id uuid, p_worker_id uuid, p_session_id uuid, p_command_id uuid, p_lease_token_hash text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_seal public.facetime_session_credential_seals%rowtype; v_command public.facetime_worker_commands%rowtype;
begin
  select * into v_seal from public.facetime_session_credential_seals where session_id=p_session_id for update;
  if not found or v_seal.project_id<>p_project_id or v_seal.worker_id<>p_worker_id then
    raise exception 'credential_not_found' using errcode='P0002';
  end if;
  if v_seal.state='consumed' then raise exception 'credential_consumed' using errcode='55000'; end if;
  if v_seal.state<>'sealed' then raise exception 'credential_not_found' using errcode='P0002'; end if;
  if v_seal.lease_expires_at<=p_now or v_seal.token_expires_at<=p_now then
    raise exception 'session_expired' using errcode='55000';
  end if;
  select * into v_command from public.facetime_worker_commands where id=p_command_id and worker_id=p_worker_id
    and (command_type='start_bridge' or (command_type='place_call' and payload->>'outbound_audio_protocol'='1'))
    and status='leased' and lease_token_hash=p_lease_token_hash
    and lease_expires_at>p_now and (payload->>'session_id')::uuid=p_session_id for update;
  if not found then raise exception 'credential_not_found' using errcode='P0002'; end if;
  if v_command.command_type='place_call' and not exists (
    select 1 from public.facetime_sessions s
    join public.facetime_calls c on c.id=s.call_id and c.project_id=s.project_id
    join public.facetime_workers w on w.id=s.worker_id
    join public.facetime_lines l on l.id=s.line_id and l.project_id=s.project_id and l.worker_id=w.id
    where s.id=p_session_id and s.project_id=p_project_id and s.worker_id=p_worker_id
      and s.call_id=v_command.call_id and s.line_id=v_command.line_id
      and v_command.payload->>'call_id'=c.id::text and v_command.payload->>'line_id'=l.id::text
      and v_command.payload->>'worker_id'=w.id::text
      and w.current_call_id=c.id and l.current_call_id=c.id
      and c.status not in ('ending','ended','failed','rejected')
      and s.state='dispatched' and s.expires_at>p_now and v_command.expires_at>p_now
      and (v_command.command_type='start_bridge' or
        (c.direction='outbound' and c.mode='customer_managed'
          and v_command.payload->>'project_id'=p_project_id::text))
  ) then raise exception 'credential_not_found' using errcode='P0002'; end if;
  update public.facetime_session_credential_seals set state='consumed' , consumed_at=p_now,
    livekit_url_ciphertext=null, participant_token_ciphertext=null where id=v_seal.id;
  return jsonb_build_object('livekit_url_ciphertext',v_seal.livekit_url_ciphertext,
    'participant_token_ciphertext',v_seal.participant_token_ciphertext,
    'remote_participant_identity',(select expected_participant_identity from public.facetime_sessions where id=p_session_id));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_project_for_user(p_user_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ declare v_project_id uuid := gen_random_uuid(); v_slug_prefix text; begin if p_user_id is null then raise exception 'authentication_required' using errcode = '28000'; end if; v_slug_prefix := nullif(left(trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g')), 30), ''); insert into public.facetime_projects(id, slug, name) values (v_project_id, coalesce(v_slug_prefix, 'project') || '-' || replace(v_project_id::text, '-', ''), btrim(p_name)); insert into public.facetime_project_memberships(project_id, user_id, role) values (v_project_id, p_user_id, 'owner'); return v_project_id; end; $function$
;
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
;
CREATE OR REPLACE FUNCTION public.facetime_record_blocked_delivery(p_project_id uuid, p_call_id uuid, p_transition text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 insert into public.facetime_call_events(project_id,call_id,event_type,source,source_event_id,payload)
 values(p_project_id,p_call_id,'webhook_delivery_blocked','control_plane',
 'webhook_blocked:'||p_call_id::text||':'||p_transition||':'||p_reason,
 jsonb_build_object('transition',p_transition,'reason',p_reason))
 on conflict do nothing;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_commit_incoming_webhook_decision(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_action text, p_reason text, p_expected_participant_identity text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_event public.facetime_call_events%rowtype;
  v_call public.facetime_calls%rowtype;
  v_session public.facetime_sessions%rowtype;
  v_reason text;
begin
  select * into v_call from public.facetime_calls
  where project_id = p_project_id and id = p_call_id
  for update;
  if not found then raise exception 'call_not_found' using errcode = 'P0002'; end if;

  if v_call.incoming_webhook_source_event_id = p_source_event_id
    and v_call.incoming_webhook_decision is not null then
    if v_call.incoming_webhook_decision->>'action' = 'decline'
      and v_call.status in ('ended', 'failed', 'rejected') then
      update public.facetime_workers
      set current_call_id = null
      where id = v_call.worker_id and current_call_id = p_call_id;
      update public.facetime_lines
      set current_call_id = null, status = 'available'
      where id = v_call.line_id and project_id = p_project_id
        and worker_id = v_call.worker_id and current_call_id = p_call_id;
    end if;
    return v_call.incoming_webhook_decision;
  end if;

  select * into v_event from public.facetime_call_events
  where project_id = p_project_id and call_id = p_call_id
    and source = 'worker' and source_event_id = p_source_event_id and event_type='incoming_registered';
  if not found then raise exception 'call_not_found' using errcode = 'P0002'; end if;

  if p_action = 'accept' then
    perform public.facetime_guard_incoming_accept(p_project_id,p_call_id,p_source_event_id);
    if v_call.status <> 'incoming' then
      raise exception 'call_not_incoming' using errcode = '55000';
    end if;
    if p_expected_participant_identity is null or btrim(p_expected_participant_identity) = '' then
      raise exception 'invalid_webhook_response' using errcode = '22023';
    end if;
    select * into v_session from public.facetime_create_session(
      p_project_id, p_call_id, 'customer_room', 'customer:' || p_call_id::text,
      p_expected_participant_identity, now() + interval '2 hours'
    );
    update public.facetime_calls set
      incoming_webhook_source_event_id = p_source_event_id,
      incoming_webhook_decision = jsonb_build_object('action', 'accept')
    where id = p_call_id and project_id = p_project_id;
    return jsonb_build_object('action', 'accept');
  end if;

  if p_action <> 'decline' then
    raise exception 'invalid_webhook_response' using errcode = '22023';
  end if;
  if v_call.status <> 'incoming' then
    raise exception 'call_not_incoming' using errcode = '55000';
  end if;

  v_reason := case when p_reason in (
    'webhook_deadline_exceeded', 'webhook_transport_error', 'webhook_non_2xx',
    'webhook_malformed_response', 'webhook_declined', 'webhook_unavailable',
    'invalid_token_grants', 'invalid_livekit_url', 'invalid_participant_identity',
    'session_expired'
  ) then p_reason else 'webhook_failure' end;

  update public.facetime_calls set
    status = 'rejected', terminal_reason = 'webhook_timeout_declined',
    ended_at = coalesce(ended_at, now()),
    incoming_webhook_source_event_id = p_source_event_id,
    incoming_webhook_decision = jsonb_build_object(
      'action', 'decline', 'reason', v_reason)
  where id = p_call_id and project_id = p_project_id;

  update public.facetime_workers
  set current_call_id = null
  where id = v_call.worker_id and current_call_id = p_call_id;

  update public.facetime_lines
  set current_call_id = null, status = 'available'
  where id = v_call.line_id and project_id = p_project_id
    and worker_id = v_call.worker_id and current_call_id = p_call_id;

  return jsonb_build_object('action', 'decline', 'reason', v_reason);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_pinned_incoming_context(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_source_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c public.facetime_calls%rowtype; r public.facetime_integration_revisions%rowtype;
 s public.facetime_webhook_secret_versions%rowtype;
begin
 select * into c from public.facetime_calls where id=p_call_id and project_id=p_project_id and worker_id=p_worker_id;
 if not found or not exists(select 1 from public.facetime_call_events where project_id=p_project_id and call_id=p_call_id
   and source='worker' and source_event_id=p_source_event_id and event_type='incoming_registered') then
  raise exception 'call_not_found' using errcode='P0002'; end if;
 if c.incoming_webhook_decision is not null then return jsonb_build_object('webhook_decision',c.incoming_webhook_decision); end if;
 if c.binding_disposition='legacy_unresolved' then
  perform public.facetime_record_blocked_delivery(p_project_id,p_call_id,'call.incoming','legacy_unresolved');
  return '{}'::jsonb;
 end if;
 if c.mode='managed' or c.resolved_inbound_policy <> 'customer_decides' then return '{}'::jsonb; end if;
 if c.binding_disposition <> 'pinned' then return jsonb_build_object('webhook_unavailable',true); end if;
 select * into r from public.facetime_integration_revisions where id=c.integration_revision_id and project_id=p_project_id;
 perform 1 from public.facetime_webhook_endpoints where id=r.integration_id and project_id=p_project_id for update;
 select * into s from public.facetime_webhook_secret_versions where id=r.secret_version_id and project_id=p_project_id;
 if s.revoked_at is not null then return jsonb_build_object('webhook_unavailable',true); end if;
 return jsonb_build_object('webhook_endpoint',jsonb_build_object('endpoint_url',r.endpoint_url,'payload_version',r.payload_version),
  'webhook_signing_enabled',r.signing_enabled,'webhook_secret_ciphertext',s.ciphertext,'webhook_secret_key_version',s.encryption_key_version,
  'webhook_secret_version',r.secret_version,'webhook_call',c.incoming_request_data,
  'webhook_allowed_hosts',r.livekit_allowed_hosts,'webhook_request_id',c.incoming_request_id,
  'webhook_created_at',c.incoming_request_created_at,'webhook_deadline_at',c.incoming_decision_deadline_at);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_reconcile_failed_start_bridge(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_session_id uuid, p_command_id uuid, p_terminal_reason_detail text DEFAULT 'start_bridge_command_failed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_command public.facetime_worker_commands%rowtype;
  v_call public.facetime_calls%rowtype;
  v_session public.facetime_sessions%rowtype;
  v_detail text := left(coalesce(nullif(p_terminal_reason_detail, ''), 'start_bridge_command_failed'), 240);
  v_was_nonterminal boolean;
begin
  select * into v_command
  from public.facetime_worker_commands
  where id = p_command_id and worker_id = p_worker_id
  for update;
  if not found or v_command.command_type <> 'start_bridge'
    or v_command.call_id is distinct from p_call_id
    or (v_command.payload->>'session_id')::uuid is distinct from p_session_id
    or (v_command.payload->>'call_id')::uuid is distinct from p_call_id
    or (v_command.payload->>'line_id')::uuid is distinct from v_command.line_id
    or (v_command.payload->>'worker_id')::uuid is distinct from p_worker_id then
    raise exception 'command_not_found' using errcode = 'P0002';
  end if;
  if v_command.status not in ('failed', 'expired') then
    raise exception 'command_not_terminal' using errcode = '55000';
  end if;

  select * into v_call
  from public.facetime_calls
  where id = v_command.call_id and project_id = p_project_id and worker_id = p_worker_id
  for update;
  if not found or v_call.line_id is distinct from v_command.line_id then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;

  select * into v_session
  from public.facetime_sessions
  where id = p_session_id and project_id = p_project_id and call_id = v_call.id
    and worker_id = p_worker_id and line_id = v_call.line_id
  for update;
  if not found then raise exception 'session_not_found' using errcode = 'P0002'; end if;

  v_was_nonterminal := v_call.status not in ('ended', 'failed', 'rejected');
  if v_was_nonterminal then
    update public.facetime_calls set
      status = 'failed', ended_at = now(), terminal_reason = 'unknown',
      terminal_reason_detail = v_detail
    where id = v_call.id and project_id = p_project_id;
  end if;

  update public.facetime_sessions set
    state = 'cleaned', failed_at = coalesce(failed_at, now()),
    cleaned_at = coalesce(cleaned_at, now()),
    terminal_reason = coalesce(terminal_reason, 'bridge_failed'),
    terminal_reason_detail = coalesce(terminal_reason_detail, v_detail)
  where id = p_session_id and project_id = p_project_id;

  update public.facetime_session_credential_seals set
    state = 'tombstoned', deleted_at = coalesce(deleted_at, now()),
    livekit_url_ciphertext = null, participant_token_ciphertext = null
  where session_id = p_session_id and project_id = p_project_id and worker_id = p_worker_id
    and state in ('sealed', 'consumed', 'tombstoned');

  if v_was_nonterminal then
    insert into public.facetime_call_events (
      call_id, project_id, event_type, payload, source, source_event_id
    ) values (
      v_call.id, p_project_id, 'failed',
      jsonb_build_object('__b1_terminal_reason', 'unknown', '__b1_terminal_reason_detail', v_detail),
      'control_plane', 'start_bridge_failed:' || p_command_id::text
    ) on conflict (source, source_event_id) do nothing;
  end if;

  insert into public.facetime_call_events (
    call_id, project_id, event_type, payload, source, source_event_id
  ) values (
    v_call.id, p_project_id, 'cleanup_complete', '{}'::jsonb,
    'control_plane', 'start_bridge_cleanup:' || p_command_id::text
  ) on conflict (source, source_event_id) do nothing;

  update public.facetime_workers set current_call_id = null
  where id = p_worker_id and current_call_id = v_call.id;
  update public.facetime_lines set current_call_id = null, status = 'available'
  where id = v_call.line_id and project_id = p_project_id and worker_id = p_worker_id
    and current_call_id = v_call.id;

  return jsonb_build_object('reconciled', true, 'call_id', v_call.id, 'session_id', v_session.id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_reconcile_expired_worker_commands(p_worker_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_command public.facetime_worker_commands%rowtype;
  v_project_id uuid;
  v_count integer := 0;
begin
  for v_command in
    select * from public.facetime_worker_commands
    where worker_id = p_worker_id and command_type = 'start_bridge'
      and (
        (status in ('queued', 'leased') and expires_at <= now())
        or (status in ('queued', 'leased') and attempt_count >= maximum_attempts
          and (status = 'queued' or lease_expires_at <= now()))
      )
    order by created_at, id
    for update skip locked
  loop
    update public.facetime_worker_commands set
      status = case when v_command.expires_at <= now()
        then 'expired'::public.facetime_command_status
        else 'failed'::public.facetime_command_status end,
      error_code = case when v_command.expires_at <= now()
        then 'command_expired' else 'command_attempts_exhausted' end,
      completed_at = coalesce(completed_at, now()),
      lease_owner = null, lease_token_hash = null, lease_expires_at = null
    where id = v_command.id
    returning * into v_command;

    select project_id into v_project_id from public.facetime_calls
    where id = v_command.call_id and worker_id = p_worker_id;
    if v_project_id is null then raise exception 'call_not_found' using errcode = 'P0002'; end if;
    perform public.facetime_reconcile_failed_start_bridge(
      v_project_id, p_worker_id, v_command.call_id,
      (v_command.payload->>'session_id')::uuid, v_command.id, v_command.error_code
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_integration_secret_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 perform 1 from public.facetime_webhook_endpoints where id = new.endpoint_id and project_id = new.project_id for update;
 if not found then raise exception 'integration_not_found' using errcode='23503'; end if;
 if tg_op = 'UPDATE' and (new.id, new.endpoint_id, new.project_id, new.version, new.ciphertext, new.encryption_key_version)
   is distinct from (old.id, old.endpoint_id, old.project_id, old.version, old.ciphertext, old.encryption_key_version) then
   raise exception 'signing_version_immutable' using errcode='55000';
 end if;
 if tg_op = 'UPDATE' and ((old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  or (old.retired_at is not null and new.retired_at is distinct from old.retired_at)) then
  raise exception 'signing_version_immutable' using errcode='55000';
 end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_line_assignment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if tg_op='DELETE' then raise exception 'configuration_deletion_forbidden' using errcode='55000'; end if;
 if tg_op='UPDATE' and (new.id,new.project_id) is distinct from (old.id,old.project_id) then
  raise exception 'line_identity_immutable' using errcode='55000'; end if;
 if tg_op='INSERT' and new.integration_id is null then
  select id into new.integration_id from public.facetime_webhook_endpoints where project_id=new.project_id and legacy_default;
 end if;
 if tg_op='INSERT' or (new.integration_id,new.inbound_policy,new.default_assistant_id)
 is distinct from (old.integration_id,old.inbound_policy,old.default_assistant_id) then
   if new.integration_id is not null then
     perform 1 from public.facetime_webhook_endpoints where id=new.integration_id and project_id=new.project_id;
     if not found then raise exception 'integration_not_found' using errcode='23503'; end if;
   end if;
   if new.integration_id is not null and exists(select 1 from public.realtime_assistants a
     join public.realtime_assistant_versions v on v.id=a.active_version_id and v.project_id=a.project_id
     where a.id=new.default_assistant_id and a.project_id=new.project_id and a.status='active'
       and coalesce(v.config->>'inbound_policy',new.inbound_policy::text)='customer_decides') then
     raise exception 'ambiguous_decision_authority' using errcode='55000';
   end if;
   new.assignment_generation := case when tg_op='INSERT' then 1 else old.assignment_generation+1 end;
   insert into public.facetime_configuration_audit(project_id,resource_type,resource_id,operation,previous_configuration,next_configuration)
   values(new.project_id,'line_assignment',new.id,tg_op,
    case when tg_op='UPDATE' then jsonb_build_object('integration_id',old.integration_id,'generation',old.assignment_generation,
      'assistant_id',old.default_assistant_id,'policy',old.inbound_policy) else null end,
    jsonb_build_object('integration_id',new.integration_id,'generation',new.assignment_generation,
      'assistant_id',new.default_assistant_id,'policy',new.inbound_policy));
 elsif new.assignment_generation is distinct from old.assignment_generation then
   raise exception 'assignment_generation_immutable' using errcode='55000';
 end if;
 return new;
end; $function$
;
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
CREATE OR REPLACE FUNCTION public.facetime_commit_incoming_byor_decision(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_session_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_call public.facetime_calls%rowtype; v_event public.facetime_call_events%rowtype;
begin
  perform public.facetime_guard_incoming_accept(p_project_id,p_call_id,p_source_event_id);
  select * into v_call from public.facetime_calls where project_id=p_project_id and id=p_call_id for update;
  if not found then raise exception 'call_not_found' using errcode='P0002'; end if;
  if v_call.incoming_webhook_decision is not null then
    return v_call.incoming_webhook_decision;
  end if;
  select * into v_event from public.facetime_call_events where project_id=p_project_id and call_id=p_call_id
    and source='worker' and source_event_id=p_source_event_id;
  if not found then raise exception 'call_not_found' using errcode='P0002'; end if;
  perform public.facetime_insert_sealed_session(p_project_id,p_call_id,p_session_id,v_call.worker_id,
    p_room_reference,p_expected_participant_identity,p_token_expires_at,p_lease_expires_at,
    p_livekit_url_ciphertext,p_participant_token_ciphertext,p_token_fingerprint,p_encryption_key_version);
  update public.facetime_calls set incoming_webhook_source_event_id=p_source_event_id,
    incoming_webhook_decision=jsonb_build_object('action','accept')
    where id=p_call_id and project_id=p_project_id;
  return jsonb_build_object('action','accept');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_manage_integration(p_project_id uuid, p_integration_id uuid, p_action text, p_input jsonb, p_ciphertext text DEFAULT NULL::text, p_key_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e public.facetime_webhook_endpoints%rowtype; sid uuid; version_number integer; was_signed boolean;
begin
 -- Serialize legacy-default creation, configuration edits and secret allocation.
 perform 1 from public.facetime_projects where id=p_project_id for update;
 if not found then raise exception 'project_not_found' using errcode='P0002'; end if;
 if p_action='create' then
  if exists(select 1 from public.facetime_calls where project_id=p_project_id and binding_disposition='legacy_unresolved'
   and status not in ('ended','failed','rejected')) then raise exception 'legacy_drain_required' using errcode='55000'; end if;
  insert into public.facetime_webhook_endpoints(project_id,name,endpoint_url,enabled,payload_version,legacy_default,livekit_allowed_hosts,signing_enabled)
  values(p_project_id,coalesce(p_input->>'name','Default integration'),p_input->>'endpoint_url',
   coalesce((p_input->>'enabled')::boolean,true),1,coalesce((p_input->>'legacy_default')::boolean,false),
   case when p_input ? 'livekit_allowed_hosts' then array(select jsonb_array_elements_text(p_input->'livekit_allowed_hosts')) else null end,coalesce((p_input->>'signing_enabled')::boolean,p_ciphertext is not null))
  returning * into e;
 else
  select * into e from public.facetime_webhook_endpoints where id=p_integration_id and project_id=p_project_id for update;
  if not found then raise exception 'integration_not_found' using errcode='P0002'; end if;
 end if;
 was_signed := e.signing_enabled;
 if p_action='update' then
  if exists(select 1 from public.facetime_calls where project_id=p_project_id and binding_disposition='legacy_unresolved'
   and status not in ('ended','failed','rejected')) then raise exception 'legacy_drain_required' using errcode='55000'; end if;
  update public.facetime_webhook_endpoints set
   name=coalesce(p_input->>'name',name),endpoint_url=coalesce(p_input->>'endpoint_url',endpoint_url),
   signing_enabled=coalesce((p_input->>'signing_enabled')::boolean,signing_enabled),
   enabled=coalesce((p_input->>'enabled')::boolean,enabled),
   livekit_allowed_hosts=case when p_input ? 'livekit_allowed_hosts' then array(select jsonb_array_elements_text(p_input->'livekit_allowed_hosts')) else livekit_allowed_hosts end
  where id=e.id;
 end if;
 if (p_action='create' and e.signing_enabled) or p_action='rotate' or (p_action='update' and not was_signed and coalesce((p_input->>'signing_enabled')::boolean,false)) then
  if p_ciphertext is null or p_key_version is null then raise exception 'signing_key_required' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into version_number from public.facetime_webhook_secret_versions where endpoint_id=e.id;
  insert into public.facetime_webhook_secret_versions(project_id,endpoint_id,version,ciphertext,encryption_key_version)
   values(p_project_id,e.id,version_number,p_ciphertext,p_key_version) returning id into sid;
  update public.facetime_webhook_secret_versions set retired_at=clock_timestamp()
   where endpoint_id=e.id and version < version_number-1 and retired_at is null and revoked_at is null;
  if p_action='rotate' then update public.facetime_webhook_endpoints set signing_enabled=true where id=e.id; end if;
 elsif p_action='revoke' then
  update public.facetime_webhook_secret_versions set revoked_at=coalesce(revoked_at,clock_timestamp())
   where id=(p_input->>'version_id')::uuid and endpoint_id=e.id and project_id=p_project_id
   returning id,version into sid,version_number;
  if not found then raise exception 'secret_version_not_found' using errcode='P0002'; end if;
 elsif p_action not in ('create','update') then raise exception 'invalid_integration_operation' using errcode='22023';
 end if;
 return jsonb_build_object('integration_id',e.id,'secret_version_id',sid,'secret_version',version_number);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_project_hosts_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e record;
begin
 if tg_op='DELETE' then raise exception 'configuration_deletion_forbidden' using errcode='55000'; end if;
 for e in select id from public.facetime_webhook_endpoints where project_id=new.project_id and livekit_allowed_hosts is null order by id loop
  perform public.facetime_publish_integration_revision(e.id);
 end loop;
 insert into public.facetime_configuration_audit(project_id,resource_type,resource_id,operation,previous_configuration,next_configuration)
 values(new.project_id,'project_hosts',new.project_id,tg_op,
  case when tg_op='UPDATE' then jsonb_build_object('livekit_allowed_hosts',old.livekit_allowed_hosts) else null end,
  jsonb_build_object('livekit_allowed_hosts',new.livekit_allowed_hosts));
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_authorize_webhook_send(p_project_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e public.facetime_webhook_events%rowtype; s public.facetime_webhook_secret_versions%rowtype;
begin
 select * into e from public.facetime_webhook_events where event_id=p_event_id and project_id=p_project_id;
 if not found then raise exception 'webhook_not_found' using errcode='P0002'; end if;
 perform 1 from public.facetime_webhook_endpoints where id=e.endpoint_id and project_id=p_project_id for update;
 if exists(select 1 from public.facetime_calls c join public.facetime_integration_revisions r on r.id=c.integration_revision_id
  where c.id=e.call_id and c.project_id=p_project_id and not r.signing_enabled) then
  return jsonb_build_object('signing_enabled',false);
 end if;
 select * into s from public.facetime_webhook_secret_versions where id=e.secret_version_id and endpoint_id=e.endpoint_id and project_id=p_project_id;
 if not found or s.revoked_at is not null then
  perform public.facetime_record_blocked_delivery(p_project_id,e.call_id,e.event_type,'signing_version_revoked');
  update public.facetime_webhook_events set state='dead_letter',dead_letter_at=clock_timestamp(),last_error='signing_version_revoked',
   lease_owner=null,lease_expires_at=null where event_id=e.event_id;
  return jsonb_build_object('blocked',true);
 end if;
 return jsonb_build_object('version',e.secret_version,'ciphertext',s.ciphertext,'encryption_key_version',s.encryption_key_version);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_outbound_byor_call(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_existing uuid; v_line public.facetime_lines%rowtype; v_worker public.facetime_workers%rowtype; v_call_id uuid;
begin
  select id into v_existing from public.facetime_calls
    where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select * into v_line from public.facetime_lines where id=p_requested_line_id
    and project_id=p_project_id and worker_id=p_worker_id and current_call_id is null for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  select * into v_worker from public.facetime_workers where id=v_line.worker_id
    and enabled and current_call_id is null for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  insert into public.facetime_calls (
    project_id,direction,mode,media,worker_id,line_id,masked_identity,identity_ciphertext,
    identity_type,identity_key_version,identity_retention_until,status,idempotency_key
  ) values (
    p_project_id,'outbound','customer_managed',p_media,v_worker.id,v_line.id,p_masked_destination,
    p_identity_ciphertext,p_identity_type,p_identity_key_version,p_identity_retention_until,
    'allocating',p_idempotency_key
  ) returning id into v_call_id;
  update public.facetime_workers set current_call_id=v_call_id where id=v_worker.id;
  update public.facetime_lines set current_call_id=v_call_id,status='busy' where id=v_line.id;
  insert into public.facetime_call_events(call_id,project_id,event_type,source,source_event_id)
    values(v_call_id,p_project_id,'call_allocated','control_plane','call_allocated:'||v_call_id::text);
  perform public.facetime_insert_sealed_session(p_project_id,v_call_id,p_session_id,v_worker.id,
    p_room_reference,p_expected_participant_identity,p_token_expires_at,p_lease_expires_at,
    p_livekit_url_ciphertext,p_participant_token_ciphertext,p_token_fingerprint,p_encryption_key_version);
  return v_call_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_protect_webhook_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if (new.event_id,new.project_id,new.call_id,new.source_call_event_id,new.endpoint_id,new.endpoint_url,new.secret_version_id,
  new.secret_version,new.event_type,new.logical_transition,new.payload,new.raw_body,new.created_at)
 is distinct from (old.event_id,old.project_id,old.call_id,old.source_call_event_id,old.endpoint_id,old.endpoint_url,old.secret_version_id,
  old.secret_version,old.event_type,old.logical_transition,old.payload,old.raw_body,old.created_at) then
  raise exception 'webhook_snapshot_immutable' using errcode='55000'; end if;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_validate_active_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e public.facetime_webhook_endpoints%rowtype; r public.facetime_integration_revisions%rowtype;
begin
 select * into e from public.facetime_webhook_endpoints where id=new.id;
 select * into r from public.facetime_integration_revisions where integration_id=e.id order by generation desc limit 1;
 if r.id is not null and (e.active_revision_id is distinct from r.id or e.endpoint_url is distinct from r.endpoint_url
  or e.payload_version is distinct from r.payload_version) then
  raise exception 'active_revision_rollback_forbidden' using errcode='55000'; end if;
 return null;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_register_inbound_call_pinned(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 perform 1 from public.facetime_lines where id=p_line_id and project_id=p_project_id and worker_id=p_worker_id for update;
 if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
 return public.facetime_register_inbound_call_b3(p_worker_id,p_call_id,p_line_id,p_source_event_id,p_masked_identity,p_media,p_payload);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_set_project_hosts(p_project_id uuid, p_hosts text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 perform 1 from public.facetime_projects where id=p_project_id for update;
 if not found then raise exception 'project_not_found' using errcode='P0002'; end if;
 insert into public.facetime_project_settings(project_id,livekit_allowed_hosts) values(p_project_id,p_hosts)
 on conflict(project_id) do update set livekit_allowed_hosts=excluded.livekit_allowed_hosts,updated_at=clock_timestamp();
 return jsonb_build_object('livekit_allowed_hosts',p_hosts);
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_register_inbound_call(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_line public.facetime_lines%rowtype;
  v_worker public.facetime_workers%rowtype;
  v_assistant public.realtime_assistants%rowtype;
  v_mode public.facetime_call_mode := 'customer_managed';
  v_version_id uuid;
  v_command_type public.facetime_command_type;
  v_existing_call_id uuid;
  v_managed_available boolean := false;
  v_policy public.facetime_inbound_policy;
  v_version_policy text;
  v_window_id uuid;
  v_development_authorized boolean := false;
begin
  perform 1 from public.facetime_lines where id=p_line_id and worker_id=p_worker_id for update;
  if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
  select call_id into v_existing_call_id
  from public.facetime_call_events
  where source = 'worker' and source_event_id = p_source_event_id;
  if v_existing_call_id is not null then
    if v_existing_call_id <> p_call_id or not exists(select 1 from public.facetime_calls
       where id=v_existing_call_id and worker_id=p_worker_id and line_id=p_line_id) then
      raise exception 'call_not_found' using errcode='P0002'; end if;
    return (select jsonb_build_object('accepted',true,'deduplicated',true,'call_id',id,
      'mode',mode,'policy',resolved_inbound_policy) from public.facetime_calls where id=v_existing_call_id);
  end if;

  select * into v_line
  from public.facetime_lines
  where id = p_line_id and worker_id = p_worker_id
  for update;
  if not found or v_line.project_id is null then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;

  select * into v_worker
  from public.facetime_workers
  where id = p_worker_id
  for update;
  if not found or not v_worker.enabled or v_worker.status = 'offline' then
    raise exception 'worker_unavailable' using errcode = '55000';
  end if;
  if v_line.current_call_id is not null or v_worker.current_call_id is not null then
    raise exception 'line_busy' using errcode = '55000';
  end if;

  if v_line.default_assistant_id is not null then
    select * into v_assistant
    from public.realtime_assistants
    where id = v_line.default_assistant_id
      and project_id = v_line.project_id
      and status = 'active';
    if found and v_assistant.active_version_id is not null then
      v_mode := 'managed';
      v_version_id := v_assistant.active_version_id;
      v_managed_available := true;
      select config->>'inbound_policy' into v_version_policy
      from public.realtime_assistant_versions
      where id = v_version_id and assistant_id = v_assistant.id and project_id = v_line.project_id;
    end if;
  end if;

  v_policy := case
    when v_version_policy in ('auto_answer', 'customer_decides', 'agent_decides', 'auto_reject')
      then v_version_policy::public.facetime_inbound_policy
    else v_line.inbound_policy
  end;

  if v_worker.status = 'development' then
    select id into v_window_id
    from public.facetime_development_windows
    where project_id = v_line.project_id
      and worker_id = p_worker_id
      and line_id = p_line_id
      and purpose = 'inbound'
      and consumed_at is null
      and expires_at > now()
    order by created_at desc
    limit 1
    for update;
    v_development_authorized := v_window_id is not null;
  end if;

  insert into public.facetime_calls (
    id, project_id, direction, mode, media, assistant_id, assistant_version_id,
    worker_id, line_id, masked_identity, status, detected_at, incoming_request_data, incoming_decision_deadline_at
  ) values (
    p_call_id, v_line.project_id, 'inbound', v_mode, p_media,
    case when v_mode = 'managed' then v_assistant.id else null end, v_version_id,
    p_worker_id, p_line_id, p_masked_identity, 'incoming', now(),
    jsonb_build_object('from_handle_hash',p_payload->'from_handle_hash','occurred_at',coalesce(p_payload->'__b1_occurred_at',to_jsonb(now()))),
    clock_timestamp() + make_interval(secs => coalesce((p_payload->>'__li_deadline_ms')::double precision,5000)/1000)
  );
  update public.facetime_workers set current_call_id = p_call_id where id = p_worker_id;
  update public.facetime_lines set current_call_id = p_call_id, status = 'busy' where id = p_line_id;
  insert into public.facetime_call_events (call_id, project_id, event_type, payload, source, source_event_id)
  values (
    p_call_id, v_line.project_id, 'incoming_registered',
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('resolved_inbound_policy', v_policy),
    'worker', p_source_event_id
  );

  v_command_type := case
    when v_policy = 'auto_reject' then 'reject_call'
    when v_policy = 'auto_answer' and v_managed_available and (
      (v_worker.status = 'accepting'
        and (case when v_worker.automatic_readiness_enabled
          then public.facetime_worker_automatic_ready(v_worker,clock_timestamp(),false)
          else coalesce((v_worker.readiness->>'production_media_ready')::boolean,false) end))
      or v_development_authorized
    ) then 'answer_call'
    when v_policy in ('auto_answer', 'agent_decides') and not v_managed_available then 'reject_call'
    else null
  end;

  if v_command_type is not null then
    insert into public.facetime_worker_commands (
      worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
    ) values (
      p_worker_id, p_call_id, p_line_id, v_command_type,
      jsonb_build_object(
        'schema_version', 1,
        'call_id', p_call_id,
        'line_id', p_line_id,
        'mode', v_mode,
        'assistant_version_id', v_version_id,
        'authorized_test_call', v_development_authorized,
        'development_video_test', v_development_authorized and coalesce((p_media->>'video')::boolean, false),
        'development_audio_test', v_development_authorized and coalesce((p_media->>'audio')::boolean, false),
        'policy_reason', case
          when v_command_type = 'reject_call' and not v_managed_available and v_policy <> 'auto_reject'
            then 'managed_assistant_unavailable'
          else null
        end
      ),
      v_command_type::text || ':' || p_call_id::text,
      now() + interval '2 minutes'
    );
    if v_development_authorized then
      update public.facetime_development_windows
      set consumed_at = now()
      where id = v_window_id and consumed_at is null;
    end if;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'deduplicated', false,
    'call_id', p_call_id,
    'mode', v_mode,
    'policy', v_policy,
    'development_authorized', v_development_authorized
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_worker_automatic_ready(p_worker facetime_workers, p_now timestamp with time zone DEFAULT now(), p_require_video boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a jsonb := p_worker.readiness->'automatic'; c jsonb; k text; completed timestamptz;
 required text[] := array['accessibility','facetime_signed_in','audio_devices','facetime_selections','playback_renderer','configuration','control_plane_poll'];
 seen text[] := '{}'; runtime_started timestamptz; suite_completed timestamptz;
begin
 if p_worker.readiness->'automatic_transport_missing' = 'true'::jsonb then return false; end if;
 if a is null or a->>'version' is distinct from '1' or a->>'worker_id' is distinct from p_worker.id::text
  or coalesce(a->>'profile','') not in ('audio','audio_optional_video','audio_video')
  or coalesce(a->>'runtime_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(a->>'sequence','') !~ '^[0-9]+$' or (a->>'sequence')::numeric > 9007199254740991
  or p_worker.last_heartbeat_at is null or p_worker.last_heartbeat_at > p_now
  or p_worker.last_heartbeat_at <= p_now-interval '30 seconds' then return false; end if;
 foreach k in array array['build','device_binding','config_binding'] loop
  if coalesce(a->>k,'') !~ '^[0-9a-f]{64}$' or a->>k is distinct from p_worker.readiness->>k then return false; end if;
 end loop;
 if a->>'runtime_id' is distinct from p_worker.readiness->>'runtime_id' then return false; end if;
 if p_worker.readiness ? 'operating_intent' and (
  p_worker.readiness->'operating_intent'->>'runtime_id' is distinct from a->>'runtime_id'
  or p_worker.readiness->'operating_intent'->>'runtime_started_at' is distinct from a->>'runtime_started_at') then return false; end if;
 runtime_started := (a->>'runtime_started_at')::timestamptz; suite_completed := (a->>'completed_at')::timestamptz;
 if runtime_started is null or suite_completed is null or a->>'started_at' is null
  or not isfinite(runtime_started) or not isfinite(suite_completed)
  or runtime_started > (a->>'started_at')::timestamptz or (a->>'started_at')::timestamptz > suite_completed
  or suite_completed > p_now then return false; end if;
 if a->>'profile'='audio_video' or p_require_video then required := required || array['video_resources','screen_capture']; end if;
 if jsonb_typeof(a->'checks') is distinct from 'array' or jsonb_array_length(a->'checks') > 10 then return false; end if;
 for c in select value from jsonb_array_elements(a->'checks') loop
  k := c->>'id';
  if k is null or k=any(seen) or not k=any(array['accessibility','facetime_signed_in','audio_devices','facetime_selections','playback_renderer','configuration','control_plane_poll','video_resources','screen_capture','system_audio_capture']) then return false; end if;
  if coalesce(c->>'outcome','') not in ('passed','failed','unknown','deferred','at_call_start')
   or (c->>'outcome'='at_call_start' and k <> 'system_audio_capture')
   or not c ? 'code' or (c->'code' <> 'null'::jsonb and coalesce(c->>'code','') not in
    ('unavailable','permission_denied','not_signed_in','timeout','deferred','not_checked','configuration_invalid','device_missing','device_mismatch','device_ambiguous','unsupported_format','wrong_input','selection_mismatch','obs_unavailable','poll_stale','check_failed','runtime_changed'))
   then return false; end if;
  if c->'completed_at' is distinct from 'null'::jsonb then
   if c->>'completed_at' is null then return false; end if;
   completed := (c->>'completed_at')::timestamptz;
   if not isfinite(completed) or completed < runtime_started or completed > suite_completed or completed > p_now then return false; end if;
  end if;
  seen := array_append(seen,k);
  if k='system_audio_capture' then
   if c->>'outcome' is distinct from 'at_call_start' or c->'completed_at' is distinct from 'null'::jsonb then return false; end if;
  elsif k=any(required) then
   if c->>'outcome' is distinct from 'passed' or c->>'completed_at' is null then return false; end if;
   completed := (c->>'completed_at')::timestamptz;
   if completed < runtime_started or completed > suite_completed or completed > p_now or completed <= p_now-interval '90 seconds' then return false; end if;
  end if;
 end loop;
 return required <@ seen and 'system_audio_capture'=any(seen);
exception when data_exception then return false;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_record_worker_heartbeat(p_worker_id uuid, p_status facetime_worker_status, p_readiness jsonb, p_software_version text, p_capabilities jsonb)
 RETURNS facetime_workers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare w public.facetime_workers%rowtype; incoming jsonb := p_readiness->'automatic'; previous jsonb;
 replace_snapshot boolean := true; received timestamptz; projected jsonb;
 intent jsonb := p_readiness->'operating_intent'; previous_intent jsonb;
 replace_intent boolean := false; next_status public.facetime_worker_status;
begin
 select * into w from public.facetime_workers where id=p_worker_id for update;
 if not found then raise exception 'worker_not_found' using errcode='P0002'; end if;
 if not w.automatic_readiness_enabled then raise exception 'automatic_readiness_not_enabled' using errcode='55000'; end if;
 received := clock_timestamp(); previous := w.readiness->'automatic';
 previous_intent := w.readiness->'operating_intent'; next_status := w.status;
 if previous is not null and previous <> 'null'::jsonb then
  if incoming is null or incoming='null'::jsonb then replace_snapshot := false;
  elsif incoming->>'runtime_id'=previous->>'runtime_id' then
   replace_snapshot := incoming->>'runtime_started_at'=previous->>'runtime_started_at'
    and (incoming->>'sequence')::numeric > (previous->>'sequence')::numeric;
  else
   replace_snapshot := (incoming->>'runtime_started_at')::timestamptz > (previous->>'runtime_started_at')::timestamptz
    and (incoming->>'runtime_started_at')::timestamptz <= received;
  end if;
 end if;
 -- Mode intent has its own transport counter. Unchanged or older measurements
 -- never suppress a newer stop/resume intent from the current runtime.
 if jsonb_typeof(intent)='object'
  and intent->>'runtime_id'=incoming->>'runtime_id'
  and intent->>'runtime_id'=p_readiness->>'runtime_id'
  and intent->>'runtime_started_at'=incoming->>'runtime_started_at'
  and coalesce(intent->>'sequence','') ~ '^[0-9]+$'
  and (intent->>'sequence')::numeric <= 9007199254740991
  and (intent->>'runtime_started_at')::timestamptz <= received then
  replace_intent := (previous is null or previous='null'::jsonb
    or (intent->>'runtime_id'=previous->>'runtime_id'
      and intent->>'runtime_started_at'=previous->>'runtime_started_at')
    or (intent->>'runtime_started_at')::timestamptz > (previous->>'runtime_started_at')::timestamptz)
   and (previous_intent is null or previous_intent='null'::jsonb
    or (intent->>'runtime_id'=previous_intent->>'runtime_id'
      and intent->>'runtime_started_at'=previous_intent->>'runtime_started_at'
      and (intent->>'sequence')::numeric > (previous_intent->>'sequence')::numeric)
    or (intent->>'runtime_id'<>previous_intent->>'runtime_id'
      and (intent->>'runtime_started_at')::timestamptz > (previous_intent->>'runtime_started_at')::timestamptz));
 end if;
 if coalesce(replace_intent,false) then next_status := p_status;
 elsif previous_intent is null and intent is null and coalesce(replace_snapshot,false) then
  -- Compatibility for workers predating ordered intent; once an anchor exists,
  -- missing intent can never overwrite a received stop intent.
  next_status := p_status;
 end if;
 projected := case when coalesce(replace_snapshot,false) then p_readiness else w.readiness end;
 projected := projected - 'operating_intent';
 if coalesce(replace_intent,false) then projected := projected || jsonb_build_object('operating_intent',intent);
 elsif previous_intent is not null then projected := projected || jsonb_build_object('operating_intent',previous_intent); end if;
 -- Retain the ordering anchor across a legacy rollback, but immediately stop
 -- admission. A delayed old runtime cannot erase this server-owned marker.
 -- Only accepting a newer automatic snapshot restores current transport.
 if incoming is null or incoming='null'::jsonb then
  projected := projected || jsonb_build_object('automatic_transport_missing',true);
 elsif coalesce(replace_snapshot,false) then
  projected := projected - 'automatic_transport_missing';
 end if;
 w.readiness := projected; w.last_heartbeat_at := received;
 projected := projected || jsonb_build_object('production_media_ready',public.facetime_worker_automatic_ready(w,received,false));
 update public.facetime_workers set software_version=case when replace_snapshot then p_software_version else software_version end,
  capabilities=case when replace_snapshot then p_capabilities else capabilities end,
  status=next_status,readiness=projected,
  last_heartbeat_at=received,last_heartbeat_attempt_at=received,last_heartbeat_rejection_reason=null,updated_at=received
  where id=p_worker_id returning * into w;
 return w;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_enqueue_call_action(p_project_id uuid, p_call_id uuid, p_action text, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_call public.facetime_calls%rowtype;
  v_command_type public.facetime_command_type;
  v_next_status public.facetime_call_status;
  v_command_id uuid;
  v_worker public.facetime_workers%rowtype;
begin
  select * into v_call from public.facetime_calls where id = p_call_id and project_id = p_project_id for update;
  if not found then raise exception 'call_not_found' using errcode = 'P0002'; end if;
  if v_call.status in ('ended', 'failed', 'rejected') then raise exception 'call_terminal' using errcode = '55000'; end if;
  if p_action = 'answer' and v_call.direction = 'inbound' and v_call.status = 'incoming' then
    if v_call.mode='customer_managed' and v_call.resolved_inbound_policy='customer_decides'
      and coalesce(v_call.incoming_webhook_decision->>'action','') <> 'accept' then
      raise exception 'incoming_decision_required' using errcode='55000'; end if;
    select * into v_worker from public.facetime_workers where id=v_call.worker_id;
    if v_worker.automatic_readiness_enabled then
      select * into v_worker from public.facetime_workers where id=v_call.worker_id for update;
    end if;
    if v_worker.automatic_readiness_enabled and (not v_worker.enabled or v_worker.status <> 'accepting'
      or not public.facetime_worker_automatic_ready(v_worker,clock_timestamp(),false)) then
      raise exception 'worker_unavailable' using errcode='55000'; end if;
    v_command_type := 'answer_call'; v_next_status := 'answering';
  elsif p_action = 'reject' and v_call.direction = 'inbound' and v_call.status = 'incoming' then
    v_command_type := 'reject_call'; v_next_status := 'ending';
  elsif p_action = 'end' then
    v_command_type := 'end_call'; v_next_status := 'ending';
  else
    raise exception 'invalid_call_action' using errcode = '55000';
  end if;
  insert into public.facetime_worker_commands (
    worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
  ) values (
    v_call.worker_id, v_call.id, v_call.line_id, v_command_type,
    jsonb_build_object('schema_version', 1, 'call_id', v_call.id, 'line_id', v_call.line_id),
    p_idempotency_key, now() + interval '2 minutes'
  ) returning id into v_command_id;
  update public.facetime_calls set status = v_next_status where id = p_call_id;
  insert into public.facetime_call_events (call_id, project_id, event_type, source, source_event_id)
  values (p_call_id, p_project_id, p_action || '_requested', 'customer', p_idempotency_key);
  return v_command_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_update_project_identity(p_actor uuid, p_project uuid, p_name text, p_domain text, p_logo text, p_platform boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;
begin
 if p_platform then
  perform 1 from public.facetime_platform_admins where user_id=p_actor;
  if not found then raise exception 'platform_admin_required'; end if;
 else
  perform 1 from public.facetime_project_memberships where user_id=p_actor and project_id=p_project and role in ('owner','admin');
  if not found then raise exception 'identity_edit_denied'; end if;
 end if;
 if length(trim(p_name)) not between 1 and 100 then raise exception 'invalid_name'; end if;
 update public.facetime_projects set name=trim(p_name),website_domain=p_domain,logo_data=p_logo where id=p_project
 returning jsonb_build_object('id',id,'name',name,'slug',slug,'website_domain',website_domain,'logo_data',logo_data) into result;
 if result is null then raise exception 'project_not_found'; end if;
 if p_platform then insert into public.facetime_admin_audit(actor_id,project_id,action) values(p_actor,p_project,'updateIdentity'); end if;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_admin_project_summaries(p_actor uuid, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 perform 1 from public.facetime_platform_admins where user_id=p_actor;
 if not found then raise exception 'platform_admin_required'; end if;
 if p_offset<0 or p_offset>100000 or length(p_search)>100 then raise exception 'invalid_page'; end if;
 return query
 select jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug,'website_domain',p.website_domain,'logo_data',p.logo_data,
  'line_count',(select count(*) from public.facetime_lines l where l.project_id=p.id),
  'available_lines',(select count(*) from public.facetime_lines l where l.project_id=p.id and l.status='available'),
  'active_calls',(select count(*) from public.facetime_calls c where c.project_id=p.id and c.status not in ('ended','failed','rejected')),
  'worker_count',(select count(distinct worker_id) from public.facetime_lines l where l.project_id=p.id),
  'workers',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'display_name',w.display_name,'last_heartbeat_at',w.last_heartbeat_at,
   'last_heartbeat_rejection_reason',w.last_heartbeat_rejection_reason,'readiness',jsonb_build_object(
    'audio_ready',w.readiness->'audio_ready','video_ready',w.readiness->'video_ready','evidence_verified_at',w.readiness->'evidence_verified_at',
    'evidence_build',w.readiness->'evidence_build','evidence_device_binding',w.readiness->'evidence_device_binding')))
   from (select w.* from public.facetime_workers w where exists(select 1 from public.facetime_lines l where l.worker_id=w.id and l.project_id=p.id) order by w.id limit 20) w),'[]'::jsonb))
 from (select * from public.facetime_projects where strpos(lower(name),lower(p_search))>0 order by id limit 20 offset p_offset) p;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_media_observation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if tg_op <> 'INSERT' then raise exception 'media_observation_immutable'; end if;
 if not exists(select 1 from public.facetime_calls c where c.id=new.call_id and c.project_id=new.project_id
  and c.worker_id=new.worker_id and c.line_id=new.line_id and new.observed_at>=c.created_at
  and new.observed_at<=coalesce(c.ended_at,clock_timestamp())) then
  raise exception 'media_observation_scope_or_time_invalid';
 end if;
 if not exists(select 1 from public.facetime_project_memberships m where m.project_id=new.project_id and m.user_id=new.observer_id and m.role='owner') then
  raise exception 'media_observation_owner_required';
 end if;
 -- Capture qualification once; a later worker or route change cannot revoke it.
 -- Ignore any supplied value. This is provenance, never admission or worker state.
 select coalesce(new.kind='human_test' and new.outcome='passed'
  and new.build=w.readiness->>'build'
  and new.device_binding=w.readiness->>'device_binding'
  and new.config_binding=w.readiness->>'config_binding'
  and new.runtime_id::text=w.readiness->>'runtime_id'
  and c.binding_disposition in ('pinned','none') and l.worker_id=new.worker_id
  and c.integration_assignment_generation=l.assignment_generation
  and c.integration_revision_id is not distinct from e.active_revision_id
  and (c.mode<>'managed' or (c.assistant_id=l.default_assistant_id and c.assistant_version_id=a.active_version_id)),false)
 into new.recovery_qualified
 from public.facetime_calls c
 join public.facetime_workers w on w.id=new.worker_id
 join public.facetime_lines l on l.id=c.line_id and l.project_id=c.project_id
 left join public.facetime_webhook_endpoints e on e.id=l.integration_id and e.project_id=l.project_id
 left join public.realtime_assistants a on a.id=l.default_assistant_id and a.project_id=l.project_id
 where c.id=new.call_id;
 return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_dashboard_media_observations(p_project_id uuid, p_worker_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb), 'cleanup', (
  select jsonb_build_object('status',case when e.id is not null then 'Passed for last observed call'
   when c.status in ('ended','failed','rejected') then 'Pending / not observed for last call' else 'In progress for current call' end,
   'observed_at',e.occurred_at,'received_at',e.created_at)
  from public.facetime_calls c left join lateral (
   select id,occurred_at,created_at from public.facetime_call_events
   where call_id=c.id and project_id=p_project_id and event_type='cleanup_complete'
   order by occurred_at desc nulls last,created_at desc limit 1
  ) e on true
  where c.project_id=p_project_id and c.worker_id=p_worker_id order by c.created_at desc limit 1
 )) from (
  select o.id,o.line_id,o.capability,o.kind,o.outcome,o.reason,o.observed_at,o.received_at,
   o.build,o.device_binding,o.config_binding,o.runtime_id,o.recovery_qualified,
   case when c.binding_disposition in ('pinned','none') then
    md5(jsonb_build_array(c.mode,c.integration_assignment_generation,c.integration_revision_id,
     c.assistant_id,c.assistant_version_id)::text) else null end as route_scope,
   coalesce(c.binding_disposition in ('pinned','none') and l.worker_id=o.worker_id
    and c.integration_assignment_generation=l.assignment_generation
    and c.integration_revision_id is not distinct from e.active_revision_id
    and (c.mode<>'managed' or (c.assistant_id=l.default_assistant_id and c.assistant_version_id=a.active_version_id)),false) as route_current
  from public.facetime_media_observations o
  join public.facetime_calls c on c.id=o.call_id and c.project_id=o.project_id
  join public.facetime_lines l on l.id=o.line_id and l.project_id=o.project_id
  left join public.facetime_webhook_endpoints e on e.id=l.integration_id and e.project_id=l.project_id
  left join public.realtime_assistants a on a.id=l.default_assistant_id and a.project_id=l.project_id
  where o.project_id=p_project_id and o.worker_id=p_worker_id
  order by o.observed_at desc,o.id limit 1001
 ) s;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_publish_integration_revision(p_integration_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e public.facetime_webhook_endpoints%rowtype; s public.facetime_webhook_secret_versions%rowtype;
 r public.facetime_integration_revisions%rowtype; h text[]; rid uuid;
begin
 select * into e from public.facetime_webhook_endpoints where id=p_integration_id for update;
 if not found then raise exception 'integration_not_found' using errcode='P0002'; end if;
 select * into s from public.facetime_webhook_secret_versions where endpoint_id=e.id and project_id=e.project_id
  and revoked_at is null and retired_at is null order by version desc limit 1;
 if e.signing_enabled and not found then return null; end if;
 if not e.signing_enabled then s := null; end if;
 select * into r from public.facetime_integration_revisions where id=e.active_revision_id;
 select livekit_allowed_hosts into h from public.facetime_project_settings where project_id=e.project_id;
 h := coalesce(e.livekit_allowed_hosts, h, '{}'::text[]);
 if r.id is not null and (r.endpoint_url,r.payload_version,r.secret_version_id,r.livekit_allowed_hosts,r.signing_enabled)
   is not distinct from (e.endpoint_url,e.payload_version,s.id,h,e.signing_enabled) then return r.id; end if;
 insert into public.facetime_integration_revisions(project_id,integration_id,generation,endpoint_url,payload_version,
  livekit_allowed_hosts,secret_version_id,secret_version,signing_enabled)
 values(e.project_id,e.id,coalesce(r.generation,0)+1,e.endpoint_url,e.payload_version,h,s.id,s.version,e.signing_enabled) returning id into rid;
 update public.facetime_webhook_endpoints set active_revision_id=rid where id=e.id;
 return rid;
end; $function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_integration_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if tg_op='DELETE' then raise exception 'configuration_deletion_forbidden' using errcode='55000'; end if;
 insert into public.facetime_configuration_audit(project_id,resource_type,resource_id,operation,previous_configuration,next_configuration)
 values(new.project_id,tg_table_name,new.id,tg_op,
  case when tg_op='UPDATE' then to_jsonb(old)-'ciphertext'-'encryption_key_version' else null end,
  to_jsonb(new)-'ciphertext'-'encryption_key_version');
 if tg_table_name='facetime_webhook_endpoints' then
   if tg_op='INSERT' or (new.endpoint_url,new.payload_version,new.livekit_allowed_hosts,new.signing_enabled) is distinct from (old.endpoint_url,old.payload_version,old.livekit_allowed_hosts,old.signing_enabled) then
     perform public.facetime_publish_integration_revision(new.id);
     if tg_op='INSERT' and new.legacy_default then
       update public.facetime_lines set integration_id=new.id where project_id=new.project_id and integration_id is null;
     end if;
   end if;
 elsif tg_table_name='facetime_webhook_secret_versions' and tg_op='INSERT' then
   perform public.facetime_publish_integration_revision(new.endpoint_id);
 end if;
 return new;
end; $function$
;
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
CREATE OR REPLACE FUNCTION public.facetime_pin_video_framing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
if tg_op = 'INSERT' then
select video_framing into new.video_framing from public.facetime_lines where id = new.line_id and project_id = new.project_id and worker_id = new.worker_id for share;
if not found then raise exception 'line_not_found' using errcode = '23503'; end if;
elsif new.video_framing is distinct from old.video_framing then raise exception 'call_video_framing_immutable' using errcode = '55000'; end if;
return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_admin_users(p_actor uuid, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text, p_exact boolean DEFAULT false)
 RETURNS SETOF jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select * from facetime_private.admin_users(p_actor,p_offset,p_search,p_exact);
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_admin_set_membership(p_actor uuid, p_project uuid, p_user uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous text;
begin
 perform 1 from public.facetime_platform_admins where user_id=p_actor;
 if not found then raise exception 'platform_admin_required'; end if;
 if p_role is not null and p_role not in ('owner','admin','member','viewer') then raise exception 'invalid_role'; end if;
 -- Serialize concurrent owner changes across all members of the target project.
 perform 1 from public.facetime_projects where id=p_project for update;
 if not found then raise exception 'project_not_found'; end if;
 select role into previous from public.facetime_project_memberships where project_id=p_project and user_id=p_user;
 if previous='owner' and p_role is distinct from 'owner' and
   (select count(*) from public.facetime_project_memberships where project_id=p_project and role='owner')<=1 then
  raise exception 'last_owner';
 end if;
 if p_role is null then
  delete from public.facetime_project_memberships where project_id=p_project and user_id=p_user;
 else
  insert into public.facetime_project_memberships(project_id,user_id,role) values(p_project,p_user,p_role)
  on conflict(project_id,user_id) do update set role=excluded.role;
 end if;
 if previous is distinct from p_role then
  insert into public.facetime_membership_audit(actor_id,project_id,target_user_id,old_role,new_role)
  values(p_actor,p_project,p_user,previous,p_role);
 end if;
 return jsonb_build_object('user_id',p_user,'project_id',p_project,'role',p_role);
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_operation(p_worker uuid, p_project uuid, p_action text, p_input jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r facetime_audit_runners; j facetime_audit_runs; old facetime_audit_runs; t timestamptz:=clock_timestamp(); due timestamptz; v text; request_row facetime_audit_requests; slot timestamptz;
begin
 slot:=((t at time zone 'America/New_York')::date - case when (t at time zone 'America/New_York')::time < time '08:00' then 1 else 0 end + time '08:00') at time zone 'America/New_York';
 select * into r from facetime_audit_runners where worker_id=p_worker and project_id=p_project for update;
 if not found or not r.enabled then raise exception 'audit runner unavailable'; end if;
 if not exists(select 1 from facetime_lines where worker_id=p_worker and project_id=p_project)
 or exists(select 1 from facetime_lines where worker_id=p_worker and project_id is distinct from p_project)
 then raise exception 'audit device scope changed'; end if;
 if p_action='request' then
  if p_input->>'request_id' is null or p_input->>'actor_id' is null then raise exception 'request identity required'; end if;
  select * into request_row from facetime_audit_requests where id=(p_input->>'request_id')::uuid;
  if found then
   if request_row.worker_id<>p_worker or request_row.project_id<>p_project or request_row.actor_id<>(p_input->>'actor_id')::uuid then raise exception 'request identity conflict'; end if;
   select * into j from facetime_audit_runs where id=request_row.run_id;
   return jsonb_build_object('run',to_jsonb(j));
  end if;
 end if;
 update facetime_audit_runs set state='incomplete',verdict='incomplete',completed_at=t
 where worker_id=p_worker and ((state='queued' and expires_at<=t) or (state='running' and lease_until<=t));
 if p_action='poll' then
  if p_input->>'credential_hash' is distinct from r.credential_hash or p_input->>'host' is distinct from r.host then raise exception 'audit authentication failed'; end if;
  update facetime_audit_runners set last_seen_at=t where worker_id=p_worker;
 end if;
 if p_action in ('poll','sweep','request') then
  select * into j from facetime_audit_runs where worker_id=p_worker and state in ('queued','running');
  if j.id is null and p_action='request' then
   select * into old from facetime_audit_runs where worker_id=p_worker order by created_at desc limit 1;
   if old.created_at > t-interval '1 minute' then
    insert into facetime_audit_requests(id,worker_id,project_id,actor_id,run_id) values((p_input->>'request_id')::uuid,p_worker,p_project,(p_input->>'actor_id')::uuid,old.id);
    return jsonb_build_object('run',to_jsonb(old)); end if;
  end if;
  if j.id is null and (p_action='request' or r.next_due_at<=t) then
   -- Expired or crashed daily attempts do not cause a catch-up storm.
   if p_action='request' or r.last_scheduled_at is null or r.last_scheduled_at<slot or (p_action='poll' and (r.last_claimed_slot is null or r.last_claimed_slot<slot)) then
    insert into facetime_audit_runs(worker_id,project_id,approved_release,actor_id,trigger,scheduled_at,expires_at)
     values(p_worker,p_project,r.approved_release,(p_input->>'actor_id')::uuid,
      case when r.next_due_at<=t then 'scheduled' else 'manual' end,
      case when r.next_due_at<=t then r.next_due_at end,t+interval '15 minutes') returning * into j;
    if r.next_due_at<=t then update facetime_audit_runners set last_scheduled_at=t where worker_id=p_worker; end if;
   end if;
  elsif j.id is not null and r.next_due_at<=t and (r.last_scheduled_at is null or r.last_scheduled_at < ((t at time zone 'America/New_York')::date - case when (t at time zone 'America/New_York')::time < time '08:00' then 1 else 0 end + time '08:00') at time zone 'America/New_York') then
   -- Link overlapping schedule to the existing manual attempt without a second run.
   update facetime_audit_runs set scheduled_at=r.next_due_at where id=j.id returning * into j;
   update facetime_audit_runners set last_scheduled_at=t where worker_id=p_worker;
  end if;
  if p_action='poll' and j.state='queued' then
   update facetime_audit_runs set state='running',started_at=t,lease_until=t+interval '12 minutes',claim_token=gen_random_uuid() where id=j.id returning * into j;
   if j.scheduled_at is not null then update facetime_audit_runners set last_claimed_slot=slot where worker_id=p_worker; end if;
  end if;
  if p_action='request' then
   insert into facetime_audit_requests(id,worker_id,project_id,actor_id,run_id) values((p_input->>'request_id')::uuid,p_worker,p_project,(p_input->>'actor_id')::uuid,j.id);
  end if;
  if p_action='sweep' then return '{}'::jsonb; end if;
  return jsonb_build_object('run',case when j.id is null then null else to_jsonb(j) end,'next_due_at',r.next_due_at,'approved_release',r.approved_release,'incident',r.incident);
 elsif p_action='offline_report' then
  if p_input->>'credential_hash' is distinct from r.credential_hash then raise exception 'audit authentication failed'; end if;
  due:=(( (p_input->'result'->>'started_at')::timestamptz at time zone 'America/New_York')::date+time '08:00') at time zone 'America/New_York';
  if (p_input->'result'->>'started_at')::timestamptz < due or due<t-interval '7 days' or due>t then raise exception 'invalid offline schedule'; end if;
  -- Imported results are terminal records, never a second executable claim.
  insert into facetime_audit_runs(id,worker_id,project_id,approved_release,trigger,state,created_at,scheduled_at,expires_at,started_at,lease_until,claim_token)
   values((p_input->>'run_id')::uuid,p_worker,p_project,r.approved_release,'scheduled','incomplete',
    (p_input->'result'->>'started_at')::timestamptz,due,due+interval '1 day',
    (p_input->'result'->>'started_at')::timestamptz,(p_input->'result'->>'started_at')::timestamptz+interval '12 minutes',(p_input->>'claim_token')::uuid)
   on conflict(id) do nothing;
  -- A queued due event is fulfilled by this independently completed local run.
  update facetime_audit_runs set state='incomplete',verdict='incomplete',completed_at=t
   where worker_id=p_worker and state='queued' and scheduled_at<=due and created_at<=(p_input->'result'->>'completed_at')::timestamptz;
  update facetime_audit_runners set last_scheduled_at=greatest(last_scheduled_at,due),last_claimed_slot=greatest(last_claimed_slot,due) where worker_id=p_worker;
  return facetime_audit_operation(p_worker,p_project,'report',p_input);
 elsif p_action='report' then
  if p_input->>'credential_hash' is distinct from r.credential_hash then raise exception 'audit authentication failed'; end if;
  select * into j from facetime_audit_runs where id=(p_input->>'run_id')::uuid and worker_id=p_worker and project_id=p_project for update;
  if j.id is null or j.claim_token is null or j.claim_token is distinct from (p_input->>'claim_token')::uuid then raise exception 'invalid audit claim'; end if;
  if j.result is not null then
   if j.result is distinct from p_input->'result' then raise exception 'conflicting audit replay'; end if;
   return jsonb_build_object('accepted',true);
  end if;
  if p_input->'result'->>'host' is distinct from r.host or p_input->'result'->>'approved_release' is distinct from j.approved_release then raise exception 'audit binding mismatch'; end if;
  if (p_input->'result'->>'started_at')::timestamptz < j.started_at-interval '1 minute' or
   (p_input->'result'->>'completed_at')::timestamptz > j.lease_until then raise exception 'invalid report time'; end if;
  -- Defense in depth: all required check IDs, no failed/missing check can become PASS.
  if jsonb_array_length(p_input->'result'->'checks')<>7 or
   (select count(distinct c->>'id') from jsonb_array_elements(p_input->'result'->'checks') c where c->>'id' in ('process','release','repository','environment','recent_failures','readiness','model'))<>7 then raise exception 'missing checks'; end if;
  v:=p_input->>'verdict';
  if exists(select 1 from jsonb_array_elements(p_input->'result'->'checks') c where c->>'status'='fail') then v:='fail';
  elsif exists(select 1 from jsonb_array_elements(p_input->'result'->'checks') c where c->>'status'='missing') then v:='incomplete'; end if;
  update facetime_audit_runs set state=case when v='incomplete' or exists(select 1 from jsonb_array_elements(p_input->'result'->'checks') c where c->>'status'='missing') then 'incomplete' else 'completed' end,
   verdict=v,result=p_input->'result',received_at=t,completed_at=(p_input->'result'->>'completed_at')::timestamptz where id=j.id;
  -- Only completion of a current due attempt advances freshness. Manual never shifts the calendar.
  if j.scheduled_at is not null and j.scheduled_at>=r.next_due_at and v<>'incomplete' and not exists(select 1 from jsonb_array_elements(p_input->'result'->'checks') c where c->>'status'='missing') then
   due:=facetime_audit_next_due(j.started_at);
   update facetime_audit_runners set next_due_at=due where worker_id=p_worker;
  end if;
  return jsonb_build_object('accepted',true);
 else raise exception 'invalid audit operation'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_next_due(p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
AS $function$
 select ((p_now at time zone 'America/New_York')::date +
 case when (p_now at time zone 'America/New_York')::time >= time '08:00' then 1 else 0 end + time '08:00') at time zone 'America/New_York';
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_monitor()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r facetime_audit_runners; j facetime_audit_runs; fingerprint text; t timestamptz:=clock_timestamp();
begin
 for r in select * from facetime_audit_runners where enabled order by worker_id for update skip locked loop
  -- Reassigned devices must be explicitly re-registered, never leak host reports.
  if not exists(select 1 from facetime_lines where worker_id=r.worker_id and project_id=r.project_id)
   or exists(select 1 from facetime_lines where worker_id=r.worker_id and project_id is distinct from r.project_id) then continue; end if;
  perform facetime_audit_operation(r.worker_id,r.project_id,'sweep');
  select * into j from facetime_audit_runs where worker_id=r.worker_id order by created_at desc limit 1;
  fingerprint:=null;
  if r.next_due_at+interval '2 hours'<t then fingerprint:='overdue';
  elsif j.verdict='fail' then
   select 'fail:'||coalesce(string_agg((c->>'id')||':'||coalesce(c->'codes','[]'::jsonb)::text,',' order by c->>'id'),'model') into fingerprint from jsonb_array_elements(j.result->'checks') c where c->>'status'='fail';
  elsif j.state='incomplete' and j.created_at+interval '2 hours'<t then fingerprint:='incomplete';
  end if;
  if fingerprint is not null and fingerprint is distinct from r.incident then
   insert into facetime_audit_notifications(worker_id,project_id,run_id,device_label,kind,fingerprint) values(r.worker_id,r.project_id,j.id,(select display_name from facetime_workers where id=r.worker_id),'failure',fingerprint);
   update facetime_audit_runners set incident=fingerprint,incident_at=t,reminder_sent=false where worker_id=r.worker_id;
  elsif fingerprint is not null and fingerprint=r.incident and not r.reminder_sent and r.incident_at<t-interval '24 hours' then
   insert into facetime_audit_notifications(worker_id,project_id,run_id,device_label,kind,fingerprint) values(r.worker_id,r.project_id,j.id,(select display_name from facetime_workers where id=r.worker_id),'failure',fingerprint);
   update facetime_audit_runners set reminder_sent=true where worker_id=r.worker_id;
  elsif fingerprint is null and r.incident is not null and j.state='completed' and j.verdict in ('pass','warn') and j.created_at>r.incident_at then
   insert into facetime_audit_notifications(worker_id,project_id,run_id,device_label,kind,fingerprint) values(r.worker_id,r.project_id,j.id,(select display_name from facetime_workers where id=r.worker_id),'recovery','recovered');
   update facetime_audit_runners set incident=null,incident_at=null where worker_id=r.worker_id;
  end if;
 end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_claim_notifications()
 RETURNS SETOF facetime_audit_notifications
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 update facetime_audit_notifications set state='failed' where state in ('pending','sending') and (attempts>=3 or created_at<now()-interval '20 hours') and next_attempt_at<=now();
 return query update facetime_audit_notifications set state='sending', attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
 where id in (select id from facetime_audit_notifications where state in ('pending','sending') and attempts<3 and next_attempt_at<=now() order by created_at for update skip locked limit 3) returning *;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_audit_immutable_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if old.result is not null and new is distinct from old then raise exception 'audit report is immutable'; end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_outbound_audio_call(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_existing uuid; v_line public.facetime_lines%rowtype; v_worker public.facetime_workers%rowtype; v_call_id uuid;
begin
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_media is distinct from '{"audio":true,"video":false}'::jsonb
    or p_idempotency_key is null or length(btrim(p_idempotency_key))=0 then
    raise exception 'invalid_outbound_request' using errcode='22023';
  end if;
  -- Serialize concurrent keys even when requests select different lines.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':' || p_idempotency_key, 0));
  select id into v_existing from public.facetime_calls
    where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then
    if not exists(select 1 from public.facetime_calls where id=v_existing
      and outbound_request_fingerprint=p_request_fingerprint and line_id=p_requested_line_id) then
      raise exception 'idempotency_conflict' using errcode='23505';
    end if;
    return v_existing;
  end if;
  if p_lease_expires_at <= now() + interval '90 seconds' then
    raise exception 'session_expired' using errcode='55000';
  end if;
  perform 1 from public.facetime_lines where id=p_requested_line_id and project_id=p_project_id and worker_id=p_worker_id for update;
  if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
  select * into v_line from public.facetime_lines where id=p_requested_line_id
    and project_id=p_project_id and worker_id=p_worker_id and current_call_id is null
    and status='available' and supports_audio for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  select * into v_worker from public.facetime_workers where id=v_line.worker_id
    and enabled and current_call_id is null and status='accepting'
    and last_heartbeat_at > now() - interval '30 seconds'
    and (case when automatic_readiness_enabled
      then public.facetime_worker_automatic_ready(facetime_workers,clock_timestamp(),false)
      else readiness->>'production_media_ready'='true' and readiness->>'audio_ready'='true' end)
    and capabilities->>'audio'='true' and capabilities->>'outbound_audio_protocol'='1'
    for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  insert into public.facetime_calls (
    project_id,direction,mode,media,worker_id,line_id,masked_identity,identity_ciphertext,
    identity_type,identity_key_version,identity_retention_until,status,idempotency_key,outbound_request_fingerprint
  ) values (
    p_project_id,'outbound','customer_managed',p_media,v_worker.id,v_line.id,p_masked_destination,
    p_identity_ciphertext,p_identity_type,p_identity_key_version,p_identity_retention_until,
    'allocating',p_idempotency_key,p_request_fingerprint
  ) returning id into v_call_id;
  -- p_validated_hosts is retained as a compatibility parameter, not a gate.
  update public.facetime_workers set current_call_id=v_call_id where id=v_worker.id;
  update public.facetime_lines set current_call_id=v_call_id,status='busy' where id=v_line.id;
  insert into public.facetime_call_events(call_id,project_id,event_type,source,source_event_id)
    values(v_call_id,p_project_id,'call_allocated','control_plane','call_allocated:'||v_call_id::text);
  perform public.facetime_insert_sealed_session(p_project_id,v_call_id,p_session_id,v_worker.id,
    p_room_reference,p_expected_participant_identity,p_token_expires_at,p_lease_expires_at,
    p_livekit_url_ciphertext,p_participant_token_ciphertext,p_token_fingerprint,p_encryption_key_version);
  return v_call_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_outbound_byor_call_pinned(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_existing uuid; v_line public.facetime_lines%rowtype; v_worker public.facetime_workers%rowtype; v_call_id uuid;
begin
  perform 1 from public.facetime_lines where id=p_requested_line_id and project_id=p_project_id and worker_id=p_worker_id for update;
  if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
  select id into v_existing from public.facetime_calls
    where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then
   if not exists(select 1 from public.facetime_calls where id=v_existing and line_id=p_requested_line_id and worker_id=p_worker_id) then
    raise exception 'call_not_found' using errcode='P0002'; end if;
   return v_existing;
  end if;
  select * into v_line from public.facetime_lines where id=p_requested_line_id
    and project_id=p_project_id and worker_id=p_worker_id and current_call_id is null for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  select * into v_worker from public.facetime_workers where id=v_line.worker_id
    and enabled and current_call_id is null for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  if v_worker.automatic_readiness_enabled and (v_worker.status <> 'accepting' or v_line.status <> 'available'
    or not public.facetime_worker_automatic_ready(v_worker,clock_timestamp(),coalesce((p_media->>'video')::boolean,false))
    or (coalesce((p_media->>'audio')::boolean,false) and not v_line.supports_audio)
    or (coalesce((p_media->>'video')::boolean,false) and not v_line.supports_video)) then
    raise exception 'line_unavailable' using errcode='55000'; end if;
  insert into public.facetime_calls (
    project_id,direction,mode,media,worker_id,line_id,masked_identity,identity_ciphertext,
    identity_type,identity_key_version,identity_retention_until,status,idempotency_key
  ) values (
    p_project_id,'outbound','customer_managed',p_media,v_worker.id,v_line.id,p_masked_destination,
    p_identity_ciphertext,p_identity_type,p_identity_key_version,p_identity_retention_until,
    'allocating',p_idempotency_key
  ) returning id into v_call_id;
  -- p_validated_hosts is retained as a compatibility parameter, not a gate.
  update public.facetime_workers set current_call_id=v_call_id where id=v_worker.id;
  update public.facetime_lines set current_call_id=v_call_id,status='busy' where id=v_line.id;
  insert into public.facetime_call_events(call_id,project_id,event_type,source,source_event_id)
    values(v_call_id,p_project_id,'call_allocated','control_plane','call_allocated:'||v_call_id::text);
  perform public.facetime_insert_sealed_session(p_project_id,v_call_id,p_session_id,v_worker.id,
    p_room_reference,p_expected_participant_identity,p_token_expires_at,p_lease_expires_at,
    p_livekit_url_ciphertext,p_participant_token_ciphertext,p_token_fingerprint,p_encryption_key_version);
  return v_call_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_create_outbound_video_call(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_existing uuid; v_line public.facetime_lines%rowtype; v_worker public.facetime_workers%rowtype; v_call_id uuid;
begin
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_media is distinct from '{"audio":true,"video":true}'::jsonb
    or p_idempotency_key is null or length(btrim(p_idempotency_key))=0 then
    raise exception 'invalid_outbound_request' using errcode='22023';
  end if;
  -- Serialize concurrent keys even when requests select different lines.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':' || p_idempotency_key, 0));
  select id into v_existing from public.facetime_calls
    where project_id=p_project_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then
    if not exists(select 1 from public.facetime_calls where id=v_existing
      and outbound_request_fingerprint=p_request_fingerprint and line_id=p_requested_line_id) then
      raise exception 'idempotency_conflict' using errcode='23505';
    end if;
    return v_existing;
  end if;
  if p_lease_expires_at <= now() + interval '90 seconds' then
    raise exception 'session_expired' using errcode='55000';
  end if;
  perform 1 from public.facetime_lines where id=p_requested_line_id and project_id=p_project_id and worker_id=p_worker_id for update;
  if not found then raise exception 'line_not_found' using errcode='P0002'; end if;
  select * into v_line from public.facetime_lines where id=p_requested_line_id
    and project_id=p_project_id and worker_id=p_worker_id and current_call_id is null
    and status='available' and supports_audio and supports_video for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  select * into v_worker from public.facetime_workers where id=v_line.worker_id
    and enabled and current_call_id is null and status='accepting'
    and last_heartbeat_at > now() - interval '30 seconds'
    and automatic_readiness_enabled
    and public.facetime_worker_automatic_ready(facetime_workers,clock_timestamp(),true)
    and capabilities->>'video'='true' and capabilities->>'outbound_video_protocol'='1'
    and capabilities->>'audio'='true' and capabilities->>'outbound_audio_protocol'='1'
    for update;
  if not found then raise exception 'line_unavailable' using errcode='55000'; end if;
  insert into public.facetime_calls (
    project_id,direction,mode,media,worker_id,line_id,masked_identity,identity_ciphertext,
    identity_type,identity_key_version,identity_retention_until,status,idempotency_key,outbound_request_fingerprint
  ) values (
    p_project_id,'outbound','customer_managed',p_media,v_worker.id,v_line.id,p_masked_destination,
    p_identity_ciphertext,p_identity_type,p_identity_key_version,p_identity_retention_until,
    'allocating',p_idempotency_key,p_request_fingerprint
  ) returning id into v_call_id;
  -- p_validated_hosts is retained as a compatibility parameter, not a gate.
  update public.facetime_workers set current_call_id=v_call_id where id=v_worker.id;
  update public.facetime_lines set current_call_id=v_call_id,status='busy' where id=v_line.id;
  insert into public.facetime_call_events(call_id,project_id,event_type,source,source_event_id)
    values(v_call_id,p_project_id,'call_allocated','control_plane','call_allocated:'||v_call_id::text);
  perform public.facetime_insert_sealed_session(p_project_id,v_call_id,p_session_id,v_worker.id,
    p_room_reference,p_expected_participant_identity,p_token_expires_at,p_lease_expires_at,
    p_livekit_url_ciphertext,p_participant_token_ciphertext,p_token_fingerprint,p_encryption_key_version);
  return v_call_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_insert_sealed_session(p_project_id uuid, p_call_id uuid, p_session_id uuid, p_worker_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer)
 RETURNS facetime_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_call public.facetime_calls%rowtype; v_session public.facetime_sessions%rowtype;
begin
  select * into v_call from public.facetime_calls
    where id = p_call_id and project_id = p_project_id and worker_id = p_worker_id for update;
  if not found then raise exception 'call_not_found' using errcode = 'P0002'; end if;
  insert into public.facetime_sessions (
    id, project_id, call_id, line_id, worker_id, kind, room_reference,
    expected_participant_identity, expires_at
  ) values (
    p_session_id, p_project_id, p_call_id, v_call.line_id, p_worker_id, 'customer_room',
    p_room_reference, p_expected_participant_identity, p_lease_expires_at
  ) returning * into v_session;
  insert into public.facetime_session_credential_seals (
    project_id, session_id, worker_id, livekit_url_ciphertext,
    participant_token_ciphertext, token_fingerprint, encryption_key_version,
    token_expires_at, lease_expires_at
  ) values (
    p_project_id, p_session_id, p_worker_id, p_livekit_url_ciphertext,
    p_participant_token_ciphertext, p_token_fingerprint, p_encryption_key_version,
    p_token_expires_at, p_lease_expires_at
  );
  insert into public.facetime_worker_commands (
    worker_id, call_id, line_id, command_type, payload, idempotency_key, expires_at
  ) values (
    p_worker_id, p_call_id, v_call.line_id, case when v_call.direction='outbound' then 'place_call'::public.facetime_command_type else 'start_bridge'::public.facetime_command_type end,
    jsonb_build_object('schema_version', 1, 'session_id', p_session_id, 'call_id', p_call_id,
      'line_id', v_call.line_id, 'worker_id', p_worker_id, 'room_reference', p_room_reference,
      'expected_participant_identity', p_expected_participant_identity)
      || case when v_call.direction='outbound' then jsonb_build_object(
        'outbound_audio_protocol', 1, 'project_id', p_project_id, 'media', v_call.media,
        'mode', v_call.mode, 'session_expires_at', p_lease_expires_at)
        || case when v_call.media->>'video'='true' then jsonb_build_object('outbound_video_protocol',1) else '{}'::jsonb end
        else '{}'::jsonb end,
    case when v_call.direction='outbound' then 'place_call:' else 'start_bridge:' end || p_session_id::text,
    case when v_call.direction='outbound' then least(p_lease_expires_at,now()+interval '120 seconds') else p_lease_expires_at end
  );
  return v_session;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.facetime_renew_outbound_lease(p_project_id uuid, p_worker_id uuid, p_command_id uuid, p_lease_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare q public.facetime_worker_commands%rowtype;
begin
 select * into q from public.facetime_worker_commands where id=p_command_id and worker_id=p_worker_id for update;
 if not found or q.command_type<>'place_call' or q.payload->>'outbound_audio_protocol' is distinct from '1'
   or q.status<>'leased' or q.lease_token_hash is distinct from p_lease_token_hash
   or q.lease_expires_at<=now() or q.expires_at<=now() then
   raise exception 'stale_command_lease' using errcode='55000'; end if;
 perform 1 from public.facetime_calls c
 join public.facetime_lines l on l.id=c.line_id and l.project_id=c.project_id and l.worker_id=c.worker_id
 join public.facetime_workers w on w.id=c.worker_id
 join public.facetime_sessions s on s.call_id=c.id and s.project_id=c.project_id and s.worker_id=w.id and s.line_id=l.id
 where c.id=q.call_id and c.project_id=p_project_id and c.worker_id=p_worker_id and l.id=q.line_id
   and c.status not in ('ending','ended','failed','rejected') and c.direction='outbound' and c.mode='customer_managed'
   and l.current_call_id=c.id and w.current_call_id=c.id and w.enabled and w.status='accepting'
   and w.last_heartbeat_at>now()-interval '30 seconds'
   and (case when w.automatic_readiness_enabled
     then public.facetime_worker_automatic_ready(w,clock_timestamp(),c.media->>'video'='true')
     else w.readiness->>'production_media_ready'='true' and w.readiness->>'audio_ready'='true' end)
   and w.capabilities->>'audio'='true'
   and w.capabilities->>'outbound_audio_protocol'='1'
   and q.payload->'media'=c.media
   and (c.media->>'video'='false' or (c.media->>'video'='true'
     and l.supports_video and w.capabilities->>'video'='true'
     and w.capabilities->>'outbound_video_protocol'='1' and q.payload->>'outbound_video_protocol'='1'
     and w.automatic_readiness_enabled))
   and s.id::text=q.payload->>'session_id' and s.state in ('dispatched','active') and s.expires_at>now()
   and q.payload->>'call_id'=c.id::text and q.payload->>'line_id'=l.id::text
   and q.payload->>'worker_id'=w.id::text and q.payload->>'project_id'=p_project_id::text
 for update of c,l,w,s;
 if not found then raise exception 'outbound_authorization_lost' using errcode='55000'; end if;
 update public.facetime_worker_commands set lease_expires_at=least(expires_at,now()+interval '30 seconds') where id=q.id;
 return jsonb_build_object('authorized',true);
end; $function$
;
alter table public."realtime_assistants" alter column "id" set default gen_random_uuid();
alter table public."realtime_assistants" alter column "status" set default 'draft'::facetime_assistant_status;
alter table public."realtime_assistants" alter column "draft_config" set default '{}'::jsonb;
alter table public."realtime_assistants" alter column "draft_revision" set default 1;
alter table public."realtime_assistants" alter column "created_at" set default now();
alter table public."realtime_assistants" alter column "updated_at" set default now();
alter table public."realtime_assistant_versions" alter column "id" set default gen_random_uuid();
alter table public."realtime_assistant_versions" alter column "schema_version" set default 1;
alter table public."realtime_assistant_versions" alter column "published_at" set default now();
alter table public."facetime_development_windows" alter column "id" set default gen_random_uuid();
alter table public."facetime_development_windows" alter column "created_at" set default now();
alter table public."facetime_worker_credentials" alter column "id" set default gen_random_uuid();
alter table public."facetime_worker_credentials" alter column "created_at" set default now();
alter table public."facetime_worker_enrollment_tokens" alter column "id" set default gen_random_uuid();
alter table public."facetime_worker_enrollment_tokens" alter column "created_at" set default now();
alter table public."facetime_worker_commands" alter column "id" set default gen_random_uuid();
alter table public."facetime_worker_commands" alter column "payload" set default '{}'::jsonb;
alter table public."facetime_worker_commands" alter column "status" set default 'queued'::facetime_command_status;
alter table public."facetime_worker_commands" alter column "attempt_count" set default 0;
alter table public."facetime_worker_commands" alter column "maximum_attempts" set default 3;
alter table public."facetime_worker_commands" alter column "available_at" set default now();
alter table public."facetime_worker_commands" alter column "created_at" set default now();
alter table public."facetime_api_keys" alter column "id" set default gen_random_uuid();
alter table public."facetime_api_keys" alter column "scopes" set default ARRAY['facetime:read'::text];
alter table public."facetime_api_keys" alter column "created_at" set default now();
alter table public."facetime_projects" alter column "id" set default gen_random_uuid();
alter table public."facetime_projects" alter column "created_at" set default now();
alter table public."facetime_projects" alter column "updated_at" set default now();
alter table public."facetime_projects" alter column "status" set default 'enabled'::text;
alter table public."facetime_projects" alter column "website_domain" set default ''::text;
alter table public."facetime_call_transcripts" alter column "created_at" set default now();
alter table public."facetime_call_events" alter column "id" set default gen_random_uuid();
alter table public."facetime_call_events" alter column "payload" set default '{}'::jsonb;
alter table public."facetime_call_events" alter column "created_at" set default now();
alter table public."facetime_calls" alter column "id" set default gen_random_uuid();
alter table public."facetime_calls" alter column "status" set default 'queued'::facetime_call_status;
alter table public."facetime_calls" alter column "media_status" set default '{}'::jsonb;
alter table public."facetime_calls" alter column "requested_at" set default now();
alter table public."facetime_calls" alter column "created_at" set default now();
alter table public."facetime_calls" alter column "updated_at" set default now();
alter table public."facetime_calls" alter column "binding_disposition" set default 'legacy_unresolved'::text;
alter table public."facetime_calls" alter column "video_framing" set default 'fit'::text;
alter table public."facetime_sessions" alter column "id" set default gen_random_uuid();
alter table public."facetime_sessions" alter column "state" set default 'created'::facetime_session_state;
alter table public."facetime_sessions" alter column "created_at" set default now();
alter table public."facetime_sessions" alter column "updated_at" set default now();
alter table public."facetime_webhook_delivery_attempts" alter column "id" set default gen_random_uuid();
alter table public."facetime_session_credential_seals" alter column "id" set default gen_random_uuid();
alter table public."facetime_session_credential_seals" alter column "state" set default 'sealed'::text;
alter table public."facetime_session_credential_seals" alter column "created_at" set default now();
alter table public."facetime_webhook_events" alter column "event_id" set default gen_random_uuid();
alter table public."facetime_webhook_events" alter column "created_at" set default now();
alter table public."facetime_webhook_events" alter column "state" set default 'pending'::facetime_webhook_event_state;
alter table public."facetime_webhook_events" alter column "attempt_count" set default 0;
alter table public."facetime_webhook_events" alter column "next_attempt_at" set default now();
alter table public."facetime_webhook_endpoints" alter column "id" set default gen_random_uuid();
alter table public."facetime_webhook_endpoints" alter column "enabled" set default true;
alter table public."facetime_webhook_endpoints" alter column "payload_version" set default 1;
alter table public."facetime_webhook_endpoints" alter column "created_at" set default now();
alter table public."facetime_webhook_endpoints" alter column "updated_at" set default now();
alter table public."facetime_webhook_endpoints" alter column "name" set default 'Default integration'::text;
alter table public."facetime_webhook_endpoints" alter column "legacy_default" set default true;
alter table public."facetime_webhook_endpoints" alter column "signing_enabled" set default true;
alter table public."facetime_platform_admins" alter column "granted_at" set default now();
alter table public."facetime_integration_revisions" alter column "id" set default gen_random_uuid();
alter table public."facetime_integration_revisions" alter column "created_at" set default clock_timestamp();
alter table public."facetime_integration_revisions" alter column "signing_enabled" set default true;
alter table public."facetime_webhook_secret_versions" alter column "id" set default gen_random_uuid();
alter table public."facetime_webhook_secret_versions" alter column "created_at" set default now();
alter table public."facetime_project_settings" alter column "livekit_allowed_hosts" set default '{}'::text[];
alter table public."facetime_project_settings" alter column "created_at" set default now();
alter table public."facetime_project_settings" alter column "updated_at" set default now();
alter table public."facetime_lines" alter column "id" set default gen_random_uuid();
alter table public."facetime_lines" alter column "status" set default 'offline'::facetime_line_status;
alter table public."facetime_lines" alter column "inbound_policy" set default 'customer_decides'::facetime_inbound_policy;
alter table public."facetime_lines" alter column "supports_audio" set default true;
alter table public."facetime_lines" alter column "supports_video" set default false;
alter table public."facetime_lines" alter column "created_at" set default now();
alter table public."facetime_lines" alter column "updated_at" set default now();
alter table public."facetime_lines" alter column "assignment_generation" set default 0;
alter table public."facetime_lines" alter column "video_framing" set default 'fit'::text;
alter table public."facetime_project_memberships" alter column "created_at" set default now();
alter table public."facetime_configuration_audit" alter column "id" set default gen_random_uuid();
alter table public."facetime_configuration_audit" alter column "database_actor" set default SESSION_USER;
alter table public."facetime_configuration_audit" alter column "created_at" set default clock_timestamp();
alter table public."facetime_admin_audit" alter column "id" set default gen_random_uuid();
alter table public."facetime_admin_audit" alter column "created_at" set default now();
alter table public."facetime_workers" alter column "id" set default gen_random_uuid();
alter table public."facetime_workers" alter column "status" set default 'offline'::facetime_worker_status;
alter table public."facetime_workers" alter column "enabled" set default false;
alter table public."facetime_workers" alter column "capabilities" set default '{}'::jsonb;
alter table public."facetime_workers" alter column "readiness" set default '{"audio_ready": false, "video_ready": false, "control_ready": false, "avatar_capable": false, "facetime_signed_in": false, "accessibility_ready": false, "screen_capture_ready": false, "production_media_ready": false}'::jsonb;
alter table public."facetime_workers" alter column "updated_at" set default now();
alter table public."facetime_workers" alter column "automatic_readiness_enabled" set default false;
alter table public."facetime_media_observations" alter column "received_at" set default clock_timestamp();
alter table public."facetime_media_observations" alter column "recovery_qualified" set default false;
alter table public."facetime_worker_onboarding_requests" alter column "created_at" set default now();
alter table public."facetime_worker_onboarding" alter column "created_at" set default now();
alter table public."facetime_membership_audit" alter column "id" set default gen_random_uuid();
alter table public."facetime_membership_audit" alter column "created_at" set default now();
alter table public."facetime_audit_requests" alter column "created_at" set default now();
alter table public."facetime_audit_runners" alter column "enabled" set default true;
alter table public."facetime_audit_runners" alter column "registered_at" set default now();
alter table public."facetime_audit_runners" alter column "reminder_sent" set default false;
alter table public."facetime_audit_runs" alter column "id" set default gen_random_uuid();
alter table public."facetime_audit_runs" alter column "state" set default 'queued'::text;
alter table public."facetime_audit_runs" alter column "created_at" set default now();
alter table public."facetime_audit_notifications" alter column "id" set default gen_random_uuid();
alter table public."facetime_audit_notifications" alter column "created_at" set default now();
alter table public."facetime_audit_notifications" alter column "attempts" set default 0;
alter table public."facetime_audit_notifications" alter column "next_attempt_at" set default now();
alter table public."facetime_audit_notifications" alter column "state" set default 'pending'::text;
alter table public."realtime_assistants" add constraint "realtime_assistants_check" CHECK (((status = 'archived'::facetime_assistant_status) = (archived_at IS NOT NULL)));
alter table public."realtime_assistants" add constraint "realtime_assistants_description_check" CHECK (((description IS NULL) OR (char_length(description) <= 1000)));
alter table public."realtime_assistants" add constraint "realtime_assistants_draft_config_check" CHECK ((jsonb_typeof(draft_config) = 'object'::text));
alter table public."realtime_assistants" add constraint "realtime_assistants_draft_revision_check" CHECK ((draft_revision > 0));
alter table public."realtime_assistants" add constraint "realtime_assistants_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)));
alter table public."realtime_assistants" add constraint "realtime_assistants_pkey" PRIMARY KEY (id);
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_assistant_id_version_key" UNIQUE (assistant_id, version);
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_config_check" CHECK ((jsonb_typeof(config) = 'object'::text));
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_content_hash_check" CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_id_assistant_id_project_id_key" UNIQUE (id, assistant_id, project_id);
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_pkey" PRIMARY KEY (id);
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_schema_version_check" CHECK ((schema_version > 0));
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_version_check" CHECK ((version > 0));
alter table public."facetime_development_windows" add constraint "facetime_development_windows_check" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:05:00'::interval))));
alter table public."facetime_development_windows" add constraint "facetime_development_windows_pkey" PRIMARY KEY (id);
alter table public."facetime_development_windows" add constraint "facetime_development_windows_purpose_check" CHECK ((purpose = ANY (ARRAY['inbound'::text, 'outbound'::text, 'preview'::text])));
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_credential_hash_check" CHECK ((credential_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_credential_hash_key" UNIQUE (credential_hash);
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_credential_prefix_check" CHECK (((char_length(credential_prefix) >= 8) AND (char_length(credential_prefix) <= 40)));
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_pkey" PRIMARY KEY (id);
alter table public."facetime_worker_enrollment_tokens" add constraint "facetime_worker_enrollment_tokens_pkey" PRIMARY KEY (id);
alter table public."facetime_worker_enrollment_tokens" add constraint "facetime_worker_enrollment_tokens_token_hash_check" CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_worker_enrollment_tokens" add constraint "facetime_worker_enrollment_tokens_token_hash_key" UNIQUE (token_hash);
alter table public."facetime_worker_enrollment_tokens" add constraint "facetime_worker_enrollment_tokens_token_prefix_check" CHECK (((char_length(token_prefix) >= 8) AND (char_length(token_prefix) <= 40)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_attempt_count_check" CHECK ((attempt_count >= 0));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_check" CHECK ((expires_at > created_at));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_check1" CHECK ((((status = 'leased'::facetime_command_status) AND (lease_owner IS NOT NULL) AND (lease_token_hash IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR (status <> 'leased'::facetime_command_status)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_error_code_check" CHECK (((error_code IS NULL) OR (error_code ~ '^[a-z][a-z0-9_]{1,79}$'::text)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_idempotency_key_check" CHECK (((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 200)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_lease_token_hash_check" CHECK (((lease_token_hash IS NULL) OR (lease_token_hash ~ '^[0-9a-f]{64}$'::text)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_maximum_attempts_check" CHECK (((maximum_attempts >= 1) AND (maximum_attempts <= 10)));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_payload_check" CHECK ((jsonb_typeof(payload) = 'object'::text));
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_pkey" PRIMARY KEY (id);
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_worker_id_idempotency_key_key" UNIQUE (worker_id, idempotency_key);
alter table public."facetime_api_keys" add constraint "facetime_api_keys_expiry_after_creation" CHECK (((expires_at IS NULL) OR (expires_at > created_at)));
alter table public."facetime_api_keys" add constraint "facetime_api_keys_key_hash_key" UNIQUE (key_hash);
alter table public."facetime_api_keys" add constraint "facetime_api_keys_key_prefix_check" CHECK (((char_length(key_prefix) >= 8) AND (char_length(key_prefix) <= 32)));
alter table public."facetime_api_keys" add constraint "facetime_api_keys_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 100)));
alter table public."facetime_api_keys" add constraint "facetime_api_keys_pkey" PRIMARY KEY (id);
alter table public."facetime_projects" add constraint "facetime_projects_logo_data_check" CHECK (((logo_data IS NULL) OR ((length(logo_data) <= 87406) AND (logo_data ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'::text))));
alter table public."facetime_projects" add constraint "facetime_projects_name_check" CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120)));
alter table public."facetime_projects" add constraint "facetime_projects_pkey" PRIMARY KEY (id);
alter table public."facetime_projects" add constraint "facetime_projects_slug_check" CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'::text));
alter table public."facetime_projects" add constraint "facetime_projects_slug_key" UNIQUE (slug);
alter table public."facetime_projects" add constraint "facetime_projects_status_check" CHECK ((status = ANY (ARRAY['enabled'::text, 'disabled'::text, 'provisioning'::text])));
alter table public."facetime_projects" add constraint "facetime_projects_website_domain_check" CHECK ((length(website_domain) <= 253));
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_content_hash_check" CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_pkey" PRIMARY KEY (call_id);
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_schema_version_check" CHECK ((schema_version = 1));
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_source_event_id_check" CHECK (((char_length(source_event_id) >= 8) AND (char_length(source_event_id) <= 200)));
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_turns_check" CHECK (((jsonb_typeof(turns) = 'array'::text) AND (jsonb_array_length(turns) <= 1000)));
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_worker_id_source_event_id_key" UNIQUE (worker_id, source_event_id);
alter table public."facetime_call_events" add constraint "facetime_call_events_event_type_check" CHECK ((event_type ~ '^[a-z][a-z0-9_]{1,79}$'::text));
alter table public."facetime_call_events" add constraint "facetime_call_events_payload_check" CHECK ((jsonb_typeof(payload) = 'object'::text));
alter table public."facetime_call_events" add constraint "facetime_call_events_pkey" PRIMARY KEY (id);
alter table public."facetime_call_events" add constraint "facetime_call_events_source_event_id_check" CHECK (((char_length(source_event_id) >= 8) AND (char_length(source_event_id) <= 200)));
alter table public."facetime_call_events" add constraint "facetime_call_events_source_source_event_id_key" UNIQUE (source, source_event_id);
alter table public."facetime_call_events" add constraint "facetime_call_events_terminal_reason_check" CHECK (((terminal_reason IS NULL) OR (terminal_reason = ANY (ARRAY['remote_ended'::text, 'line_busy'::text, 'declined_readiness'::text, 'agent_failed'::text, 'network_failed'::text, 'webhook_timeout_declined'::text, 'participant_not_found'::text, 'session_expired'::text, 'max_duration'::text, 'unknown'::text]))));
alter table public."facetime_call_events" add constraint "facetime_call_events_terminal_reason_detail_check" CHECK (((terminal_reason_detail IS NULL) OR (char_length(terminal_reason_detail) <= 240)));
alter table public."facetime_call_events" add constraint "facetime_call_events_worker_sequence_check" CHECK (((worker_sequence IS NULL) OR (worker_sequence >= 0)));
alter table public."facetime_call_events" add constraint "facetime_event_call_tenant_identity" UNIQUE (id, call_id, project_id);
alter table public."facetime_calls" add constraint "facetime_call_binding_shape" CHECK (((binding_disposition = 'pinned'::text) = (integration_revision_id IS NOT NULL)));
alter table public."facetime_calls" add constraint "facetime_calls_binding_disposition_check" CHECK ((binding_disposition = ANY (ARRAY['pinned'::text, 'none'::text, 'legacy_unresolved'::text])));
alter table public."facetime_calls" add constraint "facetime_calls_check" CHECK ((((mode = 'managed'::facetime_call_mode) AND (assistant_id IS NOT NULL) AND (assistant_version_id IS NOT NULL)) OR (mode = 'customer_managed'::facetime_call_mode)));
alter table public."facetime_calls" add constraint "facetime_calls_check1" CHECK ((((status = ANY (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status])) AND (ended_at IS NOT NULL) AND (terminal_reason IS NOT NULL)) OR ((status <> ALL (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status])) AND (ended_at IS NULL))));
alter table public."facetime_calls" add constraint "facetime_calls_idempotency_key_check" CHECK (((idempotency_key IS NULL) OR ((char_length(idempotency_key) >= 8) AND (char_length(idempotency_key) <= 200))));
alter table public."facetime_calls" add constraint "facetime_calls_identity_key_version_check" CHECK (((identity_key_version IS NULL) OR (identity_key_version > 0)));
alter table public."facetime_calls" add constraint "facetime_calls_identity_type_check" CHECK (((identity_type IS NULL) OR (identity_type = ANY (ARRAY['phone'::text, 'email'::text, 'apple_id'::text]))));
alter table public."facetime_calls" add constraint "facetime_calls_incoming_webhook_decision_check" CHECK (((incoming_webhook_decision IS NULL) OR ((incoming_webhook_decision ->> 'action'::text) = ANY (ARRAY['accept'::text, 'decline'::text]))));
alter table public."facetime_calls" add constraint "facetime_calls_masked_identity_check" CHECK (((masked_identity IS NULL) OR (char_length(masked_identity) <= 160)));
alter table public."facetime_calls" add constraint "facetime_calls_media_check" CHECK ((jsonb_typeof(media) = 'object'::text));
alter table public."facetime_calls" add constraint "facetime_calls_media_status_check" CHECK ((jsonb_typeof(media_status) = 'object'::text));
alter table public."facetime_calls" add constraint "facetime_calls_pkey" PRIMARY KEY (id);
alter table public."facetime_calls" add constraint "facetime_calls_terminal_reason_check" CHECK (((terminal_reason IS NULL) OR (char_length(terminal_reason) <= 240)));
alter table public."facetime_calls" add constraint "facetime_calls_terminal_reason_detail_check" CHECK (((terminal_reason_detail IS NULL) OR (char_length(terminal_reason_detail) <= 240)));
alter table public."facetime_calls" add constraint "facetime_calls_video_framing_check" CHECK ((video_framing = ANY (ARRAY['fit'::text, 'fill'::text])));
alter table public."facetime_sessions" add constraint "facetime_sessions_call_id_key" UNIQUE (call_id);
alter table public."facetime_sessions" add constraint "facetime_sessions_check" CHECK ((expires_at > created_at));
alter table public."facetime_sessions" add constraint "facetime_sessions_expected_participant_identity_check" CHECK (((char_length(btrim(expected_participant_identity)) >= 1) AND (char_length(btrim(expected_participant_identity)) <= 240)));
alter table public."facetime_sessions" add constraint "facetime_sessions_pkey" PRIMARY KEY (id);
alter table public."facetime_sessions" add constraint "facetime_sessions_room_reference_check" CHECK (((char_length(btrim(room_reference)) >= 1) AND (char_length(btrim(room_reference)) <= 240)));
alter table public."facetime_sessions" add constraint "facetime_sessions_terminal_reason_check" CHECK (((terminal_reason IS NULL) OR (terminal_reason = ANY (ARRAY['remote_ended'::text, 'line_busy'::text, 'declined_readiness'::text, 'agent_failed'::text, 'network_failed'::text, 'webhook_timeout_declined'::text, 'participant_not_found'::text, 'bridge_failed'::text, 'session_expired'::text, 'max_duration'::text, 'unknown'::text]))));
alter table public."facetime_sessions" add constraint "facetime_sessions_terminal_reason_detail_check" CHECK (((terminal_reason_detail IS NULL) OR (char_length(terminal_reason_detail) <= 240)));
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_att_webhook_event_id_attempt_numb_key" UNIQUE (webhook_event_id, attempt_number);
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_attempt_number_check" CHECK ((attempt_number > 0));
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_latency_ms_check" CHECK ((latency_ms >= 0));
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_pkey" PRIMARY KEY (id);
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_secret_version_check" CHECK ((secret_version > 0));
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_status_check" CHECK ((status = ANY (ARRAY['delivered'::text, 'retry'::text, 'dead_letter'::text])));
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_check" CHECK ((lease_expires_at <= token_expires_at));
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_pkey" PRIMARY KEY (id);
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_session_id_key" UNIQUE (session_id);
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_state_check" CHECK ((state = ANY (ARRAY['sealed'::text, 'consumed'::text, 'tombstoned'::text])));
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_token_fingerprint_check" CHECK ((token_fingerprint ~ '^sha256:[0-9a-f]{16}$'::text));
alter table public."facetime_webhook_events" add constraint "facetime_outbox_tenant_identity" UNIQUE (event_id, project_id);
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_attempt_count_check" CHECK ((attempt_count >= 0));
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_event_type_check" CHECK ((event_type = ANY (ARRAY['call.started'::text, 'call.ended'::text, 'call.failed'::text])));
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_logical_transition_check" CHECK (((logical_transition IS NULL) OR (logical_transition = ANY (ARRAY['call.started'::text, 'call.ended'::text, 'call.failed'::text]))));
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_pkey" PRIMARY KEY (event_id);
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_project_id_source_call_event_id_eve_key" UNIQUE (project_id, source_call_event_id, event_type);
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_secret_version_check" CHECK ((secret_version > 0));
alter table public."facetime_webhook_endpoints" add constraint "facetime_integration_identity" UNIQUE (id, project_id);
alter table public."facetime_webhook_endpoints" add constraint "facetime_webhook_endpoints_endpoint_url_check" CHECK (((char_length(endpoint_url) >= 8) AND (char_length(endpoint_url) <= 2048)));
alter table public."facetime_webhook_endpoints" add constraint "facetime_webhook_endpoints_payload_version_check" CHECK ((payload_version = 1));
alter table public."facetime_webhook_endpoints" add constraint "facetime_webhook_endpoints_pkey" PRIMARY KEY (id);
alter table public."facetime_platform_admins" add constraint "facetime_platform_admins_pkey" PRIMARY KEY (user_id);
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_id_integration_id_project_id_key" UNIQUE (id, integration_id, project_id);
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_id_project_id_key" UNIQUE (id, project_id);
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_integration_id_generation_key" UNIQUE (integration_id, generation);
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_payload_version_check" CHECK ((payload_version = 1));
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_pkey" PRIMARY KEY (id);
alter table public."facetime_integration_revisions" add constraint "signing_material_matches_mode" CHECK (((signing_enabled AND (secret_version_id IS NOT NULL) AND (secret_version IS NOT NULL)) OR ((NOT signing_enabled) AND (secret_version_id IS NULL) AND (secret_version IS NULL))));
alter table public."facetime_webhook_secret_versions" add constraint "facetime_integration_secret_identity" UNIQUE (id, endpoint_id, project_id);
alter table public."facetime_webhook_secret_versions" add constraint "facetime_integration_secret_number" UNIQUE (id, endpoint_id, project_id, version);
alter table public."facetime_webhook_secret_versions" add constraint "facetime_integration_secret_version" UNIQUE (endpoint_id, version);
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_ciphertext_check" CHECK ((char_length(ciphertext) > 20));
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_encryption_key_version_check" CHECK ((encryption_key_version > 0));
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_id_project_id_key" UNIQUE (id, project_id);
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_pkey" PRIMARY KEY (id);
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_version_check" CHECK ((version > 0));
alter table public."facetime_project_settings" add constraint "facetime_project_settings_pkey" PRIMARY KEY (project_id);
alter table public."facetime_lines" add constraint "facetime_lines_display_name_check" CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 120)));
alter table public."facetime_lines" add constraint "facetime_lines_line_key_check" CHECK ((line_key ~ '^line_[a-z0-9][a-z0-9_-]{1,62}$'::text));
alter table public."facetime_lines" add constraint "facetime_lines_line_key_key" UNIQUE (line_key);
alter table public."facetime_lines" add constraint "facetime_lines_masked_identity_check" CHECK (((char_length(masked_identity) >= 1) AND (char_length(masked_identity) <= 160)));
alter table public."facetime_lines" add constraint "facetime_lines_pkey" PRIMARY KEY (id);
alter table public."facetime_lines" add constraint "facetime_lines_video_framing_check" CHECK ((video_framing = ANY (ARRAY['fit'::text, 'fill'::text])));
alter table public."facetime_project_memberships" add constraint "facetime_project_memberships_pkey" PRIMARY KEY (project_id, user_id);
alter table public."facetime_project_memberships" add constraint "facetime_project_memberships_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])));
alter table public."facetime_configuration_audit" add constraint "facetime_configuration_audit_pkey" PRIMARY KEY (id);
alter table public."facetime_admin_audit" add constraint "facetime_admin_audit_action_check" CHECK ((action = ANY (ARRAY['createAPIKey'::text, 'revokeAPIKey'::text, 'createAssistant'::text, 'updateAssistant'::text, 'publishAssistant'::text, 'updateLine'::text, 'manageIntegration'::text, 'updateIdentity'::text])));
alter table public."facetime_admin_audit" add constraint "facetime_admin_audit_pkey" PRIMARY KEY (id);
alter table public."facetime_workers" add constraint "facetime_workers_capabilities_check" CHECK ((jsonb_typeof(capabilities) = 'object'::text));
alter table public."facetime_workers" add constraint "facetime_workers_display_name_check" CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 120)));
alter table public."facetime_workers" add constraint "facetime_workers_last_heartbeat_rejection_reason_check" CHECK (((last_heartbeat_rejection_reason IS NULL) OR ((jsonb_typeof(last_heartbeat_rejection_reason) = 'object'::text) AND ((last_heartbeat_rejection_reason ->> 'code'::text) = ANY (ARRAY['readiness_evidence_stale'::text, 'readiness_evidence_invalid'::text])) AND (jsonb_typeof((last_heartbeat_rejection_reason -> 'max_age_hours'::text)) = 'number'::text))));
alter table public."facetime_workers" add constraint "facetime_workers_pkey" PRIMARY KEY (id);
alter table public."facetime_workers" add constraint "facetime_workers_readiness_check" CHECK ((jsonb_typeof(readiness) = 'object'::text));
alter table public."facetime_workers" add constraint "facetime_workers_software_version_check" CHECK (((software_version IS NULL) OR (char_length(software_version) <= 120)));
alter table public."facetime_workers" add constraint "facetime_workers_worker_key_check" CHECK ((worker_key ~ '^worker_[a-z0-9][a-z0-9_-]{1,62}$'::text));
alter table public."facetime_workers" add constraint "facetime_workers_worker_key_key" UNIQUE (worker_key);
alter table public."facetime_media_observations" add constraint "facetime_media_observations_build_check" CHECK ((build ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_capability_check" CHECK ((capability = ANY (ARRAY['audio'::text, 'video'::text])));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_check" CHECK ((isfinite(received_at) AND (observed_at <= received_at)));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_check1" CHECK ((((kind = 'human_test'::text) AND (((outcome = 'failed'::text) AND (reason =
CASE
    WHEN (capability = 'audio'::text) THEN 'no_response_to_speech'::text
    ELSE 'no_moving_video'::text
END)) OR ((outcome = 'passed'::text) AND (reason =
CASE
    WHEN (capability = 'audio'::text) THEN 'two_way_speech'::text
    ELSE 'moving_video'::text
END) AND (build IS NOT NULL) AND (device_binding IS NOT NULL) AND (config_binding IS NOT NULL) AND (runtime_id IS NOT NULL)))) OR ((kind = 'human_report'::text) AND (((outcome = 'reported_problem'::text) AND (reason = ANY (ARRAY['no_response_to_speech'::text, 'no_moving_video'::text, 'other_problem'::text]))) OR ((outcome = 'inconclusive'::text) AND (reason = ANY (ARRAY['no_expected_signal'::text, 'one_way_audio'::text, 'holding_image'::text]))))) OR ((kind = 'component_measurement'::text) AND (((outcome = 'failed'::text) AND (reason = 'expected_signal_absent'::text)) OR ((outcome = 'passed'::text) AND (reason = 'component_passed'::text)) OR ((outcome = 'inconclusive'::text) AND (reason = 'no_expected_signal'::text))))));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_check2" CHECK ((((capability = 'audio'::text) AND (reason <> ALL (ARRAY['moving_video'::text, 'no_moving_video'::text, 'holding_image'::text]))) OR ((capability = 'video'::text) AND (reason <> ALL (ARRAY['two_way_speech'::text, 'no_response_to_speech'::text, 'one_way_audio'::text])))));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_config_binding_check" CHECK ((config_binding ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_device_binding_check" CHECK ((device_binding ~ '^[0-9a-f]{64}$'::text));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_kind_check" CHECK ((kind = ANY (ARRAY['human_test'::text, 'human_report'::text, 'component_measurement'::text])));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_observed_at_check" CHECK (isfinite(observed_at));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_outcome_check" CHECK ((outcome = ANY (ARRAY['passed'::text, 'failed'::text, 'reported_problem'::text, 'inconclusive'::text])));
alter table public."facetime_media_observations" add constraint "facetime_media_observations_pkey" PRIMARY KEY (id);
alter table public."facetime_worker_onboarding_requests" add constraint "facetime_worker_onboarding_requests_pkey" PRIMARY KEY (project_id, request_id);
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_line_id_key" UNIQUE (line_id);
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_pkey" PRIMARY KEY (worker_id);
alter table public."facetime_membership_audit" add constraint "facetime_membership_audit_pkey" PRIMARY KEY (id);
alter table public."facetime_audit_requests" add constraint "facetime_audit_requests_pkey" PRIMARY KEY (id);
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_approved_release_check" CHECK ((approved_release ~ '^[a-f0-9]{40}$'::text));
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_credential_hash_check" CHECK ((credential_hash ~ '^[a-f0-9]{64}$'::text));
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_credential_hash_key" UNIQUE (credential_hash);
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_host_check" CHECK ((host ~ '^[a-zA-Z0-9._-]{1,100}$'::text));
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_pkey" PRIMARY KEY (worker_id);
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_approved_release_check" CHECK ((approved_release ~ '^[a-f0-9]{40}$'::text));
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_pkey" PRIMARY KEY (id);
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_result_check" CHECK (((result IS NULL) OR (octet_length((result)::text) <= 32768)));
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_state_check" CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'incomplete'::text])));
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_trigger_check" CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text])));
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_verdict_check" CHECK ((verdict = ANY (ARRAY['pass'::text, 'warn'::text, 'fail'::text, 'incomplete'::text])));
alter table public."facetime_audit_notifications" add constraint "facetime_audit_notifications_kind_check" CHECK ((kind = ANY (ARRAY['failure'::text, 'recovery'::text])));
alter table public."facetime_audit_notifications" add constraint "facetime_audit_notifications_pkey" PRIMARY KEY (id);
alter table public."facetime_audit_notifications" add constraint "facetime_audit_notifications_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'sending'::text, 'accepted'::text, 'failed'::text])));
alter table public."realtime_assistants" add constraint "realtime_assistants_active_version_fk" FOREIGN KEY (active_version_id, id, project_id) REFERENCES realtime_assistant_versions(id, assistant_id, project_id) DEFERRABLE INITIALLY DEFERRED;
alter table public."realtime_assistants" add constraint "realtime_assistants_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."realtime_assistants" add constraint "realtime_assistants_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_assistant_id_fkey" FOREIGN KEY (assistant_id) REFERENCES realtime_assistants(id) ON DELETE RESTRICT;
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."realtime_assistant_versions" add constraint "realtime_assistant_versions_published_by_fkey" FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."facetime_development_windows" add constraint "facetime_development_windows_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."facetime_development_windows" add constraint "facetime_development_windows_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id) ON DELETE CASCADE;
alter table public."facetime_development_windows" add constraint "facetime_development_windows_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_development_windows" add constraint "facetime_development_windows_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE CASCADE;
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_rotated_from_id_fkey" FOREIGN KEY (rotated_from_id) REFERENCES facetime_worker_credentials(id) ON DELETE SET NULL;
alter table public."facetime_worker_credentials" add constraint "facetime_worker_credentials_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE CASCADE;
alter table public."facetime_worker_enrollment_tokens" add constraint "facetime_worker_enrollment_tokens_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE CASCADE;
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id) ON DELETE RESTRICT;
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id) ON DELETE RESTRICT;
alter table public."facetime_worker_commands" add constraint "facetime_worker_commands_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_api_keys" add constraint "facetime_api_keys_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."facetime_api_keys" add constraint "facetime_api_keys_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id) ON DELETE RESTRICT;
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_call_transcripts" add constraint "facetime_call_transcripts_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_call_events" add constraint "facetime_call_events_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id) ON DELETE RESTRICT;
alter table public."facetime_call_events" add constraint "facetime_call_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_call_integration_tenant" FOREIGN KEY (integration_revision_id, project_id) REFERENCES facetime_integration_revisions(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_calls_assistant_id_fkey" FOREIGN KEY (assistant_id) REFERENCES realtime_assistants(id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_calls_assistant_version_id_fkey" FOREIGN KEY (assistant_version_id) REFERENCES realtime_assistant_versions(id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_calls_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_calls_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_calls" add constraint "facetime_calls_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_sessions" add constraint "facetime_sessions_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id) ON DELETE RESTRICT;
alter table public."facetime_sessions" add constraint "facetime_sessions_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id) ON DELETE RESTRICT;
alter table public."facetime_sessions" add constraint "facetime_sessions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_sessions" add constraint "facetime_sessions_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_delivery_attempt_tenant" FOREIGN KEY (webhook_event_id, project_id) REFERENCES facetime_webhook_events(event_id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_webhook_delivery_attempts" add constraint "facetime_webhook_delivery_attempts_webhook_event_id_fkey" FOREIGN KEY (webhook_event_id) REFERENCES facetime_webhook_events(event_id) ON DELETE CASCADE;
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_session_id_fkey" FOREIGN KEY (session_id) REFERENCES facetime_sessions(id) ON DELETE CASCADE;
alter table public."facetime_session_credential_seals" add constraint "facetime_session_credential_seals_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_outbox_endpoint_tenant" FOREIGN KEY (endpoint_id, project_id) REFERENCES facetime_webhook_endpoints(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_outbox_signing_identity" FOREIGN KEY (secret_version_id, endpoint_id, project_id, secret_version) REFERENCES facetime_webhook_secret_versions(id, endpoint_id, project_id, version) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_outbox_source_identity" FOREIGN KEY (source_call_event_id, call_id, project_id) REFERENCES facetime_call_events(id, call_id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_endpoint_id_fkey" FOREIGN KEY (endpoint_id) REFERENCES facetime_webhook_endpoints(id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_secret_version_id_project_id_fkey" FOREIGN KEY (secret_version_id, project_id) REFERENCES facetime_webhook_secret_versions(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_events" add constraint "facetime_webhook_events_source_call_event_id_fkey" FOREIGN KEY (source_call_event_id) REFERENCES facetime_call_events(id) ON DELETE RESTRICT;
alter table public."facetime_webhook_endpoints" add constraint "facetime_active_integration_revision" FOREIGN KEY (active_revision_id, id, project_id) REFERENCES facetime_integration_revisions(id, integration_id, project_id) DEFERRABLE INITIALLY DEFERRED;
alter table public."facetime_webhook_endpoints" add constraint "facetime_webhook_endpoints_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_platform_admins" add constraint "facetime_platform_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revision_secret_version_id_integratio_fkey" FOREIGN KEY (secret_version_id, integration_id, project_id, secret_version) REFERENCES facetime_webhook_secret_versions(id, endpoint_id, project_id, version) ON DELETE RESTRICT;
alter table public."facetime_integration_revisions" add constraint "facetime_integration_revisions_integration_id_project_id_fkey" FOREIGN KEY (integration_id, project_id) REFERENCES facetime_webhook_endpoints(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_secret_versions" add constraint "facetime_integration_secret_tenant" FOREIGN KEY (endpoint_id, project_id) REFERENCES facetime_webhook_endpoints(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_endpoint_id_fkey" FOREIGN KEY (endpoint_id) REFERENCES facetime_webhook_endpoints(id) ON DELETE CASCADE;
alter table public."facetime_webhook_secret_versions" add constraint "facetime_webhook_secret_versions_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_project_settings" add constraint "facetime_project_settings_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_lines" add constraint "facetime_line_integration_tenant" FOREIGN KEY (integration_id, project_id) REFERENCES facetime_webhook_endpoints(id, project_id) ON DELETE RESTRICT;
alter table public."facetime_lines" add constraint "facetime_lines_current_call_fk" FOREIGN KEY (current_call_id) REFERENCES facetime_calls(id) ON DELETE SET NULL;
alter table public."facetime_lines" add constraint "facetime_lines_default_assistant_id_fkey" FOREIGN KEY (default_assistant_id) REFERENCES realtime_assistants(id) ON DELETE SET NULL;
alter table public."facetime_lines" add constraint "facetime_lines_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_lines" add constraint "facetime_lines_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_project_memberships" add constraint "facetime_project_memberships_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE CASCADE;
alter table public."facetime_project_memberships" add constraint "facetime_project_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."facetime_configuration_audit" add constraint "facetime_configuration_audit_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_admin_audit" add constraint "facetime_admin_audit_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public."facetime_admin_audit" add constraint "facetime_admin_audit_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id);
alter table public."facetime_workers" add constraint "facetime_workers_current_call_fk" FOREIGN KEY (current_call_id) REFERENCES facetime_calls(id) ON DELETE SET NULL;
alter table public."facetime_media_observations" add constraint "facetime_media_observations_call_id_fkey" FOREIGN KEY (call_id) REFERENCES facetime_calls(id);
alter table public."facetime_media_observations" add constraint "facetime_media_observations_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id);
alter table public."facetime_media_observations" add constraint "facetime_media_observations_observer_id_fkey" FOREIGN KEY (observer_id) REFERENCES auth.users(id);
alter table public."facetime_media_observations" add constraint "facetime_media_observations_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id);
alter table public."facetime_media_observations" add constraint "facetime_media_observations_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id);
alter table public."facetime_worker_onboarding_requests" add constraint "facetime_worker_onboarding_requests_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding_requests" add constraint "facetime_worker_onboarding_requests_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding_requests" add constraint "facetime_worker_onboarding_requests_token_id_fkey" FOREIGN KEY (token_id) REFERENCES facetime_worker_enrollment_tokens(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding_requests" add constraint "facetime_worker_onboarding_requests_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_worker_onboarding(worker_id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_line_id_fkey" FOREIGN KEY (line_id) REFERENCES facetime_lines(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id) ON DELETE RESTRICT;
alter table public."facetime_worker_onboarding" add constraint "facetime_worker_onboarding_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id) ON DELETE RESTRICT;
alter table public."facetime_membership_audit" add constraint "facetime_membership_audit_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table public."facetime_membership_audit" add constraint "facetime_membership_audit_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id);
alter table public."facetime_membership_audit" add constraint "facetime_membership_audit_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id);
alter table public."facetime_audit_requests" add constraint "facetime_audit_requests_run_id_fkey" FOREIGN KEY (run_id) REFERENCES facetime_audit_runs(id);
alter table public."facetime_audit_requests" add constraint "facetime_audit_requests_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_audit_runners(worker_id);
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id);
alter table public."facetime_audit_runners" add constraint "facetime_audit_runners_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_workers(id);
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_project_id_fkey" FOREIGN KEY (project_id) REFERENCES facetime_projects(id);
alter table public."facetime_audit_runs" add constraint "facetime_audit_runs_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_audit_runners(worker_id);
alter table public."facetime_audit_notifications" add constraint "facetime_audit_notifications_run_id_fkey" FOREIGN KEY (run_id) REFERENCES facetime_audit_runs(id);
alter table public."facetime_audit_notifications" add constraint "facetime_audit_notifications_worker_id_fkey" FOREIGN KEY (worker_id) REFERENCES facetime_audit_runners(worker_id);
CREATE INDEX facetime_media_observations_worker_history ON public.facetime_media_observations USING btree (project_id, worker_id, observed_at DESC, id);
CREATE INDEX facetime_sessions_line_idx ON public.facetime_sessions USING btree (line_id, created_at DESC);
CREATE INDEX facetime_configuration_audit_project ON public.facetime_configuration_audit USING btree (project_id, created_at, id);
CREATE INDEX facetime_session_credential_seals_project_idx ON public.facetime_session_credential_seals USING btree (project_id, created_at DESC, id);
CREATE INDEX facetime_events_timeline_idx ON public.facetime_call_events USING btree (call_id, sequence);
CREATE UNIQUE INDEX facetime_webhook_events_logical_transition_unique ON public.facetime_webhook_events USING btree (project_id, call_id, logical_transition) WHERE (logical_transition IS NOT NULL);
CREATE UNIQUE INDEX facetime_calls_one_line_active_idx ON public.facetime_calls USING btree (line_id) WHERE (status <> ALL (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status]));
CREATE INDEX facetime_integrations_project ON public.facetime_webhook_endpoints USING btree (project_id, created_at, id);
CREATE UNIQUE INDEX facetime_legacy_default_integration ON public.facetime_webhook_endpoints USING btree (project_id) WHERE legacy_default;
CREATE UNIQUE INDEX facetime_projects_crm_project_unique ON public.facetime_projects USING btree (crm_project_id) WHERE (crm_project_id IS NOT NULL);
CREATE INDEX facetime_webhook_events_endpoint_idx ON public.facetime_webhook_events USING btree (endpoint_id);
CREATE INDEX facetime_audit_history ON public.facetime_audit_runs USING btree (worker_id, created_at DESC);
CREATE INDEX facetime_api_keys_project_idx ON public.facetime_api_keys USING btree (project_id) WHERE (revoked_at IS NULL);
CREATE INDEX facetime_lines_integration ON public.facetime_lines USING btree (integration_id);
CREATE INDEX facetime_session_credential_seals_project_worker_idx ON public.facetime_session_credential_seals USING btree (project_id, worker_id, session_id);
CREATE INDEX facetime_calls_history_idx ON public.facetime_calls USING btree (project_id, created_at DESC, id DESC);
CREATE INDEX facetime_lines_allocation_idx ON public.facetime_lines USING btree (project_id, status, worker_id) WHERE (current_call_id IS NULL);
CREATE INDEX facetime_calls_integration_revision ON public.facetime_calls USING btree (integration_revision_id);
CREATE INDEX facetime_sessions_project_idx ON public.facetime_sessions USING btree (project_id, created_at DESC, id);
CREATE INDEX facetime_sessions_expiry_idx ON public.facetime_sessions USING btree (expires_at, id) WHERE (state = 'active'::facetime_session_state);
CREATE INDEX facetime_development_windows_active_idx ON public.facetime_development_windows USING btree (worker_id, line_id, expires_at) WHERE (consumed_at IS NULL);
CREATE INDEX facetime_webhook_events_project_idx ON public.facetime_webhook_events USING btree (project_id, created_at DESC, event_id);
CREATE INDEX facetime_session_credential_seals_worker_idx ON public.facetime_session_credential_seals USING btree (worker_id, session_id);
CREATE INDEX facetime_calls_line_idx ON public.facetime_calls USING btree (line_id, status) WHERE (status <> ALL (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status]));
CREATE INDEX facetime_webhook_events_due_idx ON public.facetime_webhook_events USING btree (next_attempt_at, created_at, event_id) WHERE (state = ANY (ARRAY['pending'::facetime_webhook_event_state, 'delivering'::facetime_webhook_event_state]));
CREATE INDEX facetime_call_transcripts_project_idx ON public.facetime_call_transcripts USING btree (project_id, created_at DESC);
CREATE INDEX realtime_assistant_versions_history_idx ON public.realtime_assistant_versions USING btree (assistant_id, version DESC);
CREATE INDEX facetime_webhook_secret_versions_endpoint_idx ON public.facetime_webhook_secret_versions USING btree (endpoint_id);
CREATE INDEX realtime_assistants_project_status_idx ON public.realtime_assistants USING btree (project_id, status, updated_at DESC);
CREATE UNIQUE INDEX facetime_calls_one_worker_active_idx ON public.facetime_calls USING btree (worker_id) WHERE ((worker_id IS NOT NULL) AND (status <> ALL (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status])));
CREATE INDEX facetime_webhook_secret_versions_active_idx ON public.facetime_webhook_secret_versions USING btree (project_id, version DESC) WHERE ((revoked_at IS NULL) AND (retired_at IS NULL));
CREATE INDEX facetime_calls_worker_idx ON public.facetime_calls USING btree (worker_id, status) WHERE (status <> ALL (ARRAY['ended'::facetime_call_status, 'failed'::facetime_call_status, 'rejected'::facetime_call_status]));
CREATE INDEX facetime_sessions_worker_idx ON public.facetime_sessions USING btree (worker_id, created_at DESC);
CREATE INDEX facetime_memberships_user_idx ON public.facetime_project_memberships USING btree (user_id, project_id);
CREATE INDEX facetime_webhook_events_source_idx ON public.facetime_webhook_events USING btree (source_call_event_id);
CREATE INDEX facetime_call_events_public_order_idx ON public.facetime_call_events USING btree (project_id, call_id, worker_sequence, sequence);
CREATE INDEX facetime_webhook_attempts_project_idx ON public.facetime_webhook_delivery_attempts USING btree (project_id, webhook_event_id, attempt_number);
CREATE INDEX facetime_commands_claim_idx ON public.facetime_worker_commands USING btree (worker_id, available_at, created_at) WHERE (status = ANY (ARRAY['queued'::facetime_command_status, 'leased'::facetime_command_status]));
CREATE UNIQUE INDEX facetime_calls_idempotency_idx ON public.facetime_calls USING btree (project_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX facetime_admin_audit_project_time ON public.facetime_admin_audit USING btree (project_id, created_at DESC);
CREATE UNIQUE INDEX facetime_audit_one_active ON public.facetime_audit_runs USING btree (worker_id) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text]));
CREATE INDEX facetime_webhook_events_secret_idx ON public.facetime_webhook_events USING btree (secret_version_id, project_id);
CREATE INDEX facetime_workers_heartbeat_idx ON public.facetime_workers USING btree (status, enabled, last_heartbeat_at DESC);
CREATE INDEX facetime_webhook_events_call_idx ON public.facetime_webhook_events USING btree (call_id, created_at, event_id);
CREATE TRIGGER facetime_projects_touch BEFORE UPDATE ON public.facetime_projects FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER realtime_assistants_touch BEFORE UPDATE ON public.realtime_assistants FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER facetime_workers_touch BEFORE UPDATE ON public.facetime_workers FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER facetime_lines_touch BEFORE UPDATE ON public.facetime_lines FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER facetime_calls_touch BEFORE UPDATE ON public.facetime_calls FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER realtime_assistant_versions_immutable BEFORE DELETE OR UPDATE ON public.realtime_assistant_versions FOR EACH ROW EXECUTE FUNCTION facetime_reject_mutation();
CREATE TRIGGER facetime_call_events_immutable BEFORE DELETE OR UPDATE ON public.facetime_call_events FOR EACH ROW EXECUTE FUNCTION facetime_reject_mutation();
CREATE TRIGGER facetime_calls_terminal_immutable BEFORE UPDATE ON public.facetime_calls FOR EACH ROW EXECUTE FUNCTION facetime_protect_terminal_call();
CREATE TRIGGER realtime_assistant_versions_project_guard BEFORE INSERT ON public.realtime_assistant_versions FOR EACH ROW EXECUTE FUNCTION facetime_validate_project_links();
CREATE TRIGGER facetime_call_events_project_guard BEFORE INSERT ON public.facetime_call_events FOR EACH ROW EXECUTE FUNCTION facetime_validate_project_links();
CREATE TRIGGER facetime_lines_project_guard BEFORE INSERT OR UPDATE OF project_id, default_assistant_id ON public.facetime_lines FOR EACH ROW EXECUTE FUNCTION facetime_validate_project_links();
CREATE TRIGGER facetime_calls_project_guard BEFORE INSERT OR UPDATE OF project_id, line_id, assistant_id, assistant_version_id ON public.facetime_calls FOR EACH ROW EXECUTE FUNCTION facetime_validate_project_links();
CREATE TRIGGER facetime_projects_prevent_crm_remap BEFORE UPDATE OF crm_project_id ON public.facetime_projects FOR EACH ROW EXECUTE FUNCTION facetime_prevent_crm_project_remap();
CREATE TRIGGER facetime_annotate_development_audio_test BEFORE INSERT ON public.facetime_worker_commands FOR EACH ROW EXECUTE FUNCTION facetime_annotate_development_audio_test();
CREATE TRIGGER facetime_call_events_prepare_insert BEFORE INSERT ON public.facetime_call_events FOR EACH ROW EXECUTE FUNCTION facetime_prepare_call_event_insert();
CREATE TRIGGER facetime_sessions_touch BEFORE UPDATE ON public.facetime_sessions FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE TRIGGER facetime_sessions_validate_linkage BEFORE INSERT OR UPDATE OF project_id, call_id, line_id, worker_id ON public.facetime_sessions FOR EACH ROW EXECUTE FUNCTION facetime_validate_session_linkage();
CREATE TRIGGER facetime_call_events_apply_session AFTER INSERT ON public.facetime_call_events FOR EACH ROW EXECUTE FUNCTION facetime_apply_call_event_to_session();
CREATE TRIGGER facetime_webhook_endpoints_touch BEFORE UPDATE ON public.facetime_webhook_endpoints FOR EACH ROW EXECUTE FUNCTION facetime_touch_updated_at();
CREATE CONSTRAINT TRIGGER facetime_call_events_enqueue_webhook AFTER INSERT ON public.facetime_call_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facetime_enqueue_call_webhook();
CREATE TRIGGER facetime_call_events_webhook_ingestion_time BEFORE INSERT ON public.facetime_call_events FOR EACH ROW EXECUTE FUNCTION facetime_stamp_webhook_ingestion_time();
CREATE TRIGGER facetime_sessions_tombstone_credentials AFTER UPDATE OF state ON public.facetime_sessions FOR EACH ROW EXECUTE FUNCTION facetime_tombstone_session_credentials();
CREATE TRIGGER facetime_integration_revisions_immutable BEFORE DELETE OR UPDATE ON public.facetime_integration_revisions FOR EACH ROW EXECUTE FUNCTION facetime_reject_mutation();
CREATE TRIGGER facetime_configuration_audit_immutable BEFORE DELETE OR UPDATE ON public.facetime_configuration_audit FOR EACH ROW EXECUTE FUNCTION facetime_reject_mutation();
CREATE TRIGGER facetime_integration_secret_guard BEFORE INSERT OR UPDATE ON public.facetime_webhook_secret_versions FOR EACH ROW EXECUTE FUNCTION facetime_integration_secret_guard();
CREATE TRIGGER facetime_integration_configuration_audit AFTER INSERT OR DELETE OR UPDATE ON public.facetime_webhook_endpoints FOR EACH ROW EXECUTE FUNCTION facetime_audit_integration_configuration();
CREATE TRIGGER facetime_integration_secret_audit AFTER INSERT OR DELETE OR UPDATE ON public.facetime_webhook_secret_versions FOR EACH ROW EXECUTE FUNCTION facetime_audit_integration_configuration();
CREATE TRIGGER facetime_line_assignment_guard BEFORE INSERT OR DELETE OR UPDATE ON public.facetime_lines FOR EACH ROW EXECUTE FUNCTION facetime_line_assignment_guard();
CREATE TRIGGER facetime_pin_call_integration BEFORE INSERT OR UPDATE ON public.facetime_calls FOR EACH ROW EXECUTE FUNCTION facetime_pin_call_integration();
CREATE TRIGGER facetime_project_hosts_changed AFTER INSERT OR DELETE OR UPDATE ON public.facetime_project_settings FOR EACH ROW EXECUTE FUNCTION facetime_project_hosts_changed();
CREATE TRIGGER facetime_protect_webhook_snapshot BEFORE UPDATE ON public.facetime_webhook_events FOR EACH ROW EXECUTE FUNCTION facetime_protect_webhook_snapshot();
CREATE CONSTRAINT TRIGGER facetime_validate_active_revision AFTER INSERT OR UPDATE ON public.facetime_webhook_endpoints DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facetime_validate_active_revision();
CREATE TRIGGER facetime_media_observation_guard BEFORE INSERT OR DELETE OR UPDATE ON public.facetime_media_observations FOR EACH ROW EXECUTE FUNCTION facetime_media_observation_guard();
CREATE TRIGGER facetime_onboarding_worker_guard BEFORE UPDATE ON public.facetime_workers FOR EACH ROW EXECUTE FUNCTION facetime_guard_onboarded_worker();
CREATE TRIGGER facetime_onboarding_line_guard BEFORE INSERT OR UPDATE ON public.facetime_lines FOR EACH ROW EXECUTE FUNCTION facetime_guard_onboarded_line();
CREATE TRIGGER facetime_pin_video_framing BEFORE INSERT OR UPDATE ON public.facetime_calls FOR EACH ROW EXECUTE FUNCTION facetime_pin_video_framing();
CREATE TRIGGER facetime_audit_immutable_report BEFORE UPDATE ON public.facetime_audit_runs FOR EACH ROW EXECUTE FUNCTION facetime_audit_immutable_report();
create policy "realtime_assistants_member_select" on public."realtime_assistants" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "realtime_assistant_versions_member_select" on public."realtime_assistant_versions" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_development_windows_member_select" on public."facetime_development_windows" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_api_keys_member_select" on public."facetime_api_keys" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_projects_member_select" on public."facetime_projects" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(id));
create policy "facetime_call_events_member_select" on public."facetime_call_events" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_calls_member_select" on public."facetime_calls" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_sessions_member_select" on public."facetime_sessions" as PERMISSIVE for SELECT to "authenticated" using (facetime_is_project_member(project_id));
create policy "facetime_lines_member_select" on public."facetime_lines" as PERMISSIVE for SELECT to "authenticated" using (((project_id IS NOT NULL) AND facetime_is_project_member(project_id)));
create policy "facetime_memberships_self_select" on public."facetime_project_memberships" as PERMISSIVE for SELECT to "authenticated" using ((user_id = auth.uid()));
alter table public."realtime_assistants" enable row level security;
revoke all on table public."realtime_assistants" from public,anon,authenticated,service_role;
grant insert on table public."realtime_assistants" to "postgres";
grant select on table public."realtime_assistants" to "postgres";
grant update on table public."realtime_assistants" to "postgres";
grant delete on table public."realtime_assistants" to "postgres";
grant truncate on table public."realtime_assistants" to "postgres";
grant references on table public."realtime_assistants" to "postgres";
grant trigger on table public."realtime_assistants" to "postgres";
grant maintain on table public."realtime_assistants" to "postgres";
grant insert on table public."realtime_assistants" to "anon";
grant select on table public."realtime_assistants" to "anon";
grant update on table public."realtime_assistants" to "anon";
grant delete on table public."realtime_assistants" to "anon";
grant truncate on table public."realtime_assistants" to "anon";
grant references on table public."realtime_assistants" to "anon";
grant trigger on table public."realtime_assistants" to "anon";
grant maintain on table public."realtime_assistants" to "anon";
grant insert on table public."realtime_assistants" to "authenticated";
grant select on table public."realtime_assistants" to "authenticated";
grant update on table public."realtime_assistants" to "authenticated";
grant delete on table public."realtime_assistants" to "authenticated";
grant truncate on table public."realtime_assistants" to "authenticated";
grant references on table public."realtime_assistants" to "authenticated";
grant trigger on table public."realtime_assistants" to "authenticated";
grant maintain on table public."realtime_assistants" to "authenticated";
grant insert on table public."realtime_assistants" to "service_role";
grant select on table public."realtime_assistants" to "service_role";
grant update on table public."realtime_assistants" to "service_role";
grant delete on table public."realtime_assistants" to "service_role";
grant truncate on table public."realtime_assistants" to "service_role";
grant references on table public."realtime_assistants" to "service_role";
grant trigger on table public."realtime_assistants" to "service_role";
grant maintain on table public."realtime_assistants" to "service_role";
alter table public."realtime_assistant_versions" enable row level security;
revoke all on table public."realtime_assistant_versions" from public,anon,authenticated,service_role;
grant insert on table public."realtime_assistant_versions" to "postgres";
grant select on table public."realtime_assistant_versions" to "postgres";
grant update on table public."realtime_assistant_versions" to "postgres";
grant delete on table public."realtime_assistant_versions" to "postgres";
grant truncate on table public."realtime_assistant_versions" to "postgres";
grant references on table public."realtime_assistant_versions" to "postgres";
grant trigger on table public."realtime_assistant_versions" to "postgres";
grant maintain on table public."realtime_assistant_versions" to "postgres";
grant insert on table public."realtime_assistant_versions" to "anon";
grant select on table public."realtime_assistant_versions" to "anon";
grant update on table public."realtime_assistant_versions" to "anon";
grant delete on table public."realtime_assistant_versions" to "anon";
grant truncate on table public."realtime_assistant_versions" to "anon";
grant references on table public."realtime_assistant_versions" to "anon";
grant trigger on table public."realtime_assistant_versions" to "anon";
grant maintain on table public."realtime_assistant_versions" to "anon";
grant insert on table public."realtime_assistant_versions" to "authenticated";
grant select on table public."realtime_assistant_versions" to "authenticated";
grant update on table public."realtime_assistant_versions" to "authenticated";
grant delete on table public."realtime_assistant_versions" to "authenticated";
grant truncate on table public."realtime_assistant_versions" to "authenticated";
grant references on table public."realtime_assistant_versions" to "authenticated";
grant trigger on table public."realtime_assistant_versions" to "authenticated";
grant maintain on table public."realtime_assistant_versions" to "authenticated";
grant insert on table public."realtime_assistant_versions" to "service_role";
grant select on table public."realtime_assistant_versions" to "service_role";
grant update on table public."realtime_assistant_versions" to "service_role";
grant delete on table public."realtime_assistant_versions" to "service_role";
grant truncate on table public."realtime_assistant_versions" to "service_role";
grant references on table public."realtime_assistant_versions" to "service_role";
grant trigger on table public."realtime_assistant_versions" to "service_role";
grant maintain on table public."realtime_assistant_versions" to "service_role";
alter table public."facetime_development_windows" enable row level security;
revoke all on table public."facetime_development_windows" from public,anon,authenticated,service_role;
grant insert on table public."facetime_development_windows" to "postgres";
grant select on table public."facetime_development_windows" to "postgres";
grant update on table public."facetime_development_windows" to "postgres";
grant delete on table public."facetime_development_windows" to "postgres";
grant truncate on table public."facetime_development_windows" to "postgres";
grant references on table public."facetime_development_windows" to "postgres";
grant trigger on table public."facetime_development_windows" to "postgres";
grant maintain on table public."facetime_development_windows" to "postgres";
grant insert on table public."facetime_development_windows" to "anon";
grant select on table public."facetime_development_windows" to "anon";
grant update on table public."facetime_development_windows" to "anon";
grant delete on table public."facetime_development_windows" to "anon";
grant truncate on table public."facetime_development_windows" to "anon";
grant references on table public."facetime_development_windows" to "anon";
grant trigger on table public."facetime_development_windows" to "anon";
grant maintain on table public."facetime_development_windows" to "anon";
grant insert on table public."facetime_development_windows" to "authenticated";
grant select on table public."facetime_development_windows" to "authenticated";
grant update on table public."facetime_development_windows" to "authenticated";
grant delete on table public."facetime_development_windows" to "authenticated";
grant truncate on table public."facetime_development_windows" to "authenticated";
grant references on table public."facetime_development_windows" to "authenticated";
grant trigger on table public."facetime_development_windows" to "authenticated";
grant maintain on table public."facetime_development_windows" to "authenticated";
grant insert on table public."facetime_development_windows" to "service_role";
grant select on table public."facetime_development_windows" to "service_role";
grant update on table public."facetime_development_windows" to "service_role";
grant delete on table public."facetime_development_windows" to "service_role";
grant truncate on table public."facetime_development_windows" to "service_role";
grant references on table public."facetime_development_windows" to "service_role";
grant trigger on table public."facetime_development_windows" to "service_role";
grant maintain on table public."facetime_development_windows" to "service_role";
alter table public."facetime_worker_credentials" enable row level security;
revoke all on table public."facetime_worker_credentials" from public,anon,authenticated,service_role;
grant insert on table public."facetime_worker_credentials" to "postgres";
grant select on table public."facetime_worker_credentials" to "postgres";
grant update on table public."facetime_worker_credentials" to "postgres";
grant delete on table public."facetime_worker_credentials" to "postgres";
grant truncate on table public."facetime_worker_credentials" to "postgres";
grant references on table public."facetime_worker_credentials" to "postgres";
grant trigger on table public."facetime_worker_credentials" to "postgres";
grant maintain on table public."facetime_worker_credentials" to "postgres";
grant insert on table public."facetime_worker_credentials" to "service_role";
grant select on table public."facetime_worker_credentials" to "service_role";
grant update on table public."facetime_worker_credentials" to "service_role";
grant delete on table public."facetime_worker_credentials" to "service_role";
grant truncate on table public."facetime_worker_credentials" to "service_role";
grant references on table public."facetime_worker_credentials" to "service_role";
grant trigger on table public."facetime_worker_credentials" to "service_role";
grant maintain on table public."facetime_worker_credentials" to "service_role";
alter table public."facetime_worker_enrollment_tokens" enable row level security;
revoke all on table public."facetime_worker_enrollment_tokens" from public,anon,authenticated,service_role;
grant insert on table public."facetime_worker_enrollment_tokens" to "postgres";
grant select on table public."facetime_worker_enrollment_tokens" to "postgres";
grant update on table public."facetime_worker_enrollment_tokens" to "postgres";
grant delete on table public."facetime_worker_enrollment_tokens" to "postgres";
grant truncate on table public."facetime_worker_enrollment_tokens" to "postgres";
grant references on table public."facetime_worker_enrollment_tokens" to "postgres";
grant trigger on table public."facetime_worker_enrollment_tokens" to "postgres";
grant maintain on table public."facetime_worker_enrollment_tokens" to "postgres";
grant insert on table public."facetime_worker_enrollment_tokens" to "service_role";
grant select on table public."facetime_worker_enrollment_tokens" to "service_role";
grant update on table public."facetime_worker_enrollment_tokens" to "service_role";
grant delete on table public."facetime_worker_enrollment_tokens" to "service_role";
grant truncate on table public."facetime_worker_enrollment_tokens" to "service_role";
grant references on table public."facetime_worker_enrollment_tokens" to "service_role";
grant trigger on table public."facetime_worker_enrollment_tokens" to "service_role";
grant maintain on table public."facetime_worker_enrollment_tokens" to "service_role";
alter table public."facetime_worker_commands" enable row level security;
revoke all on table public."facetime_worker_commands" from public,anon,authenticated,service_role;
grant insert on table public."facetime_worker_commands" to "postgres";
grant select on table public."facetime_worker_commands" to "postgres";
grant update on table public."facetime_worker_commands" to "postgres";
grant delete on table public."facetime_worker_commands" to "postgres";
grant truncate on table public."facetime_worker_commands" to "postgres";
grant references on table public."facetime_worker_commands" to "postgres";
grant trigger on table public."facetime_worker_commands" to "postgres";
grant maintain on table public."facetime_worker_commands" to "postgres";
grant insert on table public."facetime_worker_commands" to "service_role";
grant select on table public."facetime_worker_commands" to "service_role";
grant update on table public."facetime_worker_commands" to "service_role";
grant delete on table public."facetime_worker_commands" to "service_role";
grant truncate on table public."facetime_worker_commands" to "service_role";
grant references on table public."facetime_worker_commands" to "service_role";
grant trigger on table public."facetime_worker_commands" to "service_role";
grant maintain on table public."facetime_worker_commands" to "service_role";
alter table public."facetime_api_keys" enable row level security;
revoke all on table public."facetime_api_keys" from public,anon,authenticated,service_role;
grant insert on table public."facetime_api_keys" to "postgres";
grant select on table public."facetime_api_keys" to "postgres";
grant update on table public."facetime_api_keys" to "postgres";
grant delete on table public."facetime_api_keys" to "postgres";
grant truncate on table public."facetime_api_keys" to "postgres";
grant references on table public."facetime_api_keys" to "postgres";
grant trigger on table public."facetime_api_keys" to "postgres";
grant maintain on table public."facetime_api_keys" to "postgres";
grant insert on table public."facetime_api_keys" to "service_role";
grant select on table public."facetime_api_keys" to "service_role";
grant update on table public."facetime_api_keys" to "service_role";
grant delete on table public."facetime_api_keys" to "service_role";
grant truncate on table public."facetime_api_keys" to "service_role";
grant references on table public."facetime_api_keys" to "service_role";
grant trigger on table public."facetime_api_keys" to "service_role";
grant maintain on table public."facetime_api_keys" to "service_role";
alter table public."facetime_projects" enable row level security;
revoke all on table public."facetime_projects" from public,anon,authenticated,service_role;
grant insert on table public."facetime_projects" to "postgres";
grant select on table public."facetime_projects" to "postgres";
grant update on table public."facetime_projects" to "postgres";
grant delete on table public."facetime_projects" to "postgres";
grant truncate on table public."facetime_projects" to "postgres";
grant references on table public."facetime_projects" to "postgres";
grant trigger on table public."facetime_projects" to "postgres";
grant maintain on table public."facetime_projects" to "postgres";
grant insert on table public."facetime_projects" to "anon";
grant select on table public."facetime_projects" to "anon";
grant update on table public."facetime_projects" to "anon";
grant delete on table public."facetime_projects" to "anon";
grant truncate on table public."facetime_projects" to "anon";
grant references on table public."facetime_projects" to "anon";
grant trigger on table public."facetime_projects" to "anon";
grant maintain on table public."facetime_projects" to "anon";
grant insert on table public."facetime_projects" to "authenticated";
grant select on table public."facetime_projects" to "authenticated";
grant update on table public."facetime_projects" to "authenticated";
grant delete on table public."facetime_projects" to "authenticated";
grant truncate on table public."facetime_projects" to "authenticated";
grant references on table public."facetime_projects" to "authenticated";
grant trigger on table public."facetime_projects" to "authenticated";
grant maintain on table public."facetime_projects" to "authenticated";
grant insert on table public."facetime_projects" to "service_role";
grant select on table public."facetime_projects" to "service_role";
grant update on table public."facetime_projects" to "service_role";
grant delete on table public."facetime_projects" to "service_role";
grant truncate on table public."facetime_projects" to "service_role";
grant references on table public."facetime_projects" to "service_role";
grant trigger on table public."facetime_projects" to "service_role";
grant maintain on table public."facetime_projects" to "service_role";
alter table public."facetime_call_transcripts" enable row level security;
revoke all on table public."facetime_call_transcripts" from public,anon,authenticated,service_role;
grant insert on table public."facetime_call_transcripts" to "postgres";
grant select on table public."facetime_call_transcripts" to "postgres";
grant update on table public."facetime_call_transcripts" to "postgres";
grant delete on table public."facetime_call_transcripts" to "postgres";
grant truncate on table public."facetime_call_transcripts" to "postgres";
grant references on table public."facetime_call_transcripts" to "postgres";
grant trigger on table public."facetime_call_transcripts" to "postgres";
grant maintain on table public."facetime_call_transcripts" to "postgres";
grant insert on table public."facetime_call_transcripts" to "service_role";
grant select on table public."facetime_call_transcripts" to "service_role";
grant update on table public."facetime_call_transcripts" to "service_role";
grant delete on table public."facetime_call_transcripts" to "service_role";
grant truncate on table public."facetime_call_transcripts" to "service_role";
grant references on table public."facetime_call_transcripts" to "service_role";
grant trigger on table public."facetime_call_transcripts" to "service_role";
grant maintain on table public."facetime_call_transcripts" to "service_role";
alter table public."facetime_call_events" enable row level security;
revoke all on table public."facetime_call_events" from public,anon,authenticated,service_role;
grant insert on table public."facetime_call_events" to "postgres";
grant select on table public."facetime_call_events" to "postgres";
grant update on table public."facetime_call_events" to "postgres";
grant delete on table public."facetime_call_events" to "postgres";
grant truncate on table public."facetime_call_events" to "postgres";
grant references on table public."facetime_call_events" to "postgres";
grant trigger on table public."facetime_call_events" to "postgres";
grant maintain on table public."facetime_call_events" to "postgres";
grant insert on table public."facetime_call_events" to "anon";
grant select on table public."facetime_call_events" to "anon";
grant update on table public."facetime_call_events" to "anon";
grant delete on table public."facetime_call_events" to "anon";
grant truncate on table public."facetime_call_events" to "anon";
grant references on table public."facetime_call_events" to "anon";
grant trigger on table public."facetime_call_events" to "anon";
grant maintain on table public."facetime_call_events" to "anon";
grant insert on table public."facetime_call_events" to "authenticated";
grant select on table public."facetime_call_events" to "authenticated";
grant update on table public."facetime_call_events" to "authenticated";
grant delete on table public."facetime_call_events" to "authenticated";
grant truncate on table public."facetime_call_events" to "authenticated";
grant references on table public."facetime_call_events" to "authenticated";
grant trigger on table public."facetime_call_events" to "authenticated";
grant maintain on table public."facetime_call_events" to "authenticated";
grant insert on table public."facetime_call_events" to "service_role";
grant select on table public."facetime_call_events" to "service_role";
grant update on table public."facetime_call_events" to "service_role";
grant delete on table public."facetime_call_events" to "service_role";
grant truncate on table public."facetime_call_events" to "service_role";
grant references on table public."facetime_call_events" to "service_role";
grant trigger on table public."facetime_call_events" to "service_role";
grant maintain on table public."facetime_call_events" to "service_role";
alter table public."facetime_calls" enable row level security;
revoke all on table public."facetime_calls" from public,anon,authenticated,service_role;
grant insert on table public."facetime_calls" to "postgres";
grant select on table public."facetime_calls" to "postgres";
grant update on table public."facetime_calls" to "postgres";
grant delete on table public."facetime_calls" to "postgres";
grant truncate on table public."facetime_calls" to "postgres";
grant references on table public."facetime_calls" to "postgres";
grant trigger on table public."facetime_calls" to "postgres";
grant maintain on table public."facetime_calls" to "postgres";
grant insert on table public."facetime_calls" to "anon";
grant select on table public."facetime_calls" to "anon";
grant update on table public."facetime_calls" to "anon";
grant delete on table public."facetime_calls" to "anon";
grant truncate on table public."facetime_calls" to "anon";
grant references on table public."facetime_calls" to "anon";
grant trigger on table public."facetime_calls" to "anon";
grant maintain on table public."facetime_calls" to "anon";
grant insert on table public."facetime_calls" to "authenticated";
grant select on table public."facetime_calls" to "authenticated";
grant update on table public."facetime_calls" to "authenticated";
grant delete on table public."facetime_calls" to "authenticated";
grant truncate on table public."facetime_calls" to "authenticated";
grant references on table public."facetime_calls" to "authenticated";
grant trigger on table public."facetime_calls" to "authenticated";
grant maintain on table public."facetime_calls" to "authenticated";
grant insert on table public."facetime_calls" to "service_role";
grant select on table public."facetime_calls" to "service_role";
grant update on table public."facetime_calls" to "service_role";
grant delete on table public."facetime_calls" to "service_role";
grant truncate on table public."facetime_calls" to "service_role";
grant references on table public."facetime_calls" to "service_role";
grant trigger on table public."facetime_calls" to "service_role";
grant maintain on table public."facetime_calls" to "service_role";
alter table public."facetime_sessions" enable row level security;
revoke all on table public."facetime_sessions" from public,anon,authenticated,service_role;
grant insert on table public."facetime_sessions" to "postgres";
grant select on table public."facetime_sessions" to "postgres";
grant update on table public."facetime_sessions" to "postgres";
grant delete on table public."facetime_sessions" to "postgres";
grant truncate on table public."facetime_sessions" to "postgres";
grant references on table public."facetime_sessions" to "postgres";
grant trigger on table public."facetime_sessions" to "postgres";
grant maintain on table public."facetime_sessions" to "postgres";
grant insert on table public."facetime_sessions" to "service_role";
grant select on table public."facetime_sessions" to "service_role";
grant update on table public."facetime_sessions" to "service_role";
grant delete on table public."facetime_sessions" to "service_role";
grant truncate on table public."facetime_sessions" to "service_role";
grant references on table public."facetime_sessions" to "service_role";
grant trigger on table public."facetime_sessions" to "service_role";
grant maintain on table public."facetime_sessions" to "service_role";
alter table public."facetime_webhook_delivery_attempts" enable row level security;
revoke all on table public."facetime_webhook_delivery_attempts" from public,anon,authenticated,service_role;
grant insert on table public."facetime_webhook_delivery_attempts" to "postgres";
grant select on table public."facetime_webhook_delivery_attempts" to "postgres";
grant update on table public."facetime_webhook_delivery_attempts" to "postgres";
grant delete on table public."facetime_webhook_delivery_attempts" to "postgres";
grant truncate on table public."facetime_webhook_delivery_attempts" to "postgres";
grant references on table public."facetime_webhook_delivery_attempts" to "postgres";
grant trigger on table public."facetime_webhook_delivery_attempts" to "postgres";
grant maintain on table public."facetime_webhook_delivery_attempts" to "postgres";
grant insert on table public."facetime_webhook_delivery_attempts" to "service_role";
grant select on table public."facetime_webhook_delivery_attempts" to "service_role";
grant update on table public."facetime_webhook_delivery_attempts" to "service_role";
grant delete on table public."facetime_webhook_delivery_attempts" to "service_role";
grant truncate on table public."facetime_webhook_delivery_attempts" to "service_role";
grant references on table public."facetime_webhook_delivery_attempts" to "service_role";
grant trigger on table public."facetime_webhook_delivery_attempts" to "service_role";
grant maintain on table public."facetime_webhook_delivery_attempts" to "service_role";
alter table public."facetime_session_credential_seals" enable row level security;
revoke all on table public."facetime_session_credential_seals" from public,anon,authenticated,service_role;
grant insert on table public."facetime_session_credential_seals" to "postgres";
grant select on table public."facetime_session_credential_seals" to "postgres";
grant update on table public."facetime_session_credential_seals" to "postgres";
grant delete on table public."facetime_session_credential_seals" to "postgres";
grant truncate on table public."facetime_session_credential_seals" to "postgres";
grant references on table public."facetime_session_credential_seals" to "postgres";
grant trigger on table public."facetime_session_credential_seals" to "postgres";
grant maintain on table public."facetime_session_credential_seals" to "postgres";
grant insert on table public."facetime_session_credential_seals" to "service_role";
grant select on table public."facetime_session_credential_seals" to "service_role";
grant update on table public."facetime_session_credential_seals" to "service_role";
grant delete on table public."facetime_session_credential_seals" to "service_role";
grant truncate on table public."facetime_session_credential_seals" to "service_role";
grant references on table public."facetime_session_credential_seals" to "service_role";
grant trigger on table public."facetime_session_credential_seals" to "service_role";
grant maintain on table public."facetime_session_credential_seals" to "service_role";
alter table public."facetime_webhook_events" enable row level security;
revoke all on table public."facetime_webhook_events" from public,anon,authenticated,service_role;
grant insert on table public."facetime_webhook_events" to "postgres";
grant select on table public."facetime_webhook_events" to "postgres";
grant update on table public."facetime_webhook_events" to "postgres";
grant delete on table public."facetime_webhook_events" to "postgres";
grant truncate on table public."facetime_webhook_events" to "postgres";
grant references on table public."facetime_webhook_events" to "postgres";
grant trigger on table public."facetime_webhook_events" to "postgres";
grant maintain on table public."facetime_webhook_events" to "postgres";
grant insert on table public."facetime_webhook_events" to "service_role";
grant select on table public."facetime_webhook_events" to "service_role";
grant update on table public."facetime_webhook_events" to "service_role";
grant delete on table public."facetime_webhook_events" to "service_role";
grant truncate on table public."facetime_webhook_events" to "service_role";
grant references on table public."facetime_webhook_events" to "service_role";
grant trigger on table public."facetime_webhook_events" to "service_role";
grant maintain on table public."facetime_webhook_events" to "service_role";
alter table public."facetime_webhook_endpoints" enable row level security;
revoke all on table public."facetime_webhook_endpoints" from public,anon,authenticated,service_role;
grant insert on table public."facetime_webhook_endpoints" to "postgres";
grant select on table public."facetime_webhook_endpoints" to "postgres";
grant update on table public."facetime_webhook_endpoints" to "postgres";
grant delete on table public."facetime_webhook_endpoints" to "postgres";
grant truncate on table public."facetime_webhook_endpoints" to "postgres";
grant references on table public."facetime_webhook_endpoints" to "postgres";
grant trigger on table public."facetime_webhook_endpoints" to "postgres";
grant maintain on table public."facetime_webhook_endpoints" to "postgres";
grant select on table public."facetime_webhook_endpoints" to "service_role";
grant truncate on table public."facetime_webhook_endpoints" to "service_role";
grant references on table public."facetime_webhook_endpoints" to "service_role";
grant trigger on table public."facetime_webhook_endpoints" to "service_role";
grant maintain on table public."facetime_webhook_endpoints" to "service_role";
alter table public."facetime_platform_admins" enable row level security;
revoke all on table public."facetime_platform_admins" from public,anon,authenticated,service_role;
grant insert on table public."facetime_platform_admins" to "postgres";
grant select on table public."facetime_platform_admins" to "postgres";
grant update on table public."facetime_platform_admins" to "postgres";
grant delete on table public."facetime_platform_admins" to "postgres";
grant truncate on table public."facetime_platform_admins" to "postgres";
grant references on table public."facetime_platform_admins" to "postgres";
grant trigger on table public."facetime_platform_admins" to "postgres";
grant maintain on table public."facetime_platform_admins" to "postgres";
grant select on table public."facetime_platform_admins" to "service_role";
alter table public."facetime_integration_revisions" enable row level security;
revoke all on table public."facetime_integration_revisions" from public,anon,authenticated,service_role;
grant insert on table public."facetime_integration_revisions" to "postgres";
grant select on table public."facetime_integration_revisions" to "postgres";
grant update on table public."facetime_integration_revisions" to "postgres";
grant delete on table public."facetime_integration_revisions" to "postgres";
grant truncate on table public."facetime_integration_revisions" to "postgres";
grant references on table public."facetime_integration_revisions" to "postgres";
grant trigger on table public."facetime_integration_revisions" to "postgres";
grant maintain on table public."facetime_integration_revisions" to "postgres";
grant select on table public."facetime_integration_revisions" to "service_role";
alter table public."facetime_webhook_secret_versions" enable row level security;
revoke all on table public."facetime_webhook_secret_versions" from public,anon,authenticated,service_role;
grant insert on table public."facetime_webhook_secret_versions" to "postgres";
grant select on table public."facetime_webhook_secret_versions" to "postgres";
grant update on table public."facetime_webhook_secret_versions" to "postgres";
grant delete on table public."facetime_webhook_secret_versions" to "postgres";
grant truncate on table public."facetime_webhook_secret_versions" to "postgres";
grant references on table public."facetime_webhook_secret_versions" to "postgres";
grant trigger on table public."facetime_webhook_secret_versions" to "postgres";
grant maintain on table public."facetime_webhook_secret_versions" to "postgres";
grant select on table public."facetime_webhook_secret_versions" to "service_role";
grant truncate on table public."facetime_webhook_secret_versions" to "service_role";
grant references on table public."facetime_webhook_secret_versions" to "service_role";
grant trigger on table public."facetime_webhook_secret_versions" to "service_role";
grant maintain on table public."facetime_webhook_secret_versions" to "service_role";
alter table public."facetime_project_settings" enable row level security;
revoke all on table public."facetime_project_settings" from public,anon,authenticated,service_role;
grant insert on table public."facetime_project_settings" to "postgres";
grant select on table public."facetime_project_settings" to "postgres";
grant update on table public."facetime_project_settings" to "postgres";
grant delete on table public."facetime_project_settings" to "postgres";
grant truncate on table public."facetime_project_settings" to "postgres";
grant references on table public."facetime_project_settings" to "postgres";
grant trigger on table public."facetime_project_settings" to "postgres";
grant maintain on table public."facetime_project_settings" to "postgres";
grant select on table public."facetime_project_settings" to "service_role";
grant truncate on table public."facetime_project_settings" to "service_role";
grant references on table public."facetime_project_settings" to "service_role";
grant trigger on table public."facetime_project_settings" to "service_role";
grant maintain on table public."facetime_project_settings" to "service_role";
alter table public."facetime_lines" enable row level security;
revoke all on table public."facetime_lines" from public,anon,authenticated,service_role;
grant insert on table public."facetime_lines" to "postgres";
grant select on table public."facetime_lines" to "postgres";
grant update on table public."facetime_lines" to "postgres";
grant delete on table public."facetime_lines" to "postgres";
grant truncate on table public."facetime_lines" to "postgres";
grant references on table public."facetime_lines" to "postgres";
grant trigger on table public."facetime_lines" to "postgres";
grant maintain on table public."facetime_lines" to "postgres";
grant insert on table public."facetime_lines" to "anon";
grant select on table public."facetime_lines" to "anon";
grant update on table public."facetime_lines" to "anon";
grant delete on table public."facetime_lines" to "anon";
grant truncate on table public."facetime_lines" to "anon";
grant references on table public."facetime_lines" to "anon";
grant trigger on table public."facetime_lines" to "anon";
grant maintain on table public."facetime_lines" to "anon";
grant insert on table public."facetime_lines" to "authenticated";
grant select on table public."facetime_lines" to "authenticated";
grant update on table public."facetime_lines" to "authenticated";
grant delete on table public."facetime_lines" to "authenticated";
grant truncate on table public."facetime_lines" to "authenticated";
grant references on table public."facetime_lines" to "authenticated";
grant trigger on table public."facetime_lines" to "authenticated";
grant maintain on table public."facetime_lines" to "authenticated";
grant insert on table public."facetime_lines" to "service_role";
grant select on table public."facetime_lines" to "service_role";
grant update on table public."facetime_lines" to "service_role";
grant delete on table public."facetime_lines" to "service_role";
grant truncate on table public."facetime_lines" to "service_role";
grant references on table public."facetime_lines" to "service_role";
grant trigger on table public."facetime_lines" to "service_role";
grant maintain on table public."facetime_lines" to "service_role";
alter table public."facetime_project_memberships" enable row level security;
revoke all on table public."facetime_project_memberships" from public,anon,authenticated,service_role;
grant insert on table public."facetime_project_memberships" to "postgres";
grant select on table public."facetime_project_memberships" to "postgres";
grant update on table public."facetime_project_memberships" to "postgres";
grant delete on table public."facetime_project_memberships" to "postgres";
grant truncate on table public."facetime_project_memberships" to "postgres";
grant references on table public."facetime_project_memberships" to "postgres";
grant trigger on table public."facetime_project_memberships" to "postgres";
grant maintain on table public."facetime_project_memberships" to "postgres";
grant insert on table public."facetime_project_memberships" to "anon";
grant select on table public."facetime_project_memberships" to "anon";
grant update on table public."facetime_project_memberships" to "anon";
grant delete on table public."facetime_project_memberships" to "anon";
grant truncate on table public."facetime_project_memberships" to "anon";
grant references on table public."facetime_project_memberships" to "anon";
grant trigger on table public."facetime_project_memberships" to "anon";
grant maintain on table public."facetime_project_memberships" to "anon";
grant insert on table public."facetime_project_memberships" to "authenticated";
grant select on table public."facetime_project_memberships" to "authenticated";
grant update on table public."facetime_project_memberships" to "authenticated";
grant delete on table public."facetime_project_memberships" to "authenticated";
grant truncate on table public."facetime_project_memberships" to "authenticated";
grant references on table public."facetime_project_memberships" to "authenticated";
grant trigger on table public."facetime_project_memberships" to "authenticated";
grant maintain on table public."facetime_project_memberships" to "authenticated";
grant insert on table public."facetime_project_memberships" to "service_role";
grant select on table public."facetime_project_memberships" to "service_role";
grant update on table public."facetime_project_memberships" to "service_role";
grant delete on table public."facetime_project_memberships" to "service_role";
grant truncate on table public."facetime_project_memberships" to "service_role";
grant references on table public."facetime_project_memberships" to "service_role";
grant trigger on table public."facetime_project_memberships" to "service_role";
grant maintain on table public."facetime_project_memberships" to "service_role";
alter table public."facetime_configuration_audit" enable row level security;
revoke all on table public."facetime_configuration_audit" from public,anon,authenticated,service_role;
grant insert on table public."facetime_configuration_audit" to "postgres";
grant select on table public."facetime_configuration_audit" to "postgres";
grant update on table public."facetime_configuration_audit" to "postgres";
grant delete on table public."facetime_configuration_audit" to "postgres";
grant truncate on table public."facetime_configuration_audit" to "postgres";
grant references on table public."facetime_configuration_audit" to "postgres";
grant trigger on table public."facetime_configuration_audit" to "postgres";
grant maintain on table public."facetime_configuration_audit" to "postgres";
grant select on table public."facetime_configuration_audit" to "service_role";
alter table public."facetime_admin_audit" enable row level security;
revoke all on table public."facetime_admin_audit" from public,anon,authenticated,service_role;
grant insert on table public."facetime_admin_audit" to "postgres";
grant select on table public."facetime_admin_audit" to "postgres";
grant update on table public."facetime_admin_audit" to "postgres";
grant delete on table public."facetime_admin_audit" to "postgres";
grant truncate on table public."facetime_admin_audit" to "postgres";
grant references on table public."facetime_admin_audit" to "postgres";
grant trigger on table public."facetime_admin_audit" to "postgres";
grant maintain on table public."facetime_admin_audit" to "postgres";
grant insert on table public."facetime_admin_audit" to "service_role";
grant select on table public."facetime_admin_audit" to "service_role";
alter table public."facetime_workers" enable row level security;
revoke all on table public."facetime_workers" from public,anon,authenticated,service_role;
grant insert on table public."facetime_workers" to "postgres";
grant select on table public."facetime_workers" to "postgres";
grant update on table public."facetime_workers" to "postgres";
grant delete on table public."facetime_workers" to "postgres";
grant truncate on table public."facetime_workers" to "postgres";
grant references on table public."facetime_workers" to "postgres";
grant trigger on table public."facetime_workers" to "postgres";
grant maintain on table public."facetime_workers" to "postgres";
grant insert on table public."facetime_workers" to "service_role";
grant select on table public."facetime_workers" to "service_role";
grant update on table public."facetime_workers" to "service_role";
grant delete on table public."facetime_workers" to "service_role";
grant truncate on table public."facetime_workers" to "service_role";
grant references on table public."facetime_workers" to "service_role";
grant trigger on table public."facetime_workers" to "service_role";
grant maintain on table public."facetime_workers" to "service_role";
alter table public."facetime_media_observations" enable row level security;
revoke all on table public."facetime_media_observations" from public,anon,authenticated,service_role;
grant insert on table public."facetime_media_observations" to "postgres";
grant select on table public."facetime_media_observations" to "postgres";
grant update on table public."facetime_media_observations" to "postgres";
grant delete on table public."facetime_media_observations" to "postgres";
grant truncate on table public."facetime_media_observations" to "postgres";
grant references on table public."facetime_media_observations" to "postgres";
grant trigger on table public."facetime_media_observations" to "postgres";
grant maintain on table public."facetime_media_observations" to "postgres";
grant insert on table public."facetime_media_observations" to "service_role";
grant select on table public."facetime_media_observations" to "service_role";
alter table public."facetime_worker_onboarding_requests" enable row level security;
revoke all on table public."facetime_worker_onboarding_requests" from public,anon,authenticated,service_role;
grant insert on table public."facetime_worker_onboarding_requests" to "postgres";
grant select on table public."facetime_worker_onboarding_requests" to "postgres";
grant update on table public."facetime_worker_onboarding_requests" to "postgres";
grant delete on table public."facetime_worker_onboarding_requests" to "postgres";
grant truncate on table public."facetime_worker_onboarding_requests" to "postgres";
grant references on table public."facetime_worker_onboarding_requests" to "postgres";
grant trigger on table public."facetime_worker_onboarding_requests" to "postgres";
grant maintain on table public."facetime_worker_onboarding_requests" to "postgres";
grant insert on table public."facetime_worker_onboarding_requests" to "service_role";
grant select on table public."facetime_worker_onboarding_requests" to "service_role";
grant update on table public."facetime_worker_onboarding_requests" to "service_role";
grant delete on table public."facetime_worker_onboarding_requests" to "service_role";
grant truncate on table public."facetime_worker_onboarding_requests" to "service_role";
grant references on table public."facetime_worker_onboarding_requests" to "service_role";
grant trigger on table public."facetime_worker_onboarding_requests" to "service_role";
grant maintain on table public."facetime_worker_onboarding_requests" to "service_role";
alter table public."facetime_worker_onboarding" enable row level security;
revoke all on table public."facetime_worker_onboarding" from public,anon,authenticated,service_role;
grant insert on table public."facetime_worker_onboarding" to "postgres";
grant select on table public."facetime_worker_onboarding" to "postgres";
grant update on table public."facetime_worker_onboarding" to "postgres";
grant delete on table public."facetime_worker_onboarding" to "postgres";
grant truncate on table public."facetime_worker_onboarding" to "postgres";
grant references on table public."facetime_worker_onboarding" to "postgres";
grant trigger on table public."facetime_worker_onboarding" to "postgres";
grant maintain on table public."facetime_worker_onboarding" to "postgres";
grant insert on table public."facetime_worker_onboarding" to "service_role";
grant select on table public."facetime_worker_onboarding" to "service_role";
grant update on table public."facetime_worker_onboarding" to "service_role";
grant delete on table public."facetime_worker_onboarding" to "service_role";
grant truncate on table public."facetime_worker_onboarding" to "service_role";
grant references on table public."facetime_worker_onboarding" to "service_role";
grant trigger on table public."facetime_worker_onboarding" to "service_role";
grant maintain on table public."facetime_worker_onboarding" to "service_role";
alter table public."facetime_membership_audit" enable row level security;
revoke all on table public."facetime_membership_audit" from public,anon,authenticated,service_role;
grant insert on table public."facetime_membership_audit" to "postgres";
grant select on table public."facetime_membership_audit" to "postgres";
grant update on table public."facetime_membership_audit" to "postgres";
grant delete on table public."facetime_membership_audit" to "postgres";
grant truncate on table public."facetime_membership_audit" to "postgres";
grant references on table public."facetime_membership_audit" to "postgres";
grant trigger on table public."facetime_membership_audit" to "postgres";
grant maintain on table public."facetime_membership_audit" to "postgres";
grant insert on table public."facetime_membership_audit" to "service_role";
grant select on table public."facetime_membership_audit" to "service_role";
alter table public."facetime_audit_requests" enable row level security;
revoke all on table public."facetime_audit_requests" from public,anon,authenticated,service_role;
grant insert on table public."facetime_audit_requests" to "postgres";
grant select on table public."facetime_audit_requests" to "postgres";
grant update on table public."facetime_audit_requests" to "postgres";
grant delete on table public."facetime_audit_requests" to "postgres";
grant truncate on table public."facetime_audit_requests" to "postgres";
grant references on table public."facetime_audit_requests" to "postgres";
grant trigger on table public."facetime_audit_requests" to "postgres";
grant maintain on table public."facetime_audit_requests" to "postgres";
grant insert on table public."facetime_audit_requests" to "service_role";
grant select on table public."facetime_audit_requests" to "service_role";
grant update on table public."facetime_audit_requests" to "service_role";
grant delete on table public."facetime_audit_requests" to "service_role";
grant truncate on table public."facetime_audit_requests" to "service_role";
grant references on table public."facetime_audit_requests" to "service_role";
grant trigger on table public."facetime_audit_requests" to "service_role";
grant maintain on table public."facetime_audit_requests" to "service_role";
alter table public."facetime_audit_runners" enable row level security;
revoke all on table public."facetime_audit_runners" from public,anon,authenticated,service_role;
grant insert on table public."facetime_audit_runners" to "postgres";
grant select on table public."facetime_audit_runners" to "postgres";
grant update on table public."facetime_audit_runners" to "postgres";
grant delete on table public."facetime_audit_runners" to "postgres";
grant truncate on table public."facetime_audit_runners" to "postgres";
grant references on table public."facetime_audit_runners" to "postgres";
grant trigger on table public."facetime_audit_runners" to "postgres";
grant maintain on table public."facetime_audit_runners" to "postgres";
grant insert on table public."facetime_audit_runners" to "service_role";
grant select on table public."facetime_audit_runners" to "service_role";
grant update on table public."facetime_audit_runners" to "service_role";
grant delete on table public."facetime_audit_runners" to "service_role";
grant truncate on table public."facetime_audit_runners" to "service_role";
grant references on table public."facetime_audit_runners" to "service_role";
grant trigger on table public."facetime_audit_runners" to "service_role";
grant maintain on table public."facetime_audit_runners" to "service_role";
alter table public."facetime_audit_runs" enable row level security;
revoke all on table public."facetime_audit_runs" from public,anon,authenticated,service_role;
grant insert on table public."facetime_audit_runs" to "postgres";
grant select on table public."facetime_audit_runs" to "postgres";
grant update on table public."facetime_audit_runs" to "postgres";
grant delete on table public."facetime_audit_runs" to "postgres";
grant truncate on table public."facetime_audit_runs" to "postgres";
grant references on table public."facetime_audit_runs" to "postgres";
grant trigger on table public."facetime_audit_runs" to "postgres";
grant maintain on table public."facetime_audit_runs" to "postgres";
grant insert on table public."facetime_audit_runs" to "service_role";
grant select on table public."facetime_audit_runs" to "service_role";
grant update on table public."facetime_audit_runs" to "service_role";
grant delete on table public."facetime_audit_runs" to "service_role";
grant truncate on table public."facetime_audit_runs" to "service_role";
grant references on table public."facetime_audit_runs" to "service_role";
grant trigger on table public."facetime_audit_runs" to "service_role";
grant maintain on table public."facetime_audit_runs" to "service_role";
alter table public."facetime_audit_notifications" enable row level security;
revoke all on table public."facetime_audit_notifications" from public,anon,authenticated,service_role;
grant insert on table public."facetime_audit_notifications" to "postgres";
grant select on table public."facetime_audit_notifications" to "postgres";
grant update on table public."facetime_audit_notifications" to "postgres";
grant delete on table public."facetime_audit_notifications" to "postgres";
grant truncate on table public."facetime_audit_notifications" to "postgres";
grant references on table public."facetime_audit_notifications" to "postgres";
grant trigger on table public."facetime_audit_notifications" to "postgres";
grant maintain on table public."facetime_audit_notifications" to "postgres";
grant insert on table public."facetime_audit_notifications" to "service_role";
grant select on table public."facetime_audit_notifications" to "service_role";
grant update on table public."facetime_audit_notifications" to "service_role";
grant delete on table public."facetime_audit_notifications" to "service_role";
grant truncate on table public."facetime_audit_notifications" to "service_role";
grant references on table public."facetime_audit_notifications" to "service_role";
grant trigger on table public."facetime_audit_notifications" to "service_role";
grant maintain on table public."facetime_audit_notifications" to "service_role";
revoke all on function public."facetime_guard_onboarded_worker"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_guard_onboarded_worker"() to "postgres";
grant execute on function public."facetime_guard_onboarded_worker"() to "service_role";
revoke all on function public."facetime_guard_onboarded_line"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_guard_onboarded_line"() to "postgres";
grant execute on function public."facetime_guard_onboarded_line"() to "service_role";
revoke all on function public."facetime_onboard_worker"(p_project_id uuid, p_actor_id uuid, p_request_id uuid, p_input jsonb, p_token_hash text, p_token_prefix text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_onboard_worker"(p_project_id uuid, p_actor_id uuid, p_request_id uuid, p_input jsonb, p_token_hash text, p_token_prefix text) to "postgres";
grant execute on function public."facetime_onboard_worker"(p_project_id uuid, p_actor_id uuid, p_request_id uuid, p_input jsonb, p_token_hash text, p_token_prefix text) to "service_role";
revoke all on function public."facetime_enqueue_session_stop"(p_session facetime_sessions) from public,anon,authenticated,service_role;
grant execute on function public."facetime_enqueue_session_stop"(p_session facetime_sessions) to "postgres";
grant execute on function public."facetime_enqueue_session_stop"(p_session facetime_sessions) to "service_role";
revoke all on function public."facetime_annotate_development_audio_test"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_annotate_development_audio_test"() to public;
grant execute on function public."facetime_annotate_development_audio_test"() to "postgres";
grant execute on function public."facetime_annotate_development_audio_test"() to "anon";
grant execute on function public."facetime_annotate_development_audio_test"() to "authenticated";
grant execute on function public."facetime_annotate_development_audio_test"() to "service_role";
revoke all on function public."facetime_ingest_worker_event"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_event_type text, p_payload jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_ingest_worker_event"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_event_type text, p_payload jsonb) to "postgres";
grant execute on function public."facetime_ingest_worker_event"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_event_type text, p_payload jsonb) to "service_role";
revoke all on function public."facetime_touch_updated_at"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_touch_updated_at"() to public;
grant execute on function public."facetime_touch_updated_at"() to "postgres";
grant execute on function public."facetime_touch_updated_at"() to "anon";
grant execute on function public."facetime_touch_updated_at"() to "authenticated";
grant execute on function public."facetime_touch_updated_at"() to "service_role";
revoke all on function public."facetime_reject_mutation"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_reject_mutation"() to public;
grant execute on function public."facetime_reject_mutation"() to "postgres";
grant execute on function public."facetime_reject_mutation"() to "anon";
grant execute on function public."facetime_reject_mutation"() to "authenticated";
grant execute on function public."facetime_reject_mutation"() to "service_role";
revoke all on function public."facetime_protect_terminal_call"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_protect_terminal_call"() to public;
grant execute on function public."facetime_protect_terminal_call"() to "postgres";
grant execute on function public."facetime_protect_terminal_call"() to "anon";
grant execute on function public."facetime_protect_terminal_call"() to "authenticated";
grant execute on function public."facetime_protect_terminal_call"() to "service_role";
revoke all on function public."facetime_validate_project_links"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_validate_project_links"() to public;
grant execute on function public."facetime_validate_project_links"() to "postgres";
grant execute on function public."facetime_validate_project_links"() to "anon";
grant execute on function public."facetime_validate_project_links"() to "authenticated";
grant execute on function public."facetime_validate_project_links"() to "service_role";
revoke all on function public."facetime_is_project_member"(p_project_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_is_project_member"(p_project_id uuid) to "postgres";
grant execute on function public."facetime_is_project_member"(p_project_id uuid) to "anon";
grant execute on function public."facetime_is_project_member"(p_project_id uuid) to "authenticated";
grant execute on function public."facetime_is_project_member"(p_project_id uuid) to "service_role";
revoke all on function public."facetime_publish_assistant"(p_assistant_id uuid, p_actor uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_publish_assistant"(p_assistant_id uuid, p_actor uuid) to "postgres";
grant execute on function public."facetime_publish_assistant"(p_assistant_id uuid, p_actor uuid) to "service_role";
revoke all on function public."facetime_bootstrap_first_project"(p_slug text, p_name text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_bootstrap_first_project"(p_slug text, p_name text) to "postgres";
grant execute on function public."facetime_bootstrap_first_project"(p_slug text, p_name text) to "authenticated";
grant execute on function public."facetime_bootstrap_first_project"(p_slug text, p_name text) to "service_role";
revoke all on function public."facetime_cleanup_test_project"(p_project_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_cleanup_test_project"(p_project_id uuid) to "postgres";
grant execute on function public."facetime_cleanup_test_project"(p_project_id uuid) to "service_role";
revoke all on function public."facetime_prepare_call_event_insert"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_prepare_call_event_insert"() to "postgres";
grant execute on function public."facetime_prepare_call_event_insert"() to "service_role";
revoke all on function public."facetime_validate_session_linkage"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_validate_session_linkage"() to "postgres";
grant execute on function public."facetime_validate_session_linkage"() to "service_role";
revoke all on function public."facetime_complete_worker_command"(p_worker_id uuid, p_command_id uuid, p_lease_token_hash text, p_succeeded boolean, p_result jsonb, p_error_code text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_complete_worker_command"(p_worker_id uuid, p_command_id uuid, p_lease_token_hash text, p_succeeded boolean, p_result jsonb, p_error_code text) to "postgres";
grant execute on function public."facetime_complete_worker_command"(p_worker_id uuid, p_command_id uuid, p_lease_token_hash text, p_succeeded boolean, p_result jsonb, p_error_code text) to "service_role";
revoke all on function public."facetime_create_outbound_call"(p_project_id uuid, p_mode facetime_call_mode, p_media jsonb, p_assistant_id uuid, p_requested_line_id uuid, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_authorized_test_call boolean, p_idempotency_key text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_outbound_call"(p_project_id uuid, p_mode facetime_call_mode, p_media jsonb, p_assistant_id uuid, p_requested_line_id uuid, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_authorized_test_call boolean, p_idempotency_key text) to "postgres";
grant execute on function public."facetime_create_outbound_call"(p_project_id uuid, p_mode facetime_call_mode, p_media jsonb, p_assistant_id uuid, p_requested_line_id uuid, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_authorized_test_call boolean, p_idempotency_key text) to "service_role";
revoke all on function public."facetime_arm_development_window"(p_project_id uuid, p_worker_id uuid, p_line_id uuid, p_purpose text, p_created_by uuid, p_duration_seconds integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_arm_development_window"(p_project_id uuid, p_worker_id uuid, p_line_id uuid, p_purpose text, p_created_by uuid, p_duration_seconds integer) to "postgres";
grant execute on function public."facetime_arm_development_window"(p_project_id uuid, p_worker_id uuid, p_line_id uuid, p_purpose text, p_created_by uuid, p_duration_seconds integer) to "service_role";
revoke all on function public."facetime_prevent_crm_project_remap"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_prevent_crm_project_remap"() to public;
grant execute on function public."facetime_prevent_crm_project_remap"() to "postgres";
grant execute on function public."facetime_prevent_crm_project_remap"() to "anon";
grant execute on function public."facetime_prevent_crm_project_remap"() to "authenticated";
grant execute on function public."facetime_prevent_crm_project_remap"() to "service_role";
revoke all on function public."facetime_enroll_worker"(p_worker_id uuid, p_enrollment_token_hash text, p_credential_prefix text, p_credential_hash text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_enroll_worker"(p_worker_id uuid, p_enrollment_token_hash text, p_credential_prefix text, p_credential_hash text) to "postgres";
grant execute on function public."facetime_enroll_worker"(p_worker_id uuid, p_enrollment_token_hash text, p_credential_prefix text, p_credential_hash text) to "service_role";
revoke all on function public."facetime_link_crm_project"(p_facetime_project_id uuid, p_crm_project_id uuid, p_name_snapshot text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_link_crm_project"(p_facetime_project_id uuid, p_crm_project_id uuid, p_name_snapshot text) to "postgres";
grant execute on function public."facetime_link_crm_project"(p_facetime_project_id uuid, p_crm_project_id uuid, p_name_snapshot text) to "service_role";
revoke all on function public."facetime_ingest_call_transcript"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_schema_version integer, p_turns jsonb, p_content_hash text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_ingest_call_transcript"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_schema_version integer, p_turns jsonb, p_content_hash text) to "postgres";
grant execute on function public."facetime_ingest_call_transcript"(p_worker_id uuid, p_call_id uuid, p_source_event_id text, p_schema_version integer, p_turns jsonb, p_content_hash text) to "service_role";
revoke all on function public."facetime_create_session"(p_project_id uuid, p_call_id uuid, p_kind facetime_session_kind, p_room_reference text, p_expected_participant_identity text, p_expires_at timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_session"(p_project_id uuid, p_call_id uuid, p_kind facetime_session_kind, p_room_reference text, p_expected_participant_identity text, p_expires_at timestamp with time zone) to "postgres";
grant execute on function public."facetime_create_session"(p_project_id uuid, p_call_id uuid, p_kind facetime_session_kind, p_room_reference text, p_expected_participant_identity text, p_expires_at timestamp with time zone) to "service_role";
revoke all on function public."facetime_transition_session"(p_project_id uuid, p_session_id uuid, p_state facetime_session_state, p_at timestamp with time zone, p_terminal_reason text, p_terminal_reason_detail text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_transition_session"(p_project_id uuid, p_session_id uuid, p_state facetime_session_state, p_at timestamp with time zone, p_terminal_reason text, p_terminal_reason_detail text) to "postgres";
grant execute on function public."facetime_transition_session"(p_project_id uuid, p_session_id uuid, p_state facetime_session_state, p_at timestamp with time zone, p_terminal_reason text, p_terminal_reason_detail text) to "service_role";
revoke all on function public."facetime_expire_session"(p_project_id uuid, p_session_id uuid, p_at timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public."facetime_expire_session"(p_project_id uuid, p_session_id uuid, p_at timestamp with time zone) to "postgres";
grant execute on function public."facetime_expire_session"(p_project_id uuid, p_session_id uuid, p_at timestamp with time zone) to "service_role";
revoke all on function public."facetime_sweep_expired_sessions"(p_project_id uuid, p_at timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public."facetime_sweep_expired_sessions"(p_project_id uuid, p_at timestamp with time zone) to "postgres";
grant execute on function public."facetime_sweep_expired_sessions"(p_project_id uuid, p_at timestamp with time zone) to "service_role";
revoke all on function public."facetime_claim_worker_command"(p_worker_id uuid, p_lease_owner text, p_lease_token_hash text, p_lease_seconds integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_claim_worker_command"(p_worker_id uuid, p_lease_owner text, p_lease_token_hash text, p_lease_seconds integer) to "postgres";
grant execute on function public."facetime_claim_worker_command"(p_worker_id uuid, p_lease_owner text, p_lease_token_hash text, p_lease_seconds integer) to "service_role";
revoke all on function public."facetime_enqueue_call_webhook"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_enqueue_call_webhook"() to "postgres";
grant execute on function public."facetime_enqueue_call_webhook"() to "service_role";
revoke all on function public."facetime_lease_webhook_events"(p_now timestamp with time zone, p_lease_owner text, p_lease_seconds integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_lease_webhook_events"(p_now timestamp with time zone, p_lease_owner text, p_lease_seconds integer) to "postgres";
grant execute on function public."facetime_lease_webhook_events"(p_now timestamp with time zone, p_lease_owner text, p_lease_seconds integer) to "service_role";
revoke all on function public."facetime_stamp_webhook_ingestion_time"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_stamp_webhook_ingestion_time"() to "postgres";
grant execute on function public."facetime_stamp_webhook_ingestion_time"() to "service_role";
revoke all on function public."facetime_register_inbound_call_b3"(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_register_inbound_call_b3"(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) to "postgres";
revoke all on function public."facetime_tombstone_session_credentials"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_tombstone_session_credentials"() to "postgres";
grant execute on function public."facetime_tombstone_session_credentials"() to "service_role";
revoke all on function public."facetime_redeem_session_credentials"(p_project_id uuid, p_worker_id uuid, p_session_id uuid, p_command_id uuid, p_lease_token_hash text, p_now timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public."facetime_redeem_session_credentials"(p_project_id uuid, p_worker_id uuid, p_session_id uuid, p_command_id uuid, p_lease_token_hash text, p_now timestamp with time zone) to "postgres";
grant execute on function public."facetime_redeem_session_credentials"(p_project_id uuid, p_worker_id uuid, p_session_id uuid, p_command_id uuid, p_lease_token_hash text, p_now timestamp with time zone) to "service_role";
revoke all on function public."facetime_create_project_for_user"(p_user_id uuid, p_name text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_project_for_user"(p_user_id uuid, p_name text) to "postgres";
grant execute on function public."facetime_create_project_for_user"(p_user_id uuid, p_name text) to "service_role";
revoke all on function public."facetime_apply_call_event_to_session"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_apply_call_event_to_session"() to "postgres";
grant execute on function public."facetime_apply_call_event_to_session"() to "service_role";
revoke all on function public."facetime_record_blocked_delivery"(p_project_id uuid, p_call_id uuid, p_transition text, p_reason text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_record_blocked_delivery"(p_project_id uuid, p_call_id uuid, p_transition text, p_reason text) to "postgres";
revoke all on function public."facetime_commit_incoming_webhook_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_action text, p_reason text, p_expected_participant_identity text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_commit_incoming_webhook_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_action text, p_reason text, p_expected_participant_identity text) to "postgres";
grant execute on function public."facetime_commit_incoming_webhook_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_action text, p_reason text, p_expected_participant_identity text) to "service_role";
revoke all on function public."facetime_pinned_incoming_context"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_source_event_id text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_pinned_incoming_context"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_source_event_id text) to "postgres";
grant execute on function public."facetime_pinned_incoming_context"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_source_event_id text) to "service_role";
revoke all on function public."facetime_reconcile_failed_start_bridge"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_session_id uuid, p_command_id uuid, p_terminal_reason_detail text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_reconcile_failed_start_bridge"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_session_id uuid, p_command_id uuid, p_terminal_reason_detail text) to "postgres";
grant execute on function public."facetime_reconcile_failed_start_bridge"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_session_id uuid, p_command_id uuid, p_terminal_reason_detail text) to "service_role";
revoke all on function public."facetime_reconcile_expired_worker_commands"(p_worker_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_reconcile_expired_worker_commands"(p_worker_id uuid) to "postgres";
grant execute on function public."facetime_reconcile_expired_worker_commands"(p_worker_id uuid) to "service_role";
revoke all on function public."facetime_integration_secret_guard"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_integration_secret_guard"() to "postgres";
revoke all on function public."facetime_line_assignment_guard"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_line_assignment_guard"() to "postgres";
revoke all on function public."facetime_guard_incoming_accept"(p_project_id uuid, p_call_id uuid, p_source_event_id text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_guard_incoming_accept"(p_project_id uuid, p_call_id uuid, p_source_event_id text) to "postgres";
revoke all on function public."facetime_commit_incoming_byor_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_session_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_commit_incoming_byor_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_session_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) to "postgres";
grant execute on function public."facetime_commit_incoming_byor_decision"(p_project_id uuid, p_call_id uuid, p_source_event_id text, p_session_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) to "service_role";
revoke all on function public."facetime_manage_integration"(p_project_id uuid, p_integration_id uuid, p_action text, p_input jsonb, p_ciphertext text, p_key_version integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_manage_integration"(p_project_id uuid, p_integration_id uuid, p_action text, p_input jsonb, p_ciphertext text, p_key_version integer) to "postgres";
grant execute on function public."facetime_manage_integration"(p_project_id uuid, p_integration_id uuid, p_action text, p_input jsonb, p_ciphertext text, p_key_version integer) to "service_role";
revoke all on function public."facetime_project_hosts_changed"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_project_hosts_changed"() to "postgres";
revoke all on function public."facetime_authorize_webhook_send"(p_project_id uuid, p_event_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_authorize_webhook_send"(p_project_id uuid, p_event_id uuid) to "postgres";
grant execute on function public."facetime_authorize_webhook_send"(p_project_id uuid, p_event_id uuid) to "service_role";
revoke all on function public."facetime_create_outbound_byor_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_outbound_byor_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) to "postgres";
revoke all on function public."facetime_protect_webhook_snapshot"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_protect_webhook_snapshot"() to "postgres";
revoke all on function public."facetime_validate_active_revision"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_validate_active_revision"() to "postgres";
revoke all on function public."facetime_register_inbound_call_pinned"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_register_inbound_call_pinned"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) to "postgres";
grant execute on function public."facetime_register_inbound_call_pinned"(p_project_id uuid, p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) to "service_role";
revoke all on function public."facetime_set_project_hosts"(p_project_id uuid, p_hosts text[]) from public,anon,authenticated,service_role;
grant execute on function public."facetime_set_project_hosts"(p_project_id uuid, p_hosts text[]) to "postgres";
grant execute on function public."facetime_set_project_hosts"(p_project_id uuid, p_hosts text[]) to "service_role";
revoke all on function public."facetime_register_inbound_call"(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_register_inbound_call"(p_worker_id uuid, p_call_id uuid, p_line_id uuid, p_source_event_id text, p_masked_identity text, p_media jsonb, p_payload jsonb) to "postgres";
revoke all on function public."facetime_worker_automatic_ready"(p_worker facetime_workers, p_now timestamp with time zone, p_require_video boolean) from public,anon,authenticated,service_role;
grant execute on function public."facetime_worker_automatic_ready"(p_worker facetime_workers, p_now timestamp with time zone, p_require_video boolean) to "postgres";
grant execute on function public."facetime_worker_automatic_ready"(p_worker facetime_workers, p_now timestamp with time zone, p_require_video boolean) to "service_role";
revoke all on function public."facetime_record_worker_heartbeat"(p_worker_id uuid, p_status facetime_worker_status, p_readiness jsonb, p_software_version text, p_capabilities jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_record_worker_heartbeat"(p_worker_id uuid, p_status facetime_worker_status, p_readiness jsonb, p_software_version text, p_capabilities jsonb) to "postgres";
grant execute on function public."facetime_record_worker_heartbeat"(p_worker_id uuid, p_status facetime_worker_status, p_readiness jsonb, p_software_version text, p_capabilities jsonb) to "service_role";
revoke all on function public."facetime_enqueue_call_action"(p_project_id uuid, p_call_id uuid, p_action text, p_idempotency_key text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_enqueue_call_action"(p_project_id uuid, p_call_id uuid, p_action text, p_idempotency_key text) to "postgres";
grant execute on function public."facetime_enqueue_call_action"(p_project_id uuid, p_call_id uuid, p_action text, p_idempotency_key text) to "service_role";
revoke all on function public."facetime_update_project_identity"(p_actor uuid, p_project uuid, p_name text, p_domain text, p_logo text, p_platform boolean) from public,anon,authenticated,service_role;
grant execute on function public."facetime_update_project_identity"(p_actor uuid, p_project uuid, p_name text, p_domain text, p_logo text, p_platform boolean) to "postgres";
grant execute on function public."facetime_update_project_identity"(p_actor uuid, p_project uuid, p_name text, p_domain text, p_logo text, p_platform boolean) to "service_role";
revoke all on function public."facetime_admin_project_summaries"(p_actor uuid, p_offset integer, p_search text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_admin_project_summaries"(p_actor uuid, p_offset integer, p_search text) to "postgres";
grant execute on function public."facetime_admin_project_summaries"(p_actor uuid, p_offset integer, p_search text) to "service_role";
revoke all on function public."facetime_media_observation_guard"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_media_observation_guard"() to "postgres";
grant execute on function public."facetime_media_observation_guard"() to "service_role";
revoke all on function public."facetime_dashboard_media_observations"(p_project_id uuid, p_worker_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_dashboard_media_observations"(p_project_id uuid, p_worker_id uuid) to "postgres";
grant execute on function public."facetime_dashboard_media_observations"(p_project_id uuid, p_worker_id uuid) to "service_role";
revoke all on function public."facetime_publish_integration_revision"(p_integration_id uuid) from public,anon,authenticated,service_role;
grant execute on function public."facetime_publish_integration_revision"(p_integration_id uuid) to "postgres";
revoke all on function public."facetime_audit_integration_configuration"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_integration_configuration"() to "postgres";
revoke all on function public."facetime_pin_call_integration"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_pin_call_integration"() to "postgres";
revoke all on function public."facetime_pin_video_framing"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_pin_video_framing"() to "postgres";
revoke all on function public."facetime_admin_users"(p_actor uuid, p_offset integer, p_search text, p_exact boolean) from public,anon,authenticated,service_role;
grant execute on function public."facetime_admin_users"(p_actor uuid, p_offset integer, p_search text, p_exact boolean) to "postgres";
grant execute on function public."facetime_admin_users"(p_actor uuid, p_offset integer, p_search text, p_exact boolean) to "service_role";
revoke all on function public."facetime_admin_set_membership"(p_actor uuid, p_project uuid, p_user uuid, p_role text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_admin_set_membership"(p_actor uuid, p_project uuid, p_user uuid, p_role text) to "postgres";
grant execute on function public."facetime_admin_set_membership"(p_actor uuid, p_project uuid, p_user uuid, p_role text) to "service_role";
revoke all on function public."facetime_audit_operation"(p_worker uuid, p_project uuid, p_action text, p_input jsonb) from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_operation"(p_worker uuid, p_project uuid, p_action text, p_input jsonb) to "postgres";
grant execute on function public."facetime_audit_operation"(p_worker uuid, p_project uuid, p_action text, p_input jsonb) to "service_role";
revoke all on function public."facetime_audit_next_due"(p_now timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_next_due"(p_now timestamp with time zone) to "postgres";
grant execute on function public."facetime_audit_next_due"(p_now timestamp with time zone) to "service_role";
revoke all on function public."facetime_audit_monitor"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_monitor"() to "postgres";
grant execute on function public."facetime_audit_monitor"() to "service_role";
revoke all on function public."facetime_audit_claim_notifications"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_claim_notifications"() to "postgres";
grant execute on function public."facetime_audit_claim_notifications"() to "service_role";
revoke all on function public."facetime_audit_immutable_report"() from public,anon,authenticated,service_role;
grant execute on function public."facetime_audit_immutable_report"() to "postgres";
grant execute on function public."facetime_audit_immutable_report"() to "service_role";
revoke all on function public."facetime_create_outbound_audio_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_outbound_audio_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) to "postgres";
grant execute on function public."facetime_create_outbound_audio_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) to "service_role";
revoke all on function public."facetime_create_outbound_byor_call_pinned"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[]) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_outbound_byor_call_pinned"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[]) to "postgres";
revoke all on function public."facetime_create_outbound_video_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_create_outbound_video_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) to "postgres";
grant execute on function public."facetime_create_outbound_video_call"(p_project_id uuid, p_session_id uuid, p_requested_line_id uuid, p_worker_id uuid, p_media jsonb, p_masked_destination text, p_identity_ciphertext text, p_identity_type text, p_identity_key_version integer, p_identity_retention_until timestamp with time zone, p_idempotency_key text, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer, p_validated_hosts text[], p_request_fingerprint text) to "service_role";
revoke all on function public."facetime_insert_sealed_session"(p_project_id uuid, p_call_id uuid, p_session_id uuid, p_worker_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) from public,anon,authenticated,service_role;
grant execute on function public."facetime_insert_sealed_session"(p_project_id uuid, p_call_id uuid, p_session_id uuid, p_worker_id uuid, p_room_reference text, p_expected_participant_identity text, p_token_expires_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_livekit_url_ciphertext text, p_participant_token_ciphertext text, p_token_fingerprint text, p_encryption_key_version integer) to "postgres";
revoke all on function public."facetime_renew_outbound_lease"(p_project_id uuid, p_worker_id uuid, p_command_id uuid, p_lease_token_hash text) from public,anon,authenticated,service_role;
grant execute on function public."facetime_renew_outbound_lease"(p_project_id uuid, p_worker_id uuid, p_command_id uuid, p_lease_token_hash text) to "postgres";
grant execute on function public."facetime_renew_outbound_lease"(p_project_id uuid, p_worker_id uuid, p_command_id uuid, p_lease_token_hash text) to "service_role";
grant usage on schema public to anon,authenticated,service_role;
