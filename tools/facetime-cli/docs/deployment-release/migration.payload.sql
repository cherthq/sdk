-- Single transaction via approved migration transport. NOT a db-push/history replay.
-- Fresh column/history guards plus original shared function guards; no row repair.
do $catalog$ begin
if to_regclass('supabase_migrations.schema_migrations') is null then raise exception 'missing_migration_history'; end if;
if (select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations) is distinct from '[{"name":"0006_development_audio_authorization","version":"20260819205731"},{"name":"0007_secure_call_transcripts","version":"20260820145658"},{"name":"0008_b1_call_event_contract","version":"20260826044026"},{"name":"0009_b1_event_ingestion_metadata","version":"20260826050138"},{"name":"b2_session_lifecycle","version":"20260826115036"},{"name":"b3_webhook_core","version":"20260826124951"},{"name":"b3_webhook_core_append_only_fix","version":"20260826125312"},{"name":"b3_webhook_core_registration_context","version":"20260826125628"},{"name":"b3_webhook_core_registration_ownership","version":"20260826125721"},{"name":"b3_webhook_core_wall_clock_created_at","version":"20260826130029"},{"name":"b3_webhook_core_bounded_ingestion_time","version":"20260826130246"},{"name":"b3_webhook_core_foreign_key_indexes","version":"20260826130922"},{"name":"b3_webhook_core_endpoint_index","version":"20260826130934"},{"name":"b4_sealed_credentials","version":"20260827024119"},{"name":"additional_project_creation","version":"20260827142611"},{"name":"project_livekit_allowed_hosts","version":"20260827142730"},{"name":"0014_bw_session_lifecycle_amendment","version":"20260827183854"},{"name":"heartbeat_rejection_evidence","version":"20260827185247"},{"name":"incoming_webhook_decline_cleanup","version":"20260904024011"},{"name":"start_bridge_failure_reconciliation","version":"20260904230436"},{"name":"call_webhook_logical_idempotency","version":"20260905000847"},{"name":"reconcile_expired_start_bridge_commands","version":"20260906023207"},{"name":"line_integrations","version":"20260911131327"},{"name":"line_integration_service_grants","version":"20260911140856"},{"name":"line_integrations_release_transport","version":"20260911151650"},{"name":"automatic_worker_readiness","version":"20260911213624"},{"name":"dashboard_console","version":"20260911233536"},{"name":"automatic_worker_readiness_release_transport","version":"20260912002808"},{"name":"dashboard_console_release_transport","version":"20260912013442"},{"name":"dashboard_media_observations","version":"20260912131914"},{"name":"dashboard_recovery_qualification","version":"20260912142000"},{"name":"readiness_dashboard_release_transport","version":"20260912144429"},{"name":"guarded_worker_onboarding","version":"20260913044930"},{"name":"guarded_worker_onboarding_release_transport","version":"20260913124823"},{"name":"optional_webhook_signing","version":"20260915191852"},{"name":"line_video_framing","version":"20260916002957"},{"name":"project_user_management","version":"20260920010713"},{"name":"device_agent_audits","version":"20260921142141"},{"name":"outbound_byor_audio_compatible_release","version":"20260923192701"},{"name":"outbound_byor_video","version":"20260924200520"}]'::jsonb then raise exception 'migration_history_drift'; end if;
if (select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'nullable',case when a.attnotnull then 'NO' else 'YES' end,'default',pg_get_expr(d.adbin,d.adrelid)) order by c.relname,a.attnum) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r') is distinct from '[{"type":"uuid","table":"facetime_admin_audit","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_admin_audit","column":"actor_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_admin_audit","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_admin_audit","column":"action","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_admin_audit","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_api_keys","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_api_keys","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_api_keys","column":"name","default":null,"nullable":"NO"},{"type":"text","table":"facetime_api_keys","column":"key_prefix","default":null,"nullable":"NO"},{"type":"text","table":"facetime_api_keys","column":"key_hash","default":null,"nullable":"NO"},{"type":"text[]","table":"facetime_api_keys","column":"scopes","default":"ARRAY[''facetime:read''::text]","nullable":"NO"},{"type":"uuid","table":"facetime_api_keys","column":"created_by","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_api_keys","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_api_keys","column":"last_used_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_api_keys","column":"revoked_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_api_keys","column":"expires_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_audit_notifications","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_audit_notifications","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_notifications","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_notifications","column":"run_id","default":null,"nullable":"YES"},{"type":"text","table":"facetime_audit_notifications","column":"device_label","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_notifications","column":"kind","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_notifications","column":"fingerprint","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_notifications","column":"created_at","default":"now()","nullable":"NO"},{"type":"integer","table":"facetime_audit_notifications","column":"attempts","default":"0","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_notifications","column":"next_attempt_at","default":"now()","nullable":"NO"},{"type":"text","table":"facetime_audit_notifications","column":"state","default":"''pending''::text","nullable":"NO"},{"type":"text","table":"facetime_audit_notifications","column":"provider_id","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_notifications","column":"accepted_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_audit_requests","column":"id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_requests","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_requests","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_requests","column":"actor_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_requests","column":"run_id","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_requests","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_audit_runners","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_runners","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_runners","column":"credential_hash","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_runners","column":"host","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_runners","column":"approved_release","default":null,"nullable":"NO"},{"type":"boolean","table":"facetime_audit_runners","column":"enabled","default":"true","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"registered_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"last_seen_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"next_due_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"last_scheduled_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"last_claimed_slot","default":null,"nullable":"YES"},{"type":"text","table":"facetime_audit_runners","column":"incident","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runners","column":"incident_at","default":null,"nullable":"YES"},{"type":"boolean","table":"facetime_audit_runners","column":"reminder_sent","default":"false","nullable":"NO"},{"type":"uuid","table":"facetime_audit_runs","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_audit_runs","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_runs","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_audit_runs","column":"actor_id","default":null,"nullable":"YES"},{"type":"text","table":"facetime_audit_runs","column":"approved_release","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_runs","column":"trigger","default":null,"nullable":"NO"},{"type":"text","table":"facetime_audit_runs","column":"state","default":"''queued''::text","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"scheduled_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"expires_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"started_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"lease_until","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_audit_runs","column":"claim_token","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"completed_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_audit_runs","column":"received_at","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_audit_runs","column":"result","default":null,"nullable":"YES"},{"type":"text","table":"facetime_audit_runs","column":"verdict","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_call_events","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_call_events","column":"call_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_call_events","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_call_events","column":"event_type","default":null,"nullable":"NO"},{"type":"bigint","table":"facetime_call_events","column":"sequence","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_call_events","column":"payload","default":"''{}''::jsonb","nullable":"NO"},{"type":"facetime_event_source","table":"facetime_call_events","column":"source","default":null,"nullable":"NO"},{"type":"text","table":"facetime_call_events","column":"source_event_id","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_call_events","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_call_events","column":"occurred_at","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_call_events","column":"worker_sequence","default":null,"nullable":"YES"},{"type":"text","table":"facetime_call_events","column":"terminal_reason","default":null,"nullable":"YES"},{"type":"text","table":"facetime_call_events","column":"terminal_reason_detail","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_call_transcripts","column":"call_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_call_transcripts","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_call_transcripts","column":"worker_id","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_call_transcripts","column":"schema_version","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_call_transcripts","column":"turns","default":null,"nullable":"NO"},{"type":"text","table":"facetime_call_transcripts","column":"content_hash","default":null,"nullable":"NO"},{"type":"text","table":"facetime_call_transcripts","column":"source_event_id","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_call_transcripts","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_calls","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_calls","column":"project_id","default":null,"nullable":"NO"},{"type":"facetime_call_direction","table":"facetime_calls","column":"direction","default":null,"nullable":"NO"},{"type":"facetime_call_mode","table":"facetime_calls","column":"mode","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_calls","column":"media","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_calls","column":"assistant_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_calls","column":"assistant_version_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_calls","column":"worker_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_calls","column":"line_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_calls","column":"identity_ciphertext","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"identity_type","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_calls","column":"identity_key_version","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"identity_retention_until","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"masked_identity","default":null,"nullable":"YES"},{"type":"facetime_call_status","table":"facetime_calls","column":"status","default":"''queued''::facetime_call_status","nullable":"NO"},{"type":"jsonb","table":"facetime_calls","column":"media_status","default":"''{}''::jsonb","nullable":"NO"},{"type":"text","table":"facetime_calls","column":"terminal_reason","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"idempotency_key","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"requested_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_calls","column":"detected_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"answered_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"active_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"ended_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_calls","column":"updated_at","default":"now()","nullable":"NO"},{"type":"text","table":"facetime_calls","column":"terminal_reason_detail","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"incoming_webhook_source_event_id","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_calls","column":"incoming_webhook_decision","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_calls","column":"integration_revision_id","default":null,"nullable":"YES"},{"type":"bigint","table":"facetime_calls","column":"integration_assignment_generation","default":null,"nullable":"YES"},{"type":"facetime_inbound_policy","table":"facetime_calls","column":"resolved_inbound_policy","default":null,"nullable":"YES"},{"type":"text[]","table":"facetime_calls","column":"resolved_livekit_allowed_hosts","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"binding_disposition","default":"''legacy_unresolved''::text","nullable":"NO"},{"type":"uuid","table":"facetime_calls","column":"incoming_request_id","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"incoming_request_created_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_calls","column":"incoming_decision_deadline_at","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_calls","column":"incoming_request_data","default":null,"nullable":"YES"},{"type":"text","table":"facetime_calls","column":"video_framing","default":"''fit''::text","nullable":"NO"},{"type":"text","table":"facetime_calls","column":"outbound_request_fingerprint","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_configuration_audit","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_configuration_audit","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_configuration_audit","column":"resource_type","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_configuration_audit","column":"resource_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_configuration_audit","column":"operation","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_configuration_audit","column":"previous_configuration","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_configuration_audit","column":"next_configuration","default":null,"nullable":"YES"},{"type":"text","table":"facetime_configuration_audit","column":"database_actor","default":"SESSION_USER","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_configuration_audit","column":"created_at","default":"clock_timestamp()","nullable":"NO"},{"type":"uuid","table":"facetime_development_windows","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_development_windows","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_development_windows","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_development_windows","column":"line_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_development_windows","column":"purpose","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_development_windows","column":"expires_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_development_windows","column":"consumed_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_development_windows","column":"created_by","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_development_windows","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_integration_revisions","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_integration_revisions","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_integration_revisions","column":"integration_id","default":null,"nullable":"NO"},{"type":"bigint","table":"facetime_integration_revisions","column":"generation","default":null,"nullable":"NO"},{"type":"text","table":"facetime_integration_revisions","column":"endpoint_url","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_integration_revisions","column":"payload_version","default":null,"nullable":"NO"},{"type":"text[]","table":"facetime_integration_revisions","column":"livekit_allowed_hosts","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_integration_revisions","column":"secret_version_id","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_integration_revisions","column":"secret_version","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_integration_revisions","column":"created_at","default":"clock_timestamp()","nullable":"NO"},{"type":"boolean","table":"facetime_integration_revisions","column":"signing_enabled","default":"true","nullable":"NO"},{"type":"uuid","table":"facetime_lines","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_lines","column":"project_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_lines","column":"worker_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_lines","column":"line_key","default":null,"nullable":"NO"},{"type":"text","table":"facetime_lines","column":"display_name","default":null,"nullable":"NO"},{"type":"text","table":"facetime_lines","column":"masked_identity","default":null,"nullable":"NO"},{"type":"text","table":"facetime_lines","column":"identity_ciphertext","default":null,"nullable":"YES"},{"type":"facetime_line_status","table":"facetime_lines","column":"status","default":"''offline''::facetime_line_status","nullable":"NO"},{"type":"uuid","table":"facetime_lines","column":"current_call_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_lines","column":"default_assistant_id","default":null,"nullable":"YES"},{"type":"facetime_inbound_policy","table":"facetime_lines","column":"inbound_policy","default":"''customer_decides''::facetime_inbound_policy","nullable":"NO"},{"type":"boolean","table":"facetime_lines","column":"supports_audio","default":"true","nullable":"NO"},{"type":"boolean","table":"facetime_lines","column":"supports_video","default":"false","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_lines","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_lines","column":"updated_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_lines","column":"integration_id","default":null,"nullable":"YES"},{"type":"bigint","table":"facetime_lines","column":"assignment_generation","default":"0","nullable":"NO"},{"type":"text","table":"facetime_lines","column":"video_framing","default":"''fit''::text","nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"call_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"line_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_media_observations","column":"observer_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_media_observations","column":"capability","default":null,"nullable":"NO"},{"type":"text","table":"facetime_media_observations","column":"kind","default":null,"nullable":"NO"},{"type":"text","table":"facetime_media_observations","column":"outcome","default":null,"nullable":"NO"},{"type":"text","table":"facetime_media_observations","column":"reason","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_media_observations","column":"observed_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_media_observations","column":"received_at","default":"clock_timestamp()","nullable":"NO"},{"type":"text","table":"facetime_media_observations","column":"build","default":null,"nullable":"YES"},{"type":"text","table":"facetime_media_observations","column":"device_binding","default":null,"nullable":"YES"},{"type":"text","table":"facetime_media_observations","column":"config_binding","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_media_observations","column":"runtime_id","default":null,"nullable":"YES"},{"type":"boolean","table":"facetime_media_observations","column":"recovery_qualified","default":"false","nullable":"NO"},{"type":"uuid","table":"facetime_membership_audit","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_membership_audit","column":"actor_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_membership_audit","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_membership_audit","column":"target_user_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_membership_audit","column":"old_role","default":null,"nullable":"YES"},{"type":"text","table":"facetime_membership_audit","column":"new_role","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_membership_audit","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_platform_admins","column":"user_id","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_platform_admins","column":"granted_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_project_memberships","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_project_memberships","column":"user_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_project_memberships","column":"role","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_project_memberships","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_project_settings","column":"project_id","default":null,"nullable":"NO"},{"type":"text[]","table":"facetime_project_settings","column":"livekit_allowed_hosts","default":"''{}''::text[]","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_project_settings","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_project_settings","column":"updated_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_projects","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"text","table":"facetime_projects","column":"slug","default":null,"nullable":"NO"},{"type":"text","table":"facetime_projects","column":"name","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_projects","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_projects","column":"updated_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_projects","column":"crm_project_id","default":null,"nullable":"YES"},{"type":"text","table":"facetime_projects","column":"name_snapshot","default":null,"nullable":"YES"},{"type":"text","table":"facetime_projects","column":"status","default":"''enabled''::text","nullable":"NO"},{"type":"text","table":"facetime_projects","column":"website_domain","default":"''''::text","nullable":"NO"},{"type":"text","table":"facetime_projects","column":"logo_data","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_session_credential_seals","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_session_credential_seals","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_session_credential_seals","column":"session_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_session_credential_seals","column":"worker_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_session_credential_seals","column":"livekit_url_ciphertext","default":null,"nullable":"YES"},{"type":"text","table":"facetime_session_credential_seals","column":"participant_token_ciphertext","default":null,"nullable":"YES"},{"type":"text","table":"facetime_session_credential_seals","column":"token_fingerprint","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_session_credential_seals","column":"encryption_key_version","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_session_credential_seals","column":"token_expires_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_session_credential_seals","column":"lease_expires_at","default":null,"nullable":"NO"},{"type":"text","table":"facetime_session_credential_seals","column":"state","default":"''sealed''::text","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_session_credential_seals","column":"consumed_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_session_credential_seals","column":"deleted_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_session_credential_seals","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_sessions","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_sessions","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_sessions","column":"call_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_sessions","column":"line_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_sessions","column":"worker_id","default":null,"nullable":"NO"},{"type":"facetime_session_kind","table":"facetime_sessions","column":"kind","default":null,"nullable":"NO"},{"type":"facetime_session_state","table":"facetime_sessions","column":"state","default":"''created''::facetime_session_state","nullable":"NO"},{"type":"text","table":"facetime_sessions","column":"room_reference","default":null,"nullable":"NO"},{"type":"text","table":"facetime_sessions","column":"expected_participant_identity","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"expires_at","default":null,"nullable":"NO"},{"type":"text","table":"facetime_sessions","column":"terminal_reason","default":null,"nullable":"YES"},{"type":"text","table":"facetime_sessions","column":"terminal_reason_detail","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"updated_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"dispatched_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"active_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"ended_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"expired_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"failed_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_sessions","column":"cleaned_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_webhook_delivery_attempts","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_delivery_attempts","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_delivery_attempts","column":"webhook_event_id","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_webhook_delivery_attempts","column":"attempt_number","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_webhook_delivery_attempts","column":"secret_version","default":null,"nullable":"YES"},{"type":"text","table":"facetime_webhook_delivery_attempts","column":"status","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_webhook_delivery_attempts","column":"status_code","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_webhook_delivery_attempts","column":"latency_ms","default":null,"nullable":"NO"},{"type":"text","table":"facetime_webhook_delivery_attempts","column":"error","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_webhook_delivery_attempts","column":"attempted_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_delivery_attempts","column":"started_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_delivery_attempts","column":"completed_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_delivery_attempts","column":"next_attempt_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_webhook_endpoints","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_endpoints","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_webhook_endpoints","column":"endpoint_url","default":null,"nullable":"NO"},{"type":"boolean","table":"facetime_webhook_endpoints","column":"enabled","default":"true","nullable":"NO"},{"type":"integer","table":"facetime_webhook_endpoints","column":"payload_version","default":"1","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_endpoints","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_endpoints","column":"updated_at","default":"now()","nullable":"NO"},{"type":"text","table":"facetime_webhook_endpoints","column":"name","default":"''Default integration''::text","nullable":"NO"},{"type":"text[]","table":"facetime_webhook_endpoints","column":"livekit_allowed_hosts","default":null,"nullable":"YES"},{"type":"boolean","table":"facetime_webhook_endpoints","column":"legacy_default","default":"true","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_endpoints","column":"active_revision_id","default":null,"nullable":"YES"},{"type":"boolean","table":"facetime_webhook_endpoints","column":"signing_enabled","default":"true","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"event_id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"call_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"source_call_event_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"endpoint_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_webhook_events","column":"endpoint_url","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_events","column":"secret_version_id","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_webhook_events","column":"secret_version","default":null,"nullable":"YES"},{"type":"text","table":"facetime_webhook_events","column":"event_type","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_webhook_events","column":"payload","default":null,"nullable":"NO"},{"type":"text","table":"facetime_webhook_events","column":"raw_body","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_events","column":"created_at","default":"now()","nullable":"NO"},{"type":"facetime_webhook_event_state","table":"facetime_webhook_events","column":"state","default":"''pending''::facetime_webhook_event_state","nullable":"NO"},{"type":"integer","table":"facetime_webhook_events","column":"attempt_count","default":"0","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_events","column":"next_attempt_at","default":"now()","nullable":"NO"},{"type":"text","table":"facetime_webhook_events","column":"lease_owner","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_webhook_events","column":"lease_expires_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_webhook_events","column":"delivered_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_webhook_events","column":"dead_letter_at","default":null,"nullable":"YES"},{"type":"text","table":"facetime_webhook_events","column":"last_error","default":null,"nullable":"YES"},{"type":"text","table":"facetime_webhook_events","column":"logical_transition","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_webhook_secret_versions","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_webhook_secret_versions","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_webhook_secret_versions","column":"endpoint_id","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_webhook_secret_versions","column":"version","default":null,"nullable":"NO"},{"type":"text","table":"facetime_webhook_secret_versions","column":"ciphertext","default":null,"nullable":"NO"},{"type":"integer","table":"facetime_webhook_secret_versions","column":"encryption_key_version","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_secret_versions","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_webhook_secret_versions","column":"revoked_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_webhook_secret_versions","column":"retired_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_commands","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_worker_commands","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_commands","column":"call_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_commands","column":"line_id","default":null,"nullable":"YES"},{"type":"facetime_command_type","table":"facetime_worker_commands","column":"command_type","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_worker_commands","column":"payload","default":"''{}''::jsonb","nullable":"NO"},{"type":"facetime_command_status","table":"facetime_worker_commands","column":"status","default":"''queued''::facetime_command_status","nullable":"NO"},{"type":"text","table":"facetime_worker_commands","column":"idempotency_key","default":null,"nullable":"NO"},{"type":"text","table":"facetime_worker_commands","column":"lease_owner","default":null,"nullable":"YES"},{"type":"text","table":"facetime_worker_commands","column":"lease_token_hash","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_commands","column":"lease_expires_at","default":null,"nullable":"YES"},{"type":"integer","table":"facetime_worker_commands","column":"attempt_count","default":"0","nullable":"NO"},{"type":"integer","table":"facetime_worker_commands","column":"maximum_attempts","default":"3","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_commands","column":"available_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_commands","column":"expires_at","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_worker_commands","column":"result","default":null,"nullable":"YES"},{"type":"text","table":"facetime_worker_commands","column":"error_code","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_commands","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_commands","column":"completed_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_credentials","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_worker_credentials","column":"worker_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_worker_credentials","column":"credential_prefix","default":null,"nullable":"NO"},{"type":"text","table":"facetime_worker_credentials","column":"credential_hash","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_credentials","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_credentials","column":"expires_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_credentials","column":"last_used_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_credentials","column":"revoked_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_credentials","column":"rotated_from_id","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_enrollment_tokens","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"facetime_worker_enrollment_tokens","column":"worker_id","default":null,"nullable":"NO"},{"type":"text","table":"facetime_worker_enrollment_tokens","column":"token_prefix","default":null,"nullable":"NO"},{"type":"text","table":"facetime_worker_enrollment_tokens","column":"token_hash","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_enrollment_tokens","column":"expires_at","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_enrollment_tokens","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_enrollment_tokens","column":"consumed_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_enrollment_tokens","column":"revoked_at","default":null,"nullable":"YES"},{"type":"uuid","table":"facetime_worker_onboarding","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding","column":"line_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding","column":"created_by","default":null,"nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_worker_onboarding","column":"activated_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_onboarding","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding_requests","column":"project_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding_requests","column":"request_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding_requests","column":"actor_id","default":null,"nullable":"NO"},{"type":"jsonb","table":"facetime_worker_onboarding_requests","column":"input","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding_requests","column":"worker_id","default":null,"nullable":"NO"},{"type":"uuid","table":"facetime_worker_onboarding_requests","column":"token_id","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_worker_onboarding_requests","column":"created_at","default":"now()","nullable":"NO"},{"type":"uuid","table":"facetime_workers","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"text","table":"facetime_workers","column":"worker_key","default":null,"nullable":"NO"},{"type":"text","table":"facetime_workers","column":"display_name","default":null,"nullable":"NO"},{"type":"facetime_worker_status","table":"facetime_workers","column":"status","default":"''offline''::facetime_worker_status","nullable":"NO"},{"type":"boolean","table":"facetime_workers","column":"enabled","default":"false","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_workers","column":"last_heartbeat_at","default":null,"nullable":"YES"},{"type":"text","table":"facetime_workers","column":"software_version","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_workers","column":"capabilities","default":"''{}''::jsonb","nullable":"NO"},{"type":"jsonb","table":"facetime_workers","column":"readiness","default":"''{\"audio_ready\": false, \"video_ready\": false, \"control_ready\": false, \"avatar_capable\": false, \"facetime_signed_in\": false, \"accessibility_ready\": false, \"screen_capture_ready\": false, \"production_media_ready\": false}''::jsonb","nullable":"NO"},{"type":"uuid","table":"facetime_workers","column":"current_call_id","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_workers","column":"enrolled_at","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"facetime_workers","column":"updated_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"facetime_workers","column":"last_heartbeat_attempt_at","default":null,"nullable":"YES"},{"type":"jsonb","table":"facetime_workers","column":"last_heartbeat_rejection_reason","default":null,"nullable":"YES"},{"type":"boolean","table":"facetime_workers","column":"automatic_readiness_enabled","default":"false","nullable":"NO"},{"type":"uuid","table":"realtime_assistant_versions","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"realtime_assistant_versions","column":"assistant_id","default":null,"nullable":"NO"},{"type":"uuid","table":"realtime_assistant_versions","column":"project_id","default":null,"nullable":"NO"},{"type":"integer","table":"realtime_assistant_versions","column":"version","default":null,"nullable":"NO"},{"type":"integer","table":"realtime_assistant_versions","column":"schema_version","default":"1","nullable":"NO"},{"type":"jsonb","table":"realtime_assistant_versions","column":"config","default":null,"nullable":"NO"},{"type":"uuid","table":"realtime_assistant_versions","column":"published_by","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"realtime_assistant_versions","column":"published_at","default":"now()","nullable":"NO"},{"type":"text","table":"realtime_assistant_versions","column":"content_hash","default":null,"nullable":"NO"},{"type":"uuid","table":"realtime_assistants","column":"id","default":"gen_random_uuid()","nullable":"NO"},{"type":"uuid","table":"realtime_assistants","column":"project_id","default":null,"nullable":"NO"},{"type":"text","table":"realtime_assistants","column":"name","default":null,"nullable":"NO"},{"type":"text","table":"realtime_assistants","column":"description","default":null,"nullable":"YES"},{"type":"facetime_assistant_status","table":"realtime_assistants","column":"status","default":"''draft''::facetime_assistant_status","nullable":"NO"},{"type":"jsonb","table":"realtime_assistants","column":"draft_config","default":"''{}''::jsonb","nullable":"NO"},{"type":"integer","table":"realtime_assistants","column":"draft_revision","default":"1","nullable":"NO"},{"type":"uuid","table":"realtime_assistants","column":"active_version_id","default":null,"nullable":"YES"},{"type":"uuid","table":"realtime_assistants","column":"created_by","default":null,"nullable":"YES"},{"type":"timestamp with time zone","table":"realtime_assistants","column":"created_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"realtime_assistants","column":"updated_at","default":"now()","nullable":"NO"},{"type":"timestamp with time zone","table":"realtime_assistants","column":"archived_at","default":null,"nullable":"YES"}]'::jsonb then raise exception 'production_column_drift'; end if;
end $catalog$;
-- One reviewed migration payload. No data repair, ledger rewrite, or history replay.
-- Apply via approved transactional migration transport only after release gates.
do $preflight$ begin
if current_setting('server_version_num')::integer/10000<>17 then raise exception 'unexpected_postgres_major'; end if;
if to_regclass('public.facetime_connector_bindings') is not null then raise exception 'connector_already_present_inspect_before_retry'; end if;
if md5(pg_get_functiondef('public.facetime_enqueue_call_webhook()'::regprocedure)) <> '75402284c3b1dd25b1fbf2accc25821e' then raise exception 'deployed_function_drift: facetime_enqueue_call_webhook'; end if;
if md5(pg_get_functiondef('public.facetime_pinned_incoming_context(uuid,uuid,uuid,text)'::regprocedure)) <> '156b49fd3b9443726d21e9ff5c653241' then raise exception 'deployed_function_drift: facetime_pinned_incoming_context'; end if;
if md5(pg_get_functiondef('public.facetime_guard_incoming_accept(uuid,uuid,text)'::regprocedure)) <> '8ca81b9b9422eff9bb9145a01a7833f9' then raise exception 'deployed_function_drift: facetime_guard_incoming_accept'; end if;
if md5(pg_get_functiondef('public.facetime_pin_call_integration()'::regprocedure)) <> '043fab84fc9167ebf1cefc4d671fbf2f' then raise exception 'deployed_function_drift: facetime_pin_call_integration'; end if;
if md5(pg_get_functiondef('public.facetime_apply_call_event_to_session()'::regprocedure)) <> '8b3183b1613bcf9159011ba7c85194f9' then raise exception 'deployed_function_drift: facetime_apply_call_event_to_session'; end if;
end $preflight$;
-- Release candidate: requires the captured 2026-09-30 production baseline.
-- Additive connector authority. No project is enrolled or activated by migration.
create table public.facetime_connector_bindings (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.facetime_projects(id),
 line_id uuid not null references public.facetime_lines(id), instance_id uuid not null default gen_random_uuid(),
 epoch bigint not null default 1, name text not null check(length(name) between 1 and 100),
 environment text not null check(environment in ('production','development')),
 state text not null default 'standby' check(state in ('standby','active','draining','revoked')),
 connection_hash text not null unique check(length(connection_hash)=64), recovery_hash text not null unique check(length(recovery_hash)=64),
 generation bigint not null default 0, lease_until timestamptz, created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id), check(connection_hash<>recovery_hash)
);
create unique index facetime_connector_one_active_project on public.facetime_connector_bindings(project_id) where state='active';
alter table public.facetime_connector_bindings enable row level security;
revoke all on public.facetime_connector_bindings from public,anon,authenticated;
alter table public.facetime_calls add column connector_owner jsonb, add column connector_receipt jsonb,
 add column connector_decision_digest text, add column connector_resource_expires_at bigint;
create table public.facetime_connector_deliveries (
 cursor bigint generated always as identity primary key, event_id uuid not null default gen_random_uuid(),
 binding_id uuid not null references public.facetime_connector_bindings(id), call_id uuid not null references public.facetime_calls(id),
 kind text not null, body jsonb not null, acknowledged_at timestamptz, unique(call_id,kind)
);
alter table public.facetime_connector_deliveries enable row level security;
revoke all on public.facetime_connector_deliveries from public,anon,authenticated;
create function public.facetime_connector_scope(b public.facetime_connector_bindings) returns jsonb
language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_build_object('project_id',b.project_id,'line_id',b.line_id,'binding_id',b.id,'binding_epoch',b.epoch,
 'instance_id',b.instance_id,'connection_generation',b.generation)
$$;
create function public.facetime_connector_manage(p_project_id uuid,p_actor_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.facetime_connector_bindings%rowtype; previous public.facetime_connector_bindings%rowtype;
 l public.facetime_lines%rowtype; result jsonb;
begin
 -- Membership is checked inside the transaction as well as at the HTTP boundary.
 perform 1 from public.facetime_project_memberships where project_id=p_project_id and user_id=p_actor_id and role in ('owner','admin') for share;
 if not found then raise exception 'connector_forbidden' using errcode='42501'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('scope',public.facetime_connector_scope(x),'state',x.state,'name',x.name,
    'environment',x.environment,'connected',coalesce(x.lease_until>clock_timestamp(),false))), '[]'::jsonb)
    into result from public.facetime_connector_bindings x where project_id=p_project_id; return result;
 end if;
 -- Admission selects the project's sole line. Retirement locks the existing
 -- binding's line instead; later project cardinality cannot prevent revocation.
 if p_action in ('drain','revoke') then
  select ln.* into l from public.facetime_lines ln
   join public.facetime_connector_bindings owned on owned.line_id=ln.id
   where owned.id=(p_input->>'binding_id')::uuid and owned.project_id=p_project_id
   for update of ln;
 else
  select * into l from public.facetime_lines where project_id=p_project_id order by id limit 1 for update;
 end if;
 perform 1 from public.facetime_projects where id=p_project_id for update;
 if p_action in ('enroll','activate') and (select count(*) from public.facetime_lines where project_id=p_project_id)<>1 then
  raise exception 'connector_requires_exactly_one_line' using errcode='55000'; end if;
 if p_action='enroll' then
  if l.id is distinct from (p_input->>'line_id')::uuid then raise exception 'connector_line_mismatch' using errcode='42501'; end if;
  insert into public.facetime_connector_bindings(project_id,line_id,name,environment,connection_hash,recovery_hash,created_by)
   values(p_project_id,l.id,p_input->>'name',p_input->>'environment',p_input->>'connection_hash',p_input->>'recovery_hash',p_actor_id) returning * into b;
 else
  select * into b from public.facetime_connector_bindings where id=(p_input->>'binding_id')::uuid and project_id=p_project_id for update;
  if not found then raise exception 'connector_not_found' using errcode='P0002'; end if;
  if p_action='activate' then
   select * into previous from public.facetime_connector_bindings where project_id=p_project_id and state='active' for update;
   if previous.id is distinct from (p_input->>'expected_binding_id')::uuid or l.assignment_generation is distinct from (p_input->>'assignment_generation')::bigint
     or b.state not in ('standby','active') or b.environment<>'production' then
    raise exception 'connector_activation_conflict' using errcode='55000'; end if;
   if l.default_assistant_id is not null or l.inbound_policy<>'customer_decides' then
    raise exception 'connector_route_requires_customer_decides' using errcode='55000'; end if;
   if l.current_call_id is not null and not exists(select 1 from public.facetime_calls where id=l.current_call_id and connector_owner is not null) then
    raise exception 'connector_legacy_call_in_progress' using errcode='55000'; end if;
   update public.facetime_connector_bindings set state='draining' where id=previous.id and id<>b.id;
   update public.facetime_connector_bindings set state='active' where id=b.id returning * into b;
  elsif p_action in ('drain','revoke') then
   -- Revocation is terminal. Draining must never restore the connection hash.
   update public.facetime_connector_bindings set state=case when p_action='revoke' or b.state='revoked' then 'revoked' else 'draining' end,
    lease_until=case when p_action='revoke' then null else lease_until end where id=b.id returning * into b;
  else raise exception 'connector_action_invalid' using errcode='22023'; end if;
 end if;
 insert into public.facetime_configuration_audit(project_id,resource_type,resource_id,operation,next_configuration)
 values(p_project_id,'connector',b.id,p_action,jsonb_build_object('state',b.state,'actor_id',p_actor_id));
 return jsonb_build_object('scope',public.facetime_connector_scope(b),'state',b.state);
end; $$;

create function public.facetime_connector_emit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare transition text; version bigint;
begin
 if new.connector_owner is null then return new; end if;
 if new.connector_receipt is not null and old.connector_receipt is null then
  insert into public.facetime_connector_deliveries(binding_id,call_id,kind,body)
   values((new.connector_owner->>'binding_id')::uuid,new.id,'receipt',new.connector_receipt) on conflict do nothing;
 end if;
 if new.status=old.status then return new; end if;
 transition:=case when new.status='active' then 'started' when new.status in ('ended','rejected') then 'ended' when new.status='failed' then 'failed' else null end;
 if transition is not null then
  version:=case when transition='started' then 2 else 3 end;
  insert into public.facetime_connector_deliveries(binding_id,call_id,kind,body)
   values((new.connector_owner->>'binding_id')::uuid,new.id,transition,new.connector_owner || jsonb_build_object(
    'v',1,'type','call.lifecycle','message_id',gen_random_uuid(),'call_version',version,'transition',transition)) on conflict do nothing;
 end if;
 return new;
end; $$;
create trigger facetime_connector_emit after update on public.facetime_calls for each row execute function public.facetime_connector_emit();

create or replace function public.facetime_pin_call_integration() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare l public.facetime_lines%rowtype; e public.facetime_webhook_endpoints%rowtype;
 r public.facetime_integration_revisions%rowtype; policy text;
begin
 if tg_op='UPDATE' then
  if old.connector_receipt is not null and (new.connector_receipt,new.connector_decision_digest) is distinct from (old.connector_receipt,old.connector_decision_digest) then raise exception 'connector_receipt_immutable' using errcode='55000'; end if;
  if new.connector_owner is distinct from old.connector_owner or new.connector_resource_expires_at is distinct from old.connector_resource_expires_at then raise exception 'connector_owner_immutable' using errcode='55000'; end if;
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
 new.connector_owner:=null; new.connector_receipt:=null; new.connector_decision_digest:=null; new.connector_resource_expires_at:=null;
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
 if new.direction='inbound' and new.mode='customer_managed' and new.resolved_inbound_policy='customer_decides' then
  select public.facetime_connector_scope(b) into new.connector_owner from public.facetime_connector_bindings b where b.project_id=new.project_id and b.line_id=new.line_id and b.state='active' for update;
 end if;
 if new.direction='inbound' and new.mode='customer_managed' and new.resolved_inbound_policy='customer_decides'
  and new.binding_disposition <> 'pinned' and new.connector_owner is null then
  raise exception 'integration_unavailable' using errcode='55000';
 end if;
 if new.direction='inbound' then
  new.incoming_request_id := gen_random_uuid();
  new.incoming_request_created_at := clock_timestamp();
  new.incoming_decision_deadline_at := coalesce(new.incoming_decision_deadline_at,new.incoming_request_created_at + interval '5 seconds');
  new.incoming_request_data := jsonb_build_object('call_id',new.id,'line_id',new.line_id,'media',new.media,
    'from_handle_hash',new.incoming_request_data->'from_handle_hash','occurred_at',coalesce(new.incoming_request_data->'occurred_at',to_jsonb(new.detected_at)));
 end if;
 if new.connector_owner is not null then
  new.connector_owner:=new.connector_owner || jsonb_build_object('call_id',new.id,'request_id',new.incoming_request_id);
  new.connector_resource_expires_at:=floor(extract(epoch from new.incoming_request_created_at + interval '60 seconds')*1000);
 end if;
 return new;
end; $$;

create or replace function public.facetime_pinned_incoming_context(p_project_id uuid,p_worker_id uuid,p_call_id uuid,p_source_event_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.facetime_calls%rowtype; r public.facetime_integration_revisions%rowtype;
 s public.facetime_webhook_secret_versions%rowtype;
begin
 select * into c from public.facetime_calls where id=p_call_id and project_id=p_project_id and worker_id=p_worker_id;
 if not found or not exists(select 1 from public.facetime_call_events where project_id=p_project_id and call_id=p_call_id
   and source='worker' and source_event_id=p_source_event_id and event_type='incoming_registered') then
  raise exception 'call_not_found' using errcode='P0002'; end if;
 if c.incoming_webhook_decision is not null then return jsonb_build_object('webhook_decision',c.incoming_webhook_decision); end if;
 if c.connector_owner is not null then return jsonb_build_object('connector_pending',true,'connector_deadline',c.incoming_decision_deadline_at); end if;
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
end; $$;


create function public.facetime_connector_runtime(p_hash text,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.facetime_connector_bindings%rowtype; c public.facetime_calls%rowtype;
 w public.facetime_workers%rowtype; recovery boolean; frames jsonb; source_id text; result jsonb; owner jsonb; delivery public.facetime_connector_deliveries%rowtype;
begin
 select * into b from public.facetime_connector_bindings where connection_hash=p_hash or recovery_hash=p_hash;
 if not found then raise exception 'connector_unauthorized' using errcode='42501'; end if;
 perform 1 from public.facetime_lines where id=b.line_id for update;
 select * into b from public.facetime_connector_bindings where id=b.id for update;
 recovery := b.recovery_hash=p_hash;
 if not recovery and b.state='revoked' then raise exception 'connector_revoked' using errcode='42501'; end if;
 if p_action='connect' then
  update public.facetime_connector_bindings set generation=generation+1,lease_until=clock_timestamp()+interval '5 seconds' where id=b.id returning * into b;
  return public.facetime_connector_scope(b) || jsonb_build_object('v',1,'type','connection.welcome','message_id',gen_random_uuid(),
   'role',case when recovery or b.state in ('revoked','draining') then 'draining' else b.state end);
 end if;
 if p_action not in ('reconcile','inspect') and ((p_input->>'connection_generation')::bigint is distinct from b.generation or b.lease_until is null or b.lease_until<=clock_timestamp()) then
  raise exception 'connector_stale_generation' using errcode='42501'; end if;
 if p_action='inspect' then return jsonb_build_object('scope',public.facetime_connector_scope(b),'state',b.state,
  'connected',coalesce(b.lease_until>clock_timestamp(),false),'recovery_only',recovery); end if;
 if p_action='poll' then
  update public.facetime_connector_bindings set lease_until=clock_timestamp()+interval '5 seconds' where id=b.id;
  -- Expired incoming requests receive an authoritative decline, even after relay/worker request loss.
  for c in select * from public.facetime_calls where connector_owner->>'binding_id'=b.id::text and connector_receipt is null
    and incoming_decision_deadline_at<=clock_timestamp() and coalesce(incoming_webhook_decision->>'action','decline')='decline' for update loop
   select source_event_id into source_id from public.facetime_call_events where call_id=c.id and source='worker' and event_type='incoming_registered';
   if c.status='incoming' then perform public.facetime_commit_incoming_webhook_decision(c.project_id,c.id,source_id,'decline','webhook_deadline_exceeded',null);
   elsif c.status not in ('ended','failed','rejected') then continue; end if;
   update public.facetime_calls set connector_receipt=connector_owner || jsonb_build_object('v',1,'type','decision.committed','message_id',gen_random_uuid(),
     'action','decline','call_version',1,'resource_expires_at',connector_resource_expires_at) where id=c.id;
  end loop;
  select coalesce(jsonb_agg(d.body || case when d.kind='receipt' then '{}'::jsonb else jsonb_build_object('cursor',d.cursor,'event_id',d.event_id) end order by d.cursor),'[]'::jsonb)
   into frames from (select * from public.facetime_connector_deliveries where binding_id=b.id and acknowledged_at is null order by cursor limit 16) d;
  if b.state='active' and not recovery then
   select coalesce(jsonb_agg(pending_call.connector_owner || jsonb_build_object('connection_generation',b.generation,'v',1,'type','call.incoming',
    'message_id',pending_call.incoming_request_id,'integration_revision_id',coalesce(pending_call.integration_revision_id,b.id),
    'created_at',floor(extract(epoch from pending_call.incoming_request_created_at)*1000), 'sent_at',floor(extract(epoch from clock_timestamp())*1000),
    'deadline_at',floor(extract(epoch from pending_call.incoming_decision_deadline_at)*1000),
    'prepare_deadline_at',floor(extract(epoch from pending_call.incoming_decision_deadline_at)*1000)-1000,
    'remaining_ms',greatest(0,floor(extract(epoch from pending_call.incoming_decision_deadline_at-clock_timestamp())*1000)),
    'resource_expires_at',pending_call.connector_resource_expires_at,'media',pending_call.media)),'[]'::jsonb) into result
    from public.facetime_calls pending_call where pending_call.connector_owner->>'binding_id'=b.id::text and pending_call.connector_receipt is null and pending_call.status='incoming' and pending_call.incoming_decision_deadline_at>clock_timestamp();
   frames:=frames || result;
  end if;
  return jsonb_build_object('frames',frames,'state',b.state);
 end if;
 owner:=p_input->'owner';
 select * into c from public.facetime_calls where id=(owner->>'call_id')::uuid and project_id=b.project_id for update;
 if not found or c.connector_owner is null or c.connector_owner->>'binding_id'<>b.id::text
  or (c.connector_owner-'connection_generation') is distinct from (owner-'connection_generation') then
  raise exception 'connector_owner_mismatch' using errcode='42501'; end if;
 if p_action='reconcile' and c.connector_receipt is null and c.incoming_decision_deadline_at<=clock_timestamp() and coalesce(c.incoming_webhook_decision->>'action','decline')='decline' then
  select source_event_id into source_id from public.facetime_call_events where call_id=c.id and source='worker' and event_type='incoming_registered';
  if c.status='incoming' then perform public.facetime_commit_incoming_webhook_decision(c.project_id,c.id,source_id,'decline','webhook_deadline_exceeded',null);
  elsif c.status not in ('ended','failed','rejected') then return jsonb_build_object('status','unknown'); end if;
  update public.facetime_calls set connector_receipt=connector_owner || jsonb_build_object('v',1,'type','decision.committed','message_id',gen_random_uuid(),
    'action','decline','call_version',1,'resource_expires_at',connector_resource_expires_at) where id=c.id returning * into c;
 end if;
 if p_action='reconcile' then
  if c.connector_receipt is null then return jsonb_build_object('status','unknown'); end if;
  return jsonb_build_object('status','known','receipt',c.connector_receipt,'terminal',c.status in ('ended','failed','rejected'));
 elsif p_action='ack' then
  select * into delivery from public.facetime_connector_deliveries where binding_id=b.id and call_id=c.id and event_id=(p_input->>'event_id')::uuid and cursor=(p_input->>'cursor')::bigint;
  if not found then raise exception 'connector_ack_mismatch' using errcode='42501'; end if;
  update public.facetime_connector_deliveries set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where cursor=delivery.cursor;
  -- A durable lifecycle acknowledgement also makes repeating the acceptance receipt unnecessary.
  update public.facetime_connector_deliveries set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where binding_id=b.id and call_id=c.id and kind='receipt';
  return '{}'::jsonb;
 elsif p_action in ('decision','decision_replay') then
  if recovery or b.state<>'active' then raise exception 'connector_not_active' using errcode='42501'; end if;
  if c.connector_receipt is not null then
   if c.connector_decision_digest is distinct from p_input->>'digest' then raise exception 'connector_decision_conflict' using errcode='55000'; end if;
   return c.connector_receipt;
  end if;
  if p_action='decision_replay' then return null; end if;
  if clock_timestamp()>=c.incoming_decision_deadline_at or c.status<>'incoming' then raise exception 'connector_deadline' using errcode='55000'; end if;
  select source_event_id into source_id from public.facetime_call_events where call_id=c.id and source='worker' and event_type='incoming_registered';
  if p_input->>'action'='accept' then
   select * into w from public.facetime_workers where id=c.worker_id;
   if w.automatic_readiness_enabled then
    select * into w from public.facetime_workers where id=c.worker_id for update;
    if not w.enabled or w.status<>'accepting' or not public.facetime_worker_automatic_ready(w,clock_timestamp(),false) then
     raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
   end if;
   if c.media<>'{"audio":true,"video":false}'::jsonb then raise exception 'connector_media_unsupported' using errcode='55000'; end if;
   perform public.facetime_insert_sealed_session(c.project_id,c.id,(p_input->>'session_id')::uuid,c.worker_id,
    p_input->>'room',p_input->>'identity',(p_input->>'token_expires_at')::timestamptz,(p_input->>'lease_expires_at')::timestamptz,
    p_input->>'url_ciphertext',p_input->>'token_ciphertext',p_input->>'fingerprint',(p_input->>'key_version')::integer);
   if clock_timestamp()>=c.incoming_decision_deadline_at then raise exception 'connector_deadline' using errcode='55000'; end if;
   if w.automatic_readiness_enabled and not public.facetime_worker_automatic_ready(w,clock_timestamp(),false) then
    raise exception 'incoming_accept_unavailable' using errcode='55000'; end if;
   update public.facetime_calls set incoming_webhook_source_event_id=source_id,incoming_webhook_decision='{"action":"accept"}' where id=c.id;
  elsif p_input->>'action'='decline' then
   perform public.facetime_commit_incoming_webhook_decision(c.project_id,c.id,source_id,'decline','webhook_declined',null);
  else raise exception 'connector_invalid_decision' using errcode='22023'; end if;
  update public.facetime_calls set connector_decision_digest=p_input->>'digest',connector_receipt=connector_owner || jsonb_build_object(
   'v',1,'type','decision.committed','message_id',gen_random_uuid(),'action',p_input->>'action','call_version',1,'resource_expires_at',connector_resource_expires_at)
   where id=c.id returning connector_receipt into result;
  return result;
 elsif p_action='target' then
  return jsonb_build_object('worker_id',c.worker_id,'resource_expires_at',c.connector_resource_expires_at);
 end if;
 raise exception 'connector_action_invalid' using errcode='22023';
end; $$;

-- Line configuration may not silently supersede explicit activation. Drain first.
create function public.facetime_connector_line_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' then
  perform 1 from public.facetime_projects where id=new.project_id for update;
  if exists(select 1 from public.facetime_connector_bindings where project_id=new.project_id and state='active') then
   raise exception 'connector_active_line_cardinality' using errcode='55000'; end if;
 elsif (new.project_id,new.integration_id,new.default_assistant_id,new.inbound_policy) is distinct from (old.project_id,old.integration_id,old.default_assistant_id,old.inbound_policy)
  and exists(select 1 from public.facetime_connector_bindings where line_id=old.id and state='active') then
  raise exception 'connector_drain_before_route_change' using errcode='55000';
 end if;
 return new;
end; $$;
create trigger facetime_connector_line_guard before insert or update on public.facetime_lines for each row execute function public.facetime_connector_line_guard();
revoke all on function public.facetime_connector_scope(public.facetime_connector_bindings),public.facetime_connector_manage(uuid,uuid,text,jsonb),
 public.facetime_connector_runtime(text,text,jsonb),public.facetime_connector_emit(),public.facetime_connector_line_guard() from public,anon,authenticated,service_role;
grant execute on function public.facetime_connector_manage(uuid,uuid,text,jsonb),public.facetime_connector_runtime(text,text,jsonb) to service_role;

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
  if not found or v_call.connector_owner is not null or v_call.binding_disposition='none' then return new; end if;
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
 if c.connector_owner is not null then raise exception 'connector_decision_authority_required' using errcode='42501'; end if;
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

create index facetime_connector_pending_calls on public.facetime_calls ((connector_owner->>'binding_id'), incoming_decision_deadline_at)
 where connector_owner is not null and connector_receipt is null;
create index facetime_connector_delivery_backlog on public.facetime_connector_deliveries(binding_id,cursor)
 where acknowledged_at is null;


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
  -- Cleanup may reach the durable event log before its terminal event. Do not
  -- free an active session early; reconcile only after its terminal transition.
  if new.event_type in ('ended', 'failed', 'rejected') then
    update public.facetime_sessions s
    set state = 'cleaned', cleaned_at = (
      select min(e.occurred_at) from public.facetime_call_events e
      where e.project_id = s.project_id and e.call_id = s.call_id
        and e.event_type = 'cleanup_complete' and e.source = 'worker'
        and e.occurred_at >= new.occurred_at
        and e.occurred_at >= coalesce(s.dispatched_at, s.created_at)
    )
    where s.call_id = new.call_id and s.project_id = new.project_id
      and s.state in ('ended', 'failed') and s.cleaned_at is null
      and exists (
        select 1 from public.facetime_call_events e
        where e.project_id = s.project_id and e.call_id = s.call_id
          and e.event_type = 'cleanup_complete' and e.source = 'worker'
          and e.occurred_at >= new.occurred_at
          and e.occurred_at >= coalesce(s.dispatched_at, s.created_at)
      );
  end if;
  return new;
end;
$function$
;

do $mode_guard$ begin
if exists(select 1 from information_schema.columns where table_schema='public' and table_name='facetime_connector_bindings' and column_name='session_mode')
 or to_regprocedure('public.facetime_connector_runtime_pre_byor(text,text,jsonb)') is not null then raise exception 'byor_extension_already_present'; end if;
if (select md5(pg_get_functiondef('public.facetime_connector_runtime(text,text,jsonb)'::regprocedure))) <> '27ed0fd3f6d5ed2fa50eb8b8a2fbe280' then raise exception 'connector_runtime_drift'; end if;
end $mode_guard$;
-- Local BYOR extension. Apply only after a reviewed connector baseline.
-- Does not replace any shared call-routing/readiness/cleanup function. The
-- runtime wrapper delegates to the exact installed connector implementation.
alter table public.facetime_connector_bindings add column session_mode text not null default 'create-room'
 check (session_mode in ('create-room','byor'));
create or replace function public.facetime_connector_scope(b public.facetime_connector_bindings) returns jsonb
language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_build_object('project_id',b.project_id,'line_id',b.line_id,'binding_id',b.id,'binding_epoch',b.epoch,
 'instance_id',b.instance_id,'connection_generation',b.generation)
 || case when b.session_mode='byor' then jsonb_build_object('session_mode','byor') else '{}'::jsonb end
$$;
create or replace function public.facetime_connector_manage(p_project_id uuid,p_actor_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.facetime_connector_bindings%rowtype; previous public.facetime_connector_bindings%rowtype;
 l public.facetime_lines%rowtype; result jsonb;
begin
 -- Membership is checked inside the transaction as well as at the HTTP boundary.
 perform 1 from public.facetime_project_memberships where project_id=p_project_id and user_id=p_actor_id and role in ('owner','admin') for share;
 if not found then raise exception 'connector_forbidden' using errcode='42501'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('scope',public.facetime_connector_scope(x),'state',x.state,'name',x.name,
    'environment',x.environment,'connected',coalesce(x.lease_until>clock_timestamp(),false))), '[]'::jsonb)
    into result from public.facetime_connector_bindings x where project_id=p_project_id; return result;
 end if;
 -- Admission selects the project's sole line. Retirement locks the existing
 -- binding's line instead; later project cardinality cannot prevent revocation.
 if p_action in ('drain','revoke') then
  select ln.* into l from public.facetime_lines ln
   join public.facetime_connector_bindings owned on owned.line_id=ln.id
   where owned.id=(p_input->>'binding_id')::uuid and owned.project_id=p_project_id
   for update of ln;
 else
  select * into l from public.facetime_lines where project_id=p_project_id order by id limit 1 for update;
 end if;
 perform 1 from public.facetime_projects where id=p_project_id for update;
 if p_action in ('enroll','activate') and (select count(*) from public.facetime_lines where project_id=p_project_id)<>1 then
  raise exception 'connector_requires_exactly_one_line' using errcode='55000'; end if;
 if p_action='enroll' then
  if l.id is distinct from (p_input->>'line_id')::uuid then raise exception 'connector_line_mismatch' using errcode='42501'; end if;
  insert into public.facetime_connector_bindings(project_id,line_id,name,environment,connection_hash,recovery_hash,created_by,session_mode)
   values(p_project_id,l.id,p_input->>'name',p_input->>'environment',p_input->>'connection_hash',p_input->>'recovery_hash',p_actor_id,coalesce(p_input->>'session_mode','create-room')) returning * into b;
 else
  select * into b from public.facetime_connector_bindings where id=(p_input->>'binding_id')::uuid and project_id=p_project_id for update;
  if not found then raise exception 'connector_not_found' using errcode='P0002'; end if;
  if p_action='activate' then
   select * into previous from public.facetime_connector_bindings where project_id=p_project_id and state='active' for update;
   if previous.id is distinct from (p_input->>'expected_binding_id')::uuid or l.assignment_generation is distinct from (p_input->>'assignment_generation')::bigint
     or b.state not in ('standby','active') or b.environment<>'production' then
    raise exception 'connector_activation_conflict' using errcode='55000'; end if;
   if l.default_assistant_id is not null or l.inbound_policy<>'customer_decides' then
    raise exception 'connector_route_requires_customer_decides' using errcode='55000'; end if;
   if l.current_call_id is not null and not exists(select 1 from public.facetime_calls where id=l.current_call_id and connector_owner is not null) then
    raise exception 'connector_legacy_call_in_progress' using errcode='55000'; end if;
   update public.facetime_connector_bindings set state='draining' where id=previous.id and id<>b.id;
   update public.facetime_connector_bindings set state='active' where id=b.id returning * into b;
  elsif p_action in ('drain','revoke') then
   -- Revocation is terminal. Draining must never restore the connection hash.
   update public.facetime_connector_bindings set state=case when p_action='revoke' or b.state='revoked' then 'revoked' else 'draining' end,
    lease_until=case when p_action='revoke' then null else lease_until end where id=b.id returning * into b;
  else raise exception 'connector_action_invalid' using errcode='22023'; end if;
 end if;
 insert into public.facetime_configuration_audit(project_id,resource_type,resource_id,operation,next_configuration)
 values(p_project_id,'connector',b.id,p_action,jsonb_build_object('state',b.state,'actor_id',p_actor_id));
 return jsonb_build_object('scope',public.facetime_connector_scope(b),'state',b.state);
end; $$;

create function public.facetime_connector_mode_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.session_mode is distinct from old.session_mode then raise exception 'connector_mode_immutable' using errcode='55000'; end if;
 return new;
end; $$;
create trigger facetime_connector_mode_guard before update on public.facetime_connector_bindings
 for each row execute function public.facetime_connector_mode_guard();

create function public.facetime_connector_byor_duration() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Runs after the installed pin function; preserve its signing/readiness policy.
 if new.connector_owner->>'session_mode'='byor' then
  new.connector_resource_expires_at:=floor(extract(epoch from new.incoming_request_created_at + interval '2 hours')*1000);
 end if;
 return new;
end; $$;
create trigger zz_facetime_connector_byor_duration before insert on public.facetime_calls
 for each row execute function public.facetime_connector_byor_duration();

alter function public.facetime_connector_runtime(text,text,jsonb) rename to facetime_connector_runtime_pre_byor;
revoke all on function public.facetime_connector_runtime_pre_byor(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.facetime_connector_runtime(p_hash text,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare target jsonb; expires_at timestamptz;
begin
 if p_action='decision' and p_input->>'action'='accept' and p_input->'owner'->>'session_mode'='byor' then
  -- Authorize the exact owner and live generation before inspecting its limit.
  target:=public.facetime_connector_runtime_pre_byor(p_hash,'target',p_input);
  expires_at:=(p_input->>'lease_expires_at')::timestamptz;
  if expires_at is null or expires_at<=clock_timestamp()
   or expires_at>(p_input->>'token_expires_at')::timestamptz
   or floor(extract(epoch from expires_at)*1000)>(target->>'resource_expires_at')::bigint then
   raise exception 'connector_session_expiry_invalid' using errcode='55000';
  end if;
 end if;
 target:=public.facetime_connector_runtime_pre_byor(p_hash,p_action,p_input);
 if p_action='target' then
  target:=target || jsonb_build_object('session_mode',coalesce(p_input->'owner'->>'session_mode','create-room'));
 end if;
 return target;
end; $$;
revoke all on function public.facetime_connector_runtime(text,text,jsonb),public.facetime_connector_mode_guard(),
 public.facetime_connector_byor_duration() from public,anon,authenticated,service_role;
grant execute on function public.facetime_connector_runtime(text,text,jsonb) to service_role;

do $media_guard$ begin if (select md5(pg_get_functiondef('public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure))) <> '47a888a9a37985637a6da00cc9b24751' then raise exception 'byor_media_runtime_drift'; end if; end $media_guard$;
-- Additive extension of the installed runtime; preserve the newer candidate's
-- signing/readiness/cleanup implementation instead of copying a stale body.
do $migration$
declare
 definition text;
 old_guard text := $old$if c.media<>'{"audio":true,"video":false}'::jsonb then raise exception 'connector_media_unsupported' using errcode='55000'; end if;$old$;
 new_guard text := $new$if c.media not in ('{"audio":true,"video":false}'::jsonb,'{"audio":true,"video":true}'::jsonb)
      or (b.session_mode<>'byor' and c.media<>'{"audio":true,"video":false}'::jsonb)
     then raise exception 'connector_media_unsupported' using errcode='55000'; end if;$new$;
begin
 definition := pg_get_functiondef('public.facetime_connector_runtime_pre_byor(text,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
  raise exception 'connector_media_preimage_mismatch';
 end if;
 execute replace(definition,old_guard,new_guard);
end;
$migration$;
-- CREATE OR REPLACE retains existing ACLs; explicitly keep the delegate private.
revoke all on function public.facetime_connector_runtime_pre_byor(text,text,jsonb) from public,anon,authenticated,service_role;
