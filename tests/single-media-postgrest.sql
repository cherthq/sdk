-- Task-owned disposable fixture only; no production schema migration.
ALTER TABLE public.messaging_send_events ADD COLUMN idempotency_key text, ADD COLUMN external_id text;
ALTER TABLE public.leads ADD COLUMN number_2 text, ADD COLUMN number_3 text, ADD COLUMN number_4 text, ADD COLUMN name text, ADD COLUMN created_at timestamptz;
ALTER TABLE public.phone_lines ADD COLUMN response_rate_7d numeric;
CREATE TABLE public.single_media_commit_fault(mode text NOT NULL);
INSERT INTO public.single_media_commit_fault VALUES('none');
GRANT SELECT,UPDATE ON public.single_media_commit_fault TO service_role;
REVOKE ALL ON public.single_media_commit_fault FROM PUBLIC,anon;
CREATE FUNCTION public.single_media_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode text;
BEGIN
 SELECT f.mode INTO mode FROM public.single_media_commit_fault f;
 IF (TG_OP='INSERT' AND mode='reserve_commit') OR (TG_OP='UPDATE' AND mode='finalize_commit') THEN
  RAISE EXCEPTION 'disposable media transaction commit rejected';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER single_media_commit_fault AFTER INSERT OR UPDATE ON public.messaging_send_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.single_media_commit_fault();
CREATE FUNCTION public.single_media_pin_race() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT mode FROM public.single_media_commit_fault)='pin_race'
   AND OLD.details->>'phone_line_id' IS NULL
   AND NEW.details->>'phone_line_id'='61000000-0000-4000-8000-000000000001' THEN
  UPDATE public.leads SET details=jsonb_set(coalesce(OLD.details,'{}'),'{phone_line_id}','"61000000-0000-4000-8000-000000000009"') WHERE id=OLD.id;
  RETURN NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER single_media_pin_race BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.single_media_pin_race();
