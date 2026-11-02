-- Finance used to load the money columns of every rental the shop ever had, to work out "outstanding now" and "deposits held now".
-- This returns only the rentals that still matter for those two figures (a balance is owed, or a deposit is held), so a shop with
-- tens of thousands of rentals loads the same few rows. It runs as the caller, so the usual rules apply: the owner sees every
-- branch, a manager only their own, staff and Zypher none.
CREATE OR REPLACE FUNCTION public.finance_open_money()
RETURNS TABLE (id uuid, branch_id uuid, status text, total numeric, paid numeric, cancellation_fee numeric,
               actual_start_at timestamptz, cancelled_at timestamptz,
               deposit_received numeric, deposit_refunded numeric, deposit_applied numeric)
LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT r.id, r.branch_id, r.status, r.total, r.paid, r.cancellation_fee, r.actual_start_at, r.cancelled_at,
         r.deposit_received, r.deposit_refunded, r.deposit_applied
  FROM public.rentals r
  WHERE r.status IN ('active', 'completed', 'cancelled', 'no_show')
    AND (r.total > r.paid OR r.deposit_received - r.deposit_refunded - r.deposit_applied > 0);
$$;
REVOKE ALL ON FUNCTION public.finance_open_money() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_open_money() TO authenticated;
NOTIFY pgrst, 'reload schema';
