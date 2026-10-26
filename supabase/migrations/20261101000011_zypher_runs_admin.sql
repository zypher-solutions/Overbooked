-- Branches and staff are set up by Zypher, not by the shop: the owner runs the shop (bookings, products,
-- money), Zypher's team opens the shop from the console to add branches, invite people and change roles.
-- Before this, owners could do all of it themselves.

-- branches: everyone in the shop still reads them; only Zypher writes
DROP POLICY branches_write ON public.branches;
CREATE POLICY branches_write ON public.branches FOR ALL
  USING ((SELECT public.get_my_role()) = 'super_admin')
  WITH CHECK ((SELECT public.get_my_role()) = 'super_admin');

-- open invites are Zypher's to see
DROP POLICY staff_invites_read ON public.staff_invites;
CREATE POLICY staff_invites_read ON public.staff_invites FOR SELECT
  USING ((SELECT public.get_my_role()) = 'super_admin');

CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text, last_sign_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
BEGIN
  PERFORM public._require_role(ARRAY['super_admin']);
  RETURN QUERY SELECT u.id, u.email::text, u.last_sign_in_at
  FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE p.shop_id = public.current_shop_id();
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_status(p_user_id uuid, p_is_active boolean, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin']);
  v_shop := public.current_shop_id();
  IF p_is_active IS NULL OR p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff') THEN
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
         branch_id = CASE WHEN p_role = 'owner' THEN NULL ELSE branch_id END
  WHERE id = p_user_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE shop_id = v_shop AND role = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_staff_branch(p_user_id uuid, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  PERFORM public._require_role(ARRAY['super_admin']);
  v_shop := public.current_shop_id();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Staff member not found in this shop';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = v_shop) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  UPDATE public.profiles SET branch_id = p_branch_id WHERE id = p_user_id;
END $$;

NOTIFY pgrst, 'reload schema';
