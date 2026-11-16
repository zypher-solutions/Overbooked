-- The emailed code an owner types before asking Zypher to reset a lost master password (replaces 051's check of the
-- session's "amr", which relied on Supabase's Magic Link email; that email arrived without a code).
--   * The app makes a 6-digit code, stores it here as a bcrypt hash (set_owner_email_code, service role only) and emails
--     it through Resend (src/app/actions/master.ts). It lasts 10 minutes and dies after 5 wrong tries.
--   * master_reset_request(p_code) returns 'ok' | 'wrong' | 'expired' instead of raising on a wrong code, so the try is counted.

CREATE TABLE public.owner_email_codes (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hash     text NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  tries    int NOT NULL DEFAULT 0
);
ALTER TABLE public.owner_email_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_email_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.owner_email_codes TO service_role;

-- the app's server, after it checked the caller is the owner; a new code replaces the old one
CREATE OR REPLACE FUNCTION public.set_owner_email_code(p_user uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF p_code !~ '^\d{6}$' THEN RAISE EXCEPTION 'Bad code'; END IF;
  INSERT INTO public.owner_email_codes (user_id, hash, sent_at, tries)
  VALUES (p_user, extensions.crypt(p_code, extensions.gen_salt('bf', 8)), now(), 0)
  ON CONFLICT (user_id) DO UPDATE SET hash = EXCLUDED.hash, sent_at = now(), tries = 0;
END $$;
REVOKE ALL ON FUNCTION public.set_owner_email_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_owner_email_code(uuid, text) TO service_role;

DROP FUNCTION public.master_reset_request();
CREATE FUNCTION public.master_reset_request(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_c public.owner_email_codes;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shop_master_passwords WHERE shop_id = v_shop) THEN
    RAISE EXCEPTION 'There is no master password yet. Set one instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.master_reset_requests WHERE shop_id = v_shop AND cancelled_at IS NULL AND done_at IS NULL) THEN
    RAISE EXCEPTION 'A request is already open';
  END IF;
  SELECT * INTO v_c FROM public.owner_email_codes WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_c.sent_at < now() - interval '10 minutes' OR v_c.tries >= 5 THEN RETURN 'expired'; END IF;
  IF p_code IS NULL OR extensions.crypt(p_code, v_c.hash) <> v_c.hash THEN
    UPDATE public.owner_email_codes SET tries = tries + 1 WHERE user_id = auth.uid();
    RETURN 'wrong';
  END IF;
  DELETE FROM public.owner_email_codes WHERE user_id = auth.uid();
  INSERT INTO public.master_reset_requests (shop_id, requested_by) VALUES (v_shop, auth.uid());
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_reset_requested', 2, NULL, NULL, NULL,
    'Asked Zypher to reset the forgotten master password (Zypher phones the shop to confirm)', true);
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.master_reset_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_reset_request(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
