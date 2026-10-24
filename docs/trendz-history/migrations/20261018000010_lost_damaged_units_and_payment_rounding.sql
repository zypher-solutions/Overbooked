-- STATUS: APPLIED (live, verified 2026-10-18: mark_returned_atomic has the S24 change, record_rental_payment rounds).
-- Fixes from the Phase 1-4 QA findings. Backward compatible: same function signatures, no schema change.
--   S24   mark_returned_atomic: units returned as 'lost' stay 'lost', 'damaged' go to 'maintenance'
--         (before, every returned unit became 'available' and could be booked again).
--   P3-1  record_rental_payment: rounds the amount to paise and returns the stored advance/balance,
--         so the response matches what the database holds (before: 10.005 was stored as 10.01 but returned as 10.005).
-- Both bodies are copied from 20261015000000_deposit_settlement_and_payment_lock.sql with only the lines above changed.
-- Not covered here: putting a repaired unit back to 'available' is still a manual inventory change.
-- Verify after applying: return a QA- rental with one 'lost' unit, then check inventory_items.status = 'lost'.
BEGIN;

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

    -- S24: a lost unit stays 'lost' and a damaged one goes to 'maintenance' (the app already shows it that way)
    UPDATE public.inventory_items
    SET status = CASE v_unit_condition WHEN 'lost' THEN 'lost' WHEN 'damaged' THEN 'maintenance' ELSE 'available' END
    WHERE id = v_inv_id;
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

  v_new_advance := ROUND(COALESCE(v_rental.advance, 0) + ROUND(p_amount, 2), 2);

  IF v_new_advance >= v_rental.total THEN
    v_new_status := 'paid';
  ELSIF v_new_advance > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  INSERT INTO public.payments (rental_id, amount, method, paid_at, recorded_by)
  VALUES (p_rental_id, ROUND(p_amount, 2), p_method, NOW(), v_uid);

  UPDATE public.rentals
  SET advance = v_new_advance,
      payment_status = v_new_status,
      updated_at = NOW()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'advance', v_new_advance,
    'payment_status', v_new_status,
    'balance_due', ROUND(GREATEST(0, v_rental.total - v_new_advance), 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, numeric, text, jsonb, numeric, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, numeric, text, jsonb, numeric, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_rental_payment(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_rental_payment(uuid, numeric, text) TO authenticated;

COMMIT;
