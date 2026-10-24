-- APPLIED to test project gztmmlhuuqbnsnjjcohq on 2026-10-22. NOT applied to production.
-- Branch lifecycle: a branch with any history can never be deleted, and a deactivated branch locks out its staff.

-- 1. Deleting a branch with staff must fail (was ON DELETE SET NULL). All other tables referencing
--    branches (product_stock, rentals, inventory_items, bookings, ledger_entries) already refuse the delete.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_branch_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;

-- 2. Derived lockout: staff of an inactive branch get no role and no branch, so every policy built on
--    get_my_role()/get_my_branch() denies them. Nothing is stored on the staff rows, so reactivating
--    the branch restores access. super_admin and owner are global and are not tied to a branch.
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.role FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE
    AND (p.role IN ('super_admin', 'owner') OR p.branch_id IS NULL
         OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active));
$function$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.branch_id FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE
    AND (p.role IN ('super_admin', 'owner') OR p.branch_id IS NULL
         OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active));
$function$;

-- 3. A branch can only be deactivated once its rentals are returned and its bookings are closed.
CREATE OR REPLACE FUNCTION public.guard_branch_deactivation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_open integer;
BEGIN
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    SELECT (SELECT count(*) FROM public.rentals WHERE branch_id = OLD.id AND status = 'out')
         + (SELECT count(*) FROM public.bookings WHERE branch_id = OLD.id AND status IN ('pending', 'confirmed'))
      INTO v_open;
    IF v_open > 0 THEN
      RAISE EXCEPTION 'This branch still has % open rental(s) or booking(s). Return or cancel them before deactivating.', v_open
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_branch_deactivation ON public.branches;
CREATE TRIGGER trg_guard_branch_deactivation
  BEFORE UPDATE OF is_active ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_deactivation();

NOTIFY pgrst, 'reload schema';
