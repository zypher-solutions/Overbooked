-- Zypher's console is for SETUP and BILLING only; it never reads or writes a shop's business data.
--
--   * `current_shop_id()` is NULL for Zypher admins, so the restrictive shop_isolation rule hides every business row
--     (customers, rentals, payments, products, units, photos...) and every workflow function refuses them.
--   * `setup_shop_id()` is the shop a Zypher admin has opened for SETUP. Only branches and staff invites are scoped by it.
--   * A per-shop Zypher login (role `support`) works inside ONE shop like its owner, minus destructive corrections.
--     One stolen credential exposes one shop, not all of them.
--   * Billing, shops and business types can no longer be edited with free-form table writes, only through functions.
--   * Setup changes are written to audit_log.
-- Backward compatible: shop owners, managers and staff are unaffected.

-- ---- who is calling -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_support()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'support' AND is_active);
$$;

-- business data: Zypher admins have no shop here, ever
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p.shop_id
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active AND p.role <> 'super_admin'
    AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active');
$$;

-- setup: Zypher admins -> the shop they opened for setup; everyone else -> their own shop
CREATE OR REPLACE FUNCTION public.setup_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'super_admin' THEN p.active_shop_id ELSE public.current_shop_id() END
  FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active;
$$;

-- a support login has the rights of the shop's owner (its destructive powers are removed below)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'support' THEN 'owner' ELSE p.role END FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role IN ('owner', 'support') OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

CREATE OR REPLACE FUNCTION public._require_setup()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Only Zypher can do this'; END IF;
  v_shop := public.setup_shop_id();
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Open a shop for setup first'; END IF;
  RETURN v_shop;
END $$;

-- ---- the role itself ------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'owner', 'manager', 'staff', 'support'));
ALTER TABLE public.staff_invites DROP CONSTRAINT IF EXISTS staff_invites_role_check;
ALTER TABLE public.staff_invites ADD CONSTRAINT staff_invites_role_check CHECK (role IN ('owner', 'manager', 'staff', 'support'));

-- support logins are Zypher's, not the shop's: they do not use up the shop's plan limit
CREATE OR REPLACE FUNCTION public.enforce_login_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_limit integer;
BEGIN
  IF NEW.is_active IS NOT TRUE OR NEW.shop_id IS NULL OR NEW.role = 'support'
     OR (TG_OP = 'UPDATE' AND OLD.is_active AND OLD.shop_id IS NOT DISTINCT FROM NEW.shop_id AND OLD.role = NEW.role) THEN
    RETURN NEW;
  END IF;
  SELECT plan INTO v_plan FROM public.shops WHERE id = NEW.shop_id FOR UPDATE;
  v_limit := public.plan_limit(v_plan, 'logins');
  IF v_limit IS NOT NULL
     AND (SELECT count(*) FROM public.profiles WHERE shop_id = NEW.shop_id AND is_active AND role <> 'support' AND id <> NEW.id) >= v_limit THEN
    RAISE EXCEPTION 'Your % plan allows % staff logins. Contact Zypher to upgrade.', initcap(v_plan), v_limit;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_enforce_login_limit ON public.profiles;
CREATE TRIGGER trg_enforce_login_limit BEFORE INSERT OR UPDATE OF is_active, shop_id, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_login_limit();

-- ---- no destructive powers for a support login ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._require_correction(p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['owner']);
  IF public.is_support() THEN
    RAISE EXCEPTION 'A Zypher support login cannot change or delete money records';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason (at least 3 characters) is required';
  END IF;
  PERFORM set_config('app.audit_reason', btrim(p_reason), true);
  RETURN auth.uid();
END $$;

-- ---- setup functions use the setup shop ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text, last_sign_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_setup();
BEGIN
  RETURN QUERY SELECT u.id, u.email::text, u.last_sign_in_at
  FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE p.shop_id = v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_status(p_user_id uuid, p_is_active boolean, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_setup();
BEGIN
  IF p_is_active IS NULL OR p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff', 'support') THEN
    RAISE EXCEPTION 'Invalid role or status';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or active status';
  END IF;
  PERFORM 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;
  UPDATE public.profiles SET is_active = p_is_active, role = p_role,
         branch_id = CASE WHEN p_role IN ('owner', 'support') THEN NULL ELSE branch_id END
  WHERE id = p_user_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_staff_branch(p_user_id uuid, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_setup();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  UPDATE public.profiles SET branch_id = p_branch_id WHERE id = p_user_id;
END $$;

-- counts only, for Zypher's Stock Locations: how many pieces each branch holds, never which bookings or customers
CREATE OR REPLACE FUNCTION public.setup_branch_stock()
RETURNS TABLE (branch_id uuid, pieces bigint, available bigint, maintenance bigint, lost bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_setup();
BEGIN
  RETURN QUERY
    SELECT b.id, count(u.id), count(u.id) FILTER (WHERE u.status = 'available'),
           count(u.id) FILTER (WHERE u.status = 'maintenance'), count(u.id) FILTER (WHERE u.status = 'lost')
    FROM public.branches b LEFT JOIN public.units u ON u.branch_id = b.id AND u.shop_id = v_shop
    WHERE b.shop_id = v_shop GROUP BY b.id;
END $$;

-- Zypher's open shop is a setup scope only; opening and closing it is logged
CREATE OR REPLACE FUNCTION public.switch_shop(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  IF p_shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  UPDATE public.profiles SET active_shop_id = p_shop_id WHERE id = auth.uid();
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id)
  VALUES (p_shop_id, auth.uid(), 'app', CASE WHEN p_shop_id IS NULL THEN 'setup_closed' ELSE 'setup_opened' END, 'shops', p_shop_id);
END $$;

-- server actions that use the service key (invite links, recovery links, promotions) record themselves here
CREATE OR REPLACE FUNCTION public.log_setup_event(p_shop_id uuid, p_action text, p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Only Zypher can do this'; END IF;
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, new_data)
  VALUES (p_shop_id, auth.uid(), 'app', 'setup_' || left(regexp_replace(p_action, '[^a-z_]', '', 'g'), 40), 'profiles', p_detail);
END $$;

-- ---- rules ---------------------------------------------------------------------------------------------------------
-- branches and invites are the two shop tables Zypher's setup scope reaches
DROP POLICY shop_isolation ON public.branches;
CREATE POLICY shop_isolation ON public.branches AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.setup_shop_id())) WITH CHECK (shop_id = (SELECT public.setup_shop_id()));
DROP POLICY shop_isolation ON public.staff_invites;
CREATE POLICY shop_isolation ON public.staff_invites AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.setup_shop_id())) WITH CHECK (shop_id = (SELECT public.setup_shop_id()));

-- a Zypher admin sees the people of the shop opened for setup and other Zypher staff, not every shop's people
DROP POLICY profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT
  USING (id = (SELECT auth.uid()) OR shop_id = (SELECT public.current_shop_id())
         OR ((SELECT public.is_platform_admin()) AND (shop_id IS NULL OR shop_id = (SELECT public.setup_shop_id()))));

-- billing, shops and business types change through functions only (update_shop, record_shop_payment...), which log
DROP POLICY IF EXISTS shops_admin ON public.shops;
DROP POLICY IF EXISTS templates_admin ON public.business_templates;
DROP POLICY IF EXISTS shop_payments_admin ON public.shop_payments;

-- ---- audit of setup changes ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_audit_setup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_row jsonb := COALESCE(v_new, v_old);
BEGIN
  -- only people signed in are logged here; SQL run by the database owner is not a user action
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, reason, old_data, new_data)
  VALUES (CASE TG_TABLE_NAME WHEN 'shops' THEN (v_row ->> 'id')::uuid WHEN 'business_templates' THEN NULL ELSE NULLIF(v_row ->> 'shop_id', '')::uuid END,
          auth.uid(), 'app', 'setup_' || lower(TG_OP), TG_TABLE_NAME,
          CASE WHEN (v_row ->> 'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_row ->> 'id')::uuid END,
          current_setting('app.audit_reason', true), v_old, v_new);
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'staff_invites', 'shops', 'categories', 'add_ons', 'business_templates', 'shop_payments', 'platform_settings'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_setup AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_audit_setup()', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_audit_setup AFTER INSERT OR DELETE OR UPDATE OF role, is_active, shop_id, branch_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_setup();

-- ---- ownership and grants --------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_support(), public.setup_shop_id(), public._require_setup(), public.setup_branch_stock(),
  public.log_setup_event(uuid, text, jsonb), public.trg_audit_setup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_support(), public.setup_shop_id(), public._require_setup(), public.setup_branch_stock(),
  public.log_setup_event(uuid, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
