-- Setup (branches, stock counts, staff) happens inside the Zypher console, on each shop's own page.
-- There is no "open a shop" state any more: every setup function names the shop it acts on and checks the caller each time,
-- so two browser tabs can work on two shops and nothing is left switched on after sign-out.
--
-- Zypher still reaches no business table: branches and staff_invites go back to the plain shop rule (current_shop_id(), which is
-- NULL for Zypher admins), so only these functions can touch them for Zypher. Every change is logged by trg_audit_setup.

-- ---- the guard every setup function starts with --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._require_setup_shop(p_shop_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  IF p_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;
  RETURN p_shop_id;
END $$;

-- ---- branches (a branch is also the shop's stock location; what it holds is the shop's own business, not Zypher's) -----
CREATE OR REPLACE FUNCTION public.setup_branches(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone, 'email', b.email,
             'is_active', b.is_active, 'created_at', b.created_at,
             'people', (SELECT count(*) FROM public.profiles p WHERE p.branch_id = b.id))
           ORDER BY b.created_at, b.name)
    FROM public.branches b WHERE b.shop_id = p_shop_id), '[]'::jsonb);
END $$;

-- p: name, address, phone, email, is_active. p_branch_id NULL creates a branch.
CREATE OR REPLACE FUNCTION public.setup_save_branch(p_shop_id uuid, p_branch_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_name text := btrim(COALESCE(p ->> 'name', ''));
  v_slug text;
  v_try integer := 1;
  v_id uuid := p_branch_id;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_branch_id IS NULL THEN
    IF v_name = '' THEN RAISE EXCEPTION 'The branch needs a name'; END IF;
    v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    IF v_slug = '' THEN v_slug := 'branch'; END IF;
    WHILE EXISTS (SELECT 1 FROM public.branches WHERE shop_id = p_shop_id AND slug = CASE WHEN v_try = 1 THEN v_slug ELSE v_slug || '-' || v_try END) LOOP
      v_try := v_try + 1;
    END LOOP;
    IF v_try > 1 THEN v_slug := v_slug || '-' || v_try; END IF;
    INSERT INTO public.branches (shop_id, name, slug, address, phone, email, is_active)
    VALUES (p_shop_id, v_name, v_slug, NULLIF(btrim(p ->> 'address'), ''), NULLIF(btrim(p ->> 'phone'), ''),
            NULLIF(btrim(p ->> 'email'), ''), COALESCE((p ->> 'is_active')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    IF p ? 'name' AND v_name = '' THEN RAISE EXCEPTION 'The branch needs a name'; END IF;
    UPDATE public.branches SET
      name = CASE WHEN p ? 'name' THEN v_name ELSE name END,
      address = CASE WHEN p ? 'address' THEN NULLIF(btrim(p ->> 'address'), '') ELSE address END,
      phone = CASE WHEN p ? 'phone' THEN NULLIF(btrim(p ->> 'phone'), '') ELSE phone END,
      email = CASE WHEN p ? 'email' THEN NULLIF(btrim(p ->> 'email'), '') ELSE email END,
      is_active = CASE WHEN p ? 'is_active' THEN (p ->> 'is_active')::boolean ELSE is_active END
    WHERE id = p_branch_id AND shop_id = p_shop_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found in this shop'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This shop already has a branch with that name';
END $$;

CREATE OR REPLACE FUNCTION public.setup_delete_branch(p_shop_id uuid, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE branch_id = p_branch_id) THEN
    RAISE EXCEPTION 'People are assigned to this branch. Move them first, or close the branch instead';
  END IF;
  DELETE FROM public.branches WHERE id = p_branch_id AND shop_id = p_shop_id;
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'This branch holds pieces or bookings and cannot be deleted. Close it instead';
END $$;

-- ---- staff ------------------------------------------------------------------------------------------------------------
-- everyone with a login in the shop, with sign-in state (never signed in = invite still pending)
CREATE OR REPLACE FUNCTION public.setup_people(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'full_name', p.full_name, 'role', p.role, 'branch_id', p.branch_id, 'branch', b.name,
             'is_active', p.is_active, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at,
             'pending', u.last_sign_in_at IS NULL)
           ORDER BY (p.role = 'owner') DESC, p.role, p.full_name)
    FROM public.profiles p JOIN auth.users u ON u.id = p.id LEFT JOIN public.branches b ON b.id = p.branch_id
    WHERE p.shop_id = p_shop_id), '[]'::jsonb);
END $$;

-- role, active and branch of one person in one change (the owner rule: at least one active owner stays)
CREATE OR REPLACE FUNCTION public.setup_set_person(p_shop_id uuid, p_user_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text;
  v_active boolean;
  v_branch uuid;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own role or active status'; END IF;
  PERFORM 1 FROM public.profiles WHERE shop_id = p_shop_id AND role = 'owner' AND is_active FOR UPDATE;
  SELECT role, is_active, branch_id INTO v_role, v_active, v_branch FROM public.profiles WHERE id = p_user_id AND shop_id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this shop'; END IF;
  v_role := COALESCE(p ->> 'role', v_role);
  v_active := COALESCE((p ->> 'is_active')::boolean, v_active);
  IF p ? 'branch_id' THEN v_branch := NULLIF(p ->> 'branch_id', '')::uuid; END IF;
  IF v_role NOT IN ('owner', 'manager', 'staff', 'support') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF v_role IN ('owner', 'support') THEN v_branch := NULL; END IF;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch AND shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  UPDATE public.profiles SET role = v_role, is_active = v_active, branch_id = v_branch WHERE id = p_user_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE shop_id = p_shop_id AND role = 'owner' AND is_active) THEN
    RAISE EXCEPTION 'At least one active owner must remain in the shop';
  END IF;
END $$;

-- Checks an invite before the server action creates the account: valid role, branch of this shop, plan login limit.
CREATE OR REPLACE FUNCTION public.setup_check_invite(p_shop_id uuid, p_role text, p_branch_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_plan text;
  v_limit integer;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_role IS NULL OR p_role NOT IN ('owner', 'manager', 'staff', 'support') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF p_role IN ('manager', 'staff') AND p_branch_id IS NULL THEN RAISE EXCEPTION 'Managers and staff need a branch'; END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'Branch not found in this shop';
  END IF;
  IF p_role <> 'support' THEN
    SELECT plan INTO v_plan FROM public.shops WHERE id = p_shop_id;
    v_limit := public.plan_limit(v_plan, 'logins');
    IF v_limit IS NOT NULL
       AND (SELECT count(*) FROM public.profiles WHERE shop_id = p_shop_id AND is_active AND role <> 'support') >= v_limit THEN
      RAISE EXCEPTION 'The % plan allows % staff logins. Upgrade the plan first', initcap(v_plan), v_limit;
    END IF;
  END IF;
END $$;

-- Who a recovery link may be made for: a login of this shop, never another Zypher admin. Returns the person's role.
CREATE OR REPLACE FUNCTION public.setup_check_person(p_shop_id uuid, p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_role text;
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Use Change password for your own account'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user_id AND shop_id = p_shop_id AND role <> 'super_admin';
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this shop'; END IF;
  RETURN v_role;
END $$;

-- ---- the old "open a shop" way is gone --------------------------------------------------------------------------------
DROP FUNCTION public.switch_shop(uuid);
DROP FUNCTION public.admin_set_staff_status(uuid, boolean, text);
DROP FUNCTION public.set_staff_branch(uuid, uuid);
DROP FUNCTION public.get_staff_emails();
DROP FUNCTION public.setup_branch_stock();

-- branches and invites follow the plain shop rule again: Zypher admins have no shop there
DROP POLICY shop_isolation ON public.branches;
CREATE POLICY shop_isolation ON public.branches AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
DROP POLICY shop_isolation ON public.staff_invites;
CREATE POLICY shop_isolation ON public.staff_invites AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));

-- a Zypher admin reads only Zypher's own people directly; a shop's people come through setup_people()
DROP POLICY profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT
  USING (id = (SELECT auth.uid()) OR shop_id = (SELECT public.current_shop_id())
         OR ((SELECT public.is_platform_admin()) AND shop_id IS NULL));

DROP FUNCTION public.setup_shop_id();
DROP FUNCTION public._require_setup();
ALTER TABLE public.profiles DROP COLUMN active_shop_id;

-- ---- grants ---------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._require_setup_shop(uuid), public.setup_branches(uuid), public.setup_save_branch(uuid, uuid, jsonb),
  public.setup_delete_branch(uuid, uuid), public.setup_people(uuid), public.setup_set_person(uuid, uuid, jsonb),
  public.setup_check_invite(uuid, text, uuid), public.setup_check_person(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._require_setup_shop(uuid), public.setup_branches(uuid), public.setup_save_branch(uuid, uuid, jsonb),
  public.setup_delete_branch(uuid, uuid), public.setup_people(uuid), public.setup_set_person(uuid, uuid, jsonb),
  public.setup_check_invite(uuid, text, uuid), public.setup_check_person(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- the shop page's branch list no longer carries what each branch holds (same function as before, without 'units' per branch)
CREATE OR REPLACE FUNCTION public.shop_detail(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_shop public.shops;
BEGIN
  PERFORM public._require_zypher();
  SELECT * INTO v_shop FROM public.shops WHERE id = p_shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shop not found';
  END IF;

  RETURN jsonb_build_object(
    'shop', to_jsonb(v_shop),
    'branches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'is_active', b.is_active,
                   'phone', b.phone, 'address', b.address) ORDER BY b.created_at), '[]')
                 FROM public.branches b WHERE b.shop_id = p_shop_id),
    'people', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role,
                 'branch', b.name, 'is_active', p.is_active, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at)
                 ORDER BY (p.role = 'owner') DESC, p.full_name), '[]')
               FROM public.profiles p JOIN auth.users u ON u.id = p.id LEFT JOIN public.branches b ON b.id = p.branch_id
               WHERE p.shop_id = p_shop_id),
    'invites', (SELECT COALESCE(jsonb_agg(jsonb_build_object('email', i.email, 'role', i.role, 'branch', b.name,
                  'created_at', i.created_at) ORDER BY i.created_at DESC), '[]')
                FROM public.staff_invites i LEFT JOIN public.branches b ON b.id = i.branch_id
                WHERE i.shop_id = p_shop_id AND i.accepted_at IS NULL),
    'usage', jsonb_build_object(
      'products', (SELECT count(*) FROM public.products WHERE shop_id = p_shop_id AND is_active),
      'units', (SELECT count(*) FROM public.units WHERE shop_id = p_shop_id AND status <> 'retired'),
      'customers', (SELECT count(*) FROM public.customers WHERE shop_id = p_shop_id),
      'rentals', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id),
      'rentals_30d', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id AND created_at > now() - interval '30 days'),
      'open_rentals', (SELECT count(*) FROM public.rentals WHERE shop_id = p_shop_id AND status IN ('reserved', 'active')),
      'last_rental_at', (SELECT max(created_at) FROM public.rentals WHERE shop_id = p_shop_id)),
    'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sp.id, 'receipt_no', sp.receipt_no, 'kind', sp.kind, 'amount', sp.amount, 'paid_on', sp.paid_on,
                   'period_to', sp.period_to, 'method', sp.method, 'note', sp.note) ORDER BY sp.paid_on DESC, sp.created_at DESC), '[]')
                 FROM public.shop_payments sp WHERE sp.shop_id = p_shop_id),
    'features', (SELECT COALESCE(jsonb_object_agg(f.key, public.shop_feature(p_shop_id, f.key)), '{}')
                 FROM (SELECT DISTINCT jsonb_object_keys(t.features) AS key FROM public.business_templates t
                       WHERE t.key = ANY (v_shop.business_types)) f));
END $$;
NOTIFY pgrst, 'reload schema';
