-- STATUS: APPLIED (live). Restored from qa/proposed-sql/001_ledger_entries.sql so the repo matches the live DB.
-- Owner approval required (QA_LOG: decisions 4, 6, 9; findings FIN-1, FIN-2, FIN-3, FIN-6).
-- Adds an append-only money ledger so that:
--   Collected = money received, by payment date, net of advance refunds, deposits excluded until retained
--   Earned    = revenue by rental date (pickup), plus cancellation fees on the cancellation date
-- Existing tables are NOT modified. Existing rows are copied in once (source = 'backfill').
-- Run order: this file and 004_ledger_triggers.sql TOGETHER in one transaction (otherwise money recorded
-- between the two runs is missed). Try on a copy / Supabase branch first, then check the query at the bottom.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date  timestamptz NOT NULL,                       -- the day the money moved
  kind        text NOT NULL CHECK (kind IN (
                'advance_in',          -- booking-time advance received
                'payment_in',          -- pickup / extension / return / later payment received
                'deposit_in',          -- security deposit received (liability, not revenue)
                'advance_refund_out',  -- advance returned to customer on cancellation
                'deposit_refund_out',  -- deposit returned to customer
                'deposit_retained',    -- deposit kept against fees: becomes revenue on this date
                'adjustment_in',       -- super_admin raised/corrected a payment upwards (audit_log has the reason)
                'adjustment_out')),    -- super_admin lowered/deleted a payment
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  method      text CHECK (method IS NULL OR method IN ('cash', 'upi', 'card', 'bank_transfer')),
  branch_id   uuid REFERENCES public.branches(id),
  booking_id  uuid,   -- deliberately NOT a foreign key: admin_delete_* must not be blocked, and history must survive a delete
  rental_id   uuid,
  payment_id  uuid,
  note        text,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill')),
  CONSTRAINT ledger_has_parent CHECK (booking_id IS NOT NULL OR rental_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ledger_entries_date_idx   ON public.ledger_entries (entry_date);
CREATE INDEX IF NOT EXISTS ledger_entries_rental_idx ON public.ledger_entries (rental_id);
CREATE INDEX IF NOT EXISTS ledger_entries_book_idx   ON public.ledger_entries (booking_id);
-- one entry per fact: stops a backfill or a retried RPC from double-recording
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_payment    ON public.ledger_entries (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_per_booking ON public.ledger_entries (kind, booking_id)
  WHERE rental_id IS NULL AND kind IN ('advance_in', 'deposit_in', 'advance_refund_out', 'deposit_refund_out');
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_per_rental ON public.ledger_entries (kind, rental_id)
  WHERE payment_id IS NULL AND kind IN ('deposit_retained', 'deposit_refund_out');

-- Append-only: API callers can read (owner/super_admin only, staff and managers must not see the ledger) and nothing else
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_read ON public.ledger_entries;
CREATE POLICY ledger_read ON public.ledger_entries FOR SELECT
  USING (public.get_my_role() IN ('super_admin', 'owner'));
-- no INSERT/UPDATE/DELETE policy: only SECURITY DEFINER functions (RPCs) and the SQL editor can write

DROP TRIGGER IF EXISTS trg_block_direct_change ON public.ledger_entries;
CREATE TRIGGER trg_block_direct_change
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.block_direct_record_change();

-- ---------------------------------------------------------------------------
-- BACKFILL (idempotent: the unique indexes above make a second run a no-op)
-- Dates: payments.paid_at is exact. Booking advance/deposit have no payment date, so bookings.created_at
-- is used as the best available proxy and these rows are tagged in note.
-- ---------------------------------------------------------------------------
INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, payment_id, created_by, source)
SELECT p.paid_at, 'payment_in', p.amount, p.method, r.branch_id, p.rental_id, p.id, p.recorded_by, 'backfill'
FROM public.payments p JOIN public.rentals r ON r.id = p.rental_id
ON CONFLICT DO NOTHING;

INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, note, created_by, source)
SELECT b.created_at, 'advance_in', b.advance, b.advance_payment_method, b.branch_id, b.id,
       'date = booking created_at (proxy)', b.created_by, 'backfill'
FROM public.bookings b WHERE COALESCE(b.advance, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, note, created_by, source)
SELECT b.created_at, 'deposit_in', b.security_deposit, b.security_deposit_payment_method, b.branch_id, b.id,
       'date = booking created_at (proxy)', b.created_by, 'backfill'
FROM public.bookings b WHERE COALESCE(b.security_deposit, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by, source)
SELECT b.cancelled_at, 'advance_refund_out', b.advance_refund, b.refund_payment_method, b.branch_id, b.id, b.cancelled_by, 'backfill'
FROM public.bookings b WHERE b.status = 'cancelled' AND COALESCE(b.advance_refund, 0) > 0 AND b.cancelled_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, booking_id, created_by, source)
SELECT b.cancelled_at, 'deposit_refund_out', b.security_deposit_refund, b.refund_payment_method, b.branch_id, b.id, b.cancelled_by, 'backfill'
FROM public.bookings b WHERE b.status = 'cancelled' AND COALESCE(b.security_deposit_refund, 0) > 0 AND b.cancelled_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- Returned rentals: deposit settled at return. returned_on is a date, taken at 00:00 IST.
INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, source)
SELECT (r.returned_on::timestamp AT TIME ZONE 'Asia/Kolkata'), 'deposit_retained', r.deposit_deducted, NULL, r.branch_id, r.id, 'backfill'
FROM public.rentals r WHERE r.status = 'returned' AND COALESCE(r.deposit_deducted, 0) > 0 AND r.returned_on IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.ledger_entries (entry_date, kind, amount, method, branch_id, rental_id, source)
SELECT (r.returned_on::timestamp AT TIME ZONE 'Asia/Kolkata'), 'deposit_refund_out', r.deposit_refunded, r.deposit_refund_method, r.branch_id, r.id, 'backfill'
FROM public.rentals r WHERE r.status = 'returned' AND COALESCE(r.deposit_refunded, 0) > 0 AND r.returned_on IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- REPORTING VIEWS (security_invoker so the caller's RLS applies: staff see nothing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_collected_monthly WITH (security_invoker = true) AS
SELECT date_trunc('month', entry_date AT TIME ZONE 'Asia/Kolkata')::date AS month,
       branch_id,
       SUM(CASE WHEN kind IN ('advance_in', 'payment_in', 'deposit_retained', 'adjustment_in') THEN amount
                WHEN kind IN ('advance_refund_out', 'adjustment_out') THEN -amount
                ELSE 0 END) AS collected,
       SUM(CASE WHEN kind = 'deposit_in' THEN amount
                WHEN kind IN ('deposit_refund_out', 'deposit_retained') THEN -amount
                ELSE 0 END) AS deposit_liability_change
FROM public.ledger_entries
GROUP BY 1, 2;

CREATE OR REPLACE VIEW public.v_earned_monthly WITH (security_invoker = true) AS
SELECT date_trunc('month', r.rent_date)::date AS month, r.branch_id, SUM(r.total) AS earned
FROM public.rentals r
WHERE r.status IN ('out', 'returned')
GROUP BY 1, 2
UNION ALL
SELECT date_trunc('month', b.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date, b.branch_id, SUM(b.cancellation_fee)
FROM public.bookings b
WHERE b.status = 'cancelled' AND COALESCE(b.cancellation_fee, 0) > 0
GROUP BY 1, 2;

-- Reconciliation to run after the backfill. Every row must show diff = 0.00.
-- Live figures on 2026-10-14 (qa/reconcile.mjs): cash in 21,754.00, advance refunds 300.00, deposits received 12,566.00, deposit refunds 2,000.00.
-- SELECT 'cash in'  AS what, SUM(amount) AS ledger, 21754.00 AS expected, SUM(amount) - 21754.00 AS diff FROM ledger_entries WHERE kind IN ('advance_in','payment_in')
-- UNION ALL SELECT 'advance refunds', SUM(amount), 300.00,  SUM(amount) - 300.00  FROM ledger_entries WHERE kind = 'advance_refund_out'
-- UNION ALL SELECT 'deposits in',     SUM(amount), 12566.00, SUM(amount) - 12566.00 FROM ledger_entries WHERE kind = 'deposit_in'
-- UNION ALL SELECT 'deposit refunds', SUM(amount), 2000.00, SUM(amount) - 2000.00 FROM ledger_entries WHERE kind = 'deposit_refund_out';

COMMIT;
