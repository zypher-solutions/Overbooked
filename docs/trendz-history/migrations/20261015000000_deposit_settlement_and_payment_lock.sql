-- Migration: 20261015000000_deposit_settlement_and_payment_lock.sql
-- QA_REPORT.md: S4 (rentals), S5, S12, S21, S23.
--   1. rentals gets deposit_deducted / deposit_refunded / deposit_refund_method
--   2. mark_returned_atomic is replaced: the deposit is always settled at return (taken against fees,
--      refunded, or a mix) and the customer may pay any shortfall at once or leave it as a balance due
--   3. record_rental_payment: the only way to add a payment to an existing rental (also on returned ones)
--   4. Trigger: direct API updates can no longer change rental money, status, dates or ownership
--
-- DEPLOY ORDER: run this migration, then deploy the app straight away. The old return screen and the
-- Paid/Partial/Unpaid dropdown call functions/columns that this migration removes or locks.

-- ==============================================================================
-- 1. Deposit settlement columns (existing returned rentals keep 0 / NULL: history is unknown)
-- ==============================================================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_deducted NUMERIC NOT NULL DEFAULT 0 CHECK (deposit_deducted >= 0),
  ADD COLUMN IF NOT EXISTS deposit_refunded NUMERIC NOT NULL DEFAULT 0 CHECK (deposit_refunded >= 0),
  ADD COLUMN IF NOT EXISTS deposit_refund_method TEXT
    CHECK (deposit_refund_method IS NULL OR deposit_refund_method IN ('cash', 'upi', 'card', 'bank_transfer'));

-- ==============================================================================
-- 2. mark_returned_atomic (new signature; the old 12-argument version is dropped)
--    p_total / p_advance / p_payment_status were client-supplied and are no longer accepted.
--
--    D = security deposit held, C = p_extra_fees, X = p_deposit_deducted, P = p_settlement_payment
--      0 <= X <= min(D, C)            deposit taken against fees
--      refund = D - X                 the whole deposit is always settled
--      owed   = total + C - advance - X
--      0 <= P <= owed                 paid now; any remainder stays as a balance due
-- ==============================================================================
DROP FUNCTION IF EXISTS public.mark_returned_atomic(
  uuid, timestamp with time zone, text, text, text, numeric, numeric, numeric, text, jsonb, numeric, text
);

CREATE OR REPLACE FUNCTION public.mark_returned_atomic(
    p_rental_id uuid,
    p_returned_on timestamp with time zone,
    p_condition text,
    p_notes text,
    p_extra_fees numeric,
    p_extra_fees_reason text,
    p_items jsonb,
    p_deposit_deducted numeric,
    p_deposit_refund_method text,
    p_settlement_payment numeric,
    p_payment_method text
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
  v_actual_staff_id UUID;

  v_rental RECORD;
  v_ritem JSONB;
  v_ritem_id UUID;
  v_inv_id UUID;
  v_unit_condition TEXT;
  v_unit_notes TEXT;

  v_valid_mapping BOOLEAN;
  v_missing_count INT;
  v_expected_mapping_count INT;
  v_provided_mapping_count INT;

  v_fees NUMERIC;
  v_deposit NUMERIC;
  v_deducted NUMERIC;
  v_refund NUMERIC;
  v_payment NUMERIC;
  v_final_total NUMERIC;
  v_owed NUMERIC;
  v_final_advance NUMERIC;
  v_final_status TEXT;
BEGIN
  -- ========================================================
  -- AUTHENTICATION & AUTHORIZATION
  -- ========================================================
  v_actual_staff_id := auth.uid();
  IF v_actual_staff_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_active, branch_id INTO v_user_role, v_is_active, v_my_branch_id
  FROM public.profiles WHERE id = v_actual_staff_id;

  IF v_user_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  IF v_user_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role for return operation';
  END IF;

  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_rental.branch_id <> v_my_branch_id) THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  IF v_rental.status = 'returned' THEN
    RAISE EXCEPTION 'Rental is already returned';
  END IF;

  -- ========================================================
  -- MONEY: fees, deposit settlement, payment now
  -- ========================================================
  v_fees := COALESCE(p_extra_fees, 0);
  v_deposit := COALESCE(v_rental.security_deposit, 0);
  v_deducted := COALESCE(p_deposit_deducted, 0);
  v_payment := COALESCE(p_settlement_payment, 0);

  IF v_fees < 0 THEN
    RAISE EXCEPTION 'Extra fees cannot be negative';
  END IF;

  IF v_deducted < 0 THEN
    RAISE EXCEPTION 'Amount taken from deposit cannot be negative';
  END IF;

  IF v_deducted > LEAST(v_deposit, v_fees) THEN
    RAISE EXCEPTION 'Amount taken from deposit (%) cannot exceed the deposit (%) or the fees (%)', v_deducted, v_deposit, v_fees;
  END IF;

  v_refund := v_deposit - v_deducted;

  IF v_refund > 0 AND (p_deposit_refund_method IS NULL OR p_deposit_refund_method NOT IN ('cash', 'upi', 'card', 'bank_transfer')) THEN
    RAISE EXCEPTION 'A valid refund payment method is required to refund the deposit (%)', v_refund;
  END IF;

  v_final_total := v_rental.total + v_fees;
  v_owed := GREATEST(0, v_final_total - COALESCE(v_rental.advance, 0) - v_deducted);

  IF v_payment < 0 THEN
    RAISE EXCEPTION 'Payment cannot be negative';
  END IF;

  IF v_payment > v_owed THEN
    RAISE EXCEPTION 'Payment (%) exceeds the amount owed (%)', v_payment, v_owed;
  END IF;

  IF v_payment > 0 AND (p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'upi', 'card', 'bank_transfer')) THEN
    RAISE EXCEPTION 'A valid payment method is required for the payment (%)', v_payment;
  END IF;

  IF p_returned_on IS NULL OR (p_returned_on AT TIME ZONE 'Asia/Kolkata')::DATE < v_rental.rent_date THEN
    RAISE EXCEPTION 'Return date cannot be before the rental start date (%)', v_rental.rent_date;
  END IF;

  IF p_condition IS NULL OR p_condition NOT IN ('good', 'damaged', 'lost') THEN
    RAISE EXCEPTION 'Invalid condition: %', COALESCE(p_condition, 'NULL');
  END IF;

  v_final_advance := COALESCE(v_rental.advance, 0) + v_deducted + v_payment;

  IF v_final_advance >= v_final_total THEN
    v_final_status := 'paid';
  ELSIF v_final_advance > 0 THEN
    v_final_status := 'partial';
  ELSE
    v_final_status := 'unpaid';
  END IF;

  -- ========================================================
  -- CONCURRENCY LOCK (same key as pickup / extend)
  -- ========================================================
  PERFORM pg_advisory_xact_lock(
      hashtextextended('trendz-rental:' || v_rental.branch_id::TEXT, 0)
  );

  -- ========================================================
  -- INVENTORY RESTORATION & VALIDATION
  -- ========================================================
  SELECT COUNT(*) INTO v_missing_count
  FROM public.rental_items ri
  LEFT JOIN public.rental_item_inventory rii ON ri.id = rii.rental_item_id
  WHERE ri.rental_id = p_rental_id AND rii.rental_item_id IS NULL;

  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot process return: Rental contains legacy items without physical inventory mappings.';
  END IF;

  SELECT COUNT(*) INTO v_expected_mapping_count
  FROM public.rental_item_inventory rii
  JOIN public.rental_items ri ON ri.id = rii.rental_item_id
  WHERE ri.rental_id = p_rental_id;

  v_provided_mapping_count := COALESCE(jsonb_array_length(p_items), 0);

  IF v_provided_mapping_count != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Inventory mismatch: Expected % physical items, received % in return payload.', v_expected_mapping_count, v_provided_mapping_count;
  END IF;

  IF (SELECT COUNT(DISTINCT CONCAT(value->>'rental_item_id', '-', value->>'inventory_item_id'))
      FROM jsonb_array_elements(p_items) AS value) != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Cannot return rental: duplicate physical inventory mappings in payload.';
  END IF;

  FOR v_ritem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ritem_id := NULLIF(v_ritem->>'rental_item_id', '')::UUID;
    v_inv_id := NULLIF(v_ritem->>'inventory_item_id', '')::UUID;
    v_unit_condition := v_ritem->>'condition';
    v_unit_notes := v_ritem->>'return_notes';

    IF v_ritem_id IS NULL OR v_inv_id IS NULL THEN
      RAISE EXCEPTION 'Cannot return rental: Missing rental_item_id or inventory_item_id in payload.';
    END IF;

    IF v_unit_condition IS NULL OR v_unit_condition NOT IN ('good', 'damaged', 'lost') THEN
      RAISE EXCEPTION 'Invalid condition for inventory item %: %', v_inv_id, COALESCE(v_unit_condition, 'NULL');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.rental_item_inventory rii
      JOIN public.rental_items ri ON ri.id = rii.rental_item_id
      WHERE ri.rental_id = p_rental_id
        AND rii.rental_item_id = v_ritem_id
        AND rii.inventory_item_id = v_inv_id
    ) INTO v_valid_mapping;

    IF NOT v_valid_mapping THEN
      RAISE EXCEPTION 'Cannot return rental: Invalid or foreign inventory mapping supplied for rental item % and inventory item %.', v_ritem_id, v_inv_id;
    END IF;

    UPDATE public.rental_item_inventory SET
      condition = v_unit_condition,
      return_notes = v_unit_notes,
      returned_at = p_returned_on
    WHERE rental_item_id = v_ritem_id AND inventory_item_id = v_inv_id;

    UPDATE public.inventory_items SET status = 'available' WHERE id = v_inv_id;
  END LOOP;

  -- ========================================================
  -- RENTAL UPDATE
  -- ========================================================
  UPDATE public.rentals SET
    status = 'returned',
    payment_status = v_final_status,
    condition = p_condition,
    returned_on = (p_returned_on AT TIME ZONE 'Asia/Kolkata')::DATE,
    total = v_final_total,
    advance = v_final_advance,
    notes = p_notes,
    extra_fees = v_fees,
    extra_fees_reason = p_extra_fees_reason,
    deposit_deducted = v_deducted,
    deposit_refunded = v_refund,
    deposit_refund_method = CASE WHEN v_refund > 0 THEN p_deposit_refund_method ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_rental_id;

  -- Only money actually received becomes a payment row (the deposit deduction and the refund do not)
  IF v_payment > 0 THEN
    INSERT INTO public.payments (rental_id, amount, method, paid_at, recorded_by)
    VALUES (p_rental_id, v_payment, p_payment_method, NOW(), v_actual_staff_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_final_total,
    'advance', v_final_advance,
    'payment_status', v_final_status,
    'deposit_deducted', v_deducted,
    'deposit_refunded', v_refund,
    'balance_due', GREATEST(0, v_final_total - v_final_advance)
  );
END;
$$;

-- ==============================================================================
-- 3. record_rental_payment: the only way to add money to an existing rental.
--    Works for 'out' and 'returned' rentals (a shortfall can be collected after the return).
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.record_rental_payment(
    p_rental_id uuid,
    p_amount numeric,
    p_method text
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID;
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
  v_rental RECORD;
  v_balance NUMERIC;
  v_new_advance NUMERIC;
  v_new_status TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_active, branch_id INTO v_user_role, v_is_active, v_my_branch_id
  FROM public.profiles WHERE id = v_uid;

  IF v_user_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  IF v_user_role NOT IN ('super_admin', 'owner', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Invalid role for recording payments';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', COALESCE(p_method, 'NULL');
  END IF;

  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_rental.branch_id <> v_my_branch_id) THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  -- total already includes any return fees
  v_balance := GREATEST(0, v_rental.total - COALESCE(v_rental.advance, 0));

  IF v_balance = 0 THEN
    RAISE EXCEPTION 'This rental has no balance due';
  END IF;

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Payment (%) exceeds the balance due (%)', p_amount, v_balance;
  END IF;

  v_new_advance := COALESCE(v_rental.advance, 0) + p_amount;

  IF v_new_advance >= v_rental.total THEN
    v_new_status := 'paid';
  ELSIF v_new_advance > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  INSERT INTO public.payments (rental_id, amount, method, paid_at, recorded_by)
  VALUES (p_rental_id, p_amount, p_method, NOW(), v_uid);

  UPDATE public.rentals
  SET advance = v_new_advance,
      payment_status = v_new_status,
      updated_at = NOW()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'advance', v_new_advance,
    'payment_status', v_new_status,
    'balance_due', GREATEST(0, v_rental.total - v_new_advance)
  );
END;
$$;

-- ==============================================================================
-- 4. Rentals: direct API updates may only change notes.
--    RPCs run as their owner (SECURITY DEFINER), so current_user is only anon/authenticated for direct calls.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.guard_rental_direct_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.advance IS DISTINCT FROM OLD.advance
    OR NEW.security_deposit IS DISTINCT FROM OLD.security_deposit
    OR NEW.extra_fees IS DISTINCT FROM OLD.extra_fees
    OR NEW.extra_fees_reason IS DISTINCT FROM OLD.extra_fees_reason
    OR NEW.deposit_deducted IS DISTINCT FROM OLD.deposit_deducted
    OR NEW.deposit_refunded IS DISTINCT FROM OLD.deposit_refunded
    OR NEW.deposit_refund_method IS DISTINCT FROM OLD.deposit_refund_method
    OR NEW.rent_date IS DISTINCT FROM OLD.rent_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.returned_on IS DISTINCT FROM OLD.returned_on
    OR NEW.condition IS DISTINCT FROM OLD.condition
    OR NEW.buffer_days IS DISTINCT FROM OLD.buffer_days
    OR NEW.actual_pickup_at IS DISTINCT FROM OLD.actual_pickup_at
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
    OR NEW.token IS DISTINCT FROM OLD.token
  ) THEN
    RAISE EXCEPTION 'Rental amounts, dates and status can only be changed through the rental workflows';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_rental_direct_update ON public.rentals;
CREATE TRIGGER trg_guard_rental_direct_update
  BEFORE UPDATE ON public.rentals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_rental_direct_update();

-- ==============================================================================
-- Grants: authenticated only
-- ==============================================================================
REVOKE ALL ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, numeric, text, jsonb, numeric, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, numeric, text, jsonb, numeric, text, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_rental_payment(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_rental_payment(uuid, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
