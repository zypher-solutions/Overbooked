-- Migration: 20261014000000_security_hardening.sql
-- Fixes from QA_REPORT.md (Security): S1, S6, S7, S8, S9, S10, S11, S15, S16 and the bookings half of S4.
-- Function bodies are the latest versions from earlier migrations with targeted changes only.
-- NOT included (need app changes first): rentals money-column lock (S4) and "mark as paid" (S5).

-- ==============================================================================
-- S1: get_staff_emails leaked to callers without a profile (NULL != 'super_admin' is not true)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_staff_emails()
RETURNS TABLE (id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_role text;
  v_is_active boolean;
BEGIN
  SELECT role, is_active INTO v_role, v_is_active FROM public.profiles WHERE profiles.id = auth.uid();

  IF v_role IS DISTINCT FROM 'super_admin' OR v_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only super_admin can fetch staff emails';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id;
END;
$$;

-- ==============================================================================
-- S6 + S15: pickup_booking_atomic — branch check and is_active check were NULL-unsafe
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.pickup_booking_atomic(
    p_booking_id uuid,
    p_expected_return_date date,
    p_pickup_payment numeric,
    p_staff_id uuid,
    p_payment_method text
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
  v_actual_staff_id UUID;

  v_booking RECORD;
  v_rental_id UUID;
  v_rental_token TEXT;
  v_item RECORD;
  v_inv RECORD;
  v_inv_status TEXT;
  v_total_paid NUMERIC;
  v_payment_status TEXT;
  v_due_date DATE;
  v_buffer_days INT;
  v_days INT;
  v_assigned_count INT;
  v_conflict_count INT;
  v_raw_count INT;
  v_new_rental_total NUMERIC;
  v_subtotal NUMERIC;
  v_original_days INT;
  v_actual_days INT;
  v_rental_item_id UUID;
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
    RAISE EXCEPTION 'Invalid role for pickup operation';
  END IF;

  -- Validate expected return date
  IF p_expected_return_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE THEN
    RAISE EXCEPTION 'Expected return date cannot be in the past.';
  END IF;

  -- 1. Validate Booking exists (FOR UPDATE securely locks the row against concurrent pickups)
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_booking.branch_id <> v_my_branch_id) THEN
    RAISE EXCEPTION 'Unauthorized branch operation';
  END IF;

  -- 2 & 3. Validate Booking state (prevents double pickup)
  IF v_booking.status != 'confirmed' AND v_booking.status != 'pending' THEN
    RAISE EXCEPTION 'Booking cannot be picked up (Current status: %)', v_booking.status;
  END IF;

  IF p_payment_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  -- 4. Dynamically recalculate new rental total based on early pickup rule
  v_new_rental_total := 0;
  FOR v_item IN (SELECT * FROM public.booking_items WHERE booking_id = p_booking_id) LOOP
    v_original_days := GREATEST(1, (v_item.return_date::DATE - v_item.pickup_date::DATE));
    v_actual_days := GREATEST(1, (p_expected_return_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE));
    v_days := GREATEST(v_original_days, v_actual_days);
    v_new_rental_total := v_new_rental_total + (v_item.daily_rate * v_item.qty * v_days);
  END LOOP;

  -- 5. Validate payment against the dynamically recalculated total
  IF p_pickup_payment < 0 THEN
    RAISE EXCEPTION 'Pickup payment cannot be negative';
  END IF;

  IF p_pickup_payment <> GREATEST(0::numeric, v_new_rental_total - COALESCE(v_booking.advance, 0)) THEN
    RAISE EXCEPTION 'Pickup payment must equal the remaining balance (Expected: %, Received: %)', GREATEST(0::numeric, v_new_rental_total - COALESCE(v_booking.advance, 0)), p_pickup_payment;
  END IF;

  -- Generate token RN-XXXX
  v_rental_token := 'RN-' || upper(substr(md5(random()::text), 1, 4));

  v_total_paid := v_booking.advance + p_pickup_payment;
  IF v_total_paid >= v_new_rental_total THEN
    v_payment_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_payment_status := 'partial';
  ELSE
    v_payment_status := 'unpaid';
  END IF;

  -- Get buffer days from the first item (assuming common across booking)
  SELECT MAX(buffer_days) INTO v_buffer_days FROM public.booking_items WHERE booking_id = p_booking_id;
  v_due_date := p_expected_return_date;

  -- Create rental with ACTUAL pickup timestamps and secure staff_id
  INSERT INTO public.rentals (
    token, customer_id, branch_id, staff_id, rent_date, actual_pickup_at, due_date, buffer_days,
    total, advance, security_deposit, payment_status, status, notes
  ) VALUES (
    v_rental_token, v_booking.customer_id, v_booking.branch_id, v_actual_staff_id, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE, NOW(), 
    v_due_date, COALESCE(v_buffer_days, 0),
    v_new_rental_total, v_total_paid, v_booking.security_deposit, v_payment_status, 'out', v_booking.notes
  ) RETURNING id INTO v_rental_id;

  -- Create payment record matching exactly the existing payments schema
  IF p_pickup_payment > 0 THEN
    INSERT INTO public.payments (
      rental_id, amount, method, paid_at, recorded_by
    ) VALUES (
      v_rental_id, p_pickup_payment, p_payment_method, NOW(), v_actual_staff_id
    );
  END IF;

  -- Create rental_items and rental_item_inventory
  FOR v_item IN (SELECT * FROM public.booking_items WHERE booking_id = p_booking_id) LOOP
    
    -- Validate exact physical units assigned matches qty uniquely and check for duplicates
    SELECT COUNT(*), COUNT(DISTINCT inventory_item_id) INTO v_raw_count, v_assigned_count FROM public.booking_item_inventory WHERE booking_item_id = v_item.id;
    IF v_raw_count != v_assigned_count THEN
      RAISE EXCEPTION 'Booking item % contains duplicate physical-unit assignments. Please correct inventory assignment before pickup.', v_item.id;
    END IF;
    IF v_assigned_count != v_item.qty THEN
      RAISE EXCEPTION 'Booking item % requires % unique physical units but has % assigned. Please complete unit assignment before pickup.', v_item.id, v_item.qty, v_assigned_count;
    END IF;

    -- Calculate billed days and subtotal based on dynamic early pickup pricing
    v_original_days := GREATEST(1, (v_item.return_date::DATE - v_item.pickup_date::DATE));
    v_actual_days := GREATEST(1, (p_expected_return_date - (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE));
    v_days := GREATEST(v_original_days, v_actual_days);
    v_subtotal := v_item.daily_rate * v_item.qty * v_days;
    
    INSERT INTO public.rental_items (
      rental_id, product_id, variation_id, product_name, sku, image_url, qty, daily_rate, subtotal, days
    ) VALUES (
      v_rental_id, v_item.product_id, v_item.variation_id, v_item.product_name, v_item.sku, v_item.image_url, v_item.qty, v_item.daily_rate, v_subtotal, v_days
    ) RETURNING id INTO v_rental_item_id;

    -- Process each assigned physical unit
    FOR v_inv IN (SELECT inventory_item_id FROM public.booking_item_inventory WHERE booking_item_id = v_item.id) LOOP
      
      -- Lock row and validate physical units exist and are in a valid state
      SELECT status INTO v_inv_status FROM public.inventory_items WHERE id = v_inv.inventory_item_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Assigned inventory item % not found', v_inv.inventory_item_id;
      END IF;

      IF v_inv_status IN ('rented', 'lost', 'maintenance') THEN
        RAISE EXCEPTION 'Assigned inventory item % is currently %, cannot be rented', v_inv.inventory_item_id, v_inv_status;
      END IF;

      -- Check for conflicts against future bookings based on early pickup and new expected return date
      SELECT COUNT(*) INTO v_conflict_count
      FROM public.booking_item_inventory bii
      JOIN public.booking_items bi ON bi.id = bii.booking_item_id
      JOIN public.bookings b ON b.id = bi.booking_id
      WHERE bii.inventory_item_id = v_inv.inventory_item_id
      AND b.status IN ('confirmed', 'pending')
      AND b.id != p_booking_id
      AND bi.pickup_date <= (p_expected_return_date + COALESCE(v_item.buffer_days, 0))
      AND (bi.return_date + COALESCE(bi.buffer_days, 0)) >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;

      IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Cannot use physical unit % until %. It is reserved for another booking during this interval.', v_inv.inventory_item_id, (p_expected_return_date + COALESCE(v_item.buffer_days, 0));
      END IF;

      INSERT INTO public.rental_item_inventory (rental_item_id, inventory_item_id)
      VALUES (v_rental_item_id, v_inv.inventory_item_id);

      -- Change physical inventory to rented within the transaction
      UPDATE public.inventory_items SET status = 'rented' WHERE id = v_inv.inventory_item_id;
    END LOOP;
  END LOOP;

  -- Update booking
  UPDATE public.bookings SET status = 'completed' WHERE id = p_booking_id;

  RETURN v_rental_id;
END;
$$;

-- ==============================================================================
-- S6 + S8 + S15: mark_returned_atomic — NULL-safe branch/active checks, no negative or
-- over-balance settlement, validated method, return date >= rent date, server-derived
-- payment status, NULL/duplicate payload rejected
-- ==============================================================================
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

  -- 1. Load Rental securely
  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_rental.branch_id <> v_my_branch_id) THEN
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

  IF COALESCE(p_settlement_payment, 0) < 0 THEN
    RAISE EXCEPTION 'Settlement payment cannot be negative';
  END IF;

  IF COALESCE(p_settlement_payment, 0) > GREATEST(0, v_final_total - COALESCE(v_rental.advance, 0)) THEN
    RAISE EXCEPTION 'Settlement payment (%) exceeds balance due (%)', p_settlement_payment, GREATEST(0, v_final_total - COALESCE(v_rental.advance, 0));
  END IF;

  IF COALESCE(p_settlement_payment, 0) > 0 AND p_payment_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

  IF p_returned_on IS NULL OR (p_returned_on AT TIME ZONE 'Asia/Kolkata')::DATE < v_rental.rent_date THEN
    RAISE EXCEPTION 'Return date cannot be before the rental start date (%)', v_rental.rent_date;
  END IF;

  v_final_advance := COALESCE(v_rental.advance, 0) + COALESCE(p_settlement_payment, 0);

  -- Payment status is derived server-side; p_payment_status is ignored (kept for signature compatibility)
  IF v_final_advance >= v_final_total THEN
    v_final_status := 'paid';
  ELSIF v_final_advance > 0 THEN
    v_final_status := 'partial';
  ELSE
    v_final_status := 'unpaid';
  END IF;

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

  -- NULL payload previously skipped this check and left units stuck as 'rented'
  v_provided_mapping_count := COALESCE(jsonb_array_length(p_items), 0);

  IF v_provided_mapping_count != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Inventory mismatch: Expected % physical items, received % in return payload.', v_expected_mapping_count, v_provided_mapping_count;
  END IF;

  IF (SELECT COUNT(DISTINCT CONCAT(value->>'rental_item_id', '-', value->>'inventory_item_id'))
      FROM jsonb_array_elements(p_items) AS value) != v_expected_mapping_count THEN
    RAISE EXCEPTION 'Cannot return rental: duplicate physical inventory mappings in payload.';
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
    payment_status = v_final_status,
    condition = p_condition,
    -- returned_on is a DATE column: take the business-day date, not the UTC date
    returned_on = (p_returned_on AT TIME ZONE 'Asia/Kolkata')::DATE,
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

-- ==============================================================================
-- S6 + S15: extend_rental_atomic — NULL-safe checks, validated method, no overpayment
-- ==============================================================================
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

  IF v_user_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
    RAISE EXCEPTION 'Unauthorized or inactive profile';
  END IF;

  -- 1. Load Rental securely
  SELECT * INTO v_rental FROM public.rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Branch Authorization
  IF v_user_role IN ('manager', 'staff') AND (v_my_branch_id IS NULL OR v_rental.branch_id <> v_my_branch_id) THEN
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

  IF COALESCE(p_payment_amount, 0) > 0 AND v_new_advance > (v_new_total + COALESCE(v_rental.extra_fees, 0)) THEN
    RAISE EXCEPTION 'Extension payment (%) exceeds balance due (%)', p_payment_amount,
      GREATEST(0, v_new_total + COALESCE(v_rental.extra_fees, 0) - COALESCE(v_rental.advance, 0));
  END IF;

  IF COALESCE(p_payment_amount, 0) > 0 AND p_payment_method NOT IN ('cash', 'upi', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
  END IF;

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

-- ==============================================================================
-- S7 + S9: create_booking_atomic (10-arg, the one the app calls) — inactive users blocked,
-- no negative rates/subtotals, unit must belong to the item's variation, total = sum of items
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
    p_token text,
    p_customer_id uuid,
    p_branch_id uuid,
    p_booking_date date,
    p_notes text,
    p_created_by uuid,
    p_total numeric,
    p_advance numeric,
    p_security_deposit numeric,
    p_items jsonb
) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $$
DECLARE
    v_auth_uid UUID;
    v_caller_role TEXT;
    v_caller_branch UUID;
    v_effective_created_by UUID;

    v_booking_id UUID;
    v_item JSONB;
    v_booking_item_id UUID;

    v_product_id UUID;
    v_variation_id UUID;

    v_product_name TEXT;
    v_sku TEXT;
    v_image_url TEXT;

    v_qty INTEGER;
    v_daily_rate NUMERIC;
    v_pickup_date DATE;
    v_return_date DATE;
    v_buffer_days INTEGER;
    v_subtotal NUMERIC;

    v_inventory_ids UUID[];
    v_inventory_id UUID;

    v_requested_end DATE;
    v_duplicate_count INTEGER;
    v_caller_active BOOLEAN;
    v_items_total NUMERIC := 0;
BEGIN
    -- Authentication and Authorization Verification
    v_auth_uid := auth.uid();

    IF v_auth_uid IS NULL THEN
        -- Allow service_role context (e.g. backend administrative tasks), but reject unauthenticated / anonymous
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            RAISE EXCEPTION 'Unauthorized: Authentication required to create bookings';
        END IF;
        v_effective_created_by := p_created_by;
    ELSE
        SELECT role, branch_id, is_active INTO v_caller_role, v_caller_branch, v_caller_active
        FROM public.profiles
        WHERE id = v_auth_uid;

        IF v_caller_role IS NULL THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile not found';
        END IF;

        IF NOT COALESCE(v_caller_active, false) THEN
            RAISE EXCEPTION 'Unauthorized: Caller profile is inactive';
        END IF;

        IF v_caller_role IN ('manager', 'staff') THEN
            IF p_branch_id IS DISTINCT FROM v_caller_branch AND p_branch_id IS DISTINCT FROM public.get_my_branch() THEN
                RAISE EXCEPTION 'Unauthorized: Cannot create bookings for another branch';
            END IF;

            -- Prevent employee impersonation: staff and manager bookings must be attributed to the authenticated caller
            IF p_created_by IS NOT NULL AND p_created_by <> v_auth_uid THEN
                RAISE EXCEPTION 'Unauthorized: Cannot create bookings on behalf of another employee';
            END IF;

            v_effective_created_by := v_auth_uid;
        ELSIF v_caller_role IN ('super_admin', 'owner') THEN
            v_effective_created_by := COALESCE(p_created_by, v_auth_uid);
            IF v_effective_created_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_effective_created_by) THEN
                RAISE EXCEPTION 'Invalid created_by user ID';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unauthorized: Role % not permitted to create bookings', v_caller_role;
        END IF;
    END IF;

    -- Input Validation
    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'Customer is required';
    END IF;

    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'Branch is required';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Booking must contain at least one item';
    END IF;

    IF COALESCE(p_total, 0) < 0 THEN
        RAISE EXCEPTION 'Total cannot be negative';
    END IF;

    IF COALESCE(p_advance, 0) < 0 THEN
        RAISE EXCEPTION 'Advance paid cannot be negative';
    END IF;

    IF COALESCE(p_security_deposit, 0) < 0 THEN
        RAISE EXCEPTION 'Security deposit cannot be negative';
    END IF;

    IF COALESCE(p_advance, 0) > COALESCE(p_total, 0) THEN
        RAISE EXCEPTION 'Advance paid cannot exceed total rental amount';
    END IF;

    -- Concurrency Lock per branch
    PERFORM pg_advisory_xact_lock(
        hashtextextended('trendz-booking:' || p_branch_id::TEXT, 0)
    );

    -- Create Booking (trigger trg_assign_booking_reference assigns sequential reference)
    INSERT INTO public.bookings (
        token,
        customer_id,
        branch_id,
        booking_date,
        status,
        notes,
        created_by,
        total,
        advance,
        security_deposit
    )
    VALUES (
        NULL, -- Trigger trg_assign_booking_reference assigns sequential reference
        p_customer_id,
        p_branch_id,
        COALESCE(p_booking_date, CURRENT_DATE),
        'confirmed',
        p_notes,
        v_effective_created_by,
        COALESCE(p_total, 0),
        COALESCE(p_advance, 0),
        COALESCE(p_security_deposit, 0)
    )
    RETURNING id INTO v_booking_id;

    -- Process each cart item and physical unit assignments
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
        v_variation_id := NULLIF(v_item->>'variation_id', '')::UUID;
        v_product_name := v_item->>'product_name';
        v_sku := v_item->>'sku';
        v_image_url := v_item->>'image_url';
        v_qty := (v_item->>'qty')::INTEGER;
        v_daily_rate := (v_item->>'daily_rate')::NUMERIC;
        v_pickup_date := (v_item->>'pickup_date')::DATE;
        v_return_date := (v_item->>'return_date')::DATE;
        v_buffer_days := COALESCE((v_item->>'buffer_days')::INTEGER, 0);
        v_subtotal := (v_item->>'subtotal')::NUMERIC;

        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'Quantity must be greater than zero for %', v_product_name;
        END IF;

        -- Prices are negotiated per deal, but never negative
        IF v_daily_rate IS NULL OR v_daily_rate < 0 OR v_subtotal IS NULL OR v_subtotal < 0 THEN
            RAISE EXCEPTION 'Daily rate and subtotal must be zero or more for %', v_product_name;
        END IF;

        v_items_total := v_items_total + v_subtotal;

        IF v_pickup_date IS NULL OR v_return_date IS NULL THEN
            RAISE EXCEPTION 'Pickup and return dates are required for %', v_product_name;
        END IF;

        IF v_return_date < v_pickup_date THEN
            RAISE EXCEPTION 'Return date cannot be earlier than pickup date for %', v_product_name;
        END IF;

        IF v_item->'inventory_item_ids' IS NULL OR jsonb_array_length(v_item->'inventory_item_ids') <> v_qty THEN
            RAISE EXCEPTION 'Item "%" requires exactly % physical unit(s) assigned', v_product_name, v_qty;
        END IF;

        INSERT INTO public.booking_items (
            booking_id,
            product_id,
            variation_id,
            product_name,
            sku,
            image_url,
            qty,
            daily_rate,
            pickup_date,
            return_date,
            buffer_days,
            subtotal
        )
        VALUES (
            v_booking_id,
            v_product_id,
            v_variation_id,
            v_product_name,
            v_sku,
            v_image_url,
            v_qty,
            v_daily_rate,
            v_pickup_date,
            v_return_date,
            v_buffer_days,
            v_subtotal
        )
        RETURNING id INTO v_booking_item_id;

        -- Assign inventory units
        v_inventory_ids := ARRAY(
            SELECT jsonb_array_elements_text(v_item->'inventory_item_ids')::UUID
        );

        SELECT COUNT(*) - COUNT(DISTINCT id_val)
        INTO v_duplicate_count
        FROM unnest(v_inventory_ids) AS id_val;

        IF v_duplicate_count > 0 THEN
            RAISE EXCEPTION 'Duplicate physical units detected within the same item for %', v_product_name;
        END IF;

        v_requested_end := v_return_date + v_buffer_days;

        FOREACH v_inventory_id IN ARRAY v_inventory_ids
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM public.inventory_items ii
                WHERE ii.id = v_inventory_id
                  AND ii.branch_id = p_branch_id
                  AND ii.variation_id = v_variation_id
                  AND ii.status <> 'lost'
                  AND ii.status <> 'maintenance'
            ) THEN
                RAISE EXCEPTION 'Physical unit % is lost, under maintenance, or invalid for this branch', v_inventory_id;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.booking_item_inventory bii
                JOIN public.booking_items bi ON bi.id = bii.booking_item_id
                JOIN public.bookings b ON b.id = bi.booking_id
                WHERE bii.inventory_item_id = v_inventory_id
                  AND b.status IN ('pending', 'confirmed')
                  AND bi.pickup_date <= v_requested_end
                  AND (bi.return_date + bi.buffer_days) >= v_pickup_date
            ) THEN
                RAISE EXCEPTION 'Physical unit % is already booked for overlapping dates', v_inventory_id;
            END IF;

            IF EXISTS (
                SELECT 1
                FROM public.rental_item_inventory rii
                JOIN public.rental_items ri ON ri.id = rii.rental_item_id
                JOIN public.rentals r ON r.id = ri.rental_id
                WHERE rii.inventory_item_id = v_inventory_id
                  AND r.status = 'out'
                  AND r.rent_date <= v_requested_end
                  AND (r.due_date + COALESCE(r.buffer_days, 0)) >= v_pickup_date
            ) THEN
                RAISE EXCEPTION 'Physical unit % is currently rented out for overlapping dates', v_inventory_id;
            END IF;

            INSERT INTO public.booking_item_inventory (
                booking_item_id,
                inventory_item_id
            )
            VALUES (
                v_booking_item_id,
                v_inventory_id
            );
        END LOOP;
    END LOOP;

    -- 0.01 tolerance for JS floating-point sums
    IF abs(v_items_total - COALESCE(p_total, 0)) > 0.01 THEN
        RAISE EXCEPTION 'Booking total (%) does not match sum of item subtotals (%)', p_total, v_items_total;
    END IF;

    RETURN v_booking_id;
END;
$$;

-- S10: unvalidated 8-arg overload; the app only calls the 10-arg version (availability.ts)
DROP FUNCTION IF EXISTS public.create_booking_atomic(text, uuid, uuid, date, text, text, uuid, jsonb);

-- ==============================================================================
-- S7: get_booking_token — inactive users get nothing
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_booking_token(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_token TEXT;
    v_role TEXT;
    v_branch UUID;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();

    -- Deny unauthenticated callers immediately (no arbitrary access or auth bypass)
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Fetch caller role and branch from profiles
    SELECT role, branch_id INTO v_role, v_branch
    FROM public.profiles
    WHERE id = v_user_id AND is_active IS TRUE;

    -- Deny if user has no active profile record
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;

    -- Retrieve token only if caller is authorized for this booking:
    -- 1. super_admin or owner can access any booking
    -- 2. manager or staff can access bookings for their assigned branch
    -- 3. The staff member who created the booking can access it
    SELECT b.token INTO v_token
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND (
          v_role IN ('super_admin', 'owner')
          OR (v_role IN ('manager', 'staff') AND (b.branch_id = v_branch OR b.branch_id = public.get_my_branch()))
          OR b.created_by = v_user_id
      );

    RETURN v_token;
END;
$$;

-- ==============================================================================
-- S15 + S16: import_products_atomic — NULL-safe active check, no negative rates or stock
-- ==============================================================================
CREATE OR REPLACE FUNCTION "public"."import_products_atomic"("p_payload" jsonb) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public, pg_catalog
    AS $$
DECLARE
  v_cat JSONB;
  v_prod JSONB;
  v_var JSONB;
  v_cat_id UUID;
  v_prod_id UUID;
  v_var_id UUID;
  v_branch_id UUID;
  v_branch_name TEXT;
  v_stock_qty INTEGER;
  
  v_existing_prod RECORD;
  v_existing_var RECORD;
  
  v_existing_inv_count INTEGER;
  v_qty_to_create INTEGER;
  v_next_suffix INTEGER;
  v_max_suffix INTEGER;
  v_item_sku TEXT;
  
  v_cats_created INTEGER := 0;
  v_prods_created INTEGER := 0;
  v_vars_created INTEGER := 0;
  v_units_created INTEGER := 0;
  
  v_user_role TEXT;
  v_is_active BOOLEAN;
  v_my_branch_id UUID;
BEGIN
  -- 0. Authorization Check
  SELECT role, is_active, branch_id INTO v_user_role, v_is_active, v_my_branch_id
  FROM public.profiles 
  WHERE id = auth.uid();

  IF v_user_role IS NULL OR v_is_active IS NOT TRUE OR v_user_role NOT IN ('super_admin', 'owner', 'manager') THEN
    RAISE EXCEPTION 'You are not authorized to import products.';
  END IF;

  IF v_user_role = 'manager' AND v_my_branch_id IS NULL THEN
    RAISE EXCEPTION 'Manager must be assigned to a branch.';
  END IF;

  -- 1. Create categories that are listed in newCategories
  FOR v_cat IN SELECT * FROM jsonb_array_elements(p_payload->'newCategories') LOOP
    SELECT id INTO v_cat_id FROM categories WHERE lower(name) = lower(v_cat->>'name');
    IF v_cat_id IS NULL THEN
      INSERT INTO categories (id, name, base_sku) 
      VALUES (
        gen_random_uuid(), 
        v_cat->>'name', 
        v_cat->>'prefix'
      );
      v_cats_created := v_cats_created + 1;
    END IF;
  END LOOP;
  
  -- 2. Iterate products
  FOR v_prod IN SELECT * FROM jsonb_array_elements(p_payload->'products') LOOP
    SELECT id INTO v_cat_id FROM categories WHERE lower(name) = lower(v_prod->>'category');
    IF v_cat_id IS NULL THEN
      RAISE EXCEPTION 'Category % not found and was not created.', v_prod->>'category';
    END IF;
    
    -- Check for existing product by baseSku
    SELECT * INTO v_existing_prod FROM products WHERE sku = v_prod->>'baseSku';
    
    IF v_existing_prod.id IS NOT NULL THEN
      IF lower(v_existing_prod.name) != lower(v_prod->>'name') THEN
        RAISE EXCEPTION 'Product SKU % already exists with name "%" (mismatch with "%")', v_prod->>'baseSku', v_existing_prod.name, v_prod->>'name';
      END IF;
      
      IF v_existing_prod.category_id != v_cat_id THEN
        RAISE EXCEPTION 'Product SKU % already exists with a different category.', v_prod->>'baseSku';
      END IF;
      
      IF (v_prod->>'purchasePrice')::numeric != 0 THEN
        IF v_existing_prod.purchase_price != (v_prod->>'purchasePrice')::numeric THEN
          RAISE EXCEPTION 'Product SKU % already exists with a different purchase price.', v_prod->>'baseSku';
        END IF;
      END IF;
      
      IF v_prod->>'description' IS NOT NULL AND btrim(v_prod->>'description') != '' THEN
        IF COALESCE(v_existing_prod.description, '') != (v_prod->>'description') THEN
          RAISE EXCEPTION 'Product SKU % already exists with a different description.', v_prod->>'baseSku';
        END IF;
      END IF;

      v_prod_id := v_existing_prod.id;
    ELSE
      v_prod_id := gen_random_uuid();
      
      INSERT INTO products (
        id, sku, name, category_id, description, purchase_price, image_url, attributes
      ) VALUES (
        v_prod_id,
        v_prod->>'baseSku',
        v_prod->>'name',
        v_cat_id,
        COALESCE(v_prod->>'description', ''),
        COALESCE((v_prod->>'purchasePrice')::numeric, 0),
        'https://placehold.co/600x600/eeeeee/999999?text=No+Image',
        '[]'::jsonb
      );
      v_prods_created := v_prods_created + 1;
    END IF;
    
    -- 3. Iterate variations
    FOR v_var IN SELECT * FROM jsonb_array_elements(v_prod->'variations') LOOP
      IF COALESCE((v_var->>'dailyRate')::numeric, 0) < 0 THEN
        RAISE EXCEPTION 'Daily rate for variation % cannot be negative.', v_var->>'sku';
      END IF;

      SELECT * INTO v_existing_var FROM product_variations WHERE sku = v_var->>'sku';
      
      IF v_existing_var.id IS NOT NULL THEN
        IF v_existing_var.product_id != v_prod_id THEN
          RAISE EXCEPTION 'Variation SKU % already exists for a different product.', v_var->>'sku';
        END IF;
        
        IF (v_existing_var.attributes->>'Color') != (v_var->>'color') THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different Color.', v_var->>'sku';
        END IF;
        
        IF (v_existing_var.attributes->>'Size') != (v_var->>'size') THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different Size.', v_var->>'sku';
        END IF;
        
        IF v_existing_var.daily_rate != COALESCE((v_var->>'dailyRate')::numeric, 0) THEN
          RAISE EXCEPTION 'Variation SKU % already exists with a different daily rate (DB: %, CSV: %).', v_var->>'sku', v_existing_var.daily_rate, COALESCE((v_var->>'dailyRate')::numeric, 0);
        END IF;

        v_var_id := v_existing_var.id;
      ELSE
        v_var_id := gen_random_uuid();
        INSERT INTO product_variations (
          id, product_id, sku, name, daily_rate, is_enabled, attributes
        ) VALUES (
          v_var_id,
          v_prod_id,
          v_var->>'sku',
          (v_prod->>'name') || ' - ' || (v_var->>'color') || ' - ' || (v_var->>'size'),
          COALESCE((v_var->>'dailyRate')::numeric, 0),
          true,
          jsonb_build_object('Color', v_var->>'color', 'Size', v_var->>'size')
        );
        v_vars_created := v_vars_created + 1;
      END IF;
      
      -- Lock the variation for physical SKU generation
      PERFORM pg_advisory_xact_lock(hashtext('var_lock_' || (v_var->>'sku')));
      
      -- 4. Process branch stock
      FOR v_branch_name, v_stock_qty IN SELECT key, value::text::integer FROM jsonb_each(v_var->'stockByBranch') LOOP
        IF v_stock_qty IS NULL OR v_stock_qty < 0 THEN
          RAISE EXCEPTION 'Stock quantity for variation % at branch % cannot be negative.', v_var->>'sku', v_branch_name;
        END IF;

        SELECT id INTO v_branch_id FROM branches WHERE lower(name) = lower(v_branch_name);
        IF v_branch_id IS NULL THEN
          RAISE EXCEPTION 'Branch "%" not found.', v_branch_name;
        END IF;
        
        IF v_user_role = 'manager' AND v_branch_id != v_my_branch_id THEN
          RAISE EXCEPTION 'Unauthorized branch "%" in CSV for Manager.', v_branch_name;
        END IF;

        -- Get existing physical units count for this variation AT THIS BRANCH
        SELECT COUNT(*) INTO v_existing_inv_count
        FROM inventory_items
        WHERE variation_id = v_var_id AND branch_id = v_branch_id;
        
        IF v_stock_qty < v_existing_inv_count THEN
          RAISE EXCEPTION 'CSV quantity (%) for variation % at branch % is lower than existing physical units (%). Cannot downsize.', 
            v_stock_qty, v_var->>'sku', v_branch_name, v_existing_inv_count;
        END IF;
        
        v_qty_to_create := v_stock_qty - v_existing_inv_count;
        
        IF v_qty_to_create > 0 THEN
          -- Calculate MAX suffix for the variation across ALL branches
          SELECT COALESCE(MAX(
            (substring(item_sku from char_length(v_var->>'sku') + 2))::integer
          ), 0) INTO v_max_suffix
          FROM inventory_items
          WHERE variation_id = v_var_id
            AND item_sku LIKE (v_var->>'sku') || '-%'
            AND substring(item_sku from char_length(v_var->>'sku') + 2) ~ '^[0-9]+$';
          
          v_next_suffix := v_max_suffix + 1;
          
          -- Insert new physical units
          FOR i IN 1..v_qty_to_create LOOP
            v_item_sku := (v_var->>'sku') || '-' || lpad(v_next_suffix::text, 3, '0');
            
            INSERT INTO inventory_items (
              id, product_id, variation_id, branch_id, item_sku, status
            ) VALUES (
              gen_random_uuid(), v_prod_id, v_var_id, v_branch_id, v_item_sku, 'available'
            );
            
            v_next_suffix := v_next_suffix + 1;
            v_units_created := v_units_created + 1;
          END LOOP;
        END IF;
        
        -- Upsert product_stock
        UPDATE product_stock 
        SET quantity = v_stock_qty 
        WHERE variation_id = v_var_id AND branch_id = v_branch_id;
        
        IF NOT FOUND THEN
          INSERT INTO product_stock (id, product_id, variation_id, branch_id, quantity)
          VALUES (gen_random_uuid(), v_prod_id, v_var_id, v_branch_id, v_stock_qty);
        END IF;
        
      END LOOP;
      
    END LOOP;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'categoriesCreated', v_cats_created,
    'productsCreated', v_prods_created,
    'variationsCreated', v_vars_created,
    'physicalUnitsCreated', v_units_created
  );
END;
$$;

-- ==============================================================================
-- S11: payments only through RPCs (they are SECURITY DEFINER and bypass RLS).
-- The app never inserts payments directly; owners/super_admins keep direct insert.
-- ==============================================================================
DROP POLICY IF EXISTS "pay_insert" ON "public"."payments";
CREATE POLICY "pay_insert" ON "public"."payments" FOR INSERT
  WITH CHECK (public.get_my_role() IN ('super_admin', 'owner'));

-- ==============================================================================
-- S4 (bookings): direct API updates may not touch money, status or ownership fields.
-- The app only updates advance_payment_method / security_deposit_payment_method directly.
-- RPCs run as their owner, so current_user is only anon/authenticated for direct API calls.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.guard_booking_direct_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.advance IS DISTINCT FROM OLD.advance
    OR NEW.security_deposit IS DISTINCT FROM OLD.security_deposit
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.token IS DISTINCT FROM OLD.token
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.cancellation_fee IS DISTINCT FROM OLD.cancellation_fee
    OR NEW.advance_refund IS DISTINCT FROM OLD.advance_refund
    OR NEW.security_deposit_refund IS DISTINCT FROM OLD.security_deposit_refund
    OR NEW.refund_payment_method IS DISTINCT FROM OLD.refund_payment_method
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
  ) THEN
    RAISE EXCEPTION 'Booking amounts and status can only be changed through the booking workflows';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_direct_update ON public.bookings;
CREATE TRIGGER trg_guard_booking_direct_update
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_direct_update();

-- ==============================================================================
-- S1 + S15: no EXECUTE for anon (Supabase grants it by default)
-- ==============================================================================
REVOKE ALL ON FUNCTION public.get_staff_emails() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_emails() TO authenticated;

REVOKE ALL ON FUNCTION public.pickup_booking_atomic(uuid, date, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_booking_atomic(uuid, date, numeric, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, text, numeric, numeric, numeric, text, jsonb, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_returned_atomic(uuid, timestamp with time zone, text, text, text, numeric, numeric, numeric, text, jsonb, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.extend_rental_atomic(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_rental_atomic(uuid, date, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.import_products_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_products_atomic(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
