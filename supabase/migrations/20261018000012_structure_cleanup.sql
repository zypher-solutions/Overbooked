-- STATUS: APPLIED (live, 2026-10-18, verified)
-- Database structure cleanup from the 2026-10-18 live schema review. Backward compatible: no column removed,
-- no row changed or deleted, no function signature changed.
--   STR-1 rentals.booking_id: a rental had no real link to the booking it came from (tokens differ: RN-xxxx vs booking
--         token). New nullable FK + one-rental-per-booking index; pickup_booking_atomic now fills it. Old rentals stay NULL.
--   STR-2 Money columns: plain-numeric money columns become numeric(14,2) (rentals.total, bookings.cancellation_fee, payments.amount are left: a view or trigger depends on them); the
--         whole-paise CHECKs that were NOT VALID are validated (live data already satisfies them).
--   STR-3 Index the 8 foreign keys the advisor flagged.
BEGIN;

-- STR-1
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rentals_booking_id_key ON public.rentals (booking_id) WHERE booking_id IS NOT NULL;

-- STR-2
ALTER TABLE public.rentals
  ALTER COLUMN advance TYPE numeric(14,2),
  ALTER COLUMN extra_fees TYPE numeric(14,2), ALTER COLUMN security_deposit TYPE numeric(14,2),
  ALTER COLUMN deposit_deducted TYPE numeric(14,2), ALTER COLUMN deposit_refunded TYPE numeric(14,2);
-- rentals.total and bookings.cancellation_fee stay as they are: view v_earned_monthly depends on them
ALTER TABLE public.bookings
  ALTER COLUMN total TYPE numeric(14,2), ALTER COLUMN advance TYPE numeric(14,2),
  ALTER COLUMN security_deposit TYPE numeric(14,2),
  ALTER COLUMN advance_refund TYPE numeric(14,2), ALTER COLUMN security_deposit_refund TYPE numeric(14,2);
-- payments.amount stays numeric(10,2): trigger trg_ledger_payment depends on it

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS t, conname FROM pg_constraint
           WHERE connamespace = 'public'::regnamespace AND contype = 'c' AND NOT convalidated LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.t, c.conname);
  END LOOP;
END $$;

-- STR-3
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_by ON public.bookings (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_bookings_created_by ON public.bookings (created_by);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_created_by ON public.ledger_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_payments_recorded_by ON public.payments (recorded_by);
CREATE INDEX IF NOT EXISTS idx_product_stock_product_id ON public.product_stock (product_id);
CREATE INDEX IF NOT EXISTS idx_profiles_branch_id ON public.profiles (branch_id);
CREATE INDEX IF NOT EXISTS idx_rental_items_product_id ON public.rental_items (product_id);
CREATE INDEX IF NOT EXISTS idx_rentals_staff_id ON public.rentals (staff_id);

-- STR-1b pickup_booking_atomic: live body unchanged except booking_id is added to the rentals INSERT
DO $$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'pickup_booking_atomic';
  n := replace(d, 'token, customer_id, branch_id, staff_id, rent_date,', 'booking_id, token, customer_id, branch_id, staff_id, rent_date,');
  n := replace(n, 'v_rental_token, v_booking.customer_id,', 'p_booking_id, v_rental_token, v_booking.customer_id,');
  IF n = d OR position('p_booking_id, v_rental_token' in n) = 0 OR position('booking_id, token, customer_id' in n) = 0 THEN
    RAISE EXCEPTION 'pickup_booking_atomic body not as expected; no change made';
  END IF;
  EXECUTE n;
END $$;

COMMIT;
