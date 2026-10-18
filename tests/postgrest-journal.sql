-- Disposable fixture schema, not a production migration or authoritative original CREATE.
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE anon NOLOGIN;
GRANT service_role, anon TO authenticator;
CREATE TABLE public.messaging_tenants(id uuid PRIMARY KEY, webhook_url text, webhook_secret text, outbound_consecutive_failures integer DEFAULT 0, is_active boolean DEFAULT true);
CREATE TABLE public.tenant_webhook_subscriptions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,url text NOT NULL,secret text NOT NULL,events text[] DEFAULT '{}',version text NOT NULL,is_active boolean DEFAULT true,consecutive_failures integer DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,updated_at timestamptz);
CREATE TABLE public.messaging_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,type text NOT NULL,event_id text NOT NULL,payload jsonb NOT NULL,lead_id uuid,convo_id uuid,created_at timestamptz DEFAULT clock_timestamp(),delivery_attempts jsonb NOT NULL DEFAULT '[]',delivery_url text,delivery_status text,delivered_at timestamptz,UNIQUE(tenant_id,event_id));
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.messaging_tenants(id) VALUES ('11000000-0000-4000-8000-000000000001');
