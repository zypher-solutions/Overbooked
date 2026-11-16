-- Recovery codes are given once (migration 050 let the owner make new ones any time with the master password).
--   * new_master_recovery_codes now works only for a shop that never had codes (shops whose master password was set
--     before 050). Afterwards the only fresh set comes with Zypher's reset (051).
--   * master_codes_left returns NULL when the shop never had codes, so Settings can offer that one-time set.
--   * check_master_recovery_code: "Forgot it?" checks the code first, before asking for a new master password.
--     A wrong code counts toward the same 5-tries lock; the code is used up only by reset_master_password_with_code.

CREATE OR REPLACE FUNCTION public.new_master_recovery_codes(p_master text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_try text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.shop_master_recovery_codes WHERE shop_id = v_shop) THEN
    RAISE EXCEPTION 'Recovery codes are given only once';
  END IF;
  v_try := public._master_attempt(p_master);
  IF v_try = 'none' THEN RAISE EXCEPTION 'Set a master password first'; END IF;
  IF v_try <> 'ok' THEN RETURN jsonb_build_object('result', v_try); END IF;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_codes', 2, NULL, NULL, NULL,
    'Made the master password recovery codes', true);
  RETURN jsonb_build_object('result', 'ok', 'codes', public._master_new_codes(v_shop));
END $$;

-- unused codes left, or NULL if the shop never had codes
CREATE OR REPLACE FUNCTION public.master_codes_left()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shop_master_recovery_codes WHERE shop_id = v_shop) THEN RETURN NULL; END IF;
  RETURN (SELECT count(*) FROM public.shop_master_recovery_codes WHERE shop_id = v_shop AND used_at IS NULL);
END $$;

-- 'ok' | 'wrong' | 'locked': is this an unused recovery code? (does not use it up)
CREATE OR REPLACE FUNCTION public.check_master_recovery_code(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_row public.shop_master_passwords%ROWTYPE;
  v_code text := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  SELECT * INTO v_row FROM public.shop_master_passwords WHERE shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no master password yet. Set one instead.'; END IF;
  IF v_row.locked_until > now() THEN RETURN 'locked'; END IF;
  IF EXISTS (SELECT 1 FROM public.shop_master_recovery_codes
             WHERE shop_id = v_shop AND used_at IS NULL AND length(v_code) = 8 AND extensions.crypt(v_code, hash) = hash) THEN
    RETURN 'ok';
  END IF;
  RETURN public._master_fail(v_shop, 'recovery codes');
END $$;

REVOKE ALL ON FUNCTION public.check_master_recovery_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_master_recovery_code(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
