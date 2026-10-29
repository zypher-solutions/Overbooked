-- Least privilege for the two API roles. Row rules (RLS) are the main defence, but they do not cover TRUNCATE, and Supabase
-- hands every new table to `anon` and `authenticated` with all rights. Here the rights are cut back to what the app uses.
--   * `anon` (not signed in) gets nothing: the app only signs people in through the auth service.
--   * `authenticated` loses TRUNCATE, TRIGGER and REFERENCES everywhere, and every write right on a table that has no
--     write rule for it (money and booking tables are written only through functions).
--   * Functions are no longer executable by everyone by default; each migration grants what it needs.
-- supabase/tests/security.test.sql checks these rules, so a future table with open rights fails the tests.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_limit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_limit(text, text) TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
    -- a write right is kept only where a permissive rule lets signed-in people write (a restrictive rule only narrows)
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive AND p.polcmd IN ('a', '*')
                   AND (p.polroles = '{0}' OR p.polroles @> ARRAY['authenticated'::regrole::oid])) THEN
      EXECUTE format('REVOKE INSERT ON public.%I FROM authenticated', r.relname);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive AND p.polcmd IN ('w', '*')
                   AND (p.polroles = '{0}' OR p.polroles @> ARRAY['authenticated'::regrole::oid])) THEN
      EXECUTE format('REVOKE UPDATE ON public.%I FROM authenticated', r.relname);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive AND p.polcmd IN ('d', '*')
                   AND (p.polroles = '{0}' OR p.polroles @> ARRAY['authenticated'::regrole::oid])) THEN
      EXECUTE format('REVOKE DELETE ON public.%I FROM authenticated', r.relname);
    END IF;
  END LOOP;
END $$;

-- tables and functions made later start closed
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
