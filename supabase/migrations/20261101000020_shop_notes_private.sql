-- "Zypher notes (the shop never sees these)": until now a shop's own people could read them with a plain request for the shops row.
-- The notes column is no longer readable by signed-in people; Zypher reads it through shop_detail(), which runs as the database owner.
-- A column added to `shops` later must be granted to `authenticated` on purpose (the security tests check that only `notes` is closed).
REVOKE SELECT ON public.shops FROM authenticated;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shops' AND column_name <> 'notes';
  EXECUTE format('GRANT SELECT (%s) ON public.shops TO authenticated', cols);
END $$;

-- Zypher's audit view shows setup and billing changes only. The log also records money corrections (old and new amounts of bookings and
-- payments); that is shop data, so the console does not read it.
DROP POLICY audit_log_read ON public.audit_log;
CREATE POLICY audit_log_read ON public.audit_log FOR SELECT
  USING ((SELECT public.is_platform_admin())
         AND table_name IN ('shops', 'branches', 'profiles', 'staff_invites', 'categories', 'add_ons', 'business_templates', 'shop_payments', 'platform_settings'));
