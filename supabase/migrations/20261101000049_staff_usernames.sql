-- Employees without email, and password resets by the owner or a manager.
--   * profiles.username: a login name like 'ravi@zeez' (name @ shop web name). The account's email behind it is a hidden
--     address on a reserved domain (src/lib/username.ts) that never receives mail. NULL for people who log in by email.
--   * profiles.must_change_password: set when the account was made, or its password reset, with a temporary password;
--     the app sends the person to "choose your password" until they do. People cannot update profiles themselves.
--   * Who may reset whom (_reset_target): the owner resets managers and staff of their shop; a manager resets only staff
--     of their own branch. Owners reset by email ("Forgot your password?"). A reset ends all of that person's sessions.
--   * The password itself is changed by the app's server with Supabase's admin API, between staff_reset_check and
--     staff_reset_done, which both run as the caller so the rules above cannot be skipped.

ALTER TABLE public.profiles
  ADD COLUMN username text,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._]{1,29}@[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX profiles_username_key ON public.profiles (username);

-- 021's version plus username and must_change_password
CREATE OR REPLACE FUNCTION public.setup_people(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
BEGIN
  PERFORM public._require_setup_shop(p_shop_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'full_name', p.full_name, 'role', p.role, 'branch_id', p.branch_id, 'branch', b.name,
             'is_active', p.is_active, 'email', CASE WHEN p.username IS NULL THEN u.email END, 'username', p.username,
             'must_change_password', p.must_change_password,
             'last_sign_in_at', u.last_sign_in_at, 'pending', u.last_sign_in_at IS NULL)
           ORDER BY (p.role = 'owner') DESC, p.role, p.full_name)
    FROM public.profiles p JOIN auth.users u ON u.id = p.id LEFT JOIN public.branches b ON b.id = p.branch_id
    WHERE p.shop_id = p_shop_id), '[]'::jsonb);
END $$;

-- the person the caller may reset, or an error saying why not
CREATE OR REPLACE FUNCTION public._reset_target(p_user_id uuid)
RETURNS public.profiles LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_me public.profiles;
  v_t public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();
  IF public.is_support() OR COALESCE(v_me.role, '') NOT IN ('owner', 'manager') OR NOT COALESCE(v_me.is_active, false) THEN
    RAISE EXCEPTION 'Only the shop owner or a manager can reset a password';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Use Change password for your own account'; END IF;
  SELECT * INTO v_t FROM public.profiles WHERE id = p_user_id AND shop_id = v_me.shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this shop'; END IF;
  IF v_t.role NOT IN ('manager', 'staff') THEN
    RAISE EXCEPTION 'An owner resets their own password with "Forgot your password?"';
  END IF;
  IF v_me.role = 'manager' AND (v_t.role <> 'staff' OR v_me.branch_id IS NULL OR v_t.branch_id IS DISTINCT FROM v_me.branch_id) THEN
    RAISE EXCEPTION 'A manager can reset only staff of their own branch';
  END IF;
  IF NOT v_t.is_active THEN RAISE EXCEPTION 'Switch this person on first'; END IF;
  RETURN v_t;
END $$;

-- before the app's server changes the password
CREATE OR REPLACE FUNCTION public.staff_reset_check(p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public._reset_target(p_user_id);
END $$;

-- after it: they must choose a new password, every device of theirs is signed out, and the owner's log says so
CREATE OR REPLACE FUNCTION public.staff_reset_done(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_t public.profiles := public._reset_target(p_user_id);
BEGIN
  UPDATE public.profiles SET must_change_password = true WHERE id = v_t.id;
  DELETE FROM auth.sessions WHERE user_id = v_t.id;   -- their refresh tokens go with the sessions
  PERFORM public._act_log(v_t.shop_id, v_t.branch_id, 'staff', 'password_reset', 2, NULL, NULL, v_t.full_name,
    format('Reset %s''s password; they choose a new one at their next sign-in', v_t.full_name), true);
END $$;

-- the people the caller may reset (a manager's screen; the owner's Staff management uses setup_people)
CREATE OR REPLACE FUNCTION public.staff_reset_people()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_me public.profiles;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();
  IF public.is_support() OR COALESCE(v_me.role, '') NOT IN ('owner', 'manager') OR NOT COALESCE(v_me.is_active, false) THEN
    RAISE EXCEPTION 'Only the shop owner or a manager can reset a password';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role,
             'username', p.username, 'email', CASE WHEN p.username IS NULL THEN u.email END,
             'must_change_password', p.must_change_password, 'last_sign_in_at', u.last_sign_in_at)
           ORDER BY p.full_name)
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.shop_id = v_me.shop_id AND p.is_active AND p.id <> v_me.id
      AND (p.role = 'staff' OR (v_me.role = 'owner' AND p.role = 'manager'))
      AND (v_me.role = 'owner' OR (v_me.branch_id IS NOT NULL AND p.branch_id = v_me.branch_id))), '[]'::jsonb);
END $$;

-- 034's version: a password change also clears "must change password".
-- shortcut: a person could clear their own flag without changing the password (only through this call, only for
-- themselves); the forced screen is about their privacy, not a lock. Move the clearing server-side if that matters.
CREATE OR REPLACE FUNCTION public.log_account_event(p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public.current_shop_id();
  v_branch uuid;
BEGIN
  IF auth.uid() IS NULL OR v_shop IS NULL THEN RETURN; END IF;   -- Zypher staff have no shop log
  IF p_kind NOT IN ('signed_in', 'password_changed') THEN RAISE EXCEPTION 'Unknown account event'; END IF;
  IF p_kind = 'password_changed' THEN
    UPDATE public.profiles SET must_change_password = false WHERE id = auth.uid() AND must_change_password;
  END IF;
  -- one sign-in entry is enough when the sign-in screen and the two-step screen both report it
  IF p_kind = 'signed_in' AND EXISTS (
    SELECT 1 FROM public.activity_log WHERE shop_id = v_shop AND actor_id = auth.uid() AND action = 'signed_in'
      AND occurred_at > now() - interval '2 minutes') THEN
    RETURN;
  END IF;
  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = auth.uid();
  PERFORM public._act_log(v_shop, v_branch, 'account', p_kind, 2, NULL, NULL, NULL,
    CASE p_kind WHEN 'signed_in' THEN 'Signed in' ELSE 'Set a new password' END);
END $$;

REVOKE EXECUTE ON FUNCTION public._reset_target(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_reset_check(uuid), public.staff_reset_done(uuid), public.staff_reset_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reset_check(uuid), public.staff_reset_done(uuid), public.staff_reset_people() TO authenticated;
NOTIFY pgrst, 'reload schema';
