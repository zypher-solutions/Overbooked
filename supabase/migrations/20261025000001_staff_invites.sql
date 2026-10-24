-- Staff invites: an owner (or Zypher) invites someone by email; the app returns a link to share
-- (e.g. on WhatsApp). The account is created at once and lands in the right shop, role and branch.

CREATE TABLE public.staff_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id),
  email        text NOT NULL CHECK (email = lower(btrim(email))),
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  branch_id    uuid,
  invited_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  CONSTRAINT staff_invites_shop_branch_fkey FOREIGN KEY (shop_id, branch_id) REFERENCES public.branches (shop_id, id)
);
CREATE UNIQUE INDEX staff_invites_one_open_per_email ON public.staff_invites (email) WHERE accepted_at IS NULL;

-- written only by the server (service role) after it has checked the caller; owners can read their shop's
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_invites_read ON public.staff_invites FOR SELECT
  USING (shop_id = public.current_shop_id() AND public.get_my_role() IN ('super_admin', 'owner'));

-- a new account takes its shop, role and branch from its invite; without one it stays inactive with no shop
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_invite RECORD;
  v_name text := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
BEGIN
  SELECT * INTO v_invite FROM public.staff_invites
  WHERE email = lower(NEW.email) AND accepted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, is_active) VALUES (NEW.id, v_name, false);
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, shop_id, branch_id, is_active)
  VALUES (NEW.id, v_name, v_invite.role, v_invite.shop_id, v_invite.branch_id, true);

  UPDATE public.staff_invites SET accepted_at = now() WHERE id = v_invite.id;
  RETURN NEW;
END;
$$;

-- staff list for the owner: email and whether they have signed in yet (invite still pending)
DROP FUNCTION IF EXISTS public.get_staff_emails();
CREATE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text, last_sign_in_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' AND public.get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Unauthorized: only the shop owner can see staff emails';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.last_sign_in_at
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE p.shop_id = public.current_shop_id();
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_emails() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
