-- Disposable qualified webhook CRUD fixture, not a migration.
\ir ../../../tests/account-history-postgrest.sql
CREATE TABLE tenant_webhook_subscriptions(id uuid PRIMARY KEY,tenant_id uuid,url text,events text[],version text,is_active boolean,secret text,consecutive_failures int DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp());
GRANT SELECT,INSERT,UPDATE,DELETE ON tenant_webhook_subscriptions TO service_role;
