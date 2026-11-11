-- Zypher admins give support with their own login: "Enter shop as support" from the console.
--   * `support_visits` holds the one shop each Zypher admin is visiting. Written only by enter_support() / leave_support().
--   * While visiting, and only while that shop's owner allows Zypher support (support_access, migration 032), the admin
--     works inside that ONE shop exactly like a per-shop support login: current_shop_id() is the shop, get_my_role() is
--     'owner', is_support() is true, so every rule that limits support (no money corrections, no consent switch,
--     no staff changes, no activity log) limits them too.
--   * The owner switching support off ends every visit at once: the checks read support_access on every request.
--   * Two-step sign-in is required (is_platform_admin() already needs it).
--   * Several admins may visit the same shop; each is logged under their own name.
-- Backward compatible: owners, managers, staff and per-shop support logins are unaffected; an admin who is not visiting
-- works exactly as before.

CREATE TABLE public.support_visits (
  admin_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  entered_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_visits_own ON public.support_visits FOR SELECT USING (admin_id = (SELECT auth.uid()));
REVOKE ALL ON public.support_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_visits TO authenticated;
GRANT ALL ON public.support_visits TO service_role;

-- the console shows whether each shop's owner allows support (only the shop id and since when)
CREATE POLICY support_access_zypher_read ON public.support_access FOR SELECT
  USING ((SELECT public.is_platform_admin()));

-- the shop a Zypher admin is visiting right now, or NULL (not visiting, owner said no, shop not active, no second step)
CREATE OR REPLACE FUNCTION public._support_visit_shop()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT v.shop_id
  FROM public.support_visits v
  JOIN public.profiles p ON p.id = v.admin_id
  WHERE v.admin_id = auth.uid() AND p.role = 'super_admin' AND p.is_active AND public._mfa_ok()
    AND EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = v.shop_id)
    AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v.shop_id AND s.status = 'active');
$$;

-- 032's version, plus the shop a Zypher admin is visiting
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT COALESCE(
    (SELECT p.shop_id
     FROM public.profiles p
     WHERE p.id = auth.uid() AND p.is_active AND p.role <> 'super_admin'
       AND (p.role <> 'support' OR (public._mfa_ok() AND EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = p.shop_id)))
       AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')),
    public._support_visit_shop());
$$;

-- 032's version; a visiting Zypher admin is 'owner' of that shop, like a support login
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'support' THEN 'owner'
              WHEN p.role = 'super_admin' AND public._support_visit_shop() IS NOT NULL THEN 'owner'
              ELSE p.role END
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role IN ('super_admin', 'support') IS NOT TRUE OR public._mfa_ok())
    AND (p.role <> 'support' OR EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = p.shop_id))
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role IN ('owner', 'support') OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

-- 017's version; a visiting Zypher admin is support, so every support limit applies
CREATE OR REPLACE FUNCTION public.is_support()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'support' AND is_active) AND public._mfa_ok())
         OR public._support_visit_shop() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.enter_support(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_old uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Only Zypher can do this'; END IF;
  IF p_shop_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id) THEN RAISE EXCEPTION 'Shop not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE id = p_shop_id AND status = 'active') THEN
    RAISE EXCEPTION 'This shop is not active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_access WHERE shop_id = p_shop_id) THEN
    RAISE EXCEPTION 'The shop owner has not allowed Zypher support';
  END IF;
  SELECT shop_id INTO v_old FROM public.support_visits WHERE admin_id = auth.uid() FOR UPDATE;
  IF v_old = p_shop_id THEN RETURN; END IF;
  IF v_old IS NOT NULL THEN
    PERFORM public._act_log(v_old, NULL, 'account', 'support_left', 2, NULL, NULL, NULL,
      'Left the shop (Zypher support)');
  END IF;
  INSERT INTO public.support_visits (admin_id, shop_id) VALUES (auth.uid(), p_shop_id)
  ON CONFLICT (admin_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, entered_at = now();
  PERFORM public._act_log(p_shop_id, NULL, 'account', 'support_entered', 2, NULL, NULL, NULL,
    'Entered the shop as Zypher support', true);
END $$;

-- ends the visit; safe to call when not visiting (sign-out calls it)
CREATE OR REPLACE FUNCTION public.leave_support()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  DELETE FROM public.support_visits WHERE admin_id = auth.uid() RETURNING shop_id INTO v_shop;
  IF v_shop IS NOT NULL THEN
    PERFORM public._act_log(v_shop, NULL, 'account', 'support_left', 2, NULL, NULL, NULL,
      'Left the shop (Zypher support)');
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._support_visit_shop() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enter_support(uuid), public.leave_support() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enter_support(uuid), public.leave_support() TO authenticated;
NOTIFY pgrst, 'reload schema';
