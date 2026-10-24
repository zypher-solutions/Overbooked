-- Overbooked v2 — who may see and change what.
--
-- Three layers keep shops apart:
--   1. RESTRICTIVE policy shop_isolation on every business table: shop_id = current_shop_id().
--   2. Composite foreign keys (shop_id, x_id) -> x (shop_id, id) (in the table migrations).
--   3. Workflow functions are owned by app_rpc, which cannot skip these rules (no BYPASSRLS).
-- Rentals, their lines, reservations, charges, checks and payments have NO write policy for app users:
-- they change only through the workflow functions in 20261101000004_engine.sql.
-- Helpers are called as (SELECT fn()) so each runs once per query, not once per row.

-- ==============================================================================
-- app_rpc
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rpc') THEN
    CREATE ROLE app_rpc NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT app_rpc TO postgres;
GRANT authenticated TO app_rpc;           -- one way: app_rpc gets auth.uid() etc.; authenticated never gets app_rpc
GRANT USAGE, CREATE ON SCHEMA public TO app_rpc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rpc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rpc;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_rpc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rpc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_rpc;

-- ==============================================================================
-- Turn rules on everywhere
-- ==============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_templates', 'shops', 'branches', 'profiles', 'staff_invites', 'shop_payments',
    'shop_counters', 'audit_log', 'categories', 'products', 'product_variations', 'variation_rates', 'units',
    'set_items', 'add_ons', 'customers', 'customer_measurements', 'rentals', 'rental_lines', 'unit_reservations',
    'rental_add_ons', 'rental_charges', 'rental_checks', 'payments', 'appointments']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- shop isolation + app_rpc access on every shop table
  FOREACH t IN ARRAY ARRAY['branches', 'staff_invites', 'categories', 'products', 'product_variations', 'variation_rates',
    'units', 'set_items', 'add_ons', 'customers', 'customer_measurements', 'rentals', 'rental_lines',
    'unit_reservations', 'rental_add_ons', 'rental_charges', 'rental_checks', 'payments', 'appointments']
  LOOP
    EXECUTE format('CREATE POLICY shop_isolation ON public.%I AS RESTRICTIVE FOR ALL
                    USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()))', t);
    EXECUTE format('CREATE POLICY rpc_all ON public.%I FOR ALL TO app_rpc USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ==============================================================================
-- Platform
-- ==============================================================================
CREATE POLICY templates_read ON public.business_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY templates_admin ON public.business_templates FOR ALL
  USING ((SELECT public.is_platform_admin())) WITH CHECK ((SELECT public.is_platform_admin()));

CREATE POLICY shops_read ON public.shops FOR SELECT
  USING (id = (SELECT public.my_home_shop_id()) OR (SELECT public.is_platform_admin()));
CREATE POLICY shops_admin ON public.shops FOR ALL
  USING ((SELECT public.is_platform_admin())) WITH CHECK ((SELECT public.is_platform_admin()));
CREATE POLICY rpc_all ON public.shops FOR ALL TO app_rpc USING (true) WITH CHECK (true);

CREATE POLICY shop_payments_read ON public.shop_payments FOR SELECT
  USING ((SELECT public.is_platform_admin())
         OR (shop_id = (SELECT public.my_home_shop_id()) AND (SELECT public.get_my_role()) = 'owner'));
CREATE POLICY shop_payments_admin ON public.shop_payments FOR ALL
  USING ((SELECT public.is_platform_admin())) WITH CHECK ((SELECT public.is_platform_admin()));

CREATE POLICY profiles_read ON public.profiles FOR SELECT
  USING (id = (SELECT auth.uid()) OR shop_id = (SELECT public.current_shop_id()) OR (SELECT public.is_platform_admin()));
CREATE POLICY rpc_all ON public.profiles FOR ALL TO app_rpc USING (true) WITH CHECK (true);

CREATE POLICY staff_invites_read ON public.staff_invites FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner'));

CREATE POLICY audit_log_read ON public.audit_log FOR SELECT
  USING ((SELECT public.is_platform_admin()));
CREATE POLICY rpc_all ON public.audit_log FOR ALL TO app_rpc USING (true) WITH CHECK (true);

-- ==============================================================================
-- Shop setup: everyone in the shop reads; owners (and Zypher) manage branches; owners and managers the catalog
-- ==============================================================================
CREATE POLICY branches_read ON public.branches FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY branches_write ON public.branches FOR ALL
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin', 'owner'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'products', 'product_variations', 'variation_rates', 'set_items', 'add_ons']
  LOOP
    EXECUTE format('CREATE POLICY catalog_read ON public.%I FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY catalog_write ON public.%I FOR ALL
                    USING ((SELECT public.get_my_role()) IN (''super_admin'', ''owner'', ''manager''))
                    WITH CHECK ((SELECT public.get_my_role()) IN (''super_admin'', ''owner'', ''manager''))', t);
  END LOOP;
END $$;

-- units: everyone reads; owners anywhere, managers only in their branch
CREATE POLICY units_read ON public.units FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY units_write ON public.units FOR ALL
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) = 'manager' AND branch_id = (SELECT public.get_my_branch())))
  WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
              OR ((SELECT public.get_my_role()) = 'manager' AND branch_id = (SELECT public.get_my_branch())));

-- customers: everyone in the shop can find, add and update them (no deletes)
CREATE POLICY customers_read ON public.customers FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY customers_insert ON public.customers FOR INSERT WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY customers_update ON public.customers FOR UPDATE
  USING ((SELECT public.get_my_role()) IS NOT NULL) WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY measurements_read ON public.customer_measurements FOR SELECT USING ((SELECT public.get_my_role()) IS NOT NULL);
CREATE POLICY measurements_write ON public.customer_measurements FOR ALL
  USING ((SELECT public.get_my_role()) IS NOT NULL) WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);

-- ==============================================================================
-- Rentals: owners see all branches, managers and staff their own. Read-only for app users.
-- ==============================================================================
CREATE POLICY rentals_read ON public.rentals FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) IN ('manager', 'staff') AND branch_id = (SELECT public.get_my_branch())));

-- the child tables follow their rental (the subquery itself obeys rentals_read)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rental_lines', 'unit_reservations', 'rental_add_ons', 'rental_charges', 'rental_checks']
  LOOP
    EXECUTE format('CREATE POLICY rental_child_read ON public.%I FOR SELECT
                    USING (EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_id))', t);
  END LOOP;
END $$;

-- money: owners all, managers their branch, staff none
CREATE POLICY payments_read ON public.payments FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) = 'manager'
             AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_id)));

-- appointments: like rentals, but staff may also create and update them in their branch
CREATE POLICY appointments_read ON public.appointments FOR SELECT
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner') OR branch_id = (SELECT public.get_my_branch()));
CREATE POLICY appointments_write ON public.appointments FOR ALL
  USING ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
         OR ((SELECT public.get_my_role()) IS NOT NULL AND branch_id = (SELECT public.get_my_branch())))
  WITH CHECK ((SELECT public.get_my_role()) IN ('super_admin', 'owner')
              OR ((SELECT public.get_my_role()) IS NOT NULL AND branch_id = (SELECT public.get_my_branch())));

-- ==============================================================================
-- Storage: product photos (public links, written only into the shop's folder);
-- rental photos and ID scans (private, shop members only). Paths start with <shop id>/.
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('product_images', 'product_images', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('rental_photos', 'rental_photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY product_images_read ON storage.objects FOR SELECT USING (bucket_id = 'product_images');
CREATE POLICY product_images_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product_images'
              AND (storage.foldername(name))[1] = (SELECT public.current_shop_id())::text
              AND (SELECT public.get_my_role()) IN ('super_admin', 'owner', 'manager'));
CREATE POLICY product_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product_images'
         AND (storage.foldername(name))[1] = (SELECT public.current_shop_id())::text
         AND (SELECT public.get_my_role()) IN ('super_admin', 'owner', 'manager'));

CREATE POLICY rental_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rental_photos' AND (storage.foldername(name))[1] = (SELECT public.current_shop_id())::text);
CREATE POLICY rental_photos_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rental_photos' AND (storage.foldername(name))[1] = (SELECT public.current_shop_id())::text
              AND (SELECT public.get_my_role()) IS NOT NULL);

-- ==============================================================================
-- Live updates (the app subscribes per shop)
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rentals, public.payments, public.units, public.unit_reservations;
  END IF;
END $$;

-- ==============================================================================
-- Internal functions are not callable through the API
-- ==============================================================================
REVOKE EXECUTE ON FUNCTION public.next_shop_counter(uuid, text, text), public.handle_new_user(),
  public.enforce_branch_limit(), public.enforce_login_limit(), public.guard_branch_deactivation(),
  public.check_shop_business_types(), public.recompute_rental_money(uuid), public.trg_recompute_rental_money(),
  public.assign_rental_token(), public.audit_record_delete(), public.touch_updated_at()
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_home_shop_id(), public.is_platform_admin(), public.current_shop_id(),
  public.get_my_role(), public.get_my_branch(), public.shop_feature(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_home_shop_id(), public.is_platform_admin(), public.current_shop_id(),
  public.get_my_role(), public.get_my_branch(), public.shop_feature(uuid, text)
TO authenticated;
