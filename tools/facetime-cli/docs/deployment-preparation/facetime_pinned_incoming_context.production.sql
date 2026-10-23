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
