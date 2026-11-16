-- Last resort for a forgotten master password when the recovery codes (migration 050) are lost too.
--   1. The owner asks, after typing a code emailed to their sign-in address (the session's "amr" must show an email
--      code from the last 15 minutes): someone lent the owner's sign-in usually does not have the owner's inbox.
--   2. Zypher phones the owner on the shop's number and confirms in its console (zypher_master_confirm). That starts
--      a 24-hour wait; the app emails the owner an alert and Settings shows a banner with Cancel.
--   3. After 24 hours the owner sets a new master password without the old one and gets 8 new recovery codes.
--   Anyone with the owner's sign-in may cancel (always the safe direction). Every step is logged as important.

CREATE TABLE public.master_reset_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  requested_by  uuid NOT NULL REFERENCES public.profiles(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid REFERENCES public.profiles(id),
  confirmed_at  timestamptz,
  ready_at      timestamptz,
  cancelled_by  uuid REFERENCES public.profiles(id),
  cancelled_at  timestamptz,
  done_at       timestamptz
);
-- one open request per shop
CREATE UNIQUE INDEX master_reset_requests_open ON public.master_reset_requests (shop_id) WHERE cancelled_at IS NULL AND done_at IS NULL;
ALTER TABLE public.master_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_reset_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.master_reset_requests TO service_role;

-- the owner: ask Zypher (needs a fresh email code in this session)
CREATE OR REPLACE FUNCTION public.master_reset_request()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shop_master_passwords WHERE shop_id = v_shop) THEN
    RAISE EXCEPTION 'There is no master password yet. Set one instead.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) a
    WHERE a ->> 'method' IN ('otp', 'magiclink', 'email')
      AND to_timestamp((a ->> 'timestamp')::bigint) > now() - interval '15 minutes') THEN
    RAISE EXCEPTION 'Type the code we emailed you first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.master_reset_requests WHERE shop_id = v_shop AND cancelled_at IS NULL AND done_at IS NULL) THEN
    RAISE EXCEPTION 'A request is already open';
  END IF;
  INSERT INTO public.master_reset_requests (shop_id, requested_by) VALUES (v_shop, auth.uid());
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_reset_requested', 2, NULL, NULL, NULL,
    'Asked Zypher to reset the forgotten master password (Zypher phones the shop to confirm)', true);
END $$;

-- the owner's open request, or null: {requested_at, confirmed_at, ready_at, ready}
CREATE OR REPLACE FUNCTION public.master_reset_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
BEGIN
  RETURN (SELECT jsonb_build_object('requested_at', requested_at, 'confirmed_at', confirmed_at, 'ready_at', ready_at,
                   'ready', ready_at IS NOT NULL AND ready_at <= now())
          FROM public.master_reset_requests WHERE shop_id = v_shop AND cancelled_at IS NULL AND done_at IS NULL);
END $$;

CREATE OR REPLACE FUNCTION public.master_reset_cancel()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
BEGIN
  UPDATE public.master_reset_requests SET cancelled_at = now(), cancelled_by = auth.uid()
  WHERE shop_id = v_shop AND cancelled_at IS NULL AND done_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no open request'; END IF;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_reset_cancelled', 2, NULL, NULL, NULL,
    'Cancelled the request to reset the master password', true);
END $$;

-- after the wait: a new master password without the old one, and 8 new recovery codes
CREATE OR REPLACE FUNCTION public.master_reset_complete(p_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_shop uuid := public._require_real_owner();
  v_id uuid;
BEGIN
  IF p_new IS NULL OR length(p_new) < 8 OR length(p_new) > 72 THEN
    RAISE EXCEPTION 'The master password is 8 to 72 characters';
  END IF;
  SELECT id INTO v_id FROM public.master_reset_requests
  WHERE shop_id = v_shop AND cancelled_at IS NULL AND done_at IS NULL AND ready_at <= now() FOR UPDATE;
  IF v_id IS NULL THEN RAISE EXCEPTION 'The reset is not unlocked yet'; END IF;
  UPDATE public.master_reset_requests SET done_at = now() WHERE id = v_id;
  UPDATE public.shop_master_passwords
  SET hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now(), updated_by = auth.uid(),
      failures = 0, locked_until = NULL
  WHERE shop_id = v_shop;
  PERFORM public._act_log(v_shop, NULL, 'settings', 'master_password_reset', 2, NULL, NULL, NULL,
    'Reset the forgotten master password after Zypher''s check and the 24-hour wait', true);
  RETURN jsonb_build_object('codes', public._master_new_codes(v_shop));
END $$;

-- Zypher: every open request, for its console
CREATE OR REPLACE FUNCTION public.zypher_master_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
BEGIN
  PERFORM public._require_zypher();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', r.id, 'shop_id', s.id, 'shop', s.name, 'shop_phone', s.phone,
             'owner', p.full_name, 'owner_email', u.email, 'requested_at', r.requested_at,
             'confirmed_at', r.confirmed_at, 'ready_at', r.ready_at) ORDER BY r.requested_at)
    FROM public.master_reset_requests r
    JOIN public.shops s ON s.id = r.shop_id
    JOIN public.profiles p ON p.id = r.requested_by
    JOIN auth.users u ON u.id = r.requested_by
    WHERE r.cancelled_at IS NULL AND r.done_at IS NULL), '[]'::jsonb);
END $$;

-- Zypher phoned the owner and confirmed: the 24-hour wait starts. Returns who to email and when it unlocks.
CREATE OR REPLACE FUNCTION public.zypher_master_confirm(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_catalog AS $$
DECLARE
  v_r public.master_reset_requests;
BEGIN
  PERFORM public._require_zypher();
  UPDATE public.master_reset_requests SET confirmed_by = auth.uid(), confirmed_at = now(), ready_at = now() + interval '24 hours'
  WHERE id = p_id AND confirmed_at IS NULL AND cancelled_at IS NULL AND done_at IS NULL
  RETURNING * INTO v_r;
  IF NOT FOUND THEN RAISE EXCEPTION 'This request is already confirmed, cancelled or done'; END IF;
  PERFORM public._act_log(v_r.shop_id, NULL, 'settings', 'master_reset_confirmed', 2, NULL, NULL, NULL,
    'Zypher confirmed the master password reset by phone; it unlocks in 24 hours unless cancelled', true);
  RETURN jsonb_build_object('email', (SELECT email FROM auth.users WHERE id = v_r.requested_by),
    'shop', (SELECT name FROM public.shops WHERE id = v_r.shop_id), 'ready_at', v_r.ready_at);
END $$;

REVOKE ALL ON FUNCTION public.master_reset_request(), public.master_reset_status(), public.master_reset_cancel(),
  public.master_reset_complete(text), public.zypher_master_requests(), public.zypher_master_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_reset_request(), public.master_reset_status(), public.master_reset_cancel(),
  public.master_reset_complete(text), public.zypher_master_requests(), public.zypher_master_confirm(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
