-- Login devices and the shop's master password (like Rentopus's "Login User Device").
--   * Every browser keeps a random device key (localStorage). On sign-in and when the app opens it calls register_device(),
--     which records the device for that person (name like "Windows Chrome, desktop", first and last use) and says whether
--     it may be used. New devices are allowed; the owner can block one in Admin > Devices, and the app then signs it out.
--     shortcut: the key lives in the browser, so clearing site data makes a new (allowed) device; blocking stops a lost
--     or old phone, not a determined person. Upgrade to "owner approves new devices" if shops need that.
--   * The master password is one per shop, set by the owner in Settings, stored only as a bcrypt hash in a table no
--     signed-in person can read. Changing it needs the current one. Switching a device on or off needs it.
--     Other features (shop settings, ...) can call _check_master_password() later.
--   * Both are logged in the owner's activity log (blocking and master-password changes are important).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.login_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_key   text NOT NULL CHECK (length(device_key) BETWEEN 8 AND 64),
  device_name  text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 120),
  is_active    boolean NOT NULL DEFAULT true,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  changed_by   uuid REFERENCES public.profiles(id),
  changed_at   timestamptz,
  UNIQUE (user_id, device_key)
);
CREATE INDEX idx_login_devices_shop ON public.login_devices (shop_id, last_seen DESC);
ALTER TABLE public.login_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_isolation ON public.login_devices AS RESTRICTIVE FOR ALL
  USING (shop_id = (SELECT public.current_shop_id())) WITH CHECK (shop_id = (SELECT public.current_shop_id()));
-- like the activity log: the owner only, not Zypher support
CREATE POLICY login_devices_owner_read ON public.login_devices FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'owner' AND NOT (SELECT public.is_support()));
REVOKE ALL ON public.login_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.login_devices TO authenticated;
GRANT ALL ON public.login_devices TO service_role;

-- no grants to anon or authenticated: only the functions below read it
CREATE TABLE public.shop_master_passwords (
  shop_id     uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  hash        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.profiles(id)
);
ALTER TABLE public.shop_master_passwords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_master_passwords FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shop_master_passwords TO service_role;

-- ------------------------------------------------------------------------------
-- master password
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_master_password()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.shop_master_passwords WHERE shop_id = public.current_shop_id());
$$;

-- raises unless p matches the current shop's master password (for other functions to call)
CREATE OR REPLACE FUNCTION public._check_master_password(p text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT hash INTO v_hash FROM public.shop_master_passwords WHERE shop_id = public.current_shop_id();
  IF v_hash IS NULL THEN RAISE EXCEPTION 'Set a master password first, in Settings'; END IF;
  IF p IS NULL OR extensions.crypt(p, v_hash) <> v_hash THEN RAISE EXCEPTION 'Wrong master password'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_master_password(p_new text, p_current text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_had boolean;
BEGIN
  IF v_shop IS NULL OR public.get_my_role() IS DISTINCT FROM 'owner' OR public.is_support() THEN
    RAISE EXCEPTION 'Only the shop owner can set the master password';
  END IF;
  IF p_new IS NULL OR length(p_new) < 6 OR length(p_new) > 72 THEN
    RAISE EXCEPTION 'The master password is 6 to 72 characters';
  END IF;
  v_had := public.has_master_password();
  IF v_had THEN PERFORM public._check_master_password(p_current); END IF;
  INSERT INTO public.shop_master_passwords (shop_id, hash, updated_at, updated_by)
  VALUES (v_shop, extensions.crypt(p_new, extensions.gen_salt('bf', 10)), now(), auth.uid())
  ON CONFLICT (shop_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now(), updated_by = auth.uid();
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password', 2, NULL, NULL, NULL,
    CASE WHEN v_had THEN 'Changed the master password' ELSE 'Set the master password' END, true);
END $$;

-- ------------------------------------------------------------------------------
-- devices
-- ------------------------------------------------------------------------------
-- records this browser for the signed-in person; true = it may be used. Zypher staff outside a shop are not recorded.
CREATE OR REPLACE FUNCTION public.register_device(p_key text, p_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_active boolean;
BEGIN
  IF auth.uid() IS NULL OR v_shop IS NULL OR public.is_support() THEN RETURN true; END IF;
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 64 THEN RAISE EXCEPTION 'Unknown device'; END IF;
  INSERT INTO public.login_devices (shop_id, user_id, device_key, device_name)
  VALUES (v_shop, auth.uid(), p_key, left(COALESCE(NULLIF(btrim(p_name), ''), 'Unknown device'), 120))
  ON CONFLICT (user_id, device_key) DO UPDATE SET last_seen = now(), device_name = EXCLUDED.device_name
  RETURNING is_active INTO v_active;
  RETURN v_active;
END $$;

CREATE OR REPLACE FUNCTION public.set_device_active(p_id uuid, p_active boolean, p_master text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'owner' OR public.is_support() THEN
    RAISE EXCEPTION 'Only the shop owner can allow or block devices';
  END IF;
  PERFORM public._check_master_password(p_master);
  UPDATE public.login_devices SET is_active = p_active, changed_by = auth.uid(), changed_at = now()
  WHERE id = p_id AND shop_id = public.current_shop_id() AND is_active IS DISTINCT FROM p_active;
END $$;

-- activity log: a new device and allow/block; last_seen and name refreshes are not logged
CREATE OR REPLACE FUNCTION public._act_login_devices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_person text;
BEGIN
  SELECT full_name INTO v_person FROM public.profiles WHERE id = NEW.user_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public._act_log(NEW.shop_id, NULL, 'account', 'new_device', 2, 'device', NEW.id, NEW.device_name,
      format('Signed in on a new device (%s)', NEW.device_name));
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM public._act_log(NEW.shop_id, NULL, 'account', CASE WHEN NEW.is_active THEN 'device_allowed' ELSE 'device_blocked' END,
      2, 'device', NEW.id, NEW.device_name,
      format('%s %s''s device (%s)', CASE WHEN NEW.is_active THEN 'Allowed' ELSE 'Blocked' END, v_person, NEW.device_name), true);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_activity AFTER INSERT OR UPDATE OF is_active ON public.login_devices
  FOR EACH ROW EXECUTE FUNCTION public._act_login_devices();

REVOKE ALL ON FUNCTION public._check_master_password(text), public._act_login_devices() FROM PUBLIC, anon, authenticated, app_rpc;
REVOKE ALL ON FUNCTION public.has_master_password(), public.set_master_password(text, text),
  public.register_device(text, text), public.set_device_active(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_master_password(), public.set_master_password(text, text),
  public.register_device(text, text), public.set_device_active(uuid, boolean, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
