-- Migration: 20261006000000_rental_extension_and_hardened_returns.sql

-- 1. HARDEN mark_returned_atomic
CREATE OR REPLACE FUNCTION public.mark_returned_atomic(
    p_rental_id uuid,
    p_returned_on timestamp with time zone,
    p_payment_status text,
    p_condition text,
    p_notes text,
    p_total numeric,
    p_advance numeric,
    p_extra_fees numeric,
    p_extra_fees_reason text,
    p_items jsonb,
    p_settlement_payment numeric,
    p_payment_method text
) RETURNS void
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
  v_item_record RECORD;
  v_ritem JSONB;
  v_ritem_id UUID;
  v_inv_id UUID;
  v_unit_condition TEXT;
  v_unit_notes TEXT;
  
  v_fallback_inv_ids UUID[];
  v_fallback_inv_id UUID;
  v_valid_mapping BOOLEAN;
  v_expected_mapping_count INT;
  v_provided_mapping_count INT;

  v_final_total NUMERIC;
  v_final_advance NUMERIC;
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

  IF v_user_role IS NULL OR NOT v_is_active THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  -- 1. Load Rental securely
  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND v_rental.branch_id != v_my_branch_id THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  IF v_rental.status = 'returned' THEN
    RAISE EXCEPTION 'Rental is already returned';
  END IF;

  -- ========================================================
  -- FINANCIAL SECURITY HARDENING
  -- ========================================================
  IF COALESCE(p_extra_fees, 0) < 0 THEN
    RAISE EXCEPTION 'Extra fees cannot be negative';
  END IF;

  v_final_total := v_rental.total + COALESCE(p_extra_fees, 0);

  IF p_total < v_rental.total THEN
    RAISE EXCEPTION 'Cannot reduce original rental total. Expected at least %, received %', v_rental.total, p_total;
  END IF;

  v_final_advance := COALESCE(v_rental.advance, 0) + COALESCE(p_settlement_payment, 0);

  -- ========================================================
  -- CONCURRENCY LOCK
  -- ========================================================
  -- Lock branch to prevent simultaneous rentals/returns from scrambling inventory
  PERFORM pg_advisory_xact_lock(
      hashtextextended('trendz-rental:' || v_rental.branch_id::TEXT, 0)
  );

  -- ========================================================
  -- INVENTORY RESTORATION & VALIDATION
  -- ========================================================
  
  -- 1. Process LEGACY fallback for missing mappings 
  SELECT array_agg(ri.id) INTO v_fallback_inv_ids
  FROM public.rental_items ri
  LEFT JOIN public.rental_item_inventory rii ON ri.id = rii.rental_item_id
  WHERE ri.rental_id = p_rental_id AND rii.rental_item_id IS NULL;

  IF array_length(v_fallback_inv_ids, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot process return: Rental contains legacy items without physical inventory mappings.';
  END IF;

  -- 2. Validate exact payload match
  SELECT COUNT(*) INTO v_expected_mapping_count 
  FROM public.rental_item_inventory rii
  JOIN public.rental_items ri ON ri.id = rii.rental_item_id
  WHERE ri.rental_id = p_rental_id;

  v_provided_mapping_count := jsonb_array_length(p_items);

  IF v_provided_mapping_count != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Inventory mismatch: Expected % physical items, received % in return payload.', v_expected_mapping_count, v_provided_mapping_count;
  END IF;

  -- 3. Iterate payload and restore inventory securely
  FOR v_ritem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ritem_id := (v_ritem->>'rental_item_id')::UUID;
    v_inv_id := (v_ritem->>'inventory_item_id')::UUID;
    v_unit_condition := v_ritem->>'condition';
    v_unit_notes := v_ritem->>'return_notes';

    -- VALIDATION A: rental_item_id must belong to p_rental_id
    -- VALIDATION B: inventory_item_id must be mapped to that exact rental item
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
    payment_status = p_payment_status,
    condition = p_condition,
    returned_on = p_returned_on,
    total = v_final_total,    -- Authoritative
    advance = v_final_advance, -- Authoritative
    notes = p_notes,
    extra_fees = p_extra_fees,
    extra_fees_reason = p_extra_fees_reason
  WHERE id = p_rental_id;

  -- Insert settlement payment if applicable
  IF COALESCE(p_settlement_payment, 0) > 0 THEN
    IF p_payment_method IS NULL OR p_payment_method = '' THEN
      RAISE EXCEPTION 'Payment method required for settlement payment';
    END IF;
    INSERT INTO public.payments (
      rental_id, amount, method, paid_at, recorded_by
    ) VALUES (
      p_rental_id, p_settlement_payment, p_payment_method, NOW(), v_actual_staff_id
    );
  END IF;

END;
$$;


-- 2. IMPLEMENT extend_rental_atomic
CREATE OR REPLACE FUNCTION public.extend_rental_atomic(
    p_rental_id uuid,
    p_new_due_date date,
    p_payment_amount numeric,
    p_payment_method text,
    p_notes text DEFAULT NULL
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
  v_item RECORD;
  v_inv RECORD;
  
  v_additional_days INT;
  v_additional_amount NUMERIC := 0;
  v_new_total NUMERIC;
  v_new_advance NUMERIC;
  v_new_payment_status TEXT;
  v_conflict_count INT;
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

  IF v_user_role IS NULL OR NOT v_is_active THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  -- 1. Load Rental securely
  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND v_rental.branch_id != v_my_branch_id THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  IF v_rental.status != 'out' THEN
    RAISE EXCEPTION 'Only active rentals can be extended (Current status: %)', v_rental.status;
  END IF;

  -- Validate Dates
  IF p_new_due_date IS NULL THEN
    RAISE EXCEPTION 'New due date is required';
  END IF;

  IF p_new_due_date <= v_rental.due_date THEN
    RAISE EXCEPTION 'New due date (%) must be after current due date (%)', p_new_due_date, v_rental.due_date;
  END IF;

  v_additional_days := (p_new_due_date - v_rental.due_date);

  -- ========================================================
  -- EXTENSION CONFLICT CHECK
  -- ========================================================
  FOR v_item IN (SELECT * FROM public.rental_items WHERE rental_id = p_rental_id) LOOP
    
    v_additional_amount := v_additional_amount + (v_item.daily_rate * v_item.qty * v_additional_days);
    
    FOR v_inv IN (SELECT inventory_item_id FROM public.rental_item_inventory WHERE rental_item_id = v_item.id) LOOP
      
      -- Check future bookings using exact same overlap semantic
      -- existing_booking.pickup_date <= new_due_date + buffer_days
      -- AND existing_booking.return_date + buffer_days >= current_due_date
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.booking_item_inventory bii
      JOIN public.booking_items bi ON bi.id = bii.booking_item_id
      JOIN public.bookings b ON b.id = bi.booking_id
      WHERE bii.inventory_item_id = v_inv.inventory_item_id
        AND b.status IN ('confirmed', 'pending')
        AND bi.pickup_date <= (p_new_due_date + COALESCE(v_rental.buffer_days, 0))
        AND (bi.return_date + COALESCE(bi.buffer_days, 0)) >= v_rental.due_date;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Cannot extend rental: Physical unit % is reserved for another booking during the requested extension interval.', v_inv.inventory_item_id;
      END IF;

    END LOOP;
    
    -- Update the rental item's subtotal and days
    UPDATE public.rental_items 
    SET days = days + v_additional_days,
        subtotal = subtotal + (v_item.daily_rate * v_item.qty * v_additional_days)
    WHERE id = v_item.id;

  END LOOP;

  -- ========================================================
  -- PAYMENT AND TOTALS
  -- ========================================================
  IF COALESCE(p_payment_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Extension payment amount cannot be negative';
  END IF;

  v_new_total := v_rental.total + v_additional_amount;
  v_new_advance := COALESCE(v_rental.advance, 0) + COALESCE(p_payment_amount, 0);

  IF v_new_advance >= (v_new_total + COALESCE(v_rental.extra_fees, 0)) THEN
    v_new_payment_status := 'paid';
  ELSIF v_new_advance > 0 THEN
    v_new_payment_status := 'partial';
  ELSE
    v_new_payment_status := 'unpaid';
  END IF;

  -- Insert extension payment
  IF COALESCE(p_payment_amount, 0) > 0 THEN
    IF p_payment_method IS NULL OR p_payment_method = '' THEN
      RAISE EXCEPTION 'Payment method is required for extension payment';
    END IF;
    INSERT INTO public.payments (
      rental_id, amount, method, paid_at, recorded_by
    ) VALUES (
      p_rental_id, p_payment_amount, p_payment_method, NOW(), v_actual_staff_id
    );
  END IF;

  -- Update rental
  UPDATE public.rentals 
  SET due_date = p_new_due_date,
      total = v_new_total,
      advance = v_new_advance,
      payment_status = v_new_payment_status,
      notes = CASE WHEN p_notes IS NOT NULL THEN p_notes ELSE notes END
  WHERE id = p_rental_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_due_date', v_rental.due_date,
    'new_due_date', p_new_due_date,
    'additional_days', v_additional_days,
    'additional_amount', v_additional_amount,
    'new_total', v_new_total,
    'payment_recorded', COALESCE(p_payment_amount, 0)
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, text, numeric, numeric, numeric, text, jsonb, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_rental_atomic(uuid, date, numeric, text, text) TO authenticated;
