-- Resetting a forgotten master password (046 left none).
--   * The owner proves who they are with their own sign-in password (checked against the auth service's bcrypt hash),
--     then sets a new master password. Someone using the owner's open screen does not know it, so the reset keeps the
--     master password's point.
--   * This checks a sign-in password outside the auth service's own rate limit, so it has its own: 5 wrong tries lock
--     the reset for the shop for 15 minutes. The function returns a result instead of raising, so a wrong try is
--     counted (a raise would roll the count back).
--   * Logged as important in the owner's activity log, and so is a lockout.

ALTER TABLE public.shop_master_passwords
  ADD COLUMN reset_failures int NOT NULL DEFAULT 0,
  ADD COLUMN reset_locked_until timestamptz;

-- 'ok' | 'wrong' (sign-in password) | 'locked' (try again after 15 minutes); a bad new password or caller raises
CREATE OR REPLACE FUNCTION public.reset_master_password(p_login_password text, p_new text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_row public.shop_master_passwords%ROWTYPE;
  v_hash text;
BEGIN
  IF v_shop IS NULL OR public.get_my_role() IS DISTINCT FROM 'owner' OR public.is_support() THEN
    RAISE EXCEPTION 'Only the shop owner can reset the master password';
  END IF;
  IF p_new IS NULL OR length(p_new) < 6 OR length(p_new) > 72 THEN
    RAISE EXCEPTION 'The master password is 6 to 72 characters';
  END IF;
  SELECT * INTO v_row FROM public.shop_master_passwords WHERE shop_id = v_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no master password yet. Set one instead.'; END IF;
  IF v_row.reset_locked_until > now() THEN RETURN 'locked'; END IF;

  SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = auth.uid();
  IF v_hash IS NULL OR v_hash = '' OR p_login_password IS NULL OR extensions.crypt(p_login_password, v_hash) <> v_hash THEN
    UPDATE public.shop_master_passwords
    SET reset_failures = CASE WHEN reset_failures >= 4 THEN 0 ELSE reset_failures + 1 END,
        reset_locked_until = CASE WHEN reset_failures >= 4 THEN now() + interval '15 minutes' END
    WHERE shop_id = v_shop;
    IF v_row.reset_failures >= 4 THEN
      PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password_locked', 2, NULL, NULL, NULL,
        'Master password reset locked for 15 minutes after 5 wrong sign-in passwords', true);
      RETURN 'locked';
    END IF;
    RETURN 'wrong';
  END IF;

  UPDATE public.shop_master_passwords
  SET hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now(), updated_by = auth.uid(),
      reset_failures = 0, reset_locked_until = NULL
  WHERE shop_id = v_shop;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password_reset', 2, NULL, NULL, NULL,
    'Reset the forgotten master password', true);
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION public.reset_master_password(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_master_password(text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
