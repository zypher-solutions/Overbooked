-- Migration: 20261006000001_staff_emails_rpc.sql
CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_role text;
BEGIN
  -- Authenticate caller
  SELECT role INTO v_role FROM public.profiles WHERE profiles.id = auth.uid();
  
  -- Restrict to super_admin only
  IF v_role != 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only super_admin can fetch staff emails';
  END IF;

  RETURN QUERY 
  SELECT u.id, u.email::text
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_emails() TO authenticated;
