-- APPLIED to test project gztmmlhuuqbnsnjjcohq on 2026-10-22. NOT applied to production.
-- Deleting a rental now frees its units (rented or maintenance -> available).
-- Units that are 'lost', or that are on another rental that is still out, are left alone.
CREATE OR REPLACE FUNCTION public.admin_delete_rental(p_rental_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rental RECORD;
  v_payments INT;
BEGIN
  PERFORM public._require_super_admin(p_reason);

  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF v_rental.status = 'out' THEN
    RAISE EXCEPTION 'This rental is still out. Mark it as returned first, then delete it.';
  END IF;

  DELETE FROM public.payments WHERE rental_id = p_rental_id;   -- trigger ledger_on_payment reverses each payment
  GET DIAGNOSTICS v_payments = ROW_COUNT;

  UPDATE public.inventory_items ii
  SET status = 'available'
  WHERE ii.status IN ('rented', 'maintenance')
    AND ii.id IN (SELECT rii.inventory_item_id FROM public.rental_item_inventory rii
                  JOIN public.rental_items ri ON ri.id = rii.rental_item_id
                  WHERE ri.rental_id = p_rental_id)
    AND NOT EXISTS (SELECT 1 FROM public.rental_item_inventory rii2
                    JOIN public.rental_items ri2 ON ri2.id = rii2.rental_item_id
                    JOIN public.rentals r2 ON r2.id = ri2.rental_id
                    WHERE rii2.inventory_item_id = ii.id AND r2.id <> p_rental_id AND r2.status = 'out');

  DELETE FROM public.rental_item_inventory
  WHERE rental_item_id IN (SELECT id FROM public.rental_items WHERE rental_id = p_rental_id);

  DELETE FROM public.rental_items WHERE rental_id = p_rental_id;
  DELETE FROM public.rentals WHERE id = p_rental_id;

  PERFORM public._reverse_ledger_for(p_rental_id, NULL, 'rental ' || v_rental.token || ' deleted');

  RETURN jsonb_build_object('success', true, 'payments_deleted', v_payments);
END;
$function$;

NOTIFY pgrst, 'reload schema';
