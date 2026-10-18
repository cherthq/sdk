-- Disposable fixture extension, NOT a migration or production schema claim.
-- Column matches canonical migration 08; deliberately NONunique (existing PK fences strict IDs).
ALTER TABLE public.messaging_send_events ADD COLUMN idempotency_key text;
CREATE TABLE public.strict_text_fault(mode text NOT NULL);
INSERT INTO public.strict_text_fault VALUES('none');
GRANT SELECT,UPDATE ON public.strict_text_fault TO service_role;
REVOKE ALL ON public.strict_text_fault FROM PUBLIC,anon;
CREATE FUNCTION public.strict_text_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode text;
BEGIN
 SELECT f.mode INTO mode FROM public.strict_text_fault f;
 IF (TG_OP='INSERT' AND mode='reserve_commit') OR
    (TG_OP='UPDATE' AND mode='finalize_commit') THEN
   RAISE EXCEPTION 'disposable transaction commit rejected';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER strict_text_commit_fault
 AFTER INSERT OR UPDATE ON public.messaging_send_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 EXECUTE FUNCTION public.strict_text_commit_fault();
