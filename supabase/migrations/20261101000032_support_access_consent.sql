-- Zypher support reaches a shop's data only while the shop's owner allows it.
--   * `support_access` holds one row per shop that has switched Zypher support on. No row = no access.
--   * A `support` login gets no shop and no role (so every rule and workflow function refuses it) unless its shop has a row.
--   * Only a real owner switches it, through set_support_access(). A support login acts as owner but cannot switch it.
--   * Every switch is written to audit_log (who, when, on or off). No time limit: it stays on until the owner turns it off.
-- Backward compatible: owners, managers and staff are unaffected; existing support logins lose access until an owner allows it.

CREATE TABLE public.support_access (
  shop_id     uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  granted_by  uuid NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_access_read ON public.support_access FOR SELECT
  USING (shop_id = (SELECT public.current_shop_id()));
-- the hosted project does not grant new tables by default; writes only go through set_support_access()
REVOKE ALL ON public.support_access FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_access TO authenticated;
GRANT ALL ON public.support_access TO service_role;

-- 017's versions plus one rule: a support login needs its shop's consent
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p.shop_id
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active AND p.role <> 'super_admin'
    AND (p.role <> 'support' OR (public._mfa_ok() AND EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = p.shop_id)))
    AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'support' THEN 'owner' ELSE p.role END FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role IN ('super_admin', 'support') IS NOT TRUE OR public._mfa_ok())
    AND (p.role <> 'support' OR EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = p.shop_id))
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role IN ('owner', 'support') OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

-- the sign-in screen asks this to tell a support login "the owner has not allowed access" instead of "deactivated"
CREATE OR REPLACE FUNCTION public.support_waiting_for_consent()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active AND p.role = 'support'
                   AND NOT EXISTS (SELECT 1 FROM public.support_access a WHERE a.shop_id = p.shop_id));
$$;

CREATE OR REPLACE FUNCTION public.set_support_access(p_allow boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid;
  v_old jsonb;
BEGIN
  PERFORM public._require_role(ARRAY['owner']);
  IF public.is_support() THEN RAISE EXCEPTION 'Only the shop owner can change Zypher support access'; END IF;
  IF p_allow IS NULL THEN RAISE EXCEPTION 'Choose on or off'; END IF;
  v_shop := public.current_shop_id();
  PERFORM 1 FROM public.shops WHERE id = v_shop FOR UPDATE;  -- two owners switching at once: one waits
  SELECT to_jsonb(a) INTO v_old FROM public.support_access a WHERE a.shop_id = v_shop;
  IF (v_old IS NOT NULL) = p_allow THEN RETURN; END IF;     -- already in that state: nothing to record
  IF p_allow THEN
    INSERT INTO public.support_access (shop_id, granted_by) VALUES (v_shop, auth.uid());
  ELSE
    DELETE FROM public.support_access WHERE shop_id = v_shop;
  END IF;
  INSERT INTO public.audit_log (shop_id, performed_by, via, action, table_name, record_id, old_data, new_data)
  VALUES (v_shop, auth.uid(), 'app', CASE WHEN p_allow THEN 'support_access_on' ELSE 'support_access_off' END,
          'support_access', v_shop, v_old,
          CASE WHEN p_allow THEN (SELECT to_jsonb(a) FROM public.support_access a WHERE a.shop_id = v_shop) END);
END $$;

REVOKE ALL ON FUNCTION public.set_support_access(boolean), public.support_waiting_for_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_support_access(boolean), public.support_waiting_for_consent() TO authenticated;
NOTIFY pgrst, 'reload schema';
