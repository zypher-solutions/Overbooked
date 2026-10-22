-- STATUS: APPLIED (live). Restored from qa/proposed-sql/007_whole_paise_amounts.sql so the repo matches the live DB.
-- Found in Phase 3 (qa/phase3/money.spec.mjs, "Sub-paisa amounts").
-- Every money column is unconstrained `numeric`, so the API accepts 10.005, 1000.005 etc. through
-- record_rental_payment, create_booking_atomic (advance, deposit), mark_returned_atomic (fee),
-- extend_rental_atomic (payment) and cancel_booking_atomic (fee). Balances then carry fractions of a paisa
-- and the ledger/dashboard totals cannot be reconciled to the paisa.
--
-- Fix at the table, so no RPC body is rewritten and every present and future path is covered.
-- NOT VALID = enforced for all new/updated rows; existing rows are not scanned (safe on live data).
-- Afterwards, on the quiet day: ALTER TABLE ... VALIDATE CONSTRAINT <name>; once the diagnostic below returns 0 rows.
--
-- Diagnostic (run first, read-only):
--   SELECT 'payments', id FROM payments WHERE amount <> round(amount, 2)
--   UNION ALL SELECT 'rentals', id FROM rentals WHERE total <> round(total,2) OR advance <> round(advance,2)
--        OR COALESCE(extra_fees,0) <> round(COALESCE(extra_fees,0),2) OR COALESCE(security_deposit,0) <> round(COALESCE(security_deposit,0),2)
--   UNION ALL SELECT 'bookings', id FROM bookings WHERE total <> round(total,2) OR advance <> round(advance,2)
--        OR security_deposit <> round(security_deposit,2) OR COALESCE(cancellation_fee,0) <> round(COALESCE(cancellation_fee,0),2);

BEGIN;

ALTER TABLE public.payments ADD CONSTRAINT payments_amount_whole_paise CHECK (amount = round(amount, 2)) NOT VALID;

ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_money_whole_paise CHECK (
    total = round(total, 2) AND advance = round(advance, 2)
    AND COALESCE(extra_fees, 0) = round(COALESCE(extra_fees, 0), 2)
    AND COALESCE(security_deposit, 0) = round(COALESCE(security_deposit, 0), 2)
    AND COALESCE(deposit_deducted, 0) = round(COALESCE(deposit_deducted, 0), 2)
    AND COALESCE(deposit_refunded, 0) = round(COALESCE(deposit_refunded, 0), 2)
  ) NOT VALID;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_money_whole_paise CHECK (
    total = round(total, 2) AND advance = round(advance, 2) AND security_deposit = round(security_deposit, 2)
    AND COALESCE(cancellation_fee, 0) = round(COALESCE(cancellation_fee, 0), 2)
    AND COALESCE(advance_refund, 0) = round(COALESCE(advance_refund, 0), 2)
    AND COALESCE(security_deposit_refund, 0) = round(COALESCE(security_deposit_refund, 0), 2)
  ) NOT VALID;

COMMIT;

-- Rollback: ALTER TABLE payments DROP CONSTRAINT payments_amount_whole_paise; (same for the other two).
-- Side effect to know: a 3-decimal input now fails with "violates check constraint ..." instead of a friendly
-- message. The UI already rounds with round2(); this only stops direct API calls.
