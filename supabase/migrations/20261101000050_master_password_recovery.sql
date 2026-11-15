-- The master password only its owner can change (replaces 047's reset with the sign-in password).
--   * Someone with the owner's sign-in (a manager the owner lent it to) must not be able to reset it, so the only ways in
--     are the master password itself or one of the shop's recovery codes: 8 one-time codes shown once when it is set.
--     Losing both is Zypher support's job (a later migration). Codes are stored as bcrypt hashes, like the password.
--   * 5 wrong master passwords or recovery codes lock it for the shop for 15 minutes, logged as important. A wrong try
--     must be counted, so these functions return a result ('ok' | 'wrong' | 'locked') instead of raising: a raise would
--     roll the count back.
--   * New master passwords are 8 to 72 characters (existing shorter ones keep working).

DROP FUNCTION public.reset_master_password(text, text);
DROP FUNCTION public.set_master_password(text, text);
DROP FUNCTION public.set_device_active(uuid, boolean, text);
DROP FUNCTION public._check_master_password(text);

ALTER TABLE public.shop_master_passwords RENAME COLUMN reset_failures TO failures;
ALTER TABLE public.shop_master_passwords RENAME COLUMN reset_locked_until TO locked_until;

-- no grants to anon or authenticated: only the functions below read it
CREATE TABLE public.shop_master_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  hash        text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_master_recovery_codes_shop ON public.shop_master_recovery_codes (shop_id) WHERE used_at IS NULL;
ALTER TABLE public.shop_master_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_master_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shop_master_recovery_codes TO service_role;

CREATE OR REPLACE FUNCTION public._require_real_owner()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
BEGIN
  IF v_shop IS NULL OR public.get_my_role() IS DISTINCT FROM 'owner' OR public.is_support() THEN
    RAISE EXCEPTION 'Only the shop owner can do this';
  END IF;
  RETURN v_shop;
END $$;

-- one more wrong try: 'wrong', or 'locked' (15 minutes) on the 5th
CREATE OR REPLACE FUNCTION public._master_fail(p_shop uuid, p_what text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_fails int;
BEGIN
  UPDATE public.shop_master_passwords SET failures = failures + 1 WHERE shop_id = p_shop RETURNING failures INTO v_fails;
  IF v_fails >= 5 THEN
    UPDATE public.shop_master_passwords SET failures = 0, locked_until = now() + interval '15 minutes' WHERE shop_id = p_shop;
    PERFORM public._act_log(p_shop, NULL, 'settings', 'master_password_locked', 2, NULL, NULL, NULL,
      format('Master password locked for 15 minutes after 5 wrong %s', p_what), true);
    RETURN 'locked';
  END IF;
  RETURN 'wrong';
END $$;

-- 'ok' | 'wrong' | 'locked' | 'none' (no master password yet) for the current shop; never raises, so a wrong try counts
CREATE OR REPLACE FUNCTION public._master_attempt(p text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_row public.shop_master_passwords%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.shop_master_passwords WHERE shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF v_row.locked_until > now() THEN RETURN 'locked'; END IF;
  IF p IS NULL OR extensions.crypt(p, v_row.hash) <> v_row.hash THEN RETURN public._master_fail(v_shop, 'master passwords'); END IF;
  UPDATE public.shop_master_passwords SET failures = 0, locked_until = NULL
  WHERE shop_id = v_shop AND (failures > 0 OR locked_until IS NOT NULL);
  RETURN 'ok';
END $$;

-- 8 new codes like 'K7QM-3XPD' (no look-alike letters); the old ones stop working. Returned once, kept only as hashes.
CREATE OR REPLACE FUNCTION public._master_new_codes(p_shop uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  c_letters constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- 31 characters, about 39 bits per code
  v_codes jsonb := '[]';
  v_code text;
BEGIN
  DELETE FROM public.shop_master_recovery_codes WHERE shop_id = p_shop;
  FOR i IN 1..8 LOOP
    -- shortcut: byte % 31 is very slightly uneven; fine behind the 5-tries lock
    SELECT string_agg(substr(c_letters, get_byte(extensions.gen_random_bytes(1), 0) % 31 + 1, 1), '') INTO v_code
    FROM generate_series(1, 8);
    INSERT INTO public.shop_master_recovery_codes (shop_id, hash) VALUES (p_shop, extensions.crypt(v_code, extensions.gen_salt('bf', 8)));
    v_codes := v_codes || to_jsonb(left(v_code, 4) || '-' || right(v_code, 4));
  END LOOP;
  RETURN v_codes;
END $$;

-- set (first time: also returns the recovery codes) or change (needs the current master password)
CREATE FUNCTION public.set_master_password(p_new text, p_current text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_try text;
BEGIN
  IF p_new IS NULL OR length(p_new) < 8 OR length(p_new) > 72 THEN
    RAISE EXCEPTION 'The master password is 8 to 72 characters';
  END IF;
  v_try := public._master_attempt(p_current);
  IF v_try = 'none' THEN
    INSERT INTO public.shop_master_passwords (shop_id, hash, updated_at, updated_by)
    VALUES (v_shop, extensions.crypt(p_new, extensions.gen_salt('bf', 10)), now(), auth.uid());
    PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password', 2, NULL, NULL, NULL, 'Set the master password', true);
    RETURN jsonb_build_object('result', 'ok', 'codes', public._master_new_codes(v_shop));
  END IF;
  IF v_try <> 'ok' THEN RETURN jsonb_build_object('result', v_try); END IF;
  UPDATE public.shop_master_passwords SET hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now(), updated_by = auth.uid()
  WHERE shop_id = v_shop;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password', 2, NULL, NULL, NULL, 'Changed the master password', true);
  RETURN jsonb_build_object('result', 'ok');
END $$;

-- new recovery codes (the old ones stop working); needs the master password
CREATE OR REPLACE FUNCTION public.new_master_recovery_codes(p_master text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_try text := public._master_attempt(p_master);
BEGIN
  IF v_try = 'none' THEN RAISE EXCEPTION 'Set a master password first'; END IF;
  IF v_try <> 'ok' THEN RETURN jsonb_build_object('result', v_try); END IF;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_codes', 2, NULL, NULL, NULL,
    'Made new master password recovery codes (the old ones stopped working)', true);
  RETURN jsonb_build_object('result', 'ok', 'codes', public._master_new_codes(v_shop));
END $$;

-- unused recovery codes left (the owner's Settings shows it)
CREATE OR REPLACE FUNCTION public.master_codes_left()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
BEGIN
  RETURN (SELECT count(*) FROM public.shop_master_recovery_codes WHERE shop_id = v_shop AND used_at IS NULL);
END $$;

-- a forgotten master password: one recovery code (used up) and a new master password
CREATE OR REPLACE FUNCTION public.reset_master_password_with_code(p_code text, p_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_row public.shop_master_passwords%ROWTYPE;
  v_code text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_id uuid;
BEGIN
  IF p_new IS NULL OR length(p_new) < 8 OR length(p_new) > 72 THEN
    RAISE EXCEPTION 'The master password is 8 to 72 characters';
  END IF;
  SELECT * INTO v_row FROM public.shop_master_passwords WHERE shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no master password yet. Set one instead.'; END IF;
  IF v_row.locked_until > now() THEN RETURN jsonb_build_object('result', 'locked'); END IF;

  SELECT id INTO v_id FROM public.shop_master_recovery_codes
  WHERE shop_id = v_shop AND used_at IS NULL AND length(v_code) = 8 AND extensions.crypt(v_code, hash) = hash
  LIMIT 1;
  IF v_id IS NULL THEN RETURN jsonb_build_object('result', public._master_fail(v_shop, 'recovery codes')); END IF;

  UPDATE public.shop_master_recovery_codes SET used_at = now() WHERE id = v_id;
  UPDATE public.shop_master_passwords
  SET hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now(), updated_by = auth.uid(),
      failures = 0, locked_until = NULL
  WHERE shop_id = v_shop;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password_reset', 2, NULL, NULL, NULL,
    'Reset the forgotten master password with a recovery code', true);
  RETURN jsonb_build_object('result', 'ok',
    'left', (SELECT count(*) FROM public.shop_master_recovery_codes WHERE shop_id = v_shop AND used_at IS NULL));
END $$;

-- 046's version, with the counted check: 'ok' | 'wrong' | 'locked'
CREATE FUNCTION public.set_device_active(p_id uuid, p_active boolean, p_master text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_try text;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'owner' OR public.is_support() THEN
    RAISE EXCEPTION 'Only the shop owner can allow or block devices';
  END IF;
  v_try := public._master_attempt(p_master);
  IF v_try = 'none' THEN RAISE EXCEPTION 'Set a master password first, in Settings'; END IF;
  IF v_try <> 'ok' THEN RETURN v_try; END IF;
  UPDATE public.login_devices SET is_active = p_active, changed_by = auth.uid(), changed_at = now()
  WHERE id = p_id AND shop_id = public.current_shop_id() AND is_active IS DISTINCT FROM p_active;
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION public._require_real_owner(), public._master_fail(uuid, text), public._master_attempt(text),
  public._master_new_codes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_master_password(text, text), public.new_master_recovery_codes(text), public.master_codes_left(),
  public.reset_master_password_with_code(text, text), public.set_device_active(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_master_password(text, text), public.new_master_recovery_codes(text), public.master_codes_left(),
  public.reset_master_password_with_code(text, text), public.set_device_active(uuid, boolean, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
