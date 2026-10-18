-- Disposable authenticated first-chat fixture, not a migration.
\ir account-history-postgrest.sql
ALTER TABLE leads ADD COLUMN number_2 text,ADD COLUMN number_3 text,ADD COLUMN number_4 text,ADD COLUMN name text,ADD COLUMN created_at timestamptz;
ALTER TABLE messaging_send_events ADD COLUMN idempotency_key text,ADD COLUMN external_id text,ADD COLUMN error text,ADD COLUMN message_guid text,ADD COLUMN was_first_touch boolean;
CREATE TABLE phone_lines(id uuid PRIMARY KEY,project_id uuid,phone_number text,status text,health_status text,server_url text,api_key text,signing_secret text,response_rate_7d numeric);
GRANT SELECT,INSERT,UPDATE,DELETE ON phone_lines TO service_role;
