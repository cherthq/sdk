-- Disposable read-route fixtures, not a production migration.
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE anon NOLOGIN;
GRANT service_role,anon TO authenticator;
GRANT USAGE ON SCHEMA public TO service_role;
CREATE TABLE messaging_tenants(id uuid PRIMARY KEY,tenant_slug text,signing_secret text,crm_project_id uuid,phone_line_id uuid,is_active boolean,requires_tenant_header boolean DEFAULT false,email text,webhook_url text,webhook_secret text,outbound_consecutive_failures int DEFAULT 0,auto_create_leads boolean DEFAULT false,label text,email_verified_at timestamptz,credit_balance numeric,leadgen_credit_balance numeric);
CREATE TABLE leads(id uuid PRIMARY KEY,messaging_tenant_id uuid,project_id uuid,number text,convo_id uuid,details jsonb);
CREATE TABLE convo(id uuid PRIMARY KEY,lead_id uuid,messages jsonb);
CREATE TABLE messaging_send_events(id text PRIMARY KEY,tenant_id uuid,lead_id uuid,convo_id uuid,phone text,phone_line_id uuid,status text,created_at timestamptz,updated_at timestamptz,request_payload jsonb,response_payload jsonb);
CREATE TABLE messaging_attachments(attachment_id text PRIMARY KEY,tenant_id uuid,uploaded_at timestamptz,filename text,content_type text,size_bytes bigint,blob_url text,live_photo boolean,companion_attachment_id text,live_photo_uuid text);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon;
