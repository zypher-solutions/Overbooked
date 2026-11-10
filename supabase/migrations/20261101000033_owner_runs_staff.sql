-- The shop's owner runs its people and branches; Zypher only sets a shop up until its owner takes over.
--   * The setup functions of 021 (people, invites, roles, branches) now also work for the shop's real owner, for their
--     own shop only. A Zypher support login is refused even though it acts as owner.
--   * Once the shop has a "live" owner (active, and has signed in at least once) Zypher may only touch Zypher support
--     logins there. Before that, Zypher sets the shop up as before (first owner, branches, staff).
--   * Login links: the owner gets a link for any of their people. Zypher gets a shown link only for support logins or
--     while the shop has no live owner; for an owner it must send the reset email to the owner's own address.
--   * The owner cannot create or edit Zypher support logins (only switch them off), nor make links for them.
-- Branches still show in the console: it reads the same table. Plan limits stay in the triggers of 000.

-- the shop has an owner who has taken over (Zypher's setup role ends there)
CREATE OR REPLACE FUNCTION public._shop_has_live_owner(p_shop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
                 WHERE p.shop_id = p_shop_id AND p.role = 'owner' AND p.is_active AND u.last_sign_in_at IS NOT NULL);
$$;

-- Zypher (any shop) or the real owner of this shop
CREATE OR REPLACE FUNCTION public._require_setup_shop(p_shop_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.is_platform_admin() THEN
    IF p_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
      RAISE EXCEPTION 'Shop not found';
    END IF;
    RETURN p_shop_id;
  END IF;
  IF public.get_my_role() = 'owner' AND NOT public.is_support() AND p_shop_id = public.current_shop_id() THEN
    RETURN p_shop_id;
  END IF;
  RAISE EXCEPTION 'Only Zypher or the shop owner can do this';
END $$;

-- 021's version plus who may change whom
CREATE OR REPLACE FUNCTION public.setup_set_person(p_shop_id uuid, p_user_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_old_role text;
  v_role text;
  v_active boolean;
  v_branch uuid;
  v_zypher boolean;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  v_zypher := public.is_platform_admin();
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own role or active status'; END IF;
  PERFORM 1 FROM public.profiles WHERE shop_id = p_shop_id AND role = 'owner' AND is_active FOR UPDATE;
  SELECT role, is_active, branch_id INTO v_old_role, v_active, v_branch FROM public.profiles WHERE id = p_user_id AND shop_id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this shop'; END IF;
  v_role := COALESCE(p ->> 'role', v_old_role);
  v_active := COALESCE((p ->> 'is_active')::boolean, v_active);
  IF p ? 'branch_id' THEN v_branch := NULLIF(p ->> 'branch_id', '')::uuid; END IF;
  IF v_role NOT IN ('owner', 'manager', 'staff', 'support') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF v_zypher AND public._shop_has_live_owner(p_shop_id) AND (v_old_role <> 'support' OR v_role <> 'support') THEN
    RAISE EXCEPTION 'This shop''s owner manages its staff now';
  END IF;
  IF NOT v_zypher AND (v_old_role = 'support' OR v_role = 'support')
     AND (v_role IS DISTINCT FROM v_old_role OR p ? 'branch_id') THEN
    RAISE EXCEPTION 'A Zypher support login can only be switched off or on here';
  END IF;
  IF v_role IN ('owner', 'support') THEN v_branch := NULL; END IF;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch AND shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  UPDATE public.profiles SET role = v_role, is_active = v_active, branch_id = v_branch WHERE id = p_user_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE shop_id = p_shop_id AND role = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END $$;

-- 021's version plus who may invite whom
CREATE OR REPLACE FUNCTION public.setup_check_invite(p_shop_id uuid, p_role text, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_limit integer;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff', 'support') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF public.is_platform_admin() THEN
    IF p_role <> 'support' AND public._shop_has_live_owner(p_shop_id) THEN
      RAISE EXCEPTION 'This shop''s owner adds its staff now';
    END IF;
  ELSIF p_role = 'support' THEN
    RAISE EXCEPTION 'Only Zypher creates a Zypher support login';
  END IF;
  IF p_role IN ('manager', 'staff') AND p_branch_id IS NULL THEN RAISE EXCEPTION 'Managers and staff need a branch'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  IF p_role <> 'support' THEN
    SELECT plan INTO v_plan FROM public.shops WHERE id = p_shop_id;
    v_limit := public.plan_limit(v_plan, 'logins');
    IF v_limit IS NOT NULL
       AND (SELECT count(*) FROM public.profiles WHERE shop_id = p_shop_id AND is_active AND role <> 'support') >= v_limit THEN
      RAISE EXCEPTION 'The % plan allows % staff logins. Contact Zypher to upgrade the plan', initcap(v_plan), v_limit;
    END IF;
  END IF;
END $$;

-- How a login link for this person may be given: 'link' (shown to the caller, to share) or 'email' (sent by Supabase to
-- the person's own address, never shown). Refuses everything else. Replaces 021's version, which returned the role.
DROP FUNCTION public.setup_check_person(uuid, uuid);
CREATE FUNCTION public.setup_check_person(p_shop_id uuid, p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Use Change password for your own account'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user_id AND shop_id = p_shop_id AND role <> 'super_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this shop'; END IF;
  IF NOT public.is_platform_admin() THEN
    IF v_role = 'support' THEN RAISE EXCEPTION 'Zypher manages its support login'; END IF;
    RETURN 'link';
  END IF;
  IF v_role = 'support' OR NOT public._shop_has_live_owner(p_shop_id) THEN RETURN 'link'; END IF;
  IF v_role = 'owner' THEN RETURN 'email'; END IF;
  RAISE EXCEPTION 'This shop''s owner manages its staff now';
END $$;

-- 016's version: the owner's setup changes are logged too (Zypher's console reads these rows)
CREATE OR REPLACE FUNCTION public.log_setup_event(p_shop_id uuid, p_action text, p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public.is_platform_admin() THEN
    IF p_shop_id IS NULL THEN RAISE EXCEPTION 'Only Zypher can do this'; END IF;
    PERFORM public._require_setup_shop(p_shop_id);
  END IF;
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, new_data)
  VALUES (p_shop_id, auth.uid(), 'app', 'setup_' || left(regexp_replace(p_action, '[^a-z_]', '', 'g'), 40), 'profiles', p_detail);
END $$;

REVOKE ALL ON FUNCTION public._shop_has_live_owner(uuid) FROM PUBLIC, anon, authenticated;  -- only used inside the functions above
REVOKE ALL ON FUNCTION public.setup_check_person(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_check_person(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
