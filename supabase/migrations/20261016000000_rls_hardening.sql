-- Migration: 20261016000000_rls_hardening.sql
-- QA_REPORT.md: S3 (confirmed from live pg_policies), S7 (RLS helpers), S15, S25, S26.
-- Verified against the live policy / function dump taken on 2026-10-15.

-- ==============================================================================
-- S3 (CRITICAL): policy "update_own_profile" lets any logged-in user UPDATE their own profile row,
-- every column. With no WITH CHECK, a staff member could set role = 'super_admin' on themselves.
-- The app never edits a profile as a normal user (only Staff Management, which is super_admin and
-- covered by the "super_admin_profiles" ALL policy), so the policy is simply removed.
-- ==============================================================================
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;

-- Defense in depth: even if a similar policy is re-added, only a super_admin may change
-- role, branch or active status, or re-key a profile.
CREATE OR REPLACE FUNCTION public.guard_profile_direct_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND public.get_my_role() IS DISTINCT FROM 'super_admin'
     AND (
          NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
     )
  THEN
    RAISE EXCEPTION 'Only a super_admin can change a profile role, branch or active status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_direct_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_direct_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_direct_update();

-- ==============================================================================
-- S7 at the RLS level: every policy uses get_my_role() / get_my_branch(), which ignored is_active,
-- so a deactivated user kept full table access through the API. Inactive users now resolve to NULL
-- (no role, no branch) and every policy denies them. Also pins search_path (SECURITY DEFINER).
-- Signatures are unchanged, so the existing policies keep working.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active IS TRUE;
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid() AND is_active IS TRUE;
$$;

-- ==============================================================================
-- S15: functions anonymous (not logged in) callers could still execute
-- ==============================================================================
REVOKE ALL ON FUNCTION public.check_availability(uuid, uuid, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_availability(uuid, uuid, date, date, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_eligible_physical_units(uuid, uuid, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_eligible_physical_units(uuid, uuid, date, date, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_all_inventory_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_inventory_stats() TO authenticated;

-- ==============================================================================
-- S25: legacy functions that exist in the live database but in no migration and are not called
-- by the app or any QA script. return_rental_atomic is the pre-hardening return workflow and was
-- executable by anonymous callers. All overloads are revoked (nothing is dropped, so this is reversible
-- with a GRANT). generate_rental_token is only closed to anonymous callers.
-- ==============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('return_rental_atomic', 'generate_rental_token')
  LOOP
    IF r.proname = 'return_rental_atomic' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
