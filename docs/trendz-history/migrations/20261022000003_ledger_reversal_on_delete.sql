-- APPLIED to test project gztmmlhuuqbnsnjjcohq on 2026-10-22. NOT applied to production.
-- Deleting a rental or a booking must leave the ledger (and v_collected_monthly) as if it never existed.
-- Payment delete already does this through trigger ledger_on_payment; rental and booking delete did not.
--
-- Rule: the ledger is append-only, so the net effect of the record's entries is cancelled by one reversing entry:
--   collected side   -> adjustment_out (or adjustment_in if the net is negative)
--   deposit liability -> deposit_refund_out (or deposit_in if negative), noted as a reversal, not a real refund

CREATE OR REPLACE FUNCTION public._reverse_ledger_for(p_rental_id uuid, p_booking_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT branch_id,
           COALESCE(SUM(CASE WHEN kind IN ('advance_in', 'payment_in', 'deposit_retained', 'adjustment_in') THEN amount
                             WHEN kind IN ('advance_refund_out', 'adjustment_out') THEN -amount
                             ELSE 0 END), 0) AS collected,
           COALESCE(SUM(CASE WHEN kind = 'deposit_in' THEN amount
                             WHEN kind IN ('deposit_refund_out', 'deposit_retained') THEN -amount
                             ELSE 0 END), 0) AS liability
    FROM public.ledger_entries
    WHERE (p_rental_id IS NOT NULL AND rental_id = p_rental_id)
       OR (p_booking_id IS NOT NULL AND booking_id = p_booking_id)
    GROUP BY branch_id
  LOOP
    IF r.collected <> 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, branch_id, rental_id, booking_id, note, created_by)
      VALUES (now(), CASE WHEN r.collected > 0 THEN 'adjustment_out' ELSE 'adjustment_in' END, abs(r.collected),
              r.branch_id, p_rental_id, p_booking_id, p_note, auth.uid());
    END IF;
    IF r.liability <> 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, branch_id, rental_id, booking_id, note, created_by)
      VALUES (now(), CASE WHEN r.liability > 0 THEN 'deposit_refund_out' ELSE 'deposit_in' END, abs(r.liability),
              r.branch_id, p_rental_id, p_booking_id, p_note || ' (deposit reversal, no cash moved)', auth.uid());
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public._reverse_ledger_for(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_booking(p_booking_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_booking RECORD;
BEGIN
  PERFORM public._require_super_admin(p_reason);

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  DELETE FROM public.booking_item_inventory
  WHERE booking_item_id IN (SELECT id FROM public.booking_items WHERE booking_id = p_booking_id);

  DELETE FROM public.booking_items WHERE booking_id = p_booking_id;
  DELETE FROM public.bookings WHERE id = p_booking_id;

  PERFORM public._reverse_ledger_for(NULL, p_booking_id, 'booking deleted');

  RETURN jsonb_build_object('success', true);
END;
$function$;

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

  DELETE FROM public.rental_item_inventory
  WHERE rental_item_id IN (SELECT id FROM public.rental_items WHERE rental_id = p_rental_id);

  DELETE FROM public.rental_items WHERE rental_id = p_rental_id;
  DELETE FROM public.rentals WHERE id = p_rental_id;

  PERFORM public._reverse_ledger_for(p_rental_id, NULL, 'rental ' || v_rental.token || ' deleted');

  RETURN jsonb_build_object('success', true, 'payments_deleted', v_payments);
END;
$function$;

-- One-off: reverse ledger entries left behind by records that were already deleted (no-op when none).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT rental_id AS id FROM public.ledger_entries
           WHERE rental_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rentals WHERE id = rental_id) LOOP
    PERFORM public._reverse_ledger_for(r.id, NULL, 'orphan cleanup: rental deleted earlier');
  END LOOP;
  FOR r IN SELECT DISTINCT booking_id AS id FROM public.ledger_entries
           WHERE booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = booking_id) LOOP
    PERFORM public._reverse_ledger_for(NULL, r.id, 'orphan cleanup: booking deleted earlier');
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
