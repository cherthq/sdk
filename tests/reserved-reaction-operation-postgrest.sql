-- Disposable approximation of only existing FK/line fields; migration25 is real.
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT service_role,anon,authenticated TO authenticator;
CREATE TABLE public.messaging_tenants(id UUID PRIMARY KEY,tenant_slug TEXT,signing_secret TEXT,crm_project_id UUID,auto_create_leads BOOLEAN DEFAULT false,webhook_url TEXT,webhook_secret TEXT,is_active BOOLEAN DEFAULT true,label TEXT,email TEXT,email_verified_at TIMESTAMPTZ,credit_balance NUMERIC DEFAULT 10,leadgen_credit_balance NUMERIC DEFAULT 10,requires_tenant_header BOOLEAN DEFAULT false);
CREATE TABLE public.leads(id UUID PRIMARY KEY,project_id UUID,messaging_tenant_id UUID,number TEXT,convo_id UUID,details JSONB);
CREATE TABLE public.convo(id UUID PRIMARY KEY,lead_id UUID,messages JSONB);
CREATE TABLE public.messaging_send_events(id TEXT PRIMARY KEY,tenant_id UUID,lead_id UUID,convo_id UUID,phone TEXT,phone_line_id UUID,message_guid TEXT,request_payload JSONB,response_payload JSONB);
CREATE TABLE public.phone_lines(id UUID PRIMARY KEY,project_id UUID,phone_number TEXT,status TEXT,server_url TEXT,api_key TEXT,signing_secret TEXT);
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
GRANT SELECT,UPDATE ON public.phone_lines TO service_role;
INSERT INTO messaging_tenants(id) VALUES ('11aa0000-0000-4000-8000-000000000001'),('11aa0000-0000-4000-8000-000000000002');
INSERT INTO leads(id) VALUES ('41dd0000-0000-4000-8000-000000000001');
INSERT INTO phone_lines VALUES ('61cc0000-0000-4000-8000-000000000001','21bb0000-0000-4000-8000-000000000001','+15550000001','active',NULL,'fixture-native-key','fixture-native-signing');
UPDATE messaging_tenants SET tenant_slug='fixture',signing_secret='fixture-cloud-key',crm_project_id='21bb0000-0000-4000-8000-000000000001' WHERE id='11aa0000-0000-4000-8000-000000000001';
UPDATE messaging_tenants SET tenant_slug='foreign',signing_secret='fixture-foreign-key',crm_project_id='21bb0000-0000-4000-8000-000000000002' WHERE id='11aa0000-0000-4000-8000-000000000002';
UPDATE leads SET project_id='21bb0000-0000-4000-8000-000000000001',messaging_tenant_id='11aa0000-0000-4000-8000-000000000001',number='+15550000002',convo_id='51ee0000-0000-4000-8000-000000000001',details='{"phone_line_id":"61cc0000-0000-4000-8000-000000000001"}';
INSERT INTO convo VALUES ('51ee0000-0000-4000-8000-000000000001','41dd0000-0000-4000-8000-000000000001','[]');
GRANT SELECT ON messaging_tenants,leads,convo,messaging_send_events TO service_role;
GRANT UPDATE ON messaging_tenants,leads,convo TO service_role;
GRANT INSERT ON messaging_send_events TO service_role;

\ir ../../imessage-server/docs/migrations/25_messaging-reaction-operations.sql
\ir ../../imessage-server/docs/migrations/25_messaging-reaction-operations.sql
DO $$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.messaging_reaction_operations'::regclass) THEN RAISE EXCEPTION 'RLS missing'; END IF;
 IF has_table_privilege('anon','public.messaging_reaction_operations','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.messaging_reaction_operations','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'public role privilege'; END IF;
 IF NOT has_table_privilege('service_role','public.messaging_reaction_operations','SELECT') OR NOT has_table_privilege('service_role','public.messaging_reaction_operations','INSERT') OR NOT has_table_privilege('service_role','public.messaging_reaction_operations','UPDATE') OR has_table_privilege('service_role','public.messaging_reaction_operations','DELETE') THEN RAISE EXCEPTION 'service privileges'; END IF;
END $$;
CREATE TABLE public.fixture_reaction_faults(id INTEGER PRIMARY KEY,mode TEXT NOT NULL);
INSERT INTO fixture_reaction_faults VALUES (1,'none');
GRANT SELECT,UPDATE ON fixture_reaction_faults TO service_role;
CREATE FUNCTION public.fixture_reaction_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT mode FROM fixture_reaction_faults WHERE id=1)='reserve-commit' AND TG_OP='INSERT' THEN RAISE EXCEPTION 'fixture deferred reservation failure'; END IF;
 IF (SELECT mode FROM fixture_reaction_faults WHERE id=1)='finalize-commit' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'fixture deferred finalization failure'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER fixture_reaction_commit_failure AFTER INSERT OR UPDATE ON public.messaging_reaction_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_reaction_commit_fault();
