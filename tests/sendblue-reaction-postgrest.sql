-- Disposable auth/CRM schema approximation; actual migrations23/25/26 and actual routes.
\ir linq-reaction-postgrest.sql
ALTER TABLE messaging_tenants ADD COLUMN phone_line_id UUID, ADD COLUMN outbound_consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE phone_lines ADD COLUMN webhook_subscription_id TEXT;
UPDATE phone_lines SET webhook_subscription_id='fixture-native-sub';
ALTER TABLE leads ADD COLUMN number_2 TEXT, ADD COLUMN number_3 TEXT, ADD COLUMN number_4 TEXT, ADD COLUMN updated_at TIMESTAMPTZ, ADD COLUMN status TEXT;
ALTER TABLE convo ADD COLUMN updated_at TIMESTAMPTZ;
UPDATE convo SET messages='[]';
CREATE TABLE recipient_pacing(phone_line_id UUID,recipient_phone TEXT,has_replied_ever BOOLEAN,consecutive_without_reply INTEGER,last_reply_at TIMESTAMPTZ,PRIMARY KEY(phone_line_id,recipient_phone));
CREATE TABLE webhook_event_dedup(event_id TEXT PRIMARY KEY,received_at TIMESTAMPTZ);
CREATE TABLE tenant_webhook_subscriptions(id UUID PRIMARY KEY,tenant_id UUID,url TEXT,secret TEXT,events TEXT[],version TEXT,is_active BOOLEAN,consecutive_failures INTEGER);
CREATE TABLE messaging_events(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id UUID,type TEXT,event_id TEXT,payload JSONB,lead_id UUID,convo_id UUID,created_at TIMESTAMPTZ DEFAULT clock_timestamp(),delivery_attempts JSONB DEFAULT '[]',delivery_url TEXT,delivery_status TEXT,delivered_at TIMESTAMPTZ,UNIQUE(tenant_id,event_id));
GRANT SELECT,INSERT,UPDATE ON recipient_pacing,webhook_event_dedup,tenant_webhook_subscriptions,messaging_events TO service_role;
\ir ../../imessage-server/docs/migrations/23_convo-native-guid-dedup.sql
-- Migration26 is applied by the inherited Linq schema above.
