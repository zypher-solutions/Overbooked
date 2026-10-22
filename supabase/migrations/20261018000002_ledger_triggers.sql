-- STATUS: APPLIED (live). Restored from qa/proposed-sql/004_ledger_triggers.sql so the repo matches the live DB.
-- Run together with 001_ledger_entries.sql in ONE transaction.
-- Writes ledger rows with the real payment date from now on, WITHOUT rewriting any existing RPC:
-- every money movement already passes through an INSERT/UPDATE on payments, bookings or rentals,
-- so AFTER triggers on those tables record it. Rolled back automatically if the RPC fails.
--
--   payments INSERT          -> payment_in   (entry_date = paid_at; covers pickup, extension, return, later payments)
--   payments UPDATE amount   -> adjustment_in / adjustment_out for the difference (admin_update_payment)
--   payments DELETE          -> adjustment_out for the deleted amount (admin_delete_payment)
--   bookings INSERT          -> advance_in, deposit_in            (entry_date = now())
--   bookings -> 'cancelled'  -> advance_refund_out, deposit_refund_out (entry_date = cancelled_at)
--   rentals  -> 'returned'   -> deposit_retained, deposit_refund_out   (entry_date = now())
-- Trigger functions are SECURITY DEFINER because ledger_entries has no INSERT policy for API callers.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_branch uuid;
  v_diff numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT branch_id INTO v_branch FROM public.rentals WHERE id = NEW.rental_id;
    INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, payment_id, created_by)
    VALUES (NEW.paid_at, 'payment_in', NEW.amount, NEW.method, v_branch, NEW.rental_id, NEW.id, NEW.recorded_by);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_diff := NEW.amount - OLD.amount;
    IF v_diff <> 0 THEN
      SELECT branch_id INTO v_branch FROM public.rentals WHERE id = NEW.rental_id;
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, note, created_by)
      VALUES (now(), CASE WHEN v_diff > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END, abs(v_diff), NEW.method,
              v_branch, NEW.rental_id, 'payment ' || NEW.id || ' amount ' || OLD.amount || ' -> ' || NEW.amount, auth.uid());
    END IF;
    RETURN NEW;
  ELSE -- DELETE
    SELECT branch_id INTO v_branch FROM public.rentals WHERE id = OLD.rental_id;
    INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, note, created_by)
    VALUES (now(), 'adjustment_out', OLD.amount, OLD.method, v_branch, OLD.rental_id,
            'payment ' || OLD.id || ' deleted', auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_payment ON public.payments;
CREATE TRIGGER trg_ledger_payment
  AFTER INSERT OR UPDATE OF amount OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.ledger_on_payment();

CREATE OR REPLACE FUNCTION public.ledger_on_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.advance, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (now(), 'advance_in', NEW.advance, NEW.advance_payment_method, NEW.branch_id, NEW.id, NEW.created_by);
    END IF;
    IF COALESCE(NEW.security_deposit, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (now(), 'deposit_in', NEW.security_deposit, NEW.security_deposit_payment_method, NEW.branch_id, NEW.id, NEW.created_by);
    END IF;
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF COALESCE(NEW.advance_refund, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (COALESCE(NEW.cancelled_at, now()), 'advance_refund_out', NEW.advance_refund, NEW.refund_payment_method, NEW.branch_id, NEW.id, NEW.cancelled_by);
    END IF;
    IF COALESCE(NEW.security_deposit_refund, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by)
      VALUES (COALESCE(NEW.cancelled_at, now()), 'deposit_refund_out', NEW.security_deposit_refund, NEW.refund_payment_method, NEW.branch_id, NEW.id, NEW.cancelled_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_booking ON public.bookings;
CREATE TRIGGER trg_ledger_booking
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.ledger_on_booking();

CREATE OR REPLACE FUNCTION public.ledger_on_rental_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
    IF COALESCE(NEW.deposit_deducted, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, branch_id, rental_id)
      VALUES (now(), 'deposit_retained', NEW.deposit_deducted, NEW.branch_id, NEW.id);
    END IF;
    IF COALESCE(NEW.deposit_refunded, 0) > 0 THEN
      INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id)
      VALUES (now(), 'deposit_refund_out', NEW.deposit_refunded, NEW.deposit_refund_method, NEW.branch_id, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_rental_return ON public.rentals;
CREATE TRIGGER trg_ledger_rental_return
  AFTER UPDATE OF status ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.ledger_on_rental_return();

COMMIT;

-- Checks to run after applying (Phase 3, QA- data): FINANCE_AUDIT F1-F11 plus
--   per rental: SUM(payment_in) + SUM(adjustment_in) - SUM(adjustment_out) = SUM(payments.amount)
--   per month : v_collected_monthly.collected = independent recompute from payments + bookings (qa/reconcile.mjs)
-- Known limit: rentals has no booking_id, so a rental cannot be tied back to its booking's advance in SQL.
-- Known limit: backfilled advances/deposits use bookings.created_at as the date (no real payment date was ever stored).
