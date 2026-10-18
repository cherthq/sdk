-- Disposable contract fixture only; FK/auth schema is an explicit approximation.
-- Migration25 and its grants/checks come from the existing actual-PG gate.
\ir reserved-reaction-operation-postgrest.sql
-- Owned inbound GET now reads the protected ledger; historical rows have none.
\ir ../../imessage-server/docs/migrations/26_messaging-received-contexts.sql
ALTER TABLE public.messaging_send_events
 ADD COLUMN status TEXT, ADD COLUMN error TEXT, ADD COLUMN idempotency_key TEXT,
 ADD COLUMN external_id TEXT, ADD COLUMN created_at TIMESTAMPTZ, ADD COLUMN updated_at TIMESTAMPTZ;
UPDATE public.convo SET messages='[{"id":"recorded-target","guid":"a1111111-2222-4333-8444-555555555555","role":"user","content":"actual owned plaintext","service":"imessage"}]'::jsonb
 WHERE id='51ee0000-0000-4000-8000-000000000001';
