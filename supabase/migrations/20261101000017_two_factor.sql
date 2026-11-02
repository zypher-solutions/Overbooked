-- Two-factor sign-in for Zypher admins and Zypher support logins (the accounts that can reach many shops or customer data).
-- When `platform_settings.require_mfa` is true (the default), these roles do nothing until the session is aal2, i.e. the person
-- also entered a code from their authenticator app. Until then the database treats them as having no role and no shop.
-- Nobody can switch it off from the console: the column is not writable by anyone who signs in.
ALTER TABLE public.platform_settings ADD COLUMN require_mfa boolean NOT NULL DEFAULT true;

REVOKE UPDATE ON public.platform_settings FROM authenticated;
GRANT UPDATE (company_name, address, gstin, phone, email, bank_details, auto_pause_after_days, updated_at) ON public.platform_settings TO authenticated;

-- true when this session may act as a privileged account: no rule asks for 2FA, or the session passed it
CREATE OR REPLACE FUNCTION public._mfa_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT NOT COALESCE((SELECT require_mfa FROM public.platform_settings WHERE id = 1), true)
         OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- the sign-in screens ask this: must this person still enter a code (or set up the app) before going on?
CREATE OR REPLACE FUNCTION public.mfa_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_active AND role IN ('super_admin', 'support'))
         AND NOT public._mfa_ok();
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active) AND public._mfa_ok();
$$;

CREATE OR REPLACE FUNCTION public.is_support()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'support' AND is_active) AND public._mfa_ok();
$$;

CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p.shop_id
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active AND p.role <> 'super_admin'
    AND (p.role <> 'support' OR public._mfa_ok())
    AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.setup_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'super_admin' THEN (CASE WHEN public._mfa_ok() THEN p.active_shop_id END) ELSE public.current_shop_id() END
  FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT CASE WHEN p.role = 'support' THEN 'owner' ELSE p.role END FROM public.profiles p
  WHERE p.id = auth.uid() AND p.is_active
    AND (p.role IN ('super_admin', 'support') IS NOT TRUE OR public._mfa_ok())
    AND (p.role = 'super_admin'
         OR (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p.shop_id AND s.status = 'active')
             AND (p.role IN ('owner', 'support') OR p.branch_id IS NULL
                  OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p.branch_id AND b.is_active))));
$$;

REVOKE ALL ON FUNCTION public._mfa_ok(), public.mfa_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mfa_ok(), public.mfa_required() TO authenticated;
NOTIFY pgrst, 'reload schema';
