-- Disposable FK fixtures only; production migration26 is applied verbatim twice.
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT service_role,anon,authenticated TO authenticator;
GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
CREATE TABLE messaging_tenants(id UUID PRIMARY KEY);
CREATE TABLE leads(id UUID PRIMARY KEY);
CREATE TABLE phone_lines(id UUID PRIMARY KEY);
INSERT INTO messaging_tenants VALUES('11000000-0000-4000-8000-000000000001'),('11000000-0000-4000-8000-000000000002');
INSERT INTO leads VALUES('41000000-0000-4000-8000-000000000001'),('41000000-0000-4000-8000-000000000002');
INSERT INTO phone_lines VALUES('61000000-0000-4000-8000-000000000001'),('61000000-0000-4000-8000-000000000002');
\ir ../../imessage-server/docs/migrations/26_messaging-received-contexts.sql
\ir ../../imessage-server/docs/migrations/26_messaging-received-contexts.sql
DO $$ BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='messaging_received_contexts'::regclass) THEN RAISE EXCEPTION 'RLS absent'; END IF;
 IF has_table_privilege('anon','messaging_received_contexts','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','messaging_received_contexts','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'public privileges'; END IF;
 IF NOT has_table_privilege('service_role','messaging_received_contexts','SELECT') OR NOT has_table_privilege('service_role','messaging_received_contexts','INSERT') OR has_table_privilege('service_role','messaging_received_contexts','UPDATE,DELETE') THEN RAISE EXCEPTION 'service privileges'; END IF;
END $$;
CREATE TABLE fixture_received_faults(mode TEXT);
INSERT INTO fixture_received_faults VALUES('none');
GRANT SELECT,UPDATE ON fixture_received_faults TO service_role;
CREATE FUNCTION fixture_received_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF(SELECT mode FROM fixture_received_faults)='commit' THEN RAISE EXCEPTION 'fixture commit failure'; END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER fixture_received_commit AFTER INSERT ON messaging_received_contexts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_received_commit_fault();
