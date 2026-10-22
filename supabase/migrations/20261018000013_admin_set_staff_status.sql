-- U-03: super_admin-only RPC to activate/deactivate staff and change their role.
-- Guards: caller must be an active super_admin; cannot change own role/status;
-- the change may never leave zero active super_admins.
CREATE OR REPLACE FUNCTION public.admin_set_staff_status(p_user_id uuid, p_is_active boolean, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_role text;
  v_caller_active boolean;
  v_remaining integer;
BEGIN
  SELECT role, is_active INTO v_caller_role, v_caller_active FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'super_admin' OR v_caller_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only super_admin can change staff status or role';
  END IF;

  IF p_is_active IS NULL OR p_role IS NULL OR p_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role or status';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role or active status';
  END IF;

  -- Lock all active super_admins so two concurrent changes cannot both pass the last-admin check.
  PERFORM 1 FROM public.profiles WHERE role = 'super_admin' AND is_active FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active, role = p_role WHERE id = p_user_id;

  SELECT count(*) INTO v_remaining FROM public.profiles WHERE role = 'super_admin' AND is_active;
  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'At least one active super_admin must remain';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_status(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_status(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
