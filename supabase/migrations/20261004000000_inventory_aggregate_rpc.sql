-- Migration: inventory_aggregate_rpc
-- Description: Create a secure RPC to fetch global aggregate inventory stats without exposing physical rows.

CREATE OR REPLACE FUNCTION public.get_all_inventory_stats()
RETURNS TABLE (
  variation_id uuid,
  branch_id uuid,
  branch_name text,
  total bigint,
  available bigint,
  rented bigint,
  maintenance bigint,
  lost bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_role text;
  v_is_active boolean;
BEGIN
  -- Basic auth check ensures anonymous users cannot query this
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate caller's profile
  SELECT role, is_active INTO v_user_role, v_is_active
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_user_role IS NULL OR v_is_active != true OR v_user_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Unauthorized to view inventory statistics.';
  END IF;

  RETURN QUERY
  SELECT 
    ii.variation_id,
    ii.branch_id,
    b.name AS branch_name,
    COUNT(ii.id) AS total,
    COUNT(ii.id) FILTER (WHERE ii.status = 'available') AS available,
    COUNT(ii.id) FILTER (WHERE ii.status = 'rented') AS rented,
    COUNT(ii.id) FILTER (WHERE ii.status = 'maintenance') AS maintenance,
    COUNT(ii.id) FILTER (WHERE ii.status = 'lost') AS lost
  FROM public.inventory_items ii
  JOIN public.branches b ON b.id = ii.branch_id
  WHERE b.is_active = true
  GROUP BY ii.variation_id, ii.branch_id, b.name;
END;
$$;

-- Secure the function execution
REVOKE EXECUTE ON FUNCTION public.get_all_inventory_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_inventory_stats() TO authenticated;
