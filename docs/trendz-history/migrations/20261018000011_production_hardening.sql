-- STATUS: APPLIED (live, 2026-10-18, verified: is_active default false, trigger fns not executable by anon, advisors re-checked)
-- Production hardening from the 2026-10-18 live DB review (Supabase advisors + manual policy review).
-- Backward compatible: no column, table or RPC signature changes; no data rows touched.
--   SEC-1 New auth users got an ACTIVE 'staff' profile (profiles.role default 'staff', is_active default true).
--         With public sign-up on, anyone holding the public anon key could sign up and read every customer
--         (read_customers = get_my_role() IS NOT NULL). New profiles now start inactive; a super_admin
--         activates them (and sets role/branch) the same way role/branch are set today.
--   SEC-2 Trigger functions (several SECURITY DEFINER) were executable by anon/authenticated via /rest/v1/rpc.
--         Triggers do not need EXECUTE at fire time, so revoking it changes nothing for the app.
--   SEC-3 Functions with a mutable search_path get a fixed one.
--   PERF  Drop duplicate rental_items SELECT policy (ritem_read already covers it, with a role check),
--         cache auth.uid() in read_own_profile, index foreign keys used by the app's joins.
-- Verify after applying: get_advisors(security) shows no function_search_path_mutable / anon_security_definer
-- warnings; log in as each test role and open Bookings, Rentals, Dashboard.
BEGIN;

-- SEC-1
ALTER TABLE public.profiles ALTER COLUMN is_active SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  -- inactive until a super_admin activates the account: sign-up alone grants no data access
  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    false
  );
  RETURN NEW;
END;
$function$;

-- SEC-2
REVOKE EXECUTE ON FUNCTION
  public.handle_new_user(),
  public.audit_record_delete(),
  public.ledger_on_booking(),
  public.ledger_on_payment(),
  public.ledger_on_rental_return(),
  public.assign_booking_reference(),
  public.block_direct_record_change(),
  public.block_inactive_product_booking(),
  public.guard_booking_direct_update(),
  public.guard_inventory_direct_update(),
  public.guard_profile_direct_update(),
  public.guard_rental_direct_update(),
  public.generate_rental_token(),
  public.set_booking_updated_at(),
  public.update_updated_at(),
  public.deduct_stock_on_rental(),
  public.restore_stock_on_return()
FROM PUBLIC, anon, authenticated;

-- SEC-3
ALTER FUNCTION public.check_availability(uuid, uuid, date, date, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_eligible_physical_units(uuid, uuid, date, date, integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_booking_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.deduct_stock_on_rental() SET search_path = public, pg_catalog;
ALTER FUNCTION public.restore_stock_on_return() SET search_path = public, pg_catalog;
ALTER FUNCTION public.return_rental_atomic(uuid, jsonb, date) SET search_path = public, pg_catalog;

-- PERF
DROP POLICY IF EXISTS read_rental_items ON public.rental_items;

DROP POLICY IF EXISTS read_own_profile ON public.profiles;
CREATE POLICY read_own_profile ON public.profiles FOR SELECT
  USING (id = (SELECT auth.uid()) OR get_my_role() = ANY (ARRAY['super_admin'::text, 'owner'::text]));

CREATE INDEX IF NOT EXISTS idx_payments_rental_id ON public.payments (rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_items_rental_id ON public.rental_items (rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_items_variation_id ON public.rental_items (variation_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_branch_id ON public.inventory_items (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_product_id ON public.inventory_items (product_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_product_id ON public.booking_items (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variations_product_id ON public.product_variations (product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_variation_id ON public.product_stock (variation_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products (category_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_branch_id ON public.ledger_entries (branch_id);

COMMIT;
